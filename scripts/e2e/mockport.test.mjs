// scripts/e2e/mockport.sh + smoke.sh: a mock left by a killed run must not be mistaken for this run's mock, and a run
// whose client side goes away still tears down (the stale mock / emulator of 2026-10-16 broke later runs' pairing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('./mockport.sh', import.meta.url));
const SMOKE = fileURLToPath(new URL('./smoke.sh', import.meta.url));

/** async: the test's own server must keep answering while bash asks it */
const taken = (port) =>
  new Promise((resolve) => {
    const p = spawn('bash', ['-c', '. "$1"; mock_port_taken "$2"', 'x', LIB, String(port)]);
    let out = '';
    p.stdout.on('data', (b) => (out += b));
    p.on('close', (status) => resolve({ status, out: out.trim() }));
  });
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('mock_port_taken: a stale E2E mock answers → taken, with what it said', async () => {
  const server = http.createServer((req, res) => res.end(req.url === '/__e2e/state' ? '{"turns":3}' : 'no'));
  const port = await listen(server);
  try {
    const r = await taken(port);
    assert.equal(r.status, 0);
    assert.match(r.out, /E2E mock answers on port \d+.*"turns":3/);
  } finally {
    server.close();
  }
});

test('mock_port_taken: any other listener → taken; a free port → free', async () => {
  const server = net.createServer((s) => s.end());
  const port = await listen(server);
  try {
    const r = await taken(port);
    assert.equal(r.status, 0);
    assert.match(r.out, /taken by another program/);
  } finally {
    server.close();
  }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await taken(port)).status, 1);
});

test('smoke.sh: refuses a taken mock port; its teardown ignores SIGPIPE before its first log line', () => {
  const s = readFileSync(SMOKE, 'utf8');
  assert.match(s, /if why=\$\(mock_port_taken "\$MOCK_PORT"\); then .*exit 2; fi\nnode "\$HERE\/mock\.mjs"/);
  const td = s.slice(s.indexOf('teardown() {'));
  assert.ok(td.indexOf("trap '' PIPE") > 0 && td.indexOf("trap '' PIPE") < td.indexOf('log "teardown"'), 'PIPE ignored before the first log line');
});

/** a shell shaped like smoke.sh (EXIT trap teardown that logs first) whose stdout reader goes away */
const teardownSurvives = (ignorePipe) =>
  new Promise((resolve) => {
    const marker = join(tmpdir(), `mockport-td-${process.pid}-${ignorePipe}`);
    rmSync(marker, { force: true });
    const p = spawn('bash', ['-c', `m="$1"; td() { trap - EXIT INT TERM HUP; ${ignorePipe ? "trap '' PIPE;" : ''} echo teardown; : > "$m"; }; trap td EXIT; trap 'exit 130' INT TERM HUP; while :; do echo line; sleep 0.05; done`, 'x', marker]);
    p.stdout.once('data', () => p.stdout.destroy());
    p.on('close', () => {
      const ok = existsSync(marker);
      rmSync(marker, { force: true });
      resolve(ok);
    });
  });

test('the mechanism: with the reader gone, a teardown that logs first reaches its cleanup only when it ignores SIGPIPE', async () => {
  assert.equal(await teardownSurvives(false), false); // smoke.sh before the fix
  assert.equal(await teardownSurvives(true), true); // smoke.sh now
});
