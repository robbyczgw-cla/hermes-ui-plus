#!/usr/bin/env python3
"""Google Play screenshot drafts on the E2E emulator (docs/STORE.md "Screenshots").

  store_shots.py --apk APK --out DIR [--langs en,de,es] [--modes light,dark] [--size 1080x1920] [--only a,b]

Paired against scripts/e2e/store-mock.mjs (fictional content, a local stand-in for a bridge; reachable as
127.0.0.1:$E2E_STORE_MOCK_PORT through an ssh -R tunnel, as 10.0.2.2 from the emulator): the app shows a normal connection
named "Hermes", no DEMO strip. The welcome screen (last story frame) is taken before pairing. For each language and
appearance: fresh install, clock set to a daytime value (the empty-chat greeting follows it), clean status bar (SystemUI
demo mode, 09:41, full battery), the screen set to --size, then one chat per scene. Screenshots:
OUT/<lang>-<mode>/NN-<scene>.png. Soft steps: a missing element is logged in OUT/shots.log and the run continues.
Scenes (the 0.1.3 story): welcome, checklist-ticked, share-image, choice-cards, compare-table, web-card (web search
result card), code-diff, approval, share-in.
"""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import device as d  # noqa: E402

PKG = os.environ.get('E2E_PKG', 'xyz.hermesui.app')
SCHEME = os.environ.get('E2E_SCHEME', 'hermesuiplus')
MOCK_PORT = os.environ.get('E2E_STORE_MOCK_PORT', '18792')
LOG = []

# Labels per language (app/src/i18n/ns/*.ts). Prompts are plain ASCII words because `input text` cannot type umlauts or
# accents (a transliterated "fuers" would show in the user bubble): phrased so that no accent is missing. The router
# (app demo ROUTES, plus the store mock's own `permiso` rule) maps each one to its scene.
L = {
    'en': dict(locale='en-US', demo=r'^Try it first \(demo\)$', start=r'^Start an empty chat$', compare=r'^Compare$', done=r'^Done$',
               review=r'^Review$', share_image=r'^Share as image$', summarize=r'^Summarize$', city=r'^Rome$',
               diffs=r'text:Only differences|desc:Only differences',
               p_check='Make me a shopping list for the weekend.', tick=[r'^Tomatoes$', r'^Basil$'],
               p_choice='Help me pick a destination for a city break.',
               p_prod='Compare noise cancelling headphones.',
               p_code='Fix the bug and show me the code diff.',
               p_appr='Clean up the cache, with approval.',
               p_web='Research jet lag tips for a flight east, with sources.',
               panel=r'desc:^Tools and activity,', web_row=r'desc:^Web search,', web_how=r'text:^How it searched$'),
    'de': dict(locale='de-DE', demo=r'^Erst mal ausprobieren \(Demo\)$', start=r'^Leeren Chat starten$', compare=r'^Vergleichen$', done=r'^Fertig$',
               review=r'^Pr.fen$', share_image=r'^Als Bild teilen$', summarize=r'^Zusammenfassen$', city=r'^Rom$',
               diffs=r'text:Nur Unterschiede|desc:Nur Unterschiede',
               p_check='Mach mir eine Einkaufsliste.', tick=[r'^Tomaten$', r'^Basilikum$'],
               p_choice='Hilf mir, ein Reiseziel auszusuchen.',
               p_prod='Welche Headphones sind gut? Vergleiche sie.',
               p_code='Behebe den Bug und zeig mir den Diff.',
               p_appr='Leere den Cache, aber nur mit meiner Freigabe.',
               p_web='Recherchiere Jetlag Tipps nach einem Ostflug, mit Quellen.',
               panel=r'desc:^Werkzeuge und Ablauf,', web_row=r'desc:^Websuche,', web_how=r'text:^So wurde gesucht$'),
    'es': dict(locale='es-ES', demo=r'^Probar primero \(demo\)$', start=r'^Empezar un chat vac.o$', compare=r'^Comparar$', done=r'^Listo$',
               review=r'^Revisar$', share_image=r'^Compartir como imagen$', summarize=r'^Resumir$', city=r'^Roma$',
               diffs=r'text:Solo diferencias|desc:Solo diferencias',
               p_check='Hazme una lista de la compra.', tick=[r'^Tomates$', r'^Albahaca$'],
               p_choice='Quiero elegir destino para una escapada.',
               p_prod='Compara los mejores auriculares.',
               p_code='Arregla el bug y dame el diff.',
               p_appr='Borra los archivos temporales, pero solo con mi permiso.',
               p_web='Busca consejos para el jet lag en un vuelo al este, con fuentes.',
               panel=r'desc:^Herramientas y actividad,', web_row=r'desc:^B.squeda web,', web_how=r'text:^C.mo busc.$'),
}
COMPOSER = 'id:^composer-input$|desc:^(Type a message|Nachricht eingeben|Escribe un mensaje)'
SEND = 'id:^composer-send$'
NEWCHAT = 'id:^header-new-chat$'
SAFE_TOP, SAFE_BOTTOM = 360, 1560   # chat content area at 1080x1920: a tap above hits the header (model sheet)


def log(ok, what):
    line = f'{"OK  " if ok else "FAIL"} {what}'
    LOG.append(line)
    print(line, flush=True)


class Shots:
    def __init__(self, out):
        self.out, self.n = out, 0
        os.makedirs(out, exist_ok=True)

    def __call__(self, name):
        d.hide_keyboard()
        time.sleep(0.6)
        self.n += 1
        d.screenshot_png(os.path.join(self.out, f'{self.n:02d}-{name}.png'))
        log(True, f'shot {self.n:02d}-{name}')


def tap(spec, timeout=10):
    n = d.tap(spec, timeout)
    log(n is not None, f'tap {spec}')
    return n


def swipe_by(dy):
    """scroll the chat: dy > 0 moves the content up (towards newer messages)"""
    w, _ = d.screen_size()
    y0 = 1300 if dy > 0 else 500
    d.swipe(w // 2, y0, w // 2, y0 - dy, 700)
    time.sleep(1.5)


def tap_in_view(spec, tries=8):
    """tap an element inside the chat content (never under the header: a tap there opens the model sheet); scrolls
    towards it first"""
    for i in range(tries):
        time.sleep(0.6)
        ns = d.find_all(spec)
        ok = [n for n in ns if SAFE_TOP < n.cy < SAFE_BOTTOM]
        if ok:
            d.tap_xy(ok[0].cx, ok[0].cy)
            log(True, f'tap {spec}')
            return ok[0]
        if any(n.cy >= SAFE_BOTTOM for n in ns):
            swipe_by(500)
        elif any(n.cy <= SAFE_TOP for n in ns):
            swipe_by(-400)
        else:   # not in the dump at all (virtualised list): look further down first, then back up
            swipe_by(-500 if i < 5 else 500)
    log(False, f'tap {spec} (not in view)')
    return None


def scroll_to(spec, top, bottom, tries=8):
    """scroll until a node matching spec sits between top and bottom (y); content further down is looked for first"""
    for _ in range(tries):
        ns = d.find_all(spec)
        if any(top < n.cy < bottom for n in ns):
            return True
        swipe_by(-400 if ns and min(n.cy for n in ns) < top else 500)
    log(False, f'scroll to {spec} (not found)')
    return False


def close_sheets():
    """BACK while a bottom sheet / menu covers the chat (the composer is then not visible); never leaves the app"""
    for _ in range(3):
        if d.find(COMPOSER):
            return
        d.sh('input keyevent 4')
        time.sleep(1)
        if d.top_activity() != PKG:
            d.sh(f'monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
            time.sleep(3)


def send(text, wait_s):
    """type into the composer and tap Send while the keyboard is still up (it hides the button otherwise)"""
    close_sheets()
    if not d.tap(COMPOSER, 10):
        log(False, 'composer not found')
        return
    time.sleep(0.8)
    d.type_text(text)
    time.sleep(0.8)
    btn = d.wait(SEND, 6)
    if btn:
        d.tap_xy(btn.cx, btn.cy)
        log(True, f'sent: {text}')
    else:
        log(False, f'send button missing ({text})')
    d.hide_keyboard()
    time.sleep(wait_s)


def new_chat():
    close_sheets()
    n = d.wait(NEWCHAT, 6)
    if n:
        d.tap_xy(n.cx, n.cy)
        time.sleep(1.2)
    log(n is not None, 'new chat')


def to_end():
    for _ in range(3):
        swipe_by(900)


def status_bar_demo():
    d.sh('settings put global sysui_demo_allowed 1')
    b = 'am broadcast -a com.android.systemui.demo -e command'
    for c in ['enter', 'clock -e hhmm 0941', 'battery -e level 100 -e plugged false', 'network -e wifi show -e level 4 -e fully true',
              'network -e mobile hide', 'notifications -e visible false']:
        d.sh(f'{b} {c}')


def mock(path, body=None):
    req = urllib.request.Request(f'http://127.0.0.1:{MOCK_PORT}{path}', data=json.dumps(body or {}).encode(), method='POST')
    return json.load(urllib.request.urlopen(req, timeout=10))


def install(apk, lang, mode):
    d.sh(f'am force-stop {PKG}')
    d.adb('uninstall', PKG, timeout=60)
    r = d.adb('install', '-r', '-g', apk, timeout=240)
    log('Success' in (r.stdout if hasattr(r, 'stdout') else str(r)), f'install ({lang}, {mode})')
    d.sh(f'cmd locale set-app-locales {PKG} --locales {L[lang]["locale"]}')
    d.sh(f'cmd uimode night {"yes" if mode == "dark" else "no"}')
    # daytime clock: the empty-chat greeting ("Good morning" / "Up late?") follows the device time
    d.sh('su 0 settings put global auto_time 0; su 0 date 101710412026.00')
    status_bar_demo()
    mock('/__store/config', {'lang': lang})
    d.sh(f'monkey -p {PKG} -c android.intent.category.LAUNCHER 1')
    time.sleep(7)


def pair(lang):
    """open a pair link of the store mock and walk onboarding to an empty chat (consent card, "start a chat")"""
    code = mock('/__store/pair-code')['code']
    link = f'{SCHEME}://pair?' + urllib.parse.urlencode({'u': f'http://10.0.2.2:{MOCK_PORT}/v1', 'c': code, 'n': 'Hermes'})
    d.adb('shell', 'read l; am start -a android.intent.action.VIEW -d "$l" ' + PKG, inp=link + '\n', timeout=30)
    time.sleep(6)
    for _ in range(25):
        w, h = d.screen_size()
        ns = d.dump()
        # the chat sits under the onboarding cards (its composer and starter cards stay in the dump), so the flow is
        # done when no primary-button text is left in the bottom strip (the composer there is an EditText)
        bottom = [n for n in ns if n.cls == 'TextView' and n.text and n.cy > h * 0.92]
        if not bottom and d.find(COMPOSER, ns):
            break
        if bottom:
            n = max(bottom, key=lambda x: x.cy)
            d.tap_xy(n.cx, n.cy)
        time.sleep(2.5)
    log(d.find(COMPOSER) is not None, 'paired, chat open')


def scene_chats(lang, shot, only):
    t = L[lang]
    want = lambda s: not only or s in only

    if want('checklist-ticked') or want('share-image'):
        send(t['p_check'], 7)
        for item in t['tick']:
            tap_in_view(f'text:{item}|desc:{item}')
            time.sleep(1)
        time.sleep(1.5)
        to_end()          # the ticked items sit in the "done" group at the bottom of the card
        swipe_by(-300)
        shot('checklist-ticked')
        # the answer's own "Share as image": sheet with the live preview (ticked items included)
        to_end()
        if tap_in_view(f'desc:{t["share_image"]}'):
            time.sleep(6)
            shot('share-image')
            close_sheets()

    if want('choice-cards'):
        new_chat()
        send(t['p_choice'], 8)
        d.wait(f'text:{t["city"]}|desc:{t["city"]}', 6)
        shot('choice-cards')

    if want('compare-table'):
        new_chat()
        send(t['p_prod'], 12)     # the product photos arrive through the image search after the card is drawn
        if tap_in_view(f'desc:{t["compare"]}|text:{t["compare"]}'):
            time.sleep(1.5)
            for k in (1, 2):
                tap_in_view(rf'desc:^[^:\d ]{{4,8}} {k}: ')
                time.sleep(1)
            time.sleep(1.5)
            scroll_to(t['diffs'], 380, 760)
            shot('compare-table')

    if want('web-search'):
        # Web Search Plus answer: the "Web search" row of the tools panel opens the result card (how it searched, results
        # with favicons, cited markers); the mock stores the tool rows and serves the favicons through the image proxy
        new_chat()
        send(t['p_web'], 14)
        to_end()
        panel = None
        for _ in range(8):
            panel = d.find(t['panel'])
            if panel and panel.cy > SAFE_TOP:
                break
            swipe_by(-450)
        if panel and tap_in_view(t['panel']):
            time.sleep(1)
            if tap(t['web_row'], 10):
                if d.wait(t['web_how'], 10):
                    time.sleep(2.5)    # favicons arrive through the proxy after the card is drawn
                    shot('web-card')
                    w, _ = d.screen_size()
                    d.swipe(w // 2, 1500, w // 2, 700, 500)
                    time.sleep(1.5)
                    shot('web-card-scrolled')
                else:
                    log(False, 'web result card did not open')
                    shot('debug-web-card')
                    log(True, 'visible: ' + ' | '.join(sorted({(n.text or n.desc or '')[:40] for n in d.dump() if (n.text or n.desc)}))[:900])
                d.sh('input keyevent 4')
                time.sleep(1)
        else:
            log(False, 'tools panel not found')

    if only and 'products-photos' in only:   # optional extra: the answer's first card
        new_chat()
        send(t['p_prod'], 12)
        for _ in range(4):    # the top of the answer: first cards with their photos
            swipe_by(-600)
        shot('products-photos')

    if want('code-diff'):
        new_chat()
        send(t['p_code'], 13)
        to_end()
        n = d.wait(f'text:{t["review"]}|desc:{t["review"]}', 8)
        if n:
            d.tap_xy(n.cx, n.cy)
            log(True, 'tap Review')
            time.sleep(3)
            shot('code-diff')
            close_sheets()
        else:
            log(False, 'Review button not found')

    if want('approval'):
        new_chat()
        send(t['p_appr'], 6)
        shot('approval')


def scene_share_in(lang, shot):
    """Share to HUI+ (Android only): a text share into the paired app, "Summarize" chip selected"""
    t = L[lang]
    new_chat()
    d.adb('shell', f'am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '
                   f'"https://example.com/blog/city-breaks-by-train" {PKG}', timeout=30)
    time.sleep(4)
    tap(f'text:{t["summarize"]}|desc:{t["summarize"]}', 8)
    time.sleep(1)
    shot('share-in')
    d.tap('id:^share-cancel$', 5)


def run_set(apk, out, lang, mode, only):
    shot = Shots(out)
    install(apk, lang, mode)
    if not only or 'welcome' in only:
        shot('welcome')                  # the offline-demo card of the welcome screen (the one frame that shows demo)
    pair(lang)
    scene_chats(lang, shot, only)
    if not only or 'share-in' in only:
        scene_share_in(lang, shot)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--langs', default='en,de,es')
    ap.add_argument('--modes', default='light,dark')
    ap.add_argument('--size', default='1080x1920')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(',')))
    old_size = d.sh('wm size')
    d.sh(f'wm size {a.size}')
    try:
        for lang in a.langs.split(','):
            for mode in a.modes.split(','):
                run_set(a.apk, os.path.join(a.out, f'{lang}-{mode}'), lang, mode, only)
    finally:
        d.sh('wm size reset')
        d.sh('cmd uimode night no')
        d.sh('am broadcast -a com.android.systemui.demo -e command exit')
        with open(os.path.join(a.out, 'shots.log'), 'w') as f:
            f.write(f'screen before: {old_size.strip()}\n' + '\n'.join(LOG) + '\n')
    fails = [l for l in LOG if l.startswith('FAIL')]
    print(f'{len(LOG) - len(fails)} ok, {len(fails)} failed; output {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
