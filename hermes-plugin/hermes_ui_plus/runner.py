"""Runs the loopback listener in its own daemon thread with its own asyncio loop.

Why a thread and not the gateway's event loop: the plugin API offers no public "gateway started" hook, and
``register_platform`` would need gateway internals (``BasePlatformAdapter``) and would list the plugin as a
connected messaging platform in every agent session prompt. A separate loop also guarantees the plugin can
never block the gateway's loop.

The bind is the lock: Hermes loads plugins in every process (gateway, CLI, cron workers). Only the first
process that binds ``server.port`` serves; the others log once at DEBUG and stay passive, retrying the bind
every ``BIND_RETRY_S``. The retry matters with several profiles: a container that starts one gateway service
per profile can have a short-lived process (``hermes -p <other> gateway run`` that exits because the main
gateway multiplexes that profile) win the bind and exit, which used to leave quick answers dead until the next
restart. The gateway lives longest, so it ends up owning the port. The thread runs in a copy of the
registering context, so a profile-scoped ``HERMES_HOME`` override or secret scope set during plugin load stays
in effect for the model calls.
"""

from __future__ import annotations

import asyncio
import contextvars
import errno
import logging
import threading
from typing import Callable, Optional

from .httpserver import QuickHttpServer
from .quick import QuickService

logger = logging.getLogger("hermes_ui_plus.runner")

BIND_RETRY_S = 15.0  # passive processes try to take over the port this often (cheap: one failed bind)


class ListenerThread:
    def __init__(self, make_service: Callable[[], QuickService], secret: str, *, host: str, port: int):
        self._make_service = make_service
        self._secret = secret
        self.host, self.port = host, port
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server: Optional[QuickHttpServer] = None
        self._service: Optional[QuickService] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._stopping = threading.Event()
        self.bound = False
        self.error: Optional[str] = None

    def start(self, wait: float = 5.0) -> bool:
        """Start the thread and wait until bound (or failed, or passive). True when this process serves now; a
        passive listener keeps retrying the bind until ``stop()``."""
        ctx = contextvars.copy_context()
        self._thread = threading.Thread(target=ctx.run, args=(self._main,), name="hermes-ui-plus", daemon=True)
        self._thread.start()
        self._ready.wait(wait)
        return self.bound

    def _main(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        try:
            self._service = self._make_service()
            self._server = QuickHttpServer(self._service, self._secret, host=self.host, port=self.port)
            while True:
                try:
                    loop.run_until_complete(self._server.start())
                    break
                except OSError as exc:
                    if exc.errno != errno.EADDRINUSE:
                        self.error = type(exc).__name__
                        logger.warning("hermes-ui-plus: could not bind %s:%s (%s)", self.host, self.port, self.error)
                        return
                    if self.error != "port in use":
                        self.error = "port in use"
                        logger.debug("hermes-ui-plus: %s:%s already served by another process; staying passive",
                                     self.host, self.port)
                        self._ready.set()  # start() returns now (passive); this thread keeps retrying
                    if self._stopping.wait(BIND_RETRY_S):
                        return
            self.error = None
            self.bound = True
            self.port = self._server.bound_port
            logger.info("hermes-ui-plus: quick answers on http://%s:%s", self.host, self.port)
            self._ready.set()
            loop.run_forever()
        except Exception as exc:  # never propagate into Hermes
            self.error = type(exc).__name__
            logger.warning("hermes-ui-plus: listener stopped (%s)", self.error)
        finally:
            self._ready.set()
            try:
                if self._server is not None:
                    loop.run_until_complete(self._server.stop())
                if self._service is not None:
                    self._service.close()
            finally:
                loop.close()

    def stop(self, wait: float = 5.0) -> None:
        self._stopping.set()
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(loop.stop)
            except RuntimeError:
                pass
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(wait)
