/**
 * Ported from Pi Pocket `web/turns.js` (github.com/TannerMidd/pi-pocket, commit de612d5), MIT,
 * © 2026 Tanner Middleton – see NOTICE.md.
 *
 * What a group of thinking and tool calls did, in a line (`summarize`), and what a call came to, read from what its tool
 * printed (`testOutcome`, `diffCounts`, `matchCount`, `shortError`, `STOPPED`, …). Pure, no React / native imports
 * (node:test). Not ported: `itemsOf` / `rowsBefore` / `hasEnd` (transcript grouping belongs to the app flavor).
 *
 * Changes from Pocket: typed; `summarize` is split into `summaryParts` (structured: verb id + counted nouns) and
 * `formatSummary` (builds the sentence through an injectable `tr`, ICU templates under `ui.steps.*`), so the line can be
 * translated. `summarize(steps, thinking)` keeps Pocket's English output (`SUMMARY_EN`); `testCounts` exposes the
 * numbers behind `testOutcome`.
 */
import { interpolate, type Vars } from '../../i18n/core.ts';

/** A translate function for keys relative to `ui.steps` (e.g. `verb.read`). */
export type Tr = (key: string, vars?: Vars) => string;

type Table = { [key: string]: string | Table };

/** A `Tr` over a nested table of ICU templates (keys like `verb.read`); unknown keys come back as the key. */
export function trFrom(table: Table, locale = 'en-US'): Tr {
  return (key, vars) => {
    let node: string | Table | undefined = table;
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    return typeof node === 'string' ? interpolate(node, vars, locale) : key;
  };
}

export const short = (text: unknown, max = 160): string => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** How many lines a tool's text has, without a last empty one. */
export const lineCount = (text: string): number => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

/**
 * A tool's result without the notes it can end with: the harness's own (`<harness> [info] Showing lines 1-100 of 500…
 * </harness>`), and a tool's ("[1000 results limit reached…]", "[Some lines truncated…]").
 */
export const withoutNotes = (text: string): string =>
  text.replace(/\n*<harness>[\s\S]*?<\/harness>\s*$/, '').replace(/(?:\n\n\[[^\]\n]*\])+\s*$/, '');

/**
 * Grep's matches: its lines are `path:12: text`, and with context around them, `path-11- text` too. Every line, when
 * none looks like either.
 */
export function matchCount(text: string): number {
  const lines = text.split('\n').filter((line) => line !== '');
  const kinds = lines.map((line) => /^(.*?)([:-])(\d+)\2 /.exec(line)?.[2]);

  return kinds.some((kind) => kind === '-') ? kinds.filter((kind) => kind === ':').length : lines.length;
}

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export type DiffCounts = { added: number; removed: number };

/** Lines added and removed in an edit's diff (`+12 text`, `-12 text`), or null without one. */
export function diffCounts(diff: unknown): DiffCounts | null {
  if (typeof diff !== 'string') {
    return null;
  }

  let added = 0;
  let removed = 0;

  for (const line of diff.split('\n')) {
    if (/^\+(?!\+\+)/.test(line)) {
      added++;
    } else if (/^-(?!--)/.test(line)) {
      removed++;
    }
  }

  return { added, removed };
}

/** Commands that run tests, by the words in them. */
const TESTS = /\b(?:test|tests|spec|jest|vitest|pytest|mocha|ava|tap|rspec|phpunit|ctest)\b/i;

export type TestCounts = { passed: number; failed: number; seconds?: number };

/**
 * The numbers behind `testOutcome`: for a command that runs tests, or output with a test runner's own summary. Null for
 * anything else.
 */
export function testCounts(text: string, command = ''): TestCounts | null {
  if (!TESTS.test(command) && !/^(?:# pass|ℹ pass|Tests:) /m.test(text)) {
    return null;
  }

  // A runner's own count of tests first: node's ("# pass 48", "ℹ pass 48"), then the line for tests that Jest
  // ("Tests: 1 failed, 47 passed") and Vitest ("Tests  3 passed") print after their files and suites; then any.
  const count = (node: string, word: string): string | undefined =>
    new RegExp(`^(?:#|ℹ) ${node} (\\d+)`, 'm').exec(text)?.[1] ??
    new RegExp(`^\\s*Tests:?\\s+(?:[^\\n]*?\\D)?(\\d+) ${word}`, 'm').exec(text)?.[1] ??
    new RegExp(`\\b(\\d+) (?:${word}|${word === 'passed' ? 'passing' : 'failing'})\\b`).exec(text)?.[1];
  const passed = count('pass', 'passed');

  if (passed === undefined) {
    return null;
  }

  const failed = count('fail', 'failed');
  const ms = /duration_ms ([\d.]+)/.exec(text)?.[1];
  const seconds = ms !== undefined ? Number(ms) / 1000 : Number(/\b(?:in|Duration|Time:)\s+([\d.]+)\s?s\b/.exec(text)?.[1] ?? NaN);

  return {
    passed: Number(passed),
    failed: failed !== undefined ? Number(failed) : 0,
    ...(Number.isFinite(seconds) ? { seconds } : {}),
  };
}

/**
 * A test run's outcome from what it printed, as in "48 passed · 3.1s": for a command that runs tests, or output with a
 * test runner's own summary. Null for anything else.
 */
export function testOutcome(text: string, command = ''): string | null {
  const counts = testCounts(text, command);

  if (counts === null) {
    return null;
  }

  const { passed, failed, seconds } = counts;

  return [
    `${passed} passed`,
    failed > 0 && `${failed} failed`,
    seconds !== undefined && `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A failed call's error, short: a command's exit code, or the first line of what it said. */
export function shortError(text: string): string {
  const exit = /(?:exited with code|exit code:?) (\d+)/i.exec(text);

  if (exit) {
    return `exit ${exit[1]}`;
  }

  if (/timed out/i.test(text)) {
    return 'timed out';
  }

  if (/\b(?:Command|Operation|was) aborted\b/.test(text)) {
    return 'stopped';
  }

  // The first line that says something: not a tag around the harness's own errors ("<harness>"), nor its "[error]".
  const line =
    text
      .split('\n')
      .map((each) => each.trim().replace(/^\[[\w -]+\]\s*/, ''))
      .find((each) => each !== '' && !/^<\/?[\w-]+>$/.test(each)) ?? 'failed';

  return short(line.replace(/^error:\s*/i, ''), 48);
}

/**
 * How a call that ended before it finished says so: the harness's "Tool bash was aborted" or "… was interrupted and may
 * have partially run", a tool's own "Operation aborted", or bash's "Command aborted" under its output.
 */
export const STOPPED = /^<harness>\s*\[error\] Tool \S+ was (?:aborted|interrupted)\b|^(?:Operation|Command|The operation was) aborted\.?$/m;

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a kind of call did: a verb (its id, a key under `verb.*`), what it counts (`noun.*`), what makes two one. */
export type Did = { verb: string; noun?: string; by?: string };

/** What a kind of call did, for a group's summary: its verb, what it counts, and what makes two of them one. */
const DID: Record<string, Did> = {
  read: { verb: 'read', noun: 'file', by: 'path' },
  edit: { verb: 'edited', noun: 'file', by: 'path' },
  write: { verb: 'wrote', noun: 'file', by: 'path' },
  bash: { verb: 'ran', noun: 'command' },
  codemode: { verb: 'ran', noun: 'script' },
  subagent: { verb: 'ran', noun: 'subagent', by: 'name' },
  grep: { verb: 'searched' },
  find: { verb: 'searched' },
  ls: { verb: 'listed', noun: 'folder', by: 'path' },
  browser: { verb: 'browsed' },
  artifact: { verb: 'published', noun: 'artifact', by: 'id' },
  // PiP's.
  sessions: { verb: 'lookedOverSessions' },
  session_read: { verb: 'read', noun: 'session', by: 'session' },
  session_start: { verb: 'started', noun: 'session' },
  session_send: { verb: 'messaged', noun: 'session', by: 'session' },
  session_follow: { verb: 'followed', noun: 'session', by: 'session' },
  session_stop: { verb: 'stopped', noun: 'session', by: 'session' },
  session_archive: { verb: 'archived', noun: 'session', by: 'session' },
  session_schedule: { verb: 'scheduled', noun: 'message' },
  schedule: { verb: 'scheduled', noun: 'reminder' },
  approvals: { verb: 'checkedApprovals' },
  memory: { verb: 'saved', noun: 'lesson' },
  watch_pr: { verb: 'watched', noun: 'pullRequest' },
  session_watch_pr: { verb: 'watched', noun: 'pullRequest', by: 'session' },
  repo_watch: { verb: 'setUp', noun: 'repoWatch', by: 'repo' },
};

/** Nouns said with "a" when there is one (keys under `a.*`). */
const ONE = new Set(['subagent', 'script', 'artifact', 'session', 'message', 'reminder', 'call', 'lesson', 'pullRequest', 'repoWatch']);

type Args = Record<string, unknown>;

/** Calls whose verb depends on what they were asked to do: listing or cancelling schedules, denying a call. */
function byAction(name: string, args: Args): Did | undefined {
  const scheduling = name === 'schedule' || name === 'session_schedule';

  if (scheduling && args.action === 'list') {
    return { verb: 'checkedSchedules' };
  }

  if (scheduling && args.action === 'cancel') {
    return { verb: 'cancelled', noun: name === 'schedule' ? 'reminder' : 'message', by: 'id' };
  }

  if (name === 'approvals' && args.action === 'deny') {
    return { verb: 'denied', noun: 'call', by: 'id' };
  }

  if (name === 'memory' && args.action !== 'add') {
    return args.action === 'list' ? { verb: 'readLessons' } : { verb: args.action === 'update' ? 'changed' : 'forgot', noun: 'lesson', by: 'id' };
  }

  if ((name === 'watch_pr' || name === 'session_watch_pr') && args.action !== 'start') {
    return { verb: args.action === 'stop' ? 'stoppedWatchingPr' : 'checkedPrWatch' };
  }

  if (name === 'repo_watch' && args.action !== 'add') {
    return args.action === 'remove' ? { verb: 'removed', noun: 'repoWatch', by: 'id' } : { verb: 'checkedRepoWatches' };
  }

  return undefined;
}

export type StepBlock = { type: 'thinking'; text?: string } | { type: 'toolCall'; id: string; name: string; args?: Args };
export type SummaryStep = { block: StepBlock };

/** One thing counted in a summary part: `count` of `noun`; `bare` = said as just the number ("wrote 1"). */
export type SummaryCount = { noun: string; count: number; bare: boolean };
/**
 * One clause of a summary line: a verb id (`thought`, `thinking`, `read`, `ran`, …, or `used` with `tool`) and the
 * things it counted, in the order Pi first did each.
 */
export type SummaryPart = { verb: string; tool?: string; counts: SummaryCount[] };

/** A group's calls as clauses, in the order Pi first did each kind (the structure behind `summarize`). */
export function summaryParts(steps: readonly SummaryStep[], thinking?: boolean): SummaryPart[] {
  /** verb id → noun → the things counted. */
  const did = new Map<string, { tool?: string; nouns: Map<string, Set<string>> }>();

  for (const step of steps) {
    const block = step.block;

    if (block.type === 'thinking') {
      if (!did.has('thought')) {
        did.set('thought', { nouns: new Map() });
      }

      continue;
    }

    const args = block.args ?? {};
    const checking = block.name === 'subagent' && args.action !== undefined && args.action !== 'spawn' && args.action !== 'send';
    const kind: Did & { tool?: string } = checking
      ? { verb: 'checkedSubagents' }
      : (byAction(block.name, args) ?? DID[block.name] ?? { verb: `used:${block.name}`, tool: block.name });
    const entry = did.get(kind.verb) ?? { tool: kind.tool, nouns: new Map<string, Set<string>>() };

    did.set(kind.verb, entry);

    if (kind.noun) {
      const things = entry.nouns.get(kind.noun) ?? new Set<string>();
      const by = kind.by ? args[kind.by] : undefined;

      // A path or a name, or a session's number.
      things.add(typeof by === 'string' || typeof by === 'number' ? String(by) : block.id);
      entry.nouns.set(kind.noun, things);
    }
  }

  let before: string | null = null;

  return [...did].map(([verb, { tool, nouns }]) => {
    const counts = [...nouns].map(([noun, things], index) => ({
      noun,
      count: things.size,
      // "Edited 1 file, wrote 1": the noun just said is not said again.
      bare: index === 0 && noun === before && !ONE.has(noun),
    }));

    before = [...nouns.keys()].at(-1) ?? null;

    // A thought still being written, with nothing else done yet.
    const said = verb === 'thought' && thinking && did.size === 1 ? 'thinking' : tool !== undefined ? 'used' : verb;

    return tool !== undefined ? { verb: said, tool, counts } : { verb: said, counts };
  });
}

/** Several things in a sentence: "a, b and c". */
const sentence = (parts: string[], tr: Tr): string =>
  parts.length < 2 ? (parts[0] ?? '') : tr('and', { list: parts.slice(0, -1).join(', '), last: parts.at(-1)! });

/** A summary's clauses as one line, through `tr` (keys under `ui.steps`), its first letter upper case. */
export function formatSummary(parts: readonly SummaryPart[], tr: Tr = trEn): string {
  const line = parts
    .map(({ verb, tool, counts }) => {
      const things = sentence(
        counts.map(({ noun, count, bare }) => (count === 1 && ONE.has(noun) ? tr(`a.${noun}`) : bare ? String(count) : tr(`noun.${noun}`, { count }))),
        tr,
      );

      return tr(`verb.${verb}`, { things, tool: tool ?? '' });
    })
    .join(', ');

  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * A group's calls in a line, in the order Pi first did each kind: "Thought, searched, read 2 files, ran 1 command", or
 * "Edited 1 file, wrote 1, ran a subagent and 2 commands". English by default; pass `tr` for other languages.
 */
export function summarize(steps: readonly SummaryStep[], thinking?: boolean, tr: Tr = trEn): string {
  return formatSummary(summaryParts(steps, thinking), tr);
}

/**
 * The English templates of the summary (Pocket's words), the same as `ui.steps` in `i18n/ns/ui.en.ts` minus `out`/`dur`
 * (a test keeps them equal). A verb that counts things has `{things}`; `{tool}` is a tool's name.
 */
export const SUMMARY_EN = {
  and: '{list} and {last}',
  verb: {
    thought: 'thought',
    thinking: 'thinking',
    read: 'read {things}',
    edited: 'edited {things}',
    wrote: 'wrote {things}',
    ran: 'ran {things}',
    searched: 'searched',
    listed: 'listed {things}',
    browsed: 'used the browser',
    published: 'published {things}',
    lookedOverSessions: 'looked over sessions',
    started: 'started {things}',
    messaged: 'messaged {things}',
    followed: 'followed {things}',
    stopped: 'stopped {things}',
    archived: 'archived {things}',
    scheduled: 'scheduled {things}',
    checkedApprovals: 'checked approvals',
    saved: 'saved {things}',
    watched: 'watched {things}',
    setUp: 'set up {things}',
    checkedSchedules: 'checked schedules',
    cancelled: 'cancelled {things}',
    denied: 'denied {things}',
    readLessons: 'read its lessons',
    changed: 'changed {things}',
    forgot: 'forgot {things}',
    stoppedWatchingPr: 'stopped watching the PR',
    checkedPrWatch: 'checked the PR watch',
    removed: 'removed {things}',
    checkedRepoWatches: 'checked repository watches',
    checkedSubagents: 'checked on subagents',
    used: 'used {tool}',
  },
  noun: {
    file: '{count, plural, one {# file} other {# files}}',
    command: '{count, plural, one {# command} other {# commands}}',
    script: '{count, plural, one {# script} other {# scripts}}',
    subagent: '{count, plural, one {# subagent} other {# subagents}}',
    folder: '{count, plural, one {# folder} other {# folders}}',
    artifact: '{count, plural, one {# artifact} other {# artifacts}}',
    session: '{count, plural, one {# session} other {# sessions}}',
    message: '{count, plural, one {# message} other {# messages}}',
    reminder: '{count, plural, one {# reminder} other {# reminders}}',
    call: '{count, plural, one {# call} other {# calls}}',
    lesson: '{count, plural, one {# lesson} other {# lessons}}',
    pullRequest: '{count, plural, one {# pull request} other {# pull requests}}',
    repoWatch: '{count, plural, one {# repository watch} other {# repository watches}}',
  },
  a: {
    subagent: 'a subagent',
    script: 'a script',
    artifact: 'an artifact',
    session: 'a session',
    message: 'a message',
    reminder: 'a reminder',
    call: 'a call',
    lesson: 'a lesson',
    pullRequest: 'a pull request',
    repoWatch: 'a repository watch',
  },
};

const trEn: Tr = trFrom(SUMMARY_EN);
