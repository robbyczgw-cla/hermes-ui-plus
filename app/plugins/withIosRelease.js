// Config plugin: iOS release settings that app.json cannot express directly (docs/IOS.md "Release config").
//  - Version: App Store Connect needs a numeric CFBundleShortVersionString ("1", "1.2" or "1.2.3"). The app version
//    (`version`, e.g. "0.1.0-alpha.1", shown in the app and used on Android) keeps its pre-release suffix; iOS gets
//    the numeric part as `ios.version` ("0.1.0"). The build number (CFBundleVersion) comes from `ios.buildNumber`
//    or, for store builds, from HUI_IOS_BUILD_NUMBER (scripts/build-ios.sh MODE=appstore counts it up).
//  - Push: HUI_APS_ENV=production sets aps-environment (expo-notifications writes "development"); App Store and
//    TestFlight builds use production APNs.
//  - Launch screen: the template's SplashScreen.storyboard uses the system background (white / black) and an image
//    that only expo-splash-screen would provide. This plugin gives it the brand background instead (named color
//    HuiLaunchBackground: paper in light mode, ink in dark mode, app/brand/identity.json), the same as the first
//    screen of the default theme, so launch -> app has no flash (Apple HIG: launch screen = first screen, no logo).
// Idempotent; fails the prebuild if the storyboard template changed in a way it does not recognise.
const fs = require('node:fs');
const path = require('node:path');

const COLOR_NAME = 'HuiLaunchBackground';

/** "0.1.0-alpha.1" -> "0.1.0"; "2" -> "2"; throws for anything that has no numeric x[.y[.z]] core. */
function iosMarketingVersion(version) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(String(version ?? '').trim());
  if (!m) throw new Error(`withIosRelease: version "${version}" has no numeric x.y.z core for CFBundleShortVersionString`);
  return [m[1], m[2], m[3]].filter((p) => p !== undefined).map((p) => String(Number(p))).join('.');
}

/** HUI_IOS_BUILD_NUMBER (if set) else the configured buildNumber; must be 1-3 dot-separated integers. */
function iosBuildNumber(envValue, configured) {
  const v = String(envValue ?? '').trim() || String(configured ?? '').trim() || '1';
  if (!/^\d+(\.\d+){0,2}$/.test(v)) throw new Error(`withIosRelease: build number "${v}" must be 1-3 dot-separated integers`);
  return v;
}

function apsEnvironment(envValue) {
  const v = String(envValue ?? '').trim();
  if (!v) return null;
  if (v !== 'production' && v !== 'development') throw new Error(`withIosRelease: HUI_APS_ENV must be production or development (got "${v}")`);
  return v;
}

/** "#RRGGBB" -> Xcode color-set components (sRGB, 0-1 strings with 3 decimals). */
function colorComponents(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`withIosRelease: "${hex}" is not a #RRGGBB color`);
  const c = (h) => (parseInt(h, 16) / 255).toFixed(3);
  return { red: c(m[1]), green: c(m[2]), blue: c(m[3]), alpha: '1.000' };
}

/** Contents.json of the launch background color set: light (any) = paper, dark = ink. */
function colorSetContents(light, dark) {
  const color = (hex) => ({ 'color-space': 'srgb', components: colorComponents(hex) });
  return {
    colors: [
      { idiom: 'universal', color: color(light) },
      { idiom: 'universal', appearances: [{ appearance: 'luminosity', value: 'dark' }], color: color(dark) },
    ],
    info: { author: 'xcode', version: 1 },
  };
}

const SYSTEM_BG = /<color key="backgroundColor" systemColor="systemBackgroundColor"\/>/;
const OUR_BG = `<color key="backgroundColor" name="${COLOR_NAME}"/>`;

/** SplashScreen.storyboard: container background -> named color (+ its design-time value in <resources>). */
function patchStoryboard(xml, light) {
  if (xml.includes(OUR_BG)) return xml;
  if (!SYSTEM_BG.test(xml) || !/<\/resources>/.test(xml)) {
    throw new Error('withIosRelease: unexpected SplashScreen.storyboard template, update app/plugins/withIosRelease.js');
  }
  const { red, green, blue } = colorComponents(light);
  const named = (ind) =>
    `${ind}    <namedColor name="${COLOR_NAME}">\n${ind}        <color red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>\n${ind}    </namedColor>\n`;
  return xml.replace(SYSTEM_BG, OUR_BG).replace(/([ \t]*)<\/resources>/, (_, ind) => `${named(ind)}${ind}</resources>`);
}

function brandColors(projectRoot) {
  const id = JSON.parse(fs.readFileSync(path.join(projectRoot, 'brand', 'identity.json'), 'utf8'));
  const { paper, ink } = id.colors ?? {};
  if (!paper || !ink) throw new Error('withIosRelease: app/brand/identity.json needs colors.paper and colors.ink');
  return { paper, ink };
}

function withIosRelease(config) {
  const { withDangerousMod, withEntitlementsPlist } = require('expo/config-plugins');
  config.ios = {
    ...config.ios,
    version: iosMarketingVersion(config.ios?.version ?? config.version),
    buildNumber: iosBuildNumber(process.env.HUI_IOS_BUILD_NUMBER, config.ios?.buildNumber),
  };
  const aps = apsEnvironment(process.env.HUI_APS_ENV);
  if (aps) {
    config = withEntitlementsPlist(config, (c) => {
      c.modResults['aps-environment'] = aps;
      return c;
    });
  }
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const { projectRoot, platformProjectRoot, projectName } = c.modRequest;
      const { paper, ink } = brandColors(projectRoot);
      const dir = path.join(platformProjectRoot, projectName);
      const sb = path.join(dir, 'SplashScreen.storyboard');
      if (!fs.existsSync(sb)) throw new Error(`withIosRelease: ${sb} missing (template changed?)`);
      fs.writeFileSync(sb, patchStoryboard(fs.readFileSync(sb, 'utf8'), paper));
      const set = path.join(dir, 'Images.xcassets', `${COLOR_NAME}.colorset`);
      fs.mkdirSync(set, { recursive: true });
      fs.writeFileSync(path.join(set, 'Contents.json'), JSON.stringify(colorSetContents(paper, ink), null, 2) + '\n');
      return c;
    },
  ]);
}

module.exports = withIosRelease;
module.exports.iosMarketingVersion = iosMarketingVersion;
module.exports.iosBuildNumber = iosBuildNumber;
module.exports.apsEnvironment = apsEnvironment;
module.exports.colorSetContents = colorSetContents;
module.exports.patchStoryboard = patchStoryboard;
module.exports.COLOR_NAME = COLOR_NAME;
