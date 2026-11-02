// A sent file on the native share sheet carries its own name, not the app's `<id>.<ext>` storage name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
rn.platform.OS = 'ios';
rn.modules['react-native'] = { ...rn.modules['react-native'], Alert: { alert: () => undefined } };
const log: string[] = [];
let copyFails = false;
class FakeEntry {
  uri: string;
  constructor(...parts: unknown[]) {
    this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  }
  get exists() {
    return true;
  }
  create() {
    log.push(`create ${this.uri}`);
  }
  delete() {
    log.push(`delete ${this.uri}`);
  }
  copy(to: FakeEntry) {
    if (copyFails) throw new Error('disk full');
    log.push(`copy ${this.uri} -> ${to.uri}`);
  }
}
rn.modules['expo-file-system'] = { Directory: FakeEntry, File: FakeEntry, Paths: { cache: 'cache' } };
const shared: { uri: string; opts: Record<string, unknown> }[] = [];
rn.modules['expo-sharing'] = {
  isAvailableAsync: async () => true,
  shareAsync: async (uri: string, opts: Record<string, unknown>) => void shared.push({ uri, opts }),
};
const { shareAttachment } = await import('./share.ts');

const att = { id: 'att-e523', kind: 'file', name: 'einkauf.txt', mimeType: 'text/plain', size: 5, uri: 'docs/att-e523.txt', status: 'ready' } as never;
const t = ((k: string) => k) as never;

for (const os of ['ios', 'android']) {
  test(`${os}: the share sheet gets a copy with the file's own name`, async () => {
    rn.platform.OS = os;
    log.length = 0;
    shared.length = 0;
    await shareAttachment(att, t);
    assert.deepEqual(log, ['delete cache/hui-share', 'create cache/hui-share', 'copy docs/att-e523.txt -> cache/hui-share/einkauf.txt']);
    assert.equal(shared[0].uri, 'cache/hui-share/einkauf.txt');
    assert.equal(shared[0].opts.mimeType, 'text/plain');
  });
}

test('a failed copy still shares the file', async () => {
  copyFails = true;
  shared.length = 0;
  await shareAttachment(att, t);
  copyFails = false;
  assert.equal(shared[0].uri, 'docs/att-e523.txt');
});
