/**
 * What a Pi tool call came to (an outcome chip: `+12 −3`, `read 120 lines`, `7 matches`, `48 passed / 1 failed`,
 * `exit 1`, `needs approval`) and a group of steps in one line ("Thought, read 3 files, edited 2 files, ran 1 command"
 * + duration + chips). Pure (node:test); labels through an injectable `tr` (keys under `ui.steps`), English by default.
 *
 * Built on the helpers ported from Pi Pocket (`./pocket/turns.ts`); the per-tool rules follow Pocket's `outcome()` in
 * `web/transcript.js` (github.com/TannerMidd/pi-pocket, commit de612d5), MIT, © 2026 Tanner Middleton – see NOTICE.md.
 * Input shapes are pi-host's `tool.end` / `tool.pending` events (docs/pi/DESIGN.md §6.4) with their `ToolView`.
 */
import {
  STOPPED,
  SUMMARY_EN,
  diffCounts,
  formatSummary,
  lineCount,
  matchCount,
  shortError,
  summaryParts,
  testCounts,
  trFrom,
  withoutNotes,
  type DiffCounts,
  type SummaryPart,
  type SummaryStep,
  type Tr,
} from './pocket/turns.ts';

export type { Tr } from './pocket/turns.ts';

/** What pi-host derives from the built-in tools for the coding components (DESIGN §6.4). */
export type ToolView =
  | { kind: 'terminal'; command?: string; cwd?: string; exitCode?: number; output?: string; truncated?: boolean }
  | { kind: 'diff'; path?: string; patch?: string; firstChangedLine?: number }
  | { kind: 'file'; path?: string; op?: string; bytes?: number; preview?: string }
  | { kind: 'read'; path?: string; lines?: string }
  | { kind: 'generic' };

export type OutcomeCall = {
  name: string;
  args?: Record<string, unknown> | null;
  isError?: boolean;
  /** the tool's result text; undefined while the call runs */
  text?: string;
  details?: unknown;
  view?: ToolView;
  durationMs?: number;
  /** known but waiting for an approval (`tool.pending` with an `approvalId`) */
  pending?: boolean;
  approval?: { status?: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | (string & {}) } | null;
};

export type OutcomeTone = 'neutral' | 'good' | 'warn' | 'bad';
export type OutcomeKind = 'diff' | 'read' | 'matches' | 'tests' | 'output' | 'exit' | 'error' | 'approval' | 'stopped' | 'none';
export type Outcome = {
  tone: OutcomeTone;
  label: string;
  kind: OutcomeKind;
  /** diff: lines added / removed (the chip draws them in two colours) */
  added?: number;
  removed?: number;
  /** a spoken label when `label` reads badly (`+12 −3`) */
  a11y?: string;
};

/** The English labels (the same as `ui.steps.out` / `ui.steps.dur` in `i18n/ns/ui.en.ts`; a test keeps them equal). */
export const OUTCOME_EN = {
  out: {
    needsApproval: '{count, plural, one {needs approval} other {# need approval}}',
    denied: 'denied',
    expired: 'expired',
    stopped: 'stopped',
    cutOff: 'cut off by a restart',
    exit: 'exit {code}',
    timedOut: 'timed out',
    failed: 'failed',
    readLines: '{count, plural, one {read # line} other {read # lines}}',
    matches: '{count, plural, one {# match} other {# matches}}',
    noMatches: 'no matches',
    files: '{count, plural, one {# file} other {# files}}',
    entries: '{count, plural, one {# entry} other {# entries}}',
    none: 'none',
    lines: '{count, plural, one {# line} other {# lines}}',
    noOutput: 'no output',
    longOutput: 'long output',
    passed: '{count} passed',
    passedFailed: '{passed} passed / {failed} failed',
    diffA11y: '{added, plural, one {# line added} other {# lines added}}, {removed} removed',
  },
  dur: {
    lt1: '<1s',
    s: '{s}s',
    m: '{m}m {s}s',
  },
};

/** English for everything under `ui.steps` the pure code uses: the summary's words and the chips'. */
const trEn: Tr = trFrom({ ...SUMMARY_EN, ...OUTCOME_EN });

const NONE: Outcome = { tone: 'neutral', label: '', kind: 'none' };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Lines added and removed in a patch: a unified diff (`@@` hunks; `---`/`+++` file headers do not count, a hunk's
 * `+++x` line does), or Pi's edit card (`+12 text`, `-12 text`, via Pocket's `diffCounts`). Null without one.
 */
export function patchCounts(patch: unknown): DiffCounts | null {
  if (typeof patch !== 'string') return null;
  if (!/^@@/m.test(patch)) return diffCounts(patch);
  const lines = patch.split('\n');
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@')) inHunk = true;
    else if (line.startsWith('diff ') || (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ '))) inHunk = false;
    else if (inHunk && line.startsWith('+')) added++;
    else if (inHunk && line.startsWith('-')) removed++;
  }
  return { added, removed };
}

const diffOutcome = ({ added, removed }: DiffCounts, tr: Tr): Outcome => ({
  tone: 'good',
  kind: 'diff',
  label: `+${added} −${removed}`,
  added,
  removed,
  a11y: tr('out.diffA11y', { added, removed }),
});

/** Lines a read range like "1-200" covers. */
function rangeLines(range: string | undefined): number | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(range ?? '');
  return m ? Math.max(0, Number(m[2]) - Number(m[1]) + 1) : null;
}

function testsOutcome(text: string, command: string, isError: boolean | undefined, tr: Tr): Outcome | null {
  const counts = testCounts(text, command);
  if (!counts) return null;
  const { passed, failed } = counts;
  return {
    tone: failed > 0 || isError ? 'bad' : 'good',
    kind: 'tests',
    label: failed > 0 ? tr('out.passedFailed', { passed, failed }) : tr('out.passed', { count: passed }),
  };
}

/** What a call came to, for its chip; `kind: 'none'` (empty label) while it runs or when there is nothing to say. */
export function callOutcome(call: OutcomeCall, tr: Tr = trEn): Outcome {
  const status = call.approval?.status;
  if (call.pending || status === 'pending') return { tone: 'warn', kind: 'approval', label: tr('out.needsApproval', { count: 1 }) };
  if (status === 'denied' || status === 'expired') return { tone: 'neutral', kind: 'approval', label: tr(`out.${status}`) };
  if (call.text === undefined && call.isError === undefined) return NONE;

  const view = call.view;
  const terminal = view?.kind === 'terminal' ? view : undefined;
  const text = call.text ?? terminal?.output ?? '';
  const args = record(call.args);

  if (call.isError && STOPPED.test(text)) {
    return { tone: 'neutral', kind: 'stopped', label: tr(/was interrupted/.test(text) ? 'out.cutOff' : 'out.stopped') };
  }

  if (call.name === 'bash') {
    const command = typeof args.command === 'string' ? args.command : (terminal?.command ?? '');
    const tests = testsOutcome(text, command, call.isError, tr);
    if (tests) return tests;
  }

  const exitCode = terminal?.exitCode;
  if (typeof exitCode === 'number' && exitCode !== 0) return { tone: 'bad', kind: 'exit', label: tr('out.exit', { code: exitCode }) };

  if (call.isError) {
    const said = shortError(text);
    const exit = /^exit (\d+)$/.exec(said);
    if (exit) return { tone: 'bad', kind: 'exit', label: tr('out.exit', { code: exit[1] }) };
    if (said === 'timed out') return { tone: 'bad', kind: 'error', label: tr('out.timedOut') };
    if (said === 'stopped') return { tone: 'neutral', kind: 'stopped', label: tr('out.stopped') };
    return { tone: 'bad', kind: 'error', label: said === 'failed' ? tr('out.failed') : said };
  }

  const details = record(call.details);

  switch (call.name) {
    case 'edit': {
      const counts = patchCounts(view?.kind === 'diff' ? view.patch : (details.patch ?? details.diff));
      return counts ? diffOutcome(counts, tr) : NONE;
    }

    case 'write':
      return typeof args.content === 'string' ? diffOutcome({ added: lineCount(args.content), removed: 0 }, tr) : NONE;

    case 'read': {
      // Without the notes a long file's read ends with: "[120 more lines in file. Use offset=…]".
      const read = withoutNotes(text).replace(/\n*\[[^\]\n]*(?:more lines|offset=)[^\]\n]*\]\s*$/, '');
      const count = read !== '' ? lineCount(read) : rangeLines(view?.kind === 'read' ? view.lines : undefined);
      return count === null ? NONE : { tone: 'neutral', kind: 'read', label: tr('out.readLines', { count }) };
    }

    case 'grep':
      return /^No matches/.test(text)
        ? { tone: 'neutral', kind: 'matches', label: tr('out.noMatches') }
        : { tone: 'neutral', kind: 'matches', label: tr('out.matches', { count: matchCount(withoutNotes(text)) }) };

    case 'find':
    case 'ls':
      return /^(?:No files|\(empty directory\))/.test(text)
        ? { tone: 'neutral', kind: 'output', label: tr('out.none') }
        : { tone: 'neutral', kind: 'output', label: tr(call.name === 'ls' ? 'out.entries' : 'out.files', { count: lineCount(withoutNotes(text)) }) };

    case 'bash': {
      if (terminal?.truncated) return { tone: 'neutral', kind: 'output', label: tr('out.longOutput') };
      const lines = lineCount(withoutNotes(text).trim());
      return { tone: 'neutral', kind: 'output', label: lines === 0 ? tr('out.noOutput') : tr('out.lines', { count: lines }) };
    }

    default:
      return NONE;
  }
}

/** A run's length: "<1s", "18s", "2m 5s". */
export function formatDuration(ms: number, tr: Tr = trEn): string {
  if (!Number.isFinite(ms) || ms < 1000) return tr('dur.lt1');
  const total = Math.round(ms / 1000);
  return total < 60 ? tr('dur.s', { s: total }) : tr('dur.m', { m: Math.floor(total / 60), s: total % 60 });
}

/** One step of a group: a thought, or a tool call with what pi-host said about it. */
export type StepInput = { kind: 'thinking' } | ({ kind: 'tool'; id: string } & OutcomeCall);

export type StepSummaryModel = {
  /** "Thought, read 3 files, edited 2 files, ran 1 command" */
  line: string;
  /** "18s", when `durationMs` is known */
  duration?: string;
  /** the group's chips: one summed diff, the last test run, each distinct failure, stops, pending approvals */
  chips: Outcome[];
  /** the whole line and its chips, spoken */
  a11y: string;
  parts: SummaryPart[];
};

/**
 * A group of steps in a line, with its chips. Neutral counts (lines read, matches, output lines) stay on each call's
 * own line in the timeline (`callOutcome`); the summary shows what changed, what ran, and what needs attention.
 */
export function stepSummary(
  steps: readonly StepInput[],
  { thinking, durationMs }: { thinking?: boolean; durationMs?: number } = {},
  tr: Tr = trEn,
): StepSummaryModel {
  const blocks: SummaryStep[] = steps.map((step) =>
    step.kind === 'thinking' ? { block: { type: 'thinking' } } : { block: { type: 'toolCall', id: step.id, name: step.name, args: record(step.args) } },
  );
  const parts = summaryParts(blocks, thinking);
  const line = formatSummary(parts, tr);

  let added = 0;
  let removed = 0;
  let edits = 0;
  let tests: Outcome | null = null;
  let waiting = 0;
  const problems: Outcome[] = [];
  for (const step of steps) {
    if (step.kind !== 'tool') continue;
    const outcome = callOutcome(step, tr);
    if (outcome.kind === 'diff') {
      edits++;
      added += outcome.added ?? 0;
      removed += outcome.removed ?? 0;
    } else if (outcome.kind === 'tests') tests = outcome;
    else if (outcome.kind === 'approval' && outcome.tone === 'warn') waiting++;
    else if ((outcome.kind === 'exit' || outcome.kind === 'error' || outcome.kind === 'stopped' || outcome.kind === 'approval') && !problems.some((p) => p.label === outcome.label)) problems.push(outcome);
  }
  const chips: Outcome[] = [
    ...(edits ? [diffOutcome({ added, removed }, tr)] : []),
    ...(tests ? [tests] : []),
    ...problems,
    ...(waiting ? [{ tone: 'warn', kind: 'approval', label: tr('out.needsApproval', { count: waiting }) } satisfies Outcome] : []),
  ];
  const duration = durationMs !== undefined ? formatDuration(durationMs, tr) : undefined;
  const a11y = [[line, duration].filter(Boolean).join(', '), ...chips.map((chip) => chip.a11y ?? chip.label)].join('. ');
  return { line, ...(duration !== undefined ? { duration } : {}), chips, a11y, parts };
}
