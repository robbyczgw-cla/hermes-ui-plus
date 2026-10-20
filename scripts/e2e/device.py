"""adb + uiautomator helpers for scripts/e2e/suite.py (one emulator: $ANDROID_SERIAL, adb server $ANDROID_ADB_SERVER_PORT).

Selectors match a node by resource-id (= React Native `testID`), content-desc (= `accessibilityLabel`) or text, each as
a regex; `sel('id:send|Send')` tries the testID first and the English label second, so the suite runs against builds
with and without testIDs. The app is forced to en-US (smoke.sh), so labels are stable.
"""
import os, re, shutil, struct, subprocess, time, xml.etree.ElementTree as ET

SERIAL = os.environ.get('ANDROID_SERIAL', 'emulator-5584')
ADB = ['adb', '-s', SERIAL]


def adb(*args, timeout=60, check=False, text=True, inp=None):
    r = subprocess.run(ADB + list(args), capture_output=True, timeout=timeout, text=text, input=inp)
    if check and r.returncode != 0:
        raise RuntimeError(f'adb {" ".join(args)[:80]} failed: {(r.stderr or r.stdout)[:300]}')
    return r.stdout if text else r.stdout


def sh(cmd, timeout=60):
    """`adb shell CMD` → stdout (str, \r stripped)"""
    return adb('shell', cmd, timeout=timeout).replace('\r', '')


class Node:
    __slots__ = ('text', 'desc', 'rid', 'cls', 'click', 'checked', 'enabled', 'b')

    def __init__(self, e):
        self.text, self.desc = e.get('text', ''), e.get('content-desc', '')
        self.rid = e.get('resource-id', '')
        self.cls = e.get('class', '').split('.')[-1]
        self.click = e.get('clickable') == 'true'
        self.checked = e.get('checked') == 'true'
        self.enabled = e.get('enabled') != 'false'
        x1, y1, x2, y2 = map(int, re.findall(r'-?\d+', e.get('bounds', '[0,0][0,0]')))
        self.b = (x1, y1, x2, y2)

    @property
    def cx(self): return (self.b[0] + self.b[2]) // 2

    @property
    def cy(self): return (self.b[1] + self.b[3]) // 2

    @property
    def h(self): return self.b[3] - self.b[1]

    def __repr__(self):
        return f'{self.cls}(id={self.rid!r} desc={self.desc[:40]!r} text={self.text[:40]!r} {self.b})'


def dump():
    """all nodes of the current window (uiautomator dump; ~1 s). [] while the UI is not idle-able."""
    for _ in range(3):
        out = adb('exec-out', 'uiautomator dump /dev/tty', timeout=30)
        i, j = out.find('<?xml'), out.rfind('</hierarchy>')
        if i >= 0 and j > i:
            try:
                root = ET.fromstring(out[i:j + len('</hierarchy>')])
                return [Node(e) for e in root.iter('node')]
            except ET.ParseError:
                pass
        time.sleep(0.5)
    return []


def _matcher(spec):
    """'id:send|desc:^Send$|text:^Retry$|^Retry$' → predicate; a bare alternative matches desc or text"""
    preds = []
    for part in re.split(r'\|(?=(?:id|desc|text):)', spec):
        kind, _, rx = part.partition(':') if re.match(r'^(id|desc|text):', part) else ('any', '', part)
        r = re.compile(rx)
        if kind == 'id':
            preds.append(lambda n, r=r: bool(n.rid) and bool(r.search(n.rid.split('/')[-1])))
        elif kind == 'desc':
            preds.append(lambda n, r=r: bool(r.search(n.desc)))
        elif kind == 'text':
            preds.append(lambda n, r=r: bool(r.search(n.text)))
        else:
            preds.append(lambda n, r=r: bool(r.search(n.desc)) or bool(r.search(n.text)))
    return preds


def find_all(spec, nodes=None):
    nodes = dump() if nodes is None else nodes
    for p in _matcher(spec):  # earlier alternatives win (testID before label)
        hits = [n for n in nodes if p(n)]
        if hits:
            return hits
    return []


def find(spec, nodes=None):
    hits = find_all(spec, nodes)
    if not hits:
        return None
    # later nodes are drawn on top (sheets, modals); prefer a clickable one
    clickable = [n for n in hits if n.click]
    return (clickable or hits)[-1]


def dismiss_anr(nodes=None):
    """taps "Wait" on a system "<app> isn't responding" dialog (an emulator hiccup, often the Pixel Launcher) that
    covers the app; returns the dialog title, or None if there was none"""
    nodes = dump() if nodes is None else nodes
    btn = next((n for n in nodes if n.rid == 'android:id/aerr_wait'), None)
    if btn is None:
        return None
    title = next((n.text for n in nodes if n.rid == 'android:id/alertTitle'), '?')
    tap_xy(btn.cx, btn.cy)
    time.sleep(1.0)
    ANR_DISMISSED.append(title)
    return title


ANR_DISMISSED = []  # titles of the system ANR dialogs dismissed during the run (reported per check by the suite)


def wait(spec, timeout=15.0, gone=False, interval=0.4):
    """node matching spec (or True once it is gone) within timeout, else None. A system "isn't responding" dialog
    that hides the node is dismissed ("Wait", at most twice per call) and the wait gets up to 10 s more."""
    end, anr_left = time.time() + timeout, 2
    while True:
        n = find(spec)
        if (n is None) == gone:
            return True if gone else n
        if time.time() > end:
            if not gone and anr_left and dismiss_anr():
                anr_left -= 1
                end = time.time() + min(timeout, 10.0)
                continue
            return None
        time.sleep(interval)


def wait_stable(spec, timeout=10.0, min_h=20):
    """matching nodes once two consecutive dumps show the same bounds (layout / entering animations done), else []"""
    end, prev = time.time() + timeout, None
    while time.time() < end:
        hits = find_all(spec)
        cur = [n.b for n in hits]
        if hits and cur == prev and all(n.h >= min_h for n in hits):
            return hits
        prev = cur
        time.sleep(0.3)
    return []


def tap_xy(x, y):
    sh(f'input tap {x} {y}')


def tap(spec, timeout=15.0):
    n = wait(spec, timeout)
    if n is None:
        return None
    tap_xy(n.cx, n.cy)
    return n


def screen_size():
    # "Physical size" first, then "Override size" when `wm size WxH` is set (store screenshots): the override is what shows
    ms = re.findall(r'(\d+)x(\d+)', sh('wm size'))
    return (int(ms[-1][0]), int(ms[-1][1])) if ms else (1080, 2400)


def swipe(x1, y1, x2, y2, ms=300):
    sh(f'input swipe {x1} {y1} {x2} {y2} {ms}')


def keyboard_shown():
    return 'mInputShown=true' in sh('dumpsys input_method | grep mInputShown')


def hide_keyboard():
    # BACK only while the IME is up: at the app root BACK would leave the app
    if keyboard_shown():
        sh('input keyevent 4')
        time.sleep(0.6)


def type_text(s):
    """types ASCII text into the focused field (spaces as %s)"""
    sh("input text '" + s.replace(' ', '%s').replace("'", '') + "'")


def top_activity():
    m = re.search(r'topResumedActivity=.*? ([\w.]+)/', sh('dumpsys activity activities | grep topResumedActivity'))
    return m[1] if m else ''


def screenshot_png(path):
    data = adb('exec-out', 'screencap -p', text=False, timeout=30)
    with open(path, 'wb') as f:
        f.write(data)
    return path


def png_to_jpeg(png, jpg, max_w=1080, quality=60):
    """review shots are JPEG q60, <= max_w wide (user rule): ImageMagick, else sips (macOS)"""
    for cmd in (['convert', png, '-resize', f'{max_w}x>', '-quality', str(quality), jpg],
                ['magick', png, '-resize', f'{max_w}x>', '-quality', str(quality), jpg],
                ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', str(quality), '--resampleWidth', str(max_w), png, '--out', jpg]):
        if shutil.which(cmd[0]) and subprocess.run(cmd, capture_output=True).returncode == 0:
            return jpg
    raise RuntimeError('no ImageMagick (convert/magick) or sips to make a JPEG review shot')


def screenshot_jpg(path):
    """screencap -> JPEG q60 <= 1080 px wide at path (use a .jpg name); the temp PNG is removed"""
    tmp = path + '.tmp.png'
    screenshot_png(tmp)
    try:
        png_to_jpeg(tmp, path)
    finally:
        os.remove(tmp)
    return path


def prune_shots(dirpath, keep, always=('fail', 'failed')):
    """keep the newest `keep` debug shots in dirpath (*.jpg); names containing one of `always` are never removed"""
    files = sorted((os.path.join(dirpath, f) for f in os.listdir(dirpath) if f.endswith('.jpg')), key=os.path.getmtime) if os.path.isdir(dirpath) else []
    keepable = [f for f in files if not any(a in os.path.basename(f) for a in always)]
    removed = keepable[:max(0, len(keepable) - keep)]
    for f in removed:
        os.remove(f)
    return removed


def screen_luma(region=None):
    """mean luma (0-255) of the screen or of region (x1,y1,x2,y2), from a raw screencap (no PIL needed)"""
    raw = adb('exec-out', 'screencap', text=False, timeout=30)
    w, h, _fmt = struct.unpack('<III', raw[:12])
    off = 16 if len(raw) >= 16 + w * h * 4 else 12
    px = memoryview(raw)[off:]
    x1, y1, x2, y2 = region or (0, 0, w, h)
    tot = cnt = 0
    for y in range(y1, y2, 24):
        row = (y * w) * 4
        for x in range(x1, x2, 24):
            i = row + x * 4
            tot += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            cnt += 1
    return tot / max(cnt, 1)


def root_cat(path):
    """file content via the root shell (adb root is set up once by the suite), '' when missing"""
    return adb('exec-out', f'cat {path!s} 2>/dev/null', timeout=30)


def root_ls(path):
    return [x for x in sh(f'ls -1 {path} 2>/dev/null').split('\n') if x]


def ready_at(curve, ref, tol=1.0):
    """[(t, luma)] samples of a screen region → the first t from which every later sample stays within tol of ref
    (the luma of the state confirmed afterwards, e.g. "image ready"); None when the curve does not end there"""
    at = None
    for t, l in curve:
        if abs(l - ref) <= tol:
            if at is None:
                at = t
        else:
            at = None
    return at


def settled(curve, hold_s, tol=0.5):
    """the samples of the last hold_s seconds stay within tol of each other (and cover hold_s)"""
    if not curve or curve[-1][0] - curve[0][0] < hold_s:
        return False
    tail = [l for t, l in curve if t >= curve[-1][0] - hold_s]
    return max(tail) - min(tail) <= tol
