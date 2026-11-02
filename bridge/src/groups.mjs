// Bot groups (Bots v2 slice 6, docs/BOT-GROUPS.md): a group chat of 2 to 6 bots, run by the bridge.
//
// Hermes has hosted rooms (`groups.*`), but only as dashboard WebSocket RPC behind the admin credential (v0.22.x and
// main as of 2026-10-21); api_server has no room hosting. So the bridge drives the rounds itself, over the normal chat
// API, with Hermes Desktop's conventions so a Desktop user learns nothing new:
//   - every member talks in its own hidden session `Group: <group id>` (id `huigroup-<group>-<bot>`), fed only the room
//     messages that are new since its last turn;
//   - a user message starts a round: the bots named with @ answer, else the first bot (the leader); @alle / @everyone
//     asks every member; a bot that has nothing to add answers exactly "(pass)" and stays invisible;
//   - a bot that names a teammate with @ hands work over: a grey hand-over line, then that teammate's turn;
//   - at most 8 turns per round (every turn is one model call, also a "(pass)"), then the group waits for the user;
//   - approvals never show in the group: the request is the normal approval event of that bot (push, "Wartet auf
//     dich"); the app shows the card in the bot's own chat and the group shows "<Bot> wartet auf eine Freigabe".
//
// Owner switch, default off (like the other bot rights): BRIDGE_GROUPS=on|off, unset = <state-dir>/groups-policy.json
// (`hermes-ui-plus-bridge groups enable|disable`, PUT /bridge/groups/rights). Groups are kept in
// <state-dir>/groups.json (no state dir: in memory, only with BRIDGE_GROUPS=on).
//
// Routes (device auth like every /bridge route):
//   GET    /bridge/groups                -> {enabled, reason?, admin, limits, groups: [summary], approvals: [pending]}
//   POST   /bridge/groups                {name, members} -> 201 {group}
//   GET    /bridge/groups/<id>[?since=n] -> {group, entries (seq > since), seq, round|null}
//   PATCH  /bridge/groups/<id>           {name?, members?} -> {group}
//   DELETE /bridge/groups/<id>           -> 204 (member sessions deleted on Hermes, best effort)
//   POST   /bridge/groups/<id>/messages  {text} -> 202 {seq, round}   (409 round_running)
//   POST   /bridge/groups/<id>/stop      -> {stopped}
//   GET    /bridge/groups/rights         admin only -> {setting, enabled}
//   PUT    /bridge/groups/rights         admin only {enabled: bool|null} -> like GET
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { silentLogger } from './log.mjs';
import { writeFileAtomicSync } from './atomic-write.mjs';
import { createSseParser } from './sse.mjs';
import { upstreamUrl } from './paths.mjs';
import { DEFAULT_PROFILE, isProfileName, profilePrefix } from './profiles.mjs';
import { corsHeaders } from './cors.mjs';

export const GROUPS_PATH = '/bridge/groups';
export const GROUPS_RIGHTS_PATH = '/bridge/groups/rights';
export const GROUP_LIMITS = Object.freeze({ minMembers: 2, maxMembers: 6, perRound: 8, groups: 30, log: 400, name: 60, text: 8000, reply: 16000 });
/** At most this many rounds run at the same time on one bridge (each one is a chain of model calls). */
export const MAX_RUNNING_ROUNDS = 3;
export const GROUP_ID = /^g[a-z0-9]{10}$/;
export const GROUP_SESSION_PREFIX = 'huigroup-';
const SESSION_RE = /^huigroup-(g[a-z0-9]{10})-([a-z0-9][a-z0-9_-]{0,63})$/;
const BODY_MAX = 32 * 1024;
const TURN_TIMEOUT_MS = 15 * 60_000; // an approval may hold a turn for Hermes' approvals.timeout (default 5 min)
const PARTIAL_MAX = 4000;
// what a turn keeps of its answer: past clipReply's limit, with room to see that it was cut (a turn runs up to 15 min)
const REPLY_BUFFER = GROUP_LIMITS.reply + 1024;
const LINE_MAX = 4000; // one room line in a member's prompt
const DELTA_LINES = 60;
const EVERYONE = new Set(['everyone', 'all', 'alle', 'todos', 'todas']);
const USER_TAGS = new Set(['user', 'du', 'you', 'tu', 'tú']);

/** BRIDGE_GROUPS → 'on' | 'off' | '' (the owner's switch in groups-policy.json decides). Throws on anything else. */
export function parseGroupsSetting(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return '';
  if (/^(on|1|true|yes)$/.test(v)) return 'on';
  if (/^(off|0|false|no)$/.test(v)) return 'off';
  throw new Error('BRIDGE_GROUPS must be on or off (unset: `hermes-ui-plus-bridge groups enable` decides)');
}

export const isMemberName = (n) => n === DEFAULT_PROFILE || isProfileName(n);
export const groupSessionId = (groupId, bot) => `${GROUP_SESSION_PREFIX}${groupId}-${bot}`;
/** `huigroup-<group>-<bot>` → {groupId, bot} | null */
export function parseGroupSessionId(id) {
  const m = SESSION_RE.exec(String(id ?? ''));
  return m ? { groupId: m[1], bot: m[2] } : null;
}

const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const collapse = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The @-handle a member is addressed with: its profile name, `hermes` for the default profile. */
export const mentionTag = (key) => (key === DEFAULT_PROFILE ? 'hermes' : key);

/**
 * Every form a member answers to (lowercase): profile name, collapsed name, display label, collapsed label, first word
 * of the label; the default bot also to "hermes" and "default".
 * @param {{key: string, label?: string}} m
 */
export function mentionForms(m) {
  const forms = new Set([m.key.toLowerCase(), collapse(m.key)]);
  if (m.key === DEFAULT_PROFILE) { forms.add('hermes'); forms.add('default'); }
  const label = String(m.label ?? '').trim();
  if (label) {
    forms.add(label.toLowerCase());
    forms.add(collapse(label));
    forms.add(label.split(/\s+/)[0].toLowerCase());
  }
  forms.delete('');
  return forms;
}

/**
 * Deterministic @mention parse: `@name`, `@"two words"`, `@alle` / `@everyone`. Members in the order they are first
 * named; @user / @du is ignored. Mentions inside `code` are ignored.
 * @param {string} text
 * @param {{key: string, label?: string}[]} members
 * @returns {{keys: string[], everyone: boolean}}
 */
export function parseMentions(text, members) {
  const src = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const keys = [];
  let everyone = false;
  const forms = members.map((m) => ({ key: m.key, forms: mentionForms(m) }));
  const re = /(^|[^\p{L}\p{N}_@.])@(?:"([^"\n]{1,60})"|([\p{L}\p{N}][\p{L}\p{N}_-]{0,63}))/gu;
  let m;
  while ((m = re.exec(src))) {
    const raw = (m[2] ?? m[3] ?? '').trim().toLowerCase().replace(/[-_]+$/, '');
    if (!raw) continue;
    if (EVERYONE.has(raw)) { everyone = true; continue; }
    if (USER_TAGS.has(raw)) continue;
    const hit = forms.find((f) => f.forms.has(raw) || f.forms.has(collapse(raw)));
    if (hit && !keys.includes(hit.key)) keys.push(hit.key);
  }
  return { keys, everyone };
}

/** "(pass)", "pass", "(Pass)." or nothing at all = the member has nothing to add. */
export function isPass(text) {
  const t = String(text ?? '').trim();
  return !t || /^\(?\s*pass\s*\)?[.!]?$/i.test(t);
}

/** A reply as the room shows it: trimmed, a leading "Name:" echo of its own label removed, clipped. */
export function cleanReply(text, member) {
  let t = String(text ?? '').trim();
  for (const f of [member.label, member.key, mentionTag(member.key)].filter(Boolean)) {
    const esc = String(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\*{0,2}@?${esc}(\\s*\\(you\\))?\\s*:\\s*\\*{0,2}\\s*`, 'i'), '');
  }
  return t.length > GROUP_LIMITS.reply ? `${t.slice(0, GROUP_LIMITS.reply - 1)}…` : t;
}

/** A streamed piece onto the answer so far, up to the buffer: the rest of a runaway answer is not kept. */
export function appendReply(text, piece) {
  return text.length >= REPLY_BUFFER ? text : text + piece.slice(0, REPLY_BUFFER - text.length);
}

/** The sentence of `text` that hands work to `member`, without the mention itself (hand-over line). */
export function handoffTask(text, member) {
  const src = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  const sentences = src.split(/(?<=[.!?])\s+|\n+/);
  const forms = mentionForms(member);
  const re = /@(?:"([^"\n]{1,60})"|([\p{L}\p{N}][\p{L}\p{N}_-]{0,63}))/gu;
  for (const s of sentences) {
    let hit = false;
    const stripped = s.replace(re, (all, q, w) => {
      const raw = String(q ?? w ?? '').toLowerCase();
      if (forms.has(raw) || forms.has(collapse(raw))) { hit = true; return ''; }
      return all;
    });
    if (!hit) continue;
    const task = stripped.replace(/^[\s,:;–-]+|[\s,:;–-]+$/g, '').replace(/\s{2,}/g, ' ').replace(/^\*+|\*+$/g, '').trim();
    return task.length > 140 ? `${task.slice(0, 139)}…` : task;
  }
  return '';
}

// Openers of Hermes' own control frames: a member reply is republished to its peers inside a user prompt, so a reply
// that reproduces one must not read as harness input to them (same idea as Hermes Desktop's group prompt).
const CONTROL_FRAME_RE = /\[(?=\/?OUT-OF-BAND USER MESSAGE|CONTEXT COMPACTION|CONTEXT SUMMARY\]|PRIOR CONTEXT|Runtime note:|System note:|System:|SYSTEM\]|IMPORTANT:|Planning state preserved|ASYNC DELEGATION)/gi;

/**
 * One room line as `viewer` sees it: `User (user): …`, `Scout: …`, `Scout (you): …`, hand-overs as `Scout → Writer: …`.
 * @param {any} e entry
 * @param {string} viewer member key
 * @param {(key: string) => string} labelOf
 */
export function formatRoomLine(e, viewer, labelOf) {
  const clip = (s) => {
    const t = String(s ?? '').replace(CONTROL_FRAME_RE, '[member-quoted ');
    return t.length > LINE_MAX ? `${t.slice(0, LINE_MAX - 1)}…` : t;
  };
  if (e.kind === 'user') return `User (user): ${clip(e.text)}`;
  if (e.kind === 'bot') return `${labelOf(e.bot)}${e.bot === viewer ? ' (you)' : ''}: ${clip(e.text)}`;
  if (e.kind === 'handoff') return `${labelOf(e.bot)} → ${labelOf(e.to)}${e.to === viewer ? ' (you)' : ''}: ${clip(e.text)}`;
  return null;
}

/**
 * The whole user message of one member turn: who is in the room, the new room lines, the rules. Rules travel in the
 * turn (not in SOUL.md) so every existing bot can join a group without a profile change.
 * @param {{groupName: string, members: {key: string, label: string}[], viewer: string, lines: string[], omitted?: number, nudge?: boolean}} o
 */
export function buildTurnPrompt({ groupName, members, viewer, lines, omitted = 0, nudge = false }) {
  const peers = members.filter((m) => m.key !== viewer).map((m) => (m.label ? `${m.label} (@${mentionTag(m.key)})` : `@${mentionTag(m.key)}`));
  const me = members.find((m) => m.key === viewer);
  const out = [
    `[Group chat: "${groupName.replace(/"/g, "'")}"] You are ${me?.label ? `${me.label} (@${mentionTag(viewer)})` : `@${mentionTag(viewer)}`}, one participant in a group chat with ${peers.join(', ') || 'no one else yet'} and the user.`,
    '',
    'New messages in the room since your last turn (oldest first):',
    ...(omitted > 0 ? [`  … ${omitted} earlier room message${omitted === 1 ? '' : 's'} omitted`] : []),
    ...lines.map((l) => `  ${l}`),
    '',
    'Rules for this room:',
    '- Reply with ONE message ONLY if you have something new worth adding: answer what is aimed at you, build on what was just said, hand off work, or report a real result. Keep chatter to 1-3 sentences; deliver real results at full quality.',
    '- If you have nothing new to add, reply with exactly "(pass)". Passing is good: it lets the conversation settle.',
    '- To hand work to a teammate, name them as @name in a sentence that says what they should do. Name only one teammate per step unless the user asked for everyone. Do not repeat points already made.',
    '- If a step needs the user\'s approval, ask for it as usual: the request goes to your own chat with the user, not to this room.',
    '- Never reveal content from your private chats with the user. Your reply goes to the room verbatim: no preamble, no "Name:" prefix.',
  ];
  if (nudge) {
    out.push('', 'You just replied "(pass)", but the user addressed YOU in this turn. A direct question cannot be passed on: reply now with your answer, your result, or a plain statement that you cannot answer and why.');
  }
  return out.join('\n');
}

/**
 * Who answers a user message: the members named with @ (in that order), every member for @alle, else the leader.
 * @param {string} text
 * @param {{key: string, label?: string}[]} members (leader first)
 */
export function respondersFor(text, members) {
  const { keys, everyone } = parseMentions(text, members);
  if (everyone) return members.map((m) => m.key);
  if (keys.length) return keys;
  return members.length ? [members[0].key] : [];
}

const newId = () => `g${randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '0')}`;

/** Owner policy file (`groups-policy.json`): {enabled?: boolean}. Re-read when its mtime changes (CLI edits). */
function createPolicy(stateDir) {
  const file = stateDir ? path.join(stateDir, 'groups-policy.json') : '';
  let cache = { mtime: -1, value: /** @type {{enabled?: boolean}} */ ({}) };
  function read() {
    if (!file) return {};
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs === cache.mtime) return cache.value;
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = { mtime: st.mtimeMs, value: plain(j) && typeof j.enabled === 'boolean' ? { enabled: j.enabled } : {} };
    } catch {
      cache = { mtime: -1, value: {} };
    }
    return cache.value;
  }
  function write(enabled) {
    if (!file) throw Object.assign(new Error('no state dir'), { code: 'state_dir_required' });
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileAtomicSync(file, JSON.stringify(enabled === null ? {} : { enabled }, null, 2) + '\n');
    cache = { mtime: -1, value: {} };
  }
  return { file, read, write };
}

/**
 * `hermes-ui-plus-bridge groups status | enable | disable`.
 * @param {string|undefined} sub
 * @param {{env: Record<string, string|undefined>, stateDir: string}} o
 * @returns {string[]}
 */
export function groupsCli(sub, { env, stateDir }) {
  const usage = 'usage: hermes-ui-plus-bridge groups status | enable | disable';
  const policy = createPolicy(stateDir);
  let setting;
  try { setting = parseGroupsSetting(env.BRIDGE_GROUPS); } catch (e) { setting = `invalid (${e.message})`; }
  if (!sub || sub === 'status') {
    const file = policy.read().enabled;
    return [
      `bot groups: ${setting === 'on' ? 'on (BRIDGE_GROUPS=on)' : setting === 'off' ? 'off (BRIDGE_GROUPS=off)' : `${file === true ? 'on' : 'off'} (${policy.file || 'no state dir'})`}`,
      `limits: ${GROUP_LIMITS.minMembers} to ${GROUP_LIMITS.maxMembers} bots per group, at most ${GROUP_LIMITS.perRound} model calls per message`,
    ];
  }
  if (sub === 'enable' || sub === 'disable') {
    if (!stateDir) throw new Error('groups need a state directory (--state-dir or BRIDGE_STATE_DIR) to store the switch and the groups');
    policy.write(sub === 'enable');
    const note = setting === 'on' || setting === 'off' ? ` (BRIDGE_GROUPS=${env.BRIDGE_GROUPS} still overrides this)` : '';
    return [`bot groups ${sub}d${note}; a running bridge picks this up at once`];
  }
  throw new Error(usage);
}

/**
 * @param {{auth: any, corsOrigins?: string[], upstream: {baseUrl: string, apiKey?: string}}} config
 * @param {{env?: Record<string, string|undefined>, stateDir?: string, profiles: any, approvals?: any, turns?: any,
 *   fetch?: typeof fetch, logger?: any, now?: () => number, saveDelayMs?: number}} o
 */
export function createGroups(config, o) {
  const env = o.env ?? process.env;
  const setting = parseGroupsSetting(env.BRIDGE_GROUPS);
  const stateDir = o.stateDir ?? '';
  const policy = createPolicy(stateDir);
  const profiles = o.profiles;
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const corsOrigins = config.corsOrigins ?? [];
  const dataFile = stateDir ? path.join(stateDir, 'groups.json') : '';
  const saveDelayMs = o.saveDelayMs ?? 300;

  /** @type {Map<string, any>} id -> group record */
  const groups = new Map();
  /** @type {Map<string, any>} id -> running round (memory only) */
  const rounds = new Map();
  /** requestId -> {groupId, bot, runId, requestId, command, description, choices, expiresAt, at} */
  const pendingApprovals = new Map();
  let saveTimer = null;
  let stopped = false;

  // ------------------------------------------------------------------ store
  (function load() {
    if (!dataFile) return;
    try {
      const j = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      for (const g of Array.isArray(j?.groups) ? j.groups : []) {
        if (!plain(g) || !GROUP_ID.test(g.id) || !Array.isArray(g.members) || !Array.isArray(g.log)) continue;
        const rec = { id: g.id, name: oneLine(g.name, GROUP_LIMITS.name) || g.id, members: g.members.filter(isMemberName).slice(0, GROUP_LIMITS.maxMembers), createdAt: Number(g.createdAt) || now(), updatedAt: Number(g.updatedAt) || now(), seq: Number(g.seq) || 0, log: g.log.filter(plain).slice(-GROUP_LIMITS.log), seen: plain(g.seen) ? g.seen : {}, sessions: plain(g.sessions) ? g.sessions : {} };
        if (g.running) addEntry(rec, { kind: 'note', note: 'interrupted' }, false); // the bridge restarted mid-round
        groups.set(rec.id, rec);
      }
    } catch (e) {
      if (e?.code !== 'ENOENT') log.warn?.('groups: state unreadable, starting empty', { error: String(e?.message ?? e).slice(0, 80) });
    }
  })();

  function saveNow() {
    if (!dataFile) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      const out = [...groups.values()].map((g) => ({ ...g, running: rounds.has(g.id) || undefined }));
      writeFileAtomicSync(dataFile, JSON.stringify({ version: 1, groups: out }));
    } catch (e) {
      log.warn?.('groups: save failed', { error: String(e?.code ?? e?.message ?? e).slice(0, 80) });
    }
  }
  function save() {
    if (!dataFile || saveTimer) return;
    saveTimer = setTimeout(saveNow, saveDelayMs);
    saveTimer.unref?.();
  }

  function addEntry(g, e, persist = true) {
    g.seq += 1;
    const entry = { seq: g.seq, at: now(), ...e };
    g.log.push(entry);
    if (g.log.length > GROUP_LIMITS.log) g.log.splice(0, g.log.length - GROUP_LIMITS.log);
    g.updatedAt = entry.at;
    if (persist) save();
    return entry;
  }

  // ------------------------------------------------------------------ access
  function enabledByOwner() {
    if (setting === 'off') return false;
    if (setting === 'on') return true;
    return policy.read().enabled === true;
  }
  /** {enabled} or {enabled: false, reason: bridge_off | owner_off} */
  function state() {
    if (setting === 'off') return { enabled: false, reason: 'bridge_off' };
    if (!enabledByOwner()) return { enabled: false, reason: 'owner_off' };
    return { enabled: true };
  }
  const isAdmin = (who) => !who || who.kind === 'admin' || who.kind === 'open';

  /** Labels of the bridge's bots (default first). */
  function roster() {
    const list = typeof profiles?.list === 'function' ? profiles.list() : [{ name: DEFAULT_PROFILE, default: true }];
    return list.map((p) => ({ key: p.default ? DEFAULT_PROFILE : p.name, label: p.label ?? (p.default ? 'Hermes' : p.name), ...(p.color ? { color: p.color } : {}) }));
  }
  function labelOfFn() {
    const r = new Map(roster().map((m) => [m.key, m.label]));
    return (key) => r.get(key) ?? (key === DEFAULT_PROFILE ? 'Hermes' : key);
  }
  const memberAllowed = (key) => key === DEFAULT_PROFILE || (typeof profiles?.allowed === 'function' ? profiles.allowed(key) : isProfileName(key));

  // ------------------------------------------------------------------ Hermes calls
  const authHeaders = () => (config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {});
  async function hermesJson(method, p, body, ms = 20_000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await doFetch(upstreamUrl(config.upstream.baseUrl, p).href, {
        method,
        headers: { ...authHeaders(), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctl.signal,
      });
      const text = await r.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: r.status, json };
    } catch {
      return { status: 0, json: null };
    } finally { clearTimeout(timer); }
  }

  /** The member's hidden `Group: <id>` session: create once (adopt on 409), hide it. Never throws. */
  async function ensureSession(g, bot) {
    if (g.sessions[bot]) return g.sessions[bot];
    const id = groupSessionId(g.id, bot);
    const prefix = profilePrefix(bot);
    const made = await hermesJson('POST', `${prefix}/api/sessions`, { id, title: `Group: ${g.id}` });
    if (made.status === 201 || made.status === 409) {
      await hermesJson('PATCH', `${prefix}/api/sessions/${encodeURIComponent(id)}`, { hidden: true });
    }
    // 404/405 (older Hermes without the sessions API): the chat call below still names the session
    g.sessions[bot] = id;
    save();
    return id;
  }

  /**
   * One member turn: streamed chat call on the member's group session. Resolves {text} | {error: code} | {stopped}.
   * @param {any} g @param {string} bot @param {string} prompt @param {any} round
   */
  async function runTurn(g, bot, prompt, round) {
    const sessionId = await ensureSession(g, bot);
    if (round.ac.signal.aborted) return { stopped: true };
    const prefix = profilePrefix(bot);
    const profile = bot === DEFAULT_PROFILE ? null : bot;
    const ctl = new AbortController();
    const onStop = () => ctl.abort();
    round.ac.signal.addEventListener('abort', onStop, { once: true });
    const timer = setTimeout(() => ctl.abort(), TURN_TIMEOUT_MS);
    const endTurn = o.turns?.begin?.(sessionId, profile) ?? (() => {});
    const watch = o.approvals?.observe?.({ sessionId: () => sessionId, profile }) ?? null;
    let text = '';
    let error = null;
    round.partial = '';
    round.step = '';
    const myRequests = new Set();
    const parser = createSseParser(({ event, data }) => {
      if (event === 'approval.request') {
        let j; try { j = JSON.parse(data); } catch { return; }
        const runId = oneLine(j?.run_id, 256);
        const requestId = oneLine(j?.request_id, 256);
        if (!runId || !requestId || pendingApprovals.has(requestId)) return;
        myRequests.add(requestId);
        const ap = {
          groupId: g.id, bot, runId, requestId,
          command: oneLine(j.command, 200), ...(j.description ? { description: oneLine(j.description, 200) } : {}),
          ...(Array.isArray(j.choices) ? { choices: j.choices.filter((c) => typeof c === 'string').slice(0, 5) } : {}),
          at: now(), expiresAt: now() + (Number(env.BRIDGE_APPROVAL_TIMEOUT_S) > 0 ? Number(env.BRIDGE_APPROVAL_TIMEOUT_S) * 1000 : 300_000),
        };
        pendingApprovals.set(requestId, ap);
        addEntry(g, { kind: 'note', note: 'approval', bot, runId, requestId });
        return;
      }
      if (event === 'approval.responded') {
        let j; try { j = JSON.parse(data); } catch { return; }
        pendingApprovals.delete(oneLine(j?.request_id, 256));
        return;
      }
      if (event === 'hermes.tool.progress') {
        let j; try { j = JSON.parse(data); } catch { return; }
        round.step = oneLine(j?.label ?? j?.title ?? j?.tool ?? j?.name, 80);
        return;
      }
      if (data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch { return; }
      if (j?.error) { error = 'upstream_error'; return; }
      const d = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content;
      if (typeof d === 'string' && d) {
        text = appendReply(text, d);
        // the agent went on after an approval: the question is over
        for (const id of myRequests) pendingApprovals.delete(id);
        if (round.partial.length < PARTIAL_MAX) round.partial = text.slice(0, PARTIAL_MAX);
      }
    });
    try {
      const res = await doFetch(upstreamUrl(config.upstream.baseUrl, `${prefix}/v1/chat/completions`).href, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json', accept: 'text/event-stream', 'x-hermes-session-id': sessionId },
        body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: prompt }] }),
        signal: ctl.signal,
      });
      if (res.status === 401 || res.status === 403) return { error: 'not_connected' };
      if (res.status === 404) return { error: 'unknown_bot' };
      if (res.status === 409 || res.status === 429) return { error: 'busy' };
      if (!res.ok || !res.body) return { error: 'upstream_error' };
      for await (const chunk of res.body) {
        parser.push(chunk);
        watch?.push(chunk);
      }
      parser.end();
      if (error && !text) return { error };
      return { text };
    } catch {
      if (round.ac.signal.aborted) return { stopped: true, text };
      return { error: ctl.signal.aborted ? 'timeout' : 'upstream_error' };
    } finally {
      clearTimeout(timer);
      round.ac.signal.removeEventListener('abort', onStop);
      watch?.end();
      endTurn();
      for (const id of myRequests) pendingApprovals.delete(id);
      round.partial = '';
      round.step = '';
    }
  }

  // ------------------------------------------------------------------ rounds
  /** New room lines for `bot` since it last saw the room (its own lines excluded), newest kept within the window. */
  function deltaFor(g, bot, labelOf) {
    const since = Number(g.seen[bot]) || 0;
    const lines = [];
    for (const e of g.log) {
      if (e.seq <= since || ((e.kind === 'bot' || e.kind === 'handoff') && e.bot === bot)) continue;
      const l = formatRoomLine(e, bot, labelOf);
      if (l) lines.push(l);
    }
    const kept = lines.slice(-DELTA_LINES);
    return { lines: kept, omitted: lines.length - kept.length };
  }

  async function drive(g, round, first, everyone = false) {
    const labelOf = labelOfFn();
    const members = () => g.members.map((key) => ({ key, label: labelOf(key) }));
    // who the user addressed (by @name, or the leader for a plain message) may not pass silently: one re-ask; @alle may
    const addressed = new Set(everyone ? [] : first);
    const nudged = new Set();
    const queue = [...first];
    let spoke = 0;
    try {
      while (queue.length && !round.ac.signal.aborted) {
        if (round.turns >= GROUP_LIMITS.perRound) break;
        const bot = queue.shift();
        if (!g.members.includes(bot)) continue;
        round.speaker = bot;
        round.queue = [...queue];
        const delta = deltaFor(g, bot, labelOf);
        const seenUpTo = g.seq;
        let r = await runTurn(g, bot, buildTurnPrompt({ groupName: g.name, members: members(), viewer: bot, lines: delta.lines, omitted: delta.omitted }), round);
        round.turns += 1;
        if (!r.stopped && !r.error && isPass(r.text) && addressed.has(bot) && !nudged.has(bot) && round.turns < GROUP_LIMITS.perRound) {
          nudged.add(bot);
          r = await runTurn(g, bot, buildTurnPrompt({ groupName: g.name, members: members(), viewer: bot, lines: [], nudge: true }), round);
          round.turns += 1;
        }
        g.seen[bot] = seenUpTo;
        if (r.stopped) {
          const partial = cleanReply(r.text ?? '', { key: bot, label: labelOf(bot) });
          if (partial && !isPass(partial)) addEntry(g, { kind: 'bot', bot, text: partial, partial: true });
          break;
        }
        if (r.error) { addEntry(g, { kind: 'note', note: 'error', bot, code: r.error }); continue; }
        if (isPass(r.text)) { round.passes += 1; continue; }
        const text = cleanReply(r.text, { key: bot, label: labelOf(bot) });
        addEntry(g, { kind: 'bot', bot, text });
        g.seen[bot] = g.seq;
        spoke += 1;
        const named = parseMentions(text, members());
        const next = (named.everyone ? g.members : named.keys).filter((k) => k !== bot);
        for (const to of next) {
          if (queue.includes(to)) continue;
          queue.push(to);
          addEntry(g, { kind: 'handoff', bot, to, text: handoffTask(text, { key: to, label: labelOf(to) }) });
        }
      }
      if (round.ac.signal.aborted) addEntry(g, { kind: 'note', note: 'stopped' });
      else if (queue.length) addEntry(g, { kind: 'note', note: 'capped', waiting: queue.slice(0, GROUP_LIMITS.maxMembers) });
      else if (!spoke) addEntry(g, { kind: 'note', note: 'quiet' }); // never an empty answer: say that nobody had anything to add
    } catch (e) {
      log.warn?.('groups: round failed', { group: g.id, error: String(e?.message ?? e).slice(0, 80) });
      addEntry(g, { kind: 'note', note: 'error', code: 'bridge_error' });
    } finally {
      rounds.delete(g.id);
      saveNow();
      log.info?.('groups: round done', { group: g.id, turns: round.turns, spoke, passes: round.passes });
    }
  }

  function roundView(g) {
    const r = rounds.get(g.id);
    if (!r) return null;
    const waiting = [...pendingApprovals.values()].filter((a) => a.groupId === g.id).map((a) => ({ bot: a.bot, runId: a.runId, requestId: a.requestId }));
    return { running: true, startedAt: r.startedAt, turns: r.turns, max: GROUP_LIMITS.perRound, speaker: r.speaker ?? null, ...(r.step ? { step: r.step } : {}), partial: r.partial ?? '', queue: r.queue ?? [], waiting };
  }

  // ------------------------------------------------------------------ views
  const groupView = (g) => ({ id: g.id, name: g.name, members: g.members, createdAt: g.createdAt, updatedAt: g.updatedAt });
  function summary(g) {
    const last = [...g.log].reverse().find((e) => e.kind === 'bot' || e.kind === 'user');
    return {
      ...groupView(g),
      running: rounds.has(g.id),
      ...(last ? { last: { kind: last.kind, ...(last.bot ? { bot: last.bot } : {}), text: oneLine(last.text, 140), at: last.at } } : {}),
    };
  }
  const approvalsView = () => [...pendingApprovals.values()].map((a) => ({ ...a, groupName: groups.get(a.groupId)?.name ?? '' }));

  // ------------------------------------------------------------------ http
  const pathOf = (req) => (req.url ?? '').split('?')[0];
  const matches = (req) => {
    if (req.method === 'OPTIONS') return false;
    const p = pathOf(req);
    return p === GROUPS_PATH || p.startsWith(`${GROUPS_PATH}/`);
  };
  function headers(req, extra = {}) {
    const h = { 'x-hermes-ui-bridge': '1', 'cache-control': 'no-store', ...extra };
    Object.assign(h, corsHeaders(corsOrigins, req));
    return h;
  }
  function send(req, res, status, body, extra = {}) {
    if (res.headersSent) return res.destroy();
    if (status === 204) { res.writeHead(204, headers(req, extra)); return res.end(); }
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, headers(req, { 'content-type': 'application/json', 'content-length': buf.length, ...extra }));
    res.end(buf);
  }
  const fail = (req, res, status, message, code, more = {}, extra = {}) =>
    send(req, res, status, { error: { message, type: status < 500 ? 'invalid_request_error' : 'bridge_error', code, ...more } }, extra);

  async function readJson(req, res) {
    if (Number(req.headers['content-length']) > BODY_MAX) {
      req.resume();
      res.setHeader('connection', 'close');
      fail(req, res, 413, 'Request body too large', 'payload_too_large');
      return undefined;
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > BODY_MAX) {
        res.setHeader('connection', 'close');
        fail(req, res, 413, 'Request body too large', 'payload_too_large');
        return undefined;
      }
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch {
      fail(req, res, 400, 'Body must be JSON', 'invalid_json');
      return undefined;
    }
  }

  /** members: 2..6 distinct bots the bridge serves; returns the list or an error message */
  function checkMembers(v) {
    if (!Array.isArray(v)) return { error: 'members must be a list of bot names' };
    const out = [];
    for (const m of v) {
      if (typeof m !== 'string' || !isMemberName(m)) return { error: 'Unknown bot' };
      if (!memberAllowed(m)) return { error: `Unknown bot ${m.slice(0, 64)}` };
      if (!out.includes(m)) out.push(m);
    }
    if (out.length < GROUP_LIMITS.minMembers || out.length > GROUP_LIMITS.maxMembers) return { error: `A group has ${GROUP_LIMITS.minMembers} to ${GROUP_LIMITS.maxMembers} bots` };
    return { members: out };
  }

  async function rights(req, res, who) {
    if (!isAdmin(who)) { req.resume(); return fail(req, res, 403, 'Device tokens cannot change the groups switch (use BRIDGE_TOKEN)', 'admin_required'); }
    const view = () => ({ setting: setting || 'file', enabled: enabledByOwner() });
    if (req.method === 'GET') { req.resume(); return send(req, res, 200, view()); }
    if (req.method !== 'PUT') { req.resume(); return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'GET, PUT' }); }
    const body = await readJson(req, res);
    if (body === undefined) return;
    if (!plain(body) || Object.keys(body).some((k) => k !== 'enabled') || (body.enabled !== null && typeof body.enabled !== 'boolean')) {
      return fail(req, res, 400, 'Body must be {enabled: true|false|null}', 'invalid_request');
    }
    if (!stateDir) return fail(req, res, 409, 'The groups switch needs a state directory (BRIDGE_STATE_DIR); without one only BRIDGE_GROUPS applies', 'state_dir_required');
    policy.write(body.enabled);
    return send(req, res, 200, view());
  }

  async function handle(req, res) {
    const who = config.auth.check(req);
    if (!who) { req.resume(); return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key', {}, { 'www-authenticate': 'Bearer' }); }
    const p = pathOf(req);
    if (p === GROUPS_RIGHTS_PATH) return rights(req, res, who);
    const st = state();
    if (p === GROUPS_PATH && req.method === 'GET') {
      req.resume();
      const base = { enabled: st.enabled, ...(st.reason ? { reason: st.reason } : {}), admin: isAdmin(who), limits: { minMembers: GROUP_LIMITS.minMembers, maxMembers: GROUP_LIMITS.maxMembers, perRound: GROUP_LIMITS.perRound } };
      if (!st.enabled) return send(req, res, 200, { ...base, groups: [], approvals: [] });
      const list = [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary);
      return send(req, res, 200, { ...base, groups: list, approvals: approvalsView() });
    }
    if (!st.enabled) { req.resume(); return fail(req, res, 404, 'Bot groups are off on this server', 'groups_off', { reason: st.reason }); }

    if (p === GROUPS_PATH) {
      if (req.method !== 'POST') { req.resume(); return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'GET, POST' }); }
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!plain(body) || Object.keys(body).some((k) => k !== 'name' && k !== 'members')) return fail(req, res, 400, 'Body must be {name, members}', 'invalid_request');
      const checked = checkMembers(body.members);
      if (checked.error) return fail(req, res, 400, checked.error, 'invalid_members');
      if (groups.size >= GROUP_LIMITS.groups) return fail(req, res, 409, `At most ${GROUP_LIMITS.groups} groups`, 'limit', { limit: GROUP_LIMITS.groups });
      const labelOf = labelOfFn();
      const name = oneLine(body.name, GROUP_LIMITS.name) || checked.members.map(labelOf).join(', ').slice(0, GROUP_LIMITS.name);
      let id = newId();
      while (groups.has(id)) id = newId();
      const g = { id, name, members: checked.members, createdAt: now(), updatedAt: now(), seq: 0, log: [], seen: {}, sessions: {} };
      groups.set(id, g);
      saveNow();
      log.info?.('groups: created', { group: id, members: g.members.length, by: who.kind });
      return send(req, res, 201, { group: groupView(g) });
    }

    const m = /^\/bridge\/groups\/(g[a-z0-9]{10})(\/messages|\/stop)?$/.exec(p);
    const g = m ? groups.get(m[1]) : null;
    if (!g) { req.resume(); return fail(req, res, 404, 'Unknown group', 'unknown_group'); }
    const sub = m[2] ?? '';

    if (sub === '/messages') {
      if (req.method !== 'POST') { req.resume(); return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'POST' }); }
      const body = await readJson(req, res);
      if (body === undefined) return;
      const text = plain(body) && typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return fail(req, res, 400, 'text is required', 'invalid_request');
      if (text.length > GROUP_LIMITS.text) return fail(req, res, 400, `At most ${GROUP_LIMITS.text} characters`, 'text_too_long');
      if (rounds.has(g.id)) return fail(req, res, 409, 'The group is still answering', 'round_running');
      if (rounds.size >= MAX_RUNNING_ROUNDS) return fail(req, res, 429, 'Too many groups are answering right now', 'busy', {}, { 'retry-after': '10' });
      const live = g.members.filter(memberAllowed);
      if (live.length < GROUP_LIMITS.minMembers) return fail(req, res, 409, 'Fewer than two of this group\'s bots are still on the server', 'members_gone');
      const entry = addEntry(g, { kind: 'user', text });
      const labelOf = labelOfFn();
      const liveMembers = live.map((key) => ({ key, label: labelOf(key) }));
      const first = respondersFor(text, liveMembers);
      const everyone = parseMentions(text, liveMembers).everyone;
      const round = { startedAt: now(), turns: 0, passes: 0, speaker: null, partial: '', step: '', queue: first, ac: new AbortController() };
      rounds.set(g.id, round);
      saveNow(); // `running` on disk: a restart mid-round says so in the group
      void drive(g, round, first, everyone);
      return send(req, res, 202, { seq: entry.seq, round: roundView(g) });
    }
    if (sub === '/stop') {
      req.resume();
      if (req.method !== 'POST') return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'POST' });
      const r = rounds.get(g.id);
      if (r) r.ac.abort();
      return send(req, res, 200, { stopped: !!r });
    }

    if (req.method === 'GET') {
      req.resume();
      const since = Math.max(0, Number(new URL(req.url ?? '/', 'http://x').searchParams.get('since')) || 0);
      return send(req, res, 200, { group: groupView(g), seq: g.seq, entries: g.log.filter((e) => e.seq > since), round: roundView(g) });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!plain(body) || Object.keys(body).some((k) => k !== 'name' && k !== 'members')) return fail(req, res, 400, 'Body must be {name?, members?}', 'invalid_request');
      if (body.members !== undefined) {
        if (rounds.has(g.id)) return fail(req, res, 409, 'The group is still answering', 'round_running');
        const checked = checkMembers(body.members);
        if (checked.error) return fail(req, res, 400, checked.error, 'invalid_members');
        g.members = checked.members;
      }
      if (body.name !== undefined) {
        const name = oneLine(body.name, GROUP_LIMITS.name);
        if (!name) return fail(req, res, 400, 'name must not be empty', 'invalid_request');
        g.name = name;
      }
      g.updatedAt = now();
      saveNow();
      return send(req, res, 200, { group: groupView(g) });
    }
    if (req.method === 'DELETE') {
      req.resume();
      rounds.get(g.id)?.ac.abort();
      groups.delete(g.id);
      saveNow();
      for (const [bot, sid] of Object.entries(g.sessions)) {
        if (isMemberName(bot)) void hermesJson('DELETE', `${profilePrefix(bot)}/api/sessions/${encodeURIComponent(String(sid))}`);
      }
      log.info?.('groups: deleted', { group: g.id, by: who.kind });
      return send(req, res, 204, null);
    }
    req.resume();
    return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'GET, PATCH, DELETE' });
  }

  return {
    matches,
    handle,
    state,
    /** pending group approvals (tests, doctor) */
    approvals: approvalsView,
    /** wait for running rounds (tests) */
    async idle() { while (rounds.size) await new Promise((r) => setTimeout(r, 5)); },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const r of rounds.values()) r.ac.abort();
      saveNow();
    },
  };
}
