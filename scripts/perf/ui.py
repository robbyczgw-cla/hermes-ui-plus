#!/usr/bin/env python3
# Tiny uiautomator driver for scripts/perf/stream-ab.sh (text / content-desc only, no screenshots):
#   ui.py list | ui.py tap REGEX [timeout_s] | ui.py has REGEX [timeout_s] | ui.py xy REGEX [timeout_s]
# Device: $ANDROID_SERIAL (default emulator-5554).
import os, re, subprocess, sys, time, xml.etree.ElementTree as ET
ADB = ['adb', '-s', os.environ.get('ANDROID_SERIAL', 'emulator-5554')]
def nodes():
    subprocess.run(ADB + ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True)
    x = subprocess.run(ADB + ['exec-out', 'cat', '/sdcard/ui.xml'], capture_output=True).stdout.decode('utf8', 'replace')
    try: root = ET.fromstring(x)
    except ET.ParseError: return []
    out = []
    for n in root.iter('node'):
        b = re.findall(r'\d+', n.get('bounds', ''))
        if len(b) != 4: continue
        x1, y1, x2, y2 = map(int, b)
        out.append(dict(text=n.get('text', ''), desc=n.get('content-desc', ''), rid=n.get('resource-id', ''), cls=n.get('class', '').split('.')[-1], click=n.get('clickable') == 'true', cx=(x1 + x2) // 2, cy=(y1 + y2) // 2, b=(x1, y1, x2, y2)))
    return out
def find(rx, ns):
    r = re.compile(rx)
    hits = [n for n in ns if r.search(n['text']) or r.search(n['desc'])]
    # later nodes are drawn on top (modals): prefer the last clickable match
    hits.sort(key=lambda n: n['click'])
    return hits[-1] if hits else None
cmd = sys.argv[1]
if cmd == 'list':
    for n in nodes():
        if n['text'] or n['desc'] or n['click']: print(n['cls'], repr(n['text'][:50]), repr(n['desc'][:50]), 'C' if n['click'] else '', n['b'])
elif cmd in ('tap', 'has', 'xy'):
    t_end = time.time() + float(sys.argv[3] if len(sys.argv) > 3 else 15)
    while True:
        h = find(sys.argv[2], nodes())
        if h:
            if cmd == 'tap': subprocess.run(ADB + ['shell', 'input', 'tap', str(h['cx']), str(h['cy'])])
            if cmd == 'xy': print(h['cx'], h['cy']); sys.exit(0)
            print('ok', cmd, repr(h['text'] or h['desc'])[:60], h['cx'], h['cy']); sys.exit(0)
        if time.time() > t_end: print('MISS', sys.argv[2]); sys.exit(1)
        time.sleep(0.7)
