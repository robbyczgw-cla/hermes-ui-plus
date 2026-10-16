#!/usr/bin/env python3
"""Replace entries of an APK (zip) without touching any other entry (scripts/build-apk-fast.sh).

  apk_swap.py swap BASE OUT NAME=FILE [NAME=FILE ...]
      writes OUT = BASE with the named entries' contents replaced. Every other entry is copied byte for byte (raw
      compressed data, same method, same timestamps); each replaced entry keeps its compression method. Only existing
      entries can be replaced (a JS change that needs a NEW entry is no JS-only change: the caller builds in full).
      JAR signature files (META-INF/*.SF|RSA|DSA|EC, META-INF/MANIFEST.MF) and the APK signing block are dropped: the
      caller runs zipalign + apksigner on OUT. OUT is re-read and checked (CRC of every entry, unchanged entries equal
      to BASE, replaced entries equal to their files).
  apk_swap.py compare A B
      prints the entries whose content differs (size / CRC), ignoring signature files; exit 0 when there are none.
"""
import re
import struct
import sys
import zipfile
import zlib

SIG = re.compile(r'^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$')


def _dos(dt):
    y, mo, d, h, mi, s = dt
    return (h << 11) | (mi << 5) | (s // 2), ((max(y, 1980) - 1980) << 9) | (mo << 5) | d


def _raw(f, info):
    """the stored (possibly compressed) bytes of one entry, read through its local header"""
    f.seek(info.header_offset)
    head = f.read(30)
    if head[:4] != b'PK\x03\x04':
        raise ValueError(f'bad local header for {info.filename}')
    n, m = struct.unpack('<HH', head[26:30])
    f.seek(info.header_offset + 30 + n + m)
    data = f.read(info.compress_size)
    if len(data) != info.compress_size:
        raise ValueError(f'truncated entry {info.filename}')
    return data


def _entries(z):
    infos = z.infolist()
    names = [i.filename for i in infos]
    if len(set(names)) != len(names):
        raise ValueError('duplicate entry names')
    return infos


def swap(base, out, repl):
    with zipfile.ZipFile(base) as z, open(base, 'rb') as f:
        infos = _entries(z)
        names = {i.filename for i in infos}
        missing = sorted(set(repl) - names)
        if missing:
            raise ValueError(f'not in the base APK (no JS-only change): {", ".join(missing)}')
        central = []
        with open(out, 'wb') as o:
            for i in infos:
                if SIG.match(i.filename):
                    continue
                if i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValueError(f'unsupported compression {i.compress_type} for {i.filename}')
                if i.filename in repl:
                    raw = repl[i.filename]
                    crc, usize = zlib.crc32(raw) & 0xFFFFFFFF, len(raw)
                    if i.compress_type == zipfile.ZIP_DEFLATED:
                        c = zlib.compressobj(9, zlib.DEFLATED, -15)
                        data = c.compress(raw) + c.flush()
                    else:
                        data = raw
                else:
                    data, crc, usize = _raw(f, i), i.CRC, i.file_size
                if usize >= 0xFFFFFFFF or len(data) >= 0xFFFFFFFF or o.tell() >= 0xFFFFFFFF:
                    raise ValueError('zip64 is not supported')
                name = i.filename.encode('utf-8')
                flags = (i.flag_bits & ~0x08) | (0x800 if any(b > 127 for b in name) else 0)
                t, d = _dos(i.date_time)
                off = o.tell()
                o.write(struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, flags, i.compress_type, t, d, crc, len(data), usize, len(name), 0))
                o.write(name)
                o.write(data)
                central.append(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, (i.create_system << 8) | 20, 20, flags,
                                           i.compress_type, t, d, crc, len(data), usize, len(name), 0, 0, 0,
                                           i.internal_attr, i.external_attr, off) + name)
            start = o.tell()
            for c in central:
                o.write(c)
            o.write(struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(central), len(central), o.tell() - start, start, 0))
    verify(base, out, repl)


def verify(base, out, repl):
    with zipfile.ZipFile(base) as zb, zipfile.ZipFile(out) as zo:
        bad = zo.testzip()
        if bad:
            raise ValueError(f'CRC error in {bad}')
        b = {i.filename: i for i in zb.infolist() if not SIG.match(i.filename)}
        o = {i.filename: i for i in zo.infolist()}
        if set(b) != set(o):
            raise ValueError('entry set changed')
        for n, i in o.items():
            if n in repl:
                if zo.read(n) != repl[n]:
                    raise ValueError(f'{n}: replaced content does not read back')
            elif (i.CRC, i.file_size, i.compress_type) != (b[n].CRC, b[n].file_size, b[n].compress_type):
                raise ValueError(f'{n}: changed although it was not replaced')


def compare(a, b):
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        ea = {i.filename: (i.CRC, i.file_size) for i in za.infolist() if not SIG.match(i.filename)}
        eb = {i.filename: (i.CRC, i.file_size) for i in zb.infolist() if not SIG.match(i.filename)}
    diff = sorted(n for n in set(ea) | set(eb) if ea.get(n) != eb.get(n))
    for n in diff:
        print(f'{n}: {"only in B" if n not in ea else "only in A" if n not in eb else "differs"}')
    print(f'{len(diff)} differing entr{"y" if len(diff) == 1 else "ies"} of {len(set(ea) | set(eb))}')
    return 0 if not diff else 1


def main(argv):
    if len(argv) >= 4 and argv[0] == 'swap':
        repl = {}
        for arg in argv[3:]:
            name, sep, path = arg.partition('=')
            if not sep or not name or not path:
                raise SystemExit(f'bad replacement {arg!r} (NAME=FILE)')
            with open(path, 'rb') as fh:
                repl[name] = fh.read()
        swap(argv[1], argv[2], repl)
        return 0
    if len(argv) == 3 and argv[0] == 'compare':
        return compare(argv[1], argv[2])
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as e:
        print(f'apk_swap: {e}', file=sys.stderr)
        sys.exit(1)
