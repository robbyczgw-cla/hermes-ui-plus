# Releasing

How a release of Hermes Interactive UI+ is cut: Android APK and web bundle as GitHub release assets, the bridge on
npm. Building details are in [BUILD.md](BUILD.md); the leak scanners in [LEAK-GUARD.md](LEAK-GUARD.md).

## What a release consists of

| Asset | Name | Made by |
|---|---|---|
| Git tag | `v<version>` (equals the app's `versionName`, e.g. `v0.1.0-alpha.1`) | release step 4 |
| Android APK (arm64-v8a, release key) | `hermes-ui-plus-<version>.apk` + `hermes-ui-plus-<version>.apk.sha256` | `scripts/build-apk.sh release`, `scripts/package-apk.sh` |
| Web app (PWA) bundle | `hermes-ui-plus-web-<version>.tar.gz` + `.tar.gz.sha256` | `scripts/build-web.sh`, `scripts/package-web.sh` |
| Bridge | npm `hermes-ui-plus-bridge@<version>` with dist-tag **`latest`** | `npm publish` in `bridge/` |
| Release notes | the version's section of [CHANGELOG.md](../CHANGELOG.md) | |

The `.sha256` files are in `sha256sum -c` format (relative file name), so users verify with
`sha256sum -c hermes-ui-plus-<version>.apk.sha256` next to the download. Upload **exactly one APK** per release:
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
scripts/check.sh all                       # tsc, app tests, scripts tests (plain mode outside a systemd session)
(cd bridge && npm test) && (cd push && npm test)
node scripts/leak-guard.mjs --tree         # with the private denylist where it exists (docs/LEAK-GUARD.md)
```

CI (`.github/workflows/ci.yml`) runs the same suites on every push.

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
