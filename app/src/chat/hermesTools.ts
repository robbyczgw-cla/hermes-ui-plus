/**
 * Hermes-specific tool presentation: tool name -> kind / stroke icon / label / compact summary, todo progress,
 * the "gemerkt" notes and context-compression detection. Pure (node:test, hermesTools.test.ts).
 *
 * Tool names are the ones of the Hermes agent (/opt/hermes/tools, checked on hermes-host): `todo_list`, `delegate_task`,
 * `cronjob_manage`, `memory`, `fact_store` (holographic memory plugin), `session_search`, `skill_view` /
 * `skills_list` / `skill_manage`, `web_search` / `web_extract`, the MCP "web-search-plus" tools, `browser_*`,
 * `terminal`, `execute_code`, `read_file` / `write_file` / `patch` / `search_files`, `image_generate`, ….
 *
 * What the stream carries: `hermes.tool.progress` has only the name and `label` = `build_tool_preview(args)`
 * (server language) on start and nothing but "completed" at the end. Arguments and results arrive after the turn
 * through the stored session rows (`ToolEvent.detail.input/output`, sessionMapping.ts). Everything here therefore
 * works with the live label alone and gets richer once the detail is there.
 */
import type { ChatMessage, ToolEvent } from '../hermes/types.ts';
import type { TFn, TKey } from '../i18n/core.ts';
import { toolLabel, toolPreview } from './format.ts';
import type { IconName } from './icons.tsx';

export type HermesToolKind =
  | 'todo'
  | 'delegate'
  | 'cron'
  | 'memory'
  | 'sessionSearch'
  | 'skill'
  | 'web'
  | 'browser'
  | 'terminal'
  | 'code'
  | 'file'
  | 'image';

type Entry = { kind: HermesToolKind; icon: IconName; title?: TKey };

const T = {
  webSearch: 'chat.toolTimeline.webSearch',
  fetchPage: 'chat.toolTimeline.fetchPage',
  browser: 'chat.toolTimeline.browser',
  terminal: 'chat.toolTimeline.terminal',
  runCode: 'chat.toolTimeline.runCode',
  readFile: 'chat.toolTimeline.readFile',
  writeFile: 'chat.toolTimeline.writeFile',
  imageGenerate: 'chat.toolTimeline.imageGenerate',
} as const satisfies Record<string, TKey>;

/** Exact Hermes tool names. Dynamic titles (todo, delegate, cron, memory, skills, session search) are in `describeTool`. */
const TOOLS: Record<string, Entry> = {
  todo_list: { kind: 'todo', icon: 'checklist' },
  todo: { kind: 'todo', icon: 'checklist' },
  delegate_task: { kind: 'delegate', icon: 'users' },
  delegate: { kind: 'delegate', icon: 'users' },
  cronjob_manage: { kind: 'cron', icon: 'bell' },
  cronjob: { kind: 'cron', icon: 'bell' },
  memory: { kind: 'memory', icon: 'brain' },
  fact_store: { kind: 'memory', icon: 'brain' },
  fact_feedback: { kind: 'memory', icon: 'brain' },
  session_search: { kind: 'sessionSearch', icon: 'history' },
  skill_view: { kind: 'skill', icon: 'book' },
  skills_list: { kind: 'skill', icon: 'book' },
  skill_manage: { kind: 'skill', icon: 'book' },
  web_search: { kind: 'web', icon: 'search', title: T.webSearch },
  x_search: { kind: 'web', icon: 'search', title: T.webSearch },
  web_extract: { kind: 'web', icon: 'globe', title: T.fetchPage },
  // Web Search Plus plugin (docs/WSP-INTEGRATION.md); the MCP variants go through MCP_WEB_RE below
  web_search_plus: { kind: 'web', icon: 'search', title: T.webSearch },
  web_extract_plus: { kind: 'web', icon: 'globe', title: T.fetchPage },
  browser: { kind: 'browser', icon: 'globe', title: T.browser },
  terminal: { kind: 'terminal', icon: 'terminal', title: T.terminal },
  process_manage: { kind: 'terminal', icon: 'terminal', title: 'hermesTools.tool.process' },
  execute_code: { kind: 'code', icon: 'code', title: T.runCode },
  read_file: { kind: 'file', icon: 'file', title: T.readFile },
  write_file: { kind: 'file', icon: 'file', title: T.writeFile },
  patch: { kind: 'file', icon: 'edit', title: 'hermesTools.tool.patch' },
  search_files: { kind: 'file', icon: 'search', title: 'hermesTools.tool.searchFiles' },
  image_generate: { kind: 'image', icon: 'image', title: T.imageGenerate },
  vision_analyze: { kind: 'image', icon: 'image', title: 'hermesTools.tool.vision' },
  video_generate: { kind: 'image', icon: 'image', title: 'hermesTools.tool.video' },
  video_analyze: { kind: 'image', icon: 'image', title: 'hermesTools.tool.video' },
};

/** MCP tools are named `mcp__<server>__<tool>` (tools/mcp_tool_schema.py); the "web-search-plus" / "hound" servers are web search. */
const MCP_WEB_RE = /(^|_)(web[_-]?search[_-]?plus|wsp|hound)(_|$)/i;

function entryOf(name: string): Entry | null {
  const n = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TOOLS, n)) return TOOLS[n];
  if (n.startsWith('browser_')) return { kind: 'browser', icon: 'globe', title: T.browser };
  if (n.startsWith('mcp_') && MCP_WEB_RE.test(n)) {
    return /extract|fetch|read|crawl/.test(n)
      ? { kind: 'web', icon: 'globe', title: T.fetchPage }
      : { kind: 'web', icon: 'search', title: T.webSearch };
  }
  return null;
}

/** Hermes tool kind of a function name, or null (unknown tools keep the generic look). */
export function hermesToolKind(name: string): HermesToolKind | null {
  return entryOf(name)?.kind ?? null;
}

/** Stroke icon for a known Hermes tool, or null (generic emoji look). */
export function toolIconName(name: string): IconName | null {
  return entryOf(name)?.icon ?? null;
}

// ------------------------------------------------------------------ stored arguments / results

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (isObj(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        const parsed: unknown = JSON.parse(s);
        return isObj(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Tool arguments from the stored session row (object or JSON string), if the detail was loaded. */
export function toolInput(ev: Pick<ToolEvent, 'detail'>): Record<string, unknown> | undefined {
  return asObject(ev.detail?.input);
}

/** Tool result from the stored session row (JSON object), if the detail was loaded. */
export function toolOutput(ev: Pick<ToolEvent, 'detail'>): Record<string, unknown> | undefined {
  return asObject(ev.detail?.output);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function clip(s: string, max = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ------------------------------------------------------------------ todo

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoItem = { id: string; content: string; status: TodoStatus };

const TODO_STATUS = new Set<string>(['pending', 'in_progress', 'completed', 'cancelled']);

/** Items of a `todo_list` call: the result (`{todos:[…]}`) wins over the written arguments. */
export function parseTodos(ev: Pick<ToolEvent, 'detail'>): TodoItem[] | null {
  for (const src of [toolOutput(ev), toolInput(ev)]) {
    const list = src?.todos;
    if (!Array.isArray(list)) continue;
    const items: TodoItem[] = [];
    list.forEach((x, i) => {
      if (!isObj(x)) return;
      const content = str(x.content);
      if (!content) return;
      const status = typeof x.status === 'string' && TODO_STATUS.has(x.status) ? (x.status as TodoStatus) : 'pending';
      items.push({ id: str(x.id) ?? String(i + 1), content, status });
    });
    if (items.length) return items;
  }
  return null;
}

export function todoProgress(items: readonly TodoItem[]): { done: number; total: number } {
  const total = items.filter((i) => i.status !== 'cancelled').length;
  return { done: items.filter((i) => i.status === 'completed').length, total };
}

// ------------------------------------------------------------------ memory

export type MemoryAction = 'save' | 'forget' | 'search' | 'unknown';

/** What a memory / fact_store call did. The live label of `memory` is `+user: "text"` / `~user: "…"` / `-user: "…"`. */
export function memoryAction(ev: Pick<ToolEvent, 'name' | 'label' | 'detail'>): MemoryAction {
  const action = str(toolInput(ev)?.action)?.toLowerCase();
  const fact = ev.name.toLowerCase().startsWith('fact_');
  if (action) {
    if (action === 'add' || action === 'replace' || action === 'update') return 'save';
    if (action === 'remove') return 'forget';
    if (fact && ['search', 'probe', 'related', 'reason', 'contradict', 'list'].includes(action)) return 'search';
    return 'unknown';
  }
  if (fact) return 'unknown';
  const sign = /^\s*([+~-])\w*\s*:/.exec(ev.label ?? '')?.[1];
  if (sign === '+' || sign === '~') return 'save';
  if (sign === '-') return 'forget';
  return 'unknown';
}

/** Entry text the call exposes: stored arguments first, else the quoted text of the live label (clipped by Hermes). */
export function memoryEntry(ev: Pick<ToolEvent, 'name' | 'label' | 'detail'>): string | undefined {
  const input = toolInput(ev);
  const content = str(input?.content) ?? str(input?.new_text) ?? str(input?.text);
  if (content) return clip(content, 140);
  const m = /^\s*[+~-]\w*\s*:\s*"([\s\S]*)"\s*$/.exec(ev.label ?? '');
  return m && m[1].trim() ? clip(m[1], 140) : undefined;
}

export type MemoryNote = { id: string; text?: string };

/**
 * "🧠 gemerkt" notes of a finished turn: one per successful memory write. `text` only when the call exposes the
 * entry; calls whose action is unknown (memory tool without arguments) read as plain "Gedächtnis aktualisiert".
 */
export function memoryNotes(tools: readonly ToolEvent[]): MemoryNote[] {
  const out: MemoryNote[] = [];
  for (const ev of tools) {
    if (hermesToolKind(ev.name) !== 'memory' || ev.status !== 'done' || ev.detail?.cancelled) continue;
    if (ev.name.toLowerCase() === 'fact_feedback') continue;
    const a = memoryAction(ev);
    if (a === 'forget' || a === 'search') continue;
    if (a === 'unknown' && ev.name.toLowerCase() !== 'memory') continue;
    out.push({ id: ev.id, text: a === 'save' ? memoryEntry(ev) : undefined });
  }
  return out;
}

// ------------------------------------------------------------------ cron

export type CronAction = 'create' | 'list' | 'update' | 'pause' | 'resume' | 'remove' | 'run';
const CRON_ACTIONS = new Set<string>(['create', 'list', 'update', 'pause', 'resume', 'remove', 'run']);

/** The live label of `cronjob_manage` is the action word itself (`_PRIMARY_ARGS`). */
export function cronAction(ev: Pick<ToolEvent, 'label' | 'detail'>): CronAction | undefined {
  const a = (str(toolInput(ev)?.action) ?? str(ev.label))?.toLowerCase();
  return a && CRON_ACTIONS.has(a) ? (a as CronAction) : undefined;
}

// ------------------------------------------------------------------ session search / skills

/** Search query of a `session_search` call (stored arguments, else the quoted text of the localized live label). */
export function sessionSearchQuery(ev: Pick<ToolEvent, 'label' | 'detail'>): string | undefined {
  const q = str(toolInput(ev)?.query);
  if (q) return clip(q, 60);
  const m = /["„“«]([^"“”»]+)["“”»]/.exec(ev.label ?? '');
  return m ? clip(m[1], 60) : undefined;
}

// ------------------------------------------------------------------ presentation

export type ToolView = {
  kind: HermesToolKind | null;
  /** stroke icon, null = generic look (emoji of Hermes / heuristic) */
  icon: IconName | null;
  title: string;
  /** short argument / result text next to the title */
  preview: string | null;
  /** second line (timeline): progress, result summary */
  sub?: string;
};

const CRON_TITLE: Record<CronAction, TKey> = {
  create: 'hermesTools.cron.create',
  list: 'hermesTools.cron.list',
  update: 'hermesTools.cron.update',
  pause: 'hermesTools.cron.pause',
  resume: 'hermesTools.cron.resume',
  remove: 'hermesTools.cron.remove',
  run: 'hermesTools.cron.run',
};

/** Label / summary / icon of a tool event. Unknown tools return the generic label + preview and no icon. */
export function describeTool(t: TFn, ev: Pick<ToolEvent, 'name' | 'label' | 'detail'>): ToolView {
  const entry = entryOf(ev.name);
  const generic = (): ToolView => ({ kind: entry?.kind ?? null, icon: entry?.icon ?? null, title: entry?.title ? t(entry.title) : toolLabel(t, ev.name), preview: toolPreview(t, ev.name, ev.label) });
  if (!entry) return generic();
  const input = toolInput(ev);
  switch (entry.kind) {
    case 'todo': {
      const items = parseTodos(ev);
      const base: ToolView = { kind: 'todo', icon: entry.icon, title: t('hermesTools.todo.title'), preview: toolPreview(t, ev.name, ev.label) };
      if (!items) return base;
      const { done, total } = todoProgress(items);
      const hasResult = Array.isArray(toolOutput(ev)?.todos);
      return { ...base, preview: hasResult ? t('hermesTools.todo.progress', { done, total }) : t('hermesTools.todo.count', { count: items.length }), sub: hasResult ? items.find((i) => i.status === 'in_progress')?.content : undefined };
    }
    case 'delegate': {
      const tasks = Array.isArray(input?.tasks) ? input.tasks.filter(isObj) : [];
      const goal = str(input?.goal) ?? str(tasks[0]?.goal);
      const base: ToolView = { kind: 'delegate', icon: entry.icon, title: t('hermesTools.delegate.title'), preview: null };
      if (tasks.length > 1) return { ...base, title: t('hermesTools.delegate.many', { count: tasks.length }), preview: goal ? clip(goal, 60) : toolPreview(t, ev.name, ev.label) };
      return { ...base, preview: goal ? clip(goal, 60) : toolPreview(t, ev.name, ev.label) };
    }
    case 'cron': {
      const a = cronAction(ev);
      const detail = str(input?.name) ?? (str(input?.prompt) ? clip(str(input?.prompt) as string, 50) : undefined);
      return { kind: 'cron', icon: entry.icon, title: a ? t(CRON_TITLE[a]) : t('hermesTools.cron.generic'), preview: a === 'create' || a === 'update' ? (detail ?? null) : null };
    }
    case 'memory': {
      const a = memoryAction(ev);
      const fact = ev.name.toLowerCase().startsWith('fact_');
      const title =
        a === 'save' ? t('hermesTools.memory.saved')
        : a === 'forget' ? t('hermesTools.memory.forgot')
        : a === 'search' ? t('hermesTools.memory.search')
        : fact ? t('hermesTools.memory.generic')
        : t('hermesTools.memory.updated');
      const text = a === 'search' ? str(input?.query) : memoryEntry(ev);
      return { kind: 'memory', icon: entry.icon, title, preview: text ? clip(text, 60) : null };
    }
    case 'sessionSearch':
      return { kind: 'sessionSearch', icon: entry.icon, title: t('hermesTools.sessionSearch'), preview: sessionSearchQuery(ev) ?? null };
    case 'skill': {
      const n = ev.name.toLowerCase();
      const title = n === 'skill_view' ? t('hermesTools.skill.view') : n === 'skills_list' ? t('hermesTools.skill.list') : t('hermesTools.skill.manage');
      const name = str(input?.name) ?? str(input?.category) ?? (n === 'skills_list' ? undefined : str(ev.label));
      return { kind: 'skill', icon: entry.icon, title, preview: name && name !== ev.name ? clip(name, 60) : null };
    }
    case 'web':
      return webView(t, ev, entry);
    default:
      return generic();
  }
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Web search / extract chip (generic `web_search`, WSP `web_search_plus` / `web_extract_plus`, MCP variants):
 * title (search, research mode, read page), the query or page as preview and "Brave · 5 Treffer · aus dem Cache"
 * once the stored result was parsed (hermes/webResults.ts). Elapsed time comes from the timeline itself.
 */
function webView(t: TFn, ev: Pick<ToolEvent, 'name' | 'label' | 'detail'>, entry: Entry): ToolView {
  const input = toolInput(ev);
  const extract = entry.icon === 'globe';
  const research = str(input?.mode)?.toLowerCase() === 'research';
  const title = research ? t('hermesTools.web.research') : t(entry.title ?? T.webSearch);
  let preview: string | null;
  if (extract) {
    const urls = Array.isArray(input?.urls) ? input.urls.filter((u): u is string => typeof u === 'string') : str(input?.url) ? [str(input?.url) as string] : [];
    const host = urls[0] ? (/^https?:\/\/([^/?#]+)/i.exec(urls[0])?.[1] ?? urls[0]).replace(/^www\./i, '') : undefined;
    preview = host ? (urls.length > 1 ? `${host} +${urls.length - 1}` : host) : toolPreview(t, ev.name, ev.label);
  } else {
    const q = str(input?.query) ?? str(input?.q);
    preview = q ? clip(q, 60) : toolPreview(t, ev.name, ev.label);
  }
  const w = ev.detail?.web;
  const provider = w?.provider ?? (str(input?.provider) && str(input?.provider) !== 'auto' ? str(input?.provider) : undefined);
  const parts: string[] = [];
  if (provider) parts.push(capFirst(provider));
  if (typeof w?.count === 'number') parts.push(extract ? t('hermesTools.web.pages', { count: w.count }) : t('chat.toolTimeline.hits', { count: w.count }));
  if (w?.cached) parts.push(t('hermesTools.web.cached'));
  return { kind: 'web', icon: entry.icon, title, preview, ...(parts.length ? { sub: parts.join(' · ') } : {}) };
}

/** Kinds whose preview is a purpose-built summary (not just the first argument) and wins over generic argument lines. */
export function hasOwnSummary(kind: HermesToolKind | null): boolean {
  return kind === 'todo' || kind === 'delegate' || kind === 'cron' || kind === 'memory' || kind === 'sessionSearch' || kind === 'skill';
}

/** One line for accessibility labels / copy: "Unteragent: Recherche …". */
export function toolViewText(v: Pick<ToolView, 'title' | 'preview'>): string {
  return v.preview ? `${v.title}: ${v.preview}` : v.title;
}

// ------------------------------------------------------------------ context compression

/** `hermes.status` kinds/texts that mean "context was compressed" (agent/conversation_compression.py). */
const COMPACTED_TEXT_RE = /compaction complete|context compacted|kontext komprimiert|comprimido/i;
/** Marker Hermes leaves in a pruned skill result: `[SKILL_PRUNED: content lost in compression; reload with skill_view(…)]`. */
const SKILL_PRUNED_RE = /\[SKILL_PRUNED\b/;

export function isCompactedStatus(kind: string | undefined, text: string | undefined): boolean {
  return kind === 'compacted' || (kind !== 'compacting' && !!text && COMPACTED_TEXT_RE.test(text));
}

/**
 * B9: the "Kontext komprimiert" chat divider marks older conversation being summarized away.
 * When Hermes compressed during the very first turn of a brand-new chat there is no older
 * conversation — the compaction stays a small row in that answer's tool timeline instead
 * (toolTimeline already renders the status step there).
 */
export function shouldShowCompactionDivider(msg: Pick<ChatMessage, 'trace' | 'tools'>, isFirstTurn: boolean): boolean {
  return !isFirstTurn && hasContextCompression(msg);
}

/** The turn compressed the context: a finished `hermes.status` step or a pruned-skill marker in a tool result. */
export function hasContextCompression(msg: Pick<ChatMessage, 'trace' | 'tools'>): boolean {
  for (const s of msg.trace ?? []) {
    if (s.kind === 'status' && isCompactedStatus((s.data as { kind?: string } | undefined)?.kind, s.text)) return true;
  }
  for (const ev of msg.tools) {
    const out = ev.detail?.output;
    if (typeof out === 'string' ? SKILL_PRUNED_RE.test(out) : out !== undefined && SKILL_PRUNED_RE.test(JSON.stringify(out) ?? '')) return true;
  }
  return false;
}
