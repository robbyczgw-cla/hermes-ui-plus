import logging
import os
import shutil
import socket
import stat
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

import helpers  # noqa: F401  (sys.path)
import hermes_ui_plus
from hermes_ui_plus import config as cfgmod
from hermes_ui_plus.hermes_adapter import HermesAuxBackend
from hermes_ui_plus.prompt import QUICK_SYSTEM_PROMPT, build_system_prompt, estimate_tokens, example_nodes
from hermes_ui_plus.secret import SecretCheck, create_secret, load_secret

REPO = Path(__file__).resolve().parents[2]


def collect(backend, cancel=None, **kw):
    args = dict(messages=[{"role": "user", "content": "q"}], provider=None, model=None, max_tokens=50, timeout=5,
                cancel=cancel or threading.Event())
    args.update(kw)
    return list(backend.stream(**args))


def chunk(content=None, finish=None, model="m1", usage=None, reasoning=None):
    delta = NS(content=content, reasoning_content=reasoning)
    return NS(model=model, choices=[NS(delta=delta, finish_reason=finish)], usage=usage)


class AdapterTest(unittest.TestCase):
    def test_streaming_chunks(self):
        calls = []

        def call_llm(**kw):
            calls.append(kw)
            kw["route_info"].update(provider="prov", model="m1")
            return iter([chunk(reasoning="thinking..."), chunk("Hal"), chunk("lo", finish="stop"),
                         NS(model="m1", choices=[], usage=NS(prompt_tokens=10, completion_tokens=2))])

        ev = collect(HermesAuxBackend("hui_quick", call_llm))
        self.assertEqual(calls[0]["task"], "hui_quick")
        self.assertTrue(calls[0]["stream"])
        self.assertEqual(calls[0]["stream_options"], {"include_usage": True})
        self.assertEqual([v for k, v in ev if k == "delta"], ["Hal", "lo"])  # reasoning dropped
        self.assertIn(("finish", "stop"), ev)
        self.assertIn(("usage", {"prompt_tokens": 10, "completion_tokens": 2}), ev)
        self.assertIn(("route", {"provider": "prov", "model": "m1"}), ev)
        self.assertIn(("mode", "stream"), ev)

    def test_stream_rejected_falls_back_to_single(self):
        def call_llm(**kw):
            if kw.get("stream"):
                raise ValueError("stream_options not supported")
            return NS(model="m2", choices=[NS(message=NS(content="ganz"), finish_reason="stop")],
                      usage=NS(prompt_tokens=3, completion_tokens=1))

        ev = collect(HermesAuxBackend("t", call_llm))
        self.assertIn(("mode", "single"), ev)
        self.assertEqual([v for k, v in ev if k == "delta"], ["ganz"])

    def test_complete_response_from_stream_call(self):
        resp = NS(model="m3", choices=[NS(message=NS(content="eins"), finish_reason="length")], usage=None)
        ev = collect(HermesAuxBackend("t", lambda **kw: resp))
        self.assertEqual([v for k, v in ev if k == "delta"], ["eins"])
        self.assertIn(("finish", "length"), ev)

    def test_stream_breaks_before_content_retries(self):
        def broken():
            raise ConnectionError("reset")
            yield  # pragma: no cover

        def call_llm(**kw):
            if kw.get("stream"):
                return broken()
            return NS(model="m", choices=[NS(message=NS(content="ok"), finish_reason="stop")])

        ev = collect(HermesAuxBackend("t", call_llm))
        self.assertEqual([v for k, v in ev if k == "delta"], ["ok"])

    def test_cancel_stops_and_closes(self):
        closed = threading.Event()
        cancel = threading.Event()

        class Stream:
            def __iter__(self):
                return self

            def __next__(self):
                cancel.set()
                return chunk("x")

            def close(self):
                closed.set()

        ev = collect(HermesAuxBackend("t", lambda **kw: Stream()), cancel=cancel)
        self.assertLessEqual(len([e for e in ev if e[0] == "delta"]), 1)
        self.assertTrue(closed.is_set())

    def test_only_one_hermes_import(self):
        pkg = REPO / "hermes-plugin" / "hermes_ui_plus"
        offenders = []
        for f in pkg.glob("*.py"):
            for line in f.read_text().splitlines():
                s = line.strip()
                if s.startswith(("from ", "import ")) and any(
                        s.split()[1].startswith(m) for m in ("agent", "gateway", "hermes_cli", "hermes_constants",
                                                            "tools", "run_agent", "hermes_state")):
                    offenders.append(f"{f.name}: {s}")
        self.assertEqual(offenders, ["hermes_adapter.py: from agent.auxiliary_client import call_llm  "
                                     "# the single Hermes-internal import of this plugin"])

    def test_stdlib_only(self):
        import sys
        pkg = REPO / "hermes-plugin" / "hermes_ui_plus"
        std = set(sys.stdlib_module_names) | {"__future__"}
        for f in pkg.glob("*.py"):
            for line in f.read_text().splitlines():
                s = line.strip()
                if s.startswith("import ") or (s.startswith("from ") and " import " in s):
                    mod = s.split()[1]
                    if mod.startswith(".") or mod.split(".")[0] in ("agent",):
                        continue
                    self.assertIn(mod.split(".")[0], std, f"{f.name}: {s}")


class FakeCtx:
    def __init__(self, settings=None, aux_raises=False):
        self.settings = settings or {}
        self.aux = []
        self.unload = []
        self.aux_raises = aux_raises

    def register_auxiliary_task(self, key, **kw):
        if self.aux_raises:
            raise ValueError("boom")
        self.aux.append((key, kw))

    def get_config(self, key, default=None):
        node = self.settings
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def on_unload(self, cb):
        self.unload.append(cb)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class RegisterTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="hui-plugin-test-"))
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        env = mock.patch.dict(os.environ, {"HERMES_HOME": str(self.home)})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop(cfgmod.KILL_SWITCH_ENV, None)

    def test_registers_aux_task_and_listener(self):
        create_secret(self.home / "hermes-ui-plus" / "secret")
        port = free_port()
        ctx = FakeCtx({"server": {"port": port}})
        hermes_ui_plus.register(ctx)
        self.assertEqual(ctx.aux[0][0], "hui_quick")
        self.assertEqual(ctx.aux[0][1]["inherit_from"], "title_generation")
        self.assertEqual(ctx.aux[0][1]["defaults"]["reasoning_effort"], "low")
        self.assertEqual(len(ctx.unload), 1)
        with socket.create_connection(("127.0.0.1", port), timeout=2) as s:
            s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertIn(b"200 OK", s.recv(200))
        # second process/registration: port taken -> passive, no error, no unload hook
        ctx2 = FakeCtx({"server": {"port": port}})
        hermes_ui_plus.register(ctx2)
        self.assertEqual(ctx2.unload, [])
        ctx.unload[0]()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=1).close()

    def test_kill_switch(self):
        with mock.patch.dict(os.environ, {cfgmod.KILL_SWITCH_ENV: "1"}):
            ctx = FakeCtx()
            hermes_ui_plus.register(ctx)
        self.assertEqual((ctx.aux, ctx.unload), ([], []))

    def test_old_hermes_without_hook(self):
        hermes_ui_plus.register(object())  # no register_auxiliary_task: logs, no exception

    def test_registration_error_never_raises(self):
        with self.assertLogs("hermes_ui_plus", logging.WARNING):
            hermes_ui_plus.register(FakeCtx(aux_raises=True))

    def test_no_secret_no_listener(self):
        port = free_port()
        ctx = FakeCtx({"server": {"port": port}})
        hermes_ui_plus.register(ctx)
        self.assertEqual(len(ctx.aux), 1)
        self.assertEqual(ctx.unload, [])

    def test_non_loopback_host_refused(self):
        s = cfgmod.settings_from_mapping({"server": {"host": "0.0.0.0", "port": 1}})
        self.assertEqual(s.host, "127.0.0.1")
        self.assertTrue(s.warnings)
        self.assertEqual(cfgmod.settings_from_mapping({"server": {"host": "::1"}}).host, "::1")
        s = cfgmod.settings_from_mapping({"quick": {"max_tokens": 10**9, "first_byte_timeout": 50,
                                                    "total_timeout": 5}})
        self.assertEqual(s.max_tokens, 8192)
        self.assertEqual(s.total_timeout, 50)


class SecretTest(unittest.TestCase):
    def test_create_load_perms(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        p = d / "sub" / "secret"
        self.assertTrue(create_secret(p))
        self.assertFalse(create_secret(p))  # never overwrites
        self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
        tok = load_secret(p)
        self.assertGreaterEqual(len(tok), 32)
        os.chmod(p, 0o644)
        with self.assertRaises(PermissionError):
            load_secret(p)
        os.chmod(p, 0o640)
        self.assertEqual(load_secret(p), tok)
        p.write_text("short")
        os.chmod(p, 0o600)
        with self.assertRaises(ValueError):
            load_secret(p)

    def test_check(self):
        c = SecretCheck("a" * 40)
        self.assertTrue(c.check_header("Bearer " + "a" * 40))
        self.assertTrue(c.check_header("bearer " + "a" * 40))
        for bad in (None, "", "Bearer", "Bearer " + "a" * 39, "Basic " + "a" * 40, "a" * 40):
            self.assertFalse(c.check_header(bad), bad)


class PromptTest(unittest.TestCase):
    def test_budget(self):
        self.assertLessEqual(estimate_tokens(build_system_prompt("2026-10-12")), 800)
        self.assertTrue(build_system_prompt("2026-10-12").startswith(QUICK_SYSTEM_PROMPT))

    def test_examples_pass_app_validator(self):
        nodes = example_nodes()
        self.assertTrue(nodes)
        node = shutil.which("node")
        validator = REPO / "hermes-skill" / "examples" / "validate.mjs"
        if not node or not validator.exists():
            self.skipTest("node or validator not available")
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        md = d / "quick-prompt-examples.md"
        md.write_text("# Quick prompt examples\n\nNutzer: Frage\n\nAssistent:\n````markdown\n26,2 Meilen sind etwa 42,2 Kilometer; eine Meile entspricht 1,609344 km.\n\n"
                      + "\n\n".join(f"```hui\n{n}\n```" for n in nodes) + "\n````\n")
        res = subprocess.run([node, str(validator), str(md)], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout[-2000:] + res.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
