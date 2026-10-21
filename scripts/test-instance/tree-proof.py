#!/usr/bin/env python3
"""Proof of a directory tree for the test instance backup/restore (hold.sh): one line per entry
(path, mode, owner, hard links, content hash or link target), sorted by name. No mtimes. Never follows symlinks.
  tree-proof.py manifest DIR            the lines
  tree-proof.py digest DIR              sha256 over the lines, and the file count: {"files": N, "tree_sha256": "..."}
  tree-proof.py diff A.manifest B.manifest   the paths that differ (exit 1 if any)
"""
import hashlib, json, os, stat, sys


def lines(root):
    def walk(d, rel):
        try:
            names = sorted(os.listdir(d))
        except OSError as e:
            yield f'{rel or "."}\tLISTERR {e.errno}'
            return
        for n in names:
            p, r = os.path.join(d, n), os.path.join(rel, n)
            try:
                st = os.lstat(p)
            except OSError:
                yield f'{r}\tSTATERR'  # vanished while walking: a writer is active
                continue
            m = st.st_mode
            if stat.S_ISLNK(m):
                v = '->' + os.readlink(p)
            elif stat.S_ISREG(m):
                h = hashlib.sha256()
                try:
                    with open(p, 'rb') as f:
                        for chunk in iter(lambda: f.read(1 << 20), b''):
                            h.update(chunk)
                    v = h.hexdigest()
                except OSError as e:
                    v = f'READERR {e.errno}'
            else:
                v = stat.filemode(m)[0]
            yield f'{r}\t{oct(m)}\t{st.st_uid}:{st.st_gid}\t{st.st_nlink if stat.S_ISREG(m) else ""}\t{v}'
            if stat.S_ISDIR(m):
                yield from walk(p, r)
    return walk(root, '')


def main(argv):
    if len(argv) == 3 and argv[1] == 'manifest':
        for l in lines(argv[2]):
            print(l)
    elif len(argv) == 3 and argv[1] == 'digest':
        h, n = hashlib.sha256(), 0
        for l in lines(argv[2]):
            h.update(l.encode() + b'\n')
            n += 1
        print(json.dumps({'files': n, 'tree_sha256': h.hexdigest()}))
    elif len(argv) == 4 and argv[1] == 'diff':
        a, b = ({l.split('\t', 1)[0]: l for l in open(f).read().splitlines()} for f in argv[2:4])
        bad = sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))
        for k in bad:
            print(('changed ' if k in a and k in b else 'only in first ' if k in a else 'only in second ') + k)
        return 1 if bad else 0
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
