"""Read-only library endpoints: skills (list + SKILL.md) and memory (MEMORY.md / USER.md) of the plugin's own profile.

Pure module: no Hermes imports. Everything Hermes-specific comes through a ``source`` object
(``hermes_adapter.HermesLibrary`` in production, a fake in tests):

    source.skills()            -> list of {name, description, category|None, enabled, source}
    source.skill_md(name)      -> bytes of that skill's SKILL.md (at most ``limit`` + 1 bytes) or None
    source.memory_settings()   -> {provider, memory_enabled, user_enabled, memory_limit, user_limit}

Any exception from the source means "this Hermes cannot do that" and is reported as ``hermes_unsupported``.
Nothing here writes, takes a path from the client, or reads outside ``<home>/memories``.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .config import VERSION, Settings
from .quick import QuickError

logger = logging.getLogger("hermes_ui_plus.library")

MAX_SKILL_BYTES = 256 * 1024
MAX_NAME_CHARS = 200
MAX_ENTRY_CHARS = 4000
MAX_ENTRIES = 200  # per store; the Hermes char limits keep real stores far below this
MAX_MEMORY_FILE_BYTES = 256 * 1024
ENTRY_DELIMITER = "\n§\n"  # tools/memory_tool_store.py

REASON_DISABLED = "disabled_by_config"
REASON_MEMORY_OFF = "memory_not_exposed"
REASON_UNSUPPORTED = "hermes_unsupported"

SOURCES = ("bundled", "hub", "external", "local", "plugin")


def profile_name(home: str) -> str:
    """``<root>/profiles/<name>`` is profile ``<name>``; any other Hermes home is the default profile."""
    p = Path(home)
    return p.name if p.parent.name == "profiles" and p.name else "default"


def split_entries(text: str) -> list[str]:
    return [e.strip() for e in text.split(ENTRY_DELIMITER) if e.strip()]


def _iso(mtime: float) -> str:
    return datetime.fromtimestamp(mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_capped(path: Path) -> Optional[tuple[str, float]]:
    """(text, mtime) of a regular file, or None when it is missing or unreadable."""
    try:
        with open(path, "rb") as f:
            raw = f.read(MAX_MEMORY_FILE_BYTES)
        mtime = path.stat().st_mtime
    except OSError:
        return None
    return raw.decode("utf-8-sig", errors="replace"), mtime


def _feature_off(reason: str, message: str) -> QuickError:
    return QuickError(404, "feature_off", message, reason=reason)


class LibraryService:
    def __init__(self, settings: Settings, source: Any, home: str):
        self.settings = settings
        self._source = source
        self.home = home
        self.profile = profile_name(home)

    # -- blocking parts (run in a worker thread) ------------------------------------------------------------

    def _skill_list(self) -> list[dict]:
        out = []
        for s in self._source.skills():
            src = s.get("source")
            out.append({"name": str(s["name"]), "description": str(s.get("description") or ""),
                        "category": str(s["category"]) if s.get("category") else None,
                        "enabled": bool(s.get("enabled", True)), "source": src if src in SOURCES else "local"})
        out.sort(key=lambda s: (s["category"] or "", s["name"]))  # same order as Hermes' _sort_skills
        return out

    def _skill_content(self, name: str) -> dict:
        if not any(s["name"] == name for s in self._skill_list()):  # exact list entries only, no path input
            raise QuickError(404, "not_found", "unknown skill")
        raw = self._source.skill_md(name)
        if raw is None:
            raise QuickError(404, "not_found", "skill has no SKILL.md")
        truncated = len(raw) > MAX_SKILL_BYTES
        text = raw[:MAX_SKILL_BYTES].decode("utf-8-sig", errors="replace")
        return {"name": name, "content": text, "truncated": truncated}

    def _store(self, target: str, enabled: bool, limit: int) -> dict:
        entries: list[str] = []
        updated: Optional[str] = None
        chars = 0
        if enabled:
            got = _read_capped(Path(self.home) / "memories" / ("MEMORY.md" if target == "memory" else "USER.md"))
            if got is not None:
                text, mtime = got
                parsed = split_entries(text)
                chars = len(ENTRY_DELIMITER.join(parsed))
                entries = [e[:MAX_ENTRY_CHARS] for e in parsed[:MAX_ENTRIES]]
                updated = _iso(mtime)
        return {"target": target, "enabled": enabled, "entries": entries, "chars": chars, "limit": limit,
                "updated_at": updated}

    def _memory(self) -> dict:
        cfg = self._source.memory_settings()
        return {"profile": self.profile, "provider": cfg.get("provider") or None,
                "stores": [self._store("memory", bool(cfg["memory_enabled"]), int(cfg["memory_limit"])),
                           self._store("user", bool(cfg["user_enabled"]), int(cfg["user_limit"]))]}

    def _skills_state(self) -> dict:
        if not self.settings.library_enabled:
            return {"available": False, "reason": REASON_DISABLED}
        try:
            self._source.skills()
        except Exception as exc:
            logger.info("library: skills unsupported (%s)", type(exc).__name__)
            return {"available": False, "reason": REASON_UNSUPPORTED}
        return {"available": True}

    def _memory_state(self) -> dict:
        if not self.settings.library_enabled:
            return {"available": False, "reason": REASON_DISABLED}
        if not self.settings.library_expose_memory:
            return {"available": False, "reason": REASON_MEMORY_OFF}
        try:
            self._source.memory_settings()
        except Exception as exc:
            logger.info("library: memory unsupported (%s)", type(exc).__name__)
            return {"available": False, "reason": REASON_UNSUPPORTED}
        return {"available": True}

    def _config(self) -> dict:
        return {"version": VERSION, "profile": self.profile, "skills": self._skills_state(),
                "memory": self._memory_state()}

    # -- async API used by the HTTP server ------------------------------------------------------------------

    async def config(self) -> dict:
        return await asyncio.to_thread(self._config)

    async def skills(self) -> dict:
        if not self.settings.library_enabled:
            raise _feature_off(REASON_DISABLED, "library is disabled")
        try:
            data = await asyncio.to_thread(self._skill_list)
        except Exception as exc:
            logger.info("library: skills failed (%s)", type(exc).__name__)
            raise _feature_off(REASON_UNSUPPORTED, "this Hermes cannot list skills") from None
        return {"object": "list", "profile": self.profile, "data": data}

    async def skill_content(self, name: Optional[str]) -> dict:
        if not self.settings.library_enabled:
            raise _feature_off(REASON_DISABLED, "library is disabled")
        if not name or len(name) > MAX_NAME_CHARS:
            raise QuickError(400, "invalid_name", "name is required (at most 200 characters)")
        try:
            return await asyncio.to_thread(self._skill_content, name)
        except QuickError:
            raise
        except Exception as exc:
            logger.info("library: skill content failed (%s)", type(exc).__name__)
            raise _feature_off(REASON_UNSUPPORTED, "this Hermes cannot read skills") from None

    async def memory(self) -> dict:
        if not self.settings.library_enabled:
            raise _feature_off(REASON_DISABLED, "library is disabled")
        if not self.settings.library_expose_memory:
            raise _feature_off(REASON_MEMORY_OFF, "memory is not exposed")
        try:
            return await asyncio.to_thread(self._memory)
        except Exception as exc:
            logger.info("library: memory failed (%s)", type(exc).__name__)
            raise _feature_off(REASON_UNSUPPORTED, "this Hermes cannot read memory settings") from None
