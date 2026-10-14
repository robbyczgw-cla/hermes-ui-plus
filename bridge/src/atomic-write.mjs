// Atomic file replacement for small state files (devices.json, push registrations, watcher state, env file):
// write a temp file next to the target with a random suffix and O_EXCL ('wx': never follows or reuses a planted
// file / symlink), then rename over the target. The temp file is removed when anything fails.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

/** Temp name next to `file`: `<file>.<random>.tmp` (unpredictable, so nobody can pre-create it). */
export const tempNameFor = (file) => `${file}.${randomBytes(6).toString('hex')}.tmp`;

/**
 * @param {string} file
 * @param {string|Buffer} data
 * @param {{mode?: number, beforeRename?: (tmp: string) => void, commit?: (rename: () => void) => void}} [o]  beforeRename: e.g. chown / chmod the temp file
 */
export function writeFileAtomicSync(file, data, { mode = 0o600, beforeRename, commit = (rename) => rename() } = {}) {
  const tmp = tempNameFor(file);
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' });
    beforeRename?.(tmp);
    commit(() => fs.renameSync(tmp, file));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    throw e;
  }
  return file;
}
