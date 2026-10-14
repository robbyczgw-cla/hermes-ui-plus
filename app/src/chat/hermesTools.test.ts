/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeTool,
  hasContextCompression,
  shouldShowCompactionDivider,
  hermesToolKind,
  isCompactedStatus,
  memoryAction,
  memoryNotes,
  parseTodos,
  sessionSearchQuery,
  toolIconName,
  toolViewText,
} from './hermesTools.ts';
import { buildTimeline, rowDetail } from './toolTimeline.ts';
import { applyEvent, createAssistantMessage } from '../hermes/chatState.ts';
import type { ChatMessage, HermesEvent, ToolEvent } from '../hermes/types.ts';
import { makeT } from '../i18n/core.ts';
import { toolDetailFrom } from '../hermes/sessionMapping.ts';
import { WSP_EXTRACT_TEXT, WSP_MCP_JSON, WSP_SEARCH_TEXT } from '../hermes/webResults.fixtures.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');

const tool = (name: string, label = name, detail?: ToolEvent['detail'], status: ToolEvent['status'] = 'done'): ToolEvent => ({ id: `c-${name}`, name, label, status, startedAt: 1, detail });
const withIO = (name: string, input: unknown, output?: unknown, label = name) => tool(name, label, { tool: name, input, output });

test('tool-name mapping: Hermes tool names -> kind + stroke icon', () => {
  const cases: [string, string, string][] = [
    ['todo_list', 'todo', 'checklist'],
    ['delegate_task', 'delegate', 'users'],
    ['cronjob_manage', 'cron', 'bell'],
    ['cronjob', 'cron', 'bell'],
    ['memory', 'memory', 'brain'],
    ['fact_store', 'memory', 'brain'],
    ['session_search', 'sessionSearch', 'history'],
    ['skill_view', 'skill', 'book'],
    ['skills_list', 'skill', 'book'],
    ['web_search', 'web', 'search'],
    ['web_extract', 'web', 'globe'],
    ['web_search_plus', 'web', 'search'],
    ['web_extract_plus', 'web', 'globe'],
    ['mcp__web_search_plus__web_extract', 'web', 'globe'],
    ['mcp__web_search_plus__web_search', 'web', 'search'],
    ['mcp__hound_local__fetch_page', 'web', 'globe'],
    ['browser_navigate', 'browser', 'globe'],
    ['browser_click', 'browser', 'globe'],
    ['terminal', 'terminal', 'terminal'],
    ['execute_code', 'code', 'code'],
    ['read_file', 'file', 'file'],
    ['patch', 'file', 'edit'],
    ['image_generate', 'image', 'image'],
  ];
  for (const [name, kind, icon] of cases) {
    assert.equal(hermesToolKind(name), kind, name);
    assert.equal(toolIconName(name), icon, name);
  }
  assert.equal(hermesToolKind('TERMINAL'), 'terminal');
});

test('unknown tools keep the generic look', () => {
  for (const name of ['my_custom_tool', 'mcp__other_server__do', 'toString', 'constructor', '__proto__', 'browserish']) {
    assert.equal(hermesToolKind(name), null, name);
    assert.equal(toolIconName(name), null, name);
  }
  const v = describeTool(de, tool('my_custom_tool', 'my_custom_tool'));
  assert.deepEqual([v.kind, v.icon, v.title, v.preview], [null, null, 'My custom tool', null]);
});

test('labels: terminal / web search / files keep the existing titles', () => {
  assert.equal(describeTool(de, tool('terminal', 'ls -la')).title, 'Terminal');
  assert.equal(describeTool(de, tool('terminal', 'ls -la')).preview, 'ls -la');
  assert.equal(describeTool(en, tool('web_search', 'wetter wien')).title, 'Web search');
  assert.equal(describeTool(de, tool('mcp__web_search_plus__web_search', 'x')).title, 'Websuche');
  assert.equal(describeTool(de, tool('read_file', 'notes.md')).title, 'Datei lesen');
  assert.equal(describeTool(de, tool('image_generate', 'ein Fuchs')).title, 'Bild erzeugen');
  assert.equal(describeTool(de, tool('browser_navigate', 'https://example.org')).title, 'Browser');
});

test('todo: progress from the stored result, count from the arguments, server label otherwise', () => {
  const todos = [
    { id: '1', content: 'Recherche', status: 'completed' },
    { id: '2', content: 'Entwurf', status: 'in_progress' },
    { id: '3', content: 'Prüfen', status: 'pending' },
    { id: '4', content: 'Alt', status: 'cancelled' },
  ];
  const full = describeTool(de, withIO('todo_list', { todos }, { todos, revision: 2, summary: { total: 4 } }));
  assert.equal(full.title, 'Aufgabenliste');
  assert.equal(full.preview, '1 von 3 erledigt');
  assert.equal(full.sub, 'Entwurf');
  assert.equal(describeTool(en, withIO('todo_list', { todos })).preview, '4 tasks');
  assert.equal(describeTool(de, tool('todo_list', 'plant 5 Aufgaben')).preview, 'plant 5 Aufgaben');
  assert.equal(parseTodos(withIO('todo_list', JSON.stringify({ todos })))?.length, 4);
  assert.equal(parseTodos(tool('todo_list')), null);
  assert.equal(parseTodos(withIO('todo_list', { todos: [{ content: '' }, 3] })), null);
});

test('delegate: "Unteragent" + goal, several tasks counted', () => {
  const one = describeTool(de, withIO('delegate_task', { goal: 'Preise vergleichen' }));
  assert.equal(toolViewText(one), 'Unteragent: Preise vergleichen');
  assert.equal(one.icon, 'users');
  const many = describeTool(en, withIO('delegate_task', { tasks: [{ goal: 'A' }, { goal: 'B' }] }));
  assert.equal(many.title, '2 subagents');
  assert.equal(many.preview, 'A');
  assert.equal(toolViewText(describeTool(de, tool('delegate_task', 'Preise vergleichen'))), 'Unteragent: Preise vergleichen');
  assert.equal(describeTool(es, tool('delegate_task')).title, 'Subagente');
});

test('cronjob: action titles from the live label or the arguments', () => {
  assert.equal(describeTool(de, tool('cronjob_manage', 'create')).title, 'Erinnerung anlegen');
  assert.equal(describeTool(de, tool('cronjob_manage', 'create')).preview, null);
  assert.equal(describeTool(de, tool('cronjob_manage', 'remove')).title, 'Erinnerung löschen');
  assert.equal(describeTool(en, withIO('cronjob_manage', { action: 'list' })).title, 'View reminders');
  const created = describeTool(de, withIO('cronjob_manage', { action: 'create', schedule: 'in 30m', prompt: 'Wasser trinken', name: 'Wasser' }));
  assert.deepEqual([created.title, created.preview], ['Erinnerung anlegen', 'Wasser']);
  assert.equal(describeTool(de, tool('cronjob_manage', 'wat')).title, 'Erinnerung');
});

test('memory: gemerkt with the entry only when exposed, else "Gedächtnis aktualisiert"', () => {
  assert.equal(memoryAction(tool('memory', '+user: "Rob mag Tee"')), 'save');
  assert.equal(memoryAction(tool('memory', '~memory: "alt"')), 'save');
  assert.equal(memoryAction(tool('memory', '-user: "alt"')), 'forget');
  assert.equal(memoryAction(tool('memory', 'memory')), 'unknown');
  const live = describeTool(de, tool('memory', '+user: "Rob mag Tee"'));
  assert.deepEqual([live.title, live.preview, live.icon], ['Gemerkt', 'Rob mag Tee', 'brain']);
  const stored = describeTool(de, withIO('memory', { action: 'add', target: 'user', content: 'Rob mag grünen Tee, keinen Kaffee' }, { success: true }));
  assert.equal(stored.preview, 'Rob mag grünen Tee, keinen Kaffee');
  const bare = describeTool(de, tool('memory', 'memory'));
  assert.deepEqual([bare.title, bare.preview], ['Gedächtnis aktualisiert', null]);
  assert.equal(describeTool(de, withIO('fact_store', { action: 'search', query: 'Tee' })).title, 'Im Gedächtnis gesucht');
  assert.equal(describeTool(de, withIO('fact_store', { action: 'add', content: 'X', tags: 'a' })).title, 'Gemerkt');
  assert.equal(describeTool(de, tool('fact_store')).title, 'Gedächtnis');
});

test('memoryNotes: one note per successful write, text only when exposed', () => {
  const notes = memoryNotes([
    tool('memory', '+user: "Rob mag Tee"'),
    tool('memory', 'memory'),
    tool('memory', '-user: "alt"'),
    tool('memory', '+user: "fehlgeschlagen"', undefined, 'error'),
    withIO('fact_store', { action: 'add', content: 'Wohnt in Wien' }),
    withIO('fact_store', { action: 'search', query: 'x' }),
    tool('fact_store', 'fact_store'),
    tool('terminal', 'ls'),
  ].map((t, i) => ({ ...t, id: `m${i}` })));
  assert.deepEqual(notes, [
    { id: 'm0', text: 'Rob mag Tee' },
    { id: 'm1', text: undefined },
    { id: 'm4', text: 'Wohnt in Wien' },
  ]);
});

test('session_search and skills', () => {
  const s = describeTool(de, tool('session_search', 'recall: "Steuererklärung 2025"'));
  assert.deepEqual([s.title, s.preview, s.icon], ['In früheren Chats gesucht', 'Steuererklärung 2025', 'history']);
  assert.equal(sessionSearchQuery(tool('session_search', 'Erinnerung: „Urlaub Kreta“')), 'Urlaub Kreta');
  assert.equal(sessionSearchQuery(withIO('session_search', { query: 'Kreta' })), 'Kreta');
  assert.equal(describeTool(de, tool('session_search', 'session_search')).preview, null);
  const sk = describeTool(de, tool('skill_view', 'hermes-ui'));
  assert.deepEqual([sk.title, sk.preview, sk.icon], ['Skill geladen', 'hermes-ui', 'book']);
  assert.equal(describeTool(en, withIO('skill_view', { name: 'hermes-ui', file_path: 'a.md' })).title, 'Skill loaded');
  assert.equal(describeTool(de, tool('skills_list', 'skills_list')).title, 'Skills durchsucht');
});

test('context compression detection: status kind, status text, pruned-skill marker', () => {
  assert.equal(isCompactedStatus('compacted', '✓ Context compaction complete — continuing turn...'), true);
  assert.equal(isCompactedStatus('lifecycle', '✓ Context compaction complete — continuing turn...'), true);
  assert.equal(isCompactedStatus('lifecycle', '🗜️ Compacting context — summarizing earlier conversation so I can continue...'), false);
  assert.equal(isCompactedStatus('compacting', 'Context compacted'), false);
  assert.equal(isCompactedStatus('retry', 'Provider langsam, neuer Versuch in 5 s'), false);
  assert.equal(isCompactedStatus(undefined, undefined), false);

  let msg: ChatMessage = createAssistantMessage(1000);
  const statusEv = (kind: string, text: string): HermesEvent => ({ type: 'status', kind, text });
  msg = applyEvent(msg, statusEv('lifecycle', '🗜️ Compacting context — summarizing earlier conversation so I can continue...'), 1100);
  assert.equal(hasContextCompression(msg), false);
  msg = applyEvent(msg, statusEv('compacted', '✓ Context compaction complete — continuing turn...'), 1200);
  assert.equal(hasContextCompression(msg), true);
  // shows up as a timeline row with the stroke icon
  const rows = buildTimeline(msg, de);
  const row = rows.find((r) => r.title === 'Kontext komprimiert');
  assert.ok(row);
  assert.equal(row.iconName, 'compress');

  const pruned = { ...createAssistantMessage(1), tools: [withIO('skill_view', { name: 'x' }, "[SKILL_PRUNED: content lost in compression; reload with skill_view(name='x')]")] };
  assert.equal(hasContextCompression(pruned), true);
  assert.equal(hasContextCompression(createAssistantMessage(1)), false);

  // B9: compaction inside the very first turn gets no chat divider (the timeline row above
  // already notes it); from the second turn on the divider marks real mid-conversation loss
  assert.equal(shouldShowCompactionDivider(msg, true), false);
  assert.equal(shouldShowCompactionDivider(msg, false), true);
  assert.equal(shouldShowCompactionDivider(createAssistantMessage(1), false), false);
});

test('timeline rows and detail sheet use the Hermes presentation', () => {
  let msg = createAssistantMessage(1000);
  msg = applyEvent(msg, { type: 'tool', callId: 't1', name: 'session_search', status: 'running', label: 'recall: "Kreta"' }, 1100);
  msg = applyEvent(msg, { type: 'tool', callId: 't2', name: 'todo_list', status: 'running', label: 'planning 2 task(s)' }, 1200);
  msg = applyEvent(msg, { type: 'tool', callId: 't1', name: 'session_search', status: 'done' }, 1300);
  const rows = buildTimeline(msg, de, 2000).filter((r) => r.kind === 'tool');
  assert.deepEqual(rows.map((r) => [r.title, r.summary, r.iconName]), [
    ['In früheren Chats gesucht', 'Kreta', 'history'],
    ['Aufgabenliste', 'planning 2 task(s)', 'checklist'],
  ]);
  // stored detail arrives: todo items become a section in the sheet
  const todos = [{ id: '1', content: 'A', status: 'completed' }, { id: '2', content: 'B', status: 'pending' }];
  msg = { ...msg, tools: msg.tools.map((t) => (t.id === 't2' ? { ...t, status: 'done', detail: { tool: 'todo_list', input: { todos }, output: { todos } } } : t)) };
  const sheet = rowDetail(msg, 'tool:t2', { t: de, locale: 'de-DE' });
  assert.ok(sheet);
  assert.equal(sheet.iconName, 'checklist');
  const sec = sheet.sections.find((s) => s.title === 'Aufgaben');
  assert.equal(sec?.body, '[x] A\n[ ] B');
  assert.equal(buildTimeline(msg, de, 2000).find((r) => r.key === 'tool:t2')?.summary, '1 von 2 erledigt');
});

// ---- WSP chips (docs/WSP-INTEGRATION.md): query, mode, provider, result count – generic tools keep working

test('WSP chips: web_search_plus with the stored result → query, provider, hits, cached', () => {
  const call = { id: 'c1', name: 'web_search_plus', arguments: JSON.stringify({ query: 'python 3.14 free threading', count: 5 }) };
  const { detail } = toolDetailFrom(call as never, { role: 'tool', content: WSP_SEARCH_TEXT, toolCallId: 'c1' } as never);
  assert.equal(detail.links?.length, 3);
  assert.deepEqual(detail.web, { count: 3, provider: 'brave', cached: true });
  const v = describeTool(de, { name: 'web_search_plus', label: 'python 3.14 free threading', detail });
  assert.equal(v.title, 'Websuche');
  assert.equal(v.icon, 'search');
  assert.equal(v.preview, 'python 3.14 free threading');
  assert.equal(v.sub, 'Brave · 3 Treffer · aus dem Cache');
  // live (no stored result yet): title + query label only
  const live = describeTool(en, tool('web_search_plus', 'python 3.14'));
  assert.equal(live.title, 'Web search');
  assert.equal(live.sub, undefined);
});

test('WSP chips: research mode, extract pages, MCP JSON variant, explicit provider argument', () => {
  const research = describeTool(de, withIO('web_search_plus', { query: 'Wärmepumpe Effizienz', mode: 'research', provider: 'exa' }));
  assert.equal(research.title, 'Recherche');
  assert.equal(research.sub, 'Exa');
  const call = { id: 'c2', name: 'web_extract_plus', arguments: { urls: ['https://peps.example.org/pep-0779/', 'https://broken.example.net/page'] } };
  const { detail } = toolDetailFrom(call as never, { role: 'tool', content: WSP_EXTRACT_TEXT, toolCallId: 'c2' } as never);
  const ex = describeTool(de, { name: 'web_extract_plus', label: 'x', detail });
  assert.equal(ex.title, 'Webseite laden');
  assert.equal(ex.preview, 'peps.example.org +1');
  assert.equal(ex.sub, 'Tavily · 2 Seiten');
  const mcp = toolDetailFrom({ id: 'c3', name: 'mcp__web_search_plus__web_search', arguments: { query: 'q' } } as never, { role: 'tool', content: JSON.stringify(WSP_MCP_JSON), toolCallId: 'c3' } as never).detail;
  assert.equal(describeTool(en, { name: 'mcp__web_search_plus__web_search', label: 'q', detail: mcp }).sub, 'Serper · 1 result · cached');
  // a generic search tool without parseable output keeps the plain look
  const generic = describeTool(de, withIO('web_search', { query: 'wetter' }, 'irgendein Text'));
  assert.equal(generic.title, 'Websuche');
  assert.equal(generic.sub, undefined);
});
