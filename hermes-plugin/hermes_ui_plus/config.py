"""Plugin settings (``plugins.entries.hermes-ui-plus.settings`` in the Hermes config.yaml).

Pure module: no Hermes imports, so it is unit-testable without Hermes installed.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

PLUGIN_NAME = "hermes-ui-plus"
AUX_TASK_KEY = "hui_quick"
AUX_INHERIT_FROM = "title_generation"  # built-in fast slot; the user's auxiliary.hui_quick block still wins
KILL_SWITCH_ENV = "HERMES_UI_PLUS_DISABLE"  # read once at plugin load: 1/true/yes/on = register nothing
VERSION = "0.2.0"

DEFAULT_PORT = 8646
MAX_TURNS = 6
MAX_CHARS_PER_TURN = 4000
MAX_BODY_BYTES = 64 * 1024

LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")


def _num(value: Any, default: float, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v != v:  # NaN
        return default
    return min(max(v, lo), hi)


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip().lower() for v in value if isinstance(v, str) and v.strip()]


def kill_switch_on(env: dict) -> bool:
    return str(env.get(KILL_SWITCH_ENV, "")).strip().lower() in ("1", "true", "yes", "on")


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True)
class Settings:
    """Effective settings. ``host`` is always a loopback address (non-loopback values are refused)."""

    enabled: bool = True  # loopback HTTP listener on/off
    host: str = "127.0.0.1"
    port: int = DEFAULT_PORT
    secret_file: str = ""  # "" = HERMES_HOME/hermes-ui-plus/secret
    quick_enabled: bool = True
    max_tokens: int = 1024
    max_concurrency: int = 4
    first_byte_timeout: float = 20.0
    total_timeout: float = 60.0
    allow_model_override: bool = True
    # "provider:model" or "provider:*"; [] = any (the bridge validates against GET /api/model/options first)
    allowed_models: list[str] = field(default_factory=list)
    library_enabled: bool = True  # /library/*: skills list + SKILL.md (read-only)
    library_expose_memory: bool = False  # /library/memory: MEMORY.md / USER.md of this profile (opt-in)
    bots_enabled: bool = True  # /bots: list, create and edit bots (profiles); the bridge adds the owner's switch
    bots_limit: int = 50  # bots (named profiles) at most
    warnings: tuple[str, ...] = ()


def load_settings(get: Callable[[str, Any], Any]) -> Settings:
    """Build Settings from a ``get(key, default)`` reader (``PluginContext.get_config``)."""
    warnings: list[str] = []
    host = str(get("server.host", "127.0.0.1") or "127.0.0.1").strip()
    if not is_loopback(host):
        warnings.append("server.host must be a loopback address; using 127.0.0.1")
        host = "127.0.0.1"
    port = int(_num(get("server.port", DEFAULT_PORT), DEFAULT_PORT, 1, 65535))
    first_byte = _num(get("quick.first_byte_timeout", 20), 20.0, 1, 300)
    total = _num(get("quick.total_timeout", 60), 60.0, 2, 600)
    if total < first_byte:
        total = first_byte
    return Settings(
        enabled=_bool(get("server.enabled", True), True),
        host=host,
        port=port,
        secret_file=str(get("server.secret_file", "") or "").strip(),
        quick_enabled=_bool(get("quick.enabled", True), True),
        max_tokens=int(_num(get("quick.max_tokens", 1024), 1024, 16, 8192)),
        max_concurrency=int(_num(get("quick.max_concurrency", 4), 4, 1, 64)),
        first_byte_timeout=first_byte,
        total_timeout=total,
        allow_model_override=_bool(get("quick.allow_model_override", True), True),
        allowed_models=_str_list(get("quick.allowed_models", [])),
        library_enabled=_bool(get("library.enabled", True), True),
        library_expose_memory=_bool(get("library.expose_memory", False), False),
        bots_enabled=_bool(get("bots.enabled", True), True),
        bots_limit=int(_num(get("bots.limit", 50), 50, 1, 200)),
        warnings=tuple(warnings),
    )


def settings_from_mapping(mapping: Optional[dict]) -> Settings:
    """Settings from a nested dict (tests, standalone runs)."""
    def get(key: str, default: Any) -> Any:
        node: Any = mapping or {}
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node
    return load_settings(get)
