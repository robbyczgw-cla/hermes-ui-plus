"""Shared fakes: a scriptable quick backend and a running test server on 127.0.0.1:<random>."""

from __future__ import annotations

import http.client
import json
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterator, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hermes_ui_plus.config import settings_from_mapping  # noqa: E402
from hermes_ui_plus.quick import QuickService  # noqa: E402
from hermes_ui_plus.runner import ListenerThread  # noqa: E402

SECRET = "test_secret_" + "x" * 40


class FakeBackend:
    """Yields scripted events; records calls; honours cancel."""

    def __init__(self, deltas=("Hallo", " Welt"), *, delay: float = 0.0, first_delay: float = 0.0,
                 usage=None, fail: Optional[BaseException] = None, model="fake-model"):
        self.deltas, self.delay, self.first_delay = list(deltas), delay, first_delay
        self.usage, self.fail, self.model = usage, fail, model
        self.calls: list[dict] = []
        self.cancelled = threading.Event()
        self.finished = threading.Event()
        self.threads: list[tuple[str, int]] = []  # (where, thread id): the generator's start and its finally

    def stream(self, *, messages, provider, model, max_tokens, timeout, cancel) -> Iterator[tuple[str, Any]]:
        self.calls.append(dict(messages=messages, provider=provider, model=model, max_tokens=max_tokens))
        self.threads.append(("start", threading.get_ident()))
        try:
            yield "mode", "stream"
            yield "route", {"provider": provider or "fakeprov", "model": model or self.model}
            if self.first_delay:
                if cancel.wait(self.first_delay):
                    self.cancelled.set()
                    return
            if self.fail is not None:
                raise self.fail
            for d in self.deltas:
                if cancel.is_set():
                    self.cancelled.set()
                    return
                yield "delta", d
                if self.delay and cancel.wait(self.delay):
                    self.cancelled.set()
                    return
            yield "finish", "stop"
            if self.usage:
                yield "usage", self.usage
        finally:
            self.threads.append(("end", threading.get_ident()))
            self.finished.set()


class Running:
    def __init__(self, backend, settings: Optional[dict] = None):
        self.settings = settings_from_mapping(settings or {})
        self.backend = backend
        self.listener = ListenerThread(lambda: QuickService(self.settings, backend, today=lambda: "2026-01-02"),
                                       SECRET, host="127.0.0.1", port=0)
        assert self.listener.start(), self.listener.error
        self.port = self.listener.port

    def close(self):
        self.listener.stop()

    def request(self, method, path, body=None, *, auth=True, headers=None, raw_body: Optional[bytes] = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = dict(headers or {})
        if auth:
            h["Authorization"] = f"Bearer {SECRET}"
        data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            h.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=h)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        return resp.status, dict(resp.getheaders()), payload


def sse_events(payload: bytes) -> list:
    out = []
    for block in payload.decode().split("\n\n"):
        block = block.strip()
        if not block.startswith("data: "):
            continue
        data = block[len("data: "):]
        out.append(data if data == "[DONE]" else json.loads(data))
    return out


def wait_for(pred, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(0.02)
    return pred()
