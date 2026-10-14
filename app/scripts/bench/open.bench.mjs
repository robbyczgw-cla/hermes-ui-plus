// Chat open / switch / cold start: what stands between a tap in the drawer (or the app start) and the first paint
// of the chat's messages. Run from app/: scripts/bench/run.sh open
//
// Storage latency is simulated (HUI_BENCH_READ_MS, default 8 ms per read: an AsyncStorage / file read on a mid-range
// phone is in the 3–30 ms range). The JS-thread cost (JSON.parse + migrate + search text) is measured for real.
// "async hops" counts the awaits on storage between the tap and messages in hand; every hop also means one extra
// React commit (the session renders a blank view first, then the content).
import { createController } from '../../src/conversations/controller.ts';
import { createRepo, msgsKey, INDEX_KEY } from '../../src/conversations/repo.ts';
import { createIndexStore } from '../../src/conversations/store.ts';
import { prepareForStorage } from '../../src/conversations/messages.ts';
import { header, reportOnce } from './lib.mjs';
import { hermesRows, longChat } from './fixtures.mjs';
import { mapRemoteMessages } from '../../src/hermes/sessionMapping.ts';
import { remotePrefetchCandidates, storeFetchedTranscript } from '../../src/conversations/remotePrefetch.ts';

const READ_MS = Number(process.env.HUI_BENCH_READ_MS ?? 8);
/** GET /api/sessions/<id>/messages round trip (tailnet / mobile: 150–700 ms observed for big transcripts) */
const NET_MS = Number(process.env.HUI_BENCH_NET_MS ?? 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

function slowStorage(data) {
  let reads = 0;
  return {
    data,
    reads: () => reads,
    async getItem(k) {
      reads++;
      await sleep(READ_MS);
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      data.delete(k);
    },
    async getAllKeys() {
      return Array.from(data.keys());
    },
  };
}

function seed(chats, size) {
  const data = new Map();
  const items = [];
  for (let c = 0; c < chats; c++) {
    const id = `c${String(c).padStart(3, '0')}`;
    const messages = prepareForStorage(longChat(size));
    data.set(msgsKey(id), JSON.stringify({ v: 1, messages }));
    items.push({ id, title: `Chat ${c}`, profileId: 'p1', profileKind: 'hermes', hermesSessionId: `hui-${c}`, createdAt: 1_700_000_000_000 + c, updatedAt: 1_700_000_100_000 - c, messageCount: size, preview: 'x' });
  }
  data.set(INDEX_KEY, JSON.stringify({ v: 1, items, activeId: items[0].id }));
  return data;
}

async function boot(data) {
  const storage = slowStorage(data);
  const repo = createRepo(storage, { debounceMs: 50 });
  const store = createIndexStore(await repo.loadIndex());
  const ctl = createController(store, repo);
  return { storage, repo, store, ctl };
}

/** time until the chat's messages are in hand: sync peek when the code has one, else the async load */
async function open(ctl, id) {
  const t0 = now();
  const hit = typeof ctl.peekMessages === 'function' ? ctl.peekMessages(id) : undefined;
  if (hit) return { ms: now() - t0, hops: 0, n: hit.length };
  const list = await ctl.loadMessages(id);
  return { ms: now() - t0, hops: 1, n: list.length };
}

const fmt = (r) => `${r.ms.toFixed(2).padStart(7)} ms  async hops ${r.hops}`;

header(`transcript load cost on the JS thread (JSON.parse + migrate + search text), no I/O`);
for (const size of [50, 150, 300]) {
  const data = seed(1, size);
  const raw = data.get(msgsKey('c000'));
  const t = [];
  for (let i = 0; i < 7; i++) {
    const repo = createRepo({ getItem: async () => raw, setItem: async () => {}, removeItem: async () => {} });
    const t0 = now();
    await repo.loadMessages('c000');
    t.push(now() - t0);
  }
  t.sort((a, b) => a - b);
  console.log(`  ${size} messages: ${t[3].toFixed(2)} ms per load (median of 7, incl. one microtask hop)`);
}

header(`switch to another chat from the drawer (storage read ${READ_MS} ms simulated)`);
for (const size of [50, 150, 300]) {
  const data = seed(8, size);
  const a = await boot(data);
  // what the app has done before the user taps: the start-up idle prefetch, when the code has one
  if (typeof a.ctl.prefetchMessages === 'function') await a.ctl.prefetchMessages(a.ctl.list().slice(0, 5).map((c) => c.id));
  const second = a.ctl.list()[1].id;
  const r1 = await open(a.ctl, second);
  const r2 = await open(a.ctl, second); // the same chat again (LRU cache)
  const far = a.ctl.list()[7].id; // a chat further down the list (no prefetch)
  const r3 = await open(a.ctl, far);
  console.log(`  ${size}-msg chats: 2nd most recent chat ${fmt(r1)} | re-open same chat ${fmt(r2)} | 8th chat ${fmt(r3)}`);
}

header(`cold start: index read, crash-marker read, transcript read (storage read ${READ_MS} ms simulated)`);
{
  // ChatScreen orchestration modelled with the real repo: before = index → crash marker → transcript, one after the
  // other (the crash marker read started once the index was ready, the transcript once the session mounted);
  // after = crash marker read at mount (parallel to the index), transcript warmed as soon as the index is in.
  const data = seed(8, 150);
  let t0 = now();
  let a = await boot(data);
  await a.storage.getItem('hui.chatCrash');
  let r = await open(a.ctl, a.store.get().activeId);
  console.log(`  serial   : first messages after ${(now() - t0).toFixed(1)} ms (last step ${fmt(r)})`);
  if (typeof a.ctl.peekMessages === 'function') {
    t0 = now();
    const storage = slowStorage(data);
    const crash = storage.getItem('hui.chatCrash');
    const repo = createRepo(storage, { debounceMs: 50 });
    const store = createIndexStore(await repo.loadIndex());
    const ctl = createController(store, repo);
    const warm = ctl.prefetchMessages([store.get().activeId]);
    await crash;
    await warm;
    r = await open(ctl, store.get().activeId);
    console.log(`  parallel : first messages after ${(now() - t0).toFixed(1)} ms (last step ${fmt(r)})`);
  }
}

header(`first open of a Hermes chat never opened here (messages request ${NET_MS} ms simulated, storage read ${READ_MS} ms)`);
{
  // before: the session rendered nothing (no header) until the transcript was fetched and mapped (≤ 8 s timeout);
  // after: header + composer + placeholder on the first commit; with the idle / drawer prefetch the transcript is
  // stored before the tap and the chat mounts with its messages (0 hops)
  for (const [label, rows] of [
    ['40 turns', hermesRows(40)],
    ['40 turns, web extracts (5 × 20K chars)', hermesRows(40, 20_000)],
  ]) {
    const body = JSON.stringify({ messages: rows });
    const fetchAndMap = async () => {
      await sleep(NET_MS);
      const parsed = JSON.parse(body).messages;
      return { remote: mapRemoteMessages(parsed), newest: parsed.reduce((m, r) => Math.max(m, r.timestamp ?? 0), 0) };
    };
    const t0 = now();
    const fetched = await fetchAndMap();
    const blank = now() - t0;
    const js = reportOnce(`  ${label}: JSON.parse + mapRemoteMessages (JS thread)`, () => mapRemoteMessages(JSON.parse(body).messages));
    // prefetch: a remote-only entry, fetched + stored in idle time, then opened
    const data = new Map();
    const a = await boot(seedEmpty(data));
    a.ctl.mergeRemote({ id: 'p1', kind: 'hermes' }, [{ id: 'hui-remote-1', source: 'api_server', startedAt: 1, lastActive: fetched.newest, messageCount: rows.length }]);
    const [meta] = remotePrefetchCandidates(a.store.get().items, { profileId: 'p1', filter: {} });
    const s0 = now();
    await storeFetchedTranscript(a.ctl, meta.id, fetched, { activityAtStart: meta.remote.lastActive, isMounted: () => false });
    const store = now() - s0;
    const r = await open(a.ctl, meta.id);
    console.log(
      `  ${label}: before: no header for ${blank.toFixed(0)} ms (request + ${js.toFixed(1)} ms mapping), 1 hop | ` +
        `after: header at once, placeholder ${blank.toFixed(0)} ms | prefetched: ${fmt(r)}, ${r.n} msgs (store in idle ${store.toFixed(1)} ms)`,
    );
  }
}

function seedEmpty(data) {
  data.set(INDEX_KEY, JSON.stringify({ v: 1, items: [] }));
  return data;
}
