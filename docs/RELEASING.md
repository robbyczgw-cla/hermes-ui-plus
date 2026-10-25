# Releasing

How a release of Hermes Interactive UI+ is cut: Android APK and web bundle as GitHub release assets, the bridge on
npm. Building details are in [BUILD.md](BUILD.md); the leak scanners in [LEAK-GUARD.md](LEAK-GUARD.md).

## What a release consists of

| Asset | Name | Made by |
|---|---|---|
| Git tag | `v<version>` (equals the app's `versionName`, e.g. `v0.1.0-alpha.1`) | release step 4 |
| Android APK (arm64-v8a, release key) | `hermes-ui-plus-<version>.apk` + `hermes-ui-plus-<version>.apk.sha256` | `scripts/build-apk.sh release`, `scripts/package-apk.sh` |
| Optional: universal APK (arm64-v8a + x86_64) | `hermes-ui-plus-<version>-universal.apk` + `.apk.sha256` | `release.sh --build --universal-apk` (step 5) |
| Web app (PWA) bundle | `hermes-ui-plus-web-<version>.tar.gz` + `.tar.gz.sha256` | `scripts/build-web.sh`, `scripts/package-web.sh` |
| Bridge | npm `hermes-ui-plus-bridge@<version>` with dist-tag **`latest`** | `npm publish` in `bridge/` |
| Release notes | the version's section of [CHANGELOG.md](../CHANGELOG.md) | |

The `.sha256` files are in `sha256sum -c` format (relative file name), so users verify with
`sha256sum -c hermes-ui-plus-<version>.apk.sha256` next to the download. Upload **exactly one APK** per release (the optional universal APK of step 5 is the only exception):
Obtainium picks the APK from the release assets.

The maintainers cut releases with a script in their source repository that runs the steps below in this order (dry run by default, every publishing step behind its own flag). Everything it calls is in this repository, so a fork can follow the same steps by hand.

## Steps

### 1. Prepare (a normal commit)

- Bump the version everywhere: `app/package.json`, `app/app.json` (`expo.version`), `bridge/package.json`,
  `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`.
- Google Play needs an App Bundle: `BUNDLE=1 FLAVOR=hermes scripts/build-apk.sh release` builds `.aab` instead of the
  APK, signed with the release key (Play App Signing: enrol the release key as app signing key with PEPK, the same key
  is the upload key), so Play and the GitHub APK carry the same signer.
  The maintainers' release script does **not** build or upload the bundle; it is a separate, manual step. For the first store build
  decide `EXPO_PUBLIC_BG_SERVICE=0` (no foreground service, no Play declaration; [STORE.md](STORE.md) section 5), and
  keep the Play listing text in line with that choice (STORE.md "Google Play (draft)"). The bundle is written to
  `dist/` as `*.aab` (`dist/latest-hermes-release.aab`); `package-apk.sh` does not handle it.
- The Android `versionCode` (and iOS `buildNumber`) is the build number: `scripts/build-apk.sh` counts it up with
  every build (`~/builds/.hermes-build-number`, or `HUI_BUILD_COUNTER`) and passes it as `HUI_BUILD_NUMBER`, so every
  APK installs over every older one. Settings → About shows it as "<version> · Build <n>". Pin it with
  `HUI_BUILD_NUMBER=<n>` (it must still be higher than any build users have installed). Without the build script, the
  values in `app/app.json` apply.
  Note: the release script compares only the `versionCode` in `app/app.json` with the last tag's, not the counter.
- CHANGELOG: a `## <version> - unreleased` section with the user-visible changes and its
  `<!-- release-date: … -->` line. The date replaces both when the release is tagged.

### 2. Checks

```
scripts/check.sh all                       # tsc, app, scripts, bridge, push tests (plain mode outside a systemd session)
node scripts/leak-guard.mjs --tree         # with the private denylist where it exists (docs/LEAK-GUARD.md)
```

CI (`.github/workflows/ci.yml`) runs the same suites on every pull request and on pushes to main.

Two checks that CI cannot run, both against what users actually see. Run them before every release:

```
FLAVOR=hermes scripts/build-web.sh && node scripts/ux-check/render-sweep.mjs --lang=de && node scripts/ux-check/render-sweep.mjs --lang=en --theme=dark
scripts/test-instance/ti.sh --host mac sync && scripts/test-instance/ti.sh --host mac setup
scripts/test-instance/ti.sh --host mac conversation-test
```

- **Render sweep** (`scripts/ux-check/render-sweep.mjs`): every answer node type with missing data, empty lists,
  unknown fields and image items that cannot be resolved (no image search, failed fetches), rendered in the web build
  the way the chat renders a block. Every fixture has to show text or a photo, never nothing, an empty box or a
  shimmer that does not settle. A new node type has to be added to `app/src/ui/renderFixtures.ts` (a unit test fails
  otherwise).
- **Live conversation test** (`bridge/eval/conversations/run.mjs`, via `ti.sh … conversation-test`): realistic
  multi-turn chats (dictation typos, short follow-ups such as "Fotos?", "als Tabelle?") through the bridge with its
  **default configuration** (no image search keys, router `heuristic`), what production and most users run, on the
  throwaway test instance (session + lock, left stopped). Every answer is parsed with the app's parser: each block must
  render content, and images must arrive as real URLs (checked through the bridge's image proxy) or show the visible
  fallback. Report: `$HUI_PRIVATE_DIR/reports/conversations/<time>/conversation-report.md` (outside the repo). For product questions with
  real tool data, set the instance up once with keyless web search: `ti.sh --host mac setup --force-config --web ddgs`.

#### Every shipped platform: install, pair, chat (required)

Before every release, **each platform the release ships** gets one run the way a new user does it: install the build
that will ship (fresh: no earlier app data), set up the bridge with the **default setup wizard**
(`hermes-ui-plus-bridge setup`, defaults, no hand-edited env file and no extra settings such as
`BRIDGE_CORS_ORIGINS`), pair with the link or QR code the wizard printed, send one message and see the answer. Our own
setups and test bridges carry settings a normal install does not have; 0.2.0 and 0.2.1 shipped a desktop app that
could not pair with a default bridge because no platform run like this was done.

| Platform | Run | How |
|---|---|---|
| Android | APK / AAB of the release | on a device or the emulator: paste or scan the wizard's link, one chat (`scripts/e2e/smoke.sh --live <pair-link file>` covers the pair + chat part) |
| iOS | TestFlight build | on a device: scan the wizard's QR code, one chat |
| Web | the release web bundle | served by the bridge (`setup --web-dir …`), open the wizard's web pair link in a browser, one chat |
| macOS | the notarised DMG | install from the DMG on a Mac without an earlier install (or with the app's data removed), paste the wizard's link, one chat |
| Linux | the AppImage | automated, real window: `scripts/desktop-check/linux.sh --appimage <file> --hermes-home <dir>` on a Linux host (below) |
| Windows | only when a Windows build ships | like macOS |

A platform without this run is **not released**, or the release notes name it as untested in this release
("<platform>: not tested with a default setup in this release"). Note each run (platform, build, bridge version,
result) in the release report.

The Linux run is scripted (`scripts/desktop-check/`): it extracts the AppImage, starts it in Xvfb inside a container
with a fresh HOME, runs `setup --yes --service none` against the given Hermes home (in a temp HOME; the public address is
`https://bridge.test:<port>` behind a throwaway test CA, because the desktop app connects to `https:` servers only),
starts the bridge with the command the wizard printed, and drives the real app window through WebKitGTK's WebDriver:
"Connect" → "I have a QR code or link" → paste the link → "Connect" → "Start an empty chat" → one message → an answer.
Exit 0 = PASS; `steps.json` and small JPEG screenshots of every step go to `--out`. With the throwaway Hermes test
instance (left as it was afterwards):

```
scripts/test-instance/ti.sh --host linux sync
scripts/test-instance/ti.sh --host linux hold --start -- \
  bash <repo copy on the host>/scripts/desktop-check/linux.sh --appimage <file> --hermes-home <TI_DIR>/data --out <dir>
```

The **release workflow** (`.github/workflows/release.yml`, run by hand from the Actions tab or by pushing a `v*` tag)
builds the web bundle and the `npm pack` of the bridge on a GitHub runner and attaches them to the run as artifacts,
each with a `.sha256` file. It checks that all version fields agree, that a tag equals `v<version>` and that the
CHANGELOG has a dated section; it scans both artifacts (generic leak-guard patterns and gitleaks). It never publishes:
no GitHub release, no tag, no npm publish, no store upload, and it has no write permission. Compare its checksums with
your own build (steps 6 and 7) and publish by hand (steps 8 and 9). The signed Android and iOS jobs in that file are
disabled templates that need repository secrets and a protected environment.

### 3. Release date

Replace `unreleased` in the CHANGELOG heading with the date (`YYYY-MM-DD`), drop the `release-date` marker line and
commit.

### 4. Tag

`git tag -a v<version> -m "Hermes Interactive UI+ <version>"`, then push the branch and the tag. Build everything
below from a clean checkout of the tag.

### 5. Android APK (release key)

```
HERMES_KEYSTORE=<path>/release.jks HERMES_KEYSTORE_PASS=… HERMES_CERT_SHA256=<fingerprint> \
  FLAVOR=hermes scripts/build-apk.sh release
VERSION=<version> scripts/package-apk.sh   # -> dist/release/hermes-ui-plus-<version>.apk + .sha256
```

`build-apk.sh` refuses a `FLAVOR=hermes` release without the release keystore and deletes an APK whose signer does not
match `HERMES_CERT_SHA256` (BUILD.md "Release signing"). `package-apk.sh` checks signer, app id and `versionName`
again, refuses `-debugsigned` test builds, runs the release gate (`scripts/scan-artifact.sh`) and writes the checksum.
The certificate fingerprint published in README.md must match.

**Optional universal APK.** The arm64 APK does not start on x86_64 Android emulators or x86 ChromeOS devices, not even
with their ARM translation (SoLoader looks for `lib/x86_64`; fresh-user test of 0.1.1). A second APK with both ABIs
runs there. It costs one more full build (a full build takes about 8 to 9 minutes on the build host) and is larger
(native libraries for both ABIs), so it is an extra asset, not the default APK:

```
HUI_BUILD_NUMBER=<build number of the arm64 APK> ABIS=arm64-v8a,x86_64 FLAVOR=hermes scripts/build-apk.sh release
VERSION=<version> ASSET_SUFFIX=-universal APK=dist/latest-hermes-release-arm64-v8a+x86_64.apk scripts/package-apk.sh
# -> dist/release/hermes-ui-plus-<version>-universal.apk + .sha256
```

`release.sh --build --universal-apk` runs both lines (same build number as the arm64 APK) and uploads the asset with
`--github-release`. It is off by default because a release with two APKs makes Obtainium ask which one to install.
Before the first release that carries it: tell Obtainium users in README.md to set the app's "Filter APKs by regular
expression" to `^(?!.*-universal\.apk$).*\.apk$`, and name the universal APK in README.md's Android section instead of
only pointing x86 users to the web app.

### 6. Web bundle

```
FLAVOR=hermes scripts/build-web.sh
VERSION=<version> scripts/package-web.sh   # -> dist/release/hermes-ui-plus-web-<version>.tar.gz + .sha256
```

### 7. Checksums

`cd dist/release && sha256sum -c *.sha256` must report `OK` for every asset.

### 8. GitHub release

```
gh release create v<version> --verify-tag --title "Hermes Interactive UI+ <version>" --notes-file <changelog section> \
  [--prerelease] dist/release/hermes-ui-plus-<version>.apk{,.sha256} dist/release/hermes-ui-plus-web-<version>.tar.gz{,.sha256}
```

Versions with a suffix (`-alpha.1`, `-beta.2`) are marked as pre-release. Obtainium ignores pre-releases unless
"Include prereleases" is on for the app, which README.md tells users.

### 9. npm

From the clean checkout of the tag (`prepack` bundles `hermes-skill/` and `LICENSE` into the package):

```
cd bridge && npm ci && npm publish --tag latest --access public
npm view hermes-ui-plus-bridge dist-tags   # latest must be <version>
```

All docs use `npx hermes-ui-plus-bridge …`, which resolves the `latest` dist-tag. npm requires an explicit `--tag`
for prerelease versions; publish them as `latest` as long as no stable version exists.

### 10. Homepage

Update the Platforms table in `website/build.mjs` (download links, status), run `node website/build.mjs` (it regenerates the
privacy page from [PRIVACY.md](../PRIVACY.md), which the app links) and deploy `website/` ([website/README.md](../website/README.md)).
