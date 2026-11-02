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
import os
import tempfile
import logging
import threading
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

logger = logging.getLogger("hermes_ui_plus.adapter")


def hermes_call_llm() -> Callable[..., Any]:
    from agent.auxiliary_client import call_llm  # the model call

    return call_llm


def _scope_modules() -> tuple[Any, Any]:
    """Hermes' profile-scope helpers and its home-override module; None for what this Hermes lacks (no secret scope
    = no profile multiplexing)."""
    try:
        from agent import secret_scope  # profile-scoped credentials (Hermes v0.22+)
    except Exception:
        secret_scope = None
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


@contextlib.contextmanager
def forced_profile_scope(home: str) -> Iterator[None]:
    """Run a read in ANOTHER profile's home: always set Hermes' HERMES_HOME override to ``home`` (also when the caller
    already has a scope, e.g. a turn of the default profile), plus that profile's secret scope when Hermes multiplexes
    and has the helpers (so ``${VAR}`` refs in its config resolve against its own .env). File reads only need the
    override: a secret scope that cannot be built is skipped. Raises when this Hermes has no home override (the read
    would silently answer for the wrong profile)."""
    ss, hc = _scope_modules()
    set_home = getattr(hc, "set_hermes_home_override", None)
    reset_home = getattr(hc, "reset_hermes_home_override", None)
    if not callable(set_home) or not callable(reset_home):
        raise RuntimeError("this Hermes has no HERMES_HOME override")
    home_token = set_home(str(home))
    secret_token = None
    try:
        if _scope_state(ss) != "off" and all(callable(getattr(ss, n, None)) for n in _SCOPE_HELPERS):
            try:
                secret_token = ss.set_secret_scope(ss.build_profile_secret_scope(Path(home)), profile_home=str(home))
            except Exception as exc:  # the override alone is enough for file reads
                logger.debug("library: no secret scope for another profile (%s)", type(exc).__name__)
        yield
    finally:
        if secret_token is not None:
            with contextlib.suppress(Exception):
                ss.reset_secret_scope(secret_token)
        with contextlib.suppress(Exception):
            reset_home(home_token)


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


def _skills_helpers(skills_tool: Any) -> tuple[Any, Any]:
    """(find_all_skills, sort_skills) of this Hermes: public names since v0.22.3 (upstream 93fafc4d6f), the
    underscore names before. AttributeError when neither exists (becomes ``hermes_unsupported``)."""
    find_all = getattr(skills_tool, "find_all_skills", None) or getattr(skills_tool, "_find_all_skills")
    sort = getattr(skills_tool, "sort_skills", None) or getattr(skills_tool, "_sort_skills")
    return find_all, sort


class HermesLibrary:
    """Read-only skills/memory source for ``library.LibraryService`` (hermes-agent v0.22 internals, all imported
    lazily inside the plugin profile's scope; any failure propagates and becomes ``hermes_unsupported``).

        tools.skills_tool: find_all_skills(skip_disabled=True), sort_skills (v0.22.3+; v0.22.2 and older:
            _find_all_skills, _sort_skills)
        tools.skill_manager_tool: _find_skill
        tools.skill_usage: _read_bundled_names, _read_hub_installed_names, _external_skill_names
        hermes_cli.config.load_config, hermes_cli.skills_config.get_disabled_skills
        hermes_cli.profiles.list_profile_names, get_profile_dir (other profiles, root profile's plugin)
        hermes_constants.set_hermes_home_override / reset_hermes_home_override (forced for other profiles)

    Same provenance order as the dashboard (hub > bundled > external), the rest is called ``local``.

    ``force=True`` (a source made by ``for_profile``) reads another profile: every call runs in
    ``forced_profile_scope(home)``; Hermes' config and skills readers follow the home override.
    """

    def __init__(self, home: Optional[str] = None, *, force: bool = False):
        self.home = home
        self.force = force

    def _scope(self) -> Any:
        return forced_profile_scope(str(self.home)) if self.force else profile_scope(self.home)

    @staticmethod
    def profile_names() -> list[str]:
        """Named profiles another library source can be made for. Raises without a home override (see
        ``forced_profile_scope``) or without Hermes' profile list."""
        _ss, hc = _scope_modules()
        if not all(callable(getattr(hc, n, None)) for n in ("set_hermes_home_override", "reset_hermes_home_override")):
            raise RuntimeError("this Hermes has no HERMES_HOME override")
        from hermes_cli.profiles import list_profile_names

        return [n for n in list_profile_names() if n != "default"]

    @staticmethod
    def for_profile(name: str) -> tuple["HermesLibrary", str]:
        from hermes_cli.profiles import get_profile_dir

        d = Path(get_profile_dir(name))
        if d.name != name or d.parent.name != "profiles":
            raise ValueError("unexpected profile directory")
        return HermesLibrary(str(d), force=True), str(d)

    def skills(self) -> list[dict]:
        with self._scope():
            from hermes_cli.config import load_config
            from hermes_cli.skills_config import get_disabled_skills
            from tools.skill_usage import _external_skill_names, _read_bundled_names, _read_hub_installed_names
            from tools import skills_tool

            cfg = load_config()
            disabled = get_disabled_skills(cfg) | get_disabled_skills(cfg, "api_server")  # the API server's view
            bundled, hub = set(_read_bundled_names()), set(_read_hub_installed_names())
            external = set(_external_skill_names()) - bundled - hub
            out = []
            find_all, sort = _skills_helpers(skills_tool)
            for s in sort(find_all(skip_disabled=True)):
                n = s["name"]
                out.append({"name": n, "description": s.get("description") or "", "category": s.get("category"),
                            "enabled": n not in disabled,
                            "source": "hub" if n in hub else "bundled" if n in bundled
                            else "external" if n in external else "local"})
            return out

    def skill_md(self, name: str) -> Optional[bytes]:
        """SKILL.md bytes of the skill Hermes resolves ``name`` to (at most 256 KiB + 1), None if there is none."""
        with self._scope():
            from tools.skill_manager_tool import _find_skill

            found = _find_skill(name)
            if not found:
                return None
            path = Path(found["path"]) / "SKILL.md"
            if not path.is_file():
                return None
            with open(path, "rb") as f:
                return f.read(256 * 1024 + 1)

    def memory_settings(self) -> dict:
        with self._scope():
            from hermes_cli.config import load_config

            mem = load_config().get("memory") or {}
            if not isinstance(mem, dict):
                mem = {}

            def num(key: str, default: int) -> int:
                v = mem.get(key, default)
                return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else default

            def on(key: str) -> bool:
                v = mem.get(key, True)
                return v if isinstance(v, bool) else True

            provider = mem.get("provider")
            return {"provider": provider.strip() if isinstance(provider, str) and provider.strip() else None,
                    "memory_enabled": on("memory_enabled"), "user_enabled": on("user_profile_enabled"),
                    "memory_limit": num("memory_char_limit", 2200), "user_limit": num("user_char_limit", 1375)}


def _write_atomic(path: Path, data: bytes, mode: Optional[int] = None) -> None:
    """Write ``data`` next to ``path`` and rename it into place (keeps the old file's mode unless ``mode`` is given)."""
    if mode is None:
        try:
            mode = path.stat().st_mode & 0o777
        except OSError:
            mode = 0o644
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".hui-tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


class HermesBots:
    """Profiles as bots for ``bots.BotsService`` (hermes-agent v0.22 internals, imported lazily per call; any failure
    propagates and becomes ``hermes_unsupported`` or ``create_failed``).

        hermes_cli.profiles: list_profile_names, get_profile_dir, create_profile(clone_from="default")
        hermes_cli.gateway_multiplex_served.notify_multiplexer_profiles_changed
        agent.secret_scope.is_multiplex_active
        hermes_yaml (v0.22.2: ruamel with Hermes' YAML 1.1 policy), else PyYAML (older images), for profile.yaml /
        config.yaml of the new profile
        tools.approval.load_permanent_allowlist (revoke: re-sync Hermes' in-process "always" set of that profile)
        hermes_constants.set_hermes_home_override / reset_hermes_home_override (around that re-sync)

    Creating a profile is file work plus a rescan of the running multiplexer: no package manager, no gateway restart
    (docs/BOTS-SERVER.md). Files are only written inside ``<root>/profiles/<name>/`` of a name Hermes validated.
    """

    MEMORY_FILES = ("MEMORY.md", "USER.md")

    @staticmethod
    def _profiles() -> Any:
        from hermes_cli import profiles  # profile directories, create, list

        return profiles

    def names(self) -> list[str]:
        return [n for n in self._profiles().list_profile_names() if n != "default"]

    def _dir(self, name: str) -> Path:
        d = Path(self._profiles().get_profile_dir(name))
        if d.name != name or d.parent.name != "profiles":
            raise ValueError("unexpected profile directory")
        return d

    @staticmethod
    def _yaml() -> Any:
        try:
            import hermes_yaml  # Hermes' own YAML policy (v0.22.2)

            return hermes_yaml
        except ImportError:
            import yaml  # PyYAML, what older Hermes images read configs with

            return yaml

    def _load_yaml(self, path: Path) -> dict:
        yaml = self._yaml()
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        return data if isinstance(data, dict) else {}

    def _rmw_yaml(self, path: Path, fn: Callable[[dict], dict]) -> None:
        doc = fn(self._load_yaml(path))
        # no line folding: a folded long value does not always read back identical (Hermes #119844)
        text = self._yaml().safe_dump(doc, sort_keys=False, allow_unicode=True, width=2**31 - 1)
        _write_atomic(path, text.encode("utf-8"))

    def read_profile_yaml(self, name: str) -> dict:
        try:
            return self._load_yaml(self._dir(name) / "profile.yaml")
        except Exception:
            return {}

    def _home(self, name: str) -> Path:
        """Hermes home of a profile; ``default`` is the root (where the default profile lives)."""
        return Path(self._profiles().get_profile_dir("default")) if name == "default" else self._dir(name)

    def is_parked(self, name: str) -> bool:
        return (self._dir(name) / "gateway.parked").exists()

    def park_marker(self, name: str) -> Optional[str]:
        """First line of gateway.parked (Hermes ignores the content; ours says who parked it), None = not parked."""
        try:
            with open(self._dir(name) / "gateway.parked", "rb") as f:
                head = f.read(512)
        except FileNotFoundError:
            return None
        return head.decode("utf-8", errors="replace").splitlines()[0] if head else ""

    def write_park_marker(self, name: str, text: str) -> bool:
        try:
            fd = os.open(self._dir(name) / "gateway.parked", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        return True

    def remove_park_marker(self, name: str) -> None:
        with contextlib.suppress(FileNotFoundError):
            (self._dir(name) / "gateway.parked").unlink()

    def _allowlist_of(self, cfg: dict) -> list:
        raw = cfg.get("command_allowlist")
        if isinstance(raw, str):  # old ``hermes config set`` wrote the list as a YAML string; Hermes still reads it
            try:
                raw = self._yaml().safe_load(raw)
            except Exception:
                raw = None
        return raw if isinstance(raw, list) else []

    def read_config(self, name: str) -> dict:
        cfg = self._load_yaml(self._home(name) / "config.yaml")
        if "command_allowlist" in cfg:
            cfg["command_allowlist"] = self._allowlist_of(cfg)
        return cfg

    def revoke_allowlist(self, name: str, pattern: str) -> None:
        """Drop ``pattern`` from config.yaml (atomic), then let Hermes re-read that profile's list so the next
        command asks again without a restart. Session approvals ("always" also approves the running session) stay
        until that session ends: Hermes keeps them in memory only."""
        home = self._home(name)

        def drop(cfg: dict) -> dict:
            cfg = dict(cfg)
            cfg["command_allowlist"] = [p for p in self._allowlist_of(cfg) if p != pattern]
            return cfg

        self._rmw_yaml(home / "config.yaml", drop)
        self._resync_permanent(home, root=name == "default")

    @staticmethod
    def _resync_permanent(home: Path, *, root: bool) -> None:
        """``tools.approval.load_permanent_allowlist()`` replaces the governing in-process set of the current home with
        the file AND records its baseline, so a later "always" save cannot write the removed entry back. A routed
        profile is governed under a home override; the root profile both unscoped (module-level set) and under an
        override of the root home (the multiplexer runs the root's API-server turns that way)."""
        try:
            from tools import approval  # Hermes' approval state (in-process permanent allow-list)
        except Exception as exc:  # no Hermes approval module in this process: the file is all there is
            logger.debug("bots: no approval module to re-sync (%s)", type(exc).__name__)
            return
        load = getattr(approval, "load_permanent_allowlist", None)
        if not callable(load):
            return
        _ss, hc = _scope_modules()
        set_home = getattr(hc, "set_hermes_home_override", None)
        reset_home = getattr(hc, "reset_hermes_home_override", None)
        can_override = callable(set_home) and callable(reset_home)
        if root:
            if can_override:
                token = set_home(None)  # explicitly unscoped, whatever the caller's context holds
                try:
                    load()
                finally:
                    with contextlib.suppress(Exception):
                        reset_home(token)
            else:
                load()
        if can_override:
            with forced_profile_scope(str(home)):
                load()

    def create(self, name: str, description: str) -> None:
        self._profiles().create_profile(name, clone_from="default", clone_config=True, description=description)

    def drop_memory(self, name: str) -> None:
        mem = self._dir(name) / "memories"
        for f in self.MEMORY_FILES:
            with contextlib.suppress(FileNotFoundError):
                (mem / f).unlink()

    def write_soul(self, name: str, text: str) -> None:
        _write_atomic(self._dir(name) / "SOUL.md", text.encode("utf-8"))

    def update_config(self, name: str, fn: Callable[[dict], dict]) -> None:
        self._rmw_yaml(self._dir(name) / "config.yaml", fn)

    def update_profile_yaml(self, name: str, fn: Callable[[dict], dict]) -> None:
        self._rmw_yaml(self._dir(name) / "profile.yaml", fn)

    def set_env(self, name: str, key: str, value: str) -> None:
        path = self._dir(name) / ".env"
        try:
            lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        except FileNotFoundError:
            lines = []
        kept = [ln for ln in lines if ln.strip().removeprefix("export ").split("=", 1)[0].strip() != key]
        kept.append(f"{key}={value}")
        _write_atomic(path, ("\n".join(kept) + "\n").encode("utf-8"), mode=0o600)

    def park(self, name: str) -> None:
        (self._dir(name) / "gateway.parked").write_text("hermes-ui-plus: setup failed\n", encoding="utf-8")

    def notify(self, name: str) -> None:
        try:
            from hermes_cli.gateway_multiplex_served import notify_multiplexer_profiles_changed  # rescan now

            notify_multiplexer_profiles_changed(name)
        except Exception as exc:  # the multiplexer rescans every 30 s anyway
            logger.debug("bots: rescan notification failed (%s)", type(exc).__name__)

    @staticmethod
    def multiplex_active() -> Optional[bool]:
        ss, _ = _scope_modules()
        if ss is None or not hasattr(ss, "is_multiplex_active"):
            raise RuntimeError("no profile multiplexing in this Hermes")
        return bool(ss.is_multiplex_active())
