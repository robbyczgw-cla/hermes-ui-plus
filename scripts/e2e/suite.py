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
# E2E_LIVE_EXTRA=aplus fires real reminders through Hermes' own API (host side): its base URL and a file with the API key
LIVE_API = os.environ.get('E2E_LIVE_API', '')
LIVE_KEY_FILE = os.environ.get('E2E_LIVE_KEY_FILE', '')
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
    'bots': ('bots', 'bots_create', 'bots_about', 'bots_working', 'bots_aplus', 'demo_bots'),
    'groups': ('groups', 'groups_off'),
    'share': ('share_unpaired', 'share_link', 'share_in_image', 'share_pdf', 'share_cancel', 'share_recreate', 'share_offline'),
    'cards': ('live_card', 'live_patch'),
    'routines': ('routines', 'routines_off', 'routines_hidden'),
    'reminders': ('reminder', 'reminder_delete', 'reminder_gone', 'reminder_delivered'),
    'reading': ('quote_reply', 'draft_restart', 'jump_unread'),
    'upgrade': ('upgrade',),  # needs E2E_UPGRADE_APK (the newer build); not part of the default run
}
LIVE_STAGE = 'live'
# the optional live checks (--live, E2E_LIVE_EXTRA) belong to the live stage, not to a group
LIVE_CHECKS = (LIVE_STAGE, 'live_bots', 'live_quick', 'live_chat', 'live_aplus', 'live_bg', 'live_firstuse', 'live_about_approval', 'live_cards', 'live_groups', 'live_upgrade')


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
    # quote / reply (app/src/chat/quote.ts): a quote box by its label (composer_quotes() drops the sent bubble's
    # msg-quote-N boxes, which carry the same label), the menu item, the jump button
    quote_box='id:^composer-quote-\\d+$|desc:^Quote( \\d of \\d)? from (Answer|You): ',
    quote_reply='text:^Reply$|desc:^Reply$',
    jump_latest='id:^chat-jump-latest$',
)


# ── reading helpers (quote/reply, drafts, jump to latest) ────────────────────────────────────────────────────────────
def on_screen(spec):
    """a matching node that is (at least half) inside the visible screen"""
    _, h = d.screen_size()
    for n in d.find_all(spec):
        if n.b[3] > 0 and n.b[1] < h and min(n.b[3], h) - max(n.b[1], 0) >= n.h / 2:
            return n
    return None


def long_press(n, ms=900):
    d.sh(f'input swipe {n.cx} {n.cy} {n.cx} {n.cy} {ms}')


def swipe_right(n):
    """swipe-to-reply on a message row (SwipeReply: starts after 24 px, fires at 56 px of damped travel)"""
    w, _ = d.screen_size()
    d.swipe(int(w * 0.12), n.cy, int(w * 0.85), n.cy, 260)


def scroll_up(times=2):
    """towards older messages (finger moves down)"""
    w, h = d.screen_size()
    for _ in range(times):
        d.swipe(w // 2, int(h * 0.3), w // 2, int(h * 0.75), 300)
        time.sleep(0.5)


def turns_ending(suffix):
    return [t for t in mock('/__e2e/turns') if t['text'].rstrip().endswith(suffix)]


def composer_quotes():
    """the quotes above the composer, top to bottom (not the boxes in a sent bubble)"""
    hits = [n for n in d.find_all(S['quote_box']) if not (n.rid or '').split('/')[-1].startswith('msg-quote-')]
    return sorted(hits, key=lambda n: n.b[1])


def wait_composer_quotes(n=1, timeout=6.0):
    """at least n composer quotes once two dumps agree on their bounds, else []"""
    end, prev = time.time() + timeout, None
    while time.time() < end:
        q = composer_quotes()
        cur = [x.b for x in q]
        if len(q) >= n and cur == prev:
            return q
        prev = cur
        time.sleep(0.4)
    return composer_quotes() if len(composer_quotes()) >= n else []


def composer_text():
    n = d.find(S['input'])
    return n.text if n else None


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
    if n is None and d.find(S['chats']) and d.find(S['input']):
        # a Bot Chat has no "New chat" in its header (one thread per bot) and the app reopens the last chat, e.g. after
        # the bots/groups checks: leave it the way a user does, drawer -> Chats -> "New chat"
        d.tap(S['chats'], 6)
        time.sleep(0.8)
        d.tap(S['tab_chats'], 3)  # only there when the bridge offers bots
        time.sleep(0.5)
        n = d.wait('desc:^New chat$|text:^New chat$', 6)
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
        # the receipt under the user message names the item and how far it got (0.3, live/receipts.ts)
        expect(d.wait('text:^To “Einkauf Samstag”: Milch ticked$', 10), 'no "To “Einkauf Samstag”: Milch ticked" line under the user message')
        expect(d.wait('text:^Saved in v2$', 10), 'the receipt does not say the tick was saved in v2')
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

    def _reminder_with_device_copy(self, shots):
        """new chat → "Remind me …" → the card → "Also remind me on this device"; returns the number of the app's
        lines in `dumpsys alarm` before and after the copy was set"""
        new_chat()
        text = 'Remind me tomorrow at 9 to buy tea'
        send(text)
        wait_answer(text, expected_for(text), 30)
        expect(d.wait('desc:^Reminder set · ', 20), 'no reminder card after a successful cron create')
        before = (d.sh('dumpsys alarm') or '').count(PKG)
        expect(d.tap('text:^Also remind me on this device$', 8), 'no "Also remind me on this device" on a one-shot reminder (Android)')
        expect(d.wait('text:^This device reminds you too: ', 10), 'the device copy was not confirmed on the card')
        d.screenshot_jpg(os.path.join(shots, 'device-set.jpg'))
        return before, (d.sh('dumpsys alarm') or '').count(PKG)

    def _expect_deleted_card(self, shots, name, alarms_set, alarms_before):
        """the card says the job is gone and so is its device copy; no buttons that act on the job; the alarm is gone"""
        fate = d.wait('id:^reminder-fate$', 20)
        expect(fate, 'the reminder card does not say that the job was deleted in Hermes')
        expect(fate.text == 'This reminder was deleted in Hermes – removed from this device too.', f'unexpected card note: {fate.text!r}')
        expect(not d.find('text:^This device reminds you too: '), 'the card still says the device reminds you (QA round 4 bug)')
        expect(not d.find('text:^Change$') and not d.find('text:^Delete$'), 'Change / Delete still offered for a deleted job')
        expect(not d.find('text:^Also remind me on this device$'), 'the card offers a device copy of a deleted job')
        d.screenshot_jpg(os.path.join(shots, f'{name}.jpg'))
        end = time.time() + 10
        alarms = (d.sh('dumpsys alarm') or '').count(PKG)
        while alarms_set > alarms_before and alarms >= alarms_set and time.time() < end:
            time.sleep(1)
            alarms = (d.sh('dumpsys alarm') or '').count(PKG)
        if alarms_set > alarms_before:
            expect(alarms < alarms_set, f'the app\'s alarm is still scheduled after the delete ({alarms_set} → {alarms} lines in dumpsys alarm)')
        return alarms

    def c_reminder_delete(self):
        """QA round 4: the user deletes a reminder by writing "Delete this reminder" in the chat (not the card's button).
        Default bridge, routines off (the job list answers 404): the turn's `cronjob_manage remove` alone takes the
        device copy along, the card says so and keeps saying it after a force-stop"""
        shots = os.path.join(self.out, 'reminder')
        os.makedirs(shots, exist_ok=True)
        before, alarms_set = self._reminder_with_device_copy(shots)
        text = 'Delete this reminder'
        send(text)
        wait_answer(text, expected_for(text), 30)
        alarms = self._expect_deleted_card(shots, 'deleted-in-chat', alarms_set, before)
        force_stop()
        launch()
        fate = d.wait('id:^reminder-fate$', 20)
        if not fate:
            w, h = d.screen_size()
            d.swipe(w // 2, int(h * 0.35), w // 2, int(h * 0.65))
            fate = d.wait('id:^reminder-fate$', 6)
        expect(fate, 'after force-stop the card forgot that its job was deleted')
        expect(not d.find('text:^Also remind me on this device$'), 'after force-stop the card offers a device copy of a deleted job')
        return dict(alarms=[before, alarms_set, alarms])

    def c_reminder_gone(self):
        """The job is deleted elsewhere (Hermes dashboard, another chat; mock /__e2e/remove-job) while the app is closed.
        With routines on (the job list answers), the next start checks the device copies against the list: the copy is
        cancelled and the card says so. Jobs that are still listed keep their copies"""
        mock('/__e2e/config', {'routines': True})
        shots = os.path.join(self.out, 'reminder')
        os.makedirs(shots, exist_ok=True)
        try:
            before, alarms_set = self._reminder_with_device_copy(shots)
            force_stop()
            gone = mock('/__e2e/remove-job', {})
            expect(gone.get('removed'), f'the mock had no reminder job to remove: {gone}')
            launch()
            alarms = self._expect_deleted_card(shots, 'deleted-elsewhere', alarms_set, before)
            lists = [r for r in mock('/__e2e/requests') if r['path'].startswith('/api/jobs')]
            expect(lists, 'the app never asked for the job list')
            return dict(removed=gone['removed'], alarms=[before, alarms_set, alarms], list_requests=len(lists))
        finally:
            try:
                mock('/__e2e/config', {'routines': False})
            except Exception:
                pass

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

    def _bots_tab(self):
        """drawer → Bots tab (reopens once while GET /bridge/profiles has not answered yet)"""
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        tab = None
        for _ in range(3):
            tab = d.wait(S['tab_bots'], 8)
            if tab:
                break
            d.sh('input keyevent 4')
            time.sleep(1.0)
            d.tap(S['chats'], 8)
        expect(tab, 'no "Chats | Bots" switch in the drawer')
        d.tap_xy(tab.cx, tab.cy)

    def _group_send(self, text):
        """type into the group composer and send"""
        expect(d.tap('id:^group-input$', 8), 'no group composer')
        time.sleep(0.6)
        d.type_text(text)
        expect(d.wait('text:^' + re.escape(text) + '$', 6), f'typed text "{text}" not in the group composer')
        d.hide_keyboard()
        btn = d.wait('id:^group-send$', 6)
        expect(btn, 'no send button in the group')
        d.tap_xy(btn.cx, btn.cy)

    def c_groups(self):
        """Bot groups (groups/, bridge/src/groups.mjs) against the mock, whose /bridge/groups is the REAL bridge driver:
        "Group" next to "New bot" once the owner switched groups on → pick Hermes + Research (the first leads) with the
        cost line → the group chat says who answers → @-autocomplete → the named bot answers → a plan: Hermes proposes,
        a grey hand-over line, Research answers → an approval shows only as a line with "Open"; the card is in
        Research's own Bot Chat and answering it lets the group go on"""
        mock('/__e2e/config', {'profiles': True, 'quick': False, 'groups': True})
        shots = os.path.join(self.out, 'groups')
        os.makedirs(shots, exist_ok=True)
        try:
            force_stop()
            launch()
            self._bots_tab()
            btn = None
            for _ in range(3):  # GET /bridge/groups answers after the tab opened the first time
                btn = d.wait('id:^groups-new$', 8)
                if btn:
                    break
                d.sh('input keyevent 4')
                time.sleep(1.0)
                self._bots_tab()
            expect(btn, 'no "Group" button although the owner switched groups on')
            d.screenshot_jpg(os.path.join(shots, 'bots-tab.jpg'))
            d.tap_xy(btn.cx, btn.cy)
            expect(d.wait('id:^group-create-bot-default$', 10), 'no bot list in "New group"')
            expect(d.find('id:^group-create-cost$'), 'no cost line in "New group"')
            d.tap('id:^group-create-bot-default$', 4)
            d.tap('id:^group-create-bot-research$', 4)
            name = d.wait('id:^group-create-name$', 6)
            expect(name and name.text == 'Hermes and Research', f'no proposed name ({name.text if name else None!r})')
            d.screenshot_jpg(os.path.join(shots, 'create.jpg'))
            sub = d.wait('id:^group-create-submit$', 6)
            if not sub:
                w, h = d.screen_size()
                d.swipe(w // 2, int(h * 0.75), w // 2, int(h * 0.3))
                sub = d.wait('id:^group-create-submit$', 6)
            expect(sub, 'no "Create group" button')
            d.tap_xy(sub.cx, sub.cy)
            expect(d.wait('id:^group-empty$', 15), 'the new group did not open with its empty-room text')
            expect(d.wait('text:^Hermes answers\\. Use @ to bring others in\\.', 6), 'no "who answers" hint')
            posts = [q for q in mock('/__e2e/requests') if q['method'] == 'POST' and q['path'] == '/bridge/groups']
            expect(len(posts) == 1, f'{len(posts)} create requests for one tap')
            # @-autocomplete: "@res" offers Research, a tap completes it
            expect(d.tap('id:^group-input$', 8), 'no group composer')
            time.sleep(0.6)
            d.type_text('@res')
            opt = d.wait('id:^group-mention-research$', 8)
            expect(opt, 'no @-autocomplete for "@res"')
            d.screenshot_jpg(os.path.join(shots, 'mention.jpg'))
            d.tap_xy(opt.cx, opt.cy)
            expect(d.wait('text:^@research ?$', 6), 'the mention was not completed to "@research "')
            d.type_text('hello')
            expect(d.wait('text:^Answering: Research', 6), 'the hint does not say that Research answers')
            d.hide_keyboard()
            d.tap('id:^group-send$', 6)
            expect(d.wait('text:^Research hier: @research hello', 30), 'Research did not answer in the group')
            # a plan: the leader proposes and hands over, a grey line, Research answers
            self._group_send('Plan a weekend')
            expect(d.wait('text:^Hermes to Research: such bitte drei Quellen', 30), 'no hand-over line')
            expect(d.wait('text:Drei Quellen gefunden', 30), 'Research did not answer after the hand-over')
            d.screenshot_jpg(os.path.join(shots, 'handover.jpg'))
            # approval: a line in the group, the card in Research's own chat
            self._group_send('@research e2e approval')
            line = d.wait('text:^Research is waiting for an approval in its chat$', 30)
            expect(line, 'no "waiting for an approval" line in the group')
            ns = d.dump()
            expect(d.find('text:^Research wants to run something$', ns) is None, 'the approval card is in the group')
            d.screenshot_jpg(os.path.join(shots, 'approval-line.jpg'))
            expect(d.tap('id:^group-approval-open-research$', 6), 'no "Open" on the approval line')
            card = d.wait('text:^Research wants to run something$', 20)
            expect(card, 'the approval card is not in Research\'s own chat')
            expect(d.wait('text:^From the group "Hermes and Research"', 6) or d.find('text:From the group'), 'the card does not say it comes from the group')
            d.screenshot_jpg(os.path.join(shots, 'approval-botchat.jpg'))
            expect(d.tap('desc:^Allow this command once|text:^Allow once$', 8), 'no "Allow once"')
            # a member turn's text is the bridge's whole group prompt: find it by its content and the bot
            t, end = None, time.time() + 20
            while time.time() < end:
                ts = [x for x in mock('/__e2e/turns') if x.get('profile') == 'research' and 'e2e approval' in x.get('text', '') and x.get('scenario') == 'approval']
                t = ts[-1] if ts else None
                if t and (t.get('approval') or {}).get('choice') is not None:
                    break
                time.sleep(0.3)
            expect(t and (t.get('approval') or {}).get('choice') == 'once', f'the group approval was not answered once ({(t or {}).get("approval")!r})')
            # the group row is in the Bots tab, its member sessions are not chats
            self._bots_tab()
            expect(d.wait('id:^groups-section$', 8), 'no "Groups" section in the Bots tab')
            expect(d.find('desc:^Group Hermes and Research, '), 'no row for the group')
            d.screenshot_jpg(os.path.join(shots, 'bots-tab-groups.jpg'))
            expect(d.tap(S['tab_chats'], 8), 'no Chats tab')
            time.sleep(0.8)
            expect(d.find('desc:^Group: ') is None, 'a member session is listed under Chats')
            d.sh('input keyevent 4')
            return dict(shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'profiles': False, 'quick': False, 'groups': False})
            force_stop()
            launch()

    def c_groups_off(self):
        """the default bridge (groups off): the Bots tab has no "Group" button and no groups section, nothing else changes"""
        mock('/__e2e/config', {'profiles': True, 'quick': False, 'groups': False})
        try:
            force_stop()
            launch()
            self._bots_tab()
            expect(d.wait('id:^bot-row-research$', 8), 'no bot rows')
            time.sleep(1.5)  # GET /bridge/groups has answered by now
            ns = d.dump()
            expect(d.find('id:^groups-new$', ns) is None, '"Group" button although groups are off')
            expect(d.find('id:^groups-section$', ns) is None, 'groups section although groups are off')
            d.sh('input keyevent 4')
            return dict(ok=True)
        finally:
            mock('/__e2e/config', {'profiles': False, 'groups': False})
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

    @staticmethod
    def _dump_with(spec, timeout):
        """one UI dump that contains spec (dumps fail while the working card ticks or text streams: retry), else None"""
        end = time.time() + timeout
        while time.time() < end:
            ns = d.dump()
            if ns and d.find(spec, ns):
                return ns
            time.sleep(0.3)
        return None

    @staticmethod
    def _gone(spec, timeout):
        """True once a real (non-empty) dump no longer shows spec; an empty dump proves nothing"""
        end = time.time() + timeout
        while time.time() < end:
            ns = d.dump()
            if ns and not d.find(spec, ns):
                return True
            time.sleep(0.5)
        return False

    def _sheet_find(self, spec, swipes=6):
        """a node of the open "About <Name>" sheet, scrolled fully into the sheet's visible area and standing still
        (a tap on stale bounds after a fling lands on the backdrop and closes the sheet); None if it never shows"""
        for i in range(swipes + 1):
            ns = d.dump()
            sheet, n = d.find('id:^bot-info$', ns), d.find(spec, ns)
            if sheet is None:
                return None
            top, bottom = sheet.b[1], sheet.b[3]
            if n and n.b[1] >= top and n.b[3] <= bottom - 8:
                time.sleep(0.5)
                again = d.find(spec)
                if again and again.b == n.b:
                    return again
                continue
            if i == swipes:
                break
            x, h = (sheet.b[0] + sheet.b[2]) // 2, bottom - top
            if n and n.b[3] <= top:  # above the visible part: scroll back up
                d.swipe(x, top + int(h * 0.3), x, top + int(h * 0.7), 400)
            else:
                d.swipe(x, top + int(h * 0.75), x, top + int(h * 0.35), 400)
            time.sleep(0.8)
        return None

    def _open_about(self, head, label):
        """"About <Name>" from the bot header's name (the chat menu as fallback); waits for its parts to load"""
        d.tap_xy(head.cx, head.cy)
        if not d.wait('id:^bot-info$', 6):
            expect(d.tap(S['chat_menu'], 8), 'chat menu (⋯) not found or not tappable')
            expect(d.tap(f'text:^About {re.escape(label)}$|desc:^About {re.escape(label)}$', 8), f'no "About {label}" in the chat menu')
            expect(d.wait('id:^bot-info$', 10), f'"About {label}" did not open')
        time.sleep(1.5)  # library, allow-list and fields load

    def c_bots_about(self):
        """"About <Name>" complete (Bots v2 slice 4, docs/BOTS-SERVER.md) against the mock (`about: true`): how Research
        works, what it remembers (3 entries) and can (2 skills, 1 off), "Always allowed" (2 kinds) → Revoke with its
        confirm step → one revoke request and the note, the notification level kept after reopening, "Archive bot" with
        its confirm → the bot leaves the Bots tab → "Archived" → "Bring back" → the bot is back"""
        mock('/__e2e/config', {'profiles': True, 'about': True})
        shots = os.path.join(self.out, 'bots-about')
        os.makedirs(shots, exist_ok=True)
        try:
            force_stop()
            launch()
            head = self._open_bot('research', 'Research')
            self._open_about(head, 'Research')
            expect(d.wait('text:^Find sources and sum them up$', 8), '"How Research works" does not show the job')
            mem = self._sheet_find('id:^bot-info-memory$')
            expect(mem and re.search(r'3 entries', mem.desc), f'"Remembers" does not say 3 entries ({mem.desc if mem else None!r})')
            sk = self._sheet_find('id:^bot-info-skills$')
            expect(sk and re.search(r'2 skills', sk.desc) and re.search(r'1 switched off', sk.desc), f'"Can" does not say 2 skills, 1 off ({sk.desc if sk else None!r})')
            d.screenshot_jpg(os.path.join(shots, 'about.jpg'))
            rv = self._sheet_find('id:^bot-info-revoke-0$')
            expect(rv, 'no "Revoke" on the first always-allowed entry')
            expect(d.find('id:^bot-info-allowed-1$'), 'the second always-allowed entry is missing')
            d.tap_xy(rv.cx, rv.cy)
            ok = self._sheet_find('id:^bot-info-revoke-confirm-0$', 3)  # opens below the entry, maybe under the edge
            if not ok:
                debug_dump('bots_about-revoke')
                d.screenshot_jpg(os.path.join(shots, 'revoke-missing.jpg'))
            expect(ok, 'no confirm step for Revoke')
            d.screenshot_jpg(os.path.join(shots, 'revoke-confirm.jpg'))
            d.tap_xy(ok.cx, ok.cy)
            note = d.wait('id:^bot-info-allowed-note$', 10)
            expect(note and note.text.startswith('Revoked.'), f'no "Revoked" note ({note.text if note else None!r})')
            revokes = [q for q in mock('/__e2e/requests') if q['path'] == '/bridge/bots/research/allowlist/revoke']
            expect(len(revokes) == 1 and revokes[0]['status'] == 200, f'{len(revokes)} revoke requests ({[q["status"] for q in revokes]})')
            expect(d.find('id:^bot-info-allowed-1$') is None, 'two always-allowed entries after revoking one')
            lv = self._sheet_find('id:^bot-info-notify-needed$')
            expect(lv, 'no notification level "Only when I am needed"')
            d.tap_xy(lv.cx, lv.cy)
            time.sleep(0.6)
            d.screenshot_jpg(os.path.join(shots, 'revoked-level.jpg'))
            d.sh('input keyevent 4')  # close the sheet
            time.sleep(0.8)
            self._open_about(head, 'Research')
            lv = self._sheet_find('id:^bot-info-notify-needed$')
            expect(lv and lv.checked, 'the notification level was not kept after reopening "About Research"')
            ar = self._sheet_find('id:^bot-info-archive$')
            expect(ar, 'no "Archive bot"')
            d.tap_xy(ar.cx, ar.cy)
            yes = self._sheet_find('id:^bot-info-archive-confirm$', 3)
            expect(yes, 'no confirm step for "Archive bot"')
            d.screenshot_jpg(os.path.join(shots, 'archive-confirm.jpg'))
            d.tap_xy(yes.cx, yes.cy)
            time.sleep(2.0)
            archives = [q for q in mock('/__e2e/requests') if q['path'] == '/bridge/bots/research/archive']
            expect(len(archives) == 1 and archives[0]['status'] == 200, f'{len(archives)} archive requests')
            if d.find('id:^bot-info$'):
                d.sh('input keyevent 4')
                time.sleep(0.8)
            ensure_app()
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            tab = d.wait(S['tab_bots'], 8)
            expect(tab, 'no Bots tab after archiving')
            d.tap_xy(tab.cx, tab.cy)
            arch = d.wait('id:^bots-archived$', 10)
            expect(arch, 'no "Archived" in the Bots tab')
            expect(d.find('id:^bot-row-research$') is None, 'the archived bot is still in the Bots tab')
            d.tap_xy(arch.cx, arch.cy)
            back = d.wait('id:^bots-restore-research$', 6)
            expect(back, 'no "Bring back" for the archived bot')
            d.screenshot_jpg(os.path.join(shots, 'archived.jpg'))
            d.tap_xy(back.cx, back.cy)
            expect(d.wait('id:^bot-row-research$', 15), 'the bot did not come back after "Bring back"')
            d.screenshot_jpg(os.path.join(shots, 'restored.jpg'))
            d.sh('input keyevent 4')
            return dict(revoked=1, level='needed', archived_restored=True, shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'profiles': False, 'about': False})
            force_stop()
            launch()

    def c_bots_working(self):
        """Work in the background visible (Bots v2 slice 5): a bot turn with tool steps shows "Research is working" with
        the running step, Stop ends the turn on the server; a turn of another device (bridge activity) shows the same
        card with the remote line and the step as the Bots tab row, and its Stop goes through /bridge/chat/stop"""
        mock('/__e2e/config', {'profiles': True, 'about': True})
        shots = os.path.join(self.out, 'bots-working')
        os.makedirs(shots, exist_ok=True)
        text = 'e2e working on headphones'
        step = 'Reading the shop page'
        try:
            force_stop()
            launch()
            self._open_bot('research', 'Research')
            btn = send(text)
            # the second tool step holds 15 s. While the own turn streams the UI never settles and every uiautomator
            # dump blocks for seconds (docs/E2E.md, streams), so nothing is dumped here: a screenshot of the card, then the
            # composer's Stop, which sits where Send was (c_stop). The web check bots-about-shots.mjs reads this card.
            wait_turn(text, lambda t: any(x.get('state') == 'running' and x.get('name') == 'browser_navigate' for x in (t.get('steps') or [])), 15, 'the second tool step')
            time.sleep(1.0)  # the step reaches the app
            d.screenshot_jpg(os.path.join(shots, 'working.jpg'))
            own = 'screenshot working.jpg while the step runs, stopped via the composer'
            d.tap_xy(btn.cx, btn.cy)
            wait_turn(text, lambda t: t['state'] == 'stopped', 15, 'the stopped turn')
            expect(self._gone('id:^bot-working$', 15), 'the card stays after Stop')
            # another device's turn in the same Bot Chat (bridge activity)
            mock('/__e2e/remote-turn', {'profile': 'research'})
            rns = self._dump_with('text:^Running on the server, started from another device', 20)
            if not rns:
                debug_dump('bots_working-remote')
                d.screenshot_jpg(os.path.join(shots, 'remote-missing.jpg'))
            expect(rns, 'no card for the turn of another device')
            d.screenshot_jpg(os.path.join(shots, 'remote.jpg'))
            ch = d.find(S['chats'], rns)
            expect(ch, 'Chats button not found')
            d.tap_xy(ch.cx, ch.cy)
            row = None
            for _ in range(10):  # the roster polls the activity every 5 s
                row = d.find('id:^bot-row-research$')
                if row and step in (row.desc or ''):
                    break
                time.sleep(1.0)
            expect(row and step in (row.desc or ''), f'the Bots tab row does not show the running step ({row.desc if row else None!r})')
            d.screenshot_jpg(os.path.join(shots, 'roster-working.jpg'))
            w, h = d.screen_size()
            d.tap_xy(int(w * 0.93), h // 2)  # the dimmed chat right of the drawer closes it (Back here left the app)
            time.sleep(1.2)  # the drawer slides away; the card stays where the first dump saw it
            since = time.time() * 1000
            rs = d.find('id:^bot-working-stop$', rns)
            expect(rs, 'no Stop on the remote card')
            d.screenshot_jpg(os.path.join(shots, 'remote-before-stop.jpg'))
            d.tap_xy(rs.cx, rs.cy)
            expect(self._gone('id:^bot-working$', 15), 'the remote card stays after Stop')
            stops = [q for q in mock('/__e2e/requests') if q['t'] >= since and q['path'] == '/bridge/chat/stop']
            expect(stops, 'Stop on the remote card sent no /bridge/chat/stop')
            return dict(own=own, remote_step=step, remote_stop=len(stops), shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'profiles': False, 'about': False})
            force_stop()
            launch()

    def _find_scrolling(self, spec, ups=4):
        """a node matching spec that is on screen, scrolling towards older rows when needed (a bot's timeline is long)"""
        n = on_screen(spec)
        for _ in range(ups):
            if n:
                return n
            scroll_up(1)
            n = on_screen(spec)
        return n

    @staticmethod
    def _scroll_to(spec, tries=6):
        """a node matching spec that is on screen: look first, then towards newer rows, then towards older ones"""
        w, h = d.screen_size()
        n = on_screen(spec)
        for _ in range(tries):
            if n:
                return n
            d.swipe(w // 2, int(h * 0.75), w // 2, int(h * 0.3), 300)
            time.sleep(0.5)
            n = on_screen(spec)
        for _ in range(tries):
            if n:
                return n
            scroll_up(1)
            n = on_screen(spec)
        return n

    @staticmethod
    def _turn_after(n, cond, timeout, what):
        """the first turn newer than record n that satisfies cond, once it ended"""
        end = time.time() + timeout
        while time.time() < end:
            for t in mock('/__e2e/turns'):
                if t['n'] > n and cond(t) and t['state'] in ('ended', 'stopped'):
                    return t
            time.sleep(0.5)
        raise Fail(f'mock: {what} not reached in {timeout:.0f} s')

    @staticmethod
    def _answer_on_screen(expected, timeout=25):
        """the turn's answer is on screen (newest rows, scrolling down to them)"""
        spec = 'text:' + re.escape(expected[:25])
        end = time.time() + timeout
        while time.time() < end:
            if Suite._scroll_to(spec, 3):
                return True
            time.sleep(1.0)
        return False

    def c_bots_aplus(self):
        """Bots A+ as a normal user lives it on Hermes v0.22.3+ (the mock's `authority` mode: capabilities carry
        `run_unknown_resolution`, a turn into the "Bot Chat" session is refused with 409 `permission_denied`): a reminder
        fired into Research's Bot Chat, the bot's screen has ONE timeline with a normal composer (no read-only bar), a
        typo'd follow-up goes to the app's own session `hui-bot-research` with the `[hermes-ui-bot-deliveries]` context
        naming the job, "und morgen?" still carries it, a second reminder arrives while the screen stays open, the Chats
        tab lists neither the talk nor the Bot Chat, the same timeline after a force-stop, and a failing Bot Chat lookup
        shows a visible row with a retry (screenshots: followup, deleted-talk, failed)"""
        mock('/__e2e/config', {'profiles': True, 'quick': False, 'authority': True, 'botChatLookupFail': False})
        shots = os.path.join(self.out, 'bots-aplus')
        os.makedirs(shots, exist_ok=True)
        name1, out1, name2, out2 = 'Water plants', 'Time to water the plants.', 'Pay rent', 'The rent is due today.'
        name3, out3 = 'Pick snack', 'Time for a snack.'
        follow1, follow2 = 'verschieb das um ne stunde', 'und morgen?'
        marker = '[hermes-ui-bot-deliveries]'
        talk_sid = 'hui-bot-research'
        mark1 = f'text:^{re.escape(out1)}$|desc:{re.escape(out1)}'
        mark2 = f'text:^{re.escape(out2)}$|desc:{re.escape(out2)}'
        readonly = 'text:belongs to Hermes itself|desc:belongs to Hermes itself'
        failed = 'text:Deliveries couldn.t be loaded|desc:Deliveries couldn.t be loaded'
        retry = 'text:^Try again$|desc:^Try again$'

        def count(spec):
            return len(d.find_all(spec))

        def stored(needle):
            """{conversation file: how often it stores a message containing needle}"""
            res = {}
            for c, msgs in transcripts().items():
                n = sum(1 for m in msgs if needle in m.get('text', ''))
                if n:
                    res[os.path.basename(c)] = n
            return res

        try:
            force_stop()
            launch()
            fired = mock('/__e2e/fire-reminder', {'profile': 'research', 'name': name1, 'text': out1, 'comment': 'Noted, I will not forget the plants.'})
            self._open_bot('research', 'Research')
            # 1. the delivery under its marker, no cron header, a composer, no read-only bar
            expect(d.wait(mark1, 25), 'the reminder text is not shown on the bot screen')
            ns = d.dump()
            expect(d.find('text:Cronjob', ns) is None, 'the injected cron header is shown as a message')
            expect(d.find(f'text:{name1}|desc:{name1}', ns) is not None, 'no marker naming the reminder')
            expect(d.find(S['input'], ns) is not None, 'no composer on the bot screen')
            expect(d.find(readonly, ns) is None, 'the read-only bar is shown although the app writes into its own session')
            expect(d.find(S['new_chat'], ns) is None, '"New chat" in a bot screen (one thread per bot)')
            expect(d.find("text:couldn.t be loaded right now", ns) is None, 'a load-failure row on the normal path')
            # 2. a follow-up with a typo goes to the bot's own session with the delivery context
            ans1 = expected_for(follow1)
            send(follow1)
            t = wait_turn(follow1, lambda t: t['state'] == 'ended', 40, 'the follow-up turn')
            expect(t['profile'] == 'research' and t['sid'] == talk_sid, f'follow-up went to profile {t["profile"]} / session {t["sid"]} (want research / {talk_sid})')
            ctx = [x for x in t.get('system', []) if x.startswith(marker)]
            expect(len(ctx) == 1, f'{len(ctx)} delivery context messages (system: {t.get("system")!r})')
            expect(f'"{name1}"' in ctx[0] and out1 in ctx[0], f'the context does not name the job / its output: {ctx[0][:200]!r}')
            expect(fired['sessionId'] != t['sid'], 'the turn went into the Bot Chat')
            wait_answer(follow1, ans1, 30)
            ns = None
            for _ in range(6):  # the answer shows once the stream is over and the screen is idle
                ns = d.dump()
                if ns and d.find('text:' + re.escape(ans1[:30]), ns):
                    break
                time.sleep(1.0)
            dn, an = d.find(mark1, ns or []), d.find('text:' + re.escape(ans1[:30]), ns or [])
            expect(dn and an, f'delivery ({bool(dn)}) and answer ({bool(an)}) are not both on screen')
            expect(dn.cy < an.cy, f'the answer (y {an.cy}) is not below the delivery (y {dn.cy})')
            d.screenshot_jpg(os.path.join(shots, 'followup.jpg'))
            # the Bot Chat row is not stored in the talk: the delivery lives in exactly one conversation, once
            where = stored(out1)
            expect(sum(where.values()) == 1, f'the reminder is stored {sum(where.values())}x in {where} (want once)')
            talk_has = [os.path.basename(c) for c, msgs in transcripts().items() if any(m.get('role') == 'user' and m.get('text', '').strip() == follow1 for m in msgs)]
            expect(len(talk_has) == 1 and talk_has[0] not in where, f'the delivery sits in the talk conversation ({talk_has} / {where})')
            # 3. "und morgen?": the context goes along again (the system message is not stored by Hermes)
            ans2 = expected_for(follow2)
            send(follow2)
            t2 = wait_turn(follow2, lambda t: t['state'] == 'ended', 40, 'the second follow-up turn')
            expect(t2['sid'] == talk_sid and t2['profile'] == 'research', f'second follow-up went to {t2["profile"]} / {t2["sid"]}')
            expect(any(x.startswith(marker) and f'"{name1}"' in x for x in t2.get('system', [])), f'no delivery context on the second follow-up (system: {t2.get("system")!r})')
            wait_answer(follow2, ans2, 30)
            # 4. another reminder while the screen stays open
            last_n = max([x['n'] for x in mock('/__e2e/turns')] or [0])
            mock('/__e2e/fire-reminder', {'profile': 'research', 'name': name2, 'text': out2, 'comment': 'Noted, rent.'})
            choice = {'type': 'choice', 'id': 'snack', 'question': 'Which snack?', 'options': [{'id': 'apples', 'label': 'Apples'}, {'id': 'pears', 'label': 'Pears'}]}
            mock('/__e2e/fire-reminder', {'profile': 'research', 'name': name3, 'text': out3, 'comment': 'Which one do you want?\n\n```hui\n' + json.dumps(choice) + '\n```'})
            name4, out4 = 'Echo check', 'Same words, said once.'
            mock('/__e2e/fire-reminder', {'profile': 'research', 'name': name4, 'text': out4, 'comment': out4})  # a comment repeating its delivery word for word
            t_fired = time.time()
            seen = None
            while time.time() - t_fired < 70:  # the screen polls every 60 s (an inbox event would be faster)
                seen = d.find(mark2)
                if seen:
                    break
                time.sleep(3.0)
            expect(seen, 'the second reminder did not appear within 70 s on the open bot screen')
            took = round(time.time() - t_fired)
            expect(self._scroll_to(f'text:^{re.escape(out3)}$|desc:{re.escape(out3)}', 6), 'the third delivery (with the choice) did not appear')
            echo = self._scroll_to(f'text:{re.escape(out4)}|desc:{re.escape(out4)}', 6)
            expect(echo, 'the delivery whose comment repeats it did not appear')
            expect(count(f'text:{re.escape(out4)}|desc:{re.escape(out4)}') == 1, f'a comment repeating its delivery shows {count(f"text:{re.escape(out4)}|desc:{re.escape(out4)}")}x (want once)')
            ns = d.dump()
            a2, m2 = d.find('text:' + re.escape(ans2[:20]), ns), d.find(mark2, ns)
            expect(m2 and (a2 is None or a2.cy < m2.cy), 'the new delivery is not below the earlier answers')
            # 4b. a choice in the bot's comment on a delivery: a tap answers in the talk, with the delivery quoted
            gone_ui = 'text:Hermes could not find|text:deleted on Hermes|text:belongs to Hermes itself|text:can.t be written|text:couldn.t be loaded right now'
            opt = self._scroll_to('desc:^Apples', 6)
            expect(opt, 'no choice card (option "Apples") on the delivery\'s comment')
            d.tap_xy(opt.cx, opt.cy)
            tc = self._turn_after(last_n, lambda t: t['text'].startswith('[hui:quote') and '[choice:' in t['text'], 40, 'the turn of the choice tap')
            expect(tc['sid'] == talk_sid and tc['profile'] == 'research', f'the choice went to {tc["profile"]} / {tc["sid"]} (want research / {talk_sid})')
            expect('[Cronjob' not in tc['text'] and '[choice:snack]' in tc['text'], f'the choice message carries a cron header or lost its tag: {tc["text"][:200]!r}')
            expect(self._answer_on_screen(tc['expected']), 'no answer to the choice tap on screen')
            expect(d.find(gone_ui) is None and d.find(S['failed']) is None, 'a read-only note / failure row after the choice tap')
            # 4c. the visible "Reply" link on a delivery: the typed text goes with the delivery's name and output quoted
            m2 = self._scroll_to(mark2, 6)
            expect(m2, 'the rent delivery is not on screen for "Reply"')
            links = [n for n in d.find_all('desc:^Reply$') if n.cy > m2.cy]
            expect(links, 'no visible "Reply" link on the delivery')
            link = min(links, key=lambda n: n.cy)
            n_reply = max(x['n'] for x in mock('/__e2e/turns'))
            d.tap_xy(link.cx, link.cy)
            expect(d.wait(S['input'], 6), 'no composer after "Reply"')
            reply = 'ja bitte, aber erst morgen'
            send(reply)
            tr_ = self._turn_after(n_reply, lambda t: t['text'].startswith('[hui:quote') and t['text'].rstrip().endswith(reply), 40, 'the reply turn')
            expect(tr_['sid'] == talk_sid and tr_['profile'] == 'research', f'the reply went to {tr_["profile"]} / {tr_["sid"]}')
            expect(f'{name2}: {out2}' in tr_['text'] and '[Cronjob' not in tr_['text'], f'the reply does not quote "<job>: <output>" cleanly: {tr_["text"][:200]!r}')
            expect(self._answer_on_screen(tr_['expected']), 'no answer to the reply on screen')
            expect(d.find(gone_ui) is None and d.find(S['failed']) is None, 'a read-only note / failure row after the reply')
            # 5. not under Chats; the roster has one row for the bot
            expect(d.tap(S['chats'], 8), 'Chats button not found')
            tab = d.wait(S['tab_chats'], 8)
            expect(tab, 'no Chats tab')
            d.tap_xy(tab.cx, tab.cy)
            time.sleep(1.0)
            ns = d.dump()
            # drawer rows carry "<title>, <source>" as their label; the chat behind the drawer only has the bubble text
            for bad in ('^Bot Chat, ', '^' + re.escape(follow1) + ', ', '^' + re.escape(follow2) + ', ', 'hui-bot'):
                expect(d.find('desc:' + bad, ns) is None, f'Chats lists the bot\'s talk or Bot Chat ({bad})')
            tab = d.find(S['tab_bots'], ns)
            expect(tab, 'no Bots tab')
            d.tap_xy(tab.cx, tab.cy)
            expect(d.wait('id:^bot-row-research$', 8), 'no roster row for the bot')
            rows = d.find_all('id:^bot-row-research$')
            expect(len(rows) == 1, f'{len(rows)} roster rows for one bot')
            d.sh('input keyevent 4')
            time.sleep(0.8)
            # 6. force-stop + relaunch: the same timeline, each thing once
            force_stop()
            launch()
            self._open_bot('research', 'Research')
            expect(d.wait(mark2, 25), 'the newest reminder is not shown after a restart')
            time.sleep(1.5)
            for label, spec in (('second reminder', mark2), ('second answer', 'text:' + re.escape(ans2[:20])), ('first answer', 'text:' + re.escape(ans1[:30])), ('first reminder', mark1)):  # newest first: scrolling only goes up
                n = count(spec)
                if n == 0 and self._find_scrolling(spec):
                    n = count(spec)
                expect(n == 1, f'after a restart the {label} is shown {n}x (want once)')
            expect(d.find(readonly) is None, 'the read-only bar after a restart')
            expect(d.find('text:couldn.t be loaded right now') is None, 'a load-failure row after a restart although both lookups work')
            ws = stored(out1)
            expect(sum(ws.values()) == 1, f'after a restart the reminder is stored {sum(ws.values())}x ({ws})')
            # 7. failure: the Bot Chat lookup answers 500
            mock('/__e2e/config', {'botChatLookupFail': True})
            force_stop()
            launch()
            self._open_bot('research', 'Research')
            row = d.wait(failed, 25)
            if not row:
                debug_dump('bots_aplus-failed')
                d.screenshot_jpg(os.path.join(shots, 'failed-missing.jpg'))
            expect(row, 'no visible "Deliveries couldn\'t be loaded" row although the Bot Chat lookup fails')
            expect(d.find(retry) is not None, 'no retry button next to the failure row')
            expect(d.find(S['input']) is not None, 'no composer while the lookup fails (the talk must stay usable)')
            d.screenshot_jpg(os.path.join(shots, 'failed.jpg'))
            expect(self._find_scrolling(mark1) is not None, 'the stored reminder vanished while the lookup fails')
            mock('/__e2e/config', {'botChatLookupFail': False})
            btn = d.find(retry) or d.wait(retry, 5)
            expect(btn, 'the retry button scrolled away')
            d.tap_xy(btn.cx, btn.cy)
            ok = self._gone(failed, 25) and self._gone(retry, 10)
            if not ok:  # state before the cleanup below changes the mock again
                debug_dump('bots_aplus-after-retry')
                d.screenshot_jpg(os.path.join(shots, 'after-retry-failed.jpg'))
                reqs = [(q['method'], q['path'], q['status']) for q in mock('/__e2e/requests')[-12:]]
                print('bots_aplus: last requests after retry:', reqs)
            expect(ok, 'the failure row / retry button stays after "Try again" although the lookup works again')
            # 8. the talk was deleted in another client: Hermes refuses its id for good (`not_found`)
            gone_text = 'noch eine frage'
            n_gone = max(x['n'] for x in mock('/__e2e/turns'))
            expect(mock('/__e2e/delete-session', {'id': talk_sid})['deleted'] == talk_sid, 'the mock had no talk to delete')
            t_del = time.time() * 1000
            send(gone_text)
            tg = self._turn_after(n_gone, lambda t: t['text'] == gone_text and t['state'] == 'ended', 60, 'the message after the talk was deleted')
            expect(tg['sid'].startswith(talk_sid + '--') and tg['profile'] == 'research', f'answered in session {tg["sid"]} (want {talk_sid}--…)')
            tries = [q for q in mock('/__e2e/requests') if q['path'].endswith('/v1/chat/completions') and q.get('sid') == talk_sid and q['t'] >= t_del]
            exp_gone = expected_for(gone_text)
            answered = failed_old = []
            end = time.time() + 40
            while time.time() < end:  # the answered copy lives in the new talk; the refused attempt may stay in the old one as history
                hits = answers_for(gone_text)
                answered = [h for h in hits if h[2] and h[2].get('status') == 'done' and h[2].get('text', '').rstrip() == exp_gone.rstrip()]
                failed_old = [h for h in hits if h not in answered]
                if answered:
                    break
                time.sleep(1.5)
            expect(len(answered) == 1, f'the message is answered in {len(answered)} stored conversations (want 1)')
            time.sleep(3.0)  # a failure row would show by now
            d.screenshot_jpg(os.path.join(shots, 'deleted-talk.jpg'))
            bad = 'text:Hermes could not find|text:deleted on Hermes|text:not.found|text:Answer failed|id:^msg-failed$|desc:^Answer failed'
            seen_bad, user_rows, saw_old = [], 0, False
            for i in range(10):  # from the newest row up to the oldest: no failure row anywhere, the earlier messages still there
                ns = d.dump()
                user_rows += len(d.find_all('text:^' + re.escape(gone_text) + '$', ns))
                hit = d.find(bad, ns)
                if hit:
                    seen_bad.append(hit.text or hit.desc)
                saw_old = saw_old or bool(d.find('text:' + re.escape(ans1[:30]), ns))
                scroll_up(2)
            expect(not seen_bad, f'a failure row is shown on the timeline after the talk was deleted: {seen_bad}')
            expect(user_rows == 1, f'the message is shown {user_rows}x on the timeline (want once)')
            expect(saw_old, 'the earlier messages are gone from the screen after the talk moved')
            return dict(session=talk_sid, bot_chat=fired['sessionId'], second_delivery_after_s=took, choice_turn=tc['n'], reply_turn=tr_['n'], moved_to=tg['sid'], refused_tries=len(tries), stored_refused_attempts=len(failed_old), shots=sorted(os.listdir(shots)))
        finally:
            mock('/__e2e/config', {'profiles': False, 'quick': False, 'authority': False, 'botChatLookupFail': False})
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

    # ── reading: quote/reply, drafts, jump to latest (app/src/chat/quote.ts, readingStore.ts) ───────────────────
    def c_quote_reply(self):
        """two quotes (swipe on an answer, long-press "Reply" on a user message) → one turn whose text carries both
        [hui:quote] blocks in order + the typed text; the bubble shows two quote boxes, never the raw tags; a tap on the
        first one jumps back to the cited answer (also after a force-stop)"""
        new_chat()
        first, longer, follow = 'e2e quote one', 'e2e quote long', 'e2e quote follow'
        send(first)
        wait_answer(first, expected_for(first), 30)
        send(longer)
        wait_answer(longer, expected_for(longer), 60)
        time.sleep(1)
        cited = 'text:^Short answer to "e2e quote one"'
        n = on_screen(cited)
        for _ in range(4):
            if n:
                break
            scroll_up(1)
            n = on_screen(cited)
        expect(n, 'the first answer is not found by scrolling up')
        swipe_right(n)
        expect(wait_composer_quotes(1), 'no quote above the composer after the swipe')
        d.hide_keyboard()
        # back down: the long question's bubble, long-press → "Reply"
        btn = d.find(S['jump_latest'])
        if btn:
            d.tap_xy(btn.cx, btn.cy)
            time.sleep(1.2)
        q = on_screen('text:^e2e quote long$')
        for _ in range(4):
            if q:
                break
            scroll_up(1)
            q = on_screen('text:^e2e quote long$')
        expect(q, 'the long question bubble is not on screen')
        long_press(q)
        expect(d.tap(S['quote_reply'], 5), '"Reply" not in the message menu')
        quotes = wait_composer_quotes(2)
        expect(len(quotes) == 2, f'{len(quotes)} quotes above the composer (want 2)')
        expect(quotes[0].desc.startswith('Quote 1 of 2 from Answer') and quotes[1].desc.startswith('Quote 2 of 2 from You'), f'quote order: {[x.desc for x in quotes]}')
        self.shot('quote-composer')
        send(follow)
        t = None
        end = time.time() + 30
        while time.time() < end and not t:
            ts = [x for x in turns_ending(follow) if x['state'] == 'ended']
            t = ts[-1] if ts else None
            time.sleep(0.5)
        expect(t, 'the follow-up turn did not end at the mock')
        text = t['text']
        expect(text.count('[hui:quote') == 2 and text.index('from=assistant') < text.index('from=user'), f'quote blocks in the sent text: {text[:300]!r}')
        expect('> Short answer to "e2e quote one"' in text and text.rstrip().endswith('\n\n' + follow), f'sent text shape: {text[:300]!r}')
        expect(len(turns_ending(follow)) == 1, 'the follow-up ran more than once (or a hidden extra message)')
        time.sleep(1.5)
        expect(not d.find('text:hui:quote'), 'raw [hui:quote] text is visible')
        expect(not composer_quotes(), 'the quotes stayed in the composer after sending')
        self.shot('quote-bubble')

        def jump():
            box = d.wait('desc:^Quote 1 of 2 from Answer', 6)
            expect(box, 'the sent bubble has no first quote box')
            before = bool(on_screen(cited))
            d.tap_xy(box.cx, box.cy)
            time.sleep(1.8)
            expect(on_screen(cited), 'tap on the quote did not bring the cited answer on screen')
            return before

        visible_before = jump()
        force_stop()
        launch()
        time.sleep(1.5)
        btn = d.find(S['jump_latest'])
        if btn:
            d.tap_xy(btn.cx, btn.cy)
            time.sleep(1.2)
        visible_before_restart = jump()
        return dict(sent=text[:200], cited_visible_before_jump=visible_before, after_restart_visible_before=visible_before_restart)

    def c_draft_restart(self):
        """an unsent draft (text + a quote) stays in its chat across a force-stop and a switch to another chat; sending
        it clears it for good"""
        new_chat()
        base, draft = 'e2e draft base', 'e2e draft kept'
        send(base)
        wait_answer(base, expected_for(base), 30)
        time.sleep(1)
        a = on_screen('text:^Short answer to "e2e draft base"')
        expect(a, 'answer not on screen')
        swipe_right(a)
        expect(wait_composer_quotes(1), 'no quote after the swipe')
        expect(d.tap(S['input'], 6), 'composer not found')
        time.sleep(0.6)
        d.type_text(draft)
        expect(d.wait('text:^' + re.escape(draft) + '$', 6), 'draft not typed')
        d.hide_keyboard()
        time.sleep(1.5)  # debounced store write (readingStore WRITE_MS)
        force_stop()
        launch()
        expect(d.wait('text:^' + re.escape(draft) + '$', 10), f'draft lost after a force-stop (composer: {composer_text()!r})')
        expect(wait_composer_quotes(1, 5), 'the quote of the draft is gone after a force-stop')
        self.shot('draft-restored')
        # another chat: its own (empty) composer; back: the draft again
        new_chat()
        expect(not d.find('text:^' + re.escape(draft) + '$'), 'the draft leaked into a new chat')
        expect(d.tap(S['chats'], 6), 'drawer button not found')
        row = d.wait('text:e2e draft base|desc:e2e draft base', 8)
        expect(row, 'the chat is not in the drawer')
        d.tap_xy(row.cx, row.cy)
        expect(d.wait('text:^' + re.escape(draft) + '$', 10), 'draft not back after switching chats')
        btn = d.wait(S['send'], 5)
        expect(btn, 'Send not found')
        d.tap_xy(btn.cx, btn.cy)
        end = time.time() + 30
        while time.time() < end and not [x for x in turns_ending(draft) if x['state'] == 'ended']:
            time.sleep(0.5)
        expect([x for x in turns_ending(draft) if x['state'] == 'ended'], 'the draft was not sent')
        time.sleep(1.5)
        force_stop()
        launch()
        time.sleep(1.5)
        expect(not d.find('text:^' + re.escape(draft) + '$') or d.find(S['input']).text != draft, 'the sent draft came back into the composer')
        expect(not composer_quotes(), 'the sent quote came back into the composer')
        return dict(draft=draft)

    def c_jump_unread(self):
        """scrolled up while an answer streams: the jump button says "1 new answer"; a tap goes to the bottom; scrolled up
        again, the reading position survives a force-stop (the list opens away from the bottom)"""
        new_chat()
        longer, slow = 'e2e unread long', 'e2e unread slow'
        send(longer)
        wait_answer(longer, expected_for(longer), 60)
        time.sleep(1)
        send(slow)
        stream_progress(slow, 40, 20)
        # no uiautomator while streaming: scroll blind, then wait for the end of the turn
        scroll_up(3)
        wait_turn(slow, lambda t: t['state'] == 'ended', 60, 'end of the slow answer')
        time.sleep(2)
        btn = d.wait('desc:^Go to the latest message, 1 new answer$', 8)
        expect(btn, f'jump button without the unread count (button: {[n.desc for n in d.find_all(S["jump_latest"])]})')
        expect(d.find('text:^1 new answer$'), '"1 new answer" label not shown')
        self.shot('jump-unread')
        d.tap_xy(btn.cx, btn.cy)
        expect(d.wait(S['jump_latest'], 6, gone=True) is not None or not d.find(S['jump_latest']), 'jump button still shown at the bottom')
        time.sleep(1)
        scroll_up(3)
        time.sleep(1.5)
        expect(d.find(S['jump_latest']), 'not scrolled away before the restart')
        force_stop()
        launch()
        restored = d.wait('id:^chat-jump-latest$|desc:^Scroll to bottom$', 10)
        expect(restored, 'after a force-stop the chat opens at the bottom (reading position lost)')
        expect(not d.find('text:new answer'), 'unread count after the restart although nothing new arrived')
        return dict(unread_label=btn.desc)

    def c_upgrade(self):
        """upgrade path (docs/RELEASING.md): the installed build (E2E_APK, e.g. the previous release) holds a paired
        connection and a chat with two turns; E2E_UPGRADE_APK is installed over it (`adb install -r`, same signature, higher
        versionCode). Nothing may vanish: the same messages are stored, the chat is in the drawer, the connection still
        works (a new turn is answered) and Settings shows the new build."""
        newer = os.environ.get('E2E_UPGRADE_APK', '')
        expect(newer, 'E2E_UPGRADE_APK is not set')
        old_label = None
        new_chat()
        first, second = 'e2e draft base', 'e2e long stream'
        for p in (first, second):
            mark_sent(p)
            send(p)
            wait_answer(p, expected_for(p), 60)
        before = {c: [(m.get('id'), m.get('role'), m.get('text')) for m in ms] for c, ms in transcripts().items()}
        expect(before, 'no stored chat before the upgrade')
        out = d.adb('install', '-r', newer, timeout=240)
        expect('Success' in out, f'adb install -r failed: {out.strip()[:200]}')
        force_stop()
        launch()
        time.sleep(3)
        after = {c: [(m.get('id'), m.get('role'), m.get('text')) for m in ms] for c, ms in transcripts().items()}
        expect(set(before) <= set(after), f'chats gone after the upgrade: {sorted(set(before) - set(after))}')
        for c, ms in before.items():
            expect(after[c][:len(ms)] == ms, f'messages of {os.path.basename(c)} changed or vanished after the upgrade')
        expect(d.find(S['input']), 'no composer after the upgrade (onboarding again?)')
        expect(d.find(S['connect']) is None and d.find(S['consent']) is None, 'onboarding shown after the upgrade')
        self.shot('upgrade-after-install')
        expect(d.tap(S['chats'], 8), 'drawer not found after the upgrade')
        expect(d.wait('desc:e2e draft base|text:e2e draft base|desc:e2e long stream|text:e2e long stream', 10), 'the old chat is not in the drawer after the upgrade')
        self.shot('upgrade-drawer')
        d.sh('input keyevent 4')
        time.sleep(1)
        ensure_app()
        third = 'e2e draft after the update'
        mark_sent(third)
        send(third)
        wait_answer(third, expected_for(third), 60)
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        expect(d.tap(S['settings'], 8), 'Settings entry not found in the drawer')
        w, h = d.screen_size()
        ver = None
        for _ in range(25):  # About is the last section of Settings
            ver = d.find(S['version'])
            if ver:
                break
            d.swipe(w // 2, int(h * 0.7), w // 2, int(h * 0.25), 350)
            time.sleep(0.5)
        expect(ver, 'no version label in Settings after the upgrade')
        expect('Build 2' in ver.text, f'Settings still shows the old build: {ver.text}')
        return dict(chats=len(before), version=ver.text)

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
            expect(d.wait('text:^To “Saturday barbecue”: Sausages ticked$', 10), 'no "To “Saturday barbecue”: Sausages ticked" line under the follow-up (the tick did not go with it)')
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

        actions_sheet = 'desc:^(Answer actions|Aktionen zur Antwort)$'

        def unstick():
            """puts the screen back to the chat if something got in the way. On a loaded emulator a slow swipe is taken for a
            long press (the answer's actions sheet covers the chat), the app can be sent home by a system gesture or an "isn't
            responding" dialog covers it. Each of these is recorded in the trace, so a recovery stays visible in the report."""
            if d.top_activity() != PKG:
                mark('app not in front, relaunching')
                ensure_app()
            elif d.find(actions_sheet):
                mark('answer actions sheet in the way, Back')
                d.sh('input keyevent 4')
                time.sleep(0.8)
            else:
                d.dismiss_anr()

        def open_card(spec, what, opens, tries=3):
            """taps the row `spec` until the card with the marker `opens` is up; a tap that landed while the list was still
            settling (or got swallowed by an overlay) is repeated after unstick() instead of failing the run"""
            for _ in range(tries):
                row = reveal(spec, what)
                d.tap_xy(row.cx, row.cy)
                if d.wait(opens, 10):
                    return row
                mark(f'{what}: card not open after the tap')
                unstick()
            raise Fail(f'{what}: the card did not open')

        def reveal(spec, what, tries=10, min_h=90):
            """the node for spec once it is fully inside the visible list: clear of the header / demo banner on top and of the
            composer at the bottom (a row cut off there has bounds, but a tap on its centre hits the banner). Scrolls the list
            by a moderate swipe in the middle of the screen until it is. A node cut off at the list's edge is a sliver (the
            panel and the rows are 100-200 px tall), so it must also be at least min_h high."""
            for _ in range(tries):
                unstick()
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
                row = open_card(L['search'], f'{tag}: web search row', L['how'])
                mark(f'search row at {row.b}')
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
                open_card(L['pages'], f'{tag}: pages row', L['read'])
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
        # tapping the sent file: the system sheet gets a copy under its own name, not the app's storage name
        expect(d.tap('desc:^e2e-share\\.pdf, ', 8), 'sent PDF has no file card in the bubble')
        time.sleep(2)
        shared = d.adb('exec-out', f'ls /data/data/{PKG}/cache/hui-share', timeout=15).split()
        expect(shared == ['e2e-share.pdf'], f'shared copy is named {shared}')
        shots['open'] = self._shot('pdf-3-share-sheet')
        d.sh('input keyevent 4')
        time.sleep(1)
        ensure_app()
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
        # Bots A+: the bot's talk is its one thread; its menu has About / Find / Share, no Delete (the chat stays by design)
        return dict(answer=a['text'][:120], chars=len(a['text']))

    def c_live_chat(self):
        """what a normal user does after pairing with a default bridge (docs/RELEASING.md): realistic multi-turn chats in
        en/de/es with typos and the short follow-ups ("photos?", "as a table?", "more details?"), then Stop and an
        approval (Deny). adb input types ASCII only, so de/es have no umlauts. Every answer must finish and show visible
        text on screen (no empty gap), a shot per answer goes to live-chat/. Problems are collected, not fatal, so one
        run lists everything; the chats are deleted again."""
        shots = os.path.join(self.out, 'live-chat')
        os.makedirs(shots, exist_ok=True)
        problems, seen = [], []
        chats = {
            'en': ['whats a good budget smartphone for a student in 2026 pls', 'photos?', 'as a table?', 'more detials?'],
            'de': ['Plane mir ein Wochenende in Lissabon mit Kindern', 'Fotos?', 'als Tabelle?', 'mehr Detials bitte'],
            'es': ['dame una receta facil de tortilla de patatas', 'fotos?', 'en una tabla?', 'mas detalles?'],
        }
        locales = {'en': 'en-US', 'de': 'de-DE', 'es': 'es-ES'}
        def visible_text():
            ns = d.dump()
            return sum(len(n.text or n.desc or '') for n in ns if (n.text or n.desc) and n.b[1] > 150)
        only = os.environ.get('E2E_LIVE_CHAT_ONLY', '')  # 'reminder', 'approval' or 'stop': only that part
        for lang, prompts in ({} if only else chats).items():
            d.sh(f'cmd locale set-app-locales {PKG} --locales {locales[lang]}')
            force_stop()
            launch()
            new_chat()
            before, conv = set(transcripts()), None
            for i, p in enumerate(prompts):
                tag = f'{lang}{i}'
                try:
                    send(p)
                    end, a = time.time() + 150, None
                    while time.time() < end:
                        hits = [h for h in answers_for(p) if (h[0] == conv if conv else h[0] not in before)]
                        if hits and finished(hits[-1][2]):
                            a = hits[-1][2]
                            conv = conv or hits[-1][0]
                            break
                        time.sleep(2)
                    if not a:
                        problems.append(f'{tag} "{p}": no finished answer in 150 s')
                        continue
                    time.sleep(1.5)
                    d.wait(S['stop'], 20, gone=True)
                    vis = visible_text()
                    d.screenshot_jpg(os.path.join(shots, f'{tag}.jpg'))
                    seen.append(dict(tag=tag, status=a.get('status'), chars=len(a.get('text') or ''), visible=vis))
                    if a.get('status') != 'done':
                        problems.append(f'{tag} "{p}": status {a.get("status")}')
                    if not (a.get('text') or '').strip():
                        problems.append(f'{tag} "{p}": empty answer text')
                    if vis < 60:
                        problems.append(f'{tag} "{p}": only {vis} characters visible on screen (empty gap?)')
                    raw = [n.text for n in d.dump() if n.text and re.search(r'^\s*[{\[]\s*"(type|blocks)"|```hui', n.text)]
                    if raw:
                        problems.append(f'{tag} "{p}": raw card JSON on screen: {raw[0][:60]!r}')
                except Fail as e:
                    problems.append(f'{tag} "{p}": {e}')
                    break
            if conv:
                try:
                    if lang != 'en':  # the menu labels are localized: delete in English (the chat reopens)
                        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
                        force_stop()
                        launch()
                    self._delete_this_chat(prompts[0], conv)
                except Fail as e:
                    problems.append(f'{lang}: delete chat: {e}')
        d.sh(f'cmd locale set-app-locales {PKG} --locales en-US')
        force_stop()
        launch()
        if only in ('', 'stop'):
            # Stop: a long answer, Stop mid-stream, "Stopped" shown, the next message is answered. Words:delay trials
            # (E2E_LIVE_STOP_TRIALS, e.g. 600:4,3000:3,3000:20; delay = seconds after Send); a model can write 600 words in
            # about 11 s, so the default asks for far more than Stop needs.
            for spec in os.environ.get('E2E_LIVE_STOP_TRIALS', '3000:6').split(','):
                words, delay = spec.split(':')
                new_chat()
                before = set(transcripts())
                long_q = f'write a {words} word story about a lighthouse keeper, spec {spec}'
                # uiautomator never gets an idle UI while tokens arrive: Stop replaces Send at the same place
                btn = send(long_q)
                sent = time.time()
                time.sleep(float(delay))
                d.tap_xy(btn.cx, btn.cy)
                tapped = time.time() - sent
                marker = d.wait(S['stopped'], 20)
                d.screenshot_jpg(os.path.join(shots, f'stop-{words}-{delay}.jpg'))
                try:
                    _, _, a = self._live_answer(long_q, before, timeout=180)
                except Fail as e:
                    problems.append(f'stop {spec}: {e}')
                    continue
                st = dict(tag=f'stop {spec}', status=a.get('status'), chars=len(a.get('text') or ''), tapped_s=round(tapped, 1), marker=bool(marker))
                seen.append(st)
                if a.get('status') == 'done':
                    problems.append(f'stop {spec}: the answer had already finished when Stop was tapped ({st}), the check was too late')
                elif a.get('status') != 'stopped':
                    problems.append(f'stop {spec}: stored status {a.get("status")} after Stop ({st})')
                elif not marker:
                    problems.append(f'stop {spec}: stored as stopped, but no "Stopped" marker on screen ({st})')
                nxt = 'ok, now just say hi'
                try:
                    send(nxt)
                    self._live_answer(nxt, before, timeout=120)  # a chat created in this check: not in `before`
                except Fail as e:
                    problems.append(f'stop {spec}: the message after Stop got no answer: {e}')
        if only not in ('approval', 'stop'):
            # reminder: "remind me in 2 minutes" in a normal chat; the job fires into the default bot's Bot Chat, which the
            # drawer lists as "Hermes". On Hermes v0.22.3+ that thread is read-only ("New chat with Hermes" instead of the input)
            new_chat()
            rem = 'remind me in 2 minutes to drink tea'
            before = set(transcripts())
            send(rem)
            try:
                self._live_answer(rem, before, timeout=120)
                d.screenshot_jpg(os.path.join(shots, 'reminder-set.jpg'))
                end, row = time.time() + 420, None
                while time.time() < end and not row:
                    time.sleep(15)
                    ensure_app()
                    if d.tap(S['chats'], 6):
                        row = d.wait('desc:^Hermes, (?!choose)', 5)
                        if not row:  # close the drawer by tapping the dimmed chat (Back would leave the app)
                            wd, ht = d.screen_size()
                            d.tap_xy(wd - 20, ht // 2)
                if not row:
                    d.tap(S['chats'], 6)
                    time.sleep(1.5)
                    d.screenshot_jpg(os.path.join(shots, 'reminder-drawer.jpg'))
                    rows = [n.desc for n in d.dump() if n.desc and ', ' in n.desc][:12]
                    problems.append(f'reminder: drawer rows {rows}')
                    problems.append('reminder: no "Hermes" thread in the drawer 7 minutes after "remind me in 2 minutes"')
                else:
                    d.tap_xy(row.cx, row.cy)
                    text = d.wait('text:(?i)tea|desc:(?i)tea', 20)
                    d.screenshot_jpg(os.path.join(shots, 'reminder-thread.jpg'))
                    if not text:
                        problems.append('reminder: the Bot Chat thread shows no reminder text')
                    ns = d.dump()
                    if d.find(S['input'], ns):
                        seen.append(dict(tag='botchat', composer='shown (Hermes v0.22.2 behaviour)'))
                    elif not d.find('text:^New chat with|desc:^New chat with', ns):
                        problems.append('bot chat: neither an input field nor "New chat with Hermes"')
            except Fail as e:
                problems.append(f'reminder: {e}')
        if only in ('', 'approval'):
            # approval: ask for something that needs one, Deny it
            new_chat()
            ap = 'please run the command sudo -n -s true with your terminal tool'
            send(ap)
            # the card's deadline bar ticks, so uiautomator cannot dump while it shows (the UI is never idle): wait for the
            # card with a screenshot-free fixed delay, then tap Deny by its position (left button of the card's row)
            time.sleep(35)
            d.screenshot_jpg(os.path.join(shots, 'approval.jpg'))
            wd, ht = d.screen_size()
            d.tap_xy(int(wd * 0.17), int(ht * 0.743))
            time.sleep(8)
            d.screenshot_jpg(os.path.join(shots, 'approval-denied.jpg'))
            hits = [m for ms in transcripts().values() for m in ms if m.get('role') == 'assistant' and 'sudo' in (m.get('text') or '')]
            if not hits:
                problems.append('approval: no assistant text mentioning sudo after Deny (card not answered?)')
        expect(not problems, f'{len(problems)} problem(s): ' + ' | '.join(problems) + f' (answers: {seen})')
        return dict(answers=seen, problems=problems)

    def c_live_aplus(self):
        """Bots A+ against a REAL Hermes (v0.22.3+) and the default bridge: a real reminder (cron `deliver: bot-chat`) fired
        while the bot's screen is open arrives by the bridge's inbox (not only the 60 s poll), a typo'd follow-up is answered
        in the same timeline, and a second reminder fired while the app is in the background raises a notification whose tap
        lands on the delivery. Needs E2E_LIVE_API (Hermes API base, host side) + E2E_LIVE_KEY_FILE."""
        expect(LIVE_API and LIVE_KEY_FILE, 'E2E_LIVE_API / E2E_LIVE_KEY_FILE not set')
        key = open(LIVE_KEY_FILE).read().strip()
        shots = os.path.join(self.out, 'live-aplus')
        os.makedirs(shots, exist_ok=True)

        def hermes(path, method='GET', body=None):
            rq = urllib.request.Request(LIVE_API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(rq, timeout=30) as r:
                raw = r.read()
            return json.loads(raw) if raw else {}

        def remind(name, line):
            return hermes('/api/jobs', 'POST', {'name': name, 'schedule': 'in 2m', 'deliver': 'bot-chat', 'prompt': f'Reply with only this line: {line}'})['job']['id']

        jobs, res = [], {}
        run_id = int(time.time()) % 100000  # the Bot Chat keeps earlier runs' deliveries: every run needs its own text
        mark1, mark2 = f'Aplus Live Eins {run_id}', f'Aplus Live Zwei {run_id}'
        try:
            force_stop()
            launch()
            ensure_app()
            self._open_default_bot()
            t_fire = time.time()
            jobs.append(remind(mark1, f'⏰ {mark1}'))
            seen = None
            end = time.time() + 260
            while time.time() < end and not seen:
                seen = d.find(f'text:{mark1}|desc:{mark1}')
                time.sleep(1.0)
            t_seen = time.time()
            expect(seen, 'the delivery did not show on the open bot screen within 260 s')
            res['screen_open_delivery_s'] = round(t_seen - t_fire)
            self.r.metric('live_aplus_open_screen_delivery_s', res['screen_open_delivery_s'])
            ns = d.dump()
            expect(d.find('text:Cronjob', ns) is None, 'the injected cron header is shown as a message')
            expect(d.find('text:belongs to Hermes itself|desc:belongs to Hermes itself', ns) is None, 'read-only bar on the bot screen')
            self.shot('live-aplus-1-delivery')
            # a typo'd follow-up in the same timeline
            before = set(transcripts())
            send('verschieb das um ne stunde')
            expect(d.wait('text:^verschieb das um ne stunde$', 20), 'the follow-up message is not on the timeline after sending')
            d.wait(S['stop'], 8)  # a fast answer may be over already
            expect(d.wait(S['stop'], 120, gone=True), 'the follow-up did not finish')
            time.sleep(1.0)
            time.sleep(2)
            ns = d.dump()
            expect(d.find(f'text:{mark1}|desc:{mark1}', ns), 'the delivery vanished after the follow-up')
            expect(d.find('text:^verschieb das um ne stunde$', ns), 'the follow-up message is not on the timeline')
            expect(d.find('text:(?i)antwort fehlgeschlagen|answer failed', ns) is None, 'the follow-up failed')
            self.shot('live-aplus-2-followup')
            # background: a second reminder → a notification → tap → the delivery
            jobs.append(remind(mark2, f'⏰ {mark2}'))
            d.sh('input keyevent 3')  # HOME
            note, end = None, time.time() + 280
            while time.time() < end and not note:
                note = next((x for x in notifications() if mark2 in x or 'Aplus' in x), None)
                time.sleep(2)
            res['notifications_seen'] = notifications()[:6]
            self.r.metric('live_aplus_background_notification', note or f'none within 280 s (without FCM the bridge push cannot reach the emulator; seen: {notifications()[:6]})')
            if not note:
                launch()  # no push here: opening the app must still show the delivery (inbox/poll on foreground)
                got = d.wait(f'text:{mark2}|desc:{mark2}', 60)
                expect(got, 'the second delivery is not on the bot screen after returning to the app')
                self.shot('live-aplus-3-after-return')
                res['tap'] = 'no notification (no FCM); delivery shown after returning to the app'
                return res
            d.sh('cmd statusbar expand-notifications')
            time.sleep(1.5)
            n = d.wait(f'text:{mark2}|text:(?i)aplus|desc:(?i)aplus', 8)
            if n:
                d.tap_xy(n.cx, n.cy)
            else:
                d.sh('cmd statusbar collapse')
                launch()  # no tappable row found: the tap path is NOT proven, only the notification
                res['tap'] = 'row not found, app launched instead'
            time.sleep(3)
            got = d.wait(f'text:{mark2}|desc:{mark2}', 20)
            res.setdefault('tap', 'notification tapped' if n else res.get('tap'))
            expect(got, f'the second delivery is not on the screen after opening ({res["tap"]})')
            expect(d.find(S['input']), 'no composer after opening from the notification')
            self.shot('live-aplus-3-from-notification')
            return res
        finally:
            for j in jobs:
                try:
                    hermes(f'/api/jobs/{j}', 'DELETE')
                except Exception:
                    pass

    def c_live_bg(self):
        """What a normal Android user with the default bridge and no FCM gets while the app is in the background, as
        measurements (report.json, no pass/fail on the outcome, only on the controls): a running answer, a reminder fired by
        Hermes, the same reminder with "Also remind me on this device", and a reminder fired while the app is open on
        another chat. Doze and standby are switched off and the device's state is recorded, so a missing notification
        cannot be an emulator artefact; the running answer's notification is the control that notifications work at all."""
        expect(LIVE_API and LIVE_KEY_FILE, 'E2E_LIVE_API / E2E_LIVE_KEY_FILE not set')
        key = open(LIVE_KEY_FILE).read().strip()

        def hermes(path, method='GET', body=None):
            rq = urllib.request.Request(LIVE_API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(rq, timeout=30) as r:
                raw = r.read()
            return json.loads(raw) if raw else {}

        def job_ids():
            data = hermes('/api/jobs?include_disabled=true')
            return {j['id'] for j in (data.get('jobs', []) if isinstance(data, dict) else data)}

        def device_state():
            return dict(
                deep=d.sh('dumpsys deviceidle get deep').strip(), light=d.sh('dumpsys deviceidle get light').strip(),
                bucket=d.sh(f'am get-standby-bucket {PKG}').strip(), pid=d.sh(f'pidof {PKG}').strip(),
                top=d.top_activity(), net='1 received' in d.sh('ping -c 1 -W 2 10.0.2.2'),
                allowed=d.sh(f'cmd appops get {PKG} POST_NOTIFICATION').strip()[:60], at=int(time.time()))

        def watch(pred, end):
            """the first notification pred accepts, with the seconds it took; None when `end` passed"""
            t0 = time.time()
            while time.time() < end:
                hit = next((x for x in notifications() if pred(x)), None)
                if hit:
                    return dict(text=hit[:120], after_s=round(time.time() - t0))
                time.sleep(2)
            return None

        def fired(job, limit=330):
            """seconds until Hermes ran the job (a finished one-shot is gone from the list or has a last run)"""
            t0, end = time.time(), time.time() + limit
            while time.time() < end:
                try:
                    j = hermes(f'/api/jobs/{job}').get('job') or {}
                    if j.get('last_run_at'):
                        return round(time.time() - t0)
                except urllib.error.HTTPError:
                    return round(time.time() - t0)
                time.sleep(3)
            return None

        def tap_note(needle):
            """tap this notification in the shade; what is on the screen afterwards"""
            d.sh('cmd statusbar expand-notifications')
            time.sleep(1.5)
            n = d.wait(f'text:(?i){needle}|desc:(?i){needle}', 8)
            if not n:
                d.sh('cmd statusbar collapse')
                return dict(tapped=False)
            d.tap_xy(n.cx, n.cy)
            time.sleep(5)
            texts = [x.text or x.desc for x in d.dump() if (x.text or x.desc)]
            return dict(tapped=True, top=d.top_activity(), composer=bool(d.find(S['input'])), screen=[t[:70] for t in texts][:14])

        res = {}
        for cmd in ('dumpsys deviceidle disable', f'dumpsys deviceidle whitelist +{PKG}', f'am set-standby-bucket {PKG} active',
                    f'cmd appops set {PKG} RUN_ANY_IN_BACKGROUND allow', f'pm grant {PKG} android.permission.POST_NOTIFICATIONS'):
            d.sh(cmd)
        before, run_id = job_ids(), int(time.time()) % 100000
        try:
            # control: a running answer in the background
            force_stop()
            launch()
            ensure_app()
            new_chat()
            send(f'Write a detailed essay of about 1500 words on the history of tea. ({run_id})')
            d.sh('input keyevent 3')  # HOME while it is running; a short answer would be over before this
            answering = watch(lambda x: 'is answering' in x, time.time() + 25)
            ready = watch(lambda x: x.startswith('Answer ready'), time.time() + 180)
            res['control_answer'] = dict(answering=answering, ready=ready, state=device_state())
            self.r.metric('live_bg_control_answer_ready', ready or 'none')
            expect(ready, f'control failed: no "Answer ready" notification at all, the run says nothing (seen: {notifications()[:4]})')
            res['control_answer']['tap'] = tap_note('Answer ready')
            self.shot('live-bg-1-answer-tap')
            # a reminder fired by Hermes, app in the background, no device copy
            ensure_app()
            mark = f'Bg Note {run_id}'
            job = hermes('/api/jobs', 'POST', {'name': mark, 'schedule': 'in 2m', 'deliver': 'bot-chat', 'prompt': f'Reply with only this line: ⏰ {mark}'})['job']['id']
            d.sh('input keyevent 3')
            time.sleep(5)
            bg_start = device_state()
            secs = fired(job)
            at_fire = device_state()
            note = watch(lambda x: mark in x or 'Bot Chat' in x, time.time() + 120)
            res['reminder_background'] = dict(fired_after_s=secs, notification=note, seen=notifications()[:6], start=bg_start, at_fire=at_fire, end=device_state())
            self.r.metric('live_bg_reminder_notification', note or f'none within 120 s after the run (fired after {secs} s)')
            res['reminder_background']['tap'] = tap_note(mark) if note else None
            launch()
            res['reminder_background']['back_in_app'] = bool(d.wait(f'text:{mark}|desc:{mark}', 5))
            self.shot('live-bg-2-back')
            # the same with "Also remind me on this device" on the reminder card
            new_chat()
            send(f'Remind me in 3 minutes to drink tea {run_id}')
            d.wait(S['stop'], 8)
            d.wait(S['stop'], 120, gone=True)
            card = d.wait('desc:^Reminder set · ', 30)
            res['device_copy'] = dict(card=(card.desc or '')[:200] if card else None)
            if card and d.tap('text:^Also remind me on this device$', 8):
                expect(d.wait('text:^This device reminds you too: ', 10), 'the device copy was not confirmed on the card')
                d.sh('input keyevent 3')
                note = watch(lambda x: 'tea' in x.lower(), time.time() + 240)
                res['device_copy'].update(notification=note, state=device_state(), seen=notifications()[:6])
                self.r.metric('live_bg_device_copy_notification', note or 'none within 240 s')
                res['device_copy']['tap'] = tap_note('tea') if note else None
                self.shot('live-bg-3-device-tap')
            # app open on another chat when the reminder fires
            ensure_app()
            new_chat()
            mark = f'Bg Open {run_id}'
            job = hermes('/api/jobs', 'POST', {'name': mark, 'schedule': 'in 2m', 'deliver': 'bot-chat', 'prompt': f'Reply with only this line: ⏰ {mark}'})['job']['id']
            secs = fired(job)
            note = watch(lambda x: mark in x, time.time() + 75)
            res['reminder_open'] = dict(fired_after_s=secs, notification=note, state=device_state())
            self.r.metric('live_bg_open_other_chat_notification', note or 'none (the app is open)')
            d.tap(S['chats'], 8)
            time.sleep(1.5)
            rows = [x.desc for x in d.dump() if x.desc and re.search(r'^(Hermes|Bot Chat)\b', x.desc)]
            res['reminder_open']['rows'] = [r[:90] for r in rows[:4]]
            self.shot('live-bg-4-open-drawer')
            return res
        finally:
            for j in job_ids() - before:
                try:
                    hermes(f'/api/jobs/{j}', 'DELETE')
                except Exception:
                    pass
            d.sh('dumpsys deviceidle enable')

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


    # ── 0.3 RC last QA gaps (E2E_LIVE_EXTRA=qalast): a real Hermes behind the default bridge ───────────────
    def _live_hermes(self, path, method='GET', body=None):
        """Hermes' own API from the host side (E2E_LIVE_API + the key file); never prints the key"""
        expect(LIVE_API and LIVE_KEY_FILE, 'E2E_LIVE_API / E2E_LIVE_KEY_FILE not set')
        key = open(LIVE_KEY_FILE).read().strip()
        rq = urllib.request.Request(LIVE_API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                    headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(rq, timeout=30) as r:
            raw = r.read()
        return json.loads(raw) if raw else {}

    def _live_bridge(self, path, method='GET', body=None):
        """the bridge's own API from the host side (E2E_LIVE_BRIDGE + E2E_LIVE_BRIDGE_TOKEN_FILE), for the owner switch"""
        base, tf = os.environ.get('E2E_LIVE_BRIDGE', ''), os.environ.get('E2E_LIVE_BRIDGE_TOKEN_FILE', '')
        expect(base and tf, 'E2E_LIVE_BRIDGE / E2E_LIVE_BRIDGE_TOKEN_FILE not set')
        tok = json.load(open(tf)).get('token', '')
        rq = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                    headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(rq, timeout=30) as r:
            raw = r.read()
        return json.loads(raw) if raw else {}

    def _open_default_bot(self):
        """the default bot's screen: its row in the Bots tab when the bridge offers more bots, else the "Hermes" row of the chat list"""
        ensure_app()
        expect(d.tap(S['chats'], 8), 'Chats button not found')
        tab = d.wait(S['tab_bots'], 8)
        if tab:
            d.tap_xy(tab.cx, tab.cy)
            row = d.wait('id:^bot-row-default$', 12)
            expect(row, 'no default bot row in the Bots tab')
        else:
            expect(d.wait('desc:^Hermes, (Local|App)$', 12), 'the drawer lists no "Hermes" entry for the default bot')
            d.hide_keyboard()
            time.sleep(1.0)
            row = d.wait('desc:^Hermes, (Local|App)$', 5)
        d.tap_xy(row.cx, row.cy)
        expect(d.wait(S['input'], 10), 'no composer on the default bot screen')
        expect(d.find('desc:^Search chats$') is None, 'the drawer is still open: the bot row did not open')

    def c_live_firstuse(self):
        """gap 2: a NON-default bot (own Hermes profile) on a fresh Hermes: plain first use with the fresh talk id
        `hui-bot-<bot>` (no recovery generation), its answer is its own, and its timeline is separate from the default
        bot's (a delivery to the default Bot Chat never shows under the bot, the bot's message never under the default)"""
        shots = os.path.join(self.out, 'live-firstuse')
        os.makedirs(shots, exist_ok=True)
        res = {}
        pre = self._live_hermes(f'/p/{LIVE_BOT}/api/sessions?limit=100').get('data', [])
        res['talks_before'] = [x['id'] for x in pre if str(x.get('id', '')).startswith('hui-bot-')]
        expect(not res['talks_before'], f'not a first use: the bot already has talk sessions {res["talks_before"]}')
        force_stop()
        launch()
        self._open_bot(LIVE_BOT, LIVE_BOT_LABEL, shot=f'firstuse-{LIVE_BOT}')
        d.screenshot_jpg(os.path.join(shots, '1-empty.jpg'))
        before = set(transcripts())
        p = 'Describe the sea in one sentence. Qalast first use.'
        send(p)
        conv, _, a = self._live_answer(p, before)
        expect(a.get('status') == 'done', f'bot answer status {a.get("status")}')
        if LIVE_BOT_MARK:
            expect(re.search(LIVE_BOT_MARK, a['text'], re.I), f'answer lacks the bot personality: {a["text"][:100]!r}')
        time.sleep(2)
        d.screenshot_jpg(os.path.join(shots, '2-answered.jpg'))
        post = self._live_hermes(f'/p/{LIVE_BOT}/api/sessions?limit=100').get('data', [])
        talks = [x['id'] for x in post if str(x.get('id', '')).startswith('hui-bot-')]
        res['talks_after'] = talks
        expect(talks == [f'hui-bot-{LIVE_BOT}'], f'expected the one fresh talk hui-bot-{LIVE_BOT} (no generation suffix), got {talks}')
        # isolation: a delivery to the DEFAULT bot's Bot Chat while the bot's screen is open
        mark = f'Qalast Zustellung {int(time.time()) % 100000}'
        job = self._live_hermes('/api/jobs', 'POST', {'name': 'qalast iso', 'schedule': 'every 6h', 'deliver': 'bot-chat',
                                                    'prompt': f'Reply with only this line: {mark}'})['job']['id']
        try:
            self._live_hermes(f'/api/jobs/{job}/run', 'POST', {})
            time.sleep(100)  # cron tick (<= 60 s) + run + the bridge's poll
            ns = d.dump()
            expect(d.find(f'text:{mark}|desc:{mark}', ns) is None, 'the default bot\'s delivery shows in the other bot\'s timeline')
            expect(d.find(f'text:{re.escape(p)}|desc:{re.escape(p)}', ns), 'the bot\'s own message is gone from its timeline')
            d.screenshot_jpg(os.path.join(shots, '3-bot-after-default-delivery.jpg'))
            self._open_default_bot()
            got = d.wait(f'text:{mark}|desc:{mark}', 90)
            d.screenshot_jpg(os.path.join(shots, '4-default-timeline.jpg'))
            expect(got, 'the delivery is not on the default bot\'s timeline')
            expect(d.find(f'text:{re.escape(p)}|desc:{re.escape(p)}') is None, 'the other bot\'s message shows in the default bot\'s timeline')
            res['isolation'] = 'ok'
        finally:
            try:
                self._live_hermes(f'/api/jobs/{job}', 'DELETE')
            except Exception:
                pass
        return res

    def c_live_upgrade(self):
        """gap 3: the installed OLD build (E2E_APK, e.g. 0.2.2) with REAL chats on a real Hermes, the NEWER build
        (E2E_UPGRADE_APK) installed over it: nothing vanishes (same stored messages), pairing stays, the default bot's
        Bot Chat delivery that the old build showed as the "Hermes" entry is now a timeline, a new turn is answered"""
        newer = os.environ.get('E2E_UPGRADE_APK', '')
        expect(newer, 'E2E_UPGRADE_APK is not set')
        shots = os.path.join(self.out, 'live-upgrade')
        os.makedirs(shots, exist_ok=True)
        new_chat()
        before_keys = set(transcripts())
        prompts = ['Reply with exactly the word pong and nothing else.', 'und auf deutsch bitte, kurz?']
        conv = None
        for p in prompts:
            send(p)
            end = time.time() + 120
            ok = False
            while time.time() < end and not ok:
                for c, ms in transcripts().items():
                    if c in before_keys:
                        continue
                    for i, m in enumerate(ms):
                        if m.get('role') == 'user' and p in m.get('text', '') and i + 1 < len(ms) and finished(ms[i + 1]):
                            conv, ok = c, True
                time.sleep(2)
            expect(ok, f'no finished answer to "{p[:30]}" in the old build')
        mark = f'Qalast Upgrade {int(time.time()) % 100000}'
        job = self._live_hermes('/api/jobs', 'POST', {'name': 'qalast upgrade', 'schedule': 'every 6h', 'deliver': 'bot-chat',
                                                    'prompt': f'Reply with only this line: {mark}'})['job']['id']
        try:
            self._live_hermes(f'/api/jobs/{job}/run', 'POST', {})
            time.sleep(100)
            force_stop()
            launch()
            expect(d.tap(S['chats'], 8), 'Chats button not found (old build)')
            time.sleep(2)
            d.screenshot_jpg(os.path.join(shots, '1-old-drawer.jpg'))
            d.sh('input keyevent 4')
            snap = {c: [(m.get('id'), m.get('role'), m.get('text')) for m in ms] for c, ms in transcripts().items()}
            expect(conv in snap, 'the old build did not store the chat')
            out = d.adb('install', '-r', newer, timeout=240)
            expect('Success' in out, f'adb install -r failed: {out.strip()[:200]}')
            force_stop()
            launch()
            time.sleep(4)
            after = {c: [(m.get('id'), m.get('role'), m.get('text')) for m in ms] for c, ms in transcripts().items()}
            gone = sorted(set(snap) - set(after))
            res = dict(chats_before=len(snap), chats_after=len(after), gone=[os.path.basename(g) for g in gone])
            # a Bot Chat copy the new build folds into the timeline may leave the list: only the real chat must stay
            expect(conv in after, 'the real chat vanished after the upgrade')
            expect(after[conv][:len(snap[conv])] == snap[conv], 'messages of the real chat changed or vanished after the upgrade')
            expect(d.find(S['input']), 'no composer after the upgrade (onboarding again?)')
            expect(d.find(S['connect']) is None and d.find(S['consent']) is None, 'onboarding shown after the upgrade')
            d.screenshot_jpg(os.path.join(shots, '2-new-after-install.jpg'))
            self._open_default_bot()
            got = d.wait(f'text:{mark}|desc:{mark}', 60)
            d.screenshot_jpg(os.path.join(shots, '3-new-default-timeline.jpg'))
            expect(got, 'the old Bot Chat delivery is not on the default bot\'s timeline after the upgrade')
            expect(d.find('text:Cronjob') is None, 'the injected cron header is shown as a message')
            before2 = set(transcripts())
            send('Reply with exactly the word ping and nothing else.')
            end = time.time() + 120
            ok = False
            while time.time() < end and not ok:
                for c, ms in transcripts().items():
                    for i, m in enumerate(ms):
                        if m.get('role') == 'user' and 'word ping' in m.get('text', '') and i + 1 < len(ms) and finished(ms[i + 1]) and ms[i + 1].get('status') == 'done':
                            ok = True
                time.sleep(2)
            d.screenshot_jpg(os.path.join(shots, '4-new-followup.jpg'))
            expect(ok, 'a new turn on the default bot screen was not answered after the upgrade')
            return res
        finally:
            try:
                self._live_hermes(f'/api/jobs/{job}', 'DELETE')
            except Exception:
                pass

    def c_live_cards(self):
        """gap 3: a live card from a REAL Hermes answer (the hermes-ui skill): a tray row, a tick stays on the device across a
        force-stop ("1 change waiting"), the next message carries it (receipt line under the user message, tray shows the
        new version)"""
        shots = os.path.join(self.out, 'live-cards')
        os.makedirs(shots, exist_ok=True)
        new_chat()
        first = 'Make me a live shopping list for a barbecue on Saturday with 6 items.'
        before = set(transcripts())
        send(first)
        self._live_answer(first, before, 150)
        row = d.wait('desc:^Live card ', 30)
        d.screenshot_jpg(os.path.join(shots, '1-answer.jpg'))
        expect(row, 'no live card row in the tray after a real answer to a live-list request')
        title = re.sub(r', \d+ of \d+.*$', '', row.desc)
        item = d.wait_stable(r'desc:, open$', 10)
        expect(item, 'no open item on the live card')
        d.tap_xy(item[0].cx, item[0].cy)
        waiting = f'desc:^{re.escape(title)}, 1 of \\d+ . 1 change waiting'
        expect(d.wait(waiting, 8), 'the tray does not show the waiting tick')
        d.screenshot_jpg(os.path.join(shots, '2-ticked.jpg'))
        time.sleep(2.0)
        force_stop()
        launch()
        expect(d.wait(waiting, 15), 'the waiting tick did not survive a force-stop')
        d.screenshot_jpg(os.path.join(shots, '3-after-restart.jpg'))
        second = 'We are 8 people, adjust the list please.'
        send(second)
        expect(d.wait('text:(?i)^To .*ticked$', 120), 'no receipt line under the user message after the tick went along')
        d.wait(S['stop'], 5)
        expect(d.wait(S['stop'], 120, gone=True), 'the follow-up did not finish')
        expect(d.wait('desc:^Live card ', 10), 'the live card row is gone after the follow-up')
        d.screenshot_jpg(os.path.join(shots, '4-after-followup.jpg'))
        return dict(card=title)

    def c_live_about_approval(self):
        """gap 3: "About <bot>" on a real Hermes (parts load, no error), and an approval card Accepted once on the bot's
        own Bot Chat: the command runs (writer has the terminal tool + manual approvals on this instance)"""
        shots = os.path.join(self.out, 'live-about')
        os.makedirs(shots, exist_ok=True)
        force_stop()
        launch()
        head = self._open_bot(LIVE_BOT, LIVE_BOT_LABEL)
        self._open_about(head, LIVE_BOT_LABEL)
        d.screenshot_jpg(os.path.join(shots, '1-about.jpg'))
        expect(d.find('id:^bot-info$'), 'About sheet not shown')
        ns = d.dump()
        expect(d.find('text:(?i)could not load|konnte nicht|error', ns) is None, 'About shows an error')
        d.sh('input keyevent 4')
        time.sleep(1)
        ap = 'please run exactly this command with your terminal tool: mkdir /tmp/qalast-acc && rm -rf /tmp/qalast-acc'
        send(ap)
        card = d.wait('desc:^Allow this command once|text:^Allow once$', 90)
        d.screenshot_jpg(os.path.join(shots, '2-approval-card.jpg'))
        expect(card, 'no approval card for the dangerous command')
        d.tap_xy(card.cx, card.cy)
        time.sleep(1)
        expect(d.wait(S['stop'], 120, gone=True), 'the turn did not finish after Accept')
        time.sleep(2)
        d.screenshot_jpg(os.path.join(shots, '3-after-accept.jpg'))
        txt = ' '.join((m.get('text') or '') for ms in transcripts().values() for m in ms if m.get('role') == 'assistant')
        expect(not re.search(r'(?i)denied|abgelehnt|rejected', txt[-600:]), 'the answer after Accept speaks of a denial')
        return dict(accepted=True)

    def c_live_groups(self):
        """gap 3: bot groups switched on by the owner (admin token), "Group" → default + the bot → a named bot answers"""
        shots = os.path.join(self.out, 'live-groups')
        os.makedirs(shots, exist_ok=True)
        before = self._live_bridge('/bridge/groups/rights')
        self._live_bridge('/bridge/groups/rights', 'PUT', {'enabled': True})
        gid = None
        try:
            force_stop()
            launch()
            self._bots_tab()
            btn = None
            for _ in range(3):
                btn = d.wait('id:^groups-new$', 8)
                if btn:
                    break
                d.sh('input keyevent 4')
                time.sleep(1.0)
                self._bots_tab()
            expect(btn, 'no "Group" button although the owner switched groups on')
            d.screenshot_jpg(os.path.join(shots, '1-bots-tab.jpg'))
            d.tap_xy(btn.cx, btn.cy)
            expect(d.wait('id:^group-create-bot-default$', 10), 'no bot list in "New group"')
            d.tap('id:^group-create-bot-default$', 4)
            d.tap(f'id:^group-create-bot-{LIVE_BOT}$', 4)
            sub = d.wait('id:^group-create-submit$', 6)
            if not sub:
                w, h = d.screen_size()
                d.swipe(w // 2, int(h * 0.75), w // 2, int(h * 0.3))
                sub = d.wait('id:^group-create-submit$', 6)
            expect(sub, 'no "Create group" button')
            d.screenshot_jpg(os.path.join(shots, '2-create.jpg'))
            d.tap_xy(sub.cx, sub.cy)
            expect(d.wait('id:^group-empty$', 20), 'the new group did not open')
            self._group_send(f'@{LIVE_BOT} say hello in one short sentence')
            end, ok = time.time() + 150, False
            while time.time() < end and not ok:
                ok = bool(d.find(r'text:(?i)quill') or d.find('text:(?i)hello|hallo'))
                time.sleep(3)
            d.screenshot_jpg(os.path.join(shots, '3-answer.jpg'))
            expect(ok, 'the named bot did not answer in the group')
            gl = self._live_bridge('/bridge/groups')
            gid = next((g.get('id') for g in gl.get('groups', []) if 'Live' not in g.get('name', '')), None) if isinstance(gl, dict) else None
            return dict(groups=len(gl.get('groups', [])) if isinstance(gl, dict) else None)
        finally:
            try:
                for g in (self._live_bridge('/bridge/groups').get('groups') or []):
                    self._live_bridge(f'/bridge/groups/{g["id"]}', 'DELETE')
            except Exception as e:
                print('group cleanup:', e)
            try:
                self._live_bridge('/bridge/groups/rights', 'PUT', {'enabled': before.get('enabled')})
            except Exception as e:
                print('rights reset:', e)
            force_stop()
            launch()

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
            self.check('reminder_delete', 'Reminder deleted by a chat message (QA round 4): device copy cancelled, card says so, also after force-stop', self.c_reminder_delete)
            self.check('reminder_gone', 'Reminder deleted elsewhere while the app was closed: on start the job list cancels the device copy, card says so', self.c_reminder_gone)
            self.check('reminder_delivered', 'A fired bot-chat reminder on the default bridge: drawer row "Hermes", the reminder text under a marker (no bubble)', self.c_reminder_delivered)
            self.check('background', 'Background: "… is answering" → "Answer ready"', self.c_background)
            self.check('bots_quick_visible', 'Bots tab + ⚡ when the bridge offers profiles + quick answers', self.c_bots_quick_visible)
            self.check('bots', 'Bots: Bots tab → Bot Chat (once), turn on that session, bot approval card, "Waiting for you", always-allow, not under Chats', self.c_bots)
            self.check('bots_create', 'New bot: Bots tab → "New bot" → role → prefilled fields → created once → its Bot Chat says "<Name> is ready" with the role\'s starters', self.c_bots_create)
            self.check('bots_about', '"About <Name>": how it works, remembers, can, always allowed → Revoke, notification level kept, Archive → Archived → Bring back', self.c_bots_about)
            self.check('bots_working', '"<Name> is working": steps + Stop for the own turn; another device\'s turn with its step in the Bots tab, Stop through the bridge', self.c_bots_working)
            self.check('bots_aplus', 'Bots A+ (Hermes v0.22.3+ authority): one screen per bot, reminder + follow-up with the delivery context in the bot\'s own session, new delivery while open, not under Chats, same after force-stop, visible retry when the lookup fails', self.c_bots_aplus)
            self.check('groups', 'Bot groups: "Group" in the Bots tab → pick 2 bots + cost line → @-autocomplete → named bot answers → plan hands over (grey line) → approval only as a line, its card in the bot\'s own chat', self.c_groups)
            self.check('groups_off', 'Bot groups off (default bridge): no "Group" button, no groups section, the Bots tab as before', self.c_groups_off)
            self.check('quote_reply', 'Quote/reply: swipe + long-press "Reply" → two quotes in order, one turn with both [hui:quote] blocks, quote boxes in the bubble, tap jumps to the cited answer (also after force-stop)', self.c_quote_reply)
            self.check('draft_restart', 'Draft (text + quote) survives force-stop and a chat switch; sending clears it', self.c_draft_restart)
            self.check('jump_unread', 'Scrolled up while an answer streams → "1 new answer" on the jump button; reading position survives force-stop', self.c_jump_unread)
            self.check('cold_start', 'Cold start ×3', self.c_cold_start)
            if os.environ.get('E2E_UPGRADE_APK'):
                self.check('upgrade', 'Upgrade: install the newer build over this one, chats, pairing and drawer survive', self.c_upgrade)
            self.check('logcat', 'Logcat: no crash/ANR, no ReactNativeJS errors, Reanimated warnings', self.c_logcat, needs=('install',))
            if live_link:
                r.run('live', 'Live bridge: 2 harmless turns, the chat deleted in Hermes afterwards', lambda: self.c_live(live_link), on_fail=self.on_fail, needs=('install',))
                if 'bots' in LIVE_EXTRA:
                    r.run('live_bots', f'Live bot "{LIVE_BOT}": Bots tab, Bot Chat, personality, no ⚡', self.c_live_bots, on_fail=self.on_fail, needs=('live',))
                if 'chat' in LIVE_EXTRA:
                    r.run('live_chat', 'Live chat as a normal user: en/de/es multi-turn with typos and follow-ups, Stop, approval', self.c_live_chat, on_fail=self.on_fail, needs=('live',))

                if 'aplus' in LIVE_EXTRA:
                    r.run('live_aplus', 'Live Bots A+: a real reminder on the open bot screen, typo follow-up in the same timeline, a notification in the background lands on the delivery', self.c_live_aplus, on_fail=self.on_fail, needs=('live',))
                if 'bg' in LIVE_EXTRA:
                    r.run('live_bg', 'Live background: what a default setup without FCM notifies about (measured)', self.c_live_bg, on_fail=self.on_fail, needs=('live',))
                if 'qalast' in LIVE_EXTRA:
                    r.run('live_firstuse', 'Live non-default bot: fresh first use (hui-bot-<bot>, no recovery), isolated from the default bot', self.c_live_firstuse, on_fail=self.on_fail, needs=('live',))
                    r.run('live_cards', 'Live card from a real answer, tick across a force-stop', self.c_live_cards, on_fail=self.on_fail, needs=('live',))
                    r.run('live_about_approval', 'Live About <bot> + approval Accept', self.c_live_about_approval, on_fail=self.on_fail, needs=('live',))
                    r.run('live_groups', 'Live bot groups switched on', self.c_live_groups, on_fail=self.on_fail, needs=('live',))
                if 'upgrade' in LIVE_EXTRA:
                    r.run('live_upgrade', 'Live upgrade: real chats + delivery, newer build over the old one', self.c_live_upgrade, on_fail=self.on_fail, needs=('live',))
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
