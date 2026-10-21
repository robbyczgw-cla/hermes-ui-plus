// node --test scripts/demo-recorder.test.mjs: the demo recorder must capture at its device scale, not at 1x.
// The CDP screencast takes frames from the compositor, which ignores the context's deviceScaleFactor emulation;
// only --force-device-scale-factor makes it deliver 2x frames. Without it every "3x" demo was an upscaled 1x capture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { BROWSER_ARGS, REC_DSF, VIEWPORT, loadPlaywright, newClipPage, startCapture } from './demo-videos/lib.mjs';

test('recorder: the browser gets --force-device-scale-factor equal to the recording scale', () => {
  assert.ok(BROWSER_ARGS.includes(`--force-device-scale-factor=${REC_DSF}`), BROWSER_ARGS.join(' '));
  assert.ok(Number.isInteger(REC_DSF) && REC_DSF >= 2, 'a 1x recording is the bug');
});

let playwright = null;
try { playwright = await loadPlaywright(); } catch { /* no playwright-core on this machine */ }

test('recorder: real screencast frames have the scaled size', { skip: !playwright && 'playwright-core not available' }, async (t) => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true, args: BROWSER_ARGS }); } catch { return t.skip('no Chromium'); }
  const dir = mkdtempSync(join(tmpdir(), 'hui-rec-'));
  try {
    const { page } = await newClipPage(browser, {});
    await page.route('http://rec.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:linear-gradient(red,blue);height:100vh"><script>setInterval(()=>{document.body.style.opacity=String(0.6+0.3*Math.sin(Date.now()/90))},16)</script>' }));
    await page.goto('http://rec.test/');
    const cap = await startCapture(page, dir);
    await page.waitForTimeout(1500);
    assert.ok((await cap.stop()).frames >= 1, "frames captured");
    const first = join(dir, readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()[0]);
    const size = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', first]).toString().trim();
    assert.equal(size, `${VIEWPORT.width * REC_DSF},${VIEWPORT.height * REC_DSF}`);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
