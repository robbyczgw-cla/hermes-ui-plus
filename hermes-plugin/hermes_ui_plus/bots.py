"""Bots (Hermes profiles) made in the app: list, create, read and edit the three fields (Bots v2 slice 3).

Pure module: no Hermes imports. Everything Hermes-specific comes through a ``source`` object
(``hermes_adapter.HermesBots`` in production, a fake in tests):

    source.names()                     -> named profiles (live, without ``default``)
    source.read_profile_yaml(name)     -> profile.yaml as a dict ({} when missing or broken)
    source.is_parked(name)             -> bool
    source.create(name, description)   -> new profile cloned from the default one (config, .env, skills; Hermes strips
                                          messaging channels); FileExistsError / ValueError when Hermes refuses
    source.drop_memory(name)           -> remove the memory files the clone copied (a bot starts with its own memory)
    source.write_soul(name, text)
    source.update_config(name, fn)     -> config.yaml = fn(config.yaml dict), atomic
    source.update_profile_yaml(name, fn)
    source.set_env(name, key, value)   -> one KEY=value line in the profile's .env (replaced or appended, mode 0600)
    source.park(name)                  -> gateway.parked marker (a bot that failed half-way is never served)
    source.notify(name)                -> ask a running multiplexer to (re)scan the profile now
    source.multiplex_active()          -> True / False / None (unknown)

Rules: a new bot is a clone of the default profile (model, provider keys, skills such as hermes-ui) with its own
SOUL.md from the three fields, its own empty memory, a small toolset for the API server, manual approvals with an empty
allow-list, the bridge's API_SERVER_KEY and Hermes Desktop's ``ui_meta['hermes-bots']``. The app's own fields live in
``ui_meta['hermes-ui-plus']``. Never the default profile, never a gateway restart.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .config import Settings
from .quick import QuickError

logger = logging.getLogger("hermes_ui_plus.bots")

TEMPLATES = ("research", "deals", "travel", "briefing", "code", "own", "blank")
LANGS = ("de", "en", "es")
MAY_KEYS = ("web", "memory", "routines", "commands")
UI_META_KEY = "hermes-bots"  # Hermes Desktop's bot metadata (title, color, shape, created, ...)
APP_META_KEY = "hermes-ui-plus"  # this app's fields (template, job, how, lang, may)

MAX_TITLE = 40
MAX_JOB = 160
MAX_HOW = 2000
MAX_KEY = 512
MAX_LIST = 200
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
RESERVED = frozenset({"hermes", "default", "test", "tmp", "root", "sudo"})  # Hermes _RESERVED_NAMES
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# calm defaults when the app sends no colour (stable per name)
PALETTE = ("#3f7d6e", "#8a6d3b", "#5b6fa8", "#a0566b", "#6b7f3a", "#7a5ea8", "#3d7ea6", "#a8663a")

BASE_TOOLSETS = ("skills", "todo")  # skill_view finds the hermes-ui skill (answer cards); a plan list
MAY_TOOLSETS = {"web": ("web",), "memory": ("memory",), "routines": ("cronjob",), "commands": ("terminal", "file")}

REASON_DISABLED = "disabled_by_config"
REASON_NOT_ROOT = "not_root_profile"
REASON_MULTIPLEX = "multiplex_off"
REASON_UNSUPPORTED = "hermes_unsupported"
REASON_LIMIT = "limit"

SOUL_TEXT = {
    "de": {
        "intro": "Du bist {title}. {job}",
        "how": "So arbeitest du: {how}",
        "rules": "Regeln, die immer gelten: Antworte in der Sprache des Nutzers. Kaufe, buche, sende oder lösche nichts "
                 "ohne ausdrückliche Bestätigung.",
        "routines": "Wenn du etwas regelmäßig tun sollst, lege eine Routine an, die in diesen Chat liefert. Findet eine "
                    "Routine nichts Neues, antworte nur mit [SILENT].",
    },
    "en": {
        "intro": "You are {title}. {job}",
        "how": "How you work: {how}",
        "rules": "Rules that always apply: Answer in the user's language. Never buy, book, send or delete anything "
                 "without explicit confirmation.",
        "routines": "When you should do something regularly, create a routine that delivers into this chat. When a "
                    "routine finds nothing new, answer only with [SILENT].",
    },
    "es": {
        "intro": "Eres {title}. {job}",
        "how": "Así trabajas: {how}",
        "rules": "Reglas que siempre valen: Responde en el idioma del usuario. No compres, reserves, envíes ni borres "
                 "nada sin una confirmación explícita.",
        "routines": "Si debes hacer algo con regularidad, crea una rutina que entregue en este chat. Si una rutina no "
                    "encuentra nada nuevo, responde solo con [SILENT].",
    },
}


def _bad(field_name: str, message: str) -> QuickError:
    e = QuickError(400, "invalid_field", message)
    e.reason = field_name  # the field the app marks
    return e


def _clean_line(v: Any, field_name: str, max_len: int, *, required: bool = True) -> str:
    if v is None and not required:
        return ""
    if not isinstance(v, str):
        raise _bad(field_name, f"{field_name} must be a string")
    s = " ".join(v.split())  # one line, single spaces
    if CONTROL.search(s):
        raise _bad(field_name, f"{field_name} contains control characters")
    if required and not s:
        raise _bad(field_name, f"{field_name} is required")
    if len(s) > max_len:
        raise _bad(field_name, f"{field_name} is longer than {max_len} characters")
    return s


def _clean_text(v: Any, field_name: str, max_len: int) -> str:
    if not isinstance(v, str):
        raise _bad(field_name, f"{field_name} must be a string")
    s = "\n".join(line.rstrip() for line in v.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n"))
    s = re.sub(r"\n{3,}", "\n\n", s)
    if CONTROL.search(s):
        raise _bad(field_name, f"{field_name} contains control characters")
    if not s:
        raise _bad(field_name, f"{field_name} is required")
    if len(s) > max_len:
        raise _bad(field_name, f"{field_name} is longer than {max_len} characters")
    return s


def slugify(title: str) -> str:
    """Profile id from a display title, like Hermes Desktop's ``slugifyProfileName``: accents folded (``ü`` → ``u``),
    other letters as ``-u<hex>-``, everything else a dash; at most 64 characters, cut at a dash."""
    out = []
    for ch in unicodedata.normalize("NFC", title):
        if ch.isalnum():
            base = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
            out.append(base if base.isascii() and base.isalnum() else f"-u{ord(ch):x}-")
        else:
            out.append("-")
    slug = re.sub(r"-+", "-", "".join(out).lower()).strip("-")
    if len(slug) > 64:
        cut = slug[:64]
        slug = (cut if slug[64] == "-" else cut[: cut.rfind("-")] if "-" in cut else cut).rstrip("-")
    return slug


def pick_name(title: str, taken: set[str]) -> str:
    """A free, valid, non-reserved profile id for ``title`` (``scout``, ``scout-2``, ...; ``bot`` when nothing usable
    is left)."""
    base = slugify(title)
    if not NAME_RE.match(base or "") or base == "default":
        base = "bot"
    if base in RESERVED:
        base = f"{base}-bot"
    if base not in taken:
        return base
    for n in range(2, 1000):
        cand = f"{base[:60]}-{n}"
        if cand not in taken:
            return cand
    raise QuickError(409, "exists", "no free name for this bot")


def default_color(name: str) -> str:
    return PALETTE[int(hashlib.sha1(name.encode("utf-8")).hexdigest(), 16) % len(PALETTE)]


@dataclass(frozen=True)
class BotFields:
    title: str
    job: str
    how: str
    lang: str = "en"
    template: str = "own"
    may: dict = field(default_factory=dict)
    color: str = ""


def parse_may(v: Any, template: str) -> dict:
    """The four switches. Missing = the template's default (commands only for code)."""
    defaults = {"web": template != "code", "memory": True, "routines": template != "code", "commands": template == "code"}
    if v is None:
        return defaults
    if not isinstance(v, dict) or any(k not in MAY_KEYS for k in v):
        raise _bad("may", f"may must be an object with {', '.join(MAY_KEYS)}")
    out = dict(defaults)
    for k, on in v.items():
        if not isinstance(on, bool):
            raise _bad("may", "may values must be true or false")
        out[k] = on
    return out


def parse_fields(body: Any, *, partial_template: bool = False) -> BotFields:
    if not isinstance(body, dict):
        raise QuickError(400, "invalid_json", "body must be a JSON object")
    template = body.get("template", "own")
    if template not in TEMPLATES:
        raise _bad("template", "unknown template")
    lang = body.get("lang", "en")
    if not isinstance(lang, str) or lang[:2].lower() not in LANGS:
        lang = "en"
    color = body.get("color") or ""
    if color and (not isinstance(color, str) or not COLOR_RE.match(color)):
        raise _bad("color", "color must be #rrggbb")
    return BotFields(
        title=_clean_line(body.get("title"), "title", MAX_TITLE),
        job=_clean_line(body.get("job"), "job", MAX_JOB),
        how=_clean_text(body.get("how"), "how", MAX_HOW),
        lang=lang[:2].lower(),
        template=template,
        may=parse_may(body.get("may"), template),
        color=color.lower(),
    )


def _sentence(s: str) -> str:
    s = s.strip()
    return s if not s or s[-1] in ".!?…" else s + "."


def compose_soul(f: BotFields) -> str:
    """SOUL.md from the three fields (spec 2.2), in the app's language."""
    t = SOUL_TEXT.get(f.lang, SOUL_TEXT["en"])
    job = _sentence(f.job[:1].upper() + f.job[1:])
    parts = [t["intro"].format(title=f.title, job=job), t["how"].format(how=f.how), t["rules"]]
    if f.may.get("routines"):
        parts.append(t["routines"])
    return "\n\n".join(parts) + "\n"


def toolsets(may: dict) -> list[str]:
    out = list(BASE_TOOLSETS)
    for k in MAY_KEYS:
        if may.get(k):
            out.extend(t for t in MAY_TOOLSETS[k] if t not in out)
    return sorted(out)


def apply_bot_config(cfg: Any, may: dict) -> dict:
    """The bot's config.yaml: API-server toolsets from the switches, manual approvals, no allow-list carried over from
    the default profile (``command_allowlist`` is per bot, "Immer erlauben" starts empty)."""
    cfg = dict(cfg) if isinstance(cfg, dict) else {}
    pts = dict(cfg.get("platform_toolsets")) if isinstance(cfg.get("platform_toolsets"), dict) else {}
    pts["api_server"] = toolsets(may)
    cfg["platform_toolsets"] = pts
    approvals = dict(cfg.get("approvals")) if isinstance(cfg.get("approvals"), dict) else {}
    approvals["mode"] = "manual"
    cfg["approvals"] = approvals
    cfg["command_allowlist"] = []
    return cfg


def apply_ui_meta(doc: Any, updates: dict) -> dict:
    """Merge ``updates`` key-wise into ``ui_meta`` of a profile.yaml document and bump ``_ui_meta_revisions`` per key,
    like Hermes' ``profiles.configure`` (Desktop's compare-and-set sees the change)."""
    doc = dict(doc) if isinstance(doc, dict) else {}
    meta = dict(doc.get("ui_meta")) if isinstance(doc.get("ui_meta"), dict) else {}
    revs = dict(doc.get("_ui_meta_revisions")) if isinstance(doc.get("_ui_meta_revisions"), dict) else {}
    for key, value in updates.items():
        meta[key] = value
        old = revs.get(key, 0)
        revs[key] = (old if isinstance(old, int) and not isinstance(old, bool) and old >= 0 else 0) + 1
    doc["ui_meta"] = meta
    doc["_ui_meta_revisions"] = revs
    return doc


def bot_view(name: str, doc: Any, *, parked: bool = False) -> dict:
    """What the bridge gets for one bot: display fields only, never SOUL, config or keys."""
    doc = doc if isinstance(doc, dict) else {}
    meta = doc.get("ui_meta") if isinstance(doc.get("ui_meta"), dict) else {}
    desk = meta.get(UI_META_KEY) if isinstance(meta.get(UI_META_KEY), dict) else {}
    app = meta.get(APP_META_KEY) if isinstance(meta.get(APP_META_KEY), dict) else None

    def line(v: Any, n: int) -> str:
        return " ".join(v.split())[:n] if isinstance(v, str) else ""

    title = line(desk.get("title"), MAX_TITLE) or line(doc.get("display_name"), MAX_TITLE)
    description = line(desk.get("description"), MAX_JOB) or line(doc.get("description"), MAX_JOB)
    out: dict = {"name": name}
    if title:
        out["title"] = title
    if description:
        out["description"] = description
    color = desk.get("color")
    if isinstance(color, str) and COLOR_RE.match(color):
        out["color"] = color.lower()
    for flag in ("pinned", "hidden"):
        if desk.get(flag) is True:
            out[flag] = True
    if parked:
        out["parked"] = True
    if app is not None:
        out["app"] = True
        if app.get("template") in TEMPLATES:
            out["template"] = app["template"]
    return out


def fields_view(name: str, doc: Any) -> dict:
    """The three fields for the edit form: the app's own copy when the app made the bot, else what Desktop has."""
    base = bot_view(name, doc)
    meta = (doc or {}).get("ui_meta") if isinstance((doc or {}).get("ui_meta"), dict) else {}
    app = meta.get(APP_META_KEY) if isinstance(meta.get(APP_META_KEY), dict) else {}
    may = app.get("may") if isinstance(app.get("may"), dict) else None
    return {
        "name": name,
        "title": base.get("title") or name,
        "job": app.get("job") if isinstance(app.get("job"), str) else base.get("description", ""),
        "how": app.get("how") if isinstance(app.get("how"), str) else "",
        "template": app.get("template") if app.get("template") in TEMPLATES else None,
        "lang": app.get("lang") if app.get("lang") in LANGS else None,
        "may": {k: bool(may.get(k)) for k in MAY_KEYS} if may else None,
        "app": bool(app),
    }


def _title_key(s: str) -> str:
    return " ".join(s.split()).casefold()


def _feature_off(reason: str, message: str) -> QuickError:
    return QuickError(404, "feature_off", message, reason=reason)


class BotsService:
    def __init__(self, settings: Settings, source: Any, profile: str, *, now: Callable[[], float] = time.time):
        self.settings = settings
        self._source = source
        self.profile = profile  # the plugin's own profile; only the default (root) profile may create bots
        self._now = now
        self._lock = threading.Lock()

    # -- blocking parts (worker thread) -------------------------------------------------------------------

    def _rows(self) -> list[dict]:
        rows = []
        for name in sorted(self._source.names())[:MAX_LIST]:
            if not NAME_RE.match(name) or name == "default":
                continue
            rows.append(bot_view(name, self._source.read_profile_yaml(name), parked=self._source.is_parked(name)))
        return rows

    def _create_state(self, count: int) -> dict:
        if not self.settings.bots_enabled:
            return {"available": False, "reason": REASON_DISABLED}
        if self.profile != "default":
            return {"available": False, "reason": REASON_NOT_ROOT}
        try:
            active = self._source.multiplex_active()
        except Exception:
            return {"available": False, "reason": REASON_UNSUPPORTED}
        if active is False:
            return {"available": False, "reason": REASON_MULTIPLEX}
        if count >= self.settings.bots_limit:
            return {"available": False, "reason": REASON_LIMIT}
        return {"available": True}

    def _list(self) -> dict:
        rows = self._rows()
        return {"object": "list", "profile": self.profile, "limit": self.settings.bots_limit, "count": len(rows),
                "create": self._create_state(len(rows)), "data": rows}

    def _check_create(self) -> list[dict]:
        rows = self._rows()
        state = self._create_state(len(rows))
        if not state["available"]:
            if state["reason"] == REASON_LIMIT:
                raise QuickError(409, "limit", f"at most {self.settings.bots_limit} bots")
            raise _feature_off(state["reason"], "this Hermes cannot create bots here")
        return rows

    def _create(self, f: BotFields, api_key: str) -> dict:
        with self._lock:
            rows = self._check_create()
            if any(_title_key(r.get("title") or r["name"]) == _title_key(f.title) for r in rows):
                raise QuickError(409, "exists", "a bot with this name exists")
            taken = set(self._source.names()) | {"default"}
            name = pick_name(f.title, taken)
            color = f.color or default_color(name)
            try:
                self._source.create(name, f.job)
            except FileExistsError:
                raise QuickError(409, "exists", "a bot with this name exists") from None
            except ValueError:
                raise _bad("title", "Hermes refused this name") from None
            created = int(self._now() * 1000)
            try:
                self._source.drop_memory(name)
                self._source.write_soul(name, compose_soul(f))
                self._source.update_config(name, lambda cfg: apply_bot_config(cfg, f.may))
                self._source.set_env(name, "API_SERVER_KEY", api_key)
                self._source.update_profile_yaml(name, lambda doc: apply_ui_meta(
                    {**doc, "description": f.job, "description_auto": False}, {
                        UI_META_KEY: {"title": f.title, "description": f.job, "color": color, "shape": "circle",
                                      "imageKind": "shape", "created": created},
                        APP_META_KEY: {"v": 1, "template": f.template, "job": f.job, "how": f.how, "lang": f.lang,
                                       "may": {k: bool(f.may.get(k)) for k in MAY_KEYS}, "created": created},
                    }))
            except Exception as exc:
                logger.warning("bots: setting up %s failed (%s); parked", name, type(exc).__name__)
                try:
                    self._source.park(name)
                except Exception:
                    pass
                raise QuickError(500, "create_failed", "the bot could not be set up", reason=type(exc).__name__) from None
            self._source.notify(name)
            logger.info("bots: created %s (template %s)", name, f.template)  # never field text
            return bot_view(name, self._source.read_profile_yaml(name))

    def _known(self, name: str) -> None:
        if name == "default":
            raise QuickError(403, "default_bot", "the default profile is edited on the server")
        if not NAME_RE.match(name) or name not in set(self._source.names()):
            raise QuickError(404, "unknown_bot", "unknown bot")

    def _get(self, name: str) -> dict:
        self._known(name)
        return fields_view(name, self._source.read_profile_yaml(name))

    def _patch(self, name: str, body: Any) -> dict:
        with self._lock:
            if not self.settings.bots_enabled:
                raise _feature_off(REASON_DISABLED, "bots are disabled")
            self._known(name)
            doc = self._source.read_profile_yaml(name)
            meta = doc.get("ui_meta") if isinstance(doc.get("ui_meta"), dict) else {}
            app = meta.get(APP_META_KEY) if isinstance(meta.get(APP_META_KEY), dict) else {}
            if not isinstance(body, dict):
                raise QuickError(400, "invalid_json", "body must be a JSON object")
            unknown = [k for k in body if k not in ("title", "job", "how", "lang")]
            if unknown:
                raise _bad(unknown[0][:40], "only title, job, how and lang can be changed")
            merged = {"template": app.get("template") if app.get("template") in TEMPLATES else "own",
                      "lang": body.get("lang") or app.get("lang") or "en",
                      "may": app.get("may") if isinstance(app.get("may"), dict) else None,
                      "title": body.get("title"), "job": body.get("job"), "how": body.get("how")}
            f = parse_fields(merged)
            others = [r for r in self._rows() if r["name"] != name]
            if any(_title_key(r.get("title") or r["name"]) == _title_key(f.title) for r in others):
                raise QuickError(409, "exists", "a bot with this name exists")
            desk = dict(meta.get(UI_META_KEY)) if isinstance(meta.get(UI_META_KEY), dict) else {}
            desk.update({"title": f.title, "description": f.job})
            self._source.write_soul(name, compose_soul(f))
            self._source.update_profile_yaml(name, lambda d: apply_ui_meta(
                {**d, "description": f.job, "description_auto": False},
                {UI_META_KEY: desk, APP_META_KEY: {**app, "v": 1, "template": f.template, "job": f.job, "how": f.how,
                                                   "lang": f.lang, "may": {k: bool(f.may.get(k)) for k in MAY_KEYS}}}))
            self._source.notify(name)
            logger.info("bots: edited %s", name)
            return bot_view(name, self._source.read_profile_yaml(name))

    # -- async API used by the HTTP server ------------------------------------------------------------------

    async def _run(self, fn, *args):
        try:
            return await asyncio.to_thread(fn, *args)
        except QuickError:
            raise
        except Exception as exc:
            logger.info("bots: %s failed (%s)", getattr(fn, "__name__", "call"), type(exc).__name__)
            raise _feature_off(REASON_UNSUPPORTED, "this Hermes cannot manage bots") from None

    async def list(self) -> dict:
        if not self.settings.bots_enabled:
            raise _feature_off(REASON_DISABLED, "bots are disabled")
        return await self._run(self._list)

    async def create(self, body: Any) -> dict:
        if not self.settings.bots_enabled:
            raise _feature_off(REASON_DISABLED, "bots are disabled")
        f = parse_fields(body)
        key = body.get("api_key") if isinstance(body, dict) else None
        if not isinstance(key, str) or not (8 <= len(key) <= MAX_KEY) or re.search(r"\s|[\x00-\x1f\x7f]", key):
            raise _bad("api_key", "api_key is required (the key the bridge uses for this bot)")
        return await self._run(self._create, f, key)

    async def get(self, name: str) -> dict:
        if not self.settings.bots_enabled:
            raise _feature_off(REASON_DISABLED, "bots are disabled")
        return await self._run(self._get, name)

    async def patch(self, name: str, body: Any) -> dict:
        return await self._run(self._patch, name, body)
