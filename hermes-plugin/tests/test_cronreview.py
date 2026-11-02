import json
import shutil
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (sys.path)
from hermes_ui_plus import cronreview as cr

# the exact turn Hermes v0.22.0 / v0.22.2 writes into the Bot Chat (cron/scheduler_delivery.py), with the outputs
# the test instance produced for the skill's reminder prompt and for an old-style prompt (personal QA 0.2.1)
HEAD = '[Cronjob "{}" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\n'


def turn(name, body):
    return HEAD.format(name) + body


class CronReviewTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="hui-cronreview-"))
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)

    def jobs(self, *jobs):
        (self.home / "cron").mkdir(exist_ok=True)
        (self.home / "cron" / "jobs.json").write_text(json.dumps({"jobs": list(jobs), "updated_at": "x"}), encoding="utf-8")

    def test_parse_only_the_cron_review_turn(self):
        self.assertEqual(cr.parse_review(turn("Tee", "⏰ Erinnerung: Dein Tee ist fertig.")), ("Tee", "⏰ Erinnerung: Dein Tee ist fertig."))
        for other in ("erinner mich in 2 Minuten an den Tee", "[Cronjob \"Tee\"] hi", None, ["list"], "x" + turn("Tee", "⏰ a")):
            self.assertIsNone(cr.parse_review(other), other)

    def test_one_shot_reminder_gets_both_notes(self):
        # live 0.22.0 run: the store still says "scheduled" (completed: 1 comes after this turn)
        self.jobs({"id": "8d2080ecf29d", "name": "Tee-Erinnerung", "schedule": {"kind": "once", "display": "once in 2m"},
                   "repeat": {"times": 1, "completed": 0}, "state": "scheduled", "deliver": "bot-chat"})
        ctx = cr.review_context(turn("Tee-Erinnerung", "⏰ Erinnerung: Dein Tee ist fertig."), self.home)
        self.assertIn("Reply with the reminder itself and nothing else", ctx)
        self.assertIn("in the language of that line", ctx)
        self.assertIn("Never say it is still scheduled, may run again or will repeat", ctx)

    def test_old_one_shot_prompt_without_marker_still_gets_the_schedule_note(self):
        # personal QA 0.2.1: "The job is still listed as scheduled, so it may fire again, but it is set to run once."
        self.jobs({"name": "Personal021 tea check", "schedule": {"kind": "once"}, "repeat": {"times": 1, "completed": 0}})
        ctx = cr.review_context(turn("Personal021 tea check", "Personal021 tea check."), self.home)
        self.assertEqual(ctx, cr.ONE_SHOT_NOTE)

    def test_recurring_reminder_gets_the_reminder_note_only(self):
        self.jobs({"name": "Plants", "schedule": {"kind": "cron", "expr": "0 8 * * 1"}, "repeat": {"times": None, "completed": 3}})
        self.assertEqual(cr.review_context(turn("Plants", "⏰ Reminder: water the plants."), self.home), cr.REMINDER_NOTE)

    def test_reports_and_unknown_jobs_are_left_alone(self):
        self.jobs({"name": "News digest", "schedule": {"kind": "cron"}, "repeat": {"times": None}},
                  {"name": "Twice", "repeat": {"times": 1}}, {"name": "Twice", "repeat": {"times": None}})
        self.assertIsNone(cr.review_context(turn("News digest", "Top stories today: …"), self.home))
        self.assertIsNone(cr.review_context(turn("Twice", "done"), self.home))  # not every job of that name is one-shot
        self.assertIsNone(cr.review_context(turn("Gone", "done"), self.home))

    def test_broken_or_missing_store_never_raises(self):
        self.assertEqual(cr.review_context(turn("X", "⏰ Reminder: tea."), self.home), cr.REMINDER_NOTE)  # no cron dir
        (self.home / "cron").mkdir()
        (self.home / "cron" / "jobs.json").write_text("{not json", encoding="utf-8")
        self.assertIsNone(cr.review_context(turn("X", "done"), self.home))
        (self.home / "cron" / "jobs.json").write_text(json.dumps([{"name": "X", "repeat": 1}, "junk"]), encoding="utf-8")
        self.assertEqual(cr.review_context(turn("X", "done"), self.home), cr.ONE_SHOT_NOTE)

    def test_hook_accepts_the_arguments_by_position_too(self):
        self.jobs({"name": "Tee", "repeat": {"times": 1}, "schedule": {"kind": "once"}})
        hook = cr.make_hook(lambda: self.home)
        text = turn("Tee", "⏰ Erinnerung: Dein Tee ist fertig.")
        by_keyword = hook(user_message=text)
        self.assertTrue(by_keyword)
        self.assertEqual(hook(text), by_keyword)
        self.assertEqual(hook("session-1", text, []), by_keyword)
        self.assertIsNone(hook("session-1", "hallo", []))
        self.assertIsNone(hook())

    def test_hook_returns_hermes_context_shape_and_swallows_errors(self):
        self.jobs({"name": "Tee", "repeat": {"times": 1}})
        hook = cr.make_hook(lambda: self.home)
        out = hook(session_id="s", user_message=turn("Tee", "⏰ Erinnerung: Tee."), platform="cli", conversation_history=[])
        self.assertEqual(set(out), {"context"})
        self.assertIsNone(hook(user_message="hello", platform="api_server"))
        self.assertIsNone(cr.make_hook(lambda: 1 / 0)(user_message=turn("Tee", "⏰ a")))


if __name__ == "__main__":
    unittest.main()
