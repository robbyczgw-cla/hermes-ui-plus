/**
 * expo-file-system (SDK 57 `File` / `Directory` API) binding of `FsLike` for one directory below
 * `Paths.document`. Native only (web uses IndexedDB, see idbKv.ts).
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { FsLike } from './fileKv.ts';

export function expoDirFs(...segments: string[]): FsLike {
  let ensured: Directory | null = null;
  const dir = (): Directory => {
    if (ensured && ensured.exists) return ensured;
    const d = new Directory(Paths.document, ...segments);
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    ensured = d;
    return d;
  };
  return {
    async read(name) {
      const f = new File(dir(), name);
      if (!f.exists) return null;
      return f.text();
    },
    async write(name, data) {
      // File.write creates the file when missing and truncates it otherwise (not atomic → fileKv writes a temp file)
      new File(dir(), name).write(data);
    },
    async move(from, to) {
      const src = new File(dir(), from);
      await src.move(new File(dir(), to), { overwrite: true });
    },
    async remove(name) {
      const f = new File(dir(), name);
      if (f.exists) f.delete();
    },
    async list() {
      const d = new Directory(Paths.document, ...segments);
      if (!d.exists) return [];
      const out: string[] = [];
      for (const e of d.list()) if (e instanceof File) out.push(e.name);
      return out;
    },
  };
}

/** Uris of the files in a directory below `Paths.document` ([] when it does not exist). */
export function listDocumentFiles(...segments: string[]): string[] {
  const d = new Directory(Paths.document, ...segments);
  if (!d.exists) return [];
  const out: string[] = [];
  for (const e of d.list()) if (e instanceof File) out.push(e.uri);
  return out;
}
