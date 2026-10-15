"""The ONLY module that imports Hermes code (ADR 0001 plugin rules: one aux-call adapter).

Hermes import used, lazily and per call (so a Hermes upgrade that moves it costs the quick feature, never
the plugin load or the chat):

    agent.auxiliary_client.call_llm(task=, provider=, model=, messages=, max_tokens=, timeout=,
                                    stream=, stream_options=, route_info=)

Why not the public ``PluginContext.llm`` facade: it has no streaming, and its provider/model overrides are
gated by ``plugins.entries.<id>.llm.allow_*_override``. ``call_llm`` is the function that facade calls
(agent/plugin_llm.py ``PluginLlm._invoke_sync``), with the same task-slot routing; ``stream=True`` returns
the raw provider chunk iterator. Hermes' recovery ladder (parameter/reasoning/credential retries,
fallback chain) only runs on the non-stream path, so a rejected stream request is retried once without
streaming.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Iterator, Optional

logger = logging.getLogger("hermes_ui_plus.adapter")


def hermes_call_llm() -> Callable[..., Any]:
    from agent.auxiliary_client import call_llm  # the single Hermes-internal import of this plugin

    return call_llm


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

    def __init__(self, task: str, call_llm: Optional[Callable[..., Any]] = None):
        self.task = task
        self._call_llm = call_llm

    def available(self) -> bool:
        try:
            self._caller()
            return True
        except Exception:
            return False

    def _caller(self) -> Callable[..., Any]:
        if self._call_llm is None:
            self._call_llm = hermes_call_llm()
        return self._call_llm

    def stream(self, *, messages: list[dict], provider: Optional[str], model: Optional[str], max_tokens: int,
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
