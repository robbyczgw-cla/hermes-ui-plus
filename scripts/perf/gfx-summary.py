#!/usr/bin/env python3
# gfx-summary.py OUTDIR – per-stream table + per-build medians of scripts/perf/stream-ab.sh runs
# (OUTDIR/<build>-<iteration>/s<n>.{gfx,t0,warn}; fps = frames / time between gfxinfo reset and dump).
import glob, os, re, statistics as st, sys
D = sys.argv[1]
rows = []
for gfx in sorted(glob.glob(f'{D}/*-[0-9]*/s*.gfx')):
    run = os.path.basename(os.path.dirname(gfx)); s = os.path.basename(gfx)[:-4]
    b, it = run.rsplit('-', 1)
    txt = open(gfx).read()
    t1 = float(txt.splitlines()[0]); t0 = float(open(gfx[:-4] + '.t0').read().split()[-1])
    g = lambda rx: (re.search(rx, txt) or [None, 'nan'])[1]
    r = dict(build=b, it=it, s=s, dur=t1 - t0, frames=int(g(r'Total frames rendered: (\d+)')),
             jank=float(g(r'Janky frames: \d+ \(([\d.]+)%\)')), jank_legacy=float(g(r'Janky frames \(legacy\): \d+ \(([\d.]+)%\)')),
             p50=int(g(r'\n50th percentile: (\d+)ms')), p90=int(g(r'\n90th percentile: (\d+)ms')), p95=int(g(r'\n95th percentile: (\d+)ms')), p99=int(g(r'\n99th percentile: (\d+)ms')),
             slow_ui=int(g(r'Number Slow UI thread: (\d+)')), slow_draw=int(g(r'Number Slow issue draw commands: (\d+)')), missed=int(g(r'Number Frame deadline missed: (\d+)')),
             warn=int(open(gfx[:-4] + '.warn').read().strip() or 0))
    r['fps'] = r['frames'] / r['dur']
    rows.append(r)
cols = ['build', 'it', 's', 'frames', 'fps', 'jank', 'jank_legacy', 'p50', 'p90', 'p95', 'p99', 'slow_ui', 'slow_draw', 'warn']
fmt = lambda v: f'{v:.1f}' if isinstance(v, float) else str(v)
print('| ' + ' | '.join(cols) + ' |'); print('|' + '---|' * len(cols))
for r in rows: print('| ' + ' | '.join(fmt(r[c]) for c in cols) + ' |')
print()
for b in sorted({r['build'] for r in rows}):
    for sel in ('all', 's1', 's2', 's3'):
        rs = [r for r in rows if r['build'] == b and (sel == 'all' or r['s'] == sel)]
        if not rs: continue
        med = {c: st.median([r[c] for r in rs]) for c in cols[3:]}
        print(f'{b} {sel:3} n={len(rs)} median: ' + ', '.join(f'{c}={fmt(float(med[c]))}' for c in cols[3:]))
