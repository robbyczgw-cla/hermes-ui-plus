// UI smoke test of the installed HUI+ (Hermes UI+) simulator build (scripts/ios-sim-smoke.sh). Drives the app by bundle id
// (XCUIApplication(bundleIdentifier:)), so the app itself needs no test target. Fresh install expected (onboarding).
// Env (via TEST_RUNNER_*): HUI_BUNDLE_ID, HUI_SHOT_DIR (screenshots + results.txt), HUI_LANG (en|de|es, default en).
// Soft checks: every step is recorded as OK/FAIL in results.txt and the run continues, so all screenshots exist.
import XCTest

final class SmokeUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment
  private lazy var app = XCUIApplication(bundleIdentifier: env["HUI_BUNDLE_ID"] ?? "xyz.hermesui.app")
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private var lines: [String] = []
  private var shotNo = 0

  private var dir: URL { URL(fileURLWithPath: env["HUI_SHOT_DIR"] ?? NSTemporaryDirectory()) }

  private func note(_ ok: Bool, _ what: String) {
    let l = "\(ok ? "OK  " : "FAIL") \(what)"
    lines.append(l); print("SMOKE \(l)")
    try? lines.joined(separator: "\n").appending("\n").write(to: dir.appendingPathComponent("results.txt"), atomically: true, encoding: .utf8)
  }

  private func shot(_ name: String) {
    shotNo += 1
    // smoke review shots: JPEG q45, at most 1080 px wide; the store drafts (HUI_LOSSLESS=1) are deliverables and stay PNG
    let lossless = env["HUI_LOSSLESS"] == "1"
    let file = String(format: "%02d-%@.%@", shotNo, name, lossless ? "png" : "jpg")
    let shot = XCUIScreen.main.screenshot()
    var data = shot.pngRepresentation
    if !lossless {
      var img = shot.image
      if img.size.width * img.scale > 1080 {
        let f = 1080 / (img.size.width * img.scale)
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        img = UIGraphicsImageRenderer(size: CGSize(width: 1080, height: img.size.height * img.scale * f), format: fmt).image { _ in
          img.draw(in: CGRect(x: 0, y: 0, width: 1080, height: img.size.height * img.scale * f))
        }
      }
      data = img.jpegData(compressionQuality: 0.45) ?? data
    }
    try? data.write(to: dir.appendingPathComponent(file))
    note(true, "screenshot \(file)")
  }

  /// system permission alerts (notifications, …) → allow, so the flow continues
  private func dismissAlerts() {
    for title in ["Allow", "Erlauben", "OK", "Open", "Öffnen"] {
      let b = springboard.alerts.buttons[title]
      if b.exists { b.tap(); note(true, "dismissed system alert (\(title))"); return }
    }
  }

  private func element(containing text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
  }

  /// first element whose label starts with `text` (the tools panel header and its rows carry the name first)
  private func labelStarting(_ text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", text)).firstMatch
  }

  @discardableResult
  private func waitFor(_ text: String, _ timeout: TimeInterval = 15) -> Bool {
    let ok = element(containing: text).waitForExistence(timeout: timeout)
    note(ok, "visible: \(text)")
    return ok
  }

  @discardableResult
  private func tap(_ text: String, _ timeout: TimeInterval = 10) -> Bool {
    dismissAlerts()
    let e = element(containing: text)
    guard e.waitForExistence(timeout: timeout), e.isHittable else { note(false, "tap: \(text) (not found / not hittable)"); return false }
    e.tap(); note(true, "tap: \(text)")
    return true
  }

  private func send(_ prompt: String, wait: TimeInterval, hideKeyboardFirst: Bool = false) {
    dismissAlerts()
    let input = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
    guard input.waitForExistence(timeout: 10) else { note(false, "composer input not found"); return }
    input.tap(); input.typeText(prompt)
    // store run: an answer that covers the drag area (approval card) would leave the keyboard up
    if hideKeyboardFirst { hideKeyboard() }
    // the composer's send button, not the keyboard's return key (German keyboards label it "Senden" too)
    sleep(1)
    let kb = app.keyboards.firstMatch
    let kbFrame = kb.exists ? kb.frame : .null
    let cands = app.buttons.matching(NSPredicate(format: "label IN %@", ["Send", "Senden", "Enviar"])).allElementsBoundByIndex
      .filter { $0.exists && !$0.frame.isEmpty && !kbFrame.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY)) }
    if let b = cands.first(where: { $0.isHittable }) ?? cands.first {
      // iPad with a hardware keyboard: the shortcut bar can make the button report "not hittable"
      if b.isHittable { b.tap() } else { b.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
      sleep(1)
      let left = (input.value as? String) ?? ""
      note(!left.contains(prompt), "sent: \(prompt)")
    } else {
      note(false, "send button not found (\(prompt))")
    }
    sleep(UInt32(wait))
    dismissAlerts()
    hideKeyboard()
  }

  /// interactive keyboard dismissal (MessageList keyboardDismissMode = interactive): short drag from just above the
  /// composer into the keyboard, so screenshots show the answer and not the keyboard
  private func hideKeyboard() {
    guard app.keyboards.firstMatch.exists else { return }
    // iPad: the keyboard has its own dismiss key
    let hide = app.keyboards.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'keyboard' OR label CONTAINS[c] 'Tastatur'")).firstMatch
    if hide.exists && hide.isHittable {
      hide.tap(); sleep(1)
      note(true, "keyboard hidden with its key: \(!app.keyboards.firstMatch.exists)")
      return
    }
    let input = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
    let win = app.windows.firstMatch.frame
    let y = max(win.minY + 120, input.frame.minY - 24)
    let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: y))
    let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.maxY - 4))
    start.press(forDuration: 0.05, thenDragTo: end)
    sleep(1)
    // informational only: with a hardware keyboard only the shortcut bar remains, which is fine for screenshots
    note(true, "keyboard hidden after drag: \(!app.keyboards.firstMatch.exists)")
  }

  private func button(_ label: String) -> XCUIElement {
    app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  /// exact button label (CONTAINS would also hit "Show chats" for "Chats" etc.)
  @discardableResult
  private func tapButton(_ label: String, _ timeout: TimeInterval = 8) -> Bool {
    dismissAlerts()
    let e = button(label)
    guard e.waitForExistence(timeout: timeout), e.isHittable else { note(false, "tap button: \(label) (not found / not hittable)"); return false }
    e.tap(); note(true, "tap button: \(label)")
    return true
  }

  /// Settings: wide layout (iPad) has it in the sidebar, the phone in the chat drawer ("Chats")
  private func openSettings(_ de: Bool) -> Bool {
    let label = de ? "Einstellungen" : "Settings"
    if button(label).waitForExistence(timeout: 2) && button(label).isHittable { return tapButton(label) }
    tapButton("Chats")  // same label in de and en
    sleep(1)
    return tapButton(label)
  }

  /// fresh demo chat for the next store scene (header button, testID header-new-chat)
  private func newChat() {
    dismissAlerts()
    let b = app.buttons["header-new-chat"]
    if b.waitForExistence(timeout: 5) && b.isHittable { b.tap(); note(true, "new chat") } else { note(false, "new chat button not found") }
    sleep(2)
  }

  /// scroll the answer back by about half a screen (long answers end below the fold)
  private func scrollUp() {
    let win = app.windows.firstMatch.frame
    let top = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * 0.35))
    let bottom = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * 0.75))
    top.press(forDuration: 0.05, thenDragTo: bottom)
    sleep(2)
  }

  /// store run: the keyboard must not cover a screenshot. Try the interactive drag from several heights (an approval
  /// card or the quick-question screen covers the default start point)
  private func ensureKeyboardHidden() {
    hideKeyboard()
    let win = app.windows.firstMatch.frame
    for f in [0.55, 0.4, 0.25] where app.keyboards.firstMatch.exists {
      // never start on the keyboard itself (that types letters into the composer)
      guard win.minY + win.height * f < app.keyboards.firstMatch.frame.minY - 20 else { continue }
      let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * f))
      let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.maxY - 4))
      start.press(forDuration: 0.05, thenDragTo: end)
      sleep(1)
    }
    note(!app.keyboards.firstMatch.exists, "keyboard hidden for the screenshot")
  }

  /// tap by coordinate: rows such as the "Tools & activity" summary report "not hittable" although they are visible
  @discardableResult
  private func tapRow(_ text: String) -> Bool {
    let e = element(containing: text)
    guard e.waitForExistence(timeout: 8), !e.frame.isEmpty else { note(false, "tap row: \(text) (not found)"); return false }
    e.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    note(true, "tap row: \(text)")
    return true
  }

  /// scroll the answer towards newer content (drag up by about 40% of the window)
  private func scrollDown(_ f: Double = 0.4) {
    let win = app.windows.firstMatch.frame
    let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * 0.72))
    let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * (0.72 - f)))
    from.press(forDuration: 0.05, thenDragTo: to)
    sleep(1)
  }

  /// the "Share as image" sheet: a drag down from its upper part
  private func closeShareSheet() {
    let win = app.windows.firstMatch.frame
    let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * 0.2))
    let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.maxY - 4))
    from.press(forDuration: 0.05, thenDragTo: to)
    sleep(2)
    note(true, "share sheet closed by drag")
  }

  /// the "Changed files" review sheet: a drag would scroll the diffs, so tap the dimmed backdrop above the sheet
  private func closeReviewSheet(_ title: String) {
    let win = app.windows.firstMatch.frame
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: win.midX, dy: win.minY + win.height * 0.04)).tap()
    sleep(2)
    note(!element(containing: title).exists, "review sheet closed (backdrop tap)")
  }

  /// pair with the store mock the way a user does: Connect → "I have a QR code or link" → paste the pair link (HUI_PAIR_LINK,
  /// made by scripts/ios-sim-smoke.sh) → Use link, then the onboarding cards (check the connection, consent, "start an
  /// empty chat") until the composer of an empty chat is there. (Opening the link from outside needs a system dialog.)
  private func tr(_ lang: String, _ en: String, _ de: String, _ es: String) -> String { lang == "de" ? de : lang == "es" ? es : en }

  private func pairWithMock(_ lang: String) {
    guard let link = env["HUI_PAIR_LINK"], !link.isEmpty else { note(false, "HUI_PAIR_LINK missing"); return }
    guard tapButton(tr(lang, "Connect", "Verbinden", "Conectar")) else { return }
    sleep(2)
    guard tap("QR") else { return }
    sleep(2)
    let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
    guard field.waitForExistence(timeout: 8) else { note(false, "link field not found"); return }
    // typeText sometimes drops a character on a busy simulator ("hrmesuiplus://"): check the field, clear and retype
    for attempt in 0..<4 {
      field.tap()
      let have = (field.value as? String) ?? ""
      if have.count > 0 && have != link { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: have.count + 5)) }
      if (field.value as? String) != link { field.typeText(link) }
      if (field.value as? String) == link { break }
      note(false, "pair link typed wrong (attempt \(attempt + 1))")
    }
    field.typeText("\n")
    note(true, "pair link entered")
    sleep(3)
    let labels = lang == "de" ? ["Verbinden", "Verstanden & weiter", "Leeren Chat starten"] : lang == "es" ? ["Conectar", "Entendido, continuar", "Empezar un chat vacío"] : ["Connect", "Got it, continue", "Start an empty chat"]
    for i in 0..<14 {
      dismissAlerts()
      var tapped = false
      if i < 5 { shot("pair-\(i)") }   // the walk is documented by frames: the only way to see what a failed run was looking at
      for l in labels where button(l).exists && button(l).isHittable {
        button(l).tap(); note(true, "pair step: \(l)"); tapped = true; sleep(3); break
      }
      if !tapped {
        let input = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        if input.exists && input.isHittable && app.buttons["header-new-chat"].isHittable { break }
        sleep(2)
      }
    }
    note(app.buttons["header-new-chat"].exists && app.buttons["header-new-chat"].isHittable, "paired, chat open")
  }

  /// App Store screenshot drafts (scripts/ios-sim-smoke.sh with HUI_TEST=store): one fresh demo chat per scene of the
  /// 0.1.3 store story (docs/STORE.md "Screenshots"; same scene names as scripts/e2e/store_shots.py). The app is paired
  /// with the store mock (scripts/e2e/store-mock.mjs, no DEMO strip); all content is fictional. "Share to HUI+" is Android only (the iOS share extension is
  /// off by default), so there is no such scene here.
  func testStoreShots() throws {
    continueAfterFailure = true
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let lang = env["HUI_LANG"] ?? "en"
    let locale = ["de": "de_DE", "es": "es_ES"][lang] ?? "en_US"
    app.launchArguments = ["-AppleLanguages", "(\(lang))", "-AppleLocale", locale]
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    note(app.wait(for: .runningForeground, timeout: 20), "app launched (foreground)")
    sleep(3); dismissAlerts()
    waitFor("HUI+", 20)
    shot("welcome")   // the offline-demo card of the welcome screen: the one frame that shows demo
    pairWithMock(lang)

    // HUI_STORE_ONLY=web-search: only the web card scene (re-shoot of one picture); empty = the whole story
    let only = env["HUI_STORE_ONLY"] ?? ""
    if only.isEmpty {
    // checklist: tick two items, then the answer's own "Share as image" sheet (live preview with the ticks)
    send(tr(lang, "Make me a shopping list for the weekend.", "Mach mir eine Einkaufsliste fürs Wochenende.", "Hazme una lista de la compra."), wait: 7)
    tap(tr(lang, "Tomatoes", "Tomaten", "Tomates")); sleep(1)
    tap(tr(lang, "Basil", "Basilikum", "Albahaca")); sleep(2)
    scrollDown(0.7); scrollDown(0.7); scrollDown(0.7)
    shot("checklist-ticked")
    if tapButton(tr(lang, "Share as image", "Als Bild teilen", "Compartir como imagen")) {
      sleep(7)
      shot("share-image")
      closeShareSheet()
    }

    // approval, sent in the checklist chat: in an empty chat the keyboard cannot be dragged away
    send(tr(lang, "Clean up the cache, with approval.", "Räum den Cache auf, mit Freigabe.", "Borra los archivos temporales, pero solo con mi permiso."), wait: 6, hideKeyboardFirst: true)
    ensureKeyboardHidden()
    shot("approval")

    // choice cards
    newChat()
    send(tr(lang, "Help me pick a destination for a city break.", "Hilf mir, ein Ziel für einen Städtetrip zu wählen.", "Quiero elegir destino para una escapada."), wait: 8)
    shot("choice-cards")

    // products: pick two, the side-by-side table appears below the cards
    newChat()
    send(tr(lang, "Compare noise cancelling headphones.", "Vergleiche Kopfhörer mit Geräuschunterdrückung.", "Compara los mejores auriculares."), wait: 9)
    for _ in 0..<4 where !button(tr(lang, "Compare", "Vergleichen", "Comparar")).isHittable { scrollUp() }
    if tapButton(tr(lang, "Compare", "Vergleichen", "Comparar")) {
      sleep(2)
      tap("Quiet One"); sleep(1)
      tap("Calm 5"); sleep(2)
      let marker = element(containing: tr(lang, "Only differences", "Nur Unterschiede", "Solo diferencias"))
      let win = app.windows.firstMatch.frame
      for _ in 0..<8 where !(marker.exists && marker.frame.minY > win.height * 0.12 && marker.frame.minY < win.height * 0.4) { scrollDown(0.3) }
      shot("compare-table")
    }

    // a fresh process: after the compare selection XCUITest sometimes never sees the app idle again
    app.terminate(); sleep(2); app.launch(); sleep(5); dismissAlerts()

    }

    // web search (Web Search Plus): the tools panel above the answer → "Web search" row opens the result card
    // (how it searched, results with favicons and cited markers). The store mock stores the tool rows and serves the favicons.
    newChat()
    send(tr(lang, "Research jet lag tips for a flight east, with sources.", "Recherchiere Jetlag-Tipps für einen Flug nach Osten, mit Quellen.", "Busca consejos para el jet lag en un vuelo al este, con fuentes."), wait: 14)
    scrollDown(0.7); scrollDown(0.7)
    let panel = tr(lang, "Tools and activity", "Werkzeuge und Ablauf", "Herramientas y actividad")
    let win = app.windows.firstMatch.frame
    for _ in 0..<8 {
      let e = labelStarting(panel)
      if e.exists && e.frame.minY > win.height * 0.15 && e.frame.minY < win.height * 0.8 { break }
      scrollUp()
    }
    if labelStarting(panel).waitForExistence(timeout: 5) {
      labelStarting(panel).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap(); note(true, "tap row: \(panel)")
      sleep(2)
      let row = labelStarting(tr(lang, "Web search,", "Websuche,", "Búsqueda web,"))
      if row.waitForExistence(timeout: 8) {
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap(); note(true, "tap row: web search")
        if waitFor(tr(lang, "How it searched", "So wurde gesucht", "Cómo buscó"), 10) {
          sleep(3)   // favicons arrive through the bridge image proxy after the card is drawn
          shot("web-card")
          // the card's own close button (a drag inside it would scroll the results)
          if !tapButton(tr(lang, "Close", "Schließen", "Cerrar"), 4) { closeShareSheet() }
          sleep(1)
        }
      } else { note(false, "web search row not found") }
    } else { note(false, "tools panel not found") }

    if only.isEmpty {
    // coding: the "Review" sheet with the diffs
    newChat()
    send(tr(lang, "Fix the bug and show me the code diff.", "Behebe den Bug und zeig mir den Code-Diff.", "Arregla el bug y dame el diff."), wait: 13)
    scrollDown(0.7); scrollDown(0.7)
    shot("code-answer")
    // "Prüfen" may come as an umlaut or as u + combining diaeresis, so match the label loosely
    let reviewBtn = app.descendants(matching: .any).matching(NSPredicate(format: "label MATCHES %@", lang == "de" ? ".*[Pp]r.{1,2}fen.*" : lang == "es" ? ".*Revisar.*" : ".*Review.*")).firstMatch
    if reviewBtn.waitForExistence(timeout: 8) {
      reviewBtn.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap(); note(true, "tap: Review")
      sleep(3)
      shot("code-diff")   // last scene: the sheet stays open
    }

    }

    note(app.state == .runningForeground, "app still running at the end (no crash)")
    note(true, "run complete")
  }

  func testSmoke() throws {
    continueAfterFailure = true
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let de = (env["HUI_LANG"] ?? "en") == "de"
    let pad = UIDevice.current.userInterfaceIdiom == .pad
    app.launchArguments = de ? ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE"] : ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    XCUIDevice.shared.orientation = .portrait
    // light/dark: set by scripts/ios-sim-smoke.sh (HUI_APPEARANCE) before the simulator boots; switching it while
    // running (XCUIDevice.appearance, simctl ui) does not reach the apps on the iOS 27 simulator
    app.launch()
    note(app.wait(for: .runningForeground, timeout: 20), "app launched (foreground)")
    sleep(3); dismissAlerts()

    // Welcome (guided onboarding): brand, mini demo card, Connect + demo
    waitFor("HUI+", 20)
    waitFor(de ? "Verbinden" : "Connect")
    shot("welcome")
    // Connect -> setup choices (QR/link, no bridge, no Hermes); the hermes flavor offers no other backends
    tap(de ? "Verbinden" : "Connect")
    sleep(2)
    waitFor(de ? "Wie ist dein Hermes eingerichtet" : "How is your Hermes set up")
    let other = element(containing: de ? "Andere Anbindung" : "Other connection")
    note(!other.exists, "hermes flavor: no 'Other connection' option")
    shot("setup")
    if !tapButton(de ? "Zurück" : "Back") { app.terminate(); app.launch(); sleep(3) }
    sleep(2)

    // Demo -> done screen with demo starters -> chart starter opens a demo chat
    tap(de ? "(Demo)" : "(demo)")
    sleep(2)
    shot("demo-done")
    tap(de ? "Diagramm" : "Chart")
    sleep(8); dismissAlerts()
    shot("demo-chart")

    // a few more demo prompts (keywords of the recorded scenarios, onboarding/demo/scenarios.ts pickScenario)
    // (the loan calculator HTML of the demo is German in every language, see onboarding/demo/scenarios.ts)
    send(de ? "Bau mir einen Kreditrechner." : "Build me a loan calculator.", wait: 10)
    shot("demo-loan")
    send(de ? "Mach einen Vergleich von zwei Tarifen." : "Compare two plans.", wait: 10)
    shot("demo-compare")
    send(de ? "Erstelle einen gemischten Bericht für diese Woche." : "Create a mixed report for this week.", wait: 12)
    shot("demo-mixed")
    app.swipeDown(); sleep(1)
    shot("demo-mixed-scrolled")

    // settings (phone: from the chat drawer, iPad: sidebar), then back to the chat
    if openSettings(de) {
      sleep(2)
      shot("settings")
      tapButton(de ? "Fertig" : "Done")
      sleep(2)
    }

    // iPad: wide layout in landscape (≥ 900 pt: sidebar + centred dialogs). ⌘K/N/B are web-only today (ui/lib/useLayout.ts);
    // the screenshots show whether a native implementation reacts
    if pad {
      XCUIDevice.shared.orientation = .landscapeLeft
      sleep(3)
      shot("ipad-landscape")
      for (key, name) in [("k", "cmd-k"), ("n", "cmd-n"), ("b", "cmd-b")] {
        app.typeKey(key, modifierFlags: .command)
        sleep(2)
        shot("ipad-landscape-\(name)")
        app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        sleep(1)
      }
      XCUIDevice.shared.orientation = .portrait
      sleep(3)
      shot("ipad-portrait-end")
    }

    note(app.state == .runningForeground, "app still running at the end (no crash)")
    // completion record: scripts/ios-sim-smoke.sh reports success only when this line exists (a crashed/aborted
    // run leaves a partial results.txt without it)
    note(true, "run complete")
  }
}
