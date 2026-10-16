"""The ONLY module that imports Hermes code (ADR 0001 plugin rules: one aux-call adapter).

Hermes import used, lazily and per call (so a Hermes upgrade that moves it costs the quick feature, never
the plugin load or the chat):

    agent.auxiliary_client.call_llm(task=, provider=, model=, messages=, max_tokens=, timeout=,
                                    stream=, stream_options=, route_info=)

Hermes' no-network availability probe for the self-test (optional, see ``self_test``):

    agent.auxiliary_client.aux_probe_mode, get_text_auxiliary_client(task)

and, only on a gateway that multiplexes profiles (Hermes v0.22+), the profile scope around that call:

    agent.secret_scope: is_multiplex_active, current_secret_scope, build_profile_secret_scope,
                        set_secret_scope, reset_secret_scope
    hermes_constants: set_hermes_home_override, reset_hermes_home_override (optional)

A multiplexing gateway reads credentials only inside a profile scope and raises ``UnscopedSecretError``
outside one (fail closed, so one profile never sees another's keys). Agent turns get that scope from the
gateway; the plugin's listener thread has none, so every quick call runs in the scope of the plugin's own
Hermes home (the profile whose config enabled it). Once Hermes binds the registration context to the owning
profile (NousResearch/hermes-agent#139123), the listener thread and every quick worker inherit that scope
(``ListenerThread`` and ``QuickService.events`` run in copies of it) and ``profile_scope`` is a no-op.

If these private helpers change in a future Hermes, ``self_test`` reports the feature unavailable with a reason
(GET /quick/config) so the app hides the button instead of offering answers that fail with 502.

Why not the public ``PluginContext.llm`` facade: it has no streaming, and its provider/model overrides are
gated by ``plugins.entries.<id>.llm.allow_*_override``. ``call_llm`` is the function that facade calls
(agent/plugin_llm.py ``PluginLlm._invoke_sync``), with the same task-slot routing; ``stream=True`` returns
the raw provider chunk iterator. Hermes' recovery ladder (parameter/reasoning/credential retries,
fallback chain) only runs on the non-stream path, so a rejected stream request is retried once without
streaming.
"""

from __future__ import annotations

import contextlib
import logging
import threading
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

logger = logging.getLogger("hermes_ui_plus.adapter")


def hermes_call_llm() -> Callable[..., Any]:
    from agent.auxiliary_client import call_llm  # the model call

    return call_llm


def _scope_modules() -> tuple[Any, Any]:
    """Hermes' profile-scope helpers, (None, None) on a Hermes without profile multiplexing."""
    try:
        from agent import secret_scope  # profile-scoped credentials (Hermes v0.22+)
    except Exception:
        return None, None
    try:
        import hermes_constants  # HERMES_HOME override for the scoped call (optional)
    except Exception:
        hermes_constants = None
    return secret_scope, hermes_constants


_SCOPE_HELPERS = ("is_multiplex_active", "current_secret_scope", "build_profile_secret_scope", "set_secret_scope",
                  "reset_secret_scope")

# Machine-readable reasons the quick feature reports as unavailable (GET /quick/config "reason").
REASON_SCOPE = "profile_scope_unavailable"
REASON_NO_AUX = "hermes_aux_unavailable"


def _scope_state(ss: Any) -> str:
    """Where a quick call stands with Hermes' profile scope, before the plugin does anything:

    ``off``      no multiplexing (or a Hermes without profile scopes): credentials come from os.environ;
    ``host``     multiplexing, and the caller's context already carries a scope (a turn, or a Hermes that
                 binds the plugin's registration context to its profile, NousResearch/hermes-agent#139123);
    ``needed``   multiplexing and no scope: the plugin must enter its own profile's scope;
    ``unknown``  agent.secret_scope exists but cannot say whether it multiplexes (helpers renamed).
    """
    if ss is None:
        return "off"
    check = getattr(ss, "is_multiplex_active", None)
    try:
        multiplex = bool(check()) if callable(check) else None
    except Exception:
        multiplex = None
    if multiplex is False:
        return "off"
    current = getattr(ss, "current_secret_scope", None)
    try:
        if callable(current) and current() is not None:
            return "host"
    except Exception:
        pass
    return "needed" if multiplex else "unknown"


def scope_key() -> str:
    """Cheap fingerprint of the scope situation in the current context (self-test cache key: the gateway turns
    multiplexing on after the plugins are loaded, so a result from listener start goes stale when it flips)."""
    ss, _hc = _scope_modules()
    return _scope_state(ss)


@contextlib.contextmanager
def profile_scope(home: Optional[str]) -> Iterator[str]:
    """Run a quick call in the secret scope (and home) of ``home`` when the gateway multiplexes profiles.

    No-op when Hermes has no multiplexing, it is off, a scope is already installed (the caller runs inside a
    turn, or Hermes bound the registration context to the plugin's profile), or the state is unknown. Builds
    the scope from ``<home>/.env`` like the gateway does for a turn of that profile; the values never leave the
    contextvar and are never logged.

    Yields the state: ``off`` / ``host`` / ``unknown`` (nothing done), ``entered``, or ``failed`` (a scope was
    needed but could not be entered: helpers missing, unknown home, or building it raised). On ``failed`` the
    call still runs and fails the way Hermes fails it (``UnscopedSecretError``); ``self_test`` turns that into a
    clean "unavailable".
    """
    ss, hc = _scope_modules()
    state = _scope_state(ss)
    home_token = secret_token = None
    if state == "needed":
        if not home or not all(callable(getattr(ss, n, None)) for n in _SCOPE_HELPERS):
            state = "failed"
            logger.warning("quick: this Hermes multiplexes profiles but the profile-scope helpers are missing")
        else:
            try:
                if hc is not None and hasattr(hc, "set_hermes_home_override") and hasattr(
                        hc, "reset_hermes_home_override"):
                    home_token = hc.set_hermes_home_override(str(home))
                secret_token = ss.set_secret_scope(ss.build_profile_secret_scope(Path(home)), profile_home=str(home))
                state = "entered"
            except Exception as exc:  # scope could not be built: the call fails as before, with the same error
                state = "failed"
                logger.warning("quick: could not enter the profile scope (%s)", type(exc).__name__)
    try:
        yield state
    finally:
        for reset, token in ((getattr(ss, "reset_secret_scope", None), secret_token),
                             (getattr(hc, "reset_hermes_home_override", None), home_token)):
            if token is not None and reset is not None:
                try:
                    reset(token)
                except Exception:  # a token from another context: nothing of ours left to undo
                    pass


def is_unscoped_error(exc: BaseException) -> bool:
    """Hermes' ``UnscopedSecretError`` (by name: the class lives in Hermes), also as the cause of a wrapper."""
    seen = 0
    cur: Optional[BaseException] = exc
    while cur is not None and seen < 8:
        if any(t.__name__ == "UnscopedSecretError" for t in type(cur).__mro__):
            return True
        cur = cur.__cause__ or cur.__context__
        seen += 1
    return False


def _aux_resolver() -> Optional[Callable[[str], Any]]:
    """Hermes' availability probe for an aux task: resolves provider, credentials and base URL without building
    an SDK client, without a network call and without touching Hermes' client cache. None on a Hermes without it."""
    try:
        from agent.auxiliary_client import aux_probe_mode, get_text_auxiliary_client  # credential check, no model call
    except Exception:
        return None

    def resolve(task: str) -> Any:
        with aux_probe_mode():
            client, _model = get_text_auxiliary_client(task)
        return client

    return resolve


def self_test(task: str, home: Optional[str], *, aux: Callable[[], Any] = hermes_call_llm) -> Optional[str]:
    """Can a quick call get credentials in the scope it will run in? None = yes (or cannot be disproved), else a
    machine-readable reason. Runs where the quick worker runs (same context), no network, logs no values.

    Evidence rules: an ``UnscopedSecretError`` while resolving the aux route is proof; when a needed scope could
    not be entered, the aux route must resolve positively (a provider without credentials, e.g. a local server,
    still works). Anything else inconclusive keeps the feature on: a real call that then fails with
    ``UnscopedSecretError`` switches it off at once (``failure_reason``).
    """
    try:
        aux()
    except Exception:
        return REASON_NO_AUX
    with profile_scope(home) as state:
        resolve = _aux_resolver()
        if resolve is None:
            return REASON_SCOPE if state == "failed" else None
        try:
            client = resolve(task)
        except Exception as exc:
            if is_unscoped_error(exc):
                return REASON_SCOPE
            logger.info("quick: self-test inconclusive (%s)", type(exc).__name__)
            return REASON_SCOPE if state == "failed" else None
        if client is None:
            if state == "failed":
                return REASON_SCOPE
            logger.info("quick: the %s aux route did not resolve to a provider with credentials", task)
        return None


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _usage(obj: Any) -> Optional[dict]:
    u = _get(obj, "usage")
    if u is None:
        return None
    p, c = _get(u, "prompt_tokens"), _get(u, "completion_tokens")
    if p is None:
        p = _get(u, "input_tokens")
    if c is None:
        c = _get(u, "output_tokens")
    if isinstance(p, int) and isinstance(c, int):
        return {"prompt_tokens": p, "completion_tokens": c}
    return None


def _first_choice(obj: Any) -> Any:
    choices = _get(obj, "choices") or []
    return choices[0] if choices else None


def _is_complete_response(obj: Any) -> bool:
    """A finished ChatCompletion (some Hermes client adapters ignore stream=True and return one)."""
    ch = _first_choice(obj)
    return ch is not None and _get(ch, "message") is not None


def _single_events(resp: Any) -> Iterator[tuple[str, Any]]:
    ch = _first_choice(resp)
    msg = _get(ch, "message")
    text = _get(msg, "content") or ""
    if isinstance(text, list):  # content parts
        text = "".join(str(_get(p, "text") or "") for p in text)
    model = _get(resp, "model")
    if model:
        yield "route", {"model": str(model)}
    if text:
        yield "delta", str(text)
    yield "finish", _get(ch, "finish_reason") or "stop"
    u = _usage(resp)
    if u:
        yield "usage", u


def _close(obj: Any) -> None:
    close = getattr(obj, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


class HermesAuxBackend:
    """Quick-answer backend: Hermes' auxiliary LLM client under the plugin's own slot ``auxiliary.<task>``."""

    def __init__(self, task: str, call_llm: Optional[Callable[..., Any]] = None, home: Optional[str] = None):
        self.task = task
        self._call_llm = call_llm
        self.home = home  # Hermes home of the profile that loaded the plugin (its secret scope, see profile_scope)

    def available(self) -> bool:
        try:
            self._caller()
            return True
        except Exception:
            return False

    def self_test(self) -> Optional[str]:
        """None = quick calls can get credentials here, else a reason (see ``self_test``). Blocking, cheap."""
        return self_test(self.task, self.home, aux=self._caller)

    @staticmethod
    def scope_key() -> str:
        return scope_key()

    @staticmethod
    def failure_reason(exc: BaseException) -> Optional[str]:
        """Reason to switch the feature off after a failed call (only for failures no retry can fix)."""
        return REASON_SCOPE if is_unscoped_error(exc) else None

    def _caller(self) -> Callable[..., Any]:
        if self._call_llm is None:
            self._call_llm = hermes_call_llm()
        return self._call_llm

    def stream(self, *, messages: list[dict], provider: Optional[str], model: Optional[str], max_tokens: int,
               timeout: float, cancel: threading.Event) -> Iterator[tuple[str, Any]]:
        """Events of one quick call. Iterate it to the end or close() it in the SAME thread (the profile scope
        is a contextvar that is reset when the generator finishes)."""
        with profile_scope(self.home):  # a no-op when the host already bound a scope (see QuickService.events)
            yield from self._stream(messages=messages, provider=provider, model=model, max_tokens=max_tokens,
                                    timeout=timeout, cancel=cancel)

    def _stream(self, *, messages: list[dict], provider: Optional[str], model: Optional[str], max_tokens: int,
                timeout: float, cancel: threading.Event) -> Iterator[tuple[str, Any]]:
        call = self._caller()
        route: dict[str, str] = {}
        kw = dict(task=self.task, provider=provider, model=model, messages=messages, max_tokens=max_tokens,
                  timeout=timeout, route_info=route)
        try:
            resp = call(**kw, stream=True, stream_options={"include_usage": True})
        except Exception as exc:
            logger.info("quick: streaming call failed (%s), retrying without streaming", type(exc).__name__)
            resp = None
        if resp is None or _is_complete_response(resp):
            if resp is None:
                if cancel.is_set():
                    return
                resp = call(**kw)
            yield "mode", "single"
            if route:
                yield "route", dict(route)
            yield from _single_events(resp)
            return
        yield "mode", "stream"
        if route:
            yield "route", dict(route)
        got_text = False
        model_seen = False
        it = iter(resp)
        try:
            while not cancel.is_set():
                try:
                    ch = next(it)
                except StopIteration:
                    break
                except Exception as exc:
                    if got_text:
                        raise
                    logger.info("quick: stream broke before content (%s), retrying without streaming",
                                type(exc).__name__)
                    _close(it)
                    if cancel.is_set():
                        return
                    yield "mode", "single"
                    yield from _single_events(call(**kw))
                    return
                if not model_seen and _get(ch, "model"):
                    model_seen = True
                    yield "route", {"model": str(_get(ch, "model"))}
                u = _usage(ch)
                if u:
                    yield "usage", u
                choice = _first_choice(ch)
                if choice is None:
                    continue
                text = _get(_get(choice, "delta"), "content")
                if text:  # reasoning deltas (reasoning_content / reasoning) are deliberately dropped
                    got_text = True
                    yield "delta", str(text)
                finish = _get(choice, "finish_reason")
                if finish:
                    yield "finish", str(finish)
        finally:
            _close(it)
            _close(resp)
