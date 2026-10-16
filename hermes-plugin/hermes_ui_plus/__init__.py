"""hermes-ui-plus: thin Hermes plugin for the Hermes Interactive UI+ app (ADR 0001, option B).

First feature: quick answers. One-off questions are answered by a fast model through Hermes' own providers
and credentials (auxiliary slot ``auxiliary.hui_quick``), without the agent: no tools, no memory, no
session, a short prompt. The UI Bridge reaches them over a loopback listener protected by an
installer-generated secret.

Plugin rules (ADR 0001): public ``PluginContext`` hooks only, feature-detected with ``hasattr``; stdlib
only; the single Hermes import lives in ``hermes_adapter.py``; loopback only; fixed operations; nothing
blocks the gateway; kill switch ``HERMES_UI_PLUS_DISABLE=1`` (read at load).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from .config import (AUX_INHERIT_FROM, AUX_TASK_KEY, KILL_SWITCH_ENV, PLUGIN_NAME, VERSION, kill_switch_on,
                     load_settings)

logger = logging.getLogger("hermes_ui_plus")

__all__ = ["register", "VERSION"]

# Aux slot defaults layered over the inherited slot (title_generation); the user's auxiliary.hui_quick wins.
AUX_DEFAULTS = {"reasoning_effort": "low", "timeout": 60}


def _hermes_home() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip()
    return Path(os.path.expanduser(home)) if home else Path.home() / ".hermes"


def register(ctx: Any) -> None:
    """Hermes plugin entry point. Never raises: a broken plugin must cost the feature, not the gateway."""
    try:
        _register(ctx)
    except Exception as exc:
        logger.warning("%s: disabled after a registration error (%s)", PLUGIN_NAME, type(exc).__name__)


def _register(ctx: Any) -> None:
    if kill_switch_on(os.environ):
        logger.info("%s: disabled by %s", PLUGIN_NAME, KILL_SWITCH_ENV)
        return
    if not hasattr(ctx, "register_auxiliary_task"):
        logger.warning("%s: this Hermes has no PluginContext.register_auxiliary_task; quick answers off", PLUGIN_NAME)
        return
    ctx.register_auxiliary_task(
        AUX_TASK_KEY,
        display_name="Quick answers (Hermes UI+)",
        description="one-off app questions without the agent",
        defaults=dict(AUX_DEFAULTS),
        inherit_from=AUX_INHERIT_FROM,
    )

    get = ctx.get_config if hasattr(ctx, "get_config") else (lambda _k, d=None: d)
    settings = load_settings(get)
    for w in settings.warnings:
        logger.warning("%s: %s", PLUGIN_NAME, w)
    if not settings.enabled:
        logger.info("%s: listener disabled (server.enabled: false)", PLUGIN_NAME)
        return

    from . import hermes_adapter
    from .quick import QuickService
    from .runner import ListenerThread
    from .secret import default_secret_path, load_secret

    secret_path = Path(settings.secret_file) if settings.secret_file else default_secret_path(_hermes_home())
    try:
        secret = load_secret(secret_path)
    except FileNotFoundError:
        logger.warning("%s: no secret at the configured path; run the installer. Listener off.", PLUGIN_NAME)
        return
    except (PermissionError, ValueError) as exc:
        logger.warning("%s: unusable secret file (%s); listener off", PLUGIN_NAME, exc)
        return

    backend = hermes_adapter.HermesAuxBackend(AUX_TASK_KEY, home=str(_hermes_home()))
    listener = ListenerThread(
        lambda: QuickService(settings, backend, task=AUX_TASK_KEY, inherit_from=AUX_INHERIT_FROM),
        secret, host=settings.host, port=settings.port)
    listener.start()  # False = another process serves; this one stays passive and takes over if that one exits
    if hasattr(ctx, "on_unload"):
        ctx.on_unload(listener.stop)
