// UI smoke test of the installed HUI+ (Hermes UI+) simulator build (scripts/ios-sim-smoke.sh). Drives the app by bundle id
// (XCUIApplication(bundleIdentifier:)), so the app itself needs no test target. Fresh install expected (onboarding).
// Env (via TEST_RUNNER_*): HUI_BUNDLE_ID, HUI_SHOT_DIR (screenshots + results.txt), HUI_LANG (en|de, default en).
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
    let file = String(format: "%02d-%@.png", shotNo, name)
    try? XCUIScreen.main.screenshot().pngRepresentation.write(to: dir.appendingPathComponent(file))
    note(true, "screenshot \(file)")
  }

  /// system permission alerts (notifications, …) → allow, so the flow continues
  private func dismissAlerts() {
    for title in ["Allow", "Erlauben", "OK"] {
      let b = springboard.alerts.buttons[title]
      if b.exists { b.tap(); note(true, "dismissed system alert (\(title))"); return }
    }
  }

  private func element(containing text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
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

  private func send(_ prompt: String, wait: TimeInterval) {
    dismissAlerts()
    let input = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
    guard input.waitForExistence(timeout: 10) else { note(false, "composer input not found"); return }
    input.tap(); input.typeText(prompt)
    // the composer's send button, not the keyboard's return key (German keyboards label it "Senden" too)
    sleep(1)
    let kb = app.keyboards.firstMatch
    let kbFrame = kb.exists ? kb.frame : .null
    let cands = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Send", "Senden")).allElementsBoundByIndex
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
