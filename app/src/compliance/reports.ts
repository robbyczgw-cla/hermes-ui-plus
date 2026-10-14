// "Antwort melden" (Google Play AI-generated content policy: in-app reporting/flagging of offensive AI output).
// Pure logic + injectable storage (node:test). React side: ./store.ts, UI: ./ReportSheet.tsx.
//
// A report is stored on this device only (no backend, no network call to us); the reported answer is hidden
// behind "Gemeldet – anzeigen?". "An Entwickler senden" opens a mailto: (support address from
// app/brand/identity.json) with reason, app version and – only if the user ticks it – an excerpt (≤ 500 chars).

export const REPORTS_STORAGE_KEY = 'hui.answerReports';
export const REPORT_REASONS = ['offensive', 'wrong', 'legal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** newest N reports are kept (older ones fall off; their answers show again) */
export const MAX_REPORTS = 500;
export const MAX_COMMENT = 1000;
export const EXCERPT_MAX = 500;

export type AnswerReport = {
  messageId: string;
  conversationId?: string;
  reason: ReportReason;
  comment?: string;
  /** epoch ms */
  at: number;
};

export type ReportStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
}

function cleanComment(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined;
  const t = c.trim();
  return t ? t.slice(0, MAX_COMMENT) : undefined;
}

export function parseReports(raw: string | null | undefined): AnswerReport[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: AnswerReport[] = [];
    for (const r of v) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (typeof o.messageId !== 'string' || !o.messageId || !isReportReason(o.reason)) continue;
      out.push({
        messageId: o.messageId,
        conversationId: typeof o.conversationId === 'string' && o.conversationId ? o.conversationId : undefined,
        reason: o.reason,
        comment: cleanComment(o.comment),
        at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
      });
    }
    return out.slice(-MAX_REPORTS);
  } catch {
    return [];
  }
}

export function makeReport(input: { messageId: string; conversationId?: string; reason: ReportReason; comment?: string }, now = Date.now()): AnswerReport {
  return {
    messageId: input.messageId,
    conversationId: input.conversationId || undefined,
    reason: input.reason,
    comment: cleanComment(input.comment),
    at: now,
  };
}

/** Add (or replace the report of the same answer), keep the newest MAX_REPORTS. */
export function addReport(list: readonly AnswerReport[], report: AnswerReport): AnswerReport[] {
  return [...list.filter((r) => r.messageId !== report.messageId), report].slice(-MAX_REPORTS);
}

export function removeReport(list: readonly AnswerReport[], messageId: string): AnswerReport[] {
  return list.filter((r) => r.messageId !== messageId);
}

export function findReport(list: readonly AnswerReport[], messageId: string): AnswerReport | undefined {
  return list.find((r) => r.messageId === messageId);
}

/** Answer hidden behind "Gemeldet – anzeigen?": reported and not revealed in this session. */
export function isHidden(list: readonly AnswerReport[], messageId: string, revealed: ReadonlySet<string>): boolean {
  return !!findReport(list, messageId) && !revealed.has(messageId);
}

export async function readReports(storage: ReportStorage): Promise<AnswerReport[]> {
  try {
    return parseReports(await storage.getItem(REPORTS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function writeReports(storage: ReportStorage, list: readonly AnswerReport[]): Promise<void> {
  await storage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(list.slice(-MAX_REPORTS)));
}

/** Answer excerpt for the developer mail: whitespace collapsed, at most `max` characters including "…". */
export function reportExcerpt(text: string, max = EXCERPT_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export type ReportMailInput = {
  to: string;
  subject: string;
  intro: string;
  labels: { reason: string; version: string; comment: string; excerpt: string };
  reason: ReportReason;
  reasonLabel: string;
  appVersion: string;
  platform: string;
  comment?: string;
  /** only when the user opted in; trimmed to EXCERPT_MAX here as well */
  excerpt?: string;
  note?: string;
};

/** mailto: URL (RFC 6068: CRLF line breaks, percent-encoded). Nothing in it identifies the server or the chat. */
export function buildReportMailto(m: ReportMailInput): string {
  const lines = [m.intro, '', `${m.labels.reason}: ${m.reasonLabel} (${m.reason})`, `${m.labels.version}: ${m.appVersion} (${m.platform})`];
  const comment = cleanComment(m.comment);
  if (comment) lines.push('', `${m.labels.comment}:`, comment);
  const excerpt = m.excerpt ? reportExcerpt(m.excerpt) : '';
  if (excerpt) lines.push('', `${m.labels.excerpt}:`, excerpt);
  if (m.note) lines.push('', m.note);
  return `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(lines.join('\r\n'))}`;
}
