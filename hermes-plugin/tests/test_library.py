import json
import os
import tempfile
import unittest
from pathlib import Path

from helpers import FakeBackend, Running

from hermes_ui_plus.config import VERSION, settings_from_mapping
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
        self.assertEqual(cfg, {"version": VERSION, "profile": "alice", "skills": {"available": True},
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
        self.assertEqual(svc._skill_list(), [{"name": "x", "description": "", "category": None, "enabled": True,
                                              "source": "local"}])


if __name__ == "__main__":
    unittest.main()
