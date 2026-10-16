#!/usr/bin/env python3
"""Android streaming perf runs (run by scripts/perf/droid.sh, docs/PERF.md).

  droid.py --out DIR [--runs 3] [--scenarios real,stress,history] NAME=APK [NAME=APK ...]

Needs a booted emulator ($ANDROID_SERIAL, own adb server) and scripts/e2e/mock.mjs on 127.0.0.1:$E2E_MOCK_PORT. The
APKs must be perf builds (EXPO_PUBLIC_HUI_PERF=1|2): the in-app probe (app/src/perf/probe.ts) writes `HUIPERF {json}`
lines to logcat. Builds alternate per run (A B A B …), each run is a clean install + pairing, then the scenarios:
  real     new chat, the ~13k-char perf answer (Markdown, tables, code, hui blocks) at ~80 tok/s
  stress   new chat, the same answer as fast as the socket delivers it
  huge     new chat, ~39k chars (the answer three times) at the stress rate: costs that grow with the answer length
  history  a 2400-row Hermes session (mock /__e2e/seed) opened from the drawer: open time, a fling up/down through
           the transcript (JS frames + gfxinfo), then the perfreal answer streamed into that big chat
Per scenario: the probe's turn/open record, `dumpsys gfxinfo` over the stream (reset at the Send tap), framestats,
`dumpsys meminfo` after it. Everything lands in DIR/results.jsonl (+ raw files under DIR/<build>-<run>/).
"""
import argparse, json, os, re, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'e2e'))
import device as d  # noqa: E402
import suite as s  # noqa: E402  (selectors, send, mock helpers; reads E2E_MOCK_PORT)
from report import Fail  # noqa: E402

PKG, S = s.PKG, s.S
HISTORY_ROWS = int(os.environ.get('PERF_HISTORY_ROWS', '2400'))
TRACE = os.environ.get('PERF_TRACE') == '1'  # perfetto trace (sched + view/gfx atrace) of each `real` stream


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def device_ms():
    return int(float(d.sh('date +%s.%N').strip()) * 1000)


def clock_offset():
    """host ms - device ms (the mock's timestamps are host time): best of 5 adb round trips, midpoint"""
    best = None
    for _ in range(5):
        a = time.time() * 1000
        dev = device_ms()
        b = time.time() * 1000
        if best is None or b - a < best[0]:
            best = (b - a, (a + b) / 2 - dev)
    return round(best[1])


def perf_records():
    out = d.adb('logcat', '-d', '-v', 'raw', '-s', 'ReactNativeJS:I', timeout=30)
    recs = []
    for line in out.splitlines():
        i = line.find('HUIPERF ')
        if i >= 0:
            try:
                recs.append(json.loads(line[i + 8:]))
            except ValueError:
                pass
    return recs


def wait_record(kind, timeout, after_ms=0):
    end = time.time() + timeout
    while time.time() < end:
        hits = [r for r in perf_records() if r.get('k') == kind and r.get('at', 0) >= after_ms]
        if hits:
            return hits[-1]
        time.sleep(1.0)
    return None


def meminfo():
    txt = d.sh(f'dumpsys meminfo {PKG}', timeout=60)
    g = lambda rx: int(m[1]) if (m := re.search(rx, txt)) else None  # noqa: E731
    return dict(pss_kb=g(r'TOTAL PSS:\s+(\d+)') or g(r'\n\s*TOTAL\s+(\d+)'), java_kb=g(r'Java Heap:\s+(\d+)'),
                native_kb=g(r'Native Heap:\s+(\d+)'), graphics_kb=g(r'Graphics:\s+(\d+)'), code_kb=g(r'Code:\s+(\d+)'))


def thread_cpu():
    """{thread name: CPU ms} of the app process (utime + stime of every task; 10 ms ticks)"""
    pid = d.sh(f'pidof {PKG}').strip().split(' ')[0]
    if not pid:
        return {}
    out = d.sh(f"cd /proc/{pid}/task && for t in *; do printf '%s\\t' \"$(cat $t/comm)\"; sed 's/.*) //' $t/stat | cut -d' ' -f12,13; done")
    cpu = {}
    for line in out.splitlines():
        name, _, ticks = line.partition('\t')
        try:
            u, st_ = map(int, ticks.split())
        except ValueError:
            continue
        name = 'main' if PKG.startswith(name) or name.endswith('.app') else name
        name = re.sub(r'[-#]?\d+$', '', name) or name  # pools: "pool-3-thread-2" → per-pool sums
        cpu[name] = cpu.get(name, 0) + (u + st_) * 10
    return cpu


def cpu_delta(a, b):
    dd = {k: b.get(k, 0) - a.get(k, 0) for k in b}
    return dict(sorted(((k, v) for k, v in dd.items() if v > 0), key=lambda kv: -kv[1])[:10])


TRACE_CFG = '''buffers { size_kb: 65536 fill_policy: RING_BUFFER }
data_sources { config { name: "linux.process_stats" target_buffer: 0 } }
data_sources { config { name: "linux.ftrace" ftrace_config {
  ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_waking" ftrace_events: "power/cpu_frequency"
  atrace_categories: "view" atrace_categories: "gfx" atrace_categories: "input" atrace_categories: "dalvik"
  atrace_categories: "am" atrace_categories: "wm" atrace_categories: "res" atrace_apps: "*" } } }
duration_ms: DURATION
'''


def gfx(txt):
    g = lambda rx: (m[1] if (m := re.search(rx, txt)) else None)  # noqa: E731
    num = lambda rx: float(v) if (v := g(rx)) is not None else None  # noqa: E731
    return dict(frames=num(r'Total frames rendered: (\d+)'), jank_pct=num(r'Janky frames: \d+ \(([\d.]+)%\)'),
                p50=num(r'\n50th percentile: (\d+)ms'), p90=num(r'\n90th percentile: (\d+)ms'), p95=num(r'\n95th percentile: (\d+)ms'),
                p99=num(r'\n99th percentile: (\d+)ms'), slow_ui=num(r'Number Slow UI thread: (\d+)'),
                slow_draw=num(r'Number Slow issue draw commands: (\d+)'), missed_vsync=num(r'Number Missed Vsync: (\d+)'))


class Run:
    def __init__(self, out, build, apk, it):
        self.build, self.apk, self.it = build, apk, it
        self.dir = os.path.join(out, f'{build}-{it}')
        os.makedirs(self.dir, exist_ok=True)
        self.results = []

    def save(self, name, txt):
        with open(os.path.join(self.dir, name), 'w') as f:
            f.write(txt)

    def install_and_pair(self):
        d.adb('uninstall', PKG, timeout=60)
        out = d.adb('install', '-r', '-t', self.apk, timeout=240)
        if 'Success' not in out:
            raise Fail(f'adb install: {out.strip()[-200:]}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        d.sh('logcat -c')
        # the big Hermes session exists before the app's first session sync (history scenario)
        self.history_title = s.mock('/__e2e/seed', {'messages': HISTORY_ROWS})['title']
        code = s.mock('/__e2e/pair-code', {})['code']
        link = f'{s.SCHEME}://pair?' + urllib.parse.urlencode({'u': s.DEVICE_MOCK, 'c': code, 'n': 'Perf'})
        d.adb('shell', 'read l; am start -a android.intent.action.VIEW -d "$l" ' + PKG, inp=link + '\n', timeout=30)
        end = time.time() + 60
        while time.time() < end:
            ns = d.dump()
            if d.find(S['input'], ns) and not any(d.find(S[k], ns) for k in ('connect', 'consent', 'start_chat')):
                break
            for key in ('connect', 'consent', 'later', 'start_chat'):
                n = d.find(S[key], ns)
                if n and n.enabled:
                    d.tap_xy(n.cx, n.cy)
                    time.sleep(1.0)
                    break
            else:
                time.sleep(0.7)
        else:
            raise Fail('onboarding did not reach the chat')
        start = wait_record('start', 20)
        if not start:
            raise Fail('no HUIPERF start record: not a perf build (EXPO_PUBLIC_HUI_PERF) or console output missing')
        self.save('hermes-start.json', json.dumps(start))
        time.sleep(2)

    def dismiss_consent(self):
        n = d.find(S['consent'])
        if n:
            d.tap_xy(n.cx, n.cy)
            time.sleep(1)

    def stream(self, scen, text, extra=None):
        """send `text`, measure until the probe's turn record (the final render) is there"""
        self.dismiss_consent()
        d.sh('logcat -c')
        if not d.tap(S['input'], 10):
            raise Fail('composer input not found')
        for _ in range(8):
            time.sleep(0.35)
            if d.keyboard_shown():
                break
        d.type_text(text)
        if not d.wait('text:^' + re.escape(text) + '$', 6):
            raise Fail(f'typed text "{text}" not in the composer')
        d.hide_keyboard()
        btn = d.wait(S['send'], 6)
        if not btn:
            raise Fail('Send button not found')
        cpu0 = thread_cpu()
        trace = TRACE and scen == 'real'
        if trace:
            d.sh('rm -f /data/misc/perfetto-traces/hui.pftrace')
            cfg = TRACE_CFG.replace('DURATION', '52000')
            # the config on stdin: SELinux keeps perfetto from reading files in /data/local/tmp
            out = d.adb('shell', 'perfetto --background --txt -c - -o /data/misc/perfetto-traces/hui.pftrace 2>&1', inp=cfg, timeout=30)
            self.save('perfetto-start.txt', out)
            time.sleep(1.5)
        # the Send tap and the gfxinfo reset in one shell call: the frame window starts with the tap
        t_tap = float(d.sh(f'input tap {btn.cx} {btn.cy}; dumpsys gfxinfo {PKG} reset >/dev/null; date +%s.%N').strip().split()[-1])
        turn = s.wait_turn(text, lambda t: t['state'] == 'ended', 240, f'{scen} stream end')
        rec = wait_record('turn', 30)
        cpu = cpu_delta(cpu0, thread_cpu())
        if trace:
            time.sleep(8)  # the trace ends by itself (duration_ms)
            for _ in range(20):
                if not d.sh('pidof perfetto').strip():
                    break
                time.sleep(1)
            self.save('perfetto-end.txt', d.sh('ls -la /data/misc/perfetto-traces/; getprop persist.traced.enable; ps -A | grep -E "traced|perfetto"'))
            data = d.adb('exec-out', 'cat /data/misc/perfetto-traces/hui.pftrace', text=False, timeout=60)
            with open(os.path.join(self.dir, f'{scen}.pftrace'), 'wb') as f:
                f.write(data)
            log(f'{self.build}-{self.it} trace {len(data) // 1024} KB')
        g = d.sh(f'dumpsys gfxinfo {PKG}', timeout=60)
        self.save(f'{scen}.gfx', g)
        self.save(f'{scen}.framestats', d.sh(f'dumpsys gfxinfo {PKG} framestats', timeout=60))
        mem = meminfo()
        recs = perf_records()
        self.save(f'{scen}.perf.jsonl', '\n'.join(json.dumps(r) for r in recs))
        # time to first token, split: Send tap → request at the mock (app + network; the emulator runs on the mock
        # host's clock), mock → first delta in JS (the mock waits ~300 ms before its first chunk), → first text on screen
        off = clock_offset()
        # in device time, relative to the Send tap: request at the mock, its first content chunk written
        req_ms = round(turn['receivedAt'] - off - t_tap * 1000) if turn.get('receivedAt') else None
        chunk_ms = round(turn['firstChunkAt'] - off - t_tap * 1000) if turn.get('firstChunkAt') else None
        r = dict(build=self.build, it=self.it, scen=scen, tap=t_tap, req_ms=req_ms, chunk_ms=chunk_ms, clock_off=off, mock_ms=turn.get('endedAt', 0) - turn.get('startedAt', 0),
                 chars=len(turn.get('expected', '')), probe=rec, gfx=gfx(g), mem=mem, cpu=cpu,
                 long=[x for x in recs if x.get('k') == 'long' and x.get('turn') is not None], **(extra or {}))
        if not rec:
            r['error'] = 'no probe turn record'
        log(f'{self.build}-{self.it} {scen}: ' + summary_line(r))
        self.results.append(r)
        time.sleep(2)
        return r

    def new_chat(self):
        s.new_chat()
        time.sleep(1)

    def history(self):
        title = self.history_title
        self.dismiss_consent()
        item = None
        for _ in range(2):  # the drawer lists Hermes sessions after the app's sync: reopen it once
            if not d.tap(S['chats'], 8):
                raise Fail('Chats button not found')
            item = d.wait('text:^' + re.escape(title) + '$', 20)
            if item:
                break
            d.sh('input keyevent 4')
            time.sleep(3)
        if not item:
            raise Fail(f'seeded session "{title}" not in the drawer')
        d.sh('logcat -c')
        t0 = device_ms()
        d.tap_xy(item.cx, item.cy)
        rec = wait_record('open', 40, after_ms=t0)
        while rec and rec.get('count', 0) < 100:  # the placeholder / a partial first page: wait for the full transcript
            rec2 = wait_record('open', 15, after_ms=rec['at'] + 1)
            if not rec2 or rec2 is rec or rec2.get('at') == rec.get('at'):
                break
            rec = rec2
        time.sleep(2)
        mem_open = meminfo()
        # fling up through the transcript and back (inverted list: a downward swipe shows older messages)
        w, h = d.screen_size()
        x = w // 2
        d.sh(f'dumpsys gfxinfo {PKG} reset >/dev/null')
        cpu0 = thread_cpu()
        s0 = device_ms()
        for _ in range(8):
            d.swipe(x, int(h * 0.30), x, int(h * 0.80), 120)
            time.sleep(0.6)
        for _ in range(8):
            d.swipe(x, int(h * 0.80), x, int(h * 0.30), 120)
            time.sleep(0.6)
        time.sleep(1.5)
        s1 = device_ms()
        cpu = cpu_delta(cpu0, thread_cpu())
        g = d.sh(f'dumpsys gfxinfo {PKG}', timeout=60)
        self.save('scroll.gfx', g)
        time.sleep(2.5)  # the probe's 2 s JS window that covers the end
        recs = perf_records()
        js = [r for r in recs if r.get('k') == 'js' and r.get('at', 0) > s0 and r.get('from', 0) < s1]
        longs = [r for r in recs if r.get('k') == 'long' and s0 <= r.get('at', 0) <= s1 + 500]
        self.save('history-open.perf.jsonl', '\n'.join(json.dumps(r) for r in perf_records()))
        scroll = dict(build=self.build, it=self.it, scen='scroll', open=rec, mem=mem_open, gfx=gfx(g), js=merge_js(js), ms=s1 - s0, long=longs, cpu=cpu)
        log(f'{self.build}-{self.it} open: {json.dumps(rec)[:300]}')
        log(f'{self.build}-{self.it} scroll: js={scroll["js"]} gfx p50/p90/p99={scroll["gfx"]["p50"]}/{scroll["gfx"]["p90"]}/{scroll["gfx"]["p99"]} jank={scroll["gfx"]["jank_pct"]}')
        self.results.append(scroll)
        # scroll back to the newest message before the stream (jump button or a few flings)
        jump = d.find('desc:^(Scroll to the newest message|New answer)')
        if jump:
            d.tap_xy(jump.cx, jump.cy)
            time.sleep(1)
        self.stream('history', f'perfreal history {self.build} {self.it}', extra=dict(rows=HISTORY_ROWS))


def merge_js(ws):
    if not ws:
        return None
    keys = ('frames', 'ms', 'dropped', 'long50', 'long100', 'blockedMs')
    m = {k: sum(w['js'].get(k, 0) for w in ws) for k in keys}
    m['maxGap'] = max(w['js'].get('maxGap', 0) for w in ws)
    m['fps'] = round(m['frames'] * 1000 / m['ms'], 1) if m['ms'] else 0
    m['windows'] = len(ws)
    sums = {}
    for w in ws:
        for k, v in (w.get('sums') or {}).items():
            sums[k] = round(sums.get(k, 0) + v, 1)
    m['sums'] = dict(sorted(sums.items(), key=lambda kv: -kv[1]))
    return m


def summary_line(r):
    p = r.get('probe') or {}
    js = p.get('js') or {}
    g = r.get('gfx') or {}
    return (f"req={r.get('req_ms')} firstText={p.get('firstText')} final={p.get('final')} tail={p.get('renderTail')} commits={p.get('commits')} "
            f"jsDropped={js.get('dropped')} long50={js.get('long50')} blocked={js.get('blockedMs')} maxGap={js.get('maxGap')} "
            f"gfx p50/p90/p99={g.get('p50')}/{g.get('p90')}/{g.get('p99')} jank={g.get('jank_pct')} pss={r['mem'].get('pss_kb')}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--runs', type=int, default=3)
    p.add_argument('--scenarios', default='real,stress,huge,history')
    p.add_argument('builds', nargs='+', help='NAME=APK')
    a = p.parse_args()
    builds = [b.split('=', 1) for b in a.builds]
    scen = [x for x in a.scenarios.split(',') if x]
    os.makedirs(a.out, exist_ok=True)
    # device setup like the smoke suite: no system animations, light mode, screen on, portrait, big logcat buffer
    d.adb('root', timeout=30)
    time.sleep(2)
    d.adb('wait-for-device', timeout=60)
    for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
        d.sh(f'settings put global {k} 0' if k != 'animator_duration_scale' else f'settings put global {k} 1')
    d.sh('cmd uimode night no; settings put system font_scale 1.0')
    d.sh('svc power stayon true; wm dismiss-keyguard; input keyevent 82')
    d.sh('settings put system accelerometer_rotation 0; settings put system user_rotation 0')
    d.sh('logcat -G 16M; logcat -c')
    res_path = os.path.join(a.out, 'results.jsonl')
    failures = 0
    try:
        for it in range(1, a.runs + 1):
            for name, apk in builds:
                load = open('/proc/loadavg').read().split()[:3]
                log(f'== {name} run {it} ({os.path.basename(apk)}), host load {" ".join(load)}')
                r = Run(a.out, name, apk, it)
                try:
                    r.install_and_pair()
                    if 'real' in scen:
                        r.new_chat()
                        r.stream('real', f'perfreal {name} {it}')
                    if 'stress' in scen:
                        r.new_chat()
                        r.stream('stress', f'perfstress {name} {it}')
                    if 'huge' in scen:
                        r.new_chat()
                        r.stream('huge', f'perfhuge {name} {it}')
                    if 'history' in scen:
                        r.history()
                except Exception as e:  # one failed run must not end the series
                    failures += 1
                    log(f'!! {name}-{it} failed: {e}')
                    r.save('fail-ui.txt', '\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click))
                    try:
                        d.screenshot_png(os.path.join(r.dir, 'fail.png'))
                    except Exception:
                        pass
                    r.results.append(dict(build=name, it=it, scen='error', error=str(e)))
                r.save('crash.txt', d.adb('logcat', '-d', '-b', 'crash', timeout=30))
                with open(res_path, 'a') as f:
                    for x in r.results:
                        x['load'] = load
                        f.write(json.dumps(x) + '\n')
    finally:
        d.sh('svc power stayon false; settings put system accelerometer_rotation 1')
        for k in ('window_animation_scale', 'transition_animation_scale'):
            d.sh(f'settings put global {k} 1')
        d.adb('uninstall', PKG, timeout=60)
    log(f'done, {failures} failed runs, results {res_path}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
