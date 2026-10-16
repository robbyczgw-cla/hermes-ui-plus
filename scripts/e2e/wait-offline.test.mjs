// suite.py wait_offline(): an "offline" check must not send before airplane mode has really cut the host alias (it is applied
// asynchronously; on the Mac emulator a send during the transition hangs at "Taking a little longer…" instead of failing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));

const py = (code) => spawnSync('python3', ['-I', '-c', `import sys\nsys.path.insert(0, ${JSON.stringify(DIR)})\nimport suite\n${code}`], { encoding: 'utf8' });

test('wait_offline: waits until the ping to the host alias fails, gives up after the timeout', () => {
  const r = py(`
seq = [' 0% packet loss', ' 0% packet loss', ' 100% packet loss']
calls = []
def fake(cmd, *a, **k):
    calls.append(cmd)
    return seq.pop(0) if seq else ' 100% packet loss'
suite.d.sh = fake
print(suite.wait_offline(5), len(calls))
suite.d.sh = lambda cmd, *a, **k: ' 0% packet loss'
print(suite.wait_offline(1.2))
`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['True 3', 'False']);
});

test('net_snapshot: collects ping, airplane flag, routes and the connectivity networks for the failure evidence', () => {
  const r = py(`
suite.d.sh = lambda cmd, *a, **k: 'NetworkAgentInfo{x}\\nother' if cmd.startswith('dumpsys') else 'out:' + cmd.split()[0]
t = suite.net_snapshot()
print('NetworkAgentInfo{x}' in t, 'other' not in t, 'airplane_mode_on' in t, 'ip route' in t)
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'True True True True');
});
