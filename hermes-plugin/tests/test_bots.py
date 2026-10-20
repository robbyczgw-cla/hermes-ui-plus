import copy
import json
import unittest

from helpers import FakeBackend, Running

from hermes_ui_plus.bots import (BotsService, apply_bot_config, apply_ui_meta, bot_view, compose_soul, parse_fields,
                                 pick_name, slugify, toolsets)
from hermes_ui_plus.config import settings_from_mapping

KEY = "test_bridge_key_" + "0" * 24
BODY = {"title": "Scout", "job": "Preise und Angebote im Blick behalten",
        "how": "Kurz und sachlich.\nPreise immer mit Shop und Datum.", "template": "deals", "lang": "de",
        "may": {"web": True, "memory": True, "routines": True, "commands": False}, "color": "#3F7D6E", "api_key": KEY}


class FakeHermes:
    """In-memory profiles root: default + whatever the test adds. Records every write."""

    def __init__(self, names=("writer",), multiplex=True, fail_at=None):
        self.profiles = {n: {"profile.yaml": {}, "config.yaml": {"model": {"default": "m"}}, "SOUL.md": "",
                             "memories": {}, ".env": [], "parked": False} for n in names}
        self.default_config = {"model": {"provider": "p", "default": "m"}, "command_allowlist": ["delete in root path"],
                               "platform_toolsets": {"api_server": ["hermes-api-server"], "cli": ["web"]},
                               "approvals": {"mode": "smart", "timeout": 60}}
        self.multiplex = multiplex
        self.fail_at = fail_at
        self.notified = []
        self.calls = []

    def names(self):
        return list(self.profiles)

    def read_profile_yaml(self, name):
        return copy.deepcopy(self.profiles[name]["profile.yaml"])

    def is_parked(self, name):
        return self.profiles[name]["parked"]

    def create(self, name, description):
        self.calls.append(("create", name))
        if name in self.profiles:
            raise FileExistsError(name)
        self.profiles[name] = {"profile.yaml": {"description": description}, "config.yaml": copy.deepcopy(self.default_config),
                               "SOUL.md": "default soul", "memories": {"MEMORY.md": "x", "USER.md": "secret of default"},
                               ".env": ["OPENAI_API_KEY=sk-test"], "parked": False}

    def _maybe_fail(self, step):
        if self.fail_at == step:
            raise OSError(step)

    def drop_memory(self, name):
        self._maybe_fail("drop_memory")
        self.profiles[name]["memories"] = {}

    def write_soul(self, name, text):
        self._maybe_fail("write_soul")
        self.profiles[name]["SOUL.md"] = text

    def update_config(self, name, fn):
        self._maybe_fail("update_config")
        self.profiles[name]["config.yaml"] = fn(copy.deepcopy(self.profiles[name]["config.yaml"]))

    def update_profile_yaml(self, name, fn):
        self._maybe_fail("update_profile_yaml")
        self.profiles[name]["profile.yaml"] = fn(copy.deepcopy(self.profiles[name]["profile.yaml"]))

    def set_env(self, name, key, value):
        self._maybe_fail("set_env")
        env = [ln for ln in self.profiles[name][".env"] if not ln.startswith(key + "=")]
        self.profiles[name][".env"] = env + [f"{key}={value}"]

    def park(self, name):
        self.profiles[name]["parked"] = True

    def notify(self, name):
        self.notified.append(name)

    def multiplex_active(self):
        if self.multiplex == "raise":
            raise RuntimeError("old hermes")
        return self.multiplex


class PureTest(unittest.TestCase):
    def test_slugify_like_desktop(self):
        self.assertEqual(slugify("Scout"), "scout")
        self.assertEqual(slugify("Angebote & Preise"), "angebote-preise")
        self.assertEqual(slugify("Müller Bot"), "muller-bot")
        self.assertEqual(slugify("  --  "), "")
        self.assertEqual(slugify("日本"), "u65e5-u672c")
        long = slugify("word " * 30)
        self.assertLessEqual(len(long), 64)
        self.assertFalse(long.endswith("-"))

    def test_pick_name(self):
        self.assertEqual(pick_name("Scout", {"default"}), "scout")
        self.assertEqual(pick_name("Scout", {"scout", "scout-2"}), "scout-3")
        self.assertEqual(pick_name("Test", set()), "test-bot")  # reserved by Hermes
        self.assertEqual(pick_name("!!!", set()), "bot")
        self.assertEqual(pick_name("Default", set()), "bot")

    def test_parse_fields(self):
        f = parse_fields(BODY)
        self.assertEqual((f.title, f.template, f.lang, f.color), ("Scout", "deals", "de", "#3f7d6e"))
        self.assertEqual(parse_fields({**BODY, "title": "  Sc   out  "}).title, "Sc out")
        self.assertEqual(parse_fields({**BODY, "lang": "fr"}).lang, "en")
        for bad, field in (({"title": ""}, "title"), ({"title": "x" * 41}, "title"), ({"job": None}, "job"),
                           ({"how": "  "}, "how"), ({"template": "evil"}, "template"), ({"color": "red"}, "color"),
                           ({"may": {"root": True}}, "may"), ({"may": {"web": "yes"}}, "may"),
                           ({"title": "a\x00b"}, "title")):
            with self.subTest(bad=bad):
                with self.assertRaises(Exception) as cm:
                    parse_fields({**BODY, **bad})
                self.assertEqual((cm.exception.status, cm.exception.code, cm.exception.reason), (400, "invalid_field", field))

    def test_may_defaults_follow_the_template(self):
        code = parse_fields({k: v for k, v in BODY.items() if k != "may"} | {"template": "code"})
        self.assertEqual(code.may, {"web": False, "memory": True, "routines": False, "commands": True})
        deals = parse_fields({k: v for k, v in BODY.items() if k != "may"})
        self.assertEqual(deals.may, {"web": True, "memory": True, "routines": True, "commands": False})

    def test_soul(self):
        soul = compose_soul(parse_fields(BODY))
        self.assertTrue(soul.startswith("Du bist Scout. Preise und Angebote im Blick behalten.\n\nSo arbeitest du: Kurz"))
        self.assertIn("Kaufe, buche, sende oder lösche nichts", soul)
        self.assertIn("[SILENT]", soul)
        no_routines = compose_soul(parse_fields({**BODY, "may": {"routines": False}}))
        self.assertNotIn("Routine", no_routines)
        en = compose_soul(parse_fields({**BODY, "lang": "en", "job": "find sources."}))
        self.assertTrue(en.startswith("You are Scout. Find sources.\n"))
        es = compose_soul(parse_fields({**BODY, "lang": "es"}))
        self.assertTrue(es.startswith("Eres Scout."))

    def test_toolsets_and_config(self):
        self.assertEqual(toolsets({"web": True, "memory": True, "routines": True}), ["cronjob", "memory", "skills", "todo", "web"])
        self.assertEqual(toolsets({"commands": True}), ["file", "skills", "terminal", "todo"])
        cfg = apply_bot_config(FakeHermes().default_config, {"web": True})
        self.assertEqual(cfg["platform_toolsets"], {"api_server": ["skills", "todo", "web"], "cli": ["web"]})
        self.assertEqual(cfg["approvals"], {"mode": "manual", "timeout": 60})
        self.assertEqual(cfg["command_allowlist"], [])
        self.assertEqual(cfg["model"], {"provider": "p", "default": "m"})

    def test_ui_meta_revisions(self):
        doc = apply_ui_meta({"ui_meta": {"other": 1}, "_ui_meta_revisions": {"hermes-bots": 2, "bad": True}},
                            {"hermes-bots": {"title": "A"}, "new": {}})
        self.assertEqual(doc["ui_meta"], {"other": 1, "hermes-bots": {"title": "A"}, "new": {}})
        self.assertEqual(doc["_ui_meta_revisions"], {"hermes-bots": 3, "bad": True, "new": 1})

    def test_bot_view_projects_display_fields_only(self):
        v = bot_view("x", {"description": "d" * 300, "ui_meta": {"hermes-bots": {"title": "  X  Y ", "color": "#ABCDEF",
                                                                                 "pinned": True, "secret": "no"},
                                                                  "hermes-ui-plus": {"template": "code", "how": "h"}}})
        self.assertEqual(v, {"name": "x", "title": "X Y", "description": "d" * 160, "color": "#abcdef", "pinned": True,
                             "app": True, "template": "code"})
        self.assertEqual(bot_view("y", None), {"name": "y"})


class ServiceTest(unittest.IsolatedAsyncioTestCase):
    def svc(self, src=None, profile="default", **settings):
        src = src or FakeHermes()
        return BotsService(settings_from_mapping({"bots": settings}), src, profile, now=lambda: 1_790_000_000.0), src

    async def test_create_writes_everything(self):
        s, src = self.svc()
        out = await s.create(BODY)
        self.assertEqual(out, {"name": "scout", "title": "Scout", "description": BODY["job"], "color": "#3f7d6e",
                               "app": True, "template": "deals"})
        p = src.profiles["scout"]
        self.assertEqual(p["memories"], {})  # the default's memory never reaches the bot
        self.assertIn("Du bist Scout.", p["SOUL.md"])
        self.assertEqual(p["config.yaml"]["platform_toolsets"]["api_server"], ["cronjob", "memory", "skills", "todo", "web"])
        self.assertEqual(p["config.yaml"]["command_allowlist"], [])
        self.assertEqual(p[".env"], ["OPENAI_API_KEY=sk-test", f"API_SERVER_KEY={KEY}"])
        meta = p["profile.yaml"]["ui_meta"]
        self.assertEqual(meta["hermes-bots"], {"title": "Scout", "description": BODY["job"], "color": "#3f7d6e",
                                               "shape": "circle", "imageKind": "shape", "created": 1_790_000_000_000})
        self.assertEqual(meta["hermes-ui-plus"]["how"], BODY["how"])
        self.assertEqual(p["profile.yaml"]["_ui_meta_revisions"], {"hermes-bots": 1, "hermes-ui-plus": 1})
        self.assertEqual(src.notified, ["scout"])

    async def test_create_refusals(self):
        s, src = self.svc()
        await s.create(BODY)
        with self.assertRaises(Exception) as cm:
            await s.create({**BODY, "title": "  scout "})  # same name, other spelling
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "exists"))
        with self.assertRaises(Exception) as cm:
            await s.create({**BODY, "api_key": "short"})
        self.assertEqual(cm.exception.reason, "api_key")
        with self.assertRaises(Exception) as cm:
            await s.create({**BODY, "api_key": "has a space in it"})
        self.assertEqual(cm.exception.reason, "api_key")

    async def test_slug_collision_gets_a_suffix(self):
        src = FakeHermes(names=("scout",))
        src.profiles["scout"]["profile.yaml"] = {"ui_meta": {"hermes-bots": {"title": "Pfadfinder"}}}
        s, _ = self.svc(src)
        self.assertEqual((await s.create(BODY))["name"], "scout-2")

    async def test_limit(self):
        s, src = self.svc(FakeHermes(names=("a", "b")), limit=2)
        with self.assertRaises(Exception) as cm:
            await s.create(BODY)
        self.assertEqual((cm.exception.status, cm.exception.code), (409, "limit"))
        self.assertEqual((await s.list())["create"], {"available": False, "reason": "limit"})

    async def test_create_state(self):
        cases = [(dict(), {}, "default", {"available": True}),
                 (dict(enabled=False), {}, "default", None),
                 (dict(), {}, "writer", {"available": False, "reason": "not_root_profile"}),
                 (dict(), {"multiplex": False}, "default", {"available": False, "reason": "multiplex_off"}),
                 (dict(), {"multiplex": "raise"}, "default", {"available": False, "reason": "hermes_unsupported"})]
        for settings, src_kw, profile, want in cases:
            with self.subTest(settings=settings, src=src_kw, profile=profile):
                s, src = self.svc(FakeHermes(**src_kw), profile, **settings)
                if want is None:
                    with self.assertRaises(Exception) as cm:
                        await s.list()
                    self.assertEqual(cm.exception.reason, "disabled_by_config")
                    continue
                self.assertEqual((await s.list())["create"], want)
                if not want["available"]:
                    with self.assertRaises(Exception) as cm:
                        await s.create(BODY)
                    self.assertEqual((cm.exception.code, cm.exception.reason), ("feature_off", want["reason"]))
                    self.assertNotIn(("create", "scout"), src.calls)

    async def test_half_made_bot_is_parked(self):
        for step in ("drop_memory", "write_soul", "update_config", "set_env", "update_profile_yaml"):
            with self.subTest(step=step):
                s, src = self.svc(FakeHermes(fail_at=step))
                with self.assertRaises(Exception) as cm:
                    await s.create(BODY)
                self.assertEqual((cm.exception.status, cm.exception.code), (500, "create_failed"))
                self.assertTrue(src.profiles["scout"]["parked"])
                self.assertEqual(src.notified, [])

    async def test_get_and_patch(self):
        s, src = self.svc()
        await s.create(BODY)
        got = await s.get("scout")
        self.assertEqual((got["title"], got["job"], got["how"], got["template"], got["lang"], got["app"]),
                         ("Scout", BODY["job"], BODY["how"], "deals", "de", True))
        out = await s.patch("scout", {"title": "Späher", "job": "Nur Kopfhörer", "how": "Ganz kurz."})
        self.assertEqual((out["name"], out["title"], out["description"]), ("scout", "Späher", "Nur Kopfhörer"))
        p = src.profiles["scout"]
        self.assertTrue(p["SOUL.md"].startswith("Du bist Späher. Nur Kopfhörer.\n\nSo arbeitest du: Ganz kurz."))
        self.assertIn("[SILENT]", p["SOUL.md"])  # the switches stay as they were
        self.assertEqual(p["profile.yaml"]["ui_meta"]["hermes-bots"]["color"], "#3f7d6e")
        self.assertEqual(p["profile.yaml"]["_ui_meta_revisions"]["hermes-bots"], 2)
        for name, body, code in (("default", {}, "default_bot"), ("nope", {}, "unknown_bot"), ("../x", {}, "unknown_bot"),
                                 ("scout", {"title": "X", "job": "j", "how": "h", "may": {}}, "invalid_field"),
                                 ("scout", {"title": "Writer", "job": "j", "how": "h"}, None)):
            with self.subTest(name=name, body=body):
                if code is None:  # a Desktop bot without a title is matched by its name
                    with self.assertRaises(Exception) as cm:
                        await s.patch(name, body)
                    self.assertEqual(cm.exception.code, "exists")
                    continue
                with self.assertRaises(Exception) as cm:
                    await s.patch(name, body)
                self.assertEqual(cm.exception.code, code)

    async def test_list(self):
        src = FakeHermes(names=("writer", "z-hidden"))
        src.profiles["z-hidden"]["profile.yaml"] = {"ui_meta": {"hermes-bots": {"hidden": True}}}
        src.profiles["writer"]["parked"] = True
        s, _ = self.svc(src)
        got = await s.list()
        self.assertEqual(got["data"], [{"name": "writer", "parked": True}, {"name": "z-hidden", "hidden": True}])
        self.assertEqual((got["count"], got["limit"], got["profile"]), (2, 50, "default"))


class BotsHttpTest(unittest.TestCase):
    def run_with(self, src=None, **kw):
        r = Running(FakeBackend(), bots_source=src or FakeHermes(), **kw)
        self.addCleanup(r.close)
        return r

    def call(self, r, method, path, body=None, **kw):
        status, headers, payload = r.request(method, path, body, **kw)
        return status, json.loads(payload), headers

    def test_routes(self):
        r = self.run_with()
        self.assertEqual(self.call(r, "GET", "/bots", auth=False)[0], 401)
        self.assertEqual(self.call(r, "POST", "/bots", BODY, auth=False)[0], 401)
        status, body, _ = self.call(r, "GET", "/bots")
        self.assertEqual((status, body["create"], body["data"]), (200, {"available": True}, [{"name": "writer"}]))
        status, body, _ = self.call(r, "POST", "/bots", BODY)
        self.assertEqual((status, body["name"]), (201, "scout"))
        status, body, _ = self.call(r, "POST", "/bots", BODY)
        self.assertEqual((status, body["error"]["code"]), (409, "exists"))
        status, body, _ = self.call(r, "GET", "/bots/scout")
        self.assertEqual((status, body["how"]), (200, BODY["how"]))
        status, body, _ = self.call(r, "PATCH", "/bots/scout", {"title": "Scout", "job": "j", "how": "h"})
        self.assertEqual((status, body["description"]), (200, "j"))
        status, body, headers = self.call(r, "DELETE", "/bots/scout")
        self.assertEqual((status, headers.get("allow")), (405, "GET, PATCH"))
        self.assertEqual(self.call(r, "PATCH", "/bots", {})[0], 405)
        self.assertEqual(self.call(r, "GET", "/bots/a/b")[0], 404)
        status, body, _ = self.call(r, "POST", "/bots", raw_body=b"{nope")
        self.assertEqual((status, body["error"]["code"]), (400, "invalid_json"))
        status, body, _ = self.call(r, "POST", "/bots", {**BODY, "title": "Neu", "how": ""})
        self.assertEqual((status, body["error"]["reason"]), (400, "how"))

    def test_not_wired_and_disabled(self):
        r = Running(FakeBackend())
        self.addCleanup(r.close)
        self.assertEqual(self.call(r, "GET", "/bots")[0], 404)
        r2 = self.run_with(settings={"bots": {"enabled": False}})
        status, body, _ = self.call(r2, "GET", "/bots")
        self.assertEqual((status, body["error"]["reason"]), (404, "disabled_by_config"))


if __name__ == "__main__":
    unittest.main()


class AdapterFilesTest(unittest.TestCase):
    """HermesBots file work on a temp profiles root with a stand-in for hermes_cli.profiles."""

    def setUp(self):
        import os
        import sys
        import tempfile
        import types
        from pathlib import Path
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.dir = root / "profiles" / "scout"
        (self.dir / "memories").mkdir(parents=True)
        (self.dir / "memories" / "USER.md").write_text("from default")
        (self.dir / ".env").write_text("# comment\nOPENAI_API_KEY=sk-test\nexport API_SERVER_KEY=old\n")
        os.chmod(self.dir / ".env", 0o644)
        (self.dir / "config.yaml").write_text('{"model": {"default": "m"}, "command_allowlist": ["x"]}')
        # Hermes' YAML module, JSON-backed (JSON is YAML): the test needs neither ruamel nor PyYAML
        hy = types.ModuleType("hermes_yaml")
        hy.safe_load = lambda text: json.loads(text) if str(text).strip() else None
        hy.safe_dump = lambda data, sort_keys=True, allow_unicode=True, width=80: json.dumps(data, ensure_ascii=not allow_unicode)
        fake = types.ModuleType("hermes_cli.profiles")
        fake.get_profile_dir = lambda n: root / "profiles" / n
        fake.list_profile_names = lambda: ["default", "scout"]
        pkg = types.ModuleType("hermes_cli")
        pkg.profiles = fake
        saved = {k: sys.modules.get(k) for k in ("hermes_cli", "hermes_cli.profiles", "hermes_yaml")}
        sys.modules.update({"hermes_cli": pkg, "hermes_cli.profiles": fake, "hermes_yaml": hy})
        self.addCleanup(lambda: [sys.modules.pop(k, None) if v is None else sys.modules.__setitem__(k, v)
                                 for k, v in saved.items()])

    def test_file_work(self):
        import os
        from hermes_ui_plus.hermes_adapter import HermesBots
        hb = HermesBots()
        self.assertEqual(hb.names(), ["scout"])
        hb.drop_memory("scout")
        self.assertEqual(list((self.dir / "memories").iterdir()), [])
        hb.set_env("scout", "API_SERVER_KEY", KEY)
        self.assertEqual((self.dir / ".env").read_text(), f"# comment\nOPENAI_API_KEY=sk-test\nAPI_SERVER_KEY={KEY}\n")
        self.assertEqual(os.stat(self.dir / ".env").st_mode & 0o777, 0o600)
        hb.update_config("scout", lambda c: apply_bot_config(c, {"web": True}))
        self.assertEqual(hb._load_yaml(self.dir / "config.yaml")["command_allowlist"], [])
        hb.update_profile_yaml("scout", lambda d: apply_ui_meta(d, {"hermes-bots": {"title": "Späher"}}))
        self.assertEqual(hb.read_profile_yaml("scout")["ui_meta"]["hermes-bots"]["title"], "Späher")
        self.assertIn("Späher", (self.dir / "profile.yaml").read_text(encoding="utf-8"))  # readable, not escaped
        hb.write_soul("scout", "Du bist Späher.\n")
        self.assertEqual((self.dir / "SOUL.md").read_text(encoding="utf-8"), "Du bist Späher.\n")
        self.assertFalse(hb.is_parked("scout"))
        hb.park("scout")
        self.assertTrue(hb.is_parked("scout"))
        self.assertEqual(hb.read_profile_yaml("missing"), {})
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name.endswith(".hui-tmp")], [])
