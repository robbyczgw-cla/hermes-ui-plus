# sandbox — `<HtmlBlock>` for ```hui-html blocks

```tsx
import { HtmlBlock } from '../sandbox';
<HtmlBlock html={seg.html} complete={seg.complete} onAction={handleAction} />
```

| Prop | |
|---|---|
| `html` | Block body as streamed so far |
| `complete` | Closing fence arrived → final render, scripts run **once** |
| `onAction?` | `{type:'send'\|'copy'\|'open_url'}` (subset of `HuiAction`). Default: copy → clipboard, open_url → `Linking`, send → ignored |
| `theme?` | `Theme` or `'light'\|'dark'`; default `useTheme()` from `../ui` |
| `maxHeight?` (640) / `placeholderHeight?` (160) | Height cap (inner scroll above it) / shimmer height |

## How it works
1. One WebView (web: `<iframe srcdoc sandbox="allow-scripts">`) per block loads a static **shell**
   (`shell.ts`): CSP, theme vars, base stylesheet, inlined idiomorph, runtime. It never reloads
   while streaming (theme switches are pushed in too).
2. Every update → `processHtml()` (`partialHtml.ts`): drop incomplete tag/entity/comment, strip
   `<script>` (collected only when complete), hoist complete `<style>`, drop `<head>`/`<base>`/`<meta>`.
3. Throttled (100 ms) push via `injectJavaScript` / `postMessage` → idiomorph morphs `#hui-root`
   (existing nodes are kept, new ones fade in). Pointer events are off while streaming.
4. `complete` → final morph, then scripts run in order (external `src` awaited, 15 s timeout).
   `DOMContentLoaded`/`load` listeners and `window.onload` registered by model scripts are
   invoked afterwards, because the shell document loaded long before.
5. ResizeObserver → `{t:'height'}` → Reanimated height animation. Shimmer until the first paint.
6. Errors (`error`/`unhandledrejection`, failed `<script src>`) after `complete` → "Fehler im Widget"
   + "Neu laden" (remounts the frame and replays the HTML). Renderer crash → same notice.

Widget API: `window.hermes.send(text)`, `.copy(text)`, `.openUrl(url)` (return `false` if blocked). A `send` from a widget
is never sent blind: the chat shows the confirmation sheet with the full text first (chat/sendGate.ts).
`Websandbox.connection.remote.sendPrompt({text})` / `openLink({url})` are aliases for widgets
written in OpenIntelligentUI style.
`<a href>` clicks go through `openUrl`. `#anchor` links scroll inside the widget.

Layout at 390 pt (design review P1-1): tables are `display:block` with their own horizontal
scroll, and every element gets `min-width:0` at zero specificity (`:where(#hui-root) *`), so a
wide table or number shrinks/scrolls inside its card instead of widening a grid/flex track and
making the whole widget scroll sideways. Measured with headless Chromium at 358 and 320 px for
`LOAN_HTML` at XL font size: root scroll width 366 → 358/320 (= client width).

Base stylesheet: plain HTML (headings, buttons, `button.primary`, inputs, range sliders with
fill, tables, code, details) already looks like the app. Helper classes: `.card .row .stack .grid
.stat .stat-label .stat-value .badge .muted .success .warning .danger`. Variables: `--h-bg
--h-surface --h-surface-alt --h-text --h-muted --h-subtle --h-accent --h-on-accent --h-accent-soft
--h-border --h-border-strong --h-success --h-warning --h-danger --h-radius(-sm/-lg) --h-font
--h-font-mono --h-chart-1..8` (+ OpenIntelligentUI aliases like `--color-text-primary`).

## Threat model
The HTML is **untrusted**. It comes from the model, which may have read hostile web pages
(prompt injection). Goals: the widget can't read app data, can't exfiltrate, can't navigate or
open other apps, and can't act for the user without a real tap.

- **Isolation:** separate WebView per block with an opaque origin (`about:blank` / sandboxed
  srcdoc). No bridge object besides the message channel. `allowFileAccess*`, DOM storage,
  cookies (third-party/shared), geolocation, media capture, payment and multiple windows are off.
  `localStorage`/`sessionStorage` are throwaway in-memory shims. WebRTC is removed, because CSP
  doesn't cover it.
- **Cache vs. incognito (2026-10-11):** `incognito` is **off**, `cacheEnabled` on, `cacheMode`
  `LOAD_DEFAULT`. On Android `incognito` meant `LOAD_NO_CACHE` plus `clearCache(true)` and
  `CookieManager.removeAllCookies()` on every mount, and both clears are app-wide: Leaflet, CDN
  libraries and map tiles were downloaded again for every widget and map (perf review P1-4).
  Isolation does not depend on incognito: the document's origin is opaque, so it has no storage or
  cookies of its own, and DOM storage and third-party/shared cookies stay off. What we give up:
  the WebView HTTP cache is shared by all widgets and persists, so a widget could tell from timing
  whether a CDN/tile URL was loaded before (it learns nothing about app data), and cookies that a
  CDN or tile server sets may persist in the WebView cookie jar (they only go back to that host).
  iOS: the default (persistent) website data store instead of a non-persistent one per WebView.
- **Network (CSP meta, `default-src 'none'`):** scripts, styles and fonts only inline or from
  `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`. `connect-src` allows only
  these CDNs. Images: `data:`, `blob:`, the CDNs, the map tile hosts (`tile.openstreetmap.de`,
  `*.tile.opentopomap.org`) and `upload.wikimedia.org`. Frames, objects, `<base>` and form
  submission are blocked. DNS prefetch is off. `'unsafe-inline'`/`'unsafe-eval'` are needed for
  model scripts. The network allow-list is the actual boundary.
- **Navigation:** `originWhitelist={['*']}` is **deliberate**. react-native-webview passes URLs
  that fail the whitelist straight to `Linking.openURL` without calling
  `onShouldStartLoadWithRequest`. That would let a widget launch other apps. With `*`, every
  navigation reaches our handler, which allows only `about:blank`/`about:srcdoc`.
  `window.open`, `alert`/`confirm`/`prompt`, `print` and `document.write` are neutralized.
- **Bridge:** every message is parsed by `parseSandboxMessage()`. It checks the type, enforces a
  64 KB raw cap, limits text (send ≤ 4000, copy ≤ 32 000), clamps height, and accepts URLs only as
  absolute `https:`/`http:`/`mailto:` without credentials. Actions are **gesture-gated twice**:
  (1) inside, `navigator.userActivation.isActive`; (2) host-side, `actionGate.ts` requires a
  real **tap** observed outside the sandbox: native = touch down and up within 10 px and 1 s
  without moving further in between (a scroll, drag, long press or cancelled touch is never a
  tap); web = only a tap or keyboard activation (trusted Enter, or Space on a button) that the
  shell reports over a private `MessagePort` (see "Web tap channel" below). Focus moving into
  the iframe and hover never count (GPT security M1 / Astra F15, 2026-10-12: model code can move
  focus, and a drag or long press moves it too). Each tap allows **one** action within 1.5 s. Plus ≥ 700 ms between actions and ≤ 12 per minute. An action that arrives
  while the finger is still down waits for the touch end. The first check can be bypassed by
  posting raw messages; the second can't (security review M2). In the chat, `copy` goes through
  the action runner, which shows the "Kopiert" toast.
- **Web tap channel (2026-10-11):** the host (`HtmlFrame.web.tsx`) creates a `MessageChannel`
  per mounted document and transfers `port2` in its very first message to the iframe, the exact
  string `{"t":"hui-init"}`. It is sent before the first `render`, both to the same window, so it
  arrives before any model code exists (model code only enters with a render: scripts and
  inline handlers like `<img onerror>`). The shell runs before any model code, registers a
  capture `message` listener on `window` first, takes the port from the first trusted init whose
  `source` is the parent, and calls `stopImmediatePropagation` so no other listener sees it.
  It then listens (capture, on `window`) to trusted `pointerdown/move/up/cancel` (fallback without
  Pointer Events: `touchstart/move/end/cancel` + `mousedown/move/up`, mouse ignored for 1 s after
  a touch) and posts `"tap"` on the port when `huiClassifyTap` says tap: `isTrusted`, primary
  pointer, primary button, max. movement ≤ 10 px in **both** screen and client coordinates (while
  the chat scrolls, the iframe moves with the finger, so client deltas alone stay ~0), press ≤ 1 s,
  no `pointercancel` (the browser took the gesture over for scrolling) and no second finger. The host
  accepts only that exact string on `port1`; `{t:'tap'}` on the normal window channel is dropped
  by `parseSandboxMessage`. A port tap counts like any tap in `actionGate.ts` (one action within
  1.5 s, same spacing and per-minute cap, consumed on use; no 60 s focus window). Because port and
  window messages are not ordered against each other, a web action without a tap waits up to
  500 ms for a port tap, and a port tap within 400 ms after an accepted action is treated as the
  same press (doesn't re-arm). The sandbox has no `allow-same-origin`, so model code can't reach
  the host's `port1` or the iframe element; the port is the only trusted path. Native WebViews
  never get the init (port stays null); there the host watches touches outside the WebView.
  Bypasses considered:
  - *Synthetic events* (`dispatchEvent(new PointerEvent(...))`, `el.click()`): `isTrusted` is
    false and is an unforgeable own property of each event; the shell ignores those events
    entirely (they can't even cancel a real press).
  - *Patching after the shell ran* (`EventTarget.prototype.addEventListener`, getters like
    `MouseEvent.prototype.clientX/screenX`, `PointerEvent.prototype.isPrimary`,
    `Event.prototype.timeStamp`, `Math.*`, `Reflect.apply`, `Function.prototype.call/apply`): the
    shell's listeners are already registered, and it reads every event property through getters
    and calls through `Reflect.apply`, all captured at shell start; the classifier uses only
    arithmetic. Model code can't remove our listeners (no reference) and its own `window` capture
    listeners run after ours (registration order), so `stopImmediatePropagation` can't starve us.
  - *Stealing the port via `MessagePort.prototype.postMessage`*: the shell never looks
    `postMessage`/`start` up on the port; it calls the function captured at start through the
    captured `Reflect.apply`, so a replaced prototype method never sees `this === port`.
  - *Forged init*: a widget can dispatch a `MessageEvent` with `source: parent` and its own port,
    but it is untrusted and ignored; a real `postMessage` from inside has the iframe itself as
    `source`. Only the first trusted parent init is taken, later ones are swallowed.
  - *Init timing race*: the host sends the init lazily before its first post (and on the shell's
    first message), never before the shell document exists (it would land in the initial
    `about:blank` and be lost, leaving only the focus path, which is fail-closed). Model code
    can't run before the first render, which is always posted after the init.
  - *Scroll looking like a tap*: page scroll → `pointercancel`; scroll inside a
    `touch-action:none` element → movement > 10 px; long press → > 1 s.
  - Not prevented (by design, same as native): a widget may use a real tap on any of its elements
    (e.g. an innocuous "expand" button) to send one action of its choice. Keyboard activation
    (Enter/Space) only counts via the focus path.
  Verified in headless Chromium 1243 (playwright-core, static page, hostile widget that patched
  all the prototypes above first): synthetic pointer/click events, a forged init and raw
  `{t:'tap'}`/action messages → refused, no port leak; hover → nothing; real `page.mouse` click →
  port tap, action accepted; touch tap → accepted; touch scroll across the widget (page scrolled
  119 px) → refused; 1.3 s long press → refused; drag on a `touch-action:none` area (no
  `pointercancel`) → refused. Not yet verified on a real iOS Safari device.
- **Residual risks:** a widget can draw fake UI (phishing look-alikes) inside its box, but it
  can't submit anywhere. CPU/memory abuse (infinite loops) is limited to its own process. A widget
  can make requests to the allow-listed CDNs and tile hosts, so a hostile widget could encode data
  in the request URLs; only the CDN/tile operators would see it. The only data a widget can reach
  is its own content and what the user types into it.

## Map tiles
The sandbox sends no Referer. `tile.openstreetmap.org` and CARTO then serve "blocked" / "API key
required" tiles (verified). Use `https://tile.openstreetmap.de/{z}/{x}/{y}.png` (attribution
"© OpenStreetMap-Mitwirkende") or OpenTopoMap. Leaflet: `https://unpkg.com/leaflet@1.9.4/dist/…`.

## Files
`HtmlBlock.tsx` component · `HtmlFrame.tsx` / `HtmlFrame.web.tsx` WebView / iframe ·
`shell.ts` shell doc, CSP, base CSS, runtime · `partialHtml.ts` partial-HTML pipeline ·
`messages.ts` validation + host→shell injection + navigation policy · `actionGate.ts` gesture/rate gate ·
`webviewConfig.ts` locked-down WebView props (values must match the **native** codegen prop types:
on Android a string where the spec has an array, e.g. `dataDetectorTypes="none"`, crashes the app
with a `ClassCastException` when the WebView mounts; `webviewConfig.test.ts` checks this) ·
`idiomorph.ts` idiomorph 0.3.0 (BSD-2) · `theme.ts` · `sandboxSamples.ts` samples + `chunkString()` ·
`useSimulatedStream.ts` demo hook. Tests: `node --test src/sandbox/*.test.ts`.

Credits: architecture and partial-HTML/frame ideas are ported from
[OpenIntelligentUI](../../../refs/OpenIntelligentUI) (MIT, © Atai Barkai / CopilotKit), and
idiomorph is © Big Sky Software (BSD-2-Clause).
