// node --test scripts/build-desktop-linux.test.mjs — what the Linux desktop build's release gate covers (source-level wiring).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('./build-desktop-linux.sh', import.meta.url), 'utf8');

test('the .deb is gated unpacked (files and control data); only a name placeholder goes in the download-dir scan', () => {
  assert.match(src, /dpkg-deb -x "\$OUT_STAGE\/\$DEB" "\$APPX\/deb"/);
  assert.match(src, /dpkg-deb -e "\$OUT_STAGE\/\$DEB" "\$APPX\/deb-control"/, 'the control member is scanned too');
  assert.match(src, /! -name '\*\.AppImage' ! -name '\*\.deb'/, 'raw compressed packages are not scanned as bytes');
  assert.match(src, /: > "\$0\/\$\(basename "\$f"\)"/, 'their names are still scanned');
});

test('the desktop gate gets the embedded web assets dir', () => {
  assert.match(src, /export HUI_EMBEDDED_ASSETS="\$WEB_OUT"/);
  assert.ok(src.indexOf('export HUI_EMBEDDED_ASSETS') < src.indexOf('flavor_guard_output "$APPX"'));
});
