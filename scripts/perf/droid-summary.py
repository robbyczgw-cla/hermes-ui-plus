#!/usr/bin/env python3
"""droid-summary.py RESULTS.jsonl [--base NAME]: Markdown tables of scripts/perf/droid.py runs.

Per scenario: one row per build with the median (and min-max) over its runs, then the change of every other build
against the baseline (the first build in the file, or --base). Emulator numbers are relative: compare builds of one
series only (same host, same session, alternating runs).
"""
import json, statistics as st, sys

METRICS = {
    'turn': [
        ('req', 'req_ms', 'ms Send tap → request at the mock (clock offset corrected)'),
        ('chunk', 'chunk_ms', 'ms Send tap → mock writes the first content chunk'),
        ('persisted', 'probe/marks/persisted', 'ms turn start → user message written (durable send)'),
        ('request', 'probe/marks/request', 'ms turn start → fetch starts'),
        ('headers', 'probe/marks/headers', 'ms turn start → response headers'),
        ('firstDelta', 'probe/firstDelta', 'ms turn start → first text delta in JS'),
        ('firstText', 'probe/firstText', 'ms turn start → first text on screen'),
        ('final', 'probe/final', 'ms send → final render'),
        ('tail', 'probe/renderTail', 'ms last delta → final render'),
        ('commits', 'probe/commits', 'commits of the streaming answer'),
        ('lag p50', 'probe/commitLag/p50', 'ms flush → commit (median)'),
        ('lag p95', 'probe/commitLag/p95', 'ms flush → commit (p95)'),
        ('js dropped', 'probe/js/dropped', 'JS vsyncs missed'),
        ('js long50', 'probe/js/long50', 'JS gaps >= 50 ms'),
        ('js blocked', 'probe/js/blockedMs', 'ms JS busy beyond the frame budget'),
        ('js maxGap', 'probe/js/maxGap', 'ms longest JS gap'),
        ('render', 'probe/spans/answer.render+commit/sum', ''),
        ('gc ms', 'probe/hermes/gcMs', 'Hermes GC time'),
        ('alloc MB', 'probe/hermes/allocMB', 'Hermes allocation'),
        ('ui p90', 'gfx/p90', 'ms UI/RenderThread frame p90'),
        ('ui p99', 'gfx/p99', 'ms frame p99'),
        ('jank %', 'gfx/jank_pct', 'gfxinfo janky frames'),
        ('pss MB', 'mem/pss_kb', 'total PSS after the stream'),
    ],
    'scroll': [
        ('open ms', 'open/commitMs', 'render+commit of the transcript'),
        ('open blocked', 'open/js/blockedMs', 'ms JS busy, 3 s after open'),
        ('open count', 'open/count', 'messages in the list'),
        ('js dropped', 'js/dropped', 'JS vsyncs missed while flinging'),
        ('js long50', 'js/long50', ''),
        ('js blocked', 'js/blockedMs', ''),
        ('ui p50', 'gfx/p50', ''),
        ('ui p90', 'gfx/p90', ''),
        ('ui p99', 'gfx/p99', ''),
        ('jank %', 'gfx/jank_pct', ''),
        ('pss MB', 'mem/pss_kb', 'total PSS with the big chat open'),
    ],
}
SPANS = ('stream.chunk', 'state.update', 'segments', 'md.parse', 'answer.render+commit', 'save', 'save.json')


def get(r, path):
    v = r
    for k in path.split('/'):
        v = v.get(k) if isinstance(v, dict) else None
    if isinstance(v, (int, float)) and path.endswith('_kb'):
        v = v / 1024
    return v


def fmt(x):
    if x is None:
        return '–'
    return f'{x:.0f}' if abs(x) >= 100 else f'{x:.1f}'


def main():
    args = sys.argv[1:]
    base = None
    if '--base' in args:
        i = args.index('--base')
        base = args[i + 1]
        del args[i:i + 2]
    rows = [json.loads(line) for line in open(args[0]) if line.strip()]
    builds = []
    for r in rows:
        if r['build'] not in builds:
            builds.append(r['build'])
    base = base or builds[0]
    errors = [r for r in rows if r.get('scen') == 'error' or r.get('error')]
    print(f'# Perf summary ({len(rows)} records, builds {", ".join(builds)}, baseline {base})\n')
    for scen in ('real', 'stress', 'huge', 'history', 'scroll'):
        rs = [r for r in rows if r.get('scen') == scen and not r.get('error')]
        if not rs:
            continue
        ms = METRICS['scroll' if scen == 'scroll' else 'turn']
        print(f'## {scen}\n')
        print('| build | n | ' + ' | '.join(m[0] for m in ms) + ' |')
        print('|---|---|' + '---|' * len(ms))
        med = {}
        for b in builds:
            br = [r for r in rs if r['build'] == b]
            if not br:
                continue
            cells = []
            for name, path, _ in ms:
                vals = [v for v in (get(r, path) for r in br) if isinstance(v, (int, float))]
                m = st.median(vals) if vals else None
                med[(b, name)] = m
                cells.append(fmt(m) + (f' ({fmt(min(vals))}–{fmt(max(vals))})' if len(vals) > 1 else ''))
            print(f'| {b} | {len(br)} | ' + ' | '.join(cells) + ' |')
        for b in builds:
            if b == base or (b, ms[0][0]) not in med or (base, ms[0][0]) not in med:
                continue
            cells = []
            for name, _, _ in ms:
                a, c = med.get((base, name)), med.get((b, name))
                cells.append('–' if a in (None, 0) or c is None else f'{(c - a) / a * 100:+.0f}%')
            print(f'| {b} vs {base} | | ' + ' | '.join(cells) + ' |')
        if scen != 'scroll':
            print('\nJS sections (probe spans, sum ms per turn, median over runs):\n')
            print('| build | ' + ' | '.join(SPANS) + ' |')
            print('|---|' + '---|' * len(SPANS))
            for b in builds:
                br = [r for r in rs if r['build'] == b]
                cells = []
                for sp in SPANS:
                    vals = [((r.get('probe') or {}).get('spans') or {}).get(sp, {}).get('sum') for r in br]
                    vals = [v for v in vals if isinstance(v, (int, float))]
                    cells.append(fmt(st.median(vals)) if vals else '–')
                if br:
                    print(f'| {b} | ' + ' | '.join(cells) + ' |')
            prof = {}
            for r in rs:
                for k, v in ((r.get('probe') or {}).get('prof') or {}).items():
                    prof.setdefault((r['build'], k), []).append(v.get('sum', 0))
            if prof:
                ids = sorted({k for _, k in prof})
                print('\nReact render time (level-2 Profiler, sum ms per turn, median):\n')
                print('| build | ' + ' | '.join(ids) + ' |')
                print('|---|' + '---|' * len(ids))
                for b in builds:
                    print(f'| {b} | ' + ' | '.join(fmt(st.median(prof[(b, k)])) if (b, k) in prof else '–' for k in ids) + ' |')
        cpus = [r for r in rs if r.get('cpu')]
        if cpus:
            names = {}
            for r in cpus:
                for k, v in r['cpu'].items():
                    names[k] = names.get(k, 0) + v
            top = [k for k, _ in sorted(names.items(), key=lambda kv: -kv[1])[:7]]
            print('\nCPU ms per app thread (/proc task utime+stime, median over runs; mqt_v_js = JS thread, main = UI thread):\n')
            print('| build | ' + ' | '.join(top) + ' |')
            print('|---|' + '---|' * len(top))
            for b in builds:
                br = [r for r in cpus if r['build'] == b]
                if br:
                    print(f'| {b} | ' + ' | '.join(fmt(st.median([r['cpu'].get(k, 0) for r in br])) for k in top) + ' |')
        longs = [(r['build'], x) for r in rs for x in (r.get('long') or [])]
        if longs:
            print('\nJS long tasks (gaps >= 50 ms) by what ran in that frame (top section / render; "gc" = a Hermes GC in it; '
                  '"?" = nothing instrumented), count and median gap per run:\n')
            for b in builds:
                runs = len([r for r in rs if r['build'] == b]) or 1
                cause = {}
                for bb, x in longs:
                    if bb != b:
                        continue
                    top = (x.get('top') or [])
                    k = top[0][0] if top and top[0][1] >= 5 else '?'
                    if x.get('gcs'):
                        k += ' + gc'
                    cause.setdefault(k, []).append(x['gap'])
                if cause:
                    items = sorted(cause.items(), key=lambda kv: -len(kv[1]))
                    print(f'- {b}: ' + '; '.join(f'{k} {len(v) / runs:.1f}× ({st.median(v):.0f} ms)' for k, v in items))
        if scen == 'scroll':
            print('\nJS sections + React render time while flinging (sum ms over the scroll windows, median over runs):\n')
            for b in builds:
                agg = {}
                for r in [r for r in rs if r['build'] == b]:
                    for k, v in ((r.get('js') or {}).get('sums') or {}).items():
                        agg.setdefault(k, []).append(v)
                if agg:
                    top = sorted(((k, st.median(v)) for k, v in agg.items()), key=lambda kv: -kv[1])[:8]
                    print(f'- {b}: ' + ', '.join(f'{k} {fmt(v)}' for k, v in top))
        print()
    if errors:
        print('## errors\n')
        for r in errors:
            print(f"- {r['build']}-{r['it']} {r.get('scen')}: {r.get('error')}")
    print('\nColumns: ' + '; '.join(f'{n} = {d}' for n, _, d in METRICS['turn'] if d) + '.')


if __name__ == '__main__':
    main()
