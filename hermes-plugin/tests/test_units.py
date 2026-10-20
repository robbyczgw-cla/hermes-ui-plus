import asyncio
import contextvars
import logging
import os
import shutil
import socket
import stat
import subprocess
import sys
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

    def _fake_hermes(self, multiplex=True, preset=None, aux=False):
        """Fake agent.secret_scope + hermes_constants with real contextvars (like Hermes v0.22). ``aux``: also a
        fake agent.auxiliary_client with call_llm and the no-network probe (aux_probe_mode +
        get_text_auxiliary_client, which reads the provider key through get_secret like Hermes does)."""
        import contextvars
        import sys
        import types
        scope = contextvars.ContextVar("scope", default=preset)
        home = contextvars.ContextVar("home", default=None)
        built = []

        class UnscopedSecretError(RuntimeError):
            pass

        ss = types.ModuleType("agent.secret_scope")
        ss.is_multiplex_active = lambda: multiplex
        ss.current_secret_scope = lambda: scope.get()
        ss.build_profile_secret_scope = lambda h: built.append(str(h)) or {"ANTHROPIC_API_KEY": "fake-key-for-" + h.name}
        ss.set_secret_scope = lambda m, profile_home=None: scope.set(m)
        ss.reset_secret_scope = lambda t: scope.reset(t)

        def get_secret(name):
            m = scope.get()
            if m is None and multiplex:
                raise UnscopedSecretError(name)
            return (m or {}).get(name)
        ss.get_secret = get_secret
        hc = types.ModuleType("hermes_constants")
        hc.set_hermes_home_override = lambda p: home.set(p)
        hc.reset_hermes_home_override = lambda t: home.reset(t)
        agent = types.ModuleType("agent")
        agent.secret_scope = ss
        mods = {"agent": agent, "agent.secret_scope": ss, "hermes_constants": hc}
        probes = []
        if aux:
            import contextlib
            ac = types.ModuleType("agent.auxiliary_client")
            probe_on = threading.local()

            @contextlib.contextmanager
            def aux_probe_mode():
                probe_on.active = True
                try:
                    yield
                finally:
                    probe_on.active = False

            def get_text_auxiliary_client(task=""):
                key = get_secret("ANTHROPIC_API_KEY") if multiplex else "env-key"
                probes.append((task, key, getattr(probe_on, "active", False)))
                return ("stub-client", "m-fast") if key else (None, None)

            ac.aux_probe_mode = aux_probe_mode
            ac.get_text_auxiliary_client = get_text_auxiliary_client
            ac.call_llm = lambda **kw: iter([])
            agent.auxiliary_client = ac
            mods["agent.auxiliary_client"] = ac
        patcher = mock.patch.dict(sys.modules, mods)
        patcher.start()
        self.addCleanup(patcher.stop)
        return NS(ss=ss, scope=scope, home=home, built=built, probes=probes, Unscoped=UnscopedSecretError)

    def test_multiplexed_gateway_call_runs_in_plugin_profile_scope(self):
        # Hermes v0.22 multiplexing: credentials only inside a profile scope (live: UnscopedSecretError -> 502)
        h = self._fake_hermes(multiplex=True)
        seen = []

        def call_llm(**kw):
            seen.append((h.ss.get_secret("ANTHROPIC_API_KEY"), h.home.get()))
            return iter([chunk("ok", finish="stop")])

        ev = collect(HermesAuxBackend("hui_quick", call_llm, home="/data/home"))
        self.assertEqual([v for k, v in ev if k == "delta"], ["ok"])
        self.assertEqual(seen, [("fake-key-for-home", "/data/home")])
        self.assertEqual(h.built, ["/data/home"])
        self.assertIsNone(h.scope.get())  # reset after the call
        self.assertIsNone(h.home.get())

    def test_scope_reset_when_the_consumer_stops_early(self):
        h = self._fake_hermes(multiplex=True)
        gen = HermesAuxBackend("t", lambda **kw: iter([chunk("a"), chunk("b")]), home="/h").stream(
            messages=[], provider=None, model=None, max_tokens=5, timeout=5, cancel=threading.Event())
        self.assertEqual(next(gen), ("mode", "stream"))
        self.assertIsNotNone(h.scope.get())
        gen.close()
        self.assertIsNone(h.scope.get())

    def test_no_scope_without_multiplexing_or_inside_a_turn(self):
        for multiplex, preset in ((False, None), (True, {"ANTHROPIC_API_KEY": "turn"})):
            h = self._fake_hermes(multiplex=multiplex, preset=preset)
            keys = []

            def call_llm(**kw):
                keys.append(h.scope.get())
                return iter([chunk("ok", finish="stop")])

            collect(HermesAuxBackend("t", call_llm, home="/h"))
            self.assertEqual(h.built, [])
            self.assertEqual(keys, [preset])

    def test_scope_build_error_keeps_the_original_failure(self):
        h = self._fake_hermes(multiplex=True)
        h.ss.build_profile_secret_scope = mock.Mock(side_effect=OSError("unreadable"))

        def call_llm(**kw):
            h.ss.get_secret("ANTHROPIC_API_KEY")  # raises like Hermes without a scope
            return iter([])

        with self.assertLogs("hermes_ui_plus.adapter", "WARNING"):
            with self.assertRaises(RuntimeError):
                collect(HermesAuxBackend("t", call_llm, home="/h"))

    # -- self-test: GET /quick/config reports available:false + reason instead of a button that 502s --

    def test_self_test_without_multiplexing_is_a_noop(self):
        h = self._fake_hermes(multiplex=False, aux=True)
        self.assertIsNone(HermesAuxBackend("hui_quick", home="/h").self_test())
        self.assertEqual(h.built, [])
        self.assertEqual(h.probes, [("hui_quick", "env-key", True)])  # resolved in probe mode, no model call

    def test_self_test_enters_the_profile_scope(self):
        h = self._fake_hermes(multiplex=True, aux=True)
        self.assertIsNone(HermesAuxBackend("hui_quick", home="/data/home").self_test())
        self.assertEqual(h.built, ["/data/home"])
        self.assertEqual(h.probes, [("hui_quick", "fake-key-for-home", True)])
        self.assertIsNone(h.scope.get())  # nothing left installed
        self.assertIsNone(h.home.get())

    def test_self_test_uses_a_scope_the_host_already_bound(self):
        # the upstream-fixed case (NousResearch/hermes-agent#139123): Hermes binds the owning profile's scope
        h = self._fake_hermes(multiplex=True, aux=True)
        token = h.scope.set({"ANTHROPIC_API_KEY": "host-bound"})
        self.addCleanup(h.scope.reset, token)
        self.assertEqual(HermesAuxBackend.scope_key(), "host")
        self.assertIsNone(HermesAuxBackend("hui_quick", home="/h").self_test())
        self.assertEqual(h.built, [])
        self.assertEqual(h.probes, [("hui_quick", "host-bound", True)])

    def test_self_test_helpers_missing_is_unavailable(self):
        # a future Hermes renames the private helpers: no button that fails every call with 502
        h = self._fake_hermes(multiplex=True, aux=True)
        del h.ss.build_profile_secret_scope
        with self.assertLogs("hermes_ui_plus.adapter", "WARNING"):
            self.assertEqual(HermesAuxBackend("hui_quick", home="/h").self_test(), "profile_scope_unavailable")
        # is_multiplex_active gone too: the state is unknown, the credential probe decides
        del h.ss.is_multiplex_active
        self.assertEqual(HermesAuxBackend.scope_key(), "unknown")
        self.assertEqual(HermesAuxBackend("hui_quick", home="/h").self_test(), "profile_scope_unavailable")

    def test_self_test_helpers_missing_without_the_probe_api(self):
        h = self._fake_hermes(multiplex=True, aux=True)
        del h.ss.set_secret_scope
        del sys.modules["agent.auxiliary_client"].aux_probe_mode
        with self.assertLogs("hermes_ui_plus.adapter", "WARNING"):
            self.assertEqual(HermesAuxBackend("hui_quick", home="/h").self_test(), "profile_scope_unavailable")

    def test_self_test_scope_build_raising_is_unavailable(self):
        h = self._fake_hermes(multiplex=True, aux=True)
        h.ss.build_profile_secret_scope = mock.Mock(side_effect=OSError("unreadable"))
        with self.assertLogs("hermes_ui_plus.adapter", "WARNING") as cm:
            self.assertEqual(HermesAuxBackend("hui_quick", home="/h").self_test(), "profile_scope_unavailable")
        self.assertNotIn("unreadable", "\n".join(cm.output))  # type name only
        self.assertIsNone(h.scope.get())

    def test_self_test_credential_free_provider_survives_a_failed_scope(self):
        # e.g. a local llama.cpp aux route: no secret needed, so a failed scope must not hide the button
        h = self._fake_hermes(multiplex=True, aux=True)
        h.ss.build_profile_secret_scope = mock.Mock(side_effect=OSError("unreadable"))
        sys.modules["agent.auxiliary_client"].get_text_auxiliary_client = lambda task="": ("local", "m")
        with self.assertLogs("hermes_ui_plus.adapter", "WARNING"):
            self.assertIsNone(HermesAuxBackend("hui_quick", home="/h").self_test())

    def test_self_test_without_hermes_aux_client(self):
        self.assertEqual(HermesAuxBackend("hui_quick", home="/h").self_test(), "hermes_aux_unavailable")

    def test_failure_reason_only_for_unscoped_errors(self):
        h = self._fake_hermes(multiplex=True)
        self.assertEqual(HermesAuxBackend.failure_reason(h.Unscoped("X")), "profile_scope_unavailable")
        try:
            try:
                raise h.Unscoped("X")
            except RuntimeError as inner:
                raise ValueError("wrapped") from inner
        except ValueError as wrapped:
            self.assertEqual(HermesAuxBackend.failure_reason(wrapped), "profile_scope_unavailable")
        self.assertIsNone(HermesAuxBackend.failure_reason(TimeoutError()))

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
        self.assertTrue(all(o.startswith("hermes_adapter.py: ") for o in offenders), offenders)  # the only module
        # the library source (HermesLibrary) imports tools.* / hermes_cli.* lazily, per call
        offenders = [o for o in offenders if not o.split(": ", 1)[1].startswith(("from tools", "from hermes_cli"))]
        self.assertEqual(sorted(offenders), [
            "hermes_adapter.py: from agent import secret_scope  # profile-scoped credentials (Hermes v0.22+)",
            "hermes_adapter.py: from agent.auxiliary_client import aux_probe_mode, get_text_auxiliary_client  "
            "# credential check, no model call",
            "hermes_adapter.py: from agent.auxiliary_client import call_llm  # the model call",
            "hermes_adapter.py: import hermes_constants  # HERMES_HOME override for the scoped call (optional)",
        ])

    def test_stdlib_only(self):
        import sys
        pkg = REPO / "hermes-plugin" / "hermes_ui_plus"
        std = set(sys.stdlib_module_names) | {"__future__"}
        for f in pkg.glob("*.py"):
            for line in f.read_text().splitlines():
                s = line.strip()
                if s.startswith("import ") or (s.startswith("from ") and " import " in s):
                    mod = s.split()[1]
                    if mod.startswith(".") or mod.split(".")[0] in ("agent", "hermes_constants", "tools",
                                                                  "hermes_cli"):  # Hermes, adapter only
                        continue
                    if f.name == "hermes_adapter.py" and mod in ("yaml", "hermes_yaml"):  # Hermes' YAML (HermesBots)
                        continue
                    self.assertIn(mod.split(".")[0], std, f"{f.name}: {s}")


class ServiceContextTest(unittest.TestCase):
    """QuickService: the executor hop keeps the caller's contextvars; the self-test result is cached."""

    def _service(self, backend, clock=None):
        from hermes_ui_plus.config import settings_from_mapping
        from hermes_ui_plus.quick import QuickService
        svc = QuickService(settings_from_mapping({}), backend, today=lambda: "2026-01-02",
                           **({"clock": clock} if clock else {}))
        self.addCleanup(svc.close)
        return svc

    @staticmethod
    def _ask(svc, before=None):
        from hermes_ui_plus.quick import QuickRequest

        async def main():
            if before:
                before()
            req = QuickRequest(messages=[{"role": "user", "content": "q"}], stream=True, max_tokens=5,
                               provider=None, model=None)
            return [e async for e in svc.events(req, None, None, threading.Event())]
        return asyncio.run(main())

    def test_worker_runs_in_a_copy_of_the_callers_context(self):
        cv = contextvars.ContextVar("bound", default="unbound")
        seen = []

        class Backend:
            def stream(self, **kw):
                seen.append((cv.get(), threading.current_thread().name))
                yield "delta", "ok"

        self._ask(self._service(Backend()), before=lambda: cv.set("bound-by-host"))
        self.assertEqual(seen[0][0], "bound-by-host")
        self.assertTrue(seen[0][1].startswith("hui-quick"))  # still the worker pool, not the loop thread

    def test_host_bound_scope_makes_profile_scope_a_noop(self):
        # end to end with the real adapter: Hermes binds the registration scope (#139123) -> the worker inherits it
        h = AdapterTest._fake_hermes(self, multiplex=True)
        keys = []

        def call_llm(**kw):
            keys.append(h.ss.get_secret("ANTHROPIC_API_KEY"))
            return iter([chunk("ok", finish="stop")])

        ev = self._ask(self._service(HermesAuxBackend("hui_quick", call_llm, home="/h")),
                       before=lambda: h.scope.set({"ANTHROPIC_API_KEY": "host-key"}))
        self.assertIn(("delta", "ok"), ev)
        self.assertEqual(keys, ["host-key"])
        self.assertEqual(h.built, [])  # no scope of our own

    def test_availability_cached_and_rechecked(self):
        now = [0.0]
        state = {"key": "off", "reason": None}
        calls = []

        class Backend:
            def stream(self, **kw):
                yield "delta", "ok"

            def self_test(self):
                calls.append(threading.current_thread().name)
                return state["reason"]

            def scope_key(self):
                return state["key"]

        svc = self._service(Backend(), clock=lambda: now[0])
        run = lambda: asyncio.run(svc.availability())  # noqa: E731
        self.assertIsNone(run())
        self.assertIsNone(run())
        self.assertEqual(len(calls), 1, "cached")
        self.assertTrue(calls[0].startswith("hui-quick"))
        state.update(key="needed", reason="profile_scope_unavailable")  # the gateway turned multiplexing on
        self.assertEqual(run(), "profile_scope_unavailable")
        self.assertEqual(len(calls), 2, "a changed scope situation re-checks at once")
        cfg = asyncio.run(svc.config_payload())
        self.assertEqual((cfg["enabled"], cfg["available"], cfg["reason"], cfg["scope"]),
                         (False, False, "profile_scope_unavailable", "needed"))
        state["reason"] = None
        now[0] += 30
        self.assertEqual(run(), "profile_scope_unavailable")
        now[0] += 31  # failures are re-checked after a minute
        self.assertIsNone(run())
        self.assertEqual(len(calls), 3)

    def test_unscoped_failure_switches_the_feature_off(self):
        class Unscoped(RuntimeError):
            pass
        Unscoped.__name__ = "UnscopedSecretError"

        class Backend:
            def stream(self, **kw):
                raise Unscoped("X")
                yield  # pragma: no cover

            def self_test(self):
                return None

            failure_reason = staticmethod(HermesAuxBackend.failure_reason)

        from hermes_ui_plus.quick import QuickError
        svc = self._service(Backend())
        self.assertIsNone(asyncio.run(svc.availability()))
        with self.assertLogs("hermes_ui_plus.quick", "WARNING"):
            with self.assertRaises(QuickError) as cm:
                self._ask(svc)
        self.assertEqual(cm.exception.status, 502)
        self.assertEqual(asyncio.run(svc.availability()), "profile_scope_unavailable")

    def test_quick_disabled_reports_disabled(self):
        from hermes_ui_plus.config import settings_from_mapping
        from hermes_ui_plus.quick import QuickService
        svc = QuickService(settings_from_mapping({"quick": {"enabled": False}}), object())
        self.addCleanup(svc.close)
        cfg = asyncio.run(svc.config_payload())
        self.assertEqual((cfg["enabled"], cfg["available"], cfg["reason"]), (False, False, "disabled"))


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
        # second process/registration: port taken -> passive, no error; it still gets an unload hook (it retries)
        ctx2 = FakeCtx({"server": {"port": port}})
        hermes_ui_plus.register(ctx2)
        self.assertEqual(len(ctx2.unload), 1)
        ctx2.unload[0]()  # a stopped passive listener never takes the port
        ctx.unload[0]()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=1).close()

    def test_passive_listener_takes_over_when_the_owner_exits(self):
        # live (two-profile container): `hermes -p writer gateway run` won the bind and exited; the default
        # gateway stayed passive and quick answers were dead until the next restart
        from hermes_ui_plus import runner
        from helpers import FakeBackend, wait_for
        create_secret(self.home / "hermes-ui-plus" / "secret")
        port = free_port()
        squatter = socket.socket()
        squatter.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        squatter.bind(("127.0.0.1", port))
        squatter.listen()
        with mock.patch.object(runner, "BIND_RETRY_S", 0.05):
            listener = runner.ListenerThread(
                lambda: hermes_ui_plus.quick.QuickService(cfgmod.settings_from_mapping({}), FakeBackend()),
                "s" * 40, host="127.0.0.1", port=port)
            self.addCleanup(listener.stop)
            self.assertFalse(listener.start(wait=2))  # passive, start() does not block
            self.assertEqual(listener.error, "port in use")
            squatter.close()  # the short-lived process exits
            self.assertTrue(wait_for(lambda: listener.bound, 3))
        with socket.create_connection(("127.0.0.1", port), timeout=2) as s:
            s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertIn(b"200 OK", s.recv(200))
        self.assertIsNone(listener.error)

    def test_stop_ends_a_passive_listener(self):
        from hermes_ui_plus import runner
        port = free_port()
        squatter = socket.socket()
        squatter.bind(("127.0.0.1", port))
        squatter.listen()
        self.addCleanup(squatter.close)
        listener = runner.ListenerThread(
            lambda: hermes_ui_plus.quick.QuickService(cfgmod.settings_from_mapping({}), object()),
            "s" * 40, host="127.0.0.1", port=port)
        self.assertFalse(listener.start(wait=2))
        listener.stop(wait=2)
        self.assertFalse(listener._thread.is_alive())

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

    def test_reply_language_follows_the_user(self):
        # live (Hermes v0.22 + Claude Haiku): with a German example, 2 of 3 English questions got German answers
        self.assertIn("language of the user's latest message", QUICK_SYSTEM_PROMPT)
        self.assertNotRegex(QUICK_SYSTEM_PROMPT, r"Meilen|sind etwa|[äöüß]")

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
        md.write_text("# Quick prompt examples\n\nUser: question\n\nAssistant:\n````markdown\n26.2 miles is about 42.2 kilometres; one mile is 1.609344 km.\n\n"
                      + "\n\n".join(f"```hui\n{n}\n```" for n in nodes) + "\n````\n")
        res = subprocess.run([node, str(validator), str(md)], capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout[-2000:] + res.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
