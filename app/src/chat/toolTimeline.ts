/**
 * Pure mapping ChatMessage -> "Werkzeuge & Ablauf" timeline rows, detail-sheet content and the
 * per-message footer line. Unit-tested (toolTimeline.test.ts). UI copy comes from the i18n dictionary (`Fmt.t`).
 */
import type { ChatMessage, ToolEvent, ToolLink, TraceKind, TraceStep, TurnMetrics } from '../hermes/types.ts';
import { thinkingRange } from '../hermes/trace.ts';
import { pendingOf } from '../hermes/approvals.ts';
import { splitProgressNotes, type ProgressNote } from '../hermes/progressNotes.ts';
import { domainOf, inputSummary } from './toolInput.ts';
import { formatNumber, type TFn, type TKey } from '../i18n/core.ts';
import { toolEmoji } from './format.ts';
import { describeTool, hasOwnSummary, isCompactedStatus, parseTodos, sessionStatusKey, toolIconName } from './hermesTools.ts';
import type { IconName } from './icons.tsx';
import { modelLabel } from './models.ts';
import { withoutSecurityNotice } from '../hermes/webResults.ts';

// ------------------------------------------------------------------ formatting

/** Formatting context: translate function + BCP47 locale of the active UI language. */
export type Fmt = { t: TFn; locale: string };

const dec = (locale: string, n: number) => formatNumber(locale, n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "850 ms" · "14,2 s" · "2 min 5 s" */
export function formatElapsed(ms: number, locale: string): string {
  const v = Math.max(0, ms);
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) {
    const s = Math.round(v / 100) / 10;
    return s >= 60 ? '1 min 0 s' : `${dec(locale, s)} s`;
  }
  const total = Math.round(v / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * Duration from `from` to `to`, or undefined when it is unknown or not positive. A chat loaded from the server
 * (e.g. started on another device) only has message timestamps: its turn "ends" at the moment it starts, which
 * would read "0 ms".
 */
export function knownDuration(from: number, to: number | undefined): number | undefined {
  return to !== undefined && to > from ? to - from : undefined;
}

/** "950" · "1,2k" · "18,7k" · "187k" · "1,2 M" */
export function formatTokens(n: number, locale: string): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 100_000) {
    const k = Math.round(v / 100) / 10;
    return k >= 100 ? '100k' : `${dec(locale, k)}k`;
  }
  if (v < 1_000_000) {
    const k = Math.round(v / 1000);
    return k >= 1000 ? `${dec(locale, 1)} M` : `${k}k`;
  }
  return `${dec(locale, Math.round(v / 100_000) / 10)} M`;
}

/** Share of prompt tokens served from the prompt cache, 0–100, or null when unknown. */
export function cachePercent(m: TurnMetrics | undefined): number | null {
  if (!m) return null;
  const read = m.cacheReadTokens ?? 0;
  const write = m.cacheWriteTokens ?? 0;
  if (m.cacheReadTokens === undefined && m.cacheWriteTokens === undefined) return null;
  const total = (m.inputTokens ?? 0) + read + write;
  if (total <= 0) return null;
  return Math.round((read / total) * 100);
}

/** Truncate long text for display; the sheet offers "mehr anzeigen". */
export function truncateText(s: string, max: number): { text: string; truncated: boolean; total: number } {
  if (s.length <= max) return { text: s, truncated: false, total: s.length };
  return { text: s.slice(0, max), truncated: true, total: s.length };
}

/** Pretty-printed JSON (strings are shown as-is). */
export function prettyJson(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

function clipLine(s: string, max = 110): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Display name of a model id: claude-sonnet-5-5 → "Sonnet 5.5", hermes-agent → "Hermes". */
export function modelDisplay(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (/^claude-/.test(model)) return modelLabel('claude', model);
  if (model === 'hermes-agent') return 'Hermes';
  return model;
}

const APPROVAL_LABELS: Record<string, TKey> = {
  once: 'chat.toolTimeline.approval.once',
  session: 'chat.toolTimeline.approval.session',
  always: 'chat.toolTimeline.approval.always',
  deny: 'chat.toolTimeline.approval.deny',
  expired: 'chat.toolTimeline.approval.expired',
  cancelled: 'chat.toolTimeline.approval.cancelled',
};
const APPROVAL_ICONS: Record<string, string> = { deny: '⛔', expired: '⏱', cancelled: '–' };

export function approvalChoiceLabel(choice: string | undefined, t: TFn): string {
  const k = choice ? APPROVAL_LABELS[choice] : undefined;
  return (k && t(k)) || choice || '–';
}

const pct = (t: TFn, n: number) => t('chat.toolTimeline.percent', { value: n });

// ------------------------------------------------------------------ timeline rows

export type RowState = 'running' | 'done' | 'error' | 'info' | 'waiting';

export type TimelineRow = {
  key: string;
  /** `note`: an interim text of the agent before a tool call (hermes/progressNotes.ts) */
  kind: 'tool' | 'note' | TraceKind;
  icon: string;
  /** Hermes tools: stroke icon (replaces the emoji `icon` in the UI) */
  iconName?: IconName;
  title: string;
  /** first line: argument / server text */
  summary?: string;
  /** second line: result summary / reason */
  sub?: string;
  state: RowState;
  at: number;
  /** ms since the user sent the message */
  offsetMs: number;
  durationMs?: number;
  /** web search hits etc. (count shown in the row; tappable in the sheet) */
  links?: ToolLink[];
};

function routeSummary(msg: ChatMessage, t: TFn): { summary: string; sub?: string } | null {
  const r = msg.route;
  if (!r) return null;
  // router confidence and model id live in the detail sheet only (stepDetail 'route')
  const parts = [r.format, r.component];
  return { summary: parts.filter(Boolean).join(' · '), sub: r.reason ? clipLine(r.reason) : undefined };
}

function thinkingText(msg: ChatMessage, step: TraceStep): string | null {
  const range = thinkingRange(step);
  if (!range || msg.reasoning === undefined) return null;
  return msg.reasoning.slice(range.from, range.to);
}

function thinkingSummary(msg: ChatMessage, step: TraceStep, t: TFn): string {
  if (step.text === 'redacted') return t('chat.toolTimeline.thinking.encrypted');
  const range = thinkingRange(step);
  const text = thinkingText(msg, step);
  if (text === null) return range && range.to > range.from ? t('chat.toolTimeline.thinking.notStored') : t('chat.toolTimeline.thinking.notSent');
  return text.trim() ? clipLine(text, 140) : t('chat.toolTimeline.thinking.notSent');
}

/** Hermes terminal result `{…, approval: "Command was flagged (…) and auto-approved by smart approval."}`. */
export function smartApproved(output: unknown): boolean {
  const a = output && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>).approval : undefined;
  return typeof a === 'string' && /auto-approved by smart approval/i.test(a);
}

function toolRow(msg: ChatMessage, ev: ToolEvent, now: number, streaming: boolean, t: TFn): TimelineRow {
  const d = ev.detail;
  const claudeInput = d?.input !== undefined ? inputSummary(d.input, t) : undefined;
  const view = describeTool(t, ev);
  // Hermes tools with their own summary (todo progress, subagent goal, query …) win over the generic argument line
  const summary = (hasOwnSummary(view.kind) && view.preview ? view.preview : (claudeInput ?? view.preview)) ?? undefined;
  let sub = d?.summary ?? view.sub;
  if (!sub && d?.links?.length) sub = t('chat.toolTimeline.hits', { count: d.links.length });
  // still running when the turn ended (connection lost / stopped): neutral, not a failure
  if (d?.cancelled) sub = t('chat.toolTimeline.cancelled');
  // Hermes approvals.mode "smart": flagged command passed by the guardian LLM, no card was shown
  if (smartApproved(d?.output)) sub = [sub, t('chat.detail.autoApprovedSmart')].filter(Boolean).join(' · ');
  const running = ev.status === 'running' && streaming;
  const end = ev.endedAt ?? (running ? now : undefined);
  return {
    key: `tool:${ev.id}`,
    kind: 'tool',
    icon: toolEmoji(d?.tool ?? ev.name, ev.emoji),
    iconName: view.icon ?? toolIconName(d?.tool ?? '') ?? undefined,
    title: view.title,
    summary,
    sub,
    state: running ? 'running' : ev.status === 'error' ? 'error' : d?.cancelled ? 'info' : 'done',
    at: ev.startedAt,
    offsetMs: ev.startedAt - msg.createdAt,
    // N7: a finished tool without a measured duration (only a `completed` frame arrived, or history rows with the
    // same timestamp for call and result) shows no time instead of "0 ms"
    durationMs: end !== undefined && (running || end > ev.startedAt) ? end - ev.startedAt : undefined,
    links: d?.links,
  };
}

function stepRow(msg: ChatMessage, s: TraceStep, next: TraceStep | undefined, streaming: boolean, t: TFn): TimelineRow | null {
  const base = { key: `step:${s.id}`, kind: s.kind, at: s.at, offsetMs: s.at - msg.createdAt };
  switch (s.kind) {
    case 'route': {
      const r = routeSummary(msg, t);
      if (!r) return null;
      return { ...base, icon: '🧭', title: t('chat.toolTimeline.router'), ...r, state: 'info', durationMs: msg.route?.ms };
    }
    case 'status': {
      const kind = (s.data as { kind?: string } | undefined)?.kind;
      const compacted = isCompactedStatus(kind, s.text);
      const session = sessionStatusKey(s.text);
      return {
        ...base,
        icon: compacted ? '🗜️' : '⏳',
        ...(compacted ? { iconName: 'compress' as const } : {}),
        title: compacted ? t('chat.toolTimeline.contextCompacted') : t('chat.toolTimeline.status'),
        summary: session ? t(`chat.toolTimeline.session.${session}`) : s.text,
        sub: kind && !compacted ? kind : undefined,
        state: 'info',
      };
    }
    case 'approval': {
      const reqId = (s.data as { requestId?: string } | undefined)?.requestId;
      // this request is still queued and answerable (queue per request id; an interrupted run still waits)
      const pending = reqId
        ? !!pendingOf(msg).some((a) => a.requestId === reqId && !a.expired)
        : !!msg.approval && !msg.approval.expired && streaming;
      const answer = reqId
        ? msg.trace?.find((x) => x.kind === 'approval_answer' && (x.data as { requestId?: string } | undefined)?.requestId === reqId)
        : next?.kind === 'approval_answer'
          ? next
          : undefined;
      const desc = (s.data as { description?: string } | undefined)?.description;
      return {
        ...base,
        icon: '🛡️',
        title: pending ? t('chat.toolTimeline.approval.waiting') : t('chat.toolTimeline.approval.requested'),
        summary: s.text,
        sub: desc,
        state: pending ? 'waiting' : 'info',
        durationMs: answer ? answer.at - s.at : undefined,
      };
    }
    case 'approval_answer':
      return {
        ...base,
        icon: (s.text && APPROVAL_ICONS[s.text]) || '✅',
        title: t('chat.toolTimeline.approval.answer', { choice: approvalChoiceLabel(s.text, t) }),
        state: s.text === 'deny' || s.text === 'expired' ? 'error' : s.text === 'cancelled' ? 'info' : 'done',
      };
    case 'thinking': {
      const running = s.endedAt === undefined && streaming;
      return {
        ...base,
        icon: '💭',
        title: running ? t('chat.thinking.live') : t('chat.thinking.done'),
        summary: thinkingSummary(msg, s, t),
        state: running ? 'running' : 'done',
        durationMs: knownDuration(s.at, s.endedAt), // server-loaded thinking has no duration (endedAt = at)
      };
    }
    case 'fallback': {
      const f = (s.data ?? {}) as { from?: string; to?: string };
      return {
        ...base,
        icon: '🔀',
        title: t('chat.toolTimeline.fallbackModel'),
        summary: `${modelDisplay(f.from) ?? '?'} → ${modelDisplay(f.to) ?? '?'}`,
        sub: t('chat.toolTimeline.fallbackReason'),
        state: 'info',
      };
    }
    case 'request':
      return { ...base, icon: '🔁', title: t('chat.toolTimeline.continuation'), summary: t('chat.toolTimeline.continuationSummary', { reason: s.text ?? 'pause_turn' }), state: 'info' };
    default:
      return null;
  }
}

function noteRow(msg: ChatMessage, n: ProgressNote, t: TFn): TimelineRow {
  return {
    key: `note:${n.toolId}`,
    kind: 'note',
    icon: '💬',
    title: t('chat.toolTimeline.note'),
    summary: clipLine(n.text, 160),
    state: 'info',
    at: n.at,
    offsetMs: n.at - msg.createdAt,
  };
}

/**
 * All steps of one assistant message in time order. `now` drives running durations. `notes`: interim texts
 * before tool calls become status rows (off when Settings → Antworten keeps them in the answer).
 */
export function buildTimeline(
  msg: ChatMessage,
  t: TFn,
  now: number = Date.now(),
  { notes = true }: { notes?: boolean | readonly ProgressNote[] } = {},
): TimelineRow[] {
  const streaming = msg.status === 'streaming';
  const rows: TimelineRow[] = [];
  const trace = msg.trace ?? [];
  // older/persisted messages without a route step still show the decision
  if (msg.route && !trace.some((s) => s.kind === 'route')) {
    const r = routeSummary(msg, t);
    if (r) rows.push({ key: 'step:route', kind: 'route', icon: '🧭', title: t('chat.toolTimeline.router'), ...r, state: 'info', at: msg.createdAt, offsetMs: 0, durationMs: msg.route.ms });
  }
  trace.forEach((s, i) => {
    const row = stepRow(msg, s, trace[i + 1], streaming, t);
    if (row) rows.push(row);
  });
  // notes before tools: a note and the call it announces share the start time, the note comes first
  const noteList = notes === true ? splitProgressNotes(msg).notes : notes || [];
  for (const n of noteList) rows.push(noteRow(msg, n, t));
  for (const ev of msg.tools) rows.push(toolRow(msg, ev, now, streaming, t));
  // stable sort by time (ties keep insertion order: route/trace before tools started in the same ms)
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.at - b.r.at || a.i - b.i)
    .map((x) => x.r);
}

/**
 * One live status line for the collapsed panel while streaming: the latest running / waiting step
 * ("Websuche · wetter wien"), else the latest step. Updates in place instead of expanding the panel.
 */
export function liveStatus(rows: TimelineRow[]): string | null {
  const active = [...rows].reverse().find((r) => r.state === 'running' || r.state === 'waiting') ?? rows[rows.length - 1];
  if (!active) return null;
  return active.summary && active.kind === 'tool' ? `${active.title} · ${active.summary}` : active.title;
}

/**
 * The "✓" after the panel header: only for a turn that really finished without failed steps – never while it
 * streams, was stopped or interrupted (stream lost, answer still being recovered) or failed.
 */
export function timelineDone(msg: Pick<ChatMessage, 'status'>, rows: readonly Pick<TimelineRow, 'state'>[]): boolean {
  return msg.status === 'done' && !rows.some((r) => r.state === 'error');
}

/** Panel header: "3 Werkzeuge · 5 Schritte · 4,1 s" */
export function timelineHeader(rows: TimelineRow[], t: TFn): string {
  const tools = rows.filter((r) => r.kind === 'tool').length;
  const errors = rows.filter((r) => r.state === 'error' && r.kind === 'tool').length;
  const parts: string[] = [];
  if (tools) parts.push(t('chat.toolTimeline.toolCount', { count: tools }));
  // interim notes are not steps of their own
  const other = rows.filter((r) => r.kind !== 'tool' && r.kind !== 'note').length;
  if (other) parts.push(t('chat.toolTimeline.stepCount', { count: other }));
  if (errors) parts.push(t('chat.toolTimeline.errorCount', { count: errors }));
  return parts.join(' · ');
}

// ------------------------------------------------------------------ footer

/**
 * "3 Werkzeuge · 14,2 s · 18,7k in / 1,2k out · Cache 92 %". The model id is shown in the detail sheet only;
 * token counts + cache share only with `tokens` (Werkzeug-Details "Ausführlich").
 */
export function footerParts(msg: ChatMessage, { t, locale }: Fmt, { tokens = true }: { tokens?: boolean } = {}): string[] {
  const m = msg.metrics;
  const parts: string[] = [];
  const n = msg.tools.length;
  if (n) parts.push(t('chat.toolTimeline.toolCount', { count: n }));
  const total = knownDuration(msg.createdAt, m?.endedAt);
  if (total !== undefined) parts.push(formatElapsed(total, locale));
  if (!tokens) return parts;
  const prompt = msg.usage?.promptTokens ?? (m ? (m.inputTokens ?? 0) + (m.cacheReadTokens ?? 0) + (m.cacheWriteTokens ?? 0) : 0);
  const out = msg.usage?.completionTokens ?? m?.outputTokens;
  const cache = cachePercent(m);
  const cached = m?.cacheReadTokens ?? 0;
  // "in" counts the whole prompt (uncached + cache), like the server's prompt_tokens; /usage lists
  // them separately, so the footer says how much of it came from the cache
  if (cached > 0 && cache !== null && prompt > 0) {
    parts.push(t('chat.toolTimeline.tokensInOutCache', { input: formatTokens(prompt, locale), cache: formatTokens(cached, locale), percent: cache, output: formatTokens(out ?? 0, locale) }));
    return parts;
  }
  if (prompt || out) parts.push(t('chat.toolTimeline.tokensInOut', { input: formatTokens(prompt, locale), output: formatTokens(out ?? 0, locale) }));
  if (cache !== null) parts.push(t('chat.toolTimeline.cacheShare', { percent: cache }));
  return parts;
}

// ------------------------------------------------------------------ detail sheet

export type DetailSection = { title: string; body: string; mono: boolean };
export type RowDetail = {
  icon: string;
  /** stroke icon (Hermes tools); replaces the emoji `icon` */
  iconName?: IconName;
  title: string;
  meta: { label: string; value: string }[];
  note?: string;
  links?: ToolLink[];
  sections: DetailSection[];
};

/**
 * Detail sheet of a tool row: with a web result card the raw tool facts (name, status, times, call ID) and the input /
 * output JSON sit behind a closed "Technical details" disclosure so the card reads as search info + sources; every
 * other tool keeps them inline. `note` and `links` are not technical and stay where they were.
 */
export function detailLayout(detail: Pick<RowDetail, 'meta' | 'sections'>, hasWebCard: boolean): { inline: Pick<RowDetail, 'meta' | 'sections'>; technical: Pick<RowDetail, 'meta' | 'sections'> | null } {
  if (!hasWebCard || (!detail.meta.length && !detail.sections.length)) return { inline: detail, technical: null };
  return { inline: { meta: [], sections: [] }, technical: { meta: detail.meta, sections: detail.sections } };
}

const at = (msg: ChatMessage, time: number, locale: string) => `+${formatElapsed(time - msg.createdAt, locale)}`;
const STATE_LABEL: Record<string, TKey> = {
  running: 'chat.toolTimeline.state.running',
  done: 'chat.toolTimeline.state.done',
  error: 'chat.toolTimeline.state.error',
  waiting: 'chat.toolTimeline.state.waiting',
};

function json(title: string, v: unknown): DetailSection | null {
  return v === undefined ? null : { title, body: prettyJson(v), mono: true };
}

function toolDetail(msg: ChatMessage, ev: ToolEvent, { t, locale }: Fmt): RowDetail {
  const d = ev.detail;
  const stateKey = STATE_LABEL[ev.status];
  const meta = [
    { label: t('chat.detail.tool'), value: d?.tool ?? ev.name },
    { label: t('chat.detail.status'), value: d?.cancelled ? t('chat.toolTimeline.cancelled') : stateKey ? t(stateKey) : ev.status },
    { label: t('chat.detail.start'), value: at(msg, ev.startedAt, locale) },
  ];
  if (ev.endedAt !== undefined && ev.endedAt > ev.startedAt) meta.push({ label: t('chat.detail.duration'), value: formatElapsed(ev.endedAt - ev.startedAt, locale) });
  if (d?.errorCode) meta.push({ label: t('chat.detail.errorCode'), value: d.errorCode });
  meta.push({ label: t('chat.detail.id'), value: ev.id });

  const sections: (DetailSection | null)[] = [];
  const input = d?.input as Record<string, unknown> | undefined;
  if (input && typeof input === 'object' && typeof input.code === 'string') {
    sections.push({ title: t('chat.detail.code'), body: input.code, mono: true });
  } else if (input && typeof input === 'object' && typeof input.command === 'string' && !('path' in input)) {
    sections.push({ title: t('chat.detail.command'), body: input.command, mono: true });
  } else {
    sections.push(json(t('chat.detail.input'), d?.input));
  }
  if (!d && ev.label && ev.label !== ev.name) sections.push({ title: t('chat.detail.previewLabel'), body: ev.label, mono: true });
  const out = d?.output as Record<string, unknown> | undefined;
  if (out && typeof out === 'object' && !Array.isArray(out) && ('stdout' in out || 'stderr' in out)) {
    if (out.return_code !== undefined) meta.push({ label: t('chat.detail.returnCode'), value: String(out.return_code) });
    if (typeof out.stdout === 'string' && out.stdout) sections.push({ title: 'stdout', body: out.stdout, mono: true });
    if (typeof out.stderr === 'string' && out.stderr) sections.push({ title: 'stderr', body: out.stderr, mono: true });
  } else if (out && typeof out === 'object' && !Array.isArray(out) && typeof out.output === 'string' && ('exit_code' in out || 'error' in out)) {
    // Hermes terminal result (stored session message): {output, exit_code, error}
    if (typeof out.exit_code === 'number') meta.push({ label: t('chat.detail.exitCode'), value: String(out.exit_code) });
    if (typeof out.approval === 'string' && out.approval) meta.push({ label: t('chat.detail.approval'), value: out.approval });
    if (out.output) sections.push({ title: t('chat.detail.output'), body: out.output, mono: true });
    if (typeof out.error === 'string' && out.error) sections.push({ title: t('chat.detail.error'), body: out.error, mono: true });
  } else if (!d?.links?.length || !Array.isArray(out)) {
    // a web tool's text result: WSP's security notice line stays hidden here too
    sections.push(json(t('chat.detail.result'), d?.web ? withoutSecurityNotice(d.output) : d?.output));
  }
  if (ev.raw?.length) sections.push(json(d ? t('chat.detail.rawData') : `${t('chat.detail.rawData')} (hermes.tool.progress)`, ev.raw));
  const view = describeTool(t, ev);
  const todos = view.kind === 'todo' ? parseTodos(ev) : null;
  if (todos) {
    const mark = { completed: '[x]', in_progress: '[~]', pending: '[ ]', cancelled: '[-]' } as const;
    sections.unshift({ title: t('hermesTools.todo.section'), body: todos.map((i) => `${mark[i.status]} ${i.content}`).join('\n'), mono: false });
  }
  return {
    icon: toolEmoji(d?.tool ?? ev.name, ev.emoji),
    iconName: view.icon ?? toolIconName(d?.tool ?? '') ?? undefined,
    title: view.title,
    meta,
    note: d ? undefined : t('chat.detail.hermesNote'),
    links: d?.links,
    sections: sections.filter((x): x is DetailSection => !!x),
  };
}

function stepDetail(msg: ChatMessage, s: TraceStep | undefined, kind: TraceKind, fmt: Fmt): RowDetail {
  const { t, locale } = fmt;
  const when = s ? [{ label: t('chat.detail.time'), value: at(msg, s.at, locale) }] : [];
  switch (kind) {
    case 'route': {
      const r = msg.route;
      const meta = [
        { label: t('chat.detail.format'), value: r?.format ?? '–' },
        ...(r?.component ? [{ label: t('chat.detail.component'), value: r.component }] : []),
        { label: t('chat.detail.confidence'), value: typeof r?.confidence === 'number' ? pct(t, Math.round(r.confidence * 100)) : '–' },
        { label: t('chat.detail.router'), value: r?.model ?? '–' },
        { label: t('chat.detail.latency'), value: typeof r?.ms === 'number' ? formatElapsed(r.ms, locale) : '–' },
        ...when,
      ];
      const sections = [r?.reason ? { title: t('chat.detail.reason'), body: r.reason, mono: false } : null, json(`${t('chat.detail.rawData')} (hermes.ui.route)`, r)];
      return { icon: '🧭', title: t('chat.toolTimeline.router'), meta, sections: sections.filter((x): x is DetailSection => !!x) };
    }
    case 'thinking': {
      const text = s ? thinkingText(msg, s) : null;
      const meta = [...when];
      const dur = s ? knownDuration(s.at, s.endedAt) : undefined;
      if (dur !== undefined) meta.push({ label: t('chat.detail.duration'), value: formatElapsed(dur, locale) });
      if (text) meta.push({ label: t('chat.detail.characters'), value: formatNumber(locale, text.length) });
      return {
        icon: '💭',
        title: t('chat.thinking.done'),
        meta,
        note: text?.trim() ? undefined : s ? thinkingSummary(msg, s, t) : undefined,
        sections: text?.trim() ? [{ title: t('chat.detail.text'), body: text.trim(), mono: false }] : [],
      };
    }
    default: {
      const row = s ? stepRow(msg, s, undefined, false, t) : null;
      const meta = [...when];
      const kindLabel = (s?.data as { kind?: string } | undefined)?.kind;
      if (kind === 'status' && kindLabel) meta.push({ label: t('chat.detail.kind'), value: kindLabel });
      const sections: (DetailSection | null)[] = [];
      if (s?.text) sections.push({ title: kind === 'approval' ? t('chat.detail.command') : t('chat.detail.text'), body: s.text, mono: kind === 'approval' });
      if (kind !== 'status') sections.push(json(t('chat.detail.rawData'), s?.data));
      return { icon: row?.icon ?? 'ℹ️', iconName: row?.iconName, title: row?.title ?? kind, meta, sections: sections.filter((x): x is DetailSection => !!x) };
    }
  }
}

/** Turn-level numbers (footer tap). */
export function turnDetail(msg: ChatMessage, { t, locale }: Fmt): RowDetail {
  const m = msg.metrics ?? {};
  const c = msg as { model?: string; fellBack?: boolean };
  const meta: { label: string; value: string }[] = [];
  const num = (n: number) => formatNumber(locale, n);
  const model = m.model ?? c.model;
  if (model) meta.push({ label: t('chat.detail.model'), value: model });
  if (c.fellBack) meta.push({ label: t('chat.detail.fallback'), value: t('chat.fmt.yes') });
  if (msg.finishReason) meta.push({ label: t('chat.detail.finishReason'), value: msg.finishReason });
  const firstToken = knownDuration(msg.createdAt, m.firstTokenAt);
  const total = knownDuration(msg.createdAt, m.endedAt);
  if (firstToken !== undefined) meta.push({ label: t('chat.detail.firstToken'), value: formatElapsed(firstToken, locale) });
  if (total !== undefined) meta.push({ label: t('chat.detail.totalTime'), value: formatElapsed(total, locale) });
  if (m.requests && m.requests > 1) meta.push({ label: t('chat.detail.apiRequests'), value: num(m.requests) });
  if (m.inputTokens !== undefined) meta.push({ label: m.cacheReadTokens !== undefined ? t('chat.detail.inputUncached') : t('chat.detail.promptTokens'), value: num(m.inputTokens) });
  if (m.cacheReadTokens !== undefined) meta.push({ label: t('chat.detail.cacheRead'), value: num(m.cacheReadTokens) });
  if (m.cacheWriteTokens !== undefined) meta.push({ label: t('chat.detail.cacheWritten'), value: num(m.cacheWriteTokens) });
  if (m.outputTokens !== undefined) meta.push({ label: t('chat.detail.outputTokens'), value: num(m.outputTokens) });
  const cache = cachePercent(m);
  if (cache !== null) meta.push({ label: t('chat.detail.cacheShare'), value: pct(t, cache) });
  if (m.webSearchRequests) meta.push({ label: t('chat.detail.webSearches'), value: num(m.webSearchRequests) });
  if (m.webFetchRequests) meta.push({ label: t('chat.detail.pageFetches'), value: num(m.webFetchRequests) });
  meta.push({ label: t('chat.detail.tools'), value: num(msg.tools.length) });
  if (msg.completionId) meta.push({ label: t('chat.detail.id'), value: msg.completionId });
  const sections = [json(`${t('chat.detail.rawData')} (${t('chat.detail.metrics')})`, { metrics: msg.metrics, usage: msg.usage, finishReason: msg.finishReason })];
  return { icon: '📊', title: t('chat.detail.turnTitle'), meta, sections: sections.filter((x): x is DetailSection => !!x) };
}

/** Content of the detail sheet for a timeline row key (`tool:<id>` / `step:<id>` / `turn`). */
export function rowDetail(msg: ChatMessage, key: string, fmt: Fmt): RowDetail | null {
  if (key === 'turn') return turnDetail(msg, fmt);
  if (key.startsWith('tool:')) {
    const ev = msg.tools.find((x) => `tool:${x.id}` === key);
    return ev ? toolDetail(msg, ev, fmt) : null;
  }
  if (key.startsWith('note:')) {
    const n = splitProgressNotes(msg).notes.find((x) => `note:${x.toolId}` === key);
    if (!n) return null;
    return {
      icon: '💬',
      title: fmt.t('chat.toolTimeline.note'),
      meta: [{ label: fmt.t('chat.detail.time'), value: at(msg, n.at, fmt.locale) }],
      sections: [{ title: fmt.t('chat.detail.text'), body: n.text, mono: false }],
    };
  }
  if (key === 'step:route') return stepDetail(msg, undefined, 'route', fmt);
  const s = msg.trace?.find((x) => `step:${x.id}` === key);
  return s ? stepDetail(msg, s, s.kind, fmt) : null;
}

/** "Titel – spiegel.de" helper for link rows. */
export function linkDomain(url: string): string {
  return domainOf(url);
}
