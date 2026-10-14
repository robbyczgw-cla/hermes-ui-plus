# Generates Smoke.xcodeproj (tiny host app + UI test bundle) for scripts/ios-sim-smoke.sh, on the Mac.
# Uses the xcodeproj gem that comes with CocoaPods (~/.local/cocoapods). Usage: ruby make-smoke-project.rb <dir>
require 'xcodeproj'
dir = File.expand_path(ARGV.fetch(0))
proj = Xcodeproj::Project.new(File.join(dir, 'Smoke.xcodeproj'))
common = {
  'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'YES', 'CODE_SIGN_STYLE' => 'Manual',
  'CODE_SIGN_IDENTITY' => '-', 'DEVELOPMENT_TEAM' => '', 'IPHONEOS_DEPLOYMENT_TARGET' => '17.0',
  'SDKROOT' => 'iphoneos', 'SUPPORTED_PLATFORMS' => 'iphonesimulator iphoneos', 'TARGETED_DEVICE_FAMILY' => '1,2',
}
host = proj.new_target(:application, 'SmokeHost', :ios, '17.0')
tests = proj.new_target(:ui_test_bundle, 'SmokeUITests', :ios, '17.0')
host.add_file_references([proj.main_group.new_file(File.join(dir, 'SmokeHost.swift'))])
tests.add_file_references([proj.main_group.new_file(File.join(dir, 'SmokeUITests.swift'))])
tests.add_dependency(host)
[[host, 'xyz.hermesui.smoke.host'], [tests, 'xyz.hermesui.smoke.uitests']].each do |t, bid|
  t.build_configurations.each do |c|
    c.build_settings.merge!(common)
    c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bid
    c.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES' if t == host
    c.build_settings['TEST_TARGET_NAME'] = 'SmokeHost' if t == tests
  end
end
proj.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(host)
scheme.add_test_target(tests)
scheme.save_as(proj.path, 'SmokeUITests', true)
puts "generated #{proj.path}"
