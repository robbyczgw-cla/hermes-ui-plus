/**
 * One file per key (native: transcripts / node state live in `<documents>/hui-store/<ns>/`, not in
 * AsyncStorage's size-capped SQLite DB). Pure, erasable TS: the file system is injected (`FsLike`, see
 * fileKvExpo.ts for expo-file-system), so node:test can run it against an in-memory fs.
 *
 * Atomic writes: the value is written to `<name>.tmp` and then moved over `<name>`. A crash during the
 * write leaves the old file intact. iOS implements "move with overwrite" as remove + move, so a crash
 * between the two leaves only the (complete) temp file: reads recover it when it parses as JSON.
 */
import type { KeyValueStorage } from './kv.ts';

export type FsLike = {
  /** file content, or null when it does not exist */
  read(name: string): Promise<string | null>;
  write(name: string, data: string): Promise<void>;
  /** rename `from` → `to`, replacing `to` */
  move(from: string, to: string): Promise<void>;
  /** no-op when missing */
  remove(name: string): Promise<void>;
  /** file names in the directory */
  list(): Promise<string[]>;
};

const EXT = '.json';
const TMP = '.tmp';

/** File name for a key (keys contain `.`, `-`, `_`, ids; anything else is percent-encoded). */
export function fileNameOf(key: string): string {
  return encodeURIComponent(key) + EXT;
}

export function keyOfFileName(name: string): string | null {
  if (!name.endsWith(EXT)) return null;
  try {
    return decodeURIComponent(name.slice(0, -EXT.length));
  } catch {
    return null;
  }
}

function parses(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

export function createFileStorage(fs: FsLike): KeyValueStorage {
  return {
    async getItem(key) {
      const name = fileNameOf(key);
      const v = await fs.read(name);
      if (v !== null) return v;
      // interrupted replace (see header): the temp file holds the last complete write
      const tmp = await fs.read(name + TMP).catch(() => null);
      if (tmp === null || !parses(tmp)) return null;
      try {
        await fs.move(name + TMP, name);
      } catch {
        // read again from tmp next time
      }
      return tmp;
    },
    async setItem(key, value) {
      const name = fileNameOf(key);
      try {
        await fs.write(name + TMP, value);
      } catch (e) {
        await fs.remove(name + TMP).catch(() => {}); // a half-written temp file must not occupy the space
        throw e;
      }
      await fs.move(name + TMP, name);
    },
    async removeItem(key) {
      const name = fileNameOf(key);
      await fs.remove(name);
      await fs.remove(name + TMP).catch(() => {});
    },
    async getAllKeys() {
      const names = await fs.list();
      const out = new Set<string>();
      for (const n of names) {
        const k = keyOfFileName(n.endsWith(EXT + TMP) ? n.slice(0, -TMP.length) : n);
        if (k !== null) out.add(k);
      }
      return Array.from(out);
    },
  };
}

/** In-memory FsLike (tests). `failWrite(name)` decides whether a write throws (quota simulation). */
export function memoryFs(opts: { failWrite?: (name: string, data: string) => boolean } = {}): FsLike & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (n) => files.get(n) ?? null,
    write: async (n, d) => {
      if (opts.failWrite?.(n, d)) {
        files.set(n, d.slice(0, Math.floor(d.length / 2))); // partial write left behind
        throw new Error('ENOSPC: no space left on device');
      }
      files.set(n, d);
    },
    move: async (a, b) => {
      const v = files.get(a);
      if (v === undefined) throw new Error('ENOENT ' + a);
      files.delete(a);
      files.set(b, v);
    },
    remove: async (n) => {
      files.delete(n);
    },
    list: async () => Array.from(files.keys()),
  };
}
