/**
 * Bot groups (Bots v2 slice 6, docs/BOT-GROUPS.md): a group chat of 2 to 6 bots, run by the UI bridge
 * (bridge/src/groups.mjs). Pure, erasable TS: parsing the bridge's answers, the @-autocomplete, the create draft.
 *
 * A message starts a round: the bots named with @ answer, else the first bot (the leader); @alle asks everyone. A bot
 * with nothing to add says "(pass)" and stays invisible. Hand-overs are grey lines. At most `perRound` model calls per
 * message (8), then the group waits. Approvals never show here: they go to the asking bot's own chat.
 */

import type { ApprovalChoice, ApprovalRequest } from '../hermes/types.ts';

export type GroupLimits = { minMembers: number; maxMembers: number; perRound: number };
export const DEFAULT_LIMITS: GroupLimits = { minMembers: 2, maxMembers: 6, perRound: 8 };

export type GroupsConfig = {
  enabled: boolean;
  /** why off: owner_off (the owner has not switched groups on) | bridge_off (BRIDGE_GROUPS=off) */
  reason?: string;
  /** admin credential: may see the owner's command */
  admin: boolean;
  limits: GroupLimits;
};

export type GroupInfo = { id: string; name: string; members: string[]; createdAt: number; updatedAt: number };
export type GroupSummary = GroupInfo & { running: boolean; last?: { kind: 'user' | 'bot'; bot?: string; text: string; at: number } };

export type GroupApproval = {
  groupId: string;
  groupName: string;
  bot: string;
  runId: string;
  requestId: string;
  command: string;
  description?: string;
  choices?: string[];
  expiresAt?: number;
  at: number;
};

export type NoteKind = 'approval' | 'error' | 'capped' | 'stopped' | 'quiet' | 'interrupted';
export type GroupEntry =
  | { seq: number; at: number; kind: 'user'; text: string }
  | { seq: number; at: number; kind: 'bot'; bot: string; text: string; partial?: boolean }
  | { seq: number; at: number; kind: 'handoff'; bot: string; to: string; text: string }
  | { seq: number; at: number; kind: 'note'; note: NoteKind; bot?: string; code?: string; runId?: string; requestId?: string; waiting?: string[] };

export type GroupRound = {
  turns: number;
  max: number;
  speaker: string | null;
  step?: string;
  partial: string;
  queue: string[];
  waiting: { bot: string; runId: string; requestId: string }[];
};

export type GroupState = { group: GroupInfo; seq: number; entries: GroupEntry[]; round: GroupRound | null };
export type GroupsList = { config: GroupsConfig; groups: GroupSummary[]; approvals: GroupApproval[] };

export const GROUP_ID_RE = /^g[a-z0-9]{10}$/;
const BOT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NOTES: readonly NoteKind[] = ['approval', 'error', 'capped', 'stopped', 'quiet', 'interrupted'];

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const bot = (v: unknown) => (typeof v === 'string' && BOT_RE.test(v) ? v : '');
const bots = (v: unknown) => (Array.isArray(v) ? v.map(bot).filter(Boolean) : []);

function parseLimits(v: unknown): GroupLimits {
  const o = obj(v);
  const pick = (k: keyof GroupLimits) => (o && Number.isInteger(o[k]) && (o[k] as number) > 0 ? (o[k] as number) : DEFAULT_LIMITS[k]);
  return { minMembers: pick('minMembers'), maxMembers: pick('maxMembers'), perRound: pick('perRound') };
}

function parseInfo(v: unknown): GroupInfo | null {
  const o = obj(v);
  if (!o || typeof o.id !== 'string' || !GROUP_ID_RE.test(o.id)) return null;
  return { id: o.id, name: str(o.name, 80) || o.id, members: bots(o.members), createdAt: num(o.createdAt), updatedAt: num(o.updatedAt) };
}

/** GET /bridge/groups → list; null = no answer we understand (older bridge, direct Hermes): no groups at all. */
export function parseGroupsList(json: unknown): GroupsList | null {
  const o = obj(json);
  if (!o || typeof o.enabled !== 'boolean') return null;
  const config: GroupsConfig = { enabled: o.enabled, ...(typeof o.reason === 'string' ? { reason: o.reason.slice(0, 40) } : {}), admin: o.admin === true, limits: parseLimits(o.limits) };
  const groups: GroupSummary[] = [];
  for (const g of Array.isArray(o.groups) ? o.groups : []) {
    const info = parseInfo(g);
    if (!info) continue;
    const l = obj(obj(g)?.last);
    const lastKind = l?.kind === 'user' || l?.kind === 'bot' ? l.kind : null;
    groups.push({ ...info, running: obj(g)?.running === true, ...(l && lastKind ? { last: { kind: lastKind, ...(bot(l.bot) ? { bot: bot(l.bot) } : {}), text: str(l.text, 200), at: num(l.at) } } : {}) });
  }
  const approvals: GroupApproval[] = [];
  for (const a of Array.isArray(o.approvals) ? o.approvals : []) {
    const r = obj(a);
    if (!r || typeof r.groupId !== 'string' || !bot(r.bot) || !str(r.runId, 256) || !str(r.requestId, 256)) continue;
    approvals.push({
      groupId: r.groupId, groupName: str(r.groupName, 80), bot: bot(r.bot), runId: str(r.runId, 256), requestId: str(r.requestId, 256),
      command: str(r.command, 400), ...(str(r.description, 200) ? { description: str(r.description, 200) } : {}),
      ...(Array.isArray(r.choices) ? { choices: r.choices.filter((c): c is string => typeof c === 'string').slice(0, 5) } : {}),
      ...(num(r.expiresAt) ? { expiresAt: num(r.expiresAt) } : {}), at: num(r.at),
    });
  }
  return { config, groups, approvals };
}

function parseEntry(v: unknown): GroupEntry | null {
  const o = obj(v);
  if (!o || !Number.isInteger(o.seq)) return null;
  const base = { seq: o.seq as number, at: num(o.at) };
  if (o.kind === 'user') return { ...base, kind: 'user', text: str(o.text) };
  if (o.kind === 'bot' && bot(o.bot)) return { ...base, kind: 'bot', bot: bot(o.bot), text: str(o.text), ...(o.partial === true ? { partial: true } : {}) };
  if (o.kind === 'handoff' && bot(o.bot) && bot(o.to)) return { ...base, kind: 'handoff', bot: bot(o.bot), to: bot(o.to), text: str(o.text, 400) };
  if (o.kind === 'note' && NOTES.includes(o.note as NoteKind)) {
    return {
      ...base, kind: 'note', note: o.note as NoteKind, ...(bot(o.bot) ? { bot: bot(o.bot) } : {}), ...(str(o.code, 40) ? { code: str(o.code, 40) } : {}),
      ...(str(o.runId, 256) ? { runId: str(o.runId, 256) } : {}), ...(str(o.requestId, 256) ? { requestId: str(o.requestId, 256) } : {}),
      ...(Array.isArray(o.waiting) ? { waiting: bots(o.waiting) } : {}),
    };
  }
  return null; // a kind of a newer bridge: left out rather than shown wrong
}

/** GET /bridge/groups/<id> → state; null = not understood. */
export function parseGroupState(json: unknown): GroupState | null {
  const o = obj(json);
  const group = parseInfo(o?.group);
  if (!o || !group) return null;
  const entries = (Array.isArray(o.entries) ? o.entries : []).map(parseEntry).filter((e): e is GroupEntry => !!e);
  const r = obj(o.round);
  const round: GroupRound | null = r
    ? {
        turns: num(r.turns), max: num(r.max) || DEFAULT_LIMITS.perRound, speaker: bot(r.speaker) || null, ...(str(r.step, 80) ? { step: str(r.step, 80) } : {}),
        partial: str(r.partial, 4000), queue: bots(r.queue),
        waiting: (Array.isArray(r.waiting) ? r.waiting : []).map(obj).filter((w): w is Record<string, unknown> => !!w && !!bot(w.bot)).map((w) => ({ bot: bot(w.bot), runId: str(w.runId, 256), requestId: str(w.requestId, 256) })),
      }
    : null;
  return { group, seq: num(o.seq), entries, round };
}

/** Entries of a poll (`?since=`) added to what we have: by seq, no duplicates. */
export function mergeEntries(prev: readonly GroupEntry[], next: readonly GroupEntry[]): GroupEntry[] {
  if (!next.length) return prev as GroupEntry[];
  const seen = new Set(prev.map((e) => e.seq));
  const out = [...prev, ...next.filter((e) => !seen.has(e.seq))];
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

// ------------------------------------------------------------------ members and mentions

/** The @-handle the bridge understands: the profile name, `hermes` for the default bot. */
export const mentionTag = (key: string) => (key === 'default' ? 'hermes' : key);
export const EVERYONE_TAG = 'alle';

/** `huigroup-<group>-<bot>`: the hidden Hermes session of one member (approval events carry it). */
const SESSION_RE = /^huigroup-(g[a-z0-9]{10})-([a-z0-9][a-z0-9_-]{0,63})$/;
export function parseGroupSessionId(id: string | null | undefined): { groupId: string; bot: string } | null {
  const m = SESSION_RE.exec(String(id ?? ''));
  return m ? { groupId: m[1], bot: m[2] } : null;
}

/**
 * The @word the caret is in (autocomplete): `{start, query}` where `start` is the index of "@", or null. Only at the
 * start or after a space / opening bracket, so mail addresses do not open the list.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const m = /(^|[\s(["'])@([\p{L}\p{N}_-]{0,40})$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2].toLowerCase() };
}

export type MentionOption = { key: string; tag: string; label: string };

/** Members whose name or label starts with the query (any word of the label), then "@alle" while it fits. */
export function mentionOptions(query: string, members: readonly { key: string; label: string }[], everyoneLabel: string): MentionOption[] {
  const q = query.toLowerCase();
  const hits = members
    .map((m) => ({ key: m.key, tag: mentionTag(m.key), label: m.label }))
    .filter((m) => !q || m.tag.startsWith(q) || m.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.label.toLowerCase().startsWith(q));
  if (!q || EVERYONE_TAG.startsWith(q) || 'everyone'.startsWith(q)) hits.push({ key: '*', tag: EVERYONE_TAG, label: everyoneLabel });
  return hits;
}

/** Replace the @word at `start` with `@tag ` and return the new text and caret. */
export function insertMention(text: string, start: number, caret: number, tag: string): { text: string; caret: number } {
  const end = Math.max(start, Math.min(caret, text.length));
  let tail = text.slice(end);
  const rest = /^[\p{L}\p{N}_-]*/u.exec(tail)?.[0] ?? '';
  tail = tail.slice(rest.length);
  const spaced = tail.startsWith(' ');
  const ins = `@${tag}${spaced ? '' : ' '}`;
  return { text: text.slice(0, start) + ins + tail, caret: start + ins.length + (spaced ? 1 : 0) };
}

/** Who answers this message (preview for the composer hint): named members, all, or the leader. Mirrors the bridge. */
export function addressedBy(text: string, members: readonly { key: string; label: string }[]): { keys: string[]; everyone: boolean } {
  const src = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const re = /(^|[^\p{L}\p{N}_@.])@(?:"([^"\n]{1,60})"|([\p{L}\p{N}][\p{L}\p{N}_-]{0,63}))/gu;
  const keys: string[] = [];
  let everyone = false;
  const collapse = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const raw = (m[2] ?? m[3] ?? '').trim().toLowerCase();
    if (['everyone', 'all', 'alle', 'todos', 'todas'].includes(raw)) {
      everyone = true;
      continue;
    }
    const hit = members.find((x) => {
      const forms = [x.key, mentionTag(x.key), x.label.toLowerCase(), x.label.toLowerCase().split(/\s+/)[0]];
      return forms.some((f) => f === raw || collapse(f) === collapse(raw));
    });
    if (hit && !keys.includes(hit.key)) keys.push(hit.key);
  }
  return { keys, everyone };
}

// ------------------------------------------------------------------ create

export type GroupDraft = { name: string; members: string[] };
export const NAME_MAX = 60;

/** Problems of a draft: too few / too many bots. The name may stay empty (the bridge names the group after its bots). */
export function draftProblems(d: GroupDraft, limits: GroupLimits = DEFAULT_LIMITS): ('few' | 'many' | 'name')[] {
  const out: ('few' | 'many' | 'name')[] = [];
  if (d.members.length < limits.minMembers) out.push('few');
  if (d.members.length > limits.maxMembers) out.push('many');
  if (d.name.trim().length > NAME_MAX) out.push('name');
  return out;
}

/** Toggle a bot in the draft; the order of picking is the order in the group (the first one leads). */
export function toggleMember(d: GroupDraft, key: string, limits: GroupLimits = DEFAULT_LIMITS): GroupDraft {
  if (d.members.includes(key)) return { ...d, members: d.members.filter((m) => m !== key) };
  if (d.members.length >= limits.maxMembers) return d;
  return { ...d, members: [...d.members, key] };
}

/** Name proposed from the picked bots ("Scout, Writer und Hermes"); the user can change it. */
export function suggestName(labels: readonly string[], and: string): string {
  if (!labels.length) return '';
  if (labels.length === 1) return labels[0];
  const s = `${labels.slice(0, -1).join(', ')} ${and} ${labels[labels.length - 1]}`;
  return s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s;
}

// ------------------------------------------------------------------ errors

export type GroupFailure = 'offline' | 'off' | 'members' | 'running' | 'busy' | 'gone' | 'tooLong' | 'unknown' | 'limit' | 'server';

/** bridge error code → what the app says (never the server's free text) */
export function failureOf(status: number, json: unknown): GroupFailure {
  if (status === 0) return 'offline';
  const code = obj(obj(json)?.error)?.code;
  switch (code) {
    case 'groups_off':
      return 'off';
    case 'invalid_members':
      return 'members';
    case 'round_running':
      return 'running';
    case 'busy':
      return 'busy';
    case 'members_gone':
      return 'gone';
    case 'text_too_long':
      return 'tooLong';
    case 'unknown_group':
      return 'unknown';
    case 'limit':
      return 'limit';
    default:
      return status === 404 ? 'unknown' : 'server';
  }
}

/** The owner's command to switch groups on (shown to admin devices when the switch is off). */
export const ENABLE_GROUPS_COMMAND = 'hermes-ui-plus-bridge groups enable';

// ------------------------------------------------------------------ approvals in the bot's own chat

/** A group approval as the chat's approval card wants it (ApprovalStack). The group's name goes before the reason. */
export function toApprovalRequest(a: GroupApproval, fromGroup: (group: string) => string): ApprovalRequest {
  const choices = (a.choices ?? ['once', 'always', 'deny']).filter((c): c is ApprovalChoice => c === 'once' || c === 'session' || c === 'always' || c === 'deny');
  const from = fromGroup(a.groupName || a.groupId);
  return {
    runId: a.runId,
    requestId: a.requestId,
    command: a.command,
    description: a.description ? `${from} · ${a.description}` : from,
    choices: choices.length ? choices : ['once', 'deny'],
    timestamp: Math.floor((a.at || Date.now()) / 1000),
    ...(a.expiresAt ? { expiresAt: a.expiresAt, deadlineAt: a.expiresAt } : {}),
    receivedAt: a.at || Date.now(),
  };
}
