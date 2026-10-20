"""Loopback HTTP/1.1 listener (stdlib asyncio, no aiohttp): one request per connection, Content-Length bodies
only, SSE for streaming answers.

Routes:
  GET  /health                          no auth, {"ok": true}
  GET  /quick/config                    Bearer secret; {enabled, available, reason, ...} (self-test result)
  POST /quick/v1/chat/completions       Bearer secret, OpenAI-compatible (stream or JSON)
  GET  /library/config                  Bearer secret; {version, profile, skills, memory} availability
  GET  /library/skills                  Bearer secret; skills of this profile (name, enabled, source, ...)
  GET  /library/skills/content?name=    Bearer secret; SKILL.md of a listed skill (capped)
  GET  /library/memory                  Bearer secret; MEMORY.md / USER.md entries (opt-in: library.expose_memory)
  GET  /bots                            Bearer secret; bots (named profiles) + whether this Hermes can create one
  POST /bots                            Bearer secret; create a bot from the three fields (bots.py)
  GET  /bots/<name>                     Bearer secret; the three fields of one bot (edit form)
  PATCH /bots/<name>                    Bearer secret; rewrite title, main job and how it works
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, Optional
from urllib.parse import parse_qs

from .config import MAX_BODY_BYTES, VERSION
from .bots import BotsService
from .library import LibraryService
from .quick import QuickError, QuickService, chunk, completion_id, parse_request, usage_block
from .secret import SecretCheck

logger = logging.getLogger("hermes_ui_plus.http")

MAX_HEADER_BYTES = 16 * 1024
MAX_HEADERS = 64
HEADER_TIMEOUT = 10.0
BODY_TIMEOUT = 10.0

_REASONS = {200: "OK", 201: "Created", 204: "No Content", 403: "Forbidden", 409: "Conflict", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found",
            405: "Method Not Allowed", 408: "Request Timeout", 411: "Length Required", 413: "Payload Too Large",
            429: "Too Many Requests", 431: "Request Header Fields Too Large", 500: "Internal Server Error",
            502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout"}


class _HttpError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class Request:
    def __init__(self, method: str, path: str, headers: dict[str, str], body: bytes,
                 query: Optional[dict[str, str]] = None):
        self.method, self.path, self.headers, self.body = method, path, headers, body
        self.query = query or {}  # first value per key


async def _read_request(reader: asyncio.StreamReader) -> Request:
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=HEADER_TIMEOUT)
    except asyncio.LimitOverrunError:
        raise _HttpError(431, "headers_too_large", "request headers too large") from None
    except asyncio.IncompleteReadError:
        raise ConnectionResetError("client closed") from None
    except asyncio.TimeoutError:
        raise _HttpError(408, "timeout", "request header timeout") from None
    if len(head) > MAX_HEADER_BYTES:
        raise _HttpError(431, "headers_too_large", "request headers too large")
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    if len(parts) != 3 or not parts[2].startswith("HTTP/1."):
        raise _HttpError(400, "bad_request", "malformed request line")
    method, target = parts[0], parts[1]
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line:
            continue
        name, sep, value = line.partition(":")
        if not sep or not name or name != name.strip():
            raise _HttpError(400, "bad_request", "malformed header")
        key = name.lower()
        if key in headers and key in ("content-length", "authorization", "transfer-encoding"):
            raise _HttpError(400, "bad_request", f"duplicate {key} header")
        headers[key] = value.strip()
        if len(headers) > MAX_HEADERS:
            raise _HttpError(431, "headers_too_large", "too many headers")
    if "transfer-encoding" in headers:
        raise _HttpError(411, "length_required", "chunked bodies are not supported; send Content-Length")
    body = b""
    if "content-length" in headers:
        raw_len = headers["content-length"]
        if not raw_len.isdigit():
            raise _HttpError(400, "bad_request", "invalid Content-Length")
        length = int(raw_len)
        if length > MAX_BODY_BYTES:
            raise _HttpError(413, "body_too_large", f"body exceeds {MAX_BODY_BYTES} bytes")
        if length:
            try:
                body = await asyncio.wait_for(reader.readexactly(length), timeout=BODY_TIMEOUT)
            except asyncio.IncompleteReadError:
                raise ConnectionResetError("client closed") from None
            except asyncio.TimeoutError:
                raise _HttpError(408, "timeout", "request body timeout") from None
    path, _, qs = target.partition("?")
    try:
        query = {k: v[0] for k, v in parse_qs(qs, keep_blank_values=True, max_num_fields=20).items()}
    except ValueError:
        raise _HttpError(400, "bad_request", "malformed query string") from None
    return Request(method, path, headers, body, query)


def _head(status: int, headers: dict[str, str]) -> bytes:
    lines = [f"HTTP/1.1 {status} {_REASONS.get(status, 'Status')}"]
    base = {"connection": "close", "cache-control": "no-store", "x-content-type-options": "nosniff",
            "x-hermes-ui-plus": VERSION}
    for k, v in {**base, **headers}.items():
        lines.append(f"{k}: {v}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")


async def _send_json(writer: asyncio.StreamWriter, status: int, payload: Any,
                     extra: Optional[dict[str, str]] = None) -> None:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {"content-type": "application/json; charset=utf-8", "content-length": str(len(data)), **(extra or {})}
    writer.write(_head(status, headers) + data)
    await writer.drain()


def _sse(obj: Any) -> bytes:
    if isinstance(obj, str):
        return f"data: {obj}\n\n".encode("utf-8")
    return ("data: " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n\n").encode("utf-8")


class QuickHttpServer:
    def __init__(self, service: QuickService, secret: str, *, host: str, port: int,
                 library: Optional[LibraryService] = None, bots: Optional[BotsService] = None):
        self.service = service
        self.library = library
        self.bots = bots
        self._auth = SecretCheck(secret)
        self.host, self.port = host, port
        self._server: Optional[asyncio.base_events.Server] = None
        self._conns: set[asyncio.Task] = set()
        self._warmup: Optional[asyncio.Future] = None

    @property
    def bound_port(self) -> int:
        if self._server and self._server.sockets:
            return self._server.sockets[0].getsockname()[1]
        return self.port

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_conn, host=self.host, port=self.port,
                                                  limit=MAX_HEADER_BYTES, reuse_address=True)
        # self-test once at start (logs the result); config and quick requests re-check from its cache
        self._warmup = asyncio.ensure_future(self.service.availability(force=True))

    async def stop(self) -> None:
        if self._warmup is not None and not self._warmup.done():
            self._warmup.cancel()
        if self._server is not None:
            self._server.close()
            for t in list(self._conns):
                t.cancel()
            try:
                await asyncio.wait_for(self._server.wait_closed(), timeout=3)
            except (asyncio.TimeoutError, Exception):
                pass
            self._server = None

    async def _on_conn(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._conns.add(task)
        try:
            try:
                req = await _read_request(reader)
            except _HttpError as e:
                await _send_json(writer, e.status, {"error": {"message": e.message, "type": "invalid_request_error",
                                                              "code": e.code}})
                return
            await self._dispatch(req, reader, writer)
        except (ConnectionError, asyncio.CancelledError):
            pass
        except Exception as exc:  # never leak details
            logger.error("hui-plus request failed: %s", type(exc).__name__)
            try:
                await _send_json(writer, 500, {"error": {"message": "internal error", "type": "server_error",
                                                         "code": "internal"}})
            except Exception:
                pass
        finally:
            if task is not None:
                self._conns.discard(task)
            try:
                writer.close()
            except Exception:
                pass

    async def _dispatch(self, req: Request, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        routes = {"/health": ("GET",), "/quick/config": ("GET",), "/quick/v1/chat/completions": ("POST",),
                  "/library/config": ("GET",), "/library/skills": ("GET",), "/library/skills/content": ("GET",),
                  "/library/memory": ("GET",)}
        if req.path.startswith("/library/") and self.library is None:
            await _send_json(writer, 404, QuickError(404, "not_found", "not found").body())
            return
        if req.path == "/bots" or req.path.startswith("/bots/"):
            await self._bots(req, writer)
            return
        if req.path not in routes:
            await _send_json(writer, 404, QuickError(404, "not_found", "not found").body())
            return
        if req.method not in routes[req.path]:
            await _send_json(writer, 405, QuickError(400, "method_not_allowed", "method not allowed").body(),
                             {"allow": ", ".join(routes[req.path])})
            return
        if req.path == "/health":
            await _send_json(writer, 200, {"ok": True})
            return
        if not self._auth.check_header(req.headers.get("authorization")):
            await _send_json(writer, 401, QuickError(401, "unauthorized", "invalid or missing secret").body(),
                             {"www-authenticate": "Bearer"})
            return
        if req.path == "/quick/config":
            await _send_json(writer, 200, await self.service.config_payload())
            return
        if req.path.startswith("/library/"):
            await self._library(req, writer)
            return
        await self._quick(req, reader, writer)

    async def _library(self, req: Request, writer: asyncio.StreamWriter) -> None:
        lib = self.library
        assert lib is not None
        try:
            if req.path == "/library/config":
                payload = await lib.config()
            elif req.path == "/library/skills":
                payload = await lib.skills()
            elif req.path == "/library/skills/content":
                payload = await lib.skill_content(req.query.get("name"))
            else:
                payload = await lib.memory()
        except QuickError as e:
            await _send_json(writer, e.status, e.body())
            return
        await _send_json(writer, 200, payload)

    async def _bots(self, req: Request, writer: asyncio.StreamWriter) -> None:
        if self.bots is None:
            await _send_json(writer, 404, QuickError(404, "not_found", "not found").body())
            return
        name = req.path[len("/bots/"):] if req.path.startswith("/bots/") else None
        allowed = ("GET", "PATCH") if name is not None else ("GET", "POST")
        if name is not None and ("/" in name or not name):
            await _send_json(writer, 404, QuickError(404, "not_found", "not found").body())
            return
        if req.method not in allowed:
            await _send_json(writer, 405, QuickError(400, "method_not_allowed", "method not allowed").body(),
                             {"allow": ", ".join(allowed)})
            return
        if not self._auth.check_header(req.headers.get("authorization")):
            await _send_json(writer, 401, QuickError(401, "unauthorized", "invalid or missing secret").body(),
                             {"www-authenticate": "Bearer"})
            return
        body = None
        if req.method in ("POST", "PATCH"):
            try:
                body = json.loads(req.body.decode("utf-8")) if req.body else None
            except (UnicodeDecodeError, json.JSONDecodeError):
                await _send_json(writer, 400, QuickError(400, "invalid_json", "body is not valid JSON").body())
                return
        try:
            if name is None:
                status, payload = (200, await self.bots.list()) if req.method == "GET" else (
                    201, await self.bots.create(body))
            else:
                status, payload = 200, (await self.bots.get(name) if req.method == "GET" else
                                        await self.bots.patch(name, body))
        except QuickError as e:
            await _send_json(writer, e.status, e.body())
            return
        await _send_json(writer, status, payload)

    async def _quick(self, req: Request, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        svc = self.service
        t0 = time.monotonic()
        if not svc.settings.quick_enabled:
            await _send_json(writer, 404, QuickError(404, "feature_off", "quick answers are disabled").body())
            return
        reason = await svc.availability()
        if reason:  # the self-test failed: answer like "off" (clients hide the button) instead of a 502 per call
            self._log(404, t0, None, None, None, None, qreq_stream=None)
            await _send_json(writer, 404, QuickError(404, "feature_off", "quick answers are unavailable on this "
                                                     "Hermes", reason=reason).body())
            return
        try:
            body = json.loads(req.body.decode("utf-8")) if req.body else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            await _send_json(writer, 400, QuickError(400, "invalid_json", "body is not valid JSON").body())
            return
        try:
            qreq = parse_request(body, svc.settings)
            provider, model = await svc.resolve_route(qreq)
        except QuickError as e:
            self._log(e.status, t0, None, None, None, None, qreq_stream=None)
            await _send_json(writer, e.status, e.body())
            return
        if not svc.try_acquire():
            self._log(429, t0, None, provider, model, None, qreq_stream=qreq.stream)
            await _send_json(writer, 429, QuickError(429, "busy", "too many quick answers in flight").body(),
                             {"retry-after": "2"})
            return
        cancel = threading.Event()
        watcher = asyncio.ensure_future(self._watch_disconnect(reader, cancel))
        try:
            if qreq.stream:
                await self._stream(qreq, provider, model, writer, cancel, t0)
            else:
                await self._json(qreq, provider, model, writer, cancel, t0)
        finally:
            cancel.set()
            watcher.cancel()
            svc.release()

    @staticmethod
    async def _watch_disconnect(reader: asyncio.StreamReader, cancel: threading.Event) -> None:
        """EOF on the request side = client went away: abort the upstream call."""
        try:
            while not cancel.is_set():
                data = await reader.read(1024)
                if not data:
                    cancel.set()
                    return
        except (ConnectionError, asyncio.CancelledError):
            cancel.set()

    async def _stream(self, qreq, provider, model, writer, cancel, t0) -> None:
        svc = self.service
        cid, created = completion_id(), int(time.time())
        state = {"model": model or "", "provider": provider or "", "finish": "stop", "usage": None,
                 "text": [], "ttfb": None, "mode": "stream"}
        headers_sent = False
        status = 200
        try:
            async for kind, value in svc.events(qreq, provider, model, cancel):
                if kind == "route":
                    state["model"] = value.get("model") or state["model"]
                    state["provider"] = value.get("provider") or state["provider"]
                    continue
                if kind == "mode":
                    state["mode"] = value
                    continue
                if kind == "usage":
                    state["usage"] = value
                    continue
                if kind == "finish":
                    state["finish"] = value or "stop"
                    continue
                if kind != "delta" or not value:
                    continue
                if not headers_sent:
                    writer.write(_head(200, {"content-type": "text/event-stream; charset=utf-8",
                                             "x-accel-buffering": "no"}))
                    writer.write(_sse(chunk(cid, created, state["model"], {"role": "assistant", "content": ""})))
                    headers_sent = True
                    state["ttfb"] = time.monotonic() - t0
                state["text"].append(value)
                writer.write(_sse(chunk(cid, created, state["model"], {"content": value})))
                await writer.drain()
                if cancel.is_set():
                    status = 499
                    return
            if cancel.is_set() and not state["text"]:
                status = 499
                return
            usage, estimated = usage_block(state["usage"], self._prompt_text(qreq), "".join(state["text"]))
            if not headers_sent:
                writer.write(_head(200, {"content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no"}))
                writer.write(_sse(chunk(cid, created, state["model"], {"role": "assistant", "content": ""})))
                headers_sent = True
            final = chunk(cid, created, state["model"], {}, state["finish"], usage, state["provider"])
            if estimated:
                final["usage_estimated"] = True
            writer.write(_sse(final))
            writer.write(_sse("[DONE]"))
            await writer.drain()
            state["usage_final"] = usage
        except QuickError as e:
            status = e.status
            if not headers_sent:
                await _send_json(writer, e.status, e.body())
            else:  # mid-stream: OpenAI-style error event, then end
                writer.write(_sse(e.body()))
                writer.write(_sse("[DONE]"))
                await writer.drain()
        except ConnectionError:
            status = 499
        finally:
            self._log(status, t0, state["ttfb"], state["provider"], state["model"], state.get("usage_final"),
                      qreq_stream=True, mode=state["mode"])

    async def _json(self, qreq, provider, model, writer, cancel, t0) -> None:
        svc = self.service
        state = {"model": model or "", "provider": provider or "", "finish": "stop", "usage": None,
                 "mode": "stream"}
        text: list[str] = []
        status = 200
        usage = None
        try:
            async for kind, value in svc.events(qreq, provider, model, cancel):
                if kind == "route":
                    state["model"] = value.get("model") or state["model"]
                    state["provider"] = value.get("provider") or state["provider"]
                elif kind == "usage":
                    state["usage"] = value
                elif kind == "finish":
                    state["finish"] = value or "stop"
                elif kind == "mode":
                    state["mode"] = value
                elif kind == "delta" and value:
                    text.append(value)
            if cancel.is_set() and not text:
                status = 499
                return
            usage, estimated = usage_block(state["usage"], self._prompt_text(qreq), "".join(text))
            payload = {
                "id": completion_id(), "object": "chat.completion", "created": int(time.time()),
                "model": state["model"], "provider": state["provider"],
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "".join(text)},
                             "finish_reason": state["finish"]}],
                "usage": usage,
            }
            if estimated:
                payload["usage_estimated"] = True
            await _send_json(writer, 200, payload)
        except QuickError as e:
            status = e.status
            await _send_json(writer, e.status, e.body())
        finally:
            self._log(status, t0, None, state["provider"], state["model"], usage, qreq_stream=False,
                      mode=state["mode"])

    def _prompt_text(self, qreq) -> str:
        return "\n".join(m["content"] for m in self.service.build_messages(qreq))

    @staticmethod
    def _log(status: int, t0: float, ttfb: Optional[float], provider: Optional[str], model: Optional[str],
             usage: Optional[dict], *, qreq_stream: Optional[bool], mode: str = "") -> None:
        """Metadata only. Never message content, provider error text or the secret."""
        ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "quick status=%s ms=%d ttfb_ms=%s stream=%s mode=%s provider=%s model=%s in=%s out=%s",
            status, ms, int(ttfb * 1000) if ttfb is not None else "-", qreq_stream, mode or "-",
            provider or "default", model or "default",
            (usage or {}).get("prompt_tokens", "-"), (usage or {}).get("completion_tokens", "-"))
