import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createImageFetcher, loadImageProxyConfig, parseTarget } from '../src/image-proxy.mjs';
import { SEEDS, LONG, random } from './security-helpers.mjs';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('test-fake-image-bytes')]);

async function fixture(t, handle) {
  const hits = [];
  const upstream = http.createServer((req, res) => { hits.push(req.url); handle(req, res); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  return {
    hits,
    fetcher: (resolve, config = {}) => createImageFetcher({
      ...loadImageProxyConfig({}), maxBytes: 128, totalTimeoutMs: 500, connectTimeoutMs: 300, ...config,
    }, {
      resolve,
      // Only this local mock transport gets an exception. Production policy has no such exception.
      allowAddress: (ip) => ip === '127.0.0.1',
      transport: { request: http.request, port: upstream.address().port },
    }),
  };
}
const target = (path) => {
  const parsed = parseTarget('https://img.example.com' + path);
  assert.equal(parsed.ok, true);
  return parsed.url;
};
const localAddress = [{ address: '127.0.0.1', family: 4 }];

test('DNS pinning: one lookup per connection, then fresh validation on the next fetch', async (t) => {
  const { fetcher, hits } = await fixture(t, (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG));
  let lookups = 0;
  const fetchImage = fetcher(async () => ++lookups === 1 ? localAddress : [{ address: '192.0.2.1', family: 4 }]);
  assert.deepEqual((await fetchImage(target('/test'))).body, PNG);
  assert.equal(lookups, 1, 'the socket uses the validated result without a second DNS query');
  await assert.rejects(fetchImage(target('/test')), { code: 'forbidden_address', status: 403 });
  assert.equal(lookups, 2);
  assert.deepEqual(hits, ['/test']);
});

test('same-host redirect revalidates DNS; rebinding to a forbidden address never opens a connection', async (t) => {
  const { fetcher, hits } = await fixture(t, (_req, res) => res.writeHead(302, { location: '/test-next' }).end());
  let lookups = 0;
  const fetchImage = fetcher(async () => ++lookups === 1 ? localAddress : [{ address: '192.0.2.1', family: 4 }]);
  await assert.rejects(fetchImage(target('/test-start')), { code: 'forbidden_address', status: 403 });
  assert.equal(lookups, 2);
  assert.deepEqual(hits, ['/test-start']);
});

for (const seed of SEEDS) {
  test(`seed=${seed}: bounded redirect chains and forbidden redirect targets`, async (t) => {
    const next = random(seed);
    const { fetcher, hits } = await fixture(t, (req, res) => {
      if (req.url.startsWith('/chain/')) {
        const n = Number(req.url.slice('/chain/'.length));
        if (n > 0) return res.writeHead(302, { location: '/chain/' + (n - 1) }).end();
        return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
      }
      const paths = ['/test', 'http://img.example.com/test', 'https://[::1]/test', 'https://img.example.com:8443/test', 'https://localhost/test', 'https://2130706433/test'];
      res.writeHead(307, { location: paths[Number(req.url.slice(1))] }).end();
    });
    const fetchImage = fetcher(async () => localAddress);
    for (let i = 0; i < (LONG ? 128 : 12); i++) {
      const redirects = next(8);
      const before = hits.length;
      if (redirects <= 3) assert.equal((await fetchImage(target('/chain/' + redirects))).redirects, redirects);
      else await assert.rejects(fetchImage(target('/chain/' + redirects)), { code: 'too_many_redirects' });
      assert.ok(hits.length - before <= 4);
    }
    for (let i = 1; i < 6; i++) {
      const before = hits.length;
      await assert.rejects(fetchImage(target('/' + i)), (error) => ['forbidden_address', 'invalid_url'].includes(error.code));
      assert.equal(hits.length - before, 1);
    }
  });
}

test('image responses: declared and streamed size caps, type spoofing, partial body and total trickle deadline', async (t) => {
  const { fetcher } = await fixture(t, (req, res) => {
    switch (req.url) {
      case '/declared': return res.writeHead(200, { 'content-type': 'image/png', 'content-length': '129' }).end();
      case '/streamed': res.writeHead(200, { 'content-type': 'image/png' }); res.write(PNG); return res.end(Buffer.alloc(129));
      case '/html': return res.writeHead(200, { 'content-type': 'text/html' }).end(PNG);
      case '/svg': return res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg/>');
      case '/spoof': return res.writeHead(200, { 'content-type': 'image/png' }).end('test-not-image');
      case '/encoded': return res.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' }).end(PNG);
      case '/partial': res.writeHead(200, { 'content-type': 'image/png', 'content-length': '128' }); res.write(PNG); return setImmediate(() => res.destroy());
      case '/trickle': {
        res.writeHead(200, { 'content-type': 'image/png' }); res.write(PNG);
        const timer = setInterval(() => res.write('x'), 25);
        res.once('close', () => clearInterval(timer));
        return;
      }
      default: return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(PNG);
    }
  });
  const fetchImage = fetcher(async () => localAddress);
  for (const path of ['/declared', '/streamed']) await assert.rejects(fetchImage(target(path)), { code: 'too_large', status: 413 });
  for (const path of ['/html', '/svg', '/spoof', '/encoded']) await assert.rejects(fetchImage(target(path)), { code: 'unsupported_type', status: 415 });
  await assert.rejects(fetchImage(target('/partial')), { code: 'upstream_error', status: 502 });
  await assert.rejects(fetchImage(target('/trickle')), { code: 'timeout', status: 504 });
  assert.equal((await fetchImage(target('/mislabelled'))).type, 'image/png');
});
