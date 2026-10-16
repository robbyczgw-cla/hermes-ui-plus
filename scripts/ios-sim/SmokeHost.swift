// Placeholder host app for the UI test bundle (scripts/ios-sim-smoke.sh); the test drives HUI+ by bundle id.
import SwiftUI

@main
struct SmokeHostApp: App {
  var body: some Scene { WindowGroup { Text("HUI+ smoke host") } }
}
