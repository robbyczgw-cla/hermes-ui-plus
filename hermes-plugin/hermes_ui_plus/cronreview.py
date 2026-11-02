"""Cron review turns of reminders (``pre_llm_call`` hook). Pure stdlib, no Hermes import, never raises.

Hermes (v0.22.0 and v0.22.2, ``cron/scheduler_delivery.py``) hands a ``deliver: bot-chat`` job's output to the Bot
Chat as one more turn::

    [Cronjob "<name>" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]

    ⏰ Erinnerung: Dein Tee ist fertig.

That turn runs before the scheduler marks a one-shot job completed, in a session without the hermes-ui skill
(CLI lane, platform ``cli``/``tui``). Measured on the test instances: the model answers with a line about the job
("Cronjob „Tee“ hat eine Erinnerung ausgegeben … Keine Aktion nötig."), in English even for a German reminder,
and once (personal QA 0.2.1) said the job "is still listed as scheduled, so it may fire again".

This hook adds a short note to exactly that turn (Hermes appends a hook's ``context`` to the user message):

- the output starts with ``⏰`` (the hermes-ui skill's reminder prompt makes the run reply with only that line):
  reply with the reminder itself, nothing about the job;
- the job is one-shot (``repeat.times == 1`` or ``schedule.kind == "once"`` in ``<HERMES_HOME>/cron/jobs.json``):
  this is its only run and it is done after this turn, so no "still scheduled" / "may run again".

Anything else (reports, digests, recurring jobs without the marker, other turns) gets nothing: Hermes' own review
stays as it is.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

HEADER_RE = re.compile(r'\A\[Cronjob "(?P<name>[^"\n]{1,200})" output — scheduled job, not the user\.[^\]\n]*\]\n\n(?P<body>.*)\Z', re.S)
REMINDER_MARK = "⏰"
JOBS_FILE_MAX = 2_000_000

REMINDER_NOTE = (
    "[Hermes UI+] This turn delivers a reminder the user asked for. Reply with the reminder itself and nothing else: "
    "the ⏰ line from the output above, at most one short friendly sentence, in the language of that line. "
    "No tools, nothing about the job, its output, actions to take or its schedule."
)
ONE_SHOT_NOTE = (
    "[Hermes UI+] This is the only run of a one-time job: Hermes marks it completed right after this turn, even if a "
    "job list still shows it as scheduled. Never say it is still scheduled, may run again or will repeat."
)


def parse_review(user_message: Any) -> Optional[tuple[str, str]]:
    """``(job name, output)`` for a cron review turn, else None."""
    if not isinstance(user_message, str):
        return None
    m = HEADER_RE.match(user_message)
    return (m.group("name"), m.group("body").strip()) if m else None


def _jobs(home: Path) -> list[dict]:
    path = home / "cron" / "jobs.json"
    try:
        if path.stat().st_size > JOBS_FILE_MAX:
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    jobs = data.get("jobs") if isinstance(data, dict) else data
    return [j for j in jobs if isinstance(j, dict)] if isinstance(jobs, list) else []


def is_one_shot(job: dict) -> bool:
    repeat = job.get("repeat")
    times = repeat.get("times") if isinstance(repeat, dict) else repeat
    schedule = job.get("schedule")
    kind = schedule.get("kind") if isinstance(schedule, dict) else None
    return times == 1 or kind == "once"


def one_shot_named(name: str, home: Path) -> bool:
    """True when every job of that name in this profile's store is one-shot (and there is at least one)."""
    same = [j for j in _jobs(home) if j.get("name") == name]
    return bool(same) and all(is_one_shot(j) for j in same)


def review_context(user_message: Any, home: Path) -> Optional[str]:
    """The note for a cron review turn of a reminder or a one-shot job; None for every other turn."""
    parsed = parse_review(user_message)
    if parsed is None:
        return None
    name, body = parsed
    parts = []
    if body.startswith(REMINDER_MARK):
        parts.append(REMINDER_NOTE)
    if one_shot_named(name, home):
        parts.append(ONE_SHOT_NOTE)
    return "\n".join(parts) or None


def make_hook(home_fn):
    """``pre_llm_call`` callback; ``home_fn()`` -> the profile's Hermes home (read per call: a profile switch)."""

    def pre_llm_call(*args: Any, **kwargs: Any) -> Optional[dict]:
        # Hermes passes keywords today; a version passing the arguments by position must not lose the turn or the note
        try:
            home = Path(home_fn())
            candidates = [kwargs["user_message"]] if "user_message" in kwargs else list(args)
            ctx = next((c for c in (review_context(m, home) for m in candidates) if c), None)
        except Exception:  # a broken note must never cost the turn
            return None
        return {"context": ctx} if ctx else None

    return pre_llm_call


def home_from_env() -> Path:
    home = os.environ.get("HERMES_HOME", "").strip()
    return Path(os.path.expanduser(home)) if home else Path.home() / ".hermes"
