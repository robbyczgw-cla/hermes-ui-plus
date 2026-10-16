import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_INTERVAL_MS,
  DEFAULT_UPDATE_STATE,
  compareSemver,
  isNewer,
  parseRelease,
  parseSemver,
  pendingUpdate,
  releasesApiUrl,
  sanitizeUpdateState,
  shouldCheck,
  updateTarget,
} from './update.ts';

const REPO = 'https://github.com/example/hermes-ui-plus';

test('parseSemver: versions, v prefix, prerelease ids, build metadata; junk → null', () => {
  assert.deepEqual(parseSemver('0.1.0-alpha.1'), { major: 0, minor: 1, patch: 0, pre: ['alpha', 1] });
  assert.deepEqual(parseSemver('v1.2.3+42'), { major: 1, minor: 2, patch: 3, pre: [] });
  for (const bad of ['', '1.2', '1.2.3.4', 'latest', 'v1.2.x', '1.2.3-', '1.2.3-alpha..1', null, undefined]) assert.equal(parseSemver(bad), null, String(bad));
});

test('compareSemver: semver §11 precedence chain', () => {
  // the example chain of the spec, each element lower than the next
  const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < chain.length; i++) {
    for (let j = 0; j < chain.length; j++) {
      const r = compareSemver(parseSemver(chain[i])!, parseSemver(chain[j])!);
      assert.equal(r, Math.sign(i - j), `${chain[i]} vs ${chain[j]}`);
    }
  }
});

test('isNewer: prereleases of the app', () => {
  assert.equal(isNewer('0.1.0-alpha.2', '0.1.0-alpha.1'), true);
  assert.equal(isNewer('0.1.0-alpha.10', '0.1.0-alpha.9'), true, 'numeric, not lexical');
  assert.equal(isNewer('0.1.0-beta.1', '0.1.0-alpha.3'), true);
  assert.equal(isNewer('0.1.0', '0.1.0-alpha.1'), true, 'release after its prerelease');
  assert.equal(isNewer('0.1.0-alpha.1', '0.1.0'), false);
  assert.equal(isNewer('0.1.0-alpha.1', '0.1.0-alpha.1'), false);
  assert.equal(isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(isNewer('0.1.0+99', '0.1.0+1'), false, 'build metadata has no precedence');
  assert.equal(isNewer('garbage', '0.1.0'), false);
  assert.equal(isNewer('0.2.0', undefined), false);
});

test('shouldCheck: at most once a day, off switch, offline, clock set back', () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: 0 }, now), true, 'never checked');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: now - 60_000 }, now), false, 'a minute ago');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: now - CHECK_INTERVAL_MS + 1 }, now), false, 'just under a day');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: now - CHECK_INTERVAL_MS }, now), true, 'a day ago');
  assert.equal(shouldCheck({ enabled: false, lastCheckAt: 0 }, now), false, 'setting off');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: 0 }, now, { online: false }), false, 'device offline');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: 0 }, now, { online: true }), true);
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: now + 3_600_000 }, now), false, 'slightly in the future: wait');
  assert.equal(shouldCheck({ enabled: true, lastCheckAt: now + 2 * CHECK_INTERVAL_MS }, now), true, 'far future (clock set back): not stuck');
});

test('shouldCheck: repeated foregrounds within a day ask once', () => {
  let s = { ...DEFAULT_UPDATE_STATE };
  let asked = 0;
  const t0 = 1_800_000_000_000;
  for (let min = 0; min < 24 * 60 * 3; min += 15) {
    const now = t0 + min * 60_000;
    if (shouldCheck(s, now)) {
      asked++;
      s = { ...s, lastCheckAt: now };
    }
  }
  assert.equal(asked, 3, 'three days of foregrounds every 15 min');
});

test('sanitizeUpdateState: defaults, broken values, foreign URLs', () => {
  assert.deepEqual(sanitizeUpdateState(null), DEFAULT_UPDATE_STATE);
  assert.deepEqual(sanitizeUpdateState({ enabled: 'no', lastCheckAt: -5, latest: { version: 'x' } }), DEFAULT_UPDATE_STATE);
  const ok = sanitizeUpdateState({ enabled: false, lastCheckAt: 5, latest: { version: '0.2.0', pageUrl: `${REPO}/releases/tag/v0.2.0`, apkUrl: 'http://insecure' }, toastShownFor: '0.2.0' });
  assert.deepEqual(ok, { enabled: false, lastCheckAt: 5, latest: { version: '0.2.0', pageUrl: `${REPO}/releases/tag/v0.2.0`, apkUrl: null }, toastShownFor: '0.2.0' });
});

test('releasesApiUrl: list for prerelease installs, latest for stable ones', () => {
  assert.equal(releasesApiUrl(REPO, '0.1.0-alpha.1'), 'https://api.github.com/repos/example/hermes-ui-plus/releases?per_page=10');
  assert.equal(releasesApiUrl(`${REPO}/`, '1.0.0'), 'https://api.github.com/repos/example/hermes-ui-plus/releases/latest');
  assert.equal(releasesApiUrl(null, '1.0.0'), null);
  assert.equal(releasesApiUrl('https://example.com/x/y', '1.0.0'), null);
});

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `${REPO}/releases/tag/${tag}`,
  draft: false,
  prerelease: /-/.test(tag),
  assets: [
    { name: `hermes-ui-plus-${tag.slice(1)}-x86_64.apk`, browser_download_url: `${REPO}/releases/download/${tag}/x86.apk` },
    { name: `hermes-ui-plus-${tag.slice(1)}.apk`, browser_download_url: `${REPO}/releases/download/${tag}/app.apk` },
  ],
  ...extra,
});

test('parseRelease: /latest object, APK asset, links stay in the repo', () => {
  assert.deepEqual(parseRelease(rel('v0.2.0'), REPO), { version: '0.2.0', pageUrl: `${REPO}/releases/tag/v0.2.0`, apkUrl: `${REPO}/releases/download/v0.2.0/app.apk` });
  const evil = parseRelease(rel('v0.2.0', { html_url: 'https://evil.example/x', assets: [{ name: 'a.apk', browser_download_url: 'https://evil.example/a.apk' }] }), REPO);
  assert.deepEqual(evil, { version: '0.2.0', pageUrl: `${REPO}/releases/tag/v0.2.0`, apkUrl: null });
  assert.equal(parseRelease(rel('v0.2.0', { draft: true }), REPO), null);
  assert.equal(parseRelease({ message: 'Not Found' }, REPO), null);
  assert.equal(parseRelease('nope', REPO), null);
});

test('parseRelease: list → newest; prereleases only for prerelease installs', () => {
  const list = [rel('v0.1.0-alpha.2'), rel('v0.1.0-alpha.10'), rel('v0.0.9'), rel('v0.1.0-beta.1', { draft: true })];
  assert.equal(parseRelease(list, REPO, true)?.version, '0.1.0-alpha.10');
  assert.equal(parseRelease(list, REPO, false)?.version, '0.0.9');
});

test('updateTarget: per platform; store installs and iOS never nag', () => {
  const base = { desktop: false, storeBuild: false, flavor: 'hermes' };
  assert.equal(updateTarget({ ...base, os: 'android' }), 'apk');
  assert.equal(updateTarget({ ...base, os: 'android', storeBuild: true }), 'none');
  assert.equal(updateTarget({ ...base, os: 'android', flavor: 'personal' }), 'release');
  assert.equal(updateTarget({ ...base, os: 'ios' }), 'none');
  assert.equal(updateTarget({ ...base, os: 'web' }), 'web');
  assert.equal(updateTarget({ ...base, os: 'web', desktop: true }), 'release');
  assert.equal(updateTarget({ ...base, os: 'windows' }), 'none');
});

test('pendingUpdate: only newer, only when enabled and a target exists', () => {
  const latest = { version: '0.2.0', pageUrl: `${REPO}/releases/tag/v0.2.0`, apkUrl: null };
  assert.equal(pendingUpdate({ enabled: true, latest }, '0.1.0', 'apk'), latest);
  assert.equal(pendingUpdate({ enabled: true, latest }, '0.2.0', 'apk'), null);
  assert.equal(pendingUpdate({ enabled: false, latest }, '0.1.0', 'apk'), null);
  assert.equal(pendingUpdate({ enabled: true, latest }, '0.1.0', 'none'), null);
  assert.equal(pendingUpdate({ enabled: true, latest: null }, '0.1.0', 'web'), null);
});
