// suite.py wait_answer / new_user_msgs: "stored once" counts only the user messages of this send. checklist and
// share_image both sent "e2e checklist ticks" in their own new chats, and the count spanned every chat on the device:
// share_image failed with "user message stored 2×" when its message was already stored at the first poll (Mac lane), or
// passed on checklist's older chat when it was not (the answer it checked was not its own). No adb here: transcripts()
// is replaced by a scripted sequence of stored states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;
const opts = { skip: !hasPython && 'no python3' };

// states: list of {conv: [messages]} returned by successive transcripts() calls (the last one repeats)
const py = (states, code) => {
  const r = spawnSync('python3', ['-I', '-B', '-c', `import json, sys
sys.path.insert(0, ${JSON.stringify(DIR)})
import suite
suite.time.sleep = lambda s: None
states = json.loads(${JSON.stringify(JSON.stringify(states))})
def fake():
    return states.pop(0) if len(states) > 1 else states[0]
suite.transcripts = fake
${code}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

const P = 'e2e checklist ticks';
const ANS = 'the checklist';
const user = (id, text = P) => ({ id, role: 'user', text });
const done = (id, text = ANS) => ({ id, role: 'assistant', text, status: 'done' });
const OLD = { 'conv-old.json': [user('u1'), done('a1')] };
const NEW = { ...OLD, 'conv-new.json': [user('u2'), done('a2')] };

test('wait_answer: the same prompt in an older chat is not a duplicate of this send', opts, () => {
  const out = py([OLD, NEW], `
suite.mark_sent(${JSON.stringify(P)})
print(suite.wait_answer(${JSON.stringify(P)}, ${JSON.stringify(ANS)}, 30)['conv'])`);
  assert.equal(out, 'conv-new.json');
});

test('wait_answer: does not settle for the older chat before this send is stored', opts, () => {
  const pending = { ...OLD, 'conv-new.json': [user('u2'), { id: 'a2', role: 'assistant', text: 'the', status: 'streaming' }] };
  const out = py([OLD, OLD, OLD, pending, NEW], `
suite.mark_sent(${JSON.stringify(P)})
print(suite.wait_answer(${JSON.stringify(P)}, ${JSON.stringify(ANS)}, 30)['conv'])`);
  assert.equal(out, 'conv-new.json');
});

test('wait_answer: a real duplicate of this send still fails', opts, () => {
  const dup = { ...OLD, 'conv-new.json': [user('u2'), done('a2'), user('u3'), done('a3')] };
  const out = py([OLD, dup], `
suite.mark_sent(${JSON.stringify(P)})
try:
    suite.wait_answer(${JSON.stringify(P)}, ${JSON.stringify(ANS)}, 30)
    print('passed')
except suite.Fail as e:
    print(e)`);
  assert.match(out, /stored 2× \(expected once\)/);
});

test('share_image and checklist send different prompts (each check counts its own chat)', opts, () => {
  const out = py([{}], `
import inspect, re
src = inspect.getsource(suite.Suite.c_checklist), inspect.getsource(suite.Suite.c_share_image)
print(json.dumps([re.search(r"text = '([^']+)'", s).group(1) for s in src]))`);
  const [a, b] = JSON.parse(out);
  assert.notEqual(a, b);
});

test('new_user_msgs: only messages stored after the snapshot, and a copy that lands a moment later is counted', opts, () => {
  const img = (id) => ({ id, role: 'user', text: '', attachments: [{ name: 'e2e-share.jpg', kind: 'image' }] });
  const before = { 'c1.json': [img('u1')] };
  const one = { ...before, 'c2.json': [img('u2')] };
  const two = { ...before, 'c2.json': [img('u2'), img('u3')] };
  const pred = `lambda m: any(a.get('name', '').startswith('e2e-share.') for a in m.get('attachments') or [])`;
  const run = (states) => py(states, `
snap = suite.user_ids()
hits = suite.new_user_msgs(${pred}, snap, 30)
print(json.dumps([[c, m['id']] for c, m in hits]))`);
  assert.deepEqual(JSON.parse(run([before, before, one, one, one])), [['c2.json', 'u2']]);
  assert.deepEqual(JSON.parse(run([before, one, two])), [['c2.json', 'u2'], ['c2.json', 'u3']]);
});
