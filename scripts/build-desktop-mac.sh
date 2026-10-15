#!/usr/bin/env bash
# Build the Hermes macOS desktop app (Tauri v2, desktop/) on a Mac over ssh and publish it under
# dist/share/desktop/ (served by `tailscale serve` at /hermes/desktop/).
#
# Usage: [FLAVOR=hermes|personal] [HUI_PRIVATE_DIR=…] scripts/build-desktop-mac.sh   (docs/BUILD.md "Flavors")
# Output: dist/share/desktop/{<name>_<ver>_aarch64.dmg,<zip>,index.html,icon-256.png,build.txt}
#         hermes: name/id from app/brand/identity.json ("Hermes UI+", xyz.hermesui.desktop), zip hermes-ui-plus-macos.zip;
#         personal: desktopName/desktopId of $HUI_PRIVATE_DIR/app/identity.json, else "Hermes" / io.hermesiui.desktop
#         (the pre-rename identity, so an installed personal app keeps its settings), zip Hermes.app.zip
#         dist/build-desktop-<timestamp>.log
#
# Flow (runs on the build machine):
#   1. web bundle: scripts/build-web.sh (memory-capped systemd scope, flock = one web build at a time) with
#      FLAVOR passed through, WEB_SW=0 (no service worker: WKWebView has none on tauri://) and WEB_OUT=dist/web-desktop;
#      all EXPO_PUBLIC_* variables of the calling shell are unset (they are inlined into the bundle – never tokens;
#      personal builds get theirs from the private overlay). A hermes build fails if private content would ship.
#      SKIP_WEB=1 reuses an existing dist/web-desktop. Built or reused, its JS must carry the flavor mark of FLAVOR
#      (scripts/verify-flavor-artifact.mjs) before it is uploaded.
#   2. rsync desktop/ (no node_modules/target/gen) + dist/web-desktop -> Mac:~/$REMOTE_DIR/desktop{,/dist-web}
#   3. on the Mac: npm ci (@tauri-apps/cli, npm cache inside the build dir), `tauri build` for
#      aarch64-apple-darwin only (bundles app + dmg), ad-hoc signed (signingIdentity "-", no notarization)
#   4. copy back the .dmg and a zipped .app + a download page; clean up on the Mac
#
# Toolchain on the Mac (user-space, no sudo): rustup in ~/.rustup + ~/.cargo (stable, aarch64-apple-darwin
# host only; `curl https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path`), Node from
# /opt/homebrew/bin, Xcode command line tools.
#
# Env (defaults in brackets):
#   FLAVOR [hermes]                 web bundle flavor (scripts/lib/flavor.sh)
#   MAC_HOST [build.env]            ssh host (BatchMode), required (env or $HUI_PRIVATE_DIR/build.env)
#   REMOTE_DIR [builds/hermes-desktop]  build dir on the Mac, relative to ~
#   SKIP_WEB=1                      do not rebuild the web bundle (use dist/web-desktop as is)
#   KEEP_CACHE=1                    keep src-tauri/target (~2-3 GB, fast rebuilds) and node_modules on the Mac;
#                                   default: both deleted after the build (the cargo registry in ~/.cargo stays)
#   INSTALL=1                       also install into ~/Applications on the Mac (replacing an old copy) and launch
#   MIN_FREE_GB [8]                 refuse to start below this much free disk on the Mac
#   PUBLIC_BASE [$DESKTOP_PUBLIC_BASE]  URL of dist/share/desktop/ (e.g. https://<build-host>.<tailnet>.ts.net/hermes/desktop);
#                                   the hermes flavor is published next to it in desktop-plus/ (both flavors coexist)
#   Developer ID signing + notarization (all from the environment or $HUI_PRIVATE_DIR/.env.local, never arguments):
#     MAC_P12, MAC_P12_PASS          Developer ID Application certificate (.p12) → signed with it (else ad-hoc)
#     ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH  App Store Connect API key → the app (Tauri) and the dmg are notarized
#                                    and stapled. The secrets go to ~/$REMOTE_DIR/sec on the Mac (mode 700/600) for
#                                    this run only, into a temporary keychain; both are deleted afterwards.
#     MAC_SIGN=0                     force the ad-hoc signature
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
FLAVOR="${FLAVOR:-${EXPO_PUBLIC_FLAVOR:-hermes}}"
case "$FLAVOR" in hermes|personal) ;; *) echo "FLAVOR must be hermes or personal (got '$FLAVOR')" >&2; exit 2 ;; esac
HUI_PRIVATE_DIR="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
case "$HUI_PRIVATE_DIR" in "~/"*) HUI_PRIVATE_DIR="$HOME/${HUI_PRIVATE_DIR#\~/}" ;; esac
export FLAVOR HUI_PRIVATE_DIR
flavor_load_build_env
if [ "$FLAVOR" = personal ]; then
  _pid() { node -p "try{require(process.argv[1])[process.argv[2]]||''}catch{''}" "$HUI_PRIVATE_DIR/app/identity.json" "$1"; }
  DESKTOP_NAME="$(_pid desktopName)"; DESKTOP_NAME="${DESKTOP_NAME:-Hermes}"
  DESKTOP_ID="$(_pid desktopId)"; DESKTOP_ID="${DESKTOP_ID:-io.hermesiui.desktop}"; ZIP_NAME="Hermes.app.zip"
else
  DESKTOP_NAME="$BRAND_SHORT_NAME"; DESKTOP_ID="$BRAND_DESKTOP_ID"; ZIP_NAME="$BRAND_ARTIFACT-macos.zip"
fi
MAC_HOST="${MAC_HOST:-}"
[ -n "$MAC_HOST" ] || { echo "MAC_HOST is not set (env or \$HUI_PRIVATE_DIR/build.env)"; exit 2; }
REMOTE_DIR="${REMOTE_DIR:-builds/hermes-desktop}"
# REMOTE_DIR is interpolated into remote shell commands and `rm -rf` targets: a plain relative path below ~ only
if ! [[ "$REMOTE_DIR" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || [[ "/$REMOTE_DIR/" == */../* || "/$REMOTE_DIR/" == */./* ]]; then
  echo "REMOTE_DIR must be a relative path below ~ of [A-Za-z0-9._-] segments (got '$REMOTE_DIR')" >&2; exit 2
fi
# names end up in the Tauri config (JSON via node), the remote env (printf %q) and the download page (HTML-escaped)
[[ "$DESKTOP_ID" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "invalid desktop id '$DESKTOP_ID'" >&2; exit 2; }
[[ "$ZIP_NAME" =~ ^[A-Za-z0-9._+-]+\.zip$ ]] || { echo "invalid zip name '$ZIP_NAME'" >&2; exit 2; }
case "$DESKTOP_NAME" in ''|*/*|*$'\n'*) echo "invalid desktop name" >&2; exit 2 ;; esac
html_esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&#39;/g" <<<"$1"; }
SKIP_WEB="${SKIP_WEB:-0}"; KEEP_CACHE="${KEEP_CACHE:-0}"; INSTALL="${INSTALL:-0}"; MIN_FREE_GB="${MIN_FREE_GB:-8}"
PUBLIC_BASE="${PUBLIC_BASE:-${DESKTOP_PUBLIC_BASE:-}}"
[ -n "$PUBLIC_BASE" ] || { echo "PUBLIC_BASE is not set (env or DESKTOP_PUBLIC_BASE in \$HUI_PRIVATE_DIR/build.env)"; exit 2; }
WEB_OUT="$ROOT/dist/web-desktop"
# both flavors are served side by side: personal in desktop/, hermes in desktop-plus/
OUT="$ROOT/dist/share/desktop"
if [ "$FLAVOR" = hermes ]; then OUT="$ROOT/dist/share/desktop-plus"; PUBLIC_BASE="${PUBLIC_BASE%/}"; PUBLIC_BASE="${PUBLIC_BASE%/desktop}/desktop-plus"; fi
# signing secrets: environment first, else $HUI_PRIVATE_DIR/.env.local (only these keys are read)
SECRETS_FILE="$HUI_PRIVATE_DIR/.env.local"
for k in MAC_P12 MAC_P12_PASS ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
  if [ -z "${!k:-}" ] && [ -f "$SECRETS_FILE" ]; then
    v="$(sed -n "s/^$k=//p" "$SECRETS_FILE" | tail -1)"; [ -n "$v" ] && printf -v "$k" '%s' "$v"
  fi
done
SIGN=0; NOTARIZE=0
if [ "${MAC_SIGN:-1}" != 0 ] && [ -n "${MAC_P12:-}" ] && [ -f "$MAC_P12" ] && [ -n "${MAC_P12_PASS:-}" ]; then SIGN=1; fi
if [ "$SIGN" = 1 ] && [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -f "${ASC_KEY_PATH:-/nonexistent}" ]; then NOTARIZE=1; fi
echo "signing: $([ "$SIGN" = 1 ] && echo 'Developer ID' || echo 'ad-hoc')$([ "$NOTARIZE" = 1 ] && echo ' + notarization' || true)"
SSH=(ssh -o BatchMode=yes "$MAC_HOST")

mkdir -p "$ROOT/dist" "$HOME/builds"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$ROOT/dist/build-desktop-$TS.log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "DESKTOP BUILD FAILED (line $LINENO). Log: $LOG" >&2' ERR
T0=$SECONDS
t() { echo "--- [$(date +%T)] $*"; }

exec 9>"$HOME/builds/.hermes-desktop-build.lock"
flock -n 9 || { echo "another desktop build is running ($HOME/builds/.hermes-desktop-build.lock)"; exit 1; }

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
[ -z "$(git -C "$ROOT" status --porcelain -- app desktop 2>/dev/null)" ] || SHA="$SHA-dirty"

# ---------------------------------------------------------------- 1. web bundle (the build machine, memory-capped)
if [ "$SKIP_WEB" != 1 ]; then
  t "web bundle (scripts/build-web.sh, FLAVOR=$FLAVOR, WEB_SW=0) -> $WEB_OUT"
  unset_public=(); while IFS= read -r v; do unset_public+=(-u "$v"); done < <(env | sed -n 's/^\(EXPO_PUBLIC_[A-Za-z0-9_]*\)=.*/\1/p')
  rc=0
  env "${unset_public[@]}" FLAVOR="$FLAVOR" HUI_PRIVATE_DIR="$HUI_PRIVATE_DIR" WEB_SW=0 WEB_OUT="$WEB_OUT" "$ROOT/scripts/build-web.sh" || rc=$?
  [ "$rc" -eq 0 ] || { echo "web bundle build failed (exit $rc)"; exit "$rc"; }
fi
[ -f "$WEB_OUT/index.html" ] || { echo "no web bundle in $WEB_OUT (run without SKIP_WEB=1)"; exit 1; }
if grep -q 'data-pwa="sw"' "$WEB_OUT/index.html"; then echo "web bundle registers a service worker (built without WEB_SW=0?)"; exit 1; fi
# provenance (written by scripts/build-web.sh): a reused bundle must be of THIS flavor, built with WEB_SW=0
WEB_FLAVOR="$(sed -n 's/^flavor=//p' "$WEB_OUT.build-info" 2>/dev/null || true)"
WEB_SWV="$(sed -n 's/^sw=//p' "$WEB_OUT.build-info" 2>/dev/null || true)"
if [ "$WEB_FLAVOR" != "$FLAVOR" ] || [ "$WEB_SWV" != 0 ]; then
  echo "web bundle $WEB_OUT is flavor='${WEB_FLAVOR:-unknown}' sw='${WEB_SWV:-?}' (need $FLAVOR, sw=0): rebuild without SKIP_WEB=1"; exit 1
fi
# the JS that gets embedded must be this flavor's (app/src/flavor.ts FLAVOR_MARK), also for a reused bundle
flavor_verify_artifact "$WEB_OUT" || { echo "web bundle $WEB_OUT does not carry the FLAVOR=$FLAVOR mark: rebuild without SKIP_WEB=1"; exit 1; }
# hermes: guard the bundle as it is now (also when reused), not only when it was built
if [ "$FLAVOR" = hermes ]; then flavor_guard_output "$WEB_OUT" || { echo "web bundle contains private content"; exit 1; }; fi
echo "web bundle: $(du -sh "$WEB_OUT" | cut -f1)"

# ---------------------------------------------------------------- 2. sync to the Mac
# local staging copy of exactly what is sent: guarded (hermes) before it leaves this machine
SRC_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-src.XXXXXX")"
OUT_STAGE="$OUT.staging-$TS"
# the signing material on the Mac is removed by the remote cleanup; this also covers a failure before the remote run
SEC_STAGE=""
trap 'rm -rf "$SRC_STAGE" "$OUT_STAGE" ${SEC_STAGE:+"$SEC_STAGE"}; if [ "${SIGN:-0}" = 1 ]; then "${SSH[@]}" "rm -rf ~/$REMOTE_DIR/sec" 2>/dev/null || true; fi' EXIT
rsync -a --delete \
  --exclude node_modules --exclude /dist-web/ --exclude src-tauri/target/ --exclude src-tauri/gen/ \
  --exclude '.env*' --exclude '*.p8' --exclude '*.p12' --exclude '*.key' --exclude '*.pem' \
  "$ROOT/desktop/" "$SRC_STAGE/"
if [ "$FLAVOR" = hermes ]; then
  t "flavor guard (desktop sources)"
  flavor_guard_tree "$SRC_STAGE" --no-expo-config
  flavor_guard_output "$SRC_STAGE"   # Rust/config/icons: overlay content, private terms, generic patterns
fi
t "rsync desktop/ + web bundle -> $MAC_HOST:~/$REMOTE_DIR/desktop"
"${SSH[@]}" "mkdir -p ~/$REMOTE_DIR/desktop"
rsync -a --delete "$SRC_STAGE/" "$MAC_HOST:$REMOTE_DIR/desktop/"
rsync -a --delete "$WEB_OUT/" "$MAC_HOST:$REMOTE_DIR/desktop/dist-web/"

# ---------------------------------------------------------------- 3. remote build
if [ "$SIGN" = 1 ]; then
  t "signing material -> $MAC_HOST:~/$REMOTE_DIR/sec (this run only)"
  SEC_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-sec.XXXXXX")"; chmod 700 "$SEC_STAGE"
  cp "$MAC_P12" "$SEC_STAGE/devid.p12"
  printf '%s' "$MAC_P12_PASS" > "$SEC_STAGE/p12pass"
  if [ "$NOTARIZE" = 1 ]; then
    cp "$ASC_KEY_PATH" "$SEC_STAGE/AuthKey.p8"
    printf 'ASC_KEY_ID=%q\nASC_ISSUER_ID=%q\n' "$ASC_KEY_ID" "$ASC_ISSUER_ID" > "$SEC_STAGE/asc.env"
  fi
  chmod 600 "$SEC_STAGE"/*
  "${SSH[@]}" "rm -rf ~/$REMOTE_DIR/sec; mkdir -p ~/$REMOTE_DIR/sec; chmod 700 ~/$REMOTE_DIR/sec"
  rsync -a --chmod=D700,F600 "$SEC_STAGE/" "$MAC_HOST:$REMOTE_DIR/sec/"
  rm -rf "$SEC_STAGE"
fi
t "remote build on $MAC_HOST"
# every value shell-quoted for the remote shell (a name with an apostrophe or spaces must not break / inject)
printf -v REMOTE_ENV '%q=%q ' REMOTE_DIR "$REMOTE_DIR" KEEP_CACHE "$KEEP_CACHE" INSTALL "$INSTALL" MIN_FREE_GB "$MIN_FREE_GB" \
  SHA "$SHA" DESKTOP_NAME "$DESKTOP_NAME" DESKTOP_ID "$DESKTOP_ID" ZIP_NAME "$ZIP_NAME" SIGN "$SIGN" NOTARIZE "$NOTARIZE"
"${SSH[@]}" "${REMOTE_ENV}/bin/bash -s" <<'REMOTE'
set -Eeuo pipefail
t() { echo "--- [mac $(date +%T)] $*"; }
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CI=true NO_COLOR=1 CARGO_TERM_COLOR=never   # CI=true: the dmg script skips the Finder/AppleScript styling
B="$HOME/$REMOTE_DIR"; D="$B/desktop"; PUB="$B/out"
export npm_config_cache="$B/.npm-cache"   # never touch the user's ~/.npm
# no /Users/<name>/… paths (cargo registry, build dir) in panic strings / debug info of the shipped binary
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$B=/build --remap-path-prefix=$HOME=/home"
free_gb() { df -g "$HOME" | awk 'NR==2{print $4}'; }
KC=""; ORIG_KCS=""
cleanup() {
  t "cleanup (KEEP_CACHE=$KEEP_CACHE)"
  if [ -n "$KC" ]; then
    # shellcheck disable=SC2086
    [ -z "$ORIG_KCS" ] || security list-keychains -d user -s $ORIG_KCS || true
    security delete-keychain "$KC" 2>/dev/null || true
  fi
  rm -rf "$B/sec"
  rm -rf "$npm_config_cache"
  if [ "$KEEP_CACHE" != 1 ]; then rm -rf "$D/src-tauri/target" "$D/node_modules" "$D/src-tauri/gen"; fi
  echo "disk free after: $(free_gb) GB"
}
trap cleanup EXIT

echo "disk free before: $(free_gb) GB (need >= $MIN_FREE_GB GB)"
[ "$(free_gb)" -ge "$MIN_FREE_GB" ] || { echo "REFUSING TO BUILD: not enough free disk on the Mac"; exit 1; }
command -v cargo >/dev/null && command -v node >/dev/null || { echo "toolchain missing (~/.cargo/bin/cargo, /opt/homebrew/bin/node)"; exit 1; }
echo "$(rustc -V), $(cargo -V), node $(node -v), $(xcodebuild -version 2>/dev/null | head -1)"

cd "$D"
t "npm ci (@tauri-apps/cli)"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# (scripts/brand-icons.mjs deletes a stale icon.icns when it cannot regenerate it, so absence = regenerate)
if [ ! -f src-tauri/icons/icon.icns ]; then
  t "app icons (tauri icon)"
  npx tauri icon src-tauri/icons/app-icon-source.png -o src-tauri/icons
  rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/Square*.png src-tauri/icons/StoreLogo.png src-tauri/icons/icon.ico src-tauri/icons/64x64.png
fi

if [ "$SIGN" = 1 ]; then
  t "temporary keychain with the Developer ID certificate"
  KC="$B/sec/hui-build.keychain-db"; KCPASS="$(openssl rand -hex 16)"
  ORIG_KCS="$(security list-keychains -d user | tr -d '"' | xargs)"
  security create-keychain -p "$KCPASS" "$KC"
  security set-keychain-settings -lut 3600 "$KC"
  security unlock-keychain -p "$KCPASS" "$KC"
  security import "$B/sec/devid.p12" -k "$KC" -P "$(cat "$B/sec/p12pass")" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCPASS" "$KC" >/dev/null
  # shellcheck disable=SC2086
  security list-keychains -d user -s "$KC" $ORIG_KCS
  IDENT="$(security find-identity -v -p codesigning "$KC" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
  [ -n "$IDENT" ] || { echo "the .p12 holds no 'Developer ID Application' identity"; exit 1; }
  export APPLE_SIGNING_IDENTITY="$IDENT"
  echo "Developer ID identity found"
  if [ "$NOTARIZE" = 1 ]; then
    # shellcheck disable=SC1091
    . "$B/sec/asc.env"
    export APPLE_API_KEY="$ASC_KEY_ID" APPLE_API_ISSUER="$ASC_ISSUER_ID" APPLE_API_KEY_PATH="$B/sec/AuthKey.p8"
  fi
fi
t "tauri build (aarch64-apple-darwin, app + dmg, $([ "$SIGN" = 1 ] && echo 'Developer ID' || echo 'ad-hoc')$([ "$NOTARIZE" = 1 ] && echo ' + notarization' || true))"
TAURI_CFG="$(node -e 'const c={productName: process.env.DESKTOP_NAME, identifier: process.env.DESKTOP_ID}; if (process.env.APPLE_SIGNING_IDENTITY) c.bundle={macOS:{signingIdentity: process.env.APPLE_SIGNING_IDENTITY, hardenedRuntime: true}}; console.log(JSON.stringify(c))')"
echo "app: $DESKTOP_NAME ($DESKTOP_ID)"
npx tauri build --target aarch64-apple-darwin --bundles app,dmg --config "$TAURI_CFG"

BUNDLE="src-tauri/target/aarch64-apple-darwin/release/bundle"
APP="$(ls -d "$BUNDLE"/macos/*.app | head -1)"; DMG="$(ls "$BUNDLE"/dmg/*.dmg | head -1)"
codesign --verify --deep --strict "$APP"
if [ "$SIGN" = 1 ]; then
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
fi
if [ "$NOTARIZE" = 1 ]; then
  t "notarize + staple the dmg (the app itself was notarized by tauri)"
  xcrun stapler validate "$APP" >/dev/null || { echo "the app is not stapled (tauri notarization failed?)"; exit 1; }
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m
  xcrun stapler staple "$DMG"
fi
VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
rm -rf "$PUB"; mkdir -p "$PUB"
cp "$DMG" "$PUB/"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$PUB/$ZIP_NAME"
sips -z 256 256 src-tauri/icons/icon.png --out "$PUB/icon-256.png" >/dev/null
{
  echo "bundle id:  $BID  version $VER  build $SHA"
  echo "arch:       $(lipo -archs "$APP/Contents/MacOS/"* | head -1)"
  echo "signature:  $(codesign -dvv "$APP" 2>&1 | grep -E '^(Signature=|Authority=Developer ID Application)' | sed -E 's/: .*/: <identity>/' | head -1)"
  echo "gatekeeper: $(spctl -a -t exec -vv "$APP" 2>&1 | grep -E 'accepted|rejected|source=' | tr '\n' ' ')"
  echo "app size:   $(du -sh "$APP" | cut -f1)  (binary $(du -h "$APP"/Contents/MacOS/* | cut -f1 | head -1))"
  echo "dmg:        $(basename "$DMG") $(du -h "$DMG" | cut -f1)"
  echo "zip:        $ZIP_NAME $(du -h "$PUB/$ZIP_NAME" | cut -f1)"
  echo "min macOS:  $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist" 2>/dev/null)"
} | tee "$PUB/build.txt"

if [ "$INSTALL" = 1 ]; then
  t "install -> ~/Applications/$DESKTOP_NAME.app and launch"
  mkdir -p "$HOME/Applications"
  osascript -e "tell application id \"$DESKTOP_ID\" to quit" >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$HOME/Applications/$DESKTOP_NAME.app"
  ditto "$APP" "$HOME/Applications/$DESKTOP_NAME.app"
  open "$HOME/Applications/$DESKTOP_NAME.app"
fi
REMOTE

# ---------------------------------------------------------------- 4. copy back + download page
# Everything is assembled in a staging dir, gated, and only then replaces the served $OUT.
t "copy back -> $OUT_STAGE"
rm -rf "$OUT_STAGE"; mkdir -p "$OUT_STAGE"
rsync -a "$MAC_HOST:$REMOTE_DIR/out/" "$OUT_STAGE/"
"${SSH[@]}" "rm -rf ~/$REMOTE_DIR/out"
DMG="$(cd "$OUT_STAGE" && ls -- *.dmg | head -1)"
[ -n "$DMG" ] && [ -f "$OUT_STAGE/$ZIP_NAME" ] || { echo "build output incomplete (dmg/zip missing)"; exit 1; }
DMG_SIZE="$(du -h "$OUT_STAGE/$DMG" | cut -f1)"; ZIP_SIZE="$(du -h "$OUT_STAGE/$ZIP_NAME" | cut -f1)"
H_NAME="$(html_esc "$DESKTOP_NAME")"; H_DMG="$(html_esc "$DMG")"; H_ZIP="$(html_esc "$ZIP_NAME")"
if [ "$NOTARIZE" = 1 ]; then
  INSTALL_STEPS=" <li>Die App ist mit Developer ID signiert und von Apple notarisiert: sie startet direkt.</li>"
else
  INSTALL_STEPS=" <li>Die App ist nicht notarisiert. Beim ersten Start blockiert macOS sie:
     $H_NAME öffnen &rarr; Meldung schließen &rarr; <b>Systemeinstellungen &rarr; Datenschutz &amp; Sicherheit</b>
     &rarr; ganz unten bei „$H_NAME wurde blockiert“ auf <b>Trotzdem öffnen</b> klicken und bestätigen.
     Danach startet sie normal.</li>
 <li>Alternative im Terminal: <code>xattr -dr com.apple.quarantine \"/Applications/$H_NAME.app\"</code></li>"
fi
cat > "$OUT_STAGE/index.html" <<HTML
<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$H_NAME für macOS</title>
<style>
 body{font-family:-apple-system,system-ui,sans-serif;max-width:38rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}
 img.icon{width:96px;height:96px} .btn{display:block;text-align:center;background:#2563EB;color:#fff;
 padding:1rem;border-radius:12px;text-decoration:none;font-weight:600;font-size:1.15rem;margin:1.5rem 0 .5rem}
 small{color:#666} li{margin:.4rem 0} code{background:#f1f1f1;padding:.1rem .3rem;border-radius:4px}
 @media(prefers-color-scheme:dark){body{background:#000;color:#eee}small{color:#999}code{background:#222}}
</style></head><body>
<img class="icon" src="icon-256.png" alt="">
<h1>$H_NAME für macOS</h1>
<p>Apple Silicon (arm64) &middot; macOS 13+ &middot; Build ${SHA} &middot; $(date +%Y-%m-%d)</p>
<a class="btn" href="$H_DMG">$H_DMG herunterladen ($DMG_SIZE)</a>
<p><small>Alternativ: <a href="$H_ZIP">$H_ZIP</a> ($ZIP_SIZE) &middot; <a href="build.txt">build.txt</a></small></p>
<h2>Installieren</h2>
<ol>
 <li>DMG öffnen und <b>$H_NAME</b> in den Ordner <b>Programme</b> ziehen.</li>
$INSTALL_STEPS
</ol>
<h2>Bedienung</h2>
<ul>
 <li><b>⌥ Leertaste</b> (überall): Hermes nach vorne holen, neuer Chat, Eingabefeld fokussiert. Nochmal drücken blendet Hermes aus.</li>
 <li><b>⌘N</b> neuer Chat &middot; <b>⌘F</b> im Chat suchen &middot; <b>⌘K</b> Chats durchsuchen &middot; <b>⌘1–9</b> Chat wechseln &middot;
     <b>⌥⌘↑/↓</b> vorheriger/nächster Chat &middot; <b>⌘.</b> Antwort stoppen &middot; <b>⇧⌘C</b> letzte Antwort kopieren &middot; <b>⌘,</b> Einstellungen.</li>
 <li>Rechtsklick auf eine Antwort: Kopieren, Vorlesen, Teilen, … &middot; Dateien aufs Fenster oder Dock-Symbol ziehen hängt sie an.</li>
 <li>Fenster schließen (⌘W) lässt Hermes in der Menüleiste weiterlaufen; <b>⌘Q</b> beendet. Einstellungen &rarr; Mac-App: Start bei der Anmeldung, nur Menüleiste, Touch-ID-Sperre.</li>
</ul>
<p><small>Nur im Tailnet erreichbar.</small></p>
</body></html>
HTML
if [ "$FLAVOR" = hermes ]; then
  t "release gate (unpacked app, download page)"
  APPX="$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-app.XXXXXX")"
  unzip -q "$OUT_STAGE/$ZIP_NAME" -d "$APPX" && flavor_guard_output "$APPX" \
    || { rm -rf "$APPX"; echo "DESKTOP BUILD REJECTED: the app contains private content; $OUT left unchanged"; exit 1; }
  rm -rf "$APPX"
  release_gate "$OUT_STAGE/$ZIP_NAME" || { echo "DESKTOP BUILD REJECTED by the release gate; $OUT left unchanged"; exit 1; }
  release_gate "$OUT_STAGE" || { echo "DESKTOP BUILD REJECTED by the release gate (download dir); $OUT left unchanged"; exit 1; }
fi
chmod -R o+rX "$OUT_STAGE"
rm -rf "$OUT.old-$TS"
[ ! -e "$OUT" ] || mv "$OUT" "$OUT.old-$TS"
mv "$OUT_STAGE" "$OUT"
rm -rf "$OUT.old-$TS"
chmod o+rx "$ROOT/dist/share" 2>/dev/null || true
echo
cat "$OUT/build.txt"
echo "download page: $PUBLIC_BASE/"
echo "OK in $(( (SECONDS-T0)/60 )) min. Log: $LOG"
