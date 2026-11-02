import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from helpers import FakeBackend, Running

from hermes_ui_plus.config import VERSION, settings_from_mapping
from hermes_ui_plus.hermes_adapter import HermesLibrary
from hermes_ui_plus.library import LibraryService, profile_name, split_entries

SKILLS = [
    {"name": "zeta", "description": "last", "category": "tools", "enabled": True, "source": "hub"},
    {"name": "alpha", "description": "first", "category": None, "enabled": False, "source": "local"},
    {"name": "beta", "description": "second", "category": "apps", "enabled": True, "source": "bundled"},
]
MEM_CFG = {"provider": None, "memory_enabled": True, "user_enabled": True, "memory_limit": 2200, "user_limit": 1375}


class FakeSource:
    def __init__(self, skills=SKILLS, md=None, mem=None, fail=False):
        self._skills, self.md, self.mem, self.fail = skills, md or {}, dict(mem or MEM_CFG), fail
        self.md_calls = []

    def skills(self):
        if self.fail:
            raise ImportError("no hermes")
        return [dict(s) for s in self._skills]

    def skill_md(self, name):
        self.md_calls.append(name)
        return self.md.get(name)

    def memory_settings(self):
        if self.fail:
            raise ImportError("no hermes")
        return dict(self.mem)


class LibraryHttpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = os.path.join(self.tmp.name, "profiles", "alice")
        os.makedirs(os.path.join(self.home, "memories"))

    def run_with(self, source=None, settings=None):
        r = Running(FakeBackend(), settings, library_source=source or FakeSource(), home=self.home)
        self.addCleanup(r.close)
        return r

    @staticmethod
    def get(r, path, **kw):
        status, _, body = r.request("GET", path, **kw)
        return status, json.loads(body)

    def test_auth_and_methods(self):
        r = self.run_with()
        for p in ("/library/config", "/library/skills", "/library/skills/content?name=alpha", "/library/memory"):
            self.assertEqual(r.request("GET", p, auth=False)[0], 401, p)
            self.assertEqual(r.request("POST", p.split("?")[0], {})[0], 405, p)
        self.assertEqual(r.request("GET", "/library/nope")[0], 404)

    def test_config(self):
        status, cfg = self.get(self.run_with(), "/library/config")
        self.assertEqual(status, 200)
        self.assertEqual(cfg, {"version": VERSION, "profile": "alice", "profiles": False, "skills": {"available": True},
                               "memory": {"available": False, "reason": "memory_not_exposed"}})
        _, cfg = self.get(self.run_with(settings={"library": {"expose_memory": True}}), "/library/config")
        self.assertEqual(cfg["memory"], {"available": True})
        _, cfg = self.get(self.run_with(settings={"library": {"enabled": False, "expose_memory": True}}),
                          "/library/config")
        self.assertEqual((cfg["skills"], cfg["memory"]), ({"available": False, "reason": "disabled_by_config"},) * 2)

    def test_list_sorted_with_enabled_and_source(self):
        status, body = self.get(self.run_with(), "/library/skills")
        self.assertEqual(status, 200)
        self.assertEqual((body["object"], body["profile"]), ("list", "alice"))
        self.assertEqual([s["name"] for s in body["data"]], ["alpha", "beta", "zeta"])  # (category or "", name)
        by = {s["name"]: s for s in body["data"]}
        self.assertEqual((by["alpha"]["enabled"], by["alpha"]["source"], by["alpha"]["category"]),
                         (False, "local", None))
        self.assertEqual((by["zeta"]["source"], by["beta"]["source"]), ("hub", "bundled"))
        self.assertEqual(set(by["beta"]), {"name", "description", "category", "enabled", "source"})

    def test_content_for_listed_name(self):
        src = FakeSource(md={"alpha": "﻿# Alpha\nbody ä".encode("utf-8")})
        status, body = self.get(self.run_with(src), "/library/skills/content?name=alpha")
        self.assertEqual((status, body), (200, {"name": "alpha", "content": "# Alpha\nbody ä", "truncated": False}))

    def test_content_truncated(self):
        src = FakeSource(md={"alpha": b"x" * (256 * 1024 + 1)})
        _, body = self.get(self.run_with(src), "/library/skills/content?name=alpha")
        self.assertTrue(body["truncated"])
        self.assertEqual(len(body["content"]), 256 * 1024)

    def test_content_unknown_and_traversal_refused(self):
        src = FakeSource(md={"alpha": b"x", "../../etc/passwd": b"SECRET"})
        r = self.run_with(src)
        for name in ("nope", "../../etc/passwd", "alpha/../beta", "/etc/passwd", "Alpha"):
            status, body = self.get(r, "/library/skills/content?name=" + name.replace("/", "%2F"))
            self.assertEqual((status, body["error"]["code"]), (404, "not_found"), name)
        self.assertEqual(src.md_calls, [])  # never reached Hermes with a name that is not in the list
        self.assertEqual(self.get(r, "/library/skills/content")[0], 400)
        self.assertEqual(self.get(r, "/library/skills/content?name=" + "a" * 201)[0], 400)

    def test_content_listed_without_file(self):
        status, body = self.get(self.run_with(FakeSource()), "/library/skills/content?name=alpha")
        self.assertEqual((status, body["error"]["code"]), (404, "not_found"))

    def test_memory_off_by_default(self):
        Path(self.home, "memories", "MEMORY.md").write_text("secret fact", encoding="utf-8")
        status, body = self.get(self.run_with(), "/library/memory")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "feature_off")
        self.assertEqual(body["error"]["reason"], "memory_not_exposed")
        self.assertNotIn("secret fact", json.dumps(body))

    def test_library_disabled(self):
        r = self.run_with(settings={"library": {"enabled": False, "expose_memory": True}})
        for p in ("/library/skills", "/library/skills/content?name=alpha", "/library/memory"):
            status, body = self.get(r, p)
            self.assertEqual((status, body["error"]["code"], body["error"]["reason"]), (404, "feature_off",
                                                                                         "disabled_by_config"), p)

    def test_memory_on(self):
        mem = Path(self.home, "memories")
        (mem / "MEMORY.md").write_text("  one  \n§\nline a\nline b\n§\n\n§\n" + "y" * 5000, encoding="utf-8")
        os.utime(mem / "MEMORY.md", (1_700_000_000, 1_700_000_000))
        src = FakeSource(mem={**MEM_CFG, "provider": "honcho", "memory_limit": 3000})
        status, body = self.get(self.run_with(src, {"library": {"expose_memory": True}}), "/library/memory")
        self.assertEqual(status, 200)
        self.assertEqual((body["profile"], body["provider"]), ("alice", "honcho"))
        m, u = body["stores"]
        self.assertEqual((m["target"], m["enabled"], m["limit"], m["updated_at"]),
                         ("memory", True, 3000, "2023-11-14T22:13:20Z"))
        self.assertEqual(m["entries"][:2], ["one", "line a\nline b"])
        self.assertEqual(len(m["entries"][2]), 4000)  # entry cap
        self.assertEqual(m["chars"], len("one\n§\nline a\nline b\n§\n" + "y" * 5000))
        self.assertEqual((u["target"], u["entries"], u["chars"], u["limit"], u["updated_at"]),
                         ("user", [], 0, 1375, None))  # no USER.md

    def test_memory_store_gate_off(self):
        Path(self.home, "memories", "USER.md").write_text("private", encoding="utf-8")
        src = FakeSource(mem={**MEM_CFG, "user_enabled": False})
        _, body = self.get(self.run_with(src, {"library": {"expose_memory": True}}), "/library/memory")
        self.assertEqual(body["stores"][1]["enabled"], False)
        self.assertEqual(body["stores"][1]["entries"], [])

    def test_hermes_unsupported_fallback(self):
        r = self.run_with(FakeSource(fail=True), {"library": {"expose_memory": True}})
        _, cfg = self.get(r, "/library/config")
        self.assertEqual(cfg["skills"], {"available": False, "reason": "hermes_unsupported"})
        self.assertEqual(cfg["memory"], {"available": False, "reason": "hermes_unsupported"})
        for p in ("/library/skills", "/library/skills/content?name=alpha", "/library/memory"):
            status, body = self.get(r, p)
            self.assertEqual((status, body["error"]["code"], body["error"]["reason"]), (404, "feature_off",
                                                                                         "hermes_unsupported"), p)

    def test_no_library_without_service(self):
        r = Running(FakeBackend())
        self.addCleanup(r.close)
        self.assertEqual(r.request("GET", "/library/config")[0], 404)

    def test_quick_unaffected_by_query_string(self):
        r = self.run_with()
        self.assertEqual(r.request("GET", "/quick/config?x=1")[0], 200)


class RootSource(FakeSource):
    """The root profile's source: knows other profiles and makes a source per profile (like HermesLibrary)."""

    def __init__(self, root, others=None, names_fail=False, **kw):
        super().__init__(**kw)
        self.root, self.others, self.names_fail = root, others or {}, names_fail
        self.made = []

    def profile_names(self):
        if self.names_fail:
            raise RuntimeError("no home override")
        return list(self.others)

    def for_profile(self, name):
        self.made.append(name)
        return self.others[name], os.path.join(self.root, "profiles", name)


WRITER_SKILLS = [{"name": "drafting", "description": "w", "category": None, "enabled": True, "source": "local"}]


class OtherProfilesTest(unittest.TestCase):
    """?profile=<name>: the root profile's plugin reads another profile's skills and memory."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        os.makedirs(os.path.join(self.root, "memories"))
        self.writer_home = os.path.join(self.root, "profiles", "writer")
        os.makedirs(os.path.join(self.writer_home, "memories"))
        Path(self.root, "memories", "MEMORY.md").write_text("root fact", encoding="utf-8")
        Path(self.writer_home, "memories", "MEMORY.md").write_text("writer fact\n§\nsecond", encoding="utf-8")
        self.writer = FakeSource(skills=WRITER_SKILLS, md={"drafting": b"# Drafting"},
                                 mem={**MEM_CFG, "user_enabled": False, "memory_limit": 999})

    def run_with(self, source=None, settings=None, home=None):
        src = source or RootSource(self.root, {"writer": self.writer})
        r = Running(FakeBackend(), settings, library_source=src, home=home or self.root)
        self.addCleanup(r.close)
        return r, src

    get = staticmethod(LibraryHttpTest.get)

    def test_config_profiles_flag(self):
        r, _ = self.run_with()
        _, cfg = self.get(r, "/library/config")
        self.assertEqual((cfg["profile"], cfg["profiles"]), ("default", True))
        _, cfg = self.get(self.run_with(RootSource(self.root, names_fail=True))[0], "/library/config")
        self.assertEqual(cfg["profiles"], False)
        _, cfg = self.get(self.run_with(FakeSource())[0], "/library/config")  # a source without profile reads
        self.assertEqual(cfg["profiles"], False)
        _, cfg = self.get(self.run_with(settings={"library": {"enabled": False}})[0], "/library/config")
        self.assertEqual(cfg["profiles"], False)

    def test_config_of_another_profile(self):
        r, _ = self.run_with(settings={"library": {"expose_memory": True}})
        status, cfg = self.get(r, "/library/config?profile=writer")
        self.assertEqual((status, cfg), (200, {"version": VERSION, "profile": "writer", "profiles": True,
                                               "skills": {"available": True}, "memory": {"available": True}}))
        _, own = self.get(r, "/library/config?profile=default")
        self.assertEqual(own["profile"], "default")

    def test_skills_and_content_of_another_profile(self):
        r, src = self.run_with()
        status, body = self.get(r, "/library/skills?profile=writer")
        self.assertEqual((status, body["profile"], [s["name"] for s in body["data"]]), (200, "writer", ["drafting"]))
        status, body = self.get(r, "/library/skills/content?name=drafting&profile=writer")
        self.assertEqual((status, body["content"]), (200, "# Drafting"))
        status, body = self.get(r, "/library/skills/content?name=alpha&profile=writer")  # a root skill, not writer's
        self.assertEqual((status, body["error"]["code"]), (404, "not_found"))
        _, own = self.get(r, "/library/skills")
        self.assertEqual([s["name"] for s in own["data"]], ["alpha", "beta", "zeta"])
        self.assertEqual(self.writer.md_calls, ["drafting"])

    def test_memory_of_another_profile(self):
        r, _ = self.run_with()
        status, body = self.get(r, "/library/memory?profile=writer")
        self.assertEqual((status, body["error"]["reason"]), (404, "memory_not_exposed"))
        r, _ = self.run_with(settings={"library": {"expose_memory": True}})
        status, body = self.get(r, "/library/memory?profile=writer")
        self.assertEqual((status, body["profile"]), (200, "writer"))
        m, u = body["stores"]
        self.assertEqual((m["entries"], m["limit"]), (["writer fact", "second"], 999))  # writer's file + config
        self.assertEqual((u["enabled"], u["entries"]), (False, []))
        _, own = self.get(r, "/library/memory")
        self.assertEqual(own["stores"][0]["entries"], ["root fact"])

    def test_unknown_profile(self):
        r, src = self.run_with(settings={"library": {"expose_memory": True}})
        for path in ("/library/config", "/library/skills", "/library/skills/content?name=x&", "/library/memory"):
            for name in ("nope", "..%2Fwriter", "Writer", "a" * 65):
                sep = "&" if "?" in path else "?"
                status, body = self.get(r, f"{path.rstrip('&')}{sep}profile={name}")
                self.assertEqual((status, body["error"]["code"]), (404, "unknown_bot"), (path, name))
        self.assertEqual(src.made, [])

    def test_not_root_and_unsupported(self):
        alice = os.path.join(self.root, "profiles", "alice")
        r, _ = self.run_with(home=alice)
        for path in ("/library/config?profile=writer", "/library/skills?profile=writer"):
            status, body = self.get(r, path)
            self.assertEqual((status, body["error"]["code"], body["error"]["reason"]),
                             (404, "feature_off", "not_root_profile"), path)
        status, _ = self.get(r, "/library/skills?profile=alice")  # its own name is its own profile
        self.assertEqual(status, 200)
        r, _ = self.run_with(RootSource(self.root, {"writer": self.writer}, names_fail=True))
        status, body = self.get(r, "/library/skills?profile=writer")
        self.assertEqual((status, body["error"]["reason"]), (404, "hermes_unsupported"))
        r, _ = self.run_with(FakeSource())
        status, body = self.get(r, "/library/skills?profile=writer")
        self.assertEqual((status, body["error"]["reason"]), (404, "hermes_unsupported"))

    def test_disabled_library_refuses_other_profiles(self):
        r, src = self.run_with(settings={"library": {"enabled": False}})
        for path in ("/library/config?profile=writer", "/library/skills?profile=writer"):
            status, body = self.get(r, path)
            self.assertEqual((status, body["error"]["reason"]), (404, "disabled_by_config"), path)
        self.assertEqual(src.made, [])

    def test_broken_profile_source_is_unsupported(self):
        r, _ = self.run_with(RootSource(self.root, {"writer": FakeSource(fail=True)}),
                             {"library": {"expose_memory": True}})
        _, cfg = self.get(r, "/library/config?profile=writer")
        self.assertEqual((cfg["skills"]["reason"], cfg["memory"]["reason"]), ("hermes_unsupported",) * 2)
        status, body = self.get(r, "/library/skills?profile=writer")
        self.assertEqual((status, body["error"]["reason"]), (404, "hermes_unsupported"))


class ForcedScopeTest(unittest.TestCase):
    """HermesLibrary for another profile reads inside a FORCED home override (also when a host scope exists)."""

    def setUp(self):
        import contextvars
        import sys
        import types
        from unittest import mock
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "profiles" / "writer").mkdir(parents=True)
        self.home = contextvars.ContextVar("home", default=None)
        self.scope = contextvars.ContextVar("scope", default={"host": "scope of default"})  # a host scope is present
        self.built = []
        hc = types.ModuleType("hermes_constants")
        hc.set_hermes_home_override = lambda p: self.home.set(p)
        hc.reset_hermes_home_override = lambda t: self.home.reset(t)
        ss = types.ModuleType("agent.secret_scope")
        ss.is_multiplex_active = lambda: True
        ss.current_secret_scope = lambda: self.scope.get()
        ss.build_profile_secret_scope = lambda h: self.built.append(str(h)) or {"profile": h.name}
        ss.set_secret_scope = lambda m, profile_home=None: self.scope.set(m)
        ss.reset_secret_scope = lambda t: self.scope.reset(t)
        agent = types.ModuleType("agent")
        agent.secret_scope = ss
        profiles = types.ModuleType("hermes_cli.profiles")
        profiles.list_profile_names = lambda: ["default", "writer"]
        profiles.get_profile_dir = lambda n: self.root if n == "default" else self.root / "profiles" / n
        config = types.ModuleType("hermes_cli.config")
        seen = self.seen = []

        def load_config():
            seen.append((self.home.get(), self.scope.get()))
            return {"memory": {"memory_char_limit": 1234 if self.home.get() else 2200}}
        config.load_config = load_config
        cli = types.ModuleType("hermes_cli")
        cli.profiles, cli.config = profiles, config
        self.mods = {"hermes_constants": hc, "agent": agent, "agent.secret_scope": ss, "hermes_cli": cli,
                     "hermes_cli.profiles": profiles, "hermes_cli.config": config}
        patcher = mock.patch.dict(sys.modules, self.mods)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_other_profile_reads_under_its_home(self):
        from hermes_ui_plus.hermes_adapter import HermesLibrary
        own = HermesLibrary(str(self.root))
        self.assertEqual(own.profile_names(), ["writer"])
        src, home = own.for_profile("writer")
        self.assertEqual(home, str(self.root / "profiles" / "writer"))
        self.assertEqual(src.memory_settings()["memory_limit"], 1234)
        self.assertEqual(self.seen[-1], (home, {"profile": "writer"}))
        self.assertEqual(self.built, [home])
        self.assertEqual((self.home.get(), self.scope.get()), (None, {"host": "scope of default"}))  # all reset
        own.memory_settings()  # the own profile: host scope present, nothing entered
        self.assertEqual(self.seen[-1], (None, {"host": "scope of default"}))

    def test_secret_scope_failure_keeps_the_override(self):
        from hermes_ui_plus.hermes_adapter import HermesLibrary

        def boom(h):
            raise OSError("no .env")
        self.mods["agent.secret_scope"].build_profile_secret_scope = boom
        src, home = HermesLibrary(str(self.root)).for_profile("writer")
        self.assertEqual(src.memory_settings()["memory_limit"], 1234)
        self.assertEqual(self.seen[-1], (home, {"host": "scope of default"}))

    def test_without_home_override_other_profiles_are_unsupported(self):
        from hermes_ui_plus.hermes_adapter import HermesLibrary
        del self.mods["hermes_constants"].set_hermes_home_override
        with self.assertRaises(RuntimeError):
            HermesLibrary(str(self.root)).profile_names()
        src, _ = HermesLibrary(str(self.root)).for_profile("writer")
        with self.assertRaises(RuntimeError):
            src.memory_settings()

    def test_for_profile_refuses_odd_directories(self):
        from hermes_ui_plus.hermes_adapter import HermesLibrary
        self.mods["hermes_cli.profiles"].get_profile_dir = lambda n: self.root / "elsewhere" / n
        with self.assertRaises(ValueError):
            HermesLibrary(str(self.root)).for_profile("writer")


class LibraryUnitTest(unittest.TestCase):
    def test_profile_name(self):
        self.assertEqual(profile_name("/h/.hermes/profiles/alice"), "alice")
        self.assertEqual(profile_name("/h/.hermes"), "default")
        self.assertEqual(profile_name("/h/profiles"), "default")
        self.assertEqual(profile_name("/h/profiles/a/b"), "default")

    def test_split_entries(self):
        self.assertEqual(split_entries(" a \n§\n\n§\nb\n"), ["a", "b"])
        self.assertEqual(split_entries(""), [])

    def test_settings_defaults(self):
        s = settings_from_mapping({})
        self.assertEqual((s.library_enabled, s.library_expose_memory), (True, False))
        s = settings_from_mapping({"library": {"enabled": "false", "expose_memory": "yes"}})
        self.assertEqual((s.library_enabled, s.library_expose_memory), (False, True))

    def test_unknown_source_value_becomes_local(self):
        svc = LibraryService(settings_from_mapping({}), FakeSource(
            [{"name": "x", "description": None, "category": "", "enabled": True, "source": "weird"}]), "/h")
        self.assertEqual(svc._skill_list(svc._own), [{"name": "x", "description": "", "category": None, "enabled": True,
                                              "source": "local"}])


class HermesLibrarySkillsTest(unittest.TestCase):
    """HermesLibrary.skills() against fake Hermes modules in the v0.22.2 and v0.22.3+ shapes."""

    RAW = [{"name": "zeta", "description": "z", "category": "tools"},
           {"name": "alpha", "description": None, "category": None},
           {"name": "beta", "description": "b", "category": "apps"}]

    def _hermes(self, shape):
        calls = []

        def find_all(*, skip_disabled):
            calls.append(("find", skip_disabled))
            return list(self.RAW)

        def sort(items):
            calls.append(("sort", len(items)))
            return sorted(items, key=lambda s: (s["category"] or "", s["name"]))

        st = types.ModuleType("tools.skills_tool")
        if shape == "0.22.2":
            st._find_all_skills, st._sort_skills = find_all, sort
        elif shape == "0.22.5":  # upstream 93fafc4d6f renamed both, no alias
            st.find_all_skills, st.sort_skills = find_all, sort
        su = types.ModuleType("tools.skill_usage")
        su._read_bundled_names = lambda: ["beta"]
        su._read_hub_installed_names = lambda: ["zeta"]
        su._external_skill_names = lambda: []
        tools = types.ModuleType("tools")
        tools.skills_tool, tools.skill_usage = st, su
        cfg = types.ModuleType("hermes_cli.config")
        cfg.load_config = lambda: {}
        sc = types.ModuleType("hermes_cli.skills_config")
        sc.get_disabled_skills = lambda c, platform=None: {"alpha"} if platform is None else set()
        hc = types.ModuleType("hermes_cli")
        hc.config, hc.skills_config = cfg, sc
        mods = {"tools": tools, "tools.skills_tool": st, "tools.skill_usage": su, "hermes_cli": hc,
                "hermes_cli.config": cfg, "hermes_cli.skills_config": sc, "agent": None}  # no profile scopes
        patcher = mock.patch.dict(sys.modules, mods)
        patcher.start()
        self.addCleanup(patcher.stop)
        return calls

    def test_same_list_on_both_hermes_versions(self):
        want = [
            {"name": "alpha", "description": "", "category": None, "enabled": False, "source": "local"},
            {"name": "beta", "description": "b", "category": "apps", "enabled": True, "source": "bundled"},
            {"name": "zeta", "description": "z", "category": "tools", "enabled": True, "source": "hub"},
        ]
        for shape in ("0.22.2", "0.22.5"):
            with self.subTest(shape=shape):
                calls = self._hermes(shape)
                self.assertEqual(HermesLibrary(None).skills(), want)
                self.assertEqual(calls, [("find", True), ("sort", 3)])

    def test_neither_name_is_unsupported(self):
        self._hermes("none")
        with self.assertRaises(AttributeError):  # LibraryService turns this into hermes_unsupported
            HermesLibrary(None).skills()


if __name__ == "__main__":
    unittest.main()
