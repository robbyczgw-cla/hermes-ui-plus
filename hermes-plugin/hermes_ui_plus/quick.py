"""Quick answers: one-off questions answered by a fast model WITHOUT the Hermes agent (no tools, no memory,
no session, tiny prompt).

Pure module (no Hermes imports). The model call goes through an injected *backend* (``hermes_adapter.HermesAuxBackend``
in production: Hermes' auxiliary LLM client), so tests run without Hermes. Provider/model overrides are
checked against the operator allow-list ``quick.allowed_models``; the UI Bridge additionally validates them
against Hermes' public ``GET /api/model/options`` before forwarding.

Privacy: nothing here logs or echoes message content, provider error text or the secret. Log lines carry
status, timings, provider/model and token counts only.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Iterator, Optional, Protocol

from .config import MAX_CHARS_PER_TURN, MAX_TURNS, Settings
from .prompt import build_system_prompt, estimate_tokens

logger = logging.getLogger("hermes_ui_plus.quick")

# Model names OpenAI-compatible clients send by habit; they mean "the configured default".
DEFAULT_MODEL_ALIASES = frozenset({"", "auto", "default", "quick", "hui-quick", "hermes-agent", "hermes"})
_MAX_ID_LEN = 200


class QuickError(Exception):
    """Client-facing error. ``message`` must never contain request content or provider error text."""

    def __init__(self, status: int, code: str, message: str, *, retry_after: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after

    def body(self) -> dict:
        kind = "invalid_request_error" if self.status in (400, 401, 404, 413) else (
            "rate_limit_error" if self.status == 429 else "server_error")
        return {"error": {"message": self.message, "type": kind, "code": self.code}}


@dataclass
class QuickRequest:
    messages: list[dict[str, str]]
    stream: bool
    max_tokens: int
    provider: Optional[str]
    model: Optional[str]


# --- backend contract -----------------------------------------------------------------------------


class Backend(Protocol):
    def stream(self, *, messages: list[dict], provider: Optional[str], model: Optional[str], max_tokens: int,
               timeout: float, cancel: threading.Event) -> Iterator[tuple[str, Any]]:
        """Blocking iterator of events: ("delta", str), ("finish", reason), ("usage", {prompt_tokens,
        completion_tokens}), ("route", {provider, model}), ("mode", "stream"|"single"). Runs in a worker
        thread; must stop soon after *cancel* is set."""


# --- request parsing ---------------------------------------------------------------------------------------


def _text_of(content: Any, idx: int) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text" or not isinstance(part.get("text"), str):
                raise QuickError(400, "unsupported_content", f"messages[{idx}]: only text content is supported")
            parts.append(part["text"])
        return "\n".join(parts)
    raise QuickError(400, "invalid_messages", f"messages[{idx}].content must be a string or text parts")


def _opt_id(body: dict, key: str) -> Optional[str]:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > _MAX_ID_LEN or any(c in value for c in "\r\n\x00"):
        raise QuickError(400, f"invalid_{key}", f"{key} must be a short string")
    value = value.strip()
    return value or None


def parse_request(body: Any, settings: Settings) -> QuickRequest:
    """Validate an OpenAI-style chat-completions body. Client system/developer messages, tools and sampling
    parameters are ignored (server-pinned prompt and parameters)."""
    if not isinstance(body, dict):
        raise QuickError(400, "invalid_body", "body must be a JSON object")
    raw = body.get("messages")
    if not isinstance(raw, list) or not raw:
        raise QuickError(400, "invalid_messages", "messages must be a non-empty array")
    messages: list[dict[str, str]] = []
    for idx, m in enumerate(raw):
        if not isinstance(m, dict):
            raise QuickError(400, "invalid_messages", f"messages[{idx}] must be an object")
        role = m.get("role")
        if role in ("system", "developer"):
            continue
        if role not in ("user", "assistant"):
            raise QuickError(400, "invalid_messages", f"messages[{idx}].role must be user or assistant")
        text = _text_of(m.get("content"), idx)
        if len(text) > MAX_CHARS_PER_TURN:
            raise QuickError(400, "message_too_long", f"messages[{idx}] exceeds {MAX_CHARS_PER_TURN} characters")
        if text.strip():
            messages.append({"role": role, "content": text})
    if not messages:
        raise QuickError(400, "invalid_messages", "messages contain no text")
    if len(messages) > MAX_TURNS:
        raise QuickError(400, "too_many_turns", f"at most {MAX_TURNS} user/assistant messages")
    if messages[-1]["role"] != "user":
        raise QuickError(400, "invalid_messages", "the last message must be from the user")
    stream = body.get("stream", False)
    if not isinstance(stream, bool):
        raise QuickError(400, "invalid_stream", "stream must be a boolean")
    cap = settings.max_tokens
    requested = body.get("max_completion_tokens", body.get("max_tokens"))
    if requested is None:
        max_tokens = cap
    elif isinstance(requested, bool) or not isinstance(requested, int) or requested < 1:
        raise QuickError(400, "invalid_max_tokens", "max_tokens must be a positive integer")
    else:
        max_tokens = min(requested, cap)
    model = _opt_id(body, "model")
    if model is not None and model.lower() in DEFAULT_MODEL_ALIASES:
        model = None
    provider = _opt_id(body, "provider")
    if provider is not None and provider.lower() == "auto":
        provider = None
    return QuickRequest(messages=messages, stream=stream, max_tokens=max_tokens,
                        provider=provider.lower() if provider else None, model=model)


# --- service ------------------------------------------------------------------------------------------------


class QuickService:
    """Validates overrides, enforces concurrency/timeouts and turns the backend's blocking event iterator into
    an async one."""

    def __init__(self, settings: Settings, backend: Backend, *, task: str = "hui_quick",
                 inherit_from: Optional[str] = "title_generation",
                 today: Callable[[], str] = lambda: _dt.date.today().isoformat(),
                 clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self.backend = backend
        self.task = task
        self.inherit_from = inherit_from
        self.last_route: dict[str, str] = {}
        self._today = today
        self._clock = clock
        self._inflight = 0
        self._executor = ThreadPoolExecutor(max_workers=settings.max_concurrency,
                                            thread_name_prefix="hui-quick")

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # -- config --

    async def config_payload(self) -> dict:
        s = self.settings
        return {
            "enabled": s.quick_enabled,
            "aux_task": self.task,
            "inherits_from": self.inherit_from,
            # Hermes resolves the default route per call (auxiliary.<task>, else the inherited slot, else the
            # main model); this is the route of the last answered request ({} until the first one).
            "last_route": dict(self.last_route),
            "allow_model_override": s.allow_model_override,
            "allowed_models": list(s.allowed_models),
            "streaming": True,
            "limits": {
                "max_tokens": s.max_tokens, "max_turns": MAX_TURNS, "max_chars_per_turn": MAX_CHARS_PER_TURN,
                "max_body_bytes": 64 * 1024, "max_concurrency": s.max_concurrency,
                "first_byte_timeout_s": s.first_byte_timeout, "total_timeout_s": s.total_timeout,
            },
            "prompt_tokens_estimate": estimate_tokens(build_system_prompt()),
        }

    async def resolve_route(self, req: QuickRequest) -> tuple[Optional[str], Optional[str]]:
        """Check provider/model overrides against ``quick.allowed_models``. (None, None) = slot default."""
        if req.provider is None and req.model is None:
            return None, None
        if not self.settings.allow_model_override:
            raise QuickError(400, "override_disabled", "model/provider overrides are disabled on this server")
        if req.model is not None and req.provider is None:
            raise QuickError(400, "provider_required", "a model override needs its provider")
        allowed = self.settings.allowed_models
        if allowed:
            prov = (req.provider or "").lower()
            mod = (req.model or "").lower()
            ok = any(entry in (f"{prov}:{mod}", f"{prov}:*") or (not mod and entry.split(":", 1)[0] == prov)
                     for entry in allowed)
            if not ok:
                raise QuickError(400, "unknown_model", "model is not allowed for quick answers")
        return req.provider, req.model

    # -- concurrency --

    def try_acquire(self) -> bool:
        if self._inflight >= self.settings.max_concurrency:
            return False
        self._inflight += 1
        return True

    def release(self) -> None:
        self._inflight = max(0, self._inflight - 1)

    @property
    def inflight(self) -> int:
        return self._inflight

    # -- the call --

    def build_messages(self, req: QuickRequest) -> list[dict[str, str]]:
        return [{"role": "system", "content": build_system_prompt(self._today())}, *req.messages]

    async def events(self, req: QuickRequest, provider: Optional[str], model: Optional[str],
                     cancel: threading.Event) -> AsyncIterator[tuple[str, Any]]:
        """Async event stream with first-byte/total timeouts. Raises QuickError (504 timeout, 502 upstream)."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        messages = self.build_messages(req)
        s = self.settings

        def put(item: tuple[str, Any]) -> None:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, item)
            except RuntimeError:  # loop closed (shutdown)
                cancel.set()

        def worker() -> None:
            try:
                for ev in self.backend.stream(messages=messages, provider=provider, model=model,
                                              max_tokens=req.max_tokens, timeout=s.total_timeout, cancel=cancel):
                    if cancel.is_set():
                        break
                    put(ev)
                put(("_end", None))
            except BaseException as exc:  # noqa: BLE001 - reported as a generic upstream error
                put(("_error", exc))

        started = self._clock()
        future = loop.run_in_executor(self._executor, worker)
        got_content = False
        try:
            while True:
                elapsed = self._clock() - started
                limit = s.total_timeout if got_content else min(s.first_byte_timeout, s.total_timeout)
                remaining = limit - elapsed
                if remaining <= 0:
                    raise QuickError(504, "timeout", "first byte timeout" if not got_content else "total timeout")
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    continue  # loop re-evaluates and raises the right timeout
                if kind == "_end":
                    return
                if kind == "_error":
                    status = getattr(value, "status_code", None) or getattr(value, "status", None)
                    logger.warning("quick upstream error: %s%s", type(value).__name__,
                                   f" status={status}" if isinstance(status, int) else "")
                    raise QuickError(502, "upstream_error",
                                     f"model provider request failed ({type(value).__name__})")
                if kind == "delta" and value:
                    got_content = True
                elif kind == "route" and isinstance(value, dict):
                    self.last_route = {"provider": value.get("provider") or self.last_route.get("provider", ""),
                                       "model": value.get("model") or self.last_route.get("model", "")}
                yield kind, value
        finally:
            cancel.set()
            del future  # the worker ends on its own once cancel is set (checked between provider chunks)


# --- OpenAI wire helpers --------------------------------------------------------------------------------


def completion_id() -> str:
    return "chatcmpl-hq" + uuid.uuid4().hex[:24]


def chunk(cid: str, created: int, model: str, delta: dict, finish: Optional[str] = None,
          usage: Optional[dict] = None, provider: Optional[str] = None) -> dict:
    out: dict[str, Any] = {
        "id": cid, "object": "chat.completion.chunk", "created": created, "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage is not None:
        out["usage"] = usage
    if provider:
        out["provider"] = provider
    return out


def usage_block(usage: Optional[dict], prompt_text: str, completion_text: str) -> tuple[dict, bool]:
    """Provider usage if reported, else an estimate (second value True = estimated)."""
    if usage and isinstance(usage.get("prompt_tokens"), int) and isinstance(usage.get("completion_tokens"), int):
        p, c = usage["prompt_tokens"], usage["completion_tokens"]
        return {"prompt_tokens": p, "completion_tokens": c, "total_tokens": p + c}, False
    p, c = estimate_tokens(prompt_text), estimate_tokens(completion_text)
    return {"prompt_tokens": p, "completion_tokens": c, "total_tokens": p + c}, True
