// Placeholder host app for the UI test bundle (scripts/ios-sim-smoke.sh); the test drives Hermes UI+ by bundle id.
import SwiftUI

@main
struct SmokeHostApp: App {
  var body: some Scene { WindowGroup { Text("Hermes UI+ smoke host") } }
}
