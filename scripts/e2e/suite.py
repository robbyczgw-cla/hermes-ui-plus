#!/usr/bin/env python3
"""Android E2E smoke flows (run by scripts/e2e/smoke.sh, docs/E2E.md).

  suite.py --apk APK --out DIR [--only id,id] [--group name,name] [--live-stdin]
  suite.py --list-groups | --check-selection [--only ...] [--group ...]   (no device needed; smoke.sh validates with these)

Needs: a booted emulator ($ANDROID_SERIAL, own adb server $ANDROID_ADB_SERVER_PORT) and scripts/e2e/mock.mjs on
127.0.0.1:$E2E_MOCK_PORT (the emulator reaches it as 10.0.2.2). Every check waits on state (mock turn records, the
app's stored transcripts read through `adb root`, uiautomator nodes), never on fixed sleeps alone. Answers are compared
byte-for-byte with the mock's script; "exactly once" is checked in the app's transcript and in the mock's turn log.
"""
import argparse, ast, hashlib, json, os, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import device as d  # noqa: E402
from report import Fail, Report, Skip, expect  # noqa: E402

PKG = os.environ.get('E2E_PKG', 'xyz.hermesui.app')
SCHEME = os.environ.get('E2E_SCHEME', 'hermesuiplus')
MOCK = f'http://127.0.0.1:{os.environ.get("E2E_MOCK_PORT", "8791")}'
DEVICE_MOCK = f'http://10.0.2.2:{os.environ.get("E2E_MOCK_PORT", "8791")}/v1'
CONV_DIR = f'/data/data/{PKG}/files/hui-store/conv'
# Optional live checks after the live stage (docs/E2E.md "Live stage"): E2E_LIVE_EXTRA=bots,quick needs a real bridge
# with a Hermes profile E2E_LIVE_BOT (label E2E_LIVE_BOT_LABEL in the picker) whose answers match E2E_LIVE_BOT_MARK
# (its personality), and the hermes-ui-plus plugin for ⚡ (scripts/test-instance sets up such a Hermes).
LIVE_EXTRA = [x for x in os.environ.get('E2E_LIVE_EXTRA', '').split(',') if x]
LIVE_BOT = os.environ.get('E2E_LIVE_BOT', 'writer')
LIVE_BOT_LABEL = os.environ.get('E2E_LIVE_BOT_LABEL', 'Writer')
LIVE_BOT_MARK = os.environ.get('E2E_LIVE_BOT_MARK', '')
NODESTATE_DIR = f'/data/data/{PKG}/files/hui-store/nodestate'

# ── check groups (shards of the suite, see docs/E2E.md) ──────────────────────────────────────────────────────────────
# The one table: smoke.sh asks `--list-groups` / `--check-selection`, scripts/e2e/groups.test.mjs and Suite.run() check
# it against the checks Suite.run() registers. install + pair always run, logcat (the crash/ANR net) runs after
# whatever was selected; `live` is its own opt-in stage (--live). Balanced to roughly 3-5 min per group on the emulator.
ALWAYS = ('install', 'pair', 'logcat')
GROUPS = {
    'core': ('version', 'bots_quick_hidden', 'stream_long', 'stop', 'bots_quick_visible', 'cold_start'),
    'net': ('drop_resume', 'drop_recover', 'airplane', 'force_stop', 'offline_retry', 'refused_retry', 'not_sent'),
    'ui': ('checklist', 'share_image', 'table_font', 'dark', 'demo_wsp_card', 'demo_live', 'chip_text'),
    'bg': ('background',),
    'bots': ('bots', 'bots_create', 'demo_bots'),
    'share': ('share_unpaired', 'share_link', 'share_in_image', 'share_pdf', 'share_cancel', 'share_recreate', 'share_offline'),
    'cards': ('live_card', 'live_patch'),
    'routines': ('routines', 'routines_off', 'routines_hidden'),
    'reminders': ('reminder', 'reminder_delivered'),
}
LIVE_STAGE = 'live'
# the optional live checks (--live, E2E_LIVE_EXTRA) belong to the live stage, not to a group
LIVE_CHECKS = (LIVE_STAGE, 'live_bots', 'live_quick')


def registered_checks():
    """ids Suite.run() registers (self.check / r.run with a literal id), read from this file's source so the group table
    cannot silently miss a new check"""
    tree = ast.parse(open(os.path.abspath(__file__), encoding='utf-8').read())
    run = next(f for c in tree.body if isinstance(c, ast.ClassDef) and c.name == 'Suite'
               for f in c.body if isinstance(f, ast.FunctionDef) and f.name == 'run')
    return [n.args[0].value for n in ast.walk(run)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('check', 'run')
            and n.args and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str)]


def table_problems():
    """empty when every registered check is in ALWAYS, LIVE_CHECKS or at least one group, and the table names nothing else"""
    reg = set(registered_checks())
    grouped = {c for ids in GROUPS.values() for c in ids}
    out = [f'check {c!r} is in no group (add it to GROUPS)' for c in sorted(reg - grouped - set(ALWAYS) - set(LIVE_CHECKS))]
    out += [f'GROUPS names {c!r}, which Suite.run() does not register' for c in sorted(grouped - reg)]
    out += [f'{c!r} is in ALWAYS and in a group' for c in sorted(grouped & set(ALWAYS))]
    if 'all' in GROUPS:
        out.append("'all' is reserved")
    return out


def selection(only, groups):
    """(ids, label): ids = None for the whole suite, else the set of selected check ids (--group and --only are a union,
    install/pair/logcat are added by Suite.check). Raises ValueError for unknown names."""
    bad_g = [g for g in groups if g != 'all' and g not in GROUPS]
    known = set(registered_checks()) - set(LIVE_CHECKS)
    bad_o = [c for c in only if c not in known]
    if bad_g or bad_o:
        raise ValueError('; '.join(filter(None, [f'unknown group: {", ".join(bad_g)}' if bad_g else '',
                                                 f'unknown check: {", ".join(bad_o)}' if bad_o else ''])))
    if 'all' in groups or not (only or groups):
        return None, 'all'
    ids = set(only)
    for g in groups:
        ids |= set(GROUPS[g])
    label = ' + '.join(filter(None, [f'group {",".join(groups)}' if groups else '', f'only {",".join(only)}' if only else '']))
    return ids, label


# Selectors: testID (resource-id) first, the English accessibility label / text second (builds without testIDs).
S = dict(
    input='id:^composer-input$|desc:^Type a message$',
    send='id:^composer-send$|desc:^Send$',
    stop='id:^composer-stop$|desc:^Stop answer$',
    quick='id:^composer-quick$|desc:^Quick question$',
    quick_pill='desc:^Ask a quick question',
    new_chat='id:^header-new-chat$|desc:^New chat$',
    chats='id:^header-chats$|desc:^Chats$',
    model='id:^header-model$|desc:choose model$',
    tab_bots='id:^drawer-tab-bots$',
    chat_menu='desc:^Chat options$',
    tab_chats='id:^drawer-tab-chats$',
    bots_waiting='id:^bots-waiting$',
    stopped='id:^msg-stopped$|text:^Stopped$',
    recovering='id:^msg-recovering$|text:^Connection interrupted – loading the answer',
    recovered='id:^msg-recovered$|text:^loaded later$',
    failed='id:^msg-failed$|text:^Answer failed$',
    retry='id:^msg-retry$|text:^Retry$',
    not_sent='id:^msg-not-sent$|text:^Not sent',
    send_again='id:^msg-send-again$|text:^Send again$',
    connect='desc:^Connect$|text:^Connect$',
    consent='text:^Got it, continue$|desc:^Got it, continue$',
    later='text:^Later$|desc:^Later$',
    start_chat='desc:^Start (an empty|a new) chat$|text:^Start (an empty|a new) chat$',
    settings='id:^drawer-settings$|text:^Settings$',
    settings_done='id:^settings-done$|text:^Done$',
    version='id:^settings-version$|text:^\\d+\\.\\d+\\.\\d+\\S* · Build \\d+',
    check_open='desc:, open$',
    share_image='desc:^Share as image$',
    share_image_go='id:^share-image-share$|desc:^Share$',
    check_done='desc:, done$',
    picker_open='desc:^Model .+|text:^hermes-agent$',
    share_send='id:^share-send$',
    share_cancel='id:^share-cancel$',
    share_pair='id:^share-pair$',
    share_last='id:^share-target-last$',
    share_note='id:^share-note$',
    share_summarize='id:^share-intent-summarize$',
    share_preview='id:^share-preview$',
    share_kept='text:^What you shared is in the input field',
    look_around='text:^Try it first \\(demo\\)$|desc:^Try it first \\(demo\\)$',
    onboarding_close='desc:^Close$',
)


# ── mock ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def debug_dump(name):
    """E2E_DEBUG=1: keep the UI tree of an intermediate state (OUT/debug/NAME.txt)"""
    if os.environ.get('E2E_DEBUG') and OUT:
        os.makedirs(os.path.join(OUT, 'debug'), exist_ok=True)
        with open(os.path.join(OUT, 'debug', f'{name}.txt'), 'w') as f:
            f.write('\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click or n.rid))


OUT = None


def mock(path, body=None):
    req = urllib.request.Request(MOCK + path, data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def turns_for(text):
    return [t for t in mock('/__e2e/turns') if t['text'] == text]


def wait_turn(text, cond, timeout, what):
    end = time.time() + timeout
    while True:
        ts = turns_for(text)
        if ts and cond(ts[-1]):
            return ts[-1]
        if time.time() > end:
            raise Fail(f'mock: {what} not reached in {timeout:.0f} s (turn: {_brief(ts[-1]) if ts else "none"})')
        time.sleep(0.3)


def _brief(t):
    return {k: (len(v) if k in ('streamed', 'expected') else v) for k, v in t.items() if k not in ('ms',)}


def started_turns(text):
    """turns that really ran upstream for this text (held-then-dropped requests never reached Hermes)"""
    return [t for t in turns_for(text) if t['state'] in ('pending', 'live', 'ended', 'stopped')]


# ── app ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
COMPONENT = None


def launch():
    global COMPONENT
    if not COMPONENT:
        out = d.sh(f'cmd package resolve-activity --brief -c android.intent.category.LAUNCHER {PKG}').strip().split('\n')
        COMPONENT = out[-1].strip()
    d.sh(f'am start -n {COMPONENT}')
    if not d.wait(S['input'], 25) and not (d.dismiss_anr() and d.wait(S['input'], 15)):
        raise Fail('app did not show the composer after launch')


def force_stop():
    d.sh(f'am force-stop {PKG}')
    time.sleep(0.8)


def ensure_app():
    # a system "isn't responding" dialog (the emulator's launcher, often right after a theme change) sits above the
    # app without changing the top activity: it would swallow typed text and darken screenshots
    d.dismiss_anr()
    if d.top_activity() != PKG:
        launch()
    d.hide_keyboard()


def new_chat():
    ensure_app()
    n = d.find(S['new_chat'])
    if n and n.enabled:
        d.tap_xy(n.cx, n.cy)
        time.sleep(0.8)
    if not d.wait(S['input'], 10):
        raise Fail('no composer after New chat')


def send(text, hide=True):
    """types text into the composer and taps Send; returns the Send button node"""
    shown = False
    for _ in range(3):
        if not d.tap(S['input'], 10):
            raise Fail('composer input not found')
        for _ in range(8):
            time.sleep(0.35)
            if d.keyboard_shown():
                shown = True
                break
        if shown:
            break
    if not shown:
        raise Fail('soft keyboard did not open on the composer')
    mark_sent(text)
    d.type_text(text)
    if not d.wait('text:^' + re.escape(text) + '$', 6):
        raise Fail(f'typed text "{text}" not in the composer')
    if hide:
        d.hide_keyboard()
    btn = d.wait(S['send'], 6)
    if not btn:
        raise Fail('Send button not found')
    d.tap_xy(btn.cx, btn.cy)
    return btn


def transcripts():
    """{conversation file: [messages]} from the app's storage (root shell)"""
    out = d.adb('exec-out', f'for f in {CONV_DIR}/*.json; do echo "@@@ $f"; cat "$f"; echo; done', timeout=30)
    res = {}
    for part in out.split('@@@ ')[1:]:
        name, _, body = part.partition('\n')
        try:
            res[name.strip()] = json.loads(body).get('messages', [])
        except ValueError:
            pass
    return res


SENT_BEFORE = {}  # prompt -> {(conversation, message id)} of user messages with that text stored before the last send


def mark_sent(prompt):
    """call right before sending prompt: wait_answer then counts only the user messages stored after this point (another
    check may have sent the same text in its own chat earlier, e.g. checklist and share_image)"""
    SENT_BEFORE[prompt] = {(c, m.get('id')) for c, m, _ in answers_for(prompt)}


def answers_for(prompt):
    """[(conversation, user message, following assistant message or None)] for every user message == prompt"""
    hits = []
    for conv, msgs in transcripts().items():
        for i, m in enumerate(msgs):
            if m.get('role') == 'user' and m.get('text', '').strip() == prompt:
                nxt = msgs[i + 1] if i + 1 < len(msgs) and msgs[i + 1].get('role') == 'assistant' else None
                hits.append((conv, m, nxt))
    return hits


def finished(a):
    """a stored answer that is really over: the app persists a streaming answer as "stopped" without metrics.endedAt
    (crash safety, app/src/conversations/messages.ts), so that alone is not the end of the turn"""
    st = a.get('status') if a else None
    return st in ('done', 'error') or (st == 'stopped' and (a.get('metrics') or {}).get('endedAt') is not None)


def first_diff(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def wait_answer(prompt, expected, timeout):
    """waits until the stored answer to prompt equals expected (status done); checks it exists exactly once among the
    user messages stored since mark_sent(prompt)"""
    end, last, old = time.time() + timeout, None, SENT_BEFORE.get(prompt, set())
    while True:
        hits = [h for h in answers_for(prompt) if (h[0], h[1].get('id')) not in old]
        last = hits
        done = [h for h in hits if h[2] and h[2].get('status') == 'done' and h[2].get('text', '').rstrip() == expected.rstrip()]
        if done:
            expect(len(hits) == 1, f'user message stored {len(hits)}× (expected once)')
            conv, _, a = hits[0]
            msgs = transcripts()[conv]
            n_ans = sum(1 for m in msgs if m.get('role') == 'assistant' and m.get('text', '').rstrip() == expected.rstrip())
            expect(n_ans == 1, f'the answer is stored {n_ans}× in the chat')
            return dict(chars=len(a['text']), recovered=bool(a.get('recoveredAt')), conv=os.path.basename(conv))
        if time.time() > end:
            if not last:
                raise Fail(f'no stored user message "{prompt}" after {timeout:.0f} s')
            a = last[-1][2]
            if not a:
                raise Fail(f'no answer stored after "{prompt}" ({len(last)} user message(s))')
            got = a.get('text', '')
            i = first_diff(got, expected)
            raise Fail(f'answer status={a.get("status")} chars={len(got)}/{len(expected)}, first diff at {i}: '
                       f'got {got[max(0, i - 20):i + 30]!r} want {expected[max(0, i - 20):i + 30]!r}')
        time.sleep(1.5)


def expected_for(text):
    return mock('/__e2e/expected?' + urllib.parse.urlencode({'text': text}))['text']


def stream_progress(text, chars, timeout=15):
    return wait_turn(text, lambda t: t['state'] == 'live' and len(t['streamed']) >= chars, timeout, f'{chars} streamed chars')


def airplane(on):
    d.sh(f'cmd connectivity airplane-mode {"enable" if on else "disable"}')


def wait_online(timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if ' 0% packet loss' in d.sh('ping -c 1 -W 1 10.0.2.2'):
            return True
        time.sleep(0.5)
    return False


def wait_offline(timeout=15):
    """airplane mode is applied asynchronously: the host alias must really be unreachable before an "offline" send"""
    end = time.time() + timeout
    while time.time() < end:
        if ' 0% packet loss' not in d.sh('ping -c 1 -W 1 10.0.2.2'):
            return True
        time.sleep(0.5)
    return False


TCP_STATES = {'01': 'ESTABLISHED', '02': 'SYN_SENT', '03': 'SYN_RECV', '04': 'FIN_WAIT1', '05': 'FIN_WAIT2', '06': 'TIME_WAIT',
              '07': 'CLOSE', '08': 'CLOSE_WAIT', '09': 'LAST_ACK', '0A': 'LISTEN', '0B': 'CLOSING'}


def app_sockets():
    """the app's TCP sockets to the mock (/proc/net/tcp*): state, send queue, retransmits; a request written into a
    connection that airplane mode blackholed shows up as ESTABLISHED with bytes in the send queue"""
    port = '%04X' % int(os.environ.get('E2E_MOCK_PORT', '8791'))
    uid = (re.search(r'uid:(\d+)', d.sh(f'pm list packages -U {PKG}')) or [None, None])[1]
    rows = []
    for line in d.sh('cat /proc/net/tcp /proc/net/tcp6').splitlines():
        f = line.split()
        if len(f) < 8 or not f[2].endswith(':' + port) or (uid and f[7] != uid):
            continue
        tx, _ = f[4].split(':')
        rows.append(f'{f[1]} -> {f[2]} {TCP_STATES.get(f[3], f[3])} tx_queue={int(tx, 16)} retransmits={int(f[6], 16)} uid={f[7]}')
    return rows


def net_snapshot():
    """what the device thinks of its network (evidence for network-dependent failures)"""
    return '\n'.join([
        '$ ping -c 1 -W 1 10.0.2.2', d.sh('ping -c 1 -W 1 10.0.2.2'),
        '$ settings get global airplane_mode_on', d.sh('settings get global airplane_mode_on'),
        '$ ip route', d.sh('ip route'),
        '$ ip -4 addr', d.sh('ip -4 addr'),
        '$ app sockets to the mock', '\n'.join(app_sockets()) or '(none)',
        '$ dumpsys connectivity (networks)', '\n'.join(l for l in d.sh('dumpsys connectivity').splitlines()
                                                      if 'NetworkAgentInfo' in l or 'Active default network' in l)[:3000]])


def notifications():
    """titles + texts of this app's notifications"""
    out = d.sh('dumpsys notification --noredact')
    res, cur = [], False
    for line in out.split('\n'):
        if 'NotificationRecord(' in line:
            cur = f'pkg={PKG}' in line
        elif cur:
            m = re.search(r'android\.(title|text|bigText)=\w+ \((.*)\)$', line.strip())
            if m:
                res.append(m[2])
    return res


# ── "Share to HUI+" (docs/SHARE-TARGET.md) ─────────────────────────────────────────────────────────────────────────
def _png(w=96, h=96):
    """a small RGB gradient PNG (no PIL on the host)"""
    import struct, zlib
    rows = b''.join(b'\x00' + b''.join(bytes((x * 255 // w, y * 255 // h, 160)) for x in range(w)) for y in range(h))
    chunk = lambda t, data: struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def _pdf():
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>']
    out, offs = b'%PDF-1.4\n', []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offs)
    return out + b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)


def push_shared(name, data):
    """puts a file where the app's own FileProvider (expo-sharing, `cached_expo_files` = the app cache) serves it and
    returns its content:// uri. adb on API 35 cannot grant another app read access to a MediaStore uri (neither as
    root nor as shell: SecurityException in the app), so a real cross-app grant is out of reach here; this still runs
    the whole content-uri path of the share intake (query name/size, type, copy)."""
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=name) as f:
        f.write(data)
    tmp = f'/data/local/tmp/{name}'
    d.adb('push', f.name, tmp, timeout=60, check=True)
    os.unlink(f.name)
    base = f'/data/data/{PKG}'
    uid = d.sh(f'stat -c %u {base}').strip()
    expect(uid.isdigit(), f'app data dir not found ({uid})')
    d.sh(f'mkdir -p {base}/cache/e2e-share && cp {tmp} {base}/cache/e2e-share/{name} && rm {tmp} && '
         f'chown -R {uid}:{uid} {base}/cache/e2e-share && chmod -R u+rwX {base}/cache/e2e-share && restorecon -R {base}/cache/e2e-share')
    return f'content://{PKG}.SharingFileProvider/cached_expo_files/e2e-share/{name}'


def share_text(text):
    d.adb('shell', f'read t; am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "$t" {PKG}', inp=text + '\n', timeout=30)


def share_stream(uri, mime):
    d.sh(f'am start -a android.intent.action.SEND -t {mime} --eu android.intent.extra.STREAM {uri} --grant-read-uri-permission {PKG}')


def wait_sheet(timeout=20):
    n = d.wait(S['share_send'], timeout)
    if not n and d.dismiss_anr():
        n = d.wait(S['share_send'], 10)
    if not n:
        raise Fail('share sheet did not open')
    return n


def stored_user(pred):
    """[(conversation, user message)] matching pred"""
    return [(c, m) for c, msgs in transcripts().items() for m in msgs if m.get('role') == 'user' and pred(m)]


def user_ids():
    """{(conversation, id)} of every stored user message: the snapshot for new_user_msgs, taken before a send"""
    return {(c, m.get('id')) for c, m in stored_user(lambda m: True)}


def new_user_msgs(pred, before, timeout, settle=3):
    """[(conversation, user message)] matching pred that are not in before (user_ids() taken before the send): waits
    for the first one, then looks settle more times (1 s apart), so a second copy stored a moment later is counted too"""
    end, hits, extra = time.time() + timeout, [], None
    while True:
        hits = [(c, m) for c, m in stored_user(pred) if (c, m.get('id')) not in before]
        if hits:
            extra = settle if extra is None else extra - 1
        if extra == 0 or (extra is None and time.time() > end):
            return hits
        time.sleep(1.0)


def wait_upload(name, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        hit = [u for u in mock('/__e2e/uploads') if u['name'] == name]
        if hit:
            return hit[-1]
        time.sleep(0.5)
    raise Fail(f'{name} was not uploaded to the bridge in {timeout} s')


def wait_reply(conv, msg_id, timeout=30):
    """the assistant message after msg_id in conv is done"""
    end = time.time() + timeout
    while time.time() < end:
        msgs = transcripts().get(conv, [])
        ids = [m.get('id') for m in msgs]
        if msg_id in ids:
            i = ids.index(msg_id)
            if i + 1 < len(msgs) and msgs[i + 1].get('role') == 'assistant' and msgs[i + 1].get('status') == 'done':
                return msgs[i + 1]
        time.sleep(1.0)
    raise Fail('no finished answer to the shared message')


# ── checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
MAX_KEPT_SHOTS = int(os.environ.get('E2E_MAX_KEPT_SHOTS', '40'))


class Suite:
    def __init__(self, args):
        global OUT
        self.args, self.out = args, args.out
        OUT = args.out
        self.r = Report(args.out, {})
        self.orig = {}

    # setup / teardown of the device state this suite changes
    def prepare_device(self):
        d.adb('root', timeout=30)
        time.sleep(2)
        d.adb('wait-for-device', timeout=60)
        for _ in range(30):
            if d.sh('getprop sys.boot_completed').strip() == '1' and 'root' in d.sh('id'):
                break
            time.sleep(1)
        expect('uid=0' in d.sh('id'), 'adb root not available (needs a google_apis / userdebug image)')
        for k in ('window_animation_scale', 'transition_animation_scale'):
            self.orig[k] = d.sh(f'settings get global {k}').strip()
            d.sh(f'settings put global {k} 0')
        self.orig['night'] = d.sh('cmd uimode night').strip().split(':')[-1].strip()
        d.sh('cmd uimode night no')
        d.sh('settings put system font_scale 1.0')
        airplane(False)
        d.sh('svc power stayon true; wm dismiss-keyguard; input keyevent 82')
        d.sh('settings put system accelerometer_rotation 0; settings put system user_rotation 0')
        d.sh('logcat -G 16M; logcat -c')

    def restore_device(self):
        try:
            airplane(False)
            d.sh('settings put system font_scale 1.0')
            d.sh(f'cmd uimode night {self.orig.get("night") or "no"}')
            for k in ('window_animation_scale', 'transition_animation_scale'):
                v = self.orig.get(k)
                d.sh(f'settings put global {k} {v if v and v != "null" else 1}')
            d.sh('svc power stayon false; settings put system accelerometer_rotation 1')
            d.adb('uninstall', PKG, timeout=60)  # leaves no paired test install (or live token) on the shared AVD
        except Exception as e:
            print('restore failed:', e)

    def on_fail(self, cid):
        shots = os.path.join(self.out, 'shots')
        art = {}
        try:
            art['screenshot'] = os.path.relpath(d.screenshot_jpg(os.path.join(shots, f'{cid}.jpg')), self.out)
            with open(os.path.join(shots, f'{cid}-ui.txt'), 'w') as f:
                f.write('\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click or n.rid))
            art['ui'] = f'shots/{cid}-ui.txt'
            with open(os.path.join(shots, f'{cid}-logcat.txt'), 'w') as f:
                f.write(d.adb('logcat', '-d', '-t', '300', timeout=30))
            art['logcat'] = f'shots/{cid}-logcat.txt'
        except Exception as e:
            art['error'] = str(e)
        self.recover()
        return art

    def recover(self):
        """back to a known state after a failed check"""
        try:
            mock('/__e2e/fault', {})
            mock('/__e2e/config', {'profiles': False, 'quick': False})
            airplane(False)
            d.sh('settings put system font_scale 1.0; cmd uimode night no')
            wait_online(10)
            force_stop()
            launch()
        except Exception as e:
            print('recover failed:', e)

    def check(self, cid, title, fn, needs=('pair',)):
        if self.args.selected is not None and cid not in self.args.selected and cid not in ALWAYS:
            return
        def guarded():
            # a system ANR dialog left over from the previous check (the emulator's launcher, seen covering the app for
            # a whole run) would fail every following check: dismiss it first, report it in the evidence
            before = len(d.ANR_DISMISSED)
            d.dismiss_anr()
            ev = fn()
            seen = d.ANR_DISMISSED[before:]
            if seen and isinstance(ev, dict):
                ev = dict(ev, anr_dismissed='; '.join(seen))
            return ev
        self.r.run(cid, title, guarded, on_fail=self.on_fail, needs=needs)

    # ── individual checks ────────────────────────────────────────────────────────────────────────────────────────
    def c_install(self):
        d.adb('uninstall', PKG, timeout=60)
        out = d.adb('install', '-r', '-t', self.args.apk, timeout=240)
        expect('Success' in out, f'adb install: {out.strip()[-200:]}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        dump = d.sh(f'dumpsys package {PKG}')
        vc = re.search(r'versionCode=(\d+)', dump)
        vn = re.search(r'versionName=(\S+)', dump)
        self.version_code, self.version_name = (vc[1] if vc else '?'), (vn[1] if vn else '?')
        expect(not d.root_ls(CONV_DIR), 'fresh install already has stored chats')
        return dict(versionCode=self.version_code, versionName=self.version_name)

    def pair(self, link, name):
        """opens the pair link and walks onboarding to the chat. System "isn't responding" dialogs are dismissed; if
        the app shows neither onboarding nor the chat within 25 s, the link is opened once more (still valid:
        it is spent only by Connect)"""
        def open_link():
            d.adb('shell', 'read l; am start -a android.intent.action.VIEW -d "$l" ' + PKG, inp=link + '\n', timeout=30)

        open_link()
        steps, start = [], time.time()
        end, reopened, seen = start + 90, False, False
        while time.time() < end:
            ns = d.dump()
            anr = d.dismiss_anr(ns)
            if anr:
                steps.append(f'anr:{anr}')
                continue
            if d.find(S['input'], ns) and not d.find(S['connect'], ns) and not d.find(S['consent'], ns) and not d.find(S['start_chat'], ns):
                return steps
            seen = seen or any(d.find(S[k], ns) for k in ('connect', 'consent', 'later', 'start_chat'))
            if not seen and not reopened and time.time() - start > 25:
                open_link()
                steps.append('reopen')
                reopened = True
                continue
            for key in ('connect', 'consent', 'later', 'start_chat'):
                n = d.find(S[key], ns)
                if n and n.enabled:
                    d.tap_xy(n.cx, n.cy)
                    steps.append(key)
                    time.sleep(1.0)
                    break
            else:
                time.sleep(0.7)
        raise Fail(f'onboarding did not reach the chat (steps: {steps})')

    def c_pair(self):
        code = mock('/__e2e/pair-code', {})['code']
        link = f'{SCHEME}://pair?' + urllib.parse.urlencode({'u': DEVICE_MOCK, 'c': code, 'n': 'E2E'})
        steps = self.pair(link, 'E2E')
        redeems = [q for q in mock('/__e2e/requests') if q['path'] == '/bridge/pair/redeem']
        expect(len(redeems) == 1 and redeems[0]['status'] == 200, f'pair redeem requests: {redeems}')
        expect('connect' in steps, f'no Connect step (steps {steps})')
        expect(d.wait('text:^Hermes$|desc:^Hermes', 5) is not None, 'header does not show the Hermes connection')
        expect(d.find('text:^Demo$|text:Demo mode') is None, 'app runs in demo mode')
        # selectors resolve through testIDs (resource-ids) on builds that have them, else through English labels
        self.r.meta['selectors'] = 'testID' if d.find('id:^composer-input$') else 'label'
        return dict(steps=steps)

    def c_version(self):
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        expect(d.tap(S['settings'], 8), 'Settings entry not found in the drawer')
        # About is the last section and Settings keeps growing (support rows, quick answers, larger rows): scroll until
        # the label shows or the list stops moving. Swipes start at 70 % of the height, clear of the gesture bar.
        w, h = d.screen_size()
        node, prev, shown, swipes = None, None, None, 0
        for swipes in range(25):
            nodes = d.dump()
            node = d.find(S['version'], nodes)
            if node:
                break
            expect(d.top_activity() == PKG, f'app left the foreground while scrolling Settings (after {swipes} swipes)')
            shown = [(n.text, n.b) for n in nodes if n.text]
            if shown == prev:
                break
            prev = shown
            d.swipe(w // 2, int(h * 0.7), w // 2, int(h * 0.25), 350)
            time.sleep(0.5)
        expect(node is not None, f'version label not found in Settings ({swipes} swipes, list end reached: {shown == prev})')
        label = node.text
        self.r.meta['version_label'] = label
        m = re.search(r'Build (\d+)(?: \(([0-9a-f]{7,12})\))?', label)
        expect(m and m[1] == self.version_code, f'label "{label}" vs versionCode {self.version_code}')
        expect(label.startswith(self.version_name), f'label "{label}" vs versionName {self.version_name}')
        sha = re.search(r'-([0-9a-f]{7,12})-', os.path.basename(self.args.apk))
        if sha and m[2]:
            expect(m[2].startswith(sha[1]) or sha[1].startswith(m[2]), f'label commit {m[2]} vs APK name {sha[1]}')
        d.tap(S['settings_done'], 5)
        time.sleep(0.8)
        ensure_app()
        expect(d.wait(S['input'], 8) is not None, 'not back in the chat after closing Settings')
        return dict(label=label)

    def _drawer_has_bots_tab(self, wait=6):
        """opens the drawer: is there a "Chats | Bots" switch (bots/, only with a bot besides the default)? closes it"""
        if not d.tap(S['chats'], 8):
            raise Fail('Chats button not found')
        has = d.wait(S['tab_bots'], wait) is not None
        debug_dump('drawer-bots')
        d.sh('input keyevent 4')
        time.sleep(0.8)
        ensure_app()
        return has

    def _open_bot(self, key, label, shot=None):
        """drawer → Bots tab → the bot's row; back in its Bot Chat (header names the bot)"""
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        tab = None
        for _ in range(3):  # the bot list arrives with GET /bridge/profiles: reopen once if the switch is not there yet
            tab = d.wait(S['tab_bots'], 8)
            if tab:
                break
            d.sh('input keyevent 4')
            time.sleep(1.0)
            d.tap(S['chats'], 8)
        expect(tab, 'no "Chats | Bots" switch in the drawer')
        d.tap_xy(tab.cx, tab.cy)
        row = d.wait(f'id:^bot-row-{re.escape(key)}$', 8)
        expect(row, f'no row for bot {key} in the Bots tab')
        if shot:
            self.shot(shot)
        d.tap_xy(row.cx, row.cy)
        head = d.wait('desc:^' + re.escape(label) + ', ', 15)
        expect(head, f'the Bot Chat of {label} did not open (header)')
        expect(d.wait(S['input'], 8), 'no composer in the Bot Chat')
        return head

    def c_bots_quick_hidden(self):
        new_chat()
        t0 = time.time()
        ns = d.dump()
        expect(d.find(S['quick'], ns) is None, '⚡ quick toggle visible though the bridge has no quick answers')
        expect(d.find(S['quick_pill'], ns) is None, '"Quick question" pill on the start screen')
        expect(not self._drawer_has_bots_tab(), '"Chats | Bots" switch in the drawer though the bridge lists only the default profile')
        reqs = mock('/__e2e/requests')
        n_prof = sum(q['path'] == '/bridge/profiles' for q in reqs)
        n_quick = sum(q['path'] == '/bridge/quick/config' for q in reqs)
        mins = max((time.time() - self.t_paired) / 60, 0.5)
        expect(n_prof / mins <= 6 and n_quick / mins <= 6, f'request loop? /bridge/profiles {n_prof}×, /bridge/quick/config {n_quick}× in {mins:.1f} min')
        return dict(profiles_requests=n_prof, quick_requests=n_quick, minutes=round(mins, 1), s=round(time.time() - t0, 1))

    def c_stream_long(self):
        new_chat()
        text = 'e2e long stream'
        exp = expected_for(text)
        btn = send(text)
        d.sh(f'dumpsys gfxinfo {PKG} reset >/dev/null')
        t_send = time.time()
        # no uiautomator while streaming: it would show up in the frame stats
        t = wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the long stream')
        stream_s = (t['endedAt'] - t['startedAt']) / 1000
        time.sleep(1.5)
        gfx = d.sh(f'dumpsys gfxinfo {PKG}')
        with open(os.path.join(self.out, 'gfx-long.txt'), 'w') as f:
            f.write(gfx)
        g = lambda rx, cast=float: cast((re.search(rx, gfx) or [None, 'nan'])[1]) if re.search(rx, gfx) else None  # noqa: E731
        frames = g(r'Total frames rendered: (\d+)', int)
        stats = dict(stream_s=round(stream_s, 1), frames=frames, fps=round(frames / (time.time() - t_send), 1) if frames else None,
                     janky_pct=g(r'Janky frames: \d+ \(([\d.]+)%\)'), p50=g(r'\n50th percentile: (\d+)ms', int), p90=g(r'\n90th percentile: (\d+)ms', int),
                     p95=g(r'\n95th percentile: (\d+)ms', int), p99=g(r'\n99th percentile: (\d+)ms', int), slow_ui=g(r'Number Slow UI thread: (\d+)', int))
        self.r.metric('gfx_long_stream', stats)
        ev = wait_answer(text, exp, 20)
        expect(len(turns_for(text)) == 1, f'{len(turns_for(text))} turns for one send')
        tail = d.find_all('text:\\[end of long answer\\]')
        expect(len(tail) <= 1, f'last line shown {len(tail)}× in the UI')
        expect(frames and frames > 50, f'gfxinfo shows only {frames} frames during the stream')
        return dict(ev, **{k: stats[k] for k in ('frames', 'janky_pct', 'p90', 'p99')}, send_btn=btn.desc or btn.rid)

    def c_stop(self):
        new_chat()
        text = 'e2e slow stop'
        exp = expected_for(text)
        btn = send(text)
        stream_progress(text, 120)
        # uiautomator never gets an idle UI while tokens arrive: Stop replaces Send at the same place
        d.tap_xy(btn.cx, btn.cy)
        t = wait_turn(text, lambda t: t['state'] == 'stopped', 8, 'stopped turn')
        stops = [q for q in mock('/__e2e/requests') if q['path'] == '/bridge/chat/stop']
        expect(stops, 'no /bridge/chat/stop request')
        expect(d.wait(S['stopped'], 10), '"Stopped" label not shown')
        time.sleep(2.5)
        a1 = answers_for(text)
        time.sleep(2.0)
        a2 = answers_for(text)
        expect(len(a1) == 1 and a1[0][2], 'stopped answer not stored once')
        got = a1[0][2]['text']
        expect(a1[0][2].get('status') == 'stopped', f'stored status {a1[0][2].get("status")}')
        expect(exp.startswith(got.rstrip()) and 0 < len(got) < len(exp), f'stopped text is no prefix of the script ({len(got)} chars)')
        expect(a2[0][2]['text'] == got, 'the answer still grows after Stop')
        return dict(kept_chars=len(got), of=len(exp), mock_streamed=len(t['streamed']))

    def c_drop_resume(self):
        """the mock cuts the socket mid-stream (bridge offers byte resume): the app re-attaches transparently"""
        new_chat()
        text = 'e2e slow drop resume'
        exp = expected_for(text)
        mock('/__e2e/fault', {'kind': 'drop', 'match': text, 'afterChunks': 60})
        send(text)
        wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the dropped stream')
        ev = wait_answer(text, exp, 30)
        t = turns_for(text)
        expect(len(started_turns(text)) == 1, f'{len(started_turns(text))} turns ran')
        expect(t[-1]['drops'] == 1, 'the fault did not cut the stream')
        offs = [a['offset'] for a in t[-1]['attaches']]
        expect(offs and max(offs) > 0, f'no resume at a byte offset (attaches {offs})')
        expect(d.find(S['failed']) is None, '"Answer failed" shown')
        return dict(ev, resume_offsets=offs)

    def c_drop_recover(self):
        """cut mid-stream without byte resume: "Connection interrupted – loading…", then the session poll → "loaded later" """
        new_chat()
        text = 'e2e slow drop recover'
        exp = expected_for(text)
        mock('/__e2e/fault', {'kind': 'drop', 'match': text, 'afterChunks': 60, 'resumable': False})
        send(text)
        wait_turn(text, lambda t: t['drops'] == 1, 30, 'cut stream')
        banner = d.wait(S['recovering'], 12) is not None
        wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the turn')
        ev = wait_answer(text, exp, 75)
        expect(len(started_turns(text)) == 1, f'{len(started_turns(text))} turns ran')
        expect(banner, '"Connection interrupted – loading the answer…" not shown')
        expect(ev['recovered'], 'stored answer is not marked as loaded later')
        later = d.wait(S['recovered'], 8) is not None
        expect(later, '"loaded later" label not shown')
        return ev

    def c_airplane(self):
        new_chat()
        text = 'e2e slow airplane'
        exp = expected_for(text)
        send(text)
        stream_progress(text, 150)
        airplane(True)
        time.sleep(9)
        banner = d.find(S['recovering']) is not None
        airplane(False)
        expect(wait_online(20), 'network did not come back after airplane mode')
        wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the turn')
        ev = wait_answer(text, exp, 90)
        expect(len(started_turns(text)) == 1, f'{len(started_turns(text))} turns ran')
        return dict(ev, banner_seen=banner, attaches=len(turns_for(text)[-1]['attaches']))

    def c_force_stop(self):
        new_chat()
        text = 'e2e slow force stop'
        exp = expected_for(text)
        send(text)
        stream_progress(text, 150)
        force_stop()
        launch()
        wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the turn')
        ev = wait_answer(text, exp, 90)
        expect(len(started_turns(text)) == 1, f'{len(started_turns(text))} turns ran')
        shown = d.wait('text:\\[end of slow answer\\]', 10) is not None
        expect(shown, 'the reopened chat does not show the end of the answer')
        return ev

    def c_offline_retry(self):
        new_chat()
        text = 'e2e offline retry'
        exp = expected_for(text)
        before = app_sockets()
        airplane(True)
        offline = wait_offline(15)
        time.sleep(1)
        offline_socks = app_sockets()
        send(text)
        t_send = time.time()
        f = d.wait(S['failed'], 25)
        failed_s = time.time() - t_send
        if not f:
            # evidence for a failure that depends on the emulator's network state (shots/offline_retry-net.txt)
            os.makedirs(os.path.join(self.out, 'shots'), exist_ok=True)
            with open(os.path.join(self.out, 'shots', 'offline_retry-net.txt'), 'w') as nf:
                nf.write(f'device offline before the send: {offline}\n'
                         f'app sockets online: {before}\napp sockets offline, before the send: {offline_socks}\n' + net_snapshot())
        expect(offline, 'the device network did not go down in airplane mode (host alias still reachable)')
        expect(f, '"Answer failed" not shown for an offline send')
        r = d.wait(S['retry'], 5)
        expect(r, 'Retry button not found')
        inp = d.find(S['input'])
        w, h = d.screen_size()
        bottom = inp.b[1] if inp else h
        expect(0 < r.b[1] and r.b[3] <= bottom + 4, f'Retry not visible above the composer (Retry {r.b}, composer top {bottom})')
        shot = d.screenshot_jpg(os.path.join(self.out, 'shots', 'offline-failed.jpg'))
        airplane(False)
        expect(wait_online(20), 'network did not come back')
        time.sleep(1.5)
        r = d.wait(S['retry'], 5)
        expect(r, 'Retry button gone after reconnect')
        d.sh(f'input tap {r.cx} {r.cy}; input tap {r.cx} {r.cy}')  # double tap
        ev = wait_answer(text, exp, 30)
        time.sleep(2)
        n = len(started_turns(text))
        expect(n == 1, f'{n} turns ran after a double Retry')
        expect(len(answers_for(text)) == 1, 'user message stored more than once')
        # which case ran: a keep-alive connection still pooled while offline (the request then needs the app's
        # reachability check, stream.ts HEADER_PROBE_AFTER_MS) or none (the connect fails at once)
        pooled = [r.split(' ', 3)[3].split(' tx_queue')[0] for r in offline_socks]
        return dict(ev, turns=n, failed_s=round(failed_s, 1), pooled_offline=', '.join(pooled) or 'none',
                    failed_card_bounds=list(f.b), shot=os.path.relpath(shot, self.out))

    def c_refused_retry(self):
        new_chat()
        text = 'e2e refused retry'
        exp = expected_for(text)
        mock('/__e2e/fault', {'kind': 'refuse', 'match': text})
        send(text)
        expect(d.wait(S['failed'], 15), '"Answer failed" not shown for a refused send')
        r = d.wait(S['retry'], 5)
        expect(r, 'Retry button not found')
        d.sh(f'input tap {r.cx} {r.cy}; input tap {r.cx} {r.cy}')
        ev = wait_answer(text, exp, 30)
        time.sleep(2)
        n = len(started_turns(text))
        expect(n == 1, f'{n} turns ran after a double Retry')
        reqs = [q for q in mock('/__e2e/requests') if q.get('text') == text]
        return dict(ev, turns=n, requests=[q.get('kind') for q in reqs])

    def c_not_sent(self):
        new_chat()
        text = 'e2e not sent resend'
        exp = expected_for(text)
        mock('/__e2e/fault', {'kind': 'hold', 'match': text, 'ms': 60000})
        send(text)
        wait_turn(text, lambda t: t['state'] == 'held', 10, 'held request')
        time.sleep(1.0)
        force_stop()
        wait_turn(text, lambda t: t['state'] == 'dropped', 10, 'request dropped by the killed app')
        launch()
        expect(d.wait(S['not_sent'], 20), '"Not sent" not shown after the kill')
        b = d.wait(S['send_again'], 5)
        expect(b, '"Send again" not found')
        d.sh(f'input tap {b.cx} {b.cy}; input tap {b.cx} {b.cy}')
        ev = wait_answer(text, exp, 30)
        time.sleep(2)
        n = len(started_turns(text))
        expect(n == 1, f'{n} turns ran after a double "Send again"')
        expect(d.find(S['not_sent']) is None, '"Not sent" still shown')
        return dict(ev, turns=n)

    def c_checklist(self):
        new_chat()
        text = 'e2e checklist ticks'
        exp = expected_for(text)
        send(text)
        wait_answer(text, exp, 30)
        time.sleep(1)
        ticked = []
        debug_dump('checklist-0')
        for i in range(2):
            # the card lays its items out with an entering animation and moves done items to the end: tap only once
            # the positions hold still, then confirm the tick landed
            items = d.wait_stable(S['check_open'], 10)
            expect(items, 'checklist items never settled')
            n = items[0]
            d.tap_xy(n.cx, n.cy)
            ticked.append(n.desc)
            expect(d.wait(f'desc:, {i + 1} of 4 done$|desc:^{i + 1} of 4 done$', 5), f'tap {i + 1} on "{n.desc}" did not tick it')
            debug_dump(f'checklist-{i + 1}')
        expect(d.wait('desc:^2 of 4 done$|text:^2/4$', 6), 'counter does not show 2/4')
        time.sleep(2.0)
        force_stop()
        launch()
        prog = d.wait('desc:^2 of 4 done$|text:^2/4$', 15)
        if not prog:
            w, h = d.screen_size()
            d.swipe(w // 2, int(h * 0.65), w // 2, int(h * 0.35))
            prog = d.wait('desc:^2 of 4 done$|text:^2/4$', 5)
        expect(prog, 'after force-stop the checklist is not at 2/4')
        done = d.find_all(S['check_done'])
        expect(len(done) == 2, f'{len(done)} items done after relaunch')
        files = d.root_ls(NODESTATE_DIR)
        return dict(ticked=ticked, nodestate_files=len(files))

    def c_live_card(self):
        """live card (app/src/live): Hermes creates a live list → a row in the tray under the header; a tick stays on the
        device ("1 change waiting", survives a force-stop) until the next message carries it to Hermes (the [hui:live]
        trailer, checked at the mock); Hermes' next full version keeps it and the user bubble says it went along"""
        new_chat()
        first = 'Mach mir eine Einkaufsliste fuer Samstag.'  # adb input text cannot type umlauts
        send(first)
        wait_turn(first, lambda t: t['state'] == 'ended', 30, 'the live list answer')
        expect(d.wait('desc:^Live card Einkauf Samstag, 0 of 8 ', 15), 'no live card row in the tray')
        items = d.wait_stable('desc:^1 l Milch, open$', 10)
        expect(items, 'live list item "1 l Milch" not shown')
        d.tap_xy(items[0].cx, items[0].cy)
        waiting = 'desc:^Live card Einkauf Samstag, 1 of 8 · 1 change waiting'
        expect(d.wait(waiting, 6), 'the tray does not show the waiting tick')
        debug_dump('live-card-1')
        time.sleep(2.0)
        force_stop()
        launch()
        expect(d.wait(waiting, 15), 'the waiting tick did not survive a force-stop')
        second = 'Wir grillen doch am Samstag.'
        send(second)
        end, t = time.time() + 30, None
        while time.time() < end:
            t = next((x for x in reversed(mock('/__e2e/turns')) if x['text'].startswith(second)), None)
            if t and t['state'] == 'ended':
                break
            time.sleep(0.3)
        expect(t and t['state'] == 'ended', 'the grill update did not finish at the mock')
        expect('[hui:live]{"einkauf":{"v":1,"ops":[{"check":"milch"}]' in t['text'], f'the tick did not ride along: {t["text"][-160:]!r}')
        expect(d.wait('text:sent along$', 10), 'no "sent along" line under the user message')
        expect(d.wait('desc:^Live card Einkauf Samstag, 1 of 10 · Hermes', 10), 'the tray does not show Hermes\' new version with the tick')
        debug_dump('live-card-2')
        return dict(trailer=t['text'][len(second):].strip()[:160])

    def c_live_patch(self):
        """live cards, phase 2 (app/src/live): a watchlist card from Hermes; its price update arrives as a PATCH (a callout
        with livePatch) and renders as the card's receipt, not as the callout; a live trip opens on its day tabs"""
        new_chat()
        first = 'Leg mir eine Kopfhoerer-Watchlist an.'  # adb input text cannot type umlauts
        send(first)
        wait_turn(first, lambda t: t['state'] == 'ended', 30, 'the watchlist answer')
        expect(d.wait('desc:^Live card Kopfhörer-Watchlist, 3 products', 15), 'no watchlist row in the tray')
        second = 'Preise bitte.'
        send(second)
        wait_turn(second, lambda t: t['state'] == 'ended', 30, 'the price patch answer')
        expect(d.wait('desc:^Open Kopfhörer-Watchlist, version 2$', 10), 'the patch did not render as the v2 receipt')
        expect(not d.find('text:^Kopfhörer-Watchlist aktualisiert$'), 'the patch callout is shown instead of the receipt')
        expect(d.wait('text:239', 6), 'the new price is not in the receipt')
        debug_dump('live-patch-1')
        third = 'Plane mir Rom.'
        send(third)
        wait_turn(third, lambda t: t['state'] == 'ended', 30, 'the trip answer')
        row = d.wait('desc:^Live card Rom, 13.–15. November', 15)
        expect(row, 'no trip row in the tray')
        d.tap_xy(row.cx, row.cy)
        # a new trip opens on its first day (no changes yet); the Colosseum is on Saturday
        sat = d.wait('desc:^Sa 14\\.', 8)
        expect(sat, 'the open trip card shows no day tabs')
        d.tap_xy(sat.cx, sat.cy)
        expect(d.wait('text:^Kolosseum$', 6), 'the open trip card shows no blocks on Saturday')
        debug_dump('live-patch-2')
        d.sh('input keyevent 4')
        return dict(cards=3)

    def c_share_image(self):
        """answer action row → "Share as image": the sheet previews the PNG (with the ticked item), Share opens the
        system chooser; the PNG the app made is pulled from its cache (root) into OUT/share-image.png"""
        new_chat()
        text = 'e2e checklist share image'  # not checklist's prompt: each check finds its own chat by the text
        exp = expected_for(text)
        send(text)
        wait_answer(text, exp, 30)
        items = d.wait_stable(S['check_open'], 10)
        expect(items, 'checklist items never settled')
        d.tap_xy(items[0].cx, items[0].cy)
        expect(d.wait('desc:, 1 of 4 done$|desc:^1 of 4 done$', 5), 'the tick did not land')
        btn = d.wait(S['share_image'], 6)
        if not btn:
            w, h = d.screen_size()
            d.swipe(w // 2, int(h * 0.7), w // 2, int(h * 0.4))
            btn = d.wait(S['share_image'], 6)
        expect(btn, '"Share as image" not in the answer action row')
        cache = f'/data/data/{PKG}/cache'
        before = set(d.root_ls(cache))
        t0 = time.time()
        d.tap_xy(btn.cx, btn.cy)
        # time to "image ready", measured without uiautomator: it cannot dump while the sheet's spinner turns (a dump
        # waits for an idle UI), so a dump-based wait says more about uiautomator than about the app. Raw screencaps
        # of the busy row / Share button area until the look holds still (or 10 s); the readiness time is where that
        # curve reaches the look of the state uiautomator then confirms as ready (Share enabled).
        w, h = d.screen_size()
        region = (int(w * 0.05), int(h * 0.90), int(w * 0.97), int(h * 0.965))
        sample = lambda: curve.append((round(time.time() - t0, 2), round(d.screen_luma(region), 1)))
        curve = []
        while time.time() - t0 < 10 and not (time.time() - t0 > 1.5 and d.settled(curve, 2.0)):
            sample()
        expect(d.wait('text:^Share as image$', 8), 'the share sheet did not open')
        go, end = None, time.time() + 20
        while time.time() < end:
            go = d.find(S['share_image_go'])
            if go is not None and go.enabled:
                break
            time.sleep(0.5)
        expect(go is not None and go.enabled, 'the Share button never became ready (image not made)')
        ui_wait_s = round(time.time() - t0, 1)
        ready_luma = round(d.screen_luma(region), 1)
        if d.ready_at(curve, ready_luma) is None:
            # the curve held still in another look (e.g. a slow capture): sample the ready look into it
            end = time.time() + 3
            while time.time() < end:
                sample()
        ready_s = d.ready_at(curve, ready_luma)
        expect(ready_s is not None, f'the sheet never showed its ready look in the samples (ready luma {ready_luma}, curve {curve[-3:]})')
        # past the capture deadline (shareModel SHARE_DEADLINE_MS = 5 s) something held the capture until it gave up
        expect(ready_s < 5.0, f'image ready only after {ready_s} s: the capture waited for its 5 s deadline')
        sheet = d.screenshot_jpg(os.path.join(self.out, 'share-image-sheet.jpg'))
        new = [f for f in d.root_ls(cache) if f not in before and f.endswith('.png')]
        expect(new, f'no PNG in the app cache after the capture (cache: {sorted(set(d.root_ls(cache)) - before)})')
        local = os.path.join(self.out, 'share-image.png')
        d.adb('pull', f'{cache}/{new[-1]}', local, timeout=60)
        with open(local, 'rb') as f:
            expect(f.read(8) == b'\x89PNG\r\n\x1a\n', 'the captured file is not a PNG')
        d.tap_xy(go.cx, go.cy)
        end, top = time.time() + 10, ''
        while time.time() < end:
            top = d.top_activity()
            if top and top != PKG:
                break
            time.sleep(0.5)
        expect(top and top != PKG, f'no system share sheet after "Share" (top activity: {top or "?"})')
        time.sleep(1.5)  # let the system sheet draw before the screenshot
        chooser = d.screenshot_jpg(os.path.join(self.out, 'share-image-chooser.jpg'))
        d.sh('input keyevent KEYCODE_BACK')
        time.sleep(1.0)
        ensure_app()
        # the sheet title (text); the answer's own "Share" (text share) button stays, so not the button label
        expect(d.wait('text:^Share as image$', 6, gone=True), 'the share sheet stays open after the system sheet closed')
        # the receiving app gets a content URI of this very file and may read it late: it must outlive the sheet
        expect(new[-1] in d.root_ls(cache), 'the shared PNG was deleted when the sheet closed')
        return dict(ready_s=ready_s, ui_wait_s=ui_wait_s, ready_luma=ready_luma, luma_curve=curve, file=new[-1], chooser=top, sheet=os.path.relpath(sheet, self.out), shot=os.path.relpath(chooser, self.out))

    def c_table_font(self):
        new_chat()
        text = 'e2e table font'
        exp = expected_for(text)
        send(text)
        wait_answer(text, exp, 30)
        d.sh('settings put system font_scale 1.3')
        try:
            time.sleep(3)
            ensure_app()
            ns = d.dump()
            shot = d.screenshot_jpg(os.path.join(self.out, 'shots', 'table-font-1.3.jpg'))
            # the app keeps numbers together with NBSP / word joiners: compare without them
            plain = lambda s: s.replace('\u2060', '').replace('\xa0', ' ')  # noqa: E731
            years = {y: [n for n in ns if y in plain(n.text)] for y in ('1011–1021', '1590', '1665', '1931')}
            missing = [y for y, v in years.items() if not v]
            expect(not missing, f'table cells missing at font 1.3: {missing}')
            # one line = the "Year" header / the 4-digit cells (they cannot wrap); the last column scrolls off-screen
            ref = [n.h for n in ns if n.text.strip() == 'Year'] + [n.h for y in ('1590', '1665', '1931') for n in years[y]]
            line = min(ref)
            tall = {y: max(n.h for n in v) for y, v in years.items() if max(n.h for n in v) > line * 1.45}
            expect(not tall, f'year cells wrap at font 1.3 (heights {tall}, one line = {line} px)')
            return dict(line_px=line, heights={y: max(n.h for n in v) for y, v in years.items()}, shot=os.path.relpath(shot, self.out))
        finally:
            d.sh('settings put system font_scale 1.0')
            time.sleep(2)

    def c_dark(self):
        ensure_app()
        w, h = d.screen_size()
        region = (int(w * 0.05), int(h * 0.12), int(w * 0.95), int(h * 0.7))
        d.sh('cmd uimode night yes')
        try:
            time.sleep(3)
            ensure_app()
            dark = d.screen_luma(region)
            shot = d.screenshot_jpg(os.path.join(self.out, 'shots', 'dark.jpg'))
        finally:
            d.sh('cmd uimode night no')
        time.sleep(3)
        ensure_app()
        light = d.screen_luma(region)
        expect(dark < 90, f'night mode: mean luma {dark:.0f} (expected a dark screen)')
        expect(light > 150, f'day mode: mean luma {light:.0f} (expected a light screen)')
        return dict(dark_luma=round(dark), light_luma=round(light), shot=os.path.relpath(shot, self.out))

    def c_background(self):
        new_chat()
        text = 'e2e slow background'
        exp = expected_for(text)
        send(text)
        stream_progress(text, 40)
        d.sh('input keyevent 3')  # HOME
        answering = None
        end = time.time() + 30
        while time.time() < end and not answering:
            answering = next((x for x in notifications() if 'is answering' in x), None)
            if not answering and turns_for(text)[-1]['state'] == 'ended':
                break
            time.sleep(1)
        wait_turn(text, lambda t: t['state'] == 'ended', 60, 'end of the turn')
        ready, end = None, time.time() + 30
        while time.time() < end and not ready:
            ready = next((x for x in notifications() if x.startswith('Answer ready')), None)
            time.sleep(1)
        expect(answering, f'no "… is answering" notification while in the background (seen: {notifications()[:4]})')
        expect(ready, f'no "Answer ready" notification (seen: {notifications()[:4]})')
        # "Answer ready" comes only after the final write: storage already holds the complete answer, still in the
        # background (a process killed before the user reopens the app must not lose its tail)
        hits = answers_for(text)
        before = hits[-1][2] if hits and hits[-1][2] else {}
        self.r.metric('background_stored_before_reopen', f'{before.get("status")} {len(before.get("text", ""))}/{len(exp)} chars')
        stored_bg = f'{before.get("status")} {len(before.get("text", ""))} chars'
        launch()  # like tapping the notification
        ev = wait_answer(text, exp, 20)
        expect(before.get('status') == 'done' and before.get('text', '').rstrip() == exp.rstrip(),
               f'after "Answer ready" the app had stored {stored_bg} of {len(exp)} while still in the background (expected the complete answer, done)')
        return dict(ev, answering=answering, ready=ready, stored_in_background=stored_bg)

    def c_bots_quick_visible(self):
        mock('/__e2e/config', {'profiles': True, 'quick': True})
        try:
            force_stop()
            launch()
            new_chat()
            q = d.wait(S['quick'], 20)
            expect(q, '⚡ quick toggle not shown though the bridge offers quick answers')
            expect(self._drawer_has_bots_tab(wait=12), 'no "Chats | Bots" switch in the drawer with two bridge profiles')
            return dict(quick=q.desc or q.rid)
        finally:
            mock('/__e2e/config', {'profiles': False, 'quick': False})
            force_stop()
            launch()

    def _set_routines(self, on):
        """Settings → Chat → "Routines" (this device, default on; routines/enabled.ts), flipped the way a normal user does:
        drawer → Settings, scroll until the switch shows, tap it, Done. The value survives force-stop (AsyncStorage)."""
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        expect(d.tap(S['settings'], 8), 'Settings entry not found in the drawer')
        w, h = d.screen_size()
        node, prev = None, None
        for _ in range(25):
            nodes = d.dump()
            node = d.find('desc:^Routines$', nodes)
            if node:
                break
            shown = [(n.text, n.b) for n in nodes if n.text]
            if shown == prev:
                break
            prev = shown
            d.swipe(w // 2, int(h * 0.7), w // 2, int(h * 0.35), 350)
            time.sleep(0.5)
        expect(node is not None, 'no "Routines" switch in Settings')
        if node.checked != on:
            d.tap_xy(node.cx, node.cy)
            time.sleep(0.6)
            node = d.wait('desc:^Routines$', 5)
            expect(node is not None and node.checked == on, f'the "Routines" switch did not turn {"on" if on else "off"}')
        d.tap(S['settings_done'], 5)
        time.sleep(0.8)
        ensure_app()

    def _routines_via_about(self, shots, prefix, expect_job=None):
        """the way a normal user reaches the Routines screen (no drawer row since Bots v2): the chat menu (⋯) of any Hermes
        chat → "About Hermes" (model, "Does regularly") → its link to the Routines screen"""
        ensure_app()
        expect(d.tap(S['chat_menu'], 8), 'chat menu (⋯) not found or not tappable')
        about = d.wait('text:^About Hermes$|desc:^About Hermes$', 8)
        expect(about, 'no "About Hermes" in the chat menu')
        d.tap_xy(about.cx, about.cy)
        expect(d.wait('id:^bot-info$', 10), '"About Hermes" did not open')
        more = d.wait('id:^bot-info-routines-more$', 20)
        expect(more, 'no way to the routines in "About Hermes"')
        if expect_job:
            expect(d.wait(f'id:^bot-info-routine-{expect_job}$', 5), f'routine {expect_job} not listed in "About Hermes"')
        d.screenshot_jpg(os.path.join(shots, f'{prefix}-about.jpg'))
        d.tap_xy(more.cx, more.cy)

    def c_routines(self):
        """Routines slice 2 against the mock (config.routines): one unread result of the default bot, read-only device"""
        mock('/__e2e/config', {'routines': True})
        shots = os.path.join(self.out, 'routines')
        os.makedirs(shots, exist_ok=True)
        try:
            force_stop()
            launch()
            self._set_routines(True)  # Settings → Chat → "Routines" (default on; an earlier check may have turned it off)
            turns_before = len(mock('/__e2e/turns'))
            self._routines_via_about(shots, 'on', expect_job='e2e000000001')  # the mock's one job (scripts/e2e/mock.mjs ROUTINE_JOB)
            item = d.wait('id:^routines-item-ri_', 15)
            expect(item, 'inbox opened without the unread result card')
            expect(d.find('id:^routines-tab-inbox$'), 'no Inbox tab')
            d.screenshot_jpg(os.path.join(shots, 'inbox.jpg'))
            d.tap_xy(item.cx, item.cy)
            expect(d.wait('id:^routine-result-body$', 15), 'result view did not render the answer')
            expect(d.wait('text:\\[e2e routine result\\]', 8), 'result text not shown')
            d.screenshot_jpg(os.path.join(shots, 'result.jpg'))
            end = time.time() + 8
            while not any(r['method'] == 'PATCH' and r['path'].startswith('/bridge/routines/inbox/ri_') for r in mock('/__e2e/requests')):
                expect(time.time() < end, 'opening the result did not mark it read on the bridge')
                time.sleep(0.4)
            # read-only device: the schedule has no pause / resume / run
            if d.tap('id:^routine-open-schedule$', 5):
                expect(d.wait('text:(?i)weekdays|monday to friday', 10), 'schedule detail not shown')
                expect(not d.find('id:^routine-(pause|resume|run)$'), 'controls shown although the device may only read')
                d.screenshot_jpg(os.path.join(shots, 'schedule-read-only.jpg'))
                expect(d.tap('id:^routines-back$', 5), 'Back not found on the schedule detail')
                # Back returns to the result it came from, not to the schedules list
                expect(d.wait('id:^routine-result-body$', 10), 'Back from the schedule did not return to the result')
            expect(d.tap('id:^routine-continue$', 15), '"Continue in chat" not found')
            expect(d.wait(S['input'], 15), 'no composer after "Continue in chat"')
            time.sleep(1.0)
            d.hide_keyboard()
            d.screenshot_jpg(os.path.join(shots, 'continued-chat.jpg'))
            seeded = [m for msgs in transcripts().values() for m in msgs if '[e2e routine result]' in (m.get('text') or '')]
            expect(seeded, 'no stored chat carries the routine result')
            users = [m for msgs in transcripts().values() if any('[e2e routine result]' in (x.get('text') or '') for x in msgs)
                     for m in msgs if m.get('role') == 'user']
            expect(users and 'E2E morning briefing' in users[0].get('text', ''), f'seeded user message without the routine title: {users[:1]}')
            expect(len(mock('/__e2e/turns')) == turns_before, 'Continue in chat sent a turn on its own')
            return dict(item=item.rid, seeded_messages=len(users) + len(seeded))
        finally:
            mock('/__e2e/config', {'routines': False})
            force_stop()
            launch()

    def c_routines_off(self):
        """Routines on a 0.2 bridge in its default state (no bot enabled, config.routines = 'off'), as a normal user finds
        them: chat menu → "About Hermes" says they are off and links to the Routines screen, which explains how the owner
        turns them on, and its chat button sends one question to Hermes"""
        mock('/__e2e/config', {'routines': 'off'})
        shots = os.path.join(self.out, 'routines')
        os.makedirs(shots, exist_ok=True)
        prompt = 'Which scheduled tasks do you have? A short list: when each one runs and what it does.'
        try:
            force_stop()
            launch()
            self._set_routines(True)
            self._routines_via_about(shots, 'off')
            expect(d.wait('id:^routines-off$', 15), 'the Routines screen shows no "off" explanation')
            expect(d.wait('text:routines enable default', 5), 'the explanation does not name the owner\'s command')
            d.screenshot_jpg(os.path.join(shots, 'off-screen.jpg'))
            expect(d.tap('id:^routines-ask-chat$', 8), 'no chat route on the "off" screen')
            # the question starts a NEW chat of this bot (library/askHermes.ts): never behind the [hui:context] seed of a
            # chat continued from a routine result, which an earlier check may have left open
            end, t = time.time() + 30, None
            while time.time() < end:
                t = next((x for x in reversed(mock('/__e2e/turns')) if x['text'].rstrip().endswith(prompt)), None)
                if t and t['state'] in ('ended', 'done'):
                    break
                time.sleep(0.3)
            expect(t and t['state'] in ('ended', 'done'), f'the question from the "off" screen did not reach Hermes (turn: {_brief(t) if t else "none"})')
            expect('[hui:context]' not in t['text'], 'the question landed in the open continued chat instead of a new chat')
            expect(d.wait(S['input'], 15), 'not back in the chat after asking')
            return dict(route='chat menu > About Hermes', turn=t['state'])
        finally:
            mock('/__e2e/config', {'routines': False})
            force_stop()
            launch()

    def c_routines_hidden(self):
        """Settings → Chat → "Routines" off on a bridge that offers them (config.routines): "About Hermes" keeps name and
        model but has no routines part, the app asks the job API nothing, and a deep link to the Routines screen shows the
        short explanation whose "Turn on Routines" brings the screen back"""
        mock('/__e2e/config', {'routines': True})
        shots = os.path.join(self.out, 'routines')
        os.makedirs(shots, exist_ok=True)
        try:
            force_stop()
            launch()
            self._set_routines(False)
            since = time.time() * 1000
            ensure_app()
            expect(d.tap(S['chat_menu'], 8), 'chat menu (⋯) not found or not tappable')
            about = d.wait('text:^About Hermes$|desc:^About Hermes$', 8)
            expect(about, 'no "About Hermes" in the chat menu (it stays without routines)')
            d.tap_xy(about.cx, about.cy)
            expect(d.wait('id:^bot-info$', 10), '"About Hermes" did not open')
            expect(d.wait('text:^Model$', 5), '"About Hermes" lost its model row')
            time.sleep(2.0)  # what a list request would need to show up
            expect(not d.find('id:^bot-info-routines(-more)?$|id:^bot-info-routine-|text:^Does regularly$'), 'routines part shown although Routines are off')
            d.screenshot_jpg(os.path.join(shots, 'hidden-about.jpg'))
            d.sh('input keyevent KEYCODE_BACK')  # close the sheet
            time.sleep(0.6)
            link = f'{SCHEME}://routines'
            d.adb('shell', 'read l; am start -a android.intent.action.VIEW -d "$l" ' + PKG, inp=link + '\n', timeout=30)
            expect(d.wait('id:^routines-hidden$', 15), 'the deep link to the Routines screen shows no explanation while Routines are off')
            expect(not d.find('id:^routines-tab-inbox$|id:^routines-item-ri_'), 'Routines screen content shown although Routines are off')
            d.screenshot_jpg(os.path.join(shots, 'hidden-screen.jpg'))
            asked = [r for r in mock('/__e2e/requests') if r['t'] >= since and (r['path'].startswith('/api/jobs') or r['path'].startswith('/bridge/routines/'))]
            expect(not asked, f'the app asked the routines API although Routines are off: {[r["path"] for r in asked][:5]}')
            expect(d.tap('id:^routines-enable$', 8), 'no "Turn on Routines" on the explanation')
            expect(d.wait('id:^routines-tab-inbox$|id:^routines-item-ri_', 20), '"Turn on Routines" did not bring the Routines screen back')
            d.tap('id:^routines-done$', 5)
            return dict(about='no routines part', deep_link='explanation', requests_while_off=len(asked))
        finally:
            mock('/__e2e/config', {'routines': False})
            force_stop()
            launch()
            try:
                self._set_routines(True)  # the default for the checks after this one
            except Exception:
                pass

    def c_reminder(self):
        """A reminder made by Hermes' cron tool (mock: the v0.22.2 wrapper rows, `deliver: bot-chat` as the skill asks): the
        card says it was set and that it arrives in the chat "Hermes", and "Also remind me on this device" schedules a local notification whose state
        the card reads back after a force-stop"""
        shots = os.path.join(self.out, 'reminder')
        os.makedirs(shots, exist_ok=True)
        new_chat()
        text = 'Remind me tomorrow at 9 to buy tea'
        send(text)
        wait_answer(text, expected_for(text), 30)
        # the card comes from the stored tool detail, loaded after the turn
        card = d.wait('desc:^Reminder set · ', 20)
        expect(card, 'no reminder card after a successful cron create')
        expect('It arrives as a message in the chat "Hermes".' in (card.desc or ''), f'the card does not say where the reminder goes: {card.desc!r}')
        expect(d.find('text:^Change$') and d.find('text:^Delete$'), 'Change / Delete missing on the reminder card')
        d.screenshot_jpg(os.path.join(shots, 'card.jpg'))
        expect(d.tap('text:^Also remind me on this device$', 8), 'no "Also remind me on this device" on a one-shot reminder (Android)')
        expect(d.wait('text:^This device reminds you too: ', 10), 'the device copy was not confirmed on the card')
        expect(not d.find('text:^Also remind me on this device$'), 'the device button is still offered after it was set')
        d.screenshot_jpg(os.path.join(shots, 'device-set.jpg'))
        alarms = d.sh('dumpsys alarm') or ''
        scheduled = PKG in alarms
        force_stop()
        launch()
        again = d.wait('text:^This device reminds you too: ', 20)
        if not again:
            w, h = d.screen_size()
            d.swipe(w // 2, int(h * 0.65), w // 2, int(h * 0.35))
            again = d.wait('text:^This device reminds you too: ', 6)
        expect(again, 'after force-stop the card no longer knows the device reminder (scheduled notification lost?)')
        expect(not d.find('text:^Also remind me on this device$'), 'after force-stop the card offers the device reminder again (would set it twice)')
        return dict(card=card.desc, alarm_listed=scheduled)

    def c_bots(self):
        """Bots as contacts (bots/, docs/BOTS-SERVER.md) against the mock with two profiles: Bots tab → Research → its
        "Bot Chat" (created once, adopted afterwards) → a turn bound to that session → an approval that names the bot
        (once / always / deny, no "for this task"), "Waiting for you" in the drawer while it waits, always-allow with
        its confirm step → the answer; the Bot Chat never shows up under Chats"""
        mock('/__e2e/config', {'profiles': True, 'quick': False})
        shots = os.path.join(self.out, 'bots')
        os.makedirs(shots, exist_ok=True)
        hello, ask = 'e2e bots hello', 'e2e approval for the bot'
        try:
            force_stop()
            launch()
            self._open_bot('research', 'Research', shot='bots-drawer')
            d.screenshot_jpg(os.path.join(shots, 'botchat-empty.jpg'))
            expect(d.find(S['new_chat']) is None, '"New chat" in a bot chat (one thread per bot)')
            creates = [q for q in mock('/__e2e/requests') if q['method'] == 'POST' and q['path'] == '/p/research/api/sessions']
            expect(len(creates) == 1, f'{len(creates)} Bot Chat requests for one open')
            bc = [x for x in mock('/__e2e/sessions') if x['title'] == 'Bot Chat' and x.get('profile') == 'research']
            expect(len(bc) == 1, f'{len(bc)} Bot Chat sessions on the server')
            sid = bc[0]['id']
            send(hello)
            t = wait_turn(hello, lambda t: t['state'] == 'ended', 30, 'the bot turn')
            expect(t['profile'] == 'research' and t['sid'] == sid, f'turn went to profile {t["profile"]} / session {t["sid"]} (Bot Chat {sid})')
            wait_answer(hello, expected_for(hello), 20)
            # approval in the bot's chat
            send(ask)
            card = d.wait('text:^Research wants to run something$', 20)
            expect(card, 'no approval card naming the bot')
            ns = d.dump()
            expect(d.find('desc:^Always allow similar commands for Research', ns), 'no per-bot "Always allow"')
            expect(d.find('text:^For this task$', ns) is None, '"For this task" offered in a bot chat')
            expect(d.find('text:^Research has been waiting for you since ', ns) or d.find('desc:^Research has been waiting for your answer', ns), 'no "waiting since" line')
            d.screenshot_jpg(os.path.join(shots, 'approval.jpg'))
            # "Waiting for you" in the drawer while Hermes waits
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            w = d.wait(S['bots_waiting'], 8)
            expect(w, 'no "Waiting for you" row in the Bots tab while the approval waits')
            d.screenshot_jpg(os.path.join(shots, 'drawer-waiting.jpg'))
            d.tap_xy(w.cx, w.cy)
            expect(d.wait('text:^Research wants to run something$', 10), '"Waiting for you" did not bring back the card')
            # always (this bot only): high risk → one confirm step
            expect(d.tap('desc:^Always allow similar commands for Research', 8), 'Always allow not tappable')
            yes = d.wait('text:^Yes, always allow for Research$|desc:^Yes, always allow for Research$', 6)
            expect(yes, 'no confirm step for "always" at high risk')
            d.tap_xy(yes.cx, yes.cy)
            t2 = wait_turn(ask, lambda t: (t.get('approval') or {}).get('choice') is not None, 15, 'the approval answer')
            expect(t2['approval']['choice'] == 'always', f'answered {t2["approval"]["choice"]!r} (expected always)')
            wait_answer(ask, expected_for(ask), 30)
            # the Bot Chat is not a chat in the Chats tab; opening the bot again is the same thread
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            expect(d.tap(S['tab_chats'], 8), 'no Chats tab')
            time.sleep(0.8)
            # drawer rows carry "<title>, <source>" as their label; the chat behind the drawer only has the bubble text
            expect(d.find('desc:^Bot Chat, ') is None and d.find('desc:^' + re.escape(hello) + ', ') is None, 'the Bot Chat is listed under Chats')
            d.screenshot_jpg(os.path.join(shots, 'drawer-chats.jpg'))
            d.sh('input keyevent 4')
            time.sleep(0.8)
            self._open_bot('research', 'Research')
            creates = [q for q in mock('/__e2e/requests') if q['method'] == 'POST' and q['path'] == '/p/research/api/sessions']
            expect(len(creates) == 1, f'opening the bot again asked the server again ({len(creates)} requests)')
            expect(d.find('text:' + re.escape(expected_for(hello)[:30])), 'the earlier answer is not in the Bot Chat')
            return dict(session=sid, approval=t2['approval']['choice'], shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'profiles': False, 'quick': False})
            force_stop()
            launch()

    def c_bots_create(self):
        """Creating a bot (bots/create, docs/BOTS-SERVER.md "Creating bots from the app") against the mock: the Bots tab
        appears for a device that may create bots even with no bot yet, "New bot" → the role list → "Deals & prices"
        with prefilled fields → one POST /bridge/bots → the new bot's Bot Chat opens with "Scout is ready" and the role's
        starters; the bot is in the roster afterwards"""
        mock('/__e2e/config', {'botsCreate': 'allowed', 'profiles': False})
        shots = os.path.join(self.out, 'bots-create')
        os.makedirs(shots, exist_ok=True)
        try:
            force_stop()
            launch()
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            tab = None
            for _ in range(3):  # GET /bridge/bots answers after the drawer opened the first time
                tab = d.wait(S['tab_bots'], 8)
                if tab:
                    break
                d.sh('input keyevent 4')
                time.sleep(1.0)
                d.tap(S['chats'], 8)
            expect(tab, 'no "Chats | Bots" switch for a device that may create bots')
            d.tap_xy(tab.cx, tab.cy)
            expect(d.wait('id:^bots-empty$', 8), 'no "Your own bots" box while only Hermes exists')
            expect(d.tap('id:^bots-new$', 8), 'no "New bot" button')
            expect(d.wait('id:^bot-create-role-deals$', 10), 'no role list')
            d.screenshot_jpg(os.path.join(shots, 'roles.jpg'))
            expect(d.find('id:^bot-create-blank$'), 'no "empty agent" link')
            d.tap('id:^bot-create-role-deals$', 4)
            name = d.wait('id:^bot-create-name$', 8)
            expect(name and name.text == 'Scout', f'name field not prefilled with Scout ({name.text if name else None!r})')
            d.screenshot_jpg(os.path.join(shots, 'form.jpg'))
            btn = d.wait('id:^bot-create-submit$', 6)
            if not btn:  # below the fold on a small screen
                w, h = d.screen_size()
                d.swipe(w // 2, int(h * 0.75), w // 2, int(h * 0.3))
                btn = d.wait('id:^bot-create-submit$', 6)
            expect(btn, 'no create button')
            d.tap_xy(btn.cx, btn.cy)
            ready = d.wait('text:^Scout is ready$', 20)
            expect(ready, 'the new bot\'s chat did not open with "Scout is ready"')
            expect(d.wait('text:^Compare three robot vacuums up to €400$', 6), 'no starter of the deals role')
            d.screenshot_jpg(os.path.join(shots, 'ready.jpg'))
            posts = [q for q in mock('/__e2e/requests') if q['method'] == 'POST' and q['path'] == '/bridge/bots']
            expect(len(posts) == 1, f'{len(posts)} create requests for one tap')
            chats = [q for q in mock('/__e2e/requests') if q['method'] == 'POST' and q['path'] == '/p/scout/api/sessions']
            expect(len(chats) == 1, f'{len(chats)} Bot Chat requests for the new bot')
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            expect(d.wait('id:^bot-row-scout$', 8), 'the new bot is not in the Bots tab')
            d.screenshot_jpg(os.path.join(shots, 'roster.jpg'))
            d.sh('input keyevent 4')
            return dict(created='scout', shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'botsCreate': False})
            force_stop()
            launch()

    def c_reminder_delivered(self):
        """The normal-user answer to "remind me tomorrow at 9" (bots/, docs/BOTS-SERVER.md): the job fires into the default
        bot's "Bot Chat" (mock /__e2e/fire-reminder, as Hermes does with `deliver: bot-chat`). Without extra bots the drawer
        lists that thread as "Hermes"; opening it shows the reminder text under a quiet marker, never as the user's bubble"""
        shots = os.path.join(self.out, 'reminder')
        os.makedirs(shots, exist_ok=True)
        fired = mock('/__e2e/fire-reminder', {'name': 'Buy tea', 'text': 'Time to buy tea.'})
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        expect(d.find(S['tab_bots']) is None, 'a Bots tab on the default bridge')
        row = None
        for _ in range(3):  # the drawer looks the thread up when it opens: reopen once if the first look was early
            row = d.wait('desc:^Hermes, App$', 10)  # the row ("<title>, <source>"), not the header's "Hermes, choose model"
            if row:
                break
            d.sh('input keyevent 4')  # closes the drawer
            time.sleep(1.0)
            ensure_app()  # never leave the app if the drawer was not open
            d.tap(S['chats'], 8)
        expect(row, 'the default bot\'s thread with the fired reminder is not in the drawer')
        d.screenshot_jpg(os.path.join(shots, 'delivered-drawer.jpg'))
        d.tap_xy(row.cx, row.cy)
        # the marker is one accessible element: its label carries the text (Android does not expose the inner TextView)
        text = d.wait('text:^Time to buy tea\\.$|desc:Time to buy tea\\.', 20)
        expect(text, 'the reminder text is not shown in the thread')
        expect(d.find('text:^\\[Cronjob') is None, 'the injected cron header is shown as a message')
        expect(d.find('text:Buy tea|desc:Buy tea') is not None, 'no marker naming the reminder')
        d.screenshot_jpg(os.path.join(shots, 'delivered-thread.jpg'))
        return dict(session=fired['sessionId'])

    def c_cold_start(self):
        times = []
        for _ in range(3):
            force_stop()
            time.sleep(1.5)
            out = d.sh(f'am start -W -n {COMPONENT}')
            m = re.search(r'TotalTime: (\d+)', out)
            expect(m, f'am start -W: {out.strip()[-200:]}')
            times.append(int(m[1]))
            expect(d.wait(S['input'], 20), 'composer not shown after a cold start')
        self.r.metric('cold_start_ms', times)
        expect(max(times) < 5000, f'cold start {times} ms')
        return dict(ms=times)

    def c_logcat(self):
        crash = [x for x in d.adb('logcat', '-d', '-b', 'crash', timeout=30).split('\n') if x.strip() and not x.startswith('---------')]
        main = d.adb('logcat', '-d', '-v', 'threadtime', timeout=60)
        with open(os.path.join(self.out, 'logcat-main.txt'), 'w') as f:
            f.write(main)
        with open(os.path.join(self.out, 'logcat-crash.txt'), 'w') as f:
            f.write('\n'.join(crash))
        lines = main.split('\n')
        fatal = [x for x in lines if 'FATAL EXCEPTION' in x or f'ANR in {PKG}' in x]
        rn_err = [x for x in lines if re.search(r' E ReactNativeJS', x)]
        rean = sum('synchronouslyUpdateUIProps failed' in x for x in lines)
        rean_gesture = sum('setGestureState in non-worklet' in x for x in lines)
        ours = [x for x in crash if PKG in x]
        stats = dict(crash_lines=len(crash), crash_lines_app=len(ours), fatal=len(fatal), rn_errors=len(rn_err),
                     reanimated_sync_failed=rean, reanimated_set_gesture_state=rean_gesture, main_lines=len(lines))
        self.r.metric('logcat', stats)
        expect(not ours and not fatal, f'crash/ANR in the log: {(ours or fatal)[:2]}')
        expect(not rn_err, f'{len(rn_err)} ReactNativeJS errors, first: {rn_err[0][-160:] if rn_err else ""}')
        expect(rean <= int(os.environ.get('E2E_MAX_REANIMATED', '0')), f'{rean}× Reanimated "synchronouslyUpdateUIProps failed"')
        return stats

    def c_live(self, link):
        """2 harmless turns against a real bridge (fresh install, link never printed), the chat deleted in Hermes afterwards"""
        self.c_install()
        self.pair(link, 'live')
        link = None
        prompts = [('Reply with exactly the word pong and nothing else.', r'pong'), ('What is 2 plus 3? Reply with just the number.', r'\b5\b')]
        new_chat()
        got, conv = [], None
        before = set(transcripts())  # chats synced from Hermes (earlier runs) may hold the same prompts
        for p, rx in prompts:
            send(p)
            end = time.time() + 120
            ans = None
            while time.time() < end:
                hits = [h for h in answers_for(p) if (h[0] == conv if conv else h[0] not in before)]
                if hits and finished(hits[-1][2]):
                    ans = hits[-1][2]
                    break
                time.sleep(2)
            conv = conv or (hits[-1][0] if hits else None)
            expect(ans and ans.get('status') == 'done', f'live answer to "{p[:30]}": {ans and ans.get("status")}')
            expect(re.search(rx, ans['text'], re.I), f'live answer to "{p[:30]}" unexpected: {ans["text"][:80]!r}')
            got.append(len(ans['text']))
            time.sleep(2)
        self._delete_this_chat(prompts[0][0], conv)
        return dict(answers_chars=got)

    def _shot(self, name):
        os.makedirs(os.path.join(self.out, 'share'), exist_ok=True)
        return os.path.relpath(d.screenshot_jpg(os.path.join(self.out, 'share', f'{name}.jpg')), self.out)

    def demo_start(self, steps):
        """fresh install (pm clear before): first-start onboarding → "Try it first (demo)" → consent / later / start chat
        until the composer shows; the taps go to `steps`"""
        launch_any = d.sh(f'cmd package resolve-activity --brief -c android.intent.category.LAUNCHER {PKG}').strip().split('\n')[-1].strip()
        d.sh(f'am start -n {launch_any}')
        n = d.wait(S['look_around'], 30)
        expect(n, 'first-start onboarding without "Try it first (demo)"')
        d.tap_xy(n.cx, n.cy)
        end = time.time() + 45
        # the composer is in the tree while the onboarding (its last step "All set" / "Start an empty chat") still covers it:
        # done only when no onboarding button is left (its "Back" sits where the drawer button is)
        keys = ('consent', 'later', 'start_chat', 'look_around')
        def covered(ns):
            return not d.find(S['input'], ns) or any(d.find(S[k], ns) for k in keys)
        while time.time() < end and covered(d.dump()):
            ns = d.dump()
            for key in ('consent', 'later', 'start_chat'):
                b = d.find(S[key], ns)
                if b and b.enabled:
                    d.tap_xy(b.cx, b.cy)
                    steps.append(key)
                    time.sleep(1.0)
                    break
            else:
                time.sleep(0.7)
        expect(not covered(d.dump()), f'no composer after the demo onboarding, or the onboarding still covers it (steps {steps})')

    def c_demo_live(self):
        """offline demo, no Hermes (0.2): a fresh install shows no "New in this version" sheet; the live barbecue list is
        pinned in the tray, a tick waits on the device and rides along with the follow-up, whose patch renders as the
        v3 receipt (v2 is the tick; not the callout); "What do you remember about me?" lists the demo memory; the drawer has the
        Skills & memory row. English, light. App data is cleared afterwards (fresh install for the pairing check)."""
        steps, shots = [], []
        force_stop()
        d.sh(f'pm clear {PKG}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        try:
            self.demo_start(steps)
            time.sleep(2.0)  # the sheet would open ~0.7 s after the chat settled
            expect(not d.find('id:^whatsnew-dismiss$'), 'the "New in this version" sheet showed on a fresh install')
            new_chat()
            first = 'Keep a shopping list for the barbecue'  # adb input cannot type the apostrophe of the sample chip
            send(first)
            time.sleep(2)
            expect(d.wait(S['stop'], 60, gone=True), 'the live list answer did not finish')
            expect(d.wait('desc:^Live card Saturday barbecue, 0 of 7', 15), 'no live card row in the tray for the demo list')
            self.shot('demo-live-1-list')
            shots.append('shots/demo-live-1-list.jpg')
            item = d.wait_stable('desc:Sausages, open$', 10)
            expect(item, 'live list item "Sausages" not shown')
            d.tap_xy(item[0].cx, item[0].cy)
            expect(d.wait('desc:^Live card Saturday barbecue, 1 of 7 · 1 change waiting', 6), 'the tray does not show the waiting tick')
            second = 'Add charcoal and halloumi, we already have tomatoes'
            send(second)
            time.sleep(2)
            expect(d.wait(S['stop'], 60, gone=True), 'the live patch answer did not finish')
            expect(d.wait('text:sent along$', 10), 'no "sent along" line under the follow-up (the tick did not go with it)')
            expect(d.wait('desc:^Open Saturday barbecue, version 3$', 10), 'the patch did not render as the v3 receipt (v2 = the user\'s tick)')
            expect(not d.find('text:^Saturday barbecue updated$'), 'the patch callout is shown instead of the receipt')
            expect(d.wait('desc:^Live card Saturday barbecue, 2 of 9', 10), 'the tray does not show 2 of 9 (the tick kept, tomatoes ticked, 2 added)')
            self.shot('demo-live-2-receipt')
            shots.append('shots/demo-live-2-receipt.jpg')
            new_chat()
            send('What do you remember about me?')
            time.sleep(2)
            expect(d.wait(S['stop'], 60, gone=True), 'the memory answer did not finish')
            expect(d.wait('text:Dislikes coriander', 10), 'the memory answer does not list the demo memory (generic demo text?)')
            self.shot('demo-live-3-memory')
            shots.append('shots/demo-live-3-memory.jpg')
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            row = d.wait('id:^drawer-library$', 10)
            expect(row, 'no Skills & memory row in the drawer for the demo connection')
            d.tap_xy(row.cx, row.cy)
            expect(d.wait('text:^meal-planner$', 15), 'the drawer row did not open Skills & memory with the demo skills')
            self.shot('demo-live-4-library')
            shots.append('shots/demo-live-4-library.jpg')
            d.sh('input keyevent 4')
            time.sleep(0.8)
        except Fail:
            os.makedirs(os.path.join(self.out, 'shots'), exist_ok=True)
            self.shot('demo_live-fail')
            with open(os.path.join(self.out, 'shots', 'demo_live-fail-ui.txt'), 'w') as f:
                f.write('\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click or n.rid))
            raise
        finally:
            force_stop()
            d.sh(f'pm clear {PKG}')
            d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
            d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        return dict(steps=steps, shots=shots)

    def c_demo_bots(self):
        """offline demo, no Hermes (0.2): the bot mode (onboarding/demo/bots.ts). Drawer "Chats | Bots" → Hermes, Scout,
        Atlas and Lumi with "Waiting for you" → Scout's chat: the delivered price check as a routine marker (never a user
        bubble) and the waiting approval card naming Scout → "Allow once" ends honestly ("Nothing was deleted in the demo")
        and "Waiting for you" is gone → "About Scout" lists its invented routines with the demo note → "New bot" →
        Research role → "Lens is ready" with "On this device only · demo" → a starter gets Lens' own answer → Lens is in
        the roster. English, light. App data is cleared afterwards (fresh install for the pairing check)."""
        steps, shots = [], []
        out = os.path.join(self.out, 'shots')
        os.makedirs(out, exist_ok=True)
        force_stop()
        d.sh(f'pm clear {PKG}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')

        def bots_tab():
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            tab = d.wait(S['tab_bots'], 10)
            if not tab:  # the tap landed while a sheet was still closing: once more
                if not d.find(S['settings']):  # the drawer did not open
                    d.tap(S['chats'], 8)
                    tab = d.wait(S['tab_bots'], 10)
            expect(tab, 'no "Chats | Bots" switch in the demo drawer')
            d.tap_xy(tab.cx, tab.cy)
            expect(d.wait('id:^bot-row-scout$', 10), 'no Scout row in the demo Bots tab')

        def shot(name):
            self.shot(name)
            shots.append(f'shots/{name}.jpg')

        try:
            self.demo_start(steps)
            time.sleep(2.0)
            bots_tab()
            ns = d.dump()
            for key in ('default', 'scout', 'atlas', 'lumi'):
                expect(d.find(f'id:^bot-row-{key}$', ns), f'no row for {key} in the demo Bots tab')
            w = d.find(S['bots_waiting'], ns)
            expect(w, 'no "Waiting for you" row for Scout\'s approval')
            shot('demo-bots-1-roster')
            d.tap_xy(w.cx, w.cy)
            expect(d.wait('desc:^Scout, ', 15), 'Scout\'s chat did not open (header)')
            expect(d.wait('text:^Scout wants to run something$', 15), 'no approval card naming Scout')
            expect(d.find('text:^No server · sample answers$'), 'a demo bot\'s chat lost the demo strip')
            shot('demo-bots-2-approval')
            once = d.wait('desc:^Allow once|text:^Allow once$', 6)
            expect(once, 'no "Allow once" on the demo approval card')
            d.tap_xy(once.cx, once.cy)
            expect(d.wait('text:Nothing was deleted in the demo', 30), 'the allowed demo command did not end with the honest note')
            expect(d.wait(S['stop'], 30, gone=True), 'Scout\'s answer did not finish')
            expect(not d.find('text:^Scout wants to run something$'), 'the approval card stayed after "Allow once"')
            shot('demo-bots-3-allowed')
            # the delivered price check further up: a routine marker, never the injected row as a bubble
            marker = None
            wd, ht = d.screen_size()
            for _ in range(6):
                ns = d.dump()
                expect(d.find('text:^\\[Cronjob ', ns) is None, 'the injected cron row shows as a bubble')
                marker = d.find('desc:^Routine Price check: Fjord Calm 5, ', ns)
                if marker:
                    break
                d.swipe(wd // 2, int(ht * 0.35), wd // 2, int(ht * 0.75))
                time.sleep(0.8)
            expect(marker, 'the delivered price check is not a routine marker')
            shot('demo-bots-3b-marker')
            bots_tab()
            time.sleep(0.8)
            expect(not d.find(S['bots_waiting']), '"Waiting for you" stayed after the approval was answered')
            row = d.find('id:^bot-row-scout$')
            d.tap_xy(row.cx, row.cy)
            head = d.wait('desc:^Scout, ', 15)
            expect(head, 'Scout\'s chat did not open from its row')
            d.tap_xy(head.cx, head.cy)
            expect(d.wait('id:^bot-info$', 10), 'no "About Scout" sheet from the header')
            expect(d.wait('id:^bot-info-routine-d0000000001a$', 10), '"About Scout" does not list its price check routine')
            expect(d.find('id:^bot-info-demo$'), '"About Scout" has no demo note (invented routines)')
            shot('demo-bots-4-about')
            d.sh('input keyevent 4')
            time.sleep(0.8)
            bots_tab()
            expect(d.tap('id:^bots-new$', 8), 'no "New bot" button in the demo')
            expect(d.wait('id:^bot-create-role-research$', 10), 'no role list')
            expect(d.find('text:^Demo: the bot stays on this device'), 'the role step does not say the bot stays on this device')
            d.tap('id:^bot-create-role-research$', 4)
            name = d.wait('id:^bot-create-name$', 8)
            expect(name and name.text == 'Lens', f'name field not prefilled with Lens ({name.text if name else None!r})')
            btn = d.wait('id:^bot-create-submit$', 6)
            if not btn:  # below the fold on a small screen
                wd, ht = d.screen_size()
                d.swipe(wd // 2, int(ht * 0.75), wd // 2, int(ht * 0.3))
                btn = d.wait('id:^bot-create-submit$', 6)
            expect(btn, 'no create button')
            d.tap_xy(btn.cx, btn.cy)
            expect(d.wait('text:^Lens is ready$', 15), 'the new demo bot\'s chat did not open with "Lens is ready"')
            expect(d.find('text:^On this device only · demo$'), 'the new demo bot does not say it is on this device only')
            shot('demo-bots-5-ready')
            starter = d.wait('text:^What is new with heat pumps\\?$', 6)
            expect(starter, 'no research starter on the new bot\'s start screen')
            d.tap_xy(starter.cx, starter.cy)
            time.sleep(2)
            expect(d.wait(S['stop'], 60, gone=True), 'Lens\' answer did not finish')
            expect(d.wait('text:^Short first', 10), 'Lens did not answer in its role (research)')
            shot('demo-bots-6-answer')
            bots_tab()
            expect(d.wait('id:^bot-row-lens$', 8), 'the new demo bot is not in the roster')
            d.sh('input keyevent 4')
            time.sleep(0.8)
        except Fail:
            self.shot('demo_bots-fail')
            with open(os.path.join(out, 'demo_bots-fail-ui.txt'), 'w') as f:
                f.write('\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click or n.rid))
            raise
        finally:
            force_stop()
            d.sh(f'pm clear {PKG}')
            d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
            d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        return dict(steps=steps, shots=shots)


    def c_chip_text(self):
        """offline demo, en/de/es: the short suggestion chip under the barbecue list answer ("What can you do?", "Was
        kannst du alles?", "¿Qué sabes hacer?") is in view. Evidence per language: the chip's bounds and a shot
        (shots/chip-<lang>.jpg) to check it is not cut (Android lost 0.1 dp on "What can you do?", ui/lib/chipText.ts).
        A build that logs `[chip-probe]` lines (onTextLayout) adds them to the evidence. App data is cleared afterwards."""
        prompts = {'en': 'Keep a shopping list for the barbecue', 'de': 'Einkaufsliste fuers Grillen am Samstag',
                   'es': 'Lista de la compra para la barbacoa del sabado'}  # adb input types ASCII only; all route to liveList
        chips = {'en': 'What can you do?', 'de': 'Was kannst du alles?', 'es': '¿Qué sabes hacer?'}
        locales = {'en': 'en-US', 'de': 'de-DE', 'es': 'es-ES'}
        steps, ev = [], {}
        force_stop()
        d.sh(f'pm clear {PKG}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        try:
            self.demo_start(steps)
            for lang in ('en', 'de', 'es'):
                d.sh(f'cmd locale set-app-locales {PKG} --locales {locales[lang]}')
                force_stop()
                d.adb('logcat', '-c', timeout=20)
                launch()
                new_chat()
                send(prompts[lang])
                time.sleep(2)
                expect(d.wait(S['stop'], 60, gone=True), f'{lang}: the demo answer did not finish')
                time.sleep(1.5)
                chip = d.wait_stable('desc:' + re.escape(chips[lang]), 15)
                node = chip[0] if chip else None
                expect(node, f'{lang}: no suggestion chip "{chips[lang]}" in view')
                self.shot(f'chip-{lang}')
                log = d.adb('logcat', '-d', '-s', 'ReactNativeJS:I', timeout=30)
                probe = [x.split('[chip-probe', 1)[1] for x in log.split('\n') if '[chip-probe' in x and chips[lang] in x]
                ev[lang] = dict(bounds=node.b, desc=node.desc[:60], probe=probe[-4:])
            return ev
        finally:
            # like demo_live: a fresh install for the pairing check, with the notification permission granted again (pm
            # clear drops it, and its system dialog would cover the next checks)
            force_stop()
            d.sh(f'pm clear {PKG}')
            d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
            d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')

    def c_demo_wsp_card(self):
        """offline demo, no Hermes: the web research sample answer → its "Web search" timeline row opens the web result
        card (provider and routing, results with the answer's citation numbers), "Load web page" the pages-read card.
        English and German, light and dark. App data is cleared afterwards (fresh install for the pairing check)."""
        prompts = {'en': 'Research jet lag tips for a flight east, with sources.', 'de': 'Recherchiere Jetlag-Tipps mit Quellen'}  # adb input types ASCII only
        rx = {
            'en': dict(tech='desc:^Technical details$', close='desc:^Close$', panel='desc:^Tools and activity,', search='desc:^Web search,', pages='desc:^Load web page,', how='text:^How it searched$',
                       read='text:^How it read the pages$', cited='text:cited in the answer$', sources='text:^3 sources$'),
            'de': dict(tech='desc:^Technische Details$', close='desc:^Schlie(ß|ss)en$', panel='desc:^Werkzeuge und Ablauf,', search='desc:^Websuche,', pages='desc:^Webseite laden,', how='text:^So wurde gesucht$',
                       read='text:^So wurde gelesen$', cited='text:in der Antwort zitiert$', sources='text:^3 Quellen$'),
        }
        shots, steps, trace = {}, [], []
        t0, tag = time.time(), 'setup'

        def mark(what):
            trace.append(f'{time.time() - t0:.1f}s {tag} {what}')

        w, h = d.screen_size()

        def reveal(spec, what, tries=10, min_h=90):
            """the node for spec once it is fully inside the visible list: clear of the header / demo banner on top and of the
            composer at the bottom (a row cut off there has bounds, but a tap on its centre hits the banner). Scrolls the list
            by a moderate swipe in the middle of the screen until it is. A node cut off at the list's edge is a sliver (the
            panel and the rows are 100-200 px tall), so it must also be at least min_h high."""
            for _ in range(tries):
                hits = d.wait_stable(spec, 4)
                n = d.find(spec, hits) if hits else None
                banner = [x.b[3] for x in d.dump() if x.text == 'DEMO']
                top, bottom = (max(banner) + 12 if banner else int(h * 0.16)), int(h * 0.85)
                if n and n.b[1] >= top and n.b[3] <= bottom and n.h >= min_h:
                    return n
                # finger down shows earlier content (the node is above or not in the tree), finger up later content
                down = not (n and n.b[3] > bottom and n.b[1] > top)
                d.swipe(w // 2, int(h * (0.45 if down else 0.6)), w // 2, int(h * (0.6 if down else 0.45)), 600)
                time.sleep(0.6)
            raise Fail(f'{what} not found fully in view after {tries} scrolls (last {n and n.b})')

        force_stop()
        d.sh(f'pm clear {PKG}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        try:
            self.demo_start(steps)
            for lang, night in (('en', False), ('en', True), ('de', False), ('de', True)):
                tag, L = f'{lang}-{"dark" if night else "light"}', rx[lang]
                mark('start')
                d.sh(f'cmd locale set-app-locales {PKG} --locales {"de-DE" if lang == "de" else "en-US"}')
                d.sh(f'cmd uimode night {"yes" if night else "no"}')
                force_stop()
                launch()
                new_chat()
                send(prompts[lang])
                time.sleep(2)
                expect(d.wait(S['stop'], 60, gone=True), f'{tag}: the demo answer did not finish')
                expect(d.wait(L['sources'], 20), f'{tag}: no sources block under the answer')
                mark('answer done')
                self.shot(f'wsp-{tag}-answer')
                # the list ends at the answer's bottom: the tools panel sits above it, scroll up to it
                panel = reveal(L['panel'], f'{tag}: tools panel')
                mark(f'panel at {panel.b}')
                d.tap_xy(panel.cx, panel.cy)
                time.sleep(0.8)
                row = reveal(L['search'], f'{tag}: web search row')
                mark(f'search row at {row.b}')
                d.tap_xy(row.cx, row.cy)
                expect(d.wait(L['how'], 10), f'{tag}: the web result card did not open')
                mark('card open')
                expect(d.find(L['cited']), f'{tag}: no "cited in the answer" line on the card')
                expect(d.find('desc:^(Provider|Anbieter): Brave · |text:^Brave · '), f'{tag}: provider line missing')
                self.shot(f'wsp-{tag}-card-search')
                # inside the sheet and well above the bottom edge: a swipe that starts low (or is fast) can be taken by the
                # launcher as the home gesture and sends the app to the background
                d.swipe(w // 2, int(h * 0.62), w // 2, int(h * 0.38), 700)
                time.sleep(0.8)
                expect(d.find(L['close']), f'{tag}: the card is gone after scrolling it (system gesture?)')
                self.shot(f'wsp-{tag}-card-search-scrolled')
                # the raw tool facts (tool name, call ID, input JSON) sit behind a closed "Technical details" disclosure
                expect(not d.find('text:web_search_plus'), f'{tag}: raw tool details are shown without opening "Technical details"')
                tech = None
                for _ in range(4):
                    tech = d.find(L['tech'])
                    if tech and tech.b[3] < int(h * 0.88):
                        break
                    d.swipe(w // 2, int(h * 0.62), w // 2, int(h * 0.38), 700)
                    time.sleep(0.6)
                expect(tech, f'{tag}: no "Technical details" disclosure under the card')
                d.tap_xy(tech.cx, tech.cy)
                time.sleep(0.8)
                expect(d.find('text:web_search_plus'), f'{tag}: "Technical details" did not show the tool facts')
                self.shot(f'wsp-{tag}-card-technical')
                d.sh('input keyevent 4')
                expect(d.wait(L['how'], 8, gone=True) and d.find(S['input']), f'{tag}: Back did not close the card (or left the app)')
                row = reveal(L['pages'], f'{tag}: pages row')
                d.tap_xy(row.cx, row.cy)
                expect(d.wait(L['read'], 10), f'{tag}: the pages-read card did not open')
                self.shot(f'wsp-{tag}-card-pages')
                shots[tag] = [f'shots/wsp-{tag}-{k}.jpg' for k in ('answer', 'card-search', 'card-search-scrolled', 'card-pages')]
                d.sh('input keyevent 4')
                time.sleep(0.8)
        except Fail:
            # the state at the moment of the failure, before the cleanup below throws the app away
            os.makedirs(os.path.join(self.out, 'shots'), exist_ok=True)
            self.shot(f'demo_wsp_card-fail-{tag}')
            with open(os.path.join(self.out, 'shots', f'demo_wsp_card-fail-{tag}-ui.txt'), 'w') as f:
                f.write('\n'.join(trace) + '\n\n' + '\n'.join(repr(n) for n in d.dump() if n.text or n.desc or n.click or n.rid))
            raise
        finally:
            d.sh('cmd uimode night no')
            force_stop()
            d.sh(f'pm clear {PKG}')
            d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
            d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        return dict(steps=steps, shots=shots, trace=trace)

    def c_share_unpaired(self):
        """first start: the share waits behind onboarding; after "look around" (demo only) the sheet explains pairing,
        "Connect" opens the flow, closing it brings the kept share back. App data is cleared afterwards."""
        shots = {}
        force_stop()
        share_text('https://example.com/e2e-unpaired')
        n = d.wait(S['look_around'], 25)
        expect(n, 'first-start onboarding did not open on a cold start by a share')
        expect(d.find(S['share_send']) is None and d.find(S['share_pair']) is None, 'share sheet shown over the onboarding')
        shots['onboarding'] = self._shot('unpaired-1-onboarding')
        d.tap_xy(n.cx, n.cy)
        end, steps = time.time() + 40, []
        while time.time() < end and not d.find(S['share_pair']):
            ns = d.dump()
            for key in ('consent', 'later', 'start_chat'):
                b = d.find(S[key], ns)
                if b and b.enabled:
                    d.tap_xy(b.cx, b.cy)
                    steps.append(key)
                    time.sleep(1.0)
                    break
            else:
                time.sleep(0.7)
        expect(d.wait(S['share_pair'], 5), f'no "connect first" sheet after the demo onboarding (steps {steps})')
        expect(d.find('text:^Connect to Hermes first$'), 'pair explanation missing')
        expect(d.find('text:e2e-unpaired'), 'the shared link is not shown in the pair sheet')
        shots['pair'] = self._shot('unpaired-2-pair-sheet')
        d.tap(S['share_pair'], 5)
        expect(d.wait(S['share_pair'], 8, gone=True), 'sheet still shown while the pairing flow is open')
        shots['flow'] = self._shot('unpaired-3-pairing-flow')
        expect(d.tap(S['onboarding_close'], 10), 'close button of the pairing flow not found')
        expect(d.wait(S['share_pair'], 10), 'the kept share did not come back after closing the pairing flow')
        expect(d.find('text:e2e-unpaired'), 'the share that came back is not the shared link')
        d.tap(S['share_cancel'], 5)
        expect(d.wait(S['share_pair'], 5, gone=True), 'Cancel did not close the sheet')
        # back to a fresh install for the pairing check
        force_stop()
        d.sh(f'pm clear {PKG}')
        d.sh(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        return dict(steps=steps, shots=shots)

    def c_share_link(self):
        """app in the background → share a link → sheet → "Summarize" → Send: exactly that message in a new chat"""
        ensure_app()
        d.sh('input keyevent 3')
        time.sleep(1.0)
        url = 'https://example.com/e2e-share-link'
        share_text(url)
        wait_sheet()
        expect(d.find('text:^' + re.escape(url) + '$'), 'the shared link is not shown in the sheet')
        shots = {'sheet': self._shot('link-1-sheet')}
        expect(d.tap(S['share_summarize'], 5), 'Summarize chip not found')
        c = d.wait(S['share_summarize'], 3)
        expect(c and c.checked, 'Summarize chip not checked after the tap')
        shots['intent'] = self._shot('link-2-summarize')
        prompt = f'Summarize this briefly.\n\n{url}'
        mark_sent(prompt)
        d.tap(S['share_send'], 5)
        ev = wait_answer(prompt, expected_for(prompt), 40)
        expect(d.wait(S['share_send'], 3, gone=True), 'sheet still open after Send')
        shots['chat'] = self._shot('link-3-sent')
        return dict(ev, shots=shots)

    def c_share_in_image(self):
        """cold start by an image share → thumbnail in the sheet → Send (new chat): the image goes inline with the
        message (Hermes takes images in the request; only files are uploaded to the bridge), answered once"""
        uri = push_shared('e2e-share.png', _png())
        force_stop()
        share_stream(uri, 'image/png')
        wait_sheet(40)
        expect(d.wait('desc:^e2e-share\\.png$', 5), 'image thumbnail not in the sheet')
        expect(d.find('text:^1 image$'), 'kind label "1 image" missing')
        shots = {'sheet': self._shot('image-1-sheet')}
        before = user_ids()
        d.tap(S['share_send'], 5)
        # prepared images are stored as JPEG (attachments/store.ts prepareImage): match the base name
        hits = new_user_msgs(lambda m: any(a.get('name', '').startswith('e2e-share.') and a.get('kind') == 'image' for a in m.get('attachments') or []), before, 30)
        expect(len(hits) == 1, f'shared image stored in {len(hits)} user message(s)')
        conv, msg = hits[0]
        wait_reply(conv, msg.get('id'))
        expect(not [u for u in mock('/__e2e/uploads') if u['name'].startswith('e2e-share.') and u['mimeType'].startswith('image/')], 'image was uploaded (images go inline)')
        shots['chat'] = self._shot('image-2-sent')
        self.share_conv = conv
        return dict(conv=os.path.basename(conv), shots=shots)

    def c_share_pdf(self):
        """app in the foreground → share a PDF → "Last chat" + own instruction → Send: same chat as the image share"""
        uri = push_shared('e2e-share.pdf', _pdf())
        ensure_app()
        share_stream(uri, 'application/pdf')
        wait_sheet()
        expect(d.find('text:^e2e-share\\.pdf$'), 'PDF file row not in the sheet')
        last = d.wait(S['share_last'], 5)
        expect(last, '"Last chat" target not offered')
        d.tap_xy(last.cx, last.cy)
        expect(d.tap(S['share_note'], 5), 'instruction field not found')
        time.sleep(0.6)
        note = 'e2e pdf note'
        d.type_text(note)
        d.hide_keyboard()
        time.sleep(0.5)
        last = d.find(S['share_last'])
        expect(last and last.checked, '"Last chat" not selected')
        shots = {'sheet': self._shot('pdf-1-sheet-last-chat')}
        before = user_ids()
        d.tap(S['share_send'], 5)
        up = wait_upload('e2e-share.pdf')
        expect(up['mimeType'] == 'application/pdf' and up['head'].startswith('255044462d'), f'upload {up}')
        hits = new_user_msgs(lambda m: m.get('text', '').strip() == note, before, 30)
        expect(len(hits) == 1, f'instruction stored {len(hits)}×')
        conv, msg = hits[0]
        expect(any(a.get('name') == 'e2e-share.pdf' for a in msg.get('attachments') or []), 'PDF not attached to the message')
        if getattr(self, 'share_conv', None):
            expect(conv == self.share_conv, 'PDF went to another chat than the last one (the image share)')
        wait_reply(conv, msg.get('id'))
        shots['chat'] = self._shot('pdf-2-sent')
        return dict(upload=up, conv=os.path.basename(conv), shots=shots)

    def c_share_recreate(self):
        """a share that cold-started the app is not offered again when Android recreates the activity (font size)"""
        force_stop()
        share_text('e2e share recreate')
        wait_sheet(40)
        d.tap(S['share_cancel'], 5)
        expect(d.wait(S['share_send'], 5, gone=True), 'sheet still open after Cancel')
        try:
            d.sh('settings put system font_scale 1.15')
            time.sleep(4)
            ensure_app()
            again = d.wait(S['share_send'], 6)
            shot = self._shot('recreate-after-font-scale')
        finally:
            d.sh('settings put system font_scale 1.0')
            time.sleep(2)
        expect(not again, 'the cancelled share was offered again after the activity was recreated')
        return dict(shot=shot)

    def c_share_cancel(self):
        """Cancel sends nothing"""
        ensure_app()
        text = 'e2e share cancel'
        share_text(text)
        wait_sheet()
        d.tap(S['share_cancel'], 5)
        expect(d.wait(S['share_send'], 5, gone=True), 'sheet still open after Cancel')
        time.sleep(3)
        expect(not [t for t in mock('/__e2e/turns') if text in t['text']], 'a cancelled share reached the bridge')
        expect(not stored_user(lambda m: text in m.get('text', '')), 'a cancelled share was stored as a message')
        return dict(ok=True)

    def c_share_offline(self):
        """offline, nothing is lost: a shared text and a shared image are stored and show "Answer failed" with Retry;
        a shared PDF (needs the bridge upload) either stays in the composer with a notice or is stored with its
        failure – which one is recorded"""
        ensure_app()
        airplane(True)
        time.sleep(2)
        shots = {}
        try:
            text = 'e2e share offline'
            share_text(text)
            wait_sheet()
            d.tap(S['share_send'], 5)
            expect(d.wait(S['failed'], 25), '"Answer failed" not shown for an offline text share')
            expect(stored_user(lambda m: m.get('text', '').strip() == text), 'the offline text share is not stored in the chat')
            shots['text'] = self._shot('offline-1-text-failed')

            uri = push_shared('e2e-offline.png', _png(64, 64))
            share_stream(uri, 'image/png')
            wait_sheet()
            d.tap(S['share_send'], 5)
            end, hits = time.time() + 25, []
            while time.time() < end and not hits:
                hits = stored_user(lambda m: any(a.get('name', '').startswith('e2e-offline.') and a.get('kind') == 'image' for a in m.get('attachments') or []))
                time.sleep(1.0)
            expect(hits, 'the offline image share is not stored in the chat')
            expect(d.wait(S['failed'], 15), '"Answer failed" not shown for an offline image share')
            shots['image'] = self._shot('offline-2-image-failed')

            uri = push_shared('e2e-offline.pdf', _pdf())
            share_stream(uri, 'application/pdf')
            wait_sheet()
            d.tap(S['share_send'], 5)
            end, outcome = time.time() + 40, None
            while time.time() < end and not outcome:
                if d.find('text:^Upload failed – retry or remove the file'):
                    # the share was sent: its bubble waits for the upload (Retry / Cancel), nothing stored yet
                    outcome = 'kept as a send waiting for its upload (chat bubble with Retry)'
                elif d.find(S['share_kept']) or d.find('desc:^e2e-offline\\.pdf, '):
                    # the attachment chip in the composer tray (with its upload error) or the notice
                    outcome = 'kept in the composer (attachment chip with the upload error)'
                elif stored_user(lambda m: any(a.get('name') == 'e2e-offline.pdf' for a in m.get('attachments') or [])):
                    outcome = 'stored in the chat'
                else:
                    time.sleep(0.8)
            shots['pdf'] = self._shot('offline-3-pdf')
            expect(outcome, 'the offline PDF share is neither in the composer nor in the chat')
        finally:
            airplane(False)
        expect(wait_online(20), 'network did not come back')
        time.sleep(1.5)
        if outcome.startswith('kept'):
            # kept on purpose (Composer.receiveShare: never sent half, never dropped). Online again, the user retries the
            # upload on the chip and sends: the PDF must arrive, and the composer is empty again for the next check
            shots['pdf_retry'] = self._finish_kept_pdf()
        return dict(pdf=outcome, shots=shots)

    def shot(self, name):
        """screenshot of a state worth keeping (OUT/shots/<name>.jpg), also when the check passes"""
        try:
            d.screenshot_jpg(os.path.join(self.out, 'shots', f'{name}.jpg'))
        except Exception as e:
            print('screenshot failed:', e)

    def _live_answer(self, prompt, before, timeout=120):
        """the stored answer after the user message that contains prompt (the hand-off prepends a context block), in a
        chat that is not in `before` (conversation files that existed before the send)"""
        end = time.time() + timeout
        while time.time() < end:
            for conv, msgs in transcripts().items():
                if conv in before:
                    continue
                for i, m in enumerate(msgs):
                    if m.get('role') == 'user' and prompt in m.get('text', ''):
                        a = msgs[i + 1] if i + 1 < len(msgs) and msgs[i + 1].get('role') == 'assistant' else None
                        if finished(a):
                            return conv, m, a
            time.sleep(2)
        raise Fail(f'no finished answer to "{prompt[:40]}" after {timeout} s')

    def c_live_bots(self):
        """bot chat: Bots tab → the bot's Bot Chat, its personality in the answer, stored for that bot, ⚡ hidden"""
        self._open_bot(LIVE_BOT, LIVE_BOT_LABEL, shot=f'bots-{LIVE_BOT}')
        ns = d.dump()
        expect(d.find(S['quick'], ns) is None, '⚡ quick toggle shown in a bot chat')
        expect(d.find(S['quick_pill'], ns) is None, '"Quick question" pill shown in a bot chat')
        self.shot('bot-chat-empty')
        p = 'Describe the sea in one sentence.'
        before = set(transcripts())
        send(p)
        conv, _, a = self._live_answer(p, before)
        expect(a.get('status') == 'done', f'bot answer status {a.get("status")}')
        # the chat index (with hermesProfile) lives in AsyncStorage; the header names the chat's bot
        expect(d.find('text:^' + re.escape(LIVE_BOT_LABEL) + '$'), f'header does not name the bot "{LIVE_BOT_LABEL}"')
        if LIVE_BOT_MARK:
            expect(re.search(LIVE_BOT_MARK, a['text'], re.I), f'answer lacks the bot personality: {a["text"][:100]!r}')
        time.sleep(1.5)
        expect(d.find(S['quick']) is None, '⚡ quick toggle shown in the bot chat after the answer')
        self.shot('bot-chat-answer')
        self._delete_this_chat(p, conv)
        return dict(answer=a['text'][:120], chars=len(a['text']))

    def c_live_quick(self):
        """⚡ in a default chat: a quick answer arrives, "Continue with Hermes" opens a Hermes chat that builds on it"""
        new_chat()  # a new chat always starts on the default bot (bots have their own thread in the Bots tab)
        q = d.wait(S['quick'], 20)
        expect(q, '⚡ quick toggle not shown in a default chat')
        self.shot('quick-visible')
        d.tap_xy(q.cx, q.cy)
        expect(d.wait('text:^Quick questions$|text:^Ask briefly', 10), 'quick thread did not open')
        question = 'What is the capital of Australia? One short sentence.'
        send(question)
        ans = d.wait('text:(?i)canberra', 60)
        expect(ans, 'no quick answer naming Canberra on screen within 60 s')
        meta = d.wait('desc:^Quick answer by ', 5)
        self.shot('quick-answer')
        hand = d.wait('desc:^Continue with Hermes$', 8)
        expect(hand, '"Continue with Hermes" not offered under the quick answer')
        before = set(transcripts())  # the hand-off chat is new: it is created with the copied quick turns
        d.tap_xy(hand.cx, hand.cy)
        expect(d.wait(S['input'], 10), 'no composer after "Continue with Hermes"')
        time.sleep(1.0)
        self.shot('handoff-chat')
        follow = 'Which city did that answer name? Reply with the city name only.'
        send(follow)
        conv, u, a = self._live_answer(follow, before)
        expect(a.get('status') == 'done', f'hand-off answer status {a.get("status")}')
        expect(re.search(r'canberra', a['text'], re.I), f'the Hermes chat did not build on the quick answer: {a["text"][:80]!r}')
        self.shot('handoff-answer')
        self._delete_this_chat(follow, conv)
        return dict(meta=(meta.desc if meta else None), handoff_answer=a['text'][:80])

    def _finish_kept_pdf(self):
        """two kept states, both by design and timing-dependent: the PDF waits in the composer draft (its upload had
        failed before the share's send ran) or the share was already sent and its chat bubble waits for the upload
        ("Upload failed – retry or remove the file"). "Tap to retry" on the chip uploads it; the draft then needs Send,
        the waiting send continues by itself. Either way the PDF must end up stored once with an answer."""
        uploaded = lambda: [u for u in mock('/__e2e/uploads') if u['name'] == 'e2e-offline.pdf']  # noqa: E731
        end, chip = time.time() + 15, None
        while time.time() < end and not chip and not uploaded():
            chip = d.find('desc:^e2e-offline\\.pdf, .*Tap to retry$')  # an upload still running online may just finish
            time.sleep(0.5)
        expect(chip or uploaded(), 'the kept PDF has no "Tap to retry" chip and was not uploaded')
        if chip:
            d.tap_xy(chip.cx, chip.cy)
        up = wait_upload('e2e-offline.pdf', 30)
        expect(up['head'].startswith('255044462d'), f'retried upload {up}')
        stored = lambda: stored_user(lambda m: any(a.get('name') == 'e2e-offline.pdf' for a in m.get('attachments') or []))  # noqa: E731
        end, hits, path = time.time() + 30, [], 'the waiting send continued'
        while time.time() < end and not hits:
            hits = stored()
            # only the draft has a Send button (a waiting send shows Stop): one tap, a second one would hit Stop
            btn = None if hits or path != 'the waiting send continued' else d.find(S['send'])
            if btn and d.find('desc:^Remove e2e-offline\\.pdf$'):
                d.tap_xy(btn.cx, btn.cy)
                path = 'sent from the composer'
            time.sleep(1.0)
        expect(len(hits) == 1, f'the retried PDF is stored in {len(hits)} user message(s)')
        conv, msg = hits[0]
        wait_reply(conv, msg.get('id'))
        expect(not d.find('desc:^Remove e2e-offline\\.pdf$'), 'the PDF is still in the composer after sending it')
        return dict(path=path, shot=self._shot('offline-4-pdf-sent'))

    def _delete_this_chat(self, prompt, conv=None):
        """header ⋯ › Delete › "deleted in Hermes too": removes only the chat this stage created (never "Delete all":
        on a real bridge the drawer also lists every other synced app chat)"""
        ensure_app()
        expect(d.tap('desc:^Chat options$', 8), 'chat menu (⋯) not found')
        expect(d.tap('text:^Delete$', 5), '"Delete" not in the chat menu')
        expect(d.wait('text:^The chat is deleted in Hermes too', 6), 'delete dialog does not offer the Hermes deletion')
        expect(d.tap('id:^button1$|text:(?i)^delete$', 5), 'confirm button not found')
        end = time.time() + 15
        # by conversation file when known: after pairing, chats of earlier runs synced from Hermes may hold the same prompt
        gone = (lambda: conv not in transcripts()) if conv else \
            (lambda: not any(m.get('role') == 'user' and prompt in m.get('text', '') for ms in transcripts().values() for m in ms))
        while not gone() and time.time() < end:
            time.sleep(1)
        expect(gone(), 'the live chat is still stored after deleting it')

    # ── main ────────────────────────────────────────────────────────────────────────────────────────────────────
    def run(self, live_link=None):
        a, r = self.args, self.r
        probs = table_problems()
        if probs:
            raise SystemExit('check group table is out of sync: ' + '; '.join(probs))
        r.meta['selection'] = a.label
        r.meta['not_run'] = [] if a.selected is None else [c for c in registered_checks()
                                                           if c not in a.selected and c not in ALWAYS and c not in LIVE_CHECKS]
        r.meta.update(apk=os.path.basename(a.apk), apk_sha256=hashlib.sha256(open(a.apk, 'rb').read()).hexdigest(),
                      started=time.strftime('%Y-%m-%d %H:%M:%S'), boot_s=os.environ.get('E2E_BOOT_S', '?'))
        try:
            self.prepare_device()
            r.meta['device'] = f'{d.sh("getprop ro.product.model").strip()} / Android {d.sh("getprop ro.build.version.release").strip()}'
            r.run('install', 'Clean install', self.c_install, on_fail=self.on_fail)
            self.check('demo_wsp_card', 'Offline demo: web research answer → web result card + pages-read card (en/de, light/dark)', self.c_demo_wsp_card, needs=('install',))
            self.check('demo_live', 'Offline demo 0.2: no What\'s new on a fresh install, live list over two turns (tick rides along, v3 receipt), memory answer, drawer Skills & memory', self.c_demo_live, needs=('install',))
            self.check('chip_text', 'Suggestion chips en/de/es: the short chip under the demo barbecue answer is shown whole (bounds, shot, line-break probe)', self.c_chip_text, needs=('install',))
            self.check('demo_bots', 'Offline demo bot mode: Bots tab with Scout/Atlas/Lumi, "Waiting for you" → Scout\'s approval answered once, About Scout routines, New bot (Research) answers in its role', self.c_demo_bots, needs=('install',))
            self.check('share_unpaired', 'Share before pairing: waits behind onboarding, then "connect first" sheet keeps it', self.c_share_unpaired, needs=('install',))
            r.run('pair', 'Pairing via deep link (one-time code) to the mock', self.c_pair, on_fail=self.on_fail, needs=('install',))
            self.t_paired = time.time()
            self.check('share_link', 'Share a link from the background → sheet → Summarize → sent once', self.c_share_link)
            self.check('share_in_image', 'Share an image on a cold start → thumbnail → sent inline + answered', self.c_share_in_image)
            self.check('share_pdf', 'Share a PDF in the foreground → Last chat + instruction → uploaded + sent there', self.c_share_pdf)
            self.check('share_cancel', 'Share → Cancel sends nothing', self.c_share_cancel)
            self.check('share_recreate', 'A cold-start share is not offered again after an activity recreation', self.c_share_recreate)
            self.check('share_offline', 'Share offline: text and image stored with "Answer failed", PDF kept (composer or chat)', self.c_share_offline)
            self.check('version', 'Version label = versionName · Build versionCode (commit)', self.c_version)
            self.check('bots_quick_hidden', 'No Bots tab, no ⚡ when the bridge offers none; no request loop', self.c_bots_quick_hidden)
            self.check('stream_long', 'Long stream with cards: exact final text, once; gfxinfo', self.c_stream_long)
            self.check('stop', 'Stop mid-stream', self.c_stop)
            self.check('drop_resume', 'Connection cut mid-stream → byte resume, answer exactly once', self.c_drop_resume)
            self.check('drop_recover', 'Cut without byte resume → "Connection interrupted" → "loaded later"', self.c_drop_recover)
            self.check('airplane', 'Airplane mode mid-stream → answer completes exactly once', self.c_airplane)
            self.check('force_stop', 'Force-stop mid-stream → reopen shows the complete answer', self.c_force_stop)
            self.check('offline_retry', 'Offline send → error visible at the bottom → double Retry → one answer', self.c_offline_retry)
            self.check('refused_retry', 'Bridge refuses the send → double Retry → one answer', self.c_refused_retry)
            self.check('not_sent', 'Kill before confirmation → "Not sent" → double "Send again" → one answer', self.c_not_sent)
            self.check('checklist', 'Checklist ticks persist across force-stop', self.c_checklist)
            self.check('live_card', 'Live card: tray, pending tick survives force-stop, rides along with the next message', self.c_live_card)
            self.check('live_patch', 'Live cards phase 2: a watchlist price patch renders as its receipt, a trip opens on its day tabs', self.c_live_patch)
            self.check('share_image', 'Share as image: sheet preview → PNG → system share sheet', self.c_share_image)
            self.check('table_font', 'Table at font scale 1.3 (no wrapped year cells), reset', self.c_table_font)
            self.check('dark', 'Dark mode follows the system', self.c_dark)
            self.check('routines', 'Routines: drawer badge → inbox → result read → read-only schedule → Continue in chat (nothing sent)', self.c_routines)
            self.check('routines_off', 'Routines off on the default bridge: drawer row says Off, screen explains + asks Hermes in the chat', self.c_routines_off)
            self.check('routines_hidden', 'Settings → Routines off: "About Hermes" without routines, no job API request, deep link explains + turns them back on', self.c_routines_hidden)
            self.check('reminder', 'Reminder by the cron tool: card says it arrives in the chat "Hermes", device copy set and still known after force-stop', self.c_reminder)
            self.check('reminder_delivered', 'A fired bot-chat reminder on the default bridge: drawer row "Hermes", the reminder text under a marker (no bubble)', self.c_reminder_delivered)
            self.check('background', 'Background: "… is answering" → "Answer ready"', self.c_background)
            self.check('bots_quick_visible', 'Bots tab + ⚡ when the bridge offers profiles + quick answers', self.c_bots_quick_visible)
            self.check('bots', 'Bots: Bots tab → Bot Chat (once), turn on that session, bot approval card, "Waiting for you", always-allow, not under Chats', self.c_bots)
            self.check('bots_create', 'New bot: Bots tab → "New bot" → role → prefilled fields → created once → its Bot Chat says "<Name> is ready" with the role\'s starters', self.c_bots_create)
            self.check('cold_start', 'Cold start ×3', self.c_cold_start)
            self.check('logcat', 'Logcat: no crash/ANR, no ReactNativeJS errors, Reanimated warnings', self.c_logcat, needs=('install',))
            if live_link:
                r.run('live', 'Live bridge: 2 harmless turns, the chat deleted in Hermes afterwards', lambda: self.c_live(live_link), on_fail=self.on_fail, needs=('install',))
                if 'bots' in LIVE_EXTRA:
                    r.run('live_bots', f'Live bot "{LIVE_BOT}": Bots tab, Bot Chat, personality, no ⚡', self.c_live_bots, on_fail=self.on_fail, needs=('live',))
                if 'quick' in LIVE_EXTRA:
                    r.run('live_quick', 'Live ⚡: shown in a default chat, quick answer, "Continue with Hermes"', self.c_live_quick, on_fail=self.on_fail, needs=('live',))
        finally:
            try:
                with open(os.path.join(self.out, 'mock-requests.json'), 'w') as f:
                    json.dump(dict(turns=mock('/__e2e/turns'), requests=mock('/__e2e/requests')), f, indent=1)
            except Exception as e:
                print('mock log not saved:', e)
            self.restore_device()
            # debug shots: keep the failed checks' shots plus the newest MAX_KEPT_SHOTS (Paseo previews every image)
            for sub in ('shots', 'share'):
                d.prune_shots(os.path.join(self.out, sub), MAX_KEPT_SHOTS, always=tuple(c['id'] for c in r.failed) + ('fail',))
            verdict = r.write()
        print(f'\n{verdict}: {len(r.failed)} failed · report {os.path.join(self.out, "report.md")}')
        return 0 if verdict == 'PASS' else 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--apk')
    p.add_argument('--out')
    p.add_argument('--only', default='')
    p.add_argument('--group', default='')
    p.add_argument('--live-stdin', action='store_true')
    p.add_argument('--list-groups', action='store_true')
    p.add_argument('--check-selection', action='store_true')
    a = p.parse_args()
    a.only = [x for x in a.only.split(',') if x]
    a.group = [x for x in a.group.split(',') if x]
    if a.list_groups:
        print('groups (install + pair + logcat run in every one):')
        for g, ids in GROUPS.items():
            print(f'  {g:5} {",".join(ids)}')
        print('  all   every check (the default without --group/--only)')
        sys.exit(0)
    try:
        sel = selection(a.only, a.group)
    except ValueError as e:
        print(f'suite.py: {e}', file=sys.stderr)
        sys.exit(2)
    if a.check_selection:
        probs = table_problems()
        if probs:
            print('suite.py: ' + '; '.join(probs), file=sys.stderr)
            sys.exit(2)
        sys.exit(0)
    if not (a.apk and a.out):
        p.error('--apk and --out are required')
    a.selected, a.label = sel
    live = sys.stdin.readline().strip() if a.live_stdin else None
    os.makedirs(a.out, exist_ok=True)
    sys.exit(Suite(a).run(live))


if __name__ == '__main__':
    main()
