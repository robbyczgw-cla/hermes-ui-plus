/// <reference types="node" />
// The reminder card against what Hermes v0.22.2 really stores for "Erinnere mich morgen um 9 an Tee kaufen" and the
// follow-up "kannst du das auf 10 uhr verschieben?" (test instance, cronjob toolset on, 2026-10-20): the model calls the
// cron tool through the lazy-discovery wrapper (`tool_describe`, then `tool_call` with one inner call), the result row
// names `cronjob_manage`. Session id and the long tool_describe/list results are shortened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from '../hermes/sessions.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import { deviceReminderAt, parseReminders, reminderDelivery } from './reminder.ts';

const ROWS = [
{
"id": 293,
"session_id": "hui-test-reminder",
"role": "user",
"content": "Erinnere mich morgen um 9 an Tee kaufen",
"timestamp": 1792473572.366265
},
{
"id": 294,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "",
"tool_calls": [
{
"id": "toolu_01JxZH8g5c5gab5u7Nin1uZq",
"type": "function",
"function": {
"name": "tool_describe",
"arguments": "{\"names\": [\"cronjob_manage\"]}"
}
}
],
"timestamp": 1792473574.609973,
"finish_reason": "tool_calls"
},
{
"id": 295,
"session_id": "hui-test-reminder",
"role": "tool",
"content": "{\"tools\": {\"cronjob_manage\": {\"description\": \"Manage scheduled cron jobs: action='create' schedules a job from a prompt and/or skills; 'list' inspects jobs; 'update'/'pause'/'resume'/'remove' manage one by job_id (always list first — never guess job IDs); 'run' fires a job immediately in the BACKGROUND (returns a handle at once, outcome re-enters the conversation when done — do not wait or poll; optional 'prompt' adds transient context for that fire only).\\n\\nJobs run on the main agent model (whatever `hermes model` is set to when they fire) unless pinned.\\n\\nJobs run in a fresh session with no current-chat context, so prompts must be self-contained, and the agent's FINAL RESPONSE is what gets delivered — cron runs are autonomous and cannot ask questions. Jobs run on the main agent model (whatever `hermes model` is set to when they fire) unless the user pins one. Prefer updating an existing job over creating near-duplicates.\", \"parameters\": {\"type\": \"object\", \"properties\": {\"paused\": {\"type\": \"boolean\", \"description\": \"Create only: persist disabled atomically. Resume to schedule; explicit run remains available. Default false.\"}, \"paused_reason\": {\"type\": \"string\", \"description\": \"Create only: auditable reason; requires paused=true.\"}, \"action\": {\"type\": \"string\", \"description\": \"One of: create, list, update, pause, resume, remove, run. When action=create, the 'schedule' and 'prompt' fields are REQUIRED.\"}, \"job_id\": {\"type\": \"string\", \"description\": \"Required for update/pause/resume/remove/run.\"}, \"pinned\": {\"type\": \"boolean\", \"description\": \"For create/update. ONLY set when the user explicitly asks to pin (or unpin) a job's model. pinned=true locks the CURRENT main agent model (and its provider) onto the job so later `hermes model` / `/model` changes never touch it; pinned=false releases the lock so the job follows the main agent model again. Never set it on your own initiative: by default jobs follow the main model.\"}, \"prompt\": {\"type\": \"string\", \"description\": \"For create: the full self-contained prompt (paired with any skills as the task instruction). For run: optional transient context for that single fire (never persisted).\"}, \"schedule\": {\"type\": \"string\", \"description\": \"REQUIRED for create. Schedule forms: (1) recurring interval — '30m', 'every 2h', 'every hour' (EVERY 30 minutes / 2 hours / hour, forever by default); (2) explicit one-shot by duration — 'in 30m', 'in 2h' (fires ONCE that far from now; use this for 'remind me in N minutes' — do NOT hand-compute an absolute timestamp); (3) natural day/time — 'every monday 9am', 'weekdays at 9am', 'every day at 9am' (recurring weekly/daily); (4) cron syntax — '0 9 * * *' (daily 9am); (5) absolute one-shot — ISO timestamp '2026-06-01T09:00:00'.\"}, \"name\": {\"type\": \"string\", \"description\": \"Optional human-friendly name\"}, \"repeat\": {\"type\": \"integer\", \"description\": \"Optional repeat count. Omit for defaults (once for one-shot, forever for recurring).\"}, \"deliver\": {\"type\": \"string\", \"description\": \"Where the job's output is POSTED as a one-way message (the job itself always runs in a fresh session with no chat context). Omit to address the chat/topic this job was created from. Otherwise: 'local' (save only, no delivery), 'all' (every connected home channel, resolved at fire time), 'bot-chat' or 'bot-chat:<profile>' (inject into a Bot Chat as a real message), or platform:chat_id:thread_id (e.g. 'telegram:-1001234567890:17585'). Comma-combine like 'origin,all'.\"}, \"failure_deliver\": {\"type\": \"string\", \"description\": \"Optional override target for FAILURE notices only (same grammar as deliver). When set, engine failure/interruption notices go here instead of the deliver target; 'local' suppresses them entirely (state still recorded in cron list/run history). Use for jobs delivering into shared channels where failure noise is unwanted. Omit = failures follow deliver (default). On update, '' clears.\"}, \"skills\": {\"type\": \"array\", \"items\": {\"type\": \"string\"}, \"description\": \"Optional ordered skill names loaded before the cron prompt. On update, [] clears.\"}, \"script\": {\"type\": \"string\", \"description\": \"Optional script run each tick; stdout is injected into the agent's prompt as context (with no_agent=True the script IS the job). Relative paths resolve under ~/hermes-test-mac/data/scripts/; .sh/.bash via bash, else Python. On update, '' clears.\"}, \"monitor\": {\"type\": \"string\", \"description\": \"Optional change-detector that gates the agent: an http(s) URL (fetched each tick) or a script path (same rules as `script`, run each tick) — cheap, no LLM. Output identical to the previous tick skips the agent run entirely; changed output wakes the agent with a diff injected into the prompt. First tick always runs (baseline). Output must be deterministic (no timestamps) or every tick looks changed. Incompatible with no_agent. On update, '' clears.\"}, \"no_agent\": {\"type\": \"boolean\", \"default\": false, \"description\": \"True = no LLM: the scheduler runs `script` (required) on schedule and delivers its stdout verbatim; empty stdout sends nothing (watchdog pattern). Use for script-only pings with fixed output; keep False for anything needing reasoning.\"}, \"context_from\": {\"type\": \"array\", \"items\": {\"type\": \"string\"}, \"description\": \"Optional job ID(s) whose most recent completed output is injected as context each run — chains jobs (A collects, B processes). For a job's OWN previous output prefer `continuity`. On update, [] clears.\"}, \"continuity\": {\"type\": \"boolean\", \"description\": \"True = each run sees the job's own previous output, so it can dedupe and continue where it left off (scouts, monitors, incremental digests). Default false. On update, false turns it off.\"}, \"enabled_toolsets\": {\"type\": \"array\", \"items\": {\"type\": \"string\"}, \"description\": \"Optional toolset names to restrict the job's agent to (e.g. [\\\"web\\\", \\\"terminal\\\"]) — cuts token overhead. Infer from the prompt. Omit for all default tools. [] = an explicit zero-tool allowlist (the job's agent gets no toolsets, MCP servers included unless named); it is preserved as [], never widened back to the default.\"}, \"workdir\": {\"type\": \"string\", \"description\": \"Optional absolute existing path to run the job from: injects that directory's AGENTS.md/context files and anchors terminal/file tools there. On update, '' clears.\"}, \"attach_to_session\": {\"type\": \"boolean\", \"description\": \"True = the job's delivery is CONTINUABLE — the user can reply and the agent has the brief in context (threads on thread-capable platforms, mirrored into the DM elsewhere). Use for conversational recurring jobs (briefings); leave unset for fire-and-forget alerts. Scope: the job's own conversation only — the origin chat, the home-channel fallback when deliver='origin' captured no origin (script-created jobs), a user-written bare platform target (deliver='slack' — that platform's home channel), or the job's single explicit platform:chat target (this flag is the only way to attach an explicit target). Broadcast targets are never attached; no effect when deliver='local'.\"}}, \"required\": [\"action\"]}}}}",
"tool_call_id": "toolu_01JxZH8g5c5gab5u7Nin1uZq",
"tool_name": "tool_describe",
"timestamp": 1792473574.6345558
},
{
"id": 296,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "",
"tool_calls": [
{
"id": "toolu_01RhQBggXpHuFGx6ky9TzKXn",
"type": "function",
"function": {
"name": "tool_call",
"arguments": "{\"calls\": [{\"name\": \"cronjob_manage\", \"arguments\": {\"action\": \"create\", \"schedule\": \"2026-10-21T09:00:00\", \"prompt\": \"Erinnerung: Tee kaufen. Schreibe dem Nutzer eine kurze Erinnerung auf Deutsch, dass er heute Tee kaufen soll.\", \"name\": \"Tee kaufen\", \"repeat\": 1}}]}"
}
}
],
"timestamp": 1792473575.9728909,
"finish_reason": "tool_calls"
},
{
"id": 297,
"session_id": "hui-test-reminder",
"role": "tool",
"content": "{\"success\": true, \"job_id\": \"06ccd283e6bb\", \"name\": \"Tee kaufen\", \"skill\": null, \"skills\": [], \"schedule\": \"once at 2026-10-21 09:00\", \"repeat\": \"once\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-21T09:00:00+02:00\", \"job\": {\"job_id\": \"06ccd283e6bb\", \"name\": \"Tee kaufen\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Erinnerung: Tee kaufen. Schreibe dem Nutzer eine kurze Erinnerung auf Deutsch, dass er heute Tee kau...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once at 2026-10-21 09:00\", \"repeat\": \"once\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-21T09:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null}, \"message\": \"Cron job 'Tee kaufen' created. This is a local-only cron job: its output is saved (view it with cronjob(action='list')) but will NOT be delivered back into this session — CLI/TUI and stateless HTTP API sessions have no live-delivery channel. To be notified when it runs, recreate or update the job with deliver set to a gateway-connected platform, e.g. deliver='telegram' or deliver='all'.\", \"gateway_running\": true}",
"tool_call_id": "toolu_01RhQBggXpHuFGx6ky9TzKXn",
"tool_name": "cronjob_manage",
"timestamp": 1792473576.3095958
},
{
"id": 298,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "Ich habe die Erinnerung für morgen, Mittwoch, 21. Oktober, 09:00 Uhr (CEST) angelegt. Sie läuft aber nur lokal und wird nicht in dieses Chatfenster zugestellt. Wenn du sie auf Telegram oder einen ande",
"timestamp": 1792473577.9898071,
"finish_reason": "stop"
},
{
"id": 337,
"session_id": "hui-test-reminder",
"role": "user",
"content": "kannst du das auf 10 uhr verschieben?",
"timestamp": 1792474311.079869
},
{
"id": 341,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "",
"tool_calls": [
{
"id": "toolu_01XHXdT75M2mp6x6ixoYx5zx",
"type": "function",
"function": {
"name": "tool_call",
"arguments": "{\"calls\": [{\"name\": \"cronjob_manage\", \"arguments\": {\"action\": \"list\"}}]}"
}
}
],
"timestamp": 1792474313.934677,
"finish_reason": "tool_calls"
},
{
"id": 342,
"session_id": "hui-test-reminder",
"role": "tool",
"content": "{\"success\": true, \"count\": 6, \"jobs\": [{\"job_id\": \"06ccd283e6bb\", \"name\": \"Tee kaufen\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Erinnerung: Tee kaufen. Schreibe dem Nutzer eine kurze Erinnerung auf Deutsch, dass er heute Tee kau...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once at 2026-10-21 09:00\", \"repeat\": \"once\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-21T09:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null}, {\"job_id\": \"0a45dc931de2\", \"name\": \"Buy tea reminder\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Reminder: buy tea. Send the user a short reminder message saying to buy tea.\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once at 2026-10-21 09:00\", \"repeat\": \"once\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-21T09:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null}, {\"job_id\": \"de0a88765e1e\", \"name\": \"Vienna weather Monday 8am\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Get the current weather forecast for Vienna, Austria for today and the coming week, using web search...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"every monday 8am\", \"repeat\": \"forever\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-26T08:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null, \"enabled_toolsets\": [\"web\"]}, {\"job_id\": \"84e38b5b7a31\", \"name\": \"Wetter Wien Montag 8 Uhr\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Hole das aktuelle Wetter und die Vorhersage für heute und die kommenden Tage für Wien, Österreich (T...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"every monday 8am\", \"repeat\": \"forever\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-26T08:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null, \"enabled_toolsets\": [\"web\"], \"attach_to_session\": true}, {\"job_id\": \"810dc54aa849\", \"name\": \"Fenster zumachen\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Erinnerung an den Nutzer senden: Mach jetzt das Fenster zu. Antworte nur mit einer kurzen deutschen ...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once in 2m\", \"repeat\": \"1/1\", \"deliver\": \"all\", \"next_run_at\": null, \"last_run_at\": \"2026-10-20T07:23:19.921749+02:00\", \"last_status\": \"delivery_failed\", \"last_delivery_error\": \"no delivery target resolved for deliver=all\", \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": false, \"state\": \"completed\", \"paused_at\": null, \"paused_reason\": null}, {\"job_id\": \"b021f9c3d39b\", \"name\": \"Teewasser\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Gib dem Nutzer genau diese Erinnerung auf Deutsch aus, ohne weitere Angaben: Zeit, Teewasser aufsetz...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once at 2026-10-20 07:29\", \"repeat\": \"1/1\", \"deliver\": \"local\", \"next_run_at\": null, \"last_run_at\": \"2026-10-20T07:29:19.461349+02:00\", \"last_status\": \"ok\", \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": false, \"state\": \"completed\", \"paused_at\": null, \"paused_reason\": null}], \"gateway_running\": true}",
"tool_call_id": "toolu_01XHXdT75M2mp6x6ixoYx5zx",
"tool_name": "cronjob_manage",
"timestamp": 1792474313.95897
},
{
"id": 343,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "",
"tool_calls": [
{
"id": "toolu_017GJtJ9xi6YXeimjxuBQGAd",
"type": "function",
"function": {
"name": "tool_call",
"arguments": "{\"calls\": [{\"arguments\": {\"action\": \"update\", \"job_id\": \"06ccd283e6bb\", \"schedule\": \"2026-10-21T10:00:00\"}, \"name\": \"cronjob_manage\"}]}"
}
}
],
"timestamp": 1792474315.277429,
"finish_reason": "tool_calls"
},
{
"id": 344,
"session_id": "hui-test-reminder",
"role": "tool",
"content": "{\"success\": true, \"job\": {\"job_id\": \"06ccd283e6bb\", \"name\": \"Tee kaufen\", \"skill\": null, \"skills\": [], \"prompt_preview\": \"Erinnerung: Tee kaufen. Schreibe dem Nutzer eine kurze Erinnerung auf Deutsch, dass er heute Tee kau...\", \"model\": null, \"provider\": null, \"pinned\": false, \"base_url\": null, \"schedule\": \"once at 2026-10-21 10:00\", \"repeat\": \"once\", \"deliver\": \"local\", \"next_run_at\": \"2026-10-21T10:00:00+02:00\", \"last_run_at\": null, \"last_status\": null, \"last_delivery_error\": null, \"last_delivery_unverified\": null, \"last_fire_error\": null, \"last_error\": null, \"enabled\": true, \"state\": \"scheduled\", \"paused_at\": null, \"paused_reason\": null}}",
"tool_call_id": "toolu_017GJtJ9xi6YXeimjxuBQGAd",
"tool_name": "cronjob_manage",
"timestamp": 1792474315.2975402
},
{
"id": 347,
"session_id": "hui-test-reminder",
"role": "assistant",
"content": "Erledigt: Die Erinnerung „Tee kaufen“ läuft jetzt morgen, Mittwoch 21. Oktober, um 10:00 Uhr.",
"timestamp": 1792474316.6638641,
"finish_reason": "stop"
}
];

const answers = () => mapRemoteMessages(parseMessages({ data: ROWS }, 'hui-test-reminder').messages).filter((m) => m.role === 'assistant');

test('live rows: the create turn yields one reminder card (wrapper unwrapped, one-shot, saved only)', () => {
  const [first] = answers();
  const r = parseReminders(first.tools ?? []);
  assert.equal(r.length, 1);
  assert.equal(r[0].action, 'create');
  assert.equal(r[0].jobId, '06ccd283e6bb');
  assert.equal(r[0].name, 'Tee kaufen');
  assert.equal(r[0].recurring, false);
  assert.equal(r[0].nextRun, Date.parse('2026-10-21T09:00:00+02:00'));
  assert.equal(r[0].deliver, 'local');
  assert.deepEqual(reminderDelivery(r[0].deliver), { kind: 'none' });
  // the evening before: a device copy can be offered for 9:00
  assert.equal(deviceReminderAt(r[0], Date.parse('2026-10-20T07:20:00+02:00')), r[0].nextRun);
});

test('live rows: the move turn (list, then update) yields one "changed" card at the new time for the same job', () => {
  const second = answers().find((m) => (m.tools ?? []).some((t) => t.label === 'update' || t.detail?.input));
  const all = answers().flatMap((m) => parseReminders(m.tools ?? []));
  const moved = all.filter((r) => r.action === 'update');
  assert.ok(second);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].jobId, '06ccd283e6bb');
  assert.equal(moved[0].name, 'Tee kaufen');
  assert.equal(moved[0].nextRun, Date.parse('2026-10-21T10:00:00+02:00'));
  assert.equal(moved[0].deliver, 'local');
});
