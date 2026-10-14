#!/usr/bin/env bash
# Build a development-signed iOS .ipa of Hermes UI+ on a Mac (over ssh) and publish it for
# over-the-air install (itms-services) under dist/share/ios/ (served by `tailscale serve` at /hermes/ios/).
#
# Usage: [FLAVOR=hermes|personal] [HUI_PRIVATE_DIR=…] [MODE=device|simulator|appstore] scripts/build-ios.sh
#            [--simulator | --appstore] [--working-tree]   (docs/BUILD.md "Flavors", docs/IOS.md)
# Output: dist/share/ios/{hermes-ui.ipa,manifest.plist,index.html,icon-57.png,icon-512.png}
#         dist/hermes-ui-ios-<sha>.ipa, dist/build-ios-<timestamp>.log
#
# MODE=appstore (or --appstore): App Store / TestFlight build (docs/IOS.md "TestFlight"). Official flavor only, from a
#         commit (no --working-tree). Release archive with automatic signing (Apple Distribution, needs the paid
#         Developer Program: Apple ID in Xcode or the App Store Connect API key below), aps-environment=production,
#         export method app-store-connect, CFBundleShortVersionString = numeric part of app.json `version` (0.1.0),
#         CFBundleVersion = next value of the private counter $IOS_BUILD_COUNTER [$HUI_PRIVATE_DIR/ios-build-number]
#         (BUILD_NUMBER=<n> overrides; the counter is written once the .ipa passed the release gate). Output:
#         dist/appstore/hermes-ui-<version>-<build>-<sha>.ipa (flavor guard + scripts/scan-artifact.sh; nothing is
#         published to dist/share). Upload (validate + upload with `xcrun altool`) only when ASC_KEY_ID, ASC_ISSUER_ID
#         and ASC_KEY_PATH (AuthKey_<id>.p8) are all set; the key is also used for signing (-authenticationKey*) and
#         is removed from the Mac afterwards. Without them the script prints the next steps. ASC_UPLOAD=0: use the key
#         for signing only, no upload (e.g. before the App Store Connect app record exists).
#         DRY_RUN=1: only check the inputs and print the plan (build number, upload yes/no); no ssh, no build.
#
# --simulator: unsigned Release build for the iOS Simulator instead (JS bundle embedded, runs without Metro; no team,
#         no signing, nothing published). Output: dist/hermes-ui-ios-sim-<sha>.zip (zipped .app); the .app stays on
#         the Mac in $REMOTE_DIR/sim/ and is installed + launched on the simulator SIM_DEVICE [iPhone 18 Pro]
#         (booted if needed; SIM_DEVICE= (empty) skips that). Smoke test: scripts/ios-sim-smoke.sh.
# --working-tree: build the current app/ files (tracked + untracked, not git-ignored) instead of a clean worktree of
#         HEAD, e.g. to test uncommitted changes. The build is labelled <sha>-dirty. Same guards as a HEAD build.
#         WORKING_PATHS="app/app.json app/plugins/x.js …": only these paths come from the working tree, everything else
#         from HEAD (label <sha>-patched); use it when other uncommitted work in app/ must not go into the build.
# BUILD_REF [HEAD]: commit to build instead of HEAD (worktree builds and WORKING_PATHS).
#
# Flow (runs on the build machine): clean `git worktree` of HEAD (uncommitted changes are NOT built) -> rsync app/ to the
# Mac (no node_modules/.expo/android/ios/dist, no .env*, no keys) -> on the Mac: npm ci, expo prebuild -p ios
# --clean, pod install, xcodebuild archive (Release, automatic signing, -allowProvisioningUpdates), export
# (method "debugging" = development), manifest + install page -> copy back -> delete DerivedData, archive,
# Pods, ios/, node_modules and the npm/CocoaPods download caches on the Mac (it has little free disk).
#
# Toolchain on the Mac (user-space, no sudo; see docs/BUILD.md "iOS (on a Mac)"):
#   ~/.local/node        Node 22 LTS (nodejs.org tarball)
#   ~/.local/ruby        portable Ruby 3.4.6 (Homebrew portable-ruby tarball; the system Ruby 2.6 is too old for
#                        Expo SDK 57 autolinking, which uses Array#filter_map = Ruby >= 2.7)
#   ~/.local/cocoapods   CocoaPods 1.16.2 (GEM_HOME for that Ruby)
#   Xcode in /Applications/Xcode.app with the Apple ID of team <TEAM_ID> in Xcode > Settings > Accounts.
#
# Env (defaults in brackets; the maintainer's values live in $HUI_PRIVATE_DIR/build.env, see scripts/lib/flavor.sh):
#   FLAVOR [hermes]                 hermes = official app (BRAND_IOS_ID, app/brand/identity.json); personal = identity/icons/EXPO_PUBLIC_* from
#                                   the private overlay (its app/ dir is copied to the Mac as $REMOTE_DIR/private/app)
#   HUI_PRIVATE_DIR [~/work/hermesiui-private]
#   MAC_HOST [build.env]            ssh host (BatchMode), required
#   TEAM_ID [build.env]             Apple team id (OU of the "Apple Development: …" certificate), required
#   EXPORT_METHOD [debugging]       debugging (= development, needs Developer Mode on the phone) or
#                                   release-testing (= ad hoc, needs an Apple Distribution certificate);
#                                   MODE=appstore always uses app-store-connect
#   SIGNING [auto]                  auto  = Xcode automatic signing + -allowProvisioningUpdates (needs the Apple ID in
#                                           Xcode; creates/refreshes the App ID + profile incl. all registered devices).
#                                           Falls back to "local" if Xcode reports "No Accounts".
#                                   local = no account: sign with the newest valid local development profile of
#                                           the team (exact App ID, else the wildcard team profile). If that profile
#                                           has no Push capability, aps-environment is stripped from the generated
#                                           entitlements (build copy only; the app only uses local notifications).
#                                           If -exportArchive refuses, the signed .app from the archive is zipped.
#   PUBLIC_BASE [$IOS_PUBLIC_BASE]  URL of dist/share/ios/ (e.g. https://<build-host>.<tailnet>.ts.net/hermes/ios), required
#   MIN_FREE_GB [8]                 refuse to start below this much free disk on the Mac
#   KEEP_CACHE=1                    keep node_modules, Pods and caches on the Mac (faster rebuild, ~2-3 GB)
#   REMOTE_DIR [/Users/Shared/hermes-ui-build]  absolute build dir on the Mac (mode 700). Deliberately NOT under the
#                                   home dir: clang __FILE__ strings of the pods and the Hermes bytecode embed absolute
#                                   build paths, and /Users/<account> would put the account name into the shipped app
#                                   (flavor guard / leak denylist).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${MODE:-device}"; SOURCE="head"
for a in "$@"; do
  case "$a" in
    --simulator) MODE=simulator ;;
    --appstore) MODE=appstore ;;
    --working-tree) SOURCE=working ;;
    *) echo "usage: $0 [--simulator | --appstore] [--working-tree]" >&2; exit 2 ;;
  esac
done
case "$MODE" in device|simulator|appstore) ;; *) echo "MODE must be device, simulator or appstore (got '$MODE')" >&2; exit 2 ;; esac
SIM_DEVICE="${SIM_DEVICE-iPhone 18 Pro}"
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
flavor_init
flavor_load_build_env
MAC_HOST="${MAC_HOST:-}"
TEAM_ID="${TEAM_ID:-}"
EXPORT_METHOD="${EXPORT_METHOD:-debugging}"
PUBLIC_BASE="${PUBLIC_BASE:-${IOS_PUBLIC_BASE:-}}"
REQUIRED=(MAC_HOST TEAM_ID PUBLIC_BASE)
[ "$MODE" = simulator ] && REQUIRED=(MAC_HOST)
[ "$MODE" = appstore ] && REQUIRED=(MAC_HOST TEAM_ID)
for v in "${REQUIRED[@]}"; do
  [ -n "${!v}" ] || { echo "$v is not set (env or \$HUI_PRIVATE_DIR/build.env, see docs/BUILD.md)"; exit 2; }
done

# ---------------------------------------------------------------- appstore: inputs (build number, upload key)
HUI_IOS_BUILD_NUMBER=""; HUI_APS_ENV=""; UPLOAD=0; ASC_KEY_ID="${ASC_KEY_ID:-}"; ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
if [ "$MODE" = appstore ]; then
  [ "$FLAVOR" = hermes ] || { echo "MODE=appstore builds the official flavor only (FLAVOR=hermes)" >&2; exit 2; }
  [ "$SOURCE" = head ] || { echo "MODE=appstore builds a commit (HEAD or BUILD_REF), not the working tree" >&2; exit 2; }
  EXPORT_METHOD=app-store-connect; HUI_APS_ENV=production
  COUNTER="${IOS_BUILD_COUNTER:-$HUI_PRIVATE_DIR/ios-build-number}"
  case "$COUNTER" in "$ROOT"/*) echo "IOS_BUILD_COUNTER must live outside the repo (private dir)" >&2; exit 2 ;; esac
  LAST=0
  if [ -f "$COUNTER" ]; then
    LAST="$(tr -d '[:space:]' < "$COUNTER")"
    [[ "$LAST" =~ ^[0-9]+$ ]] || { echo "$COUNTER must contain one integer (last uploaded build number)" >&2; exit 2; }
  fi
  HUI_IOS_BUILD_NUMBER="${BUILD_NUMBER:-$((LAST + 1))}"
  [[ "$HUI_IOS_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || { echo "BUILD_NUMBER must be a positive integer" >&2; exit 2; }
  [ "$HUI_IOS_BUILD_NUMBER" -gt "$LAST" ] || echo "WARNING: build number $HUI_IOS_BUILD_NUMBER is not above the last one ($LAST): App Store Connect rejects a duplicate"
  ASC_SET=0; for v in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do [ -n "${!v:-}" ] && ASC_SET=$((ASC_SET + 1)); done
  if [ "$ASC_SET" = 3 ]; then
    [[ "$ASC_KEY_ID" =~ ^[A-Z0-9]{8,12}$ ]] || { echo "ASC_KEY_ID does not look like an App Store Connect key id" >&2; exit 2; }
    [[ "$ASC_ISSUER_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "ASC_ISSUER_ID must be the issuer UUID" >&2; exit 2; }
    [ -r "$ASC_KEY_PATH" ] || { echo "ASC_KEY_PATH is not a readable file" >&2; exit 2; }
    grep -q 'BEGIN PRIVATE KEY' "$ASC_KEY_PATH" || { echo "ASC_KEY_PATH is not a .p8 private key" >&2; exit 2; }
    case "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)/" in "$ROOT"/*) echo "ASC_KEY_PATH must not be inside the repo" >&2; exit 2 ;; esac
    UPLOAD=1
  elif [ "$ASC_SET" != 0 ]; then
    echo "set all of ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (upload) or none (build only)" >&2; exit 2
  fi
  echo "appstore: version = numeric part of app.json version, build number $HUI_IOS_BUILD_NUMBER (last: $LAST, counter: $COUNTER)"
  SEND=0; [ "$UPLOAD" = 1 ] && [ "${ASC_UPLOAD:-1}" != 0 ] && SEND=1
  echo "appstore: upload: $([ "$SEND" = 1 ] && echo "yes (App Store Connect API key)" || { [ "$UPLOAD" = 1 ] && echo "no (ASC_UPLOAD=0: API key used for signing only)" || echo "no (ASC_* not set)"; })"
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "DRY_RUN: would build $(git -C "$ROOT" rev-parse --short "${BUILD_REF:-HEAD}") on MAC_HOST, export app-store-connect, gate the .ipa,"
    echo "DRY_RUN: write $HUI_IOS_BUILD_NUMBER to the counter$([ "$SEND" = 1 ] && echo ", validate + upload with altool"). Nothing done."
    exit 0
  fi
fi
[ "${DRY_RUN:-0}" = 1 ] && { echo "DRY_RUN is only supported with MODE=appstore" >&2; exit 2; }
MIN_FREE_GB="${MIN_FREE_GB:-8}"
KEEP_CACHE="${KEEP_CACHE:-0}"
REMOTE_DIR="${REMOTE_DIR:-/Users/Shared/hermes-ui-build}"
case "$REMOTE_DIR" in /*) ;; *) echo "REMOTE_DIR must be an absolute path on the Mac" >&2; exit 2 ;; esac
WT="$HOME/builds/hermes-ui-ios-src"
OUT="$ROOT/dist/share/ios"
SSH=(ssh -o BatchMode=yes "$MAC_HOST")

mkdir -p "$ROOT/dist" "$HOME/builds"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$ROOT/dist/build-ios-$TS.log"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "iOS BUILD FAILED (line $LINENO). Log: $LOG" >&2' ERR
T0=$SECONDS
t() { echo "--- [$(date +%T)] $*"; }

exec 9>"$HOME/builds/.hermes-ios-build.lock"
flock -n 9 || { echo "another iOS build is running ($HOME/builds/.hermes-ios-build.lock)"; exit 1; }

# ---------------------------------------------------------------- source: clean worktree of HEAD
BUILD_REF="${BUILD_REF:-HEAD}"   # commit to build (default HEAD), e.g. when HEAD is broken
SHA="$(git -C "$ROOT" rev-parse --short "$BUILD_REF")"
if [ -e "$WT" ]; then git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"; fi
git -C "$ROOT" worktree prune
if [ "$SOURCE" = working ] && [ -n "${WORKING_PATHS:-}" ]; then
  SHA="$SHA-patched"
  t "worktree of HEAD + working-tree paths ($WORKING_PATHS) -> $WT"
  git -C "$ROOT" worktree add --detach --quiet "$WT" "$BUILD_REF"
  # shellcheck disable=SC2086  # WORKING_PATHS is a space-separated list
  (cd "$ROOT" && for f in $WORKING_PATHS; do case "$f" in app/*) ;; *) echo "WORKING_PATHS: $f is not under app/" >&2; exit 2;; esac; [ -e "$f" ] || { echo "WORKING_PATHS: $f missing" >&2; exit 2; }; done
    rsync -aR $WORKING_PATHS "$WT/")
  git -C "$WT" status --short -- app | sed 's/^/  /'
  cleanup_wt() { git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true; git -C "$ROOT" worktree prune; }
elif [ "$SOURCE" = working ]; then
  [ -n "$(git -C "$ROOT" status --porcelain -- app)" ] && SHA="$SHA-dirty"
  t "working tree app/ ($SHA) -> $WT"
  mkdir -p "$WT/app"
  (cd "$ROOT" && git ls-files -z --cached --others --exclude-standard -- app | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done) \
    | rsync -a --from0 --files-from=- "$ROOT/" "$WT/"
  cleanup_wt() { rm -rf "$WT"; }
else
  if [ -n "$(git -C "$ROOT" status --porcelain -- app)" ]; then
    echo "NOTE: app/ has uncommitted changes; they are NOT part of this build (building HEAD $SHA, see --working-tree)."
  fi
  t "worktree of HEAD ($SHA) -> $WT"
  git -C "$ROOT" worktree add --detach --quiet "$WT" "$BUILD_REF"
  cleanup_wt() { git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true; git -C "$ROOT" worktree prune; }
fi
trap cleanup_wt EXIT

t "rsync app/ -> $MAC_HOST:$REMOTE_DIR/app"
"${SSH[@]}" "mkdir -p $REMOTE_DIR/app && chmod 700 $REMOTE_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .expo/ --exclude /android/ --exclude /ios/ --exclude dist/ --exclude dist-web/ \
  --exclude '.env*' --exclude '*.jks' --exclude '*.keystore' --exclude '*.p8' --exclude '*.p12' --exclude '*.key' \
  --exclude '*.pem' --exclude '*.mobileprovision' --exclude .claude/ --exclude refs/ \
  "$WT/app/" "$MAC_HOST:$REMOTE_DIR/app/"
# hermes: the build input must not contain anything from the private overlay (Expo config is checked on the Mac)
flavor_guard_tree "$WT/app" --no-expo-config
cleanup_wt; trap - EXIT
# personal: identity + icons of the overlay (app/ only, no docs/env) -> $REMOTE_DIR/private/app on the Mac
"${SSH[@]}" "rm -rf $REMOTE_DIR/private"
if [ "$FLAVOR" = personal ]; then
  "${SSH[@]}" "mkdir -p $REMOTE_DIR/private/app"
  rsync -a --delete --exclude '*.env' --exclude '.env*' "$HUI_PRIVATE_DIR/app/" "$MAC_HOST:$REMOTE_DIR/private/app/"
fi
# EXPO_PUBLIC_* of this build (hermes: only the allowed public ones, checked by flavor_init)
PUBLIC_ENV="$(env | grep -E '^EXPO_PUBLIC_[A-Z0-9_]+=' | sed -E "s/'/'\\\\''/g; s/^([^=]+)=(.*)$/export \\1='\\2'/" || true)"

# ---------------------------------------------------------------- remote build
t "remote build on $MAC_HOST"
# The build script is uploaded and started by run_remote (below). codesign needs the unlocked login keychain;
# an ssh session has its own (locked) security session -> errSecInternalComponent. If signing does not work over
# ssh, the build runs as a one-shot LaunchAgent in the logged-in user's GUI session (keychain unlocked there),
# its log is streamed back and the agent is removed afterwards. Nothing is installed permanently.
sed -n '/^# >>> REMOTE BUILD$/,/^# <<< REMOTE BUILD$/p' "${BASH_SOURCE[0]}" \
  | "${SSH[@]}" "mkdir -p $REMOTE_DIR && cat > $REMOTE_DIR/remote-build.sh"
"${SSH[@]}" "cat > $REMOTE_DIR/remote-build.env" <<ENV
export TEAM_ID='$TEAM_ID' EXPORT_METHOD='$EXPORT_METHOD' PUBLIC_BASE='$PUBLIC_BASE' MIN_FREE_GB='$MIN_FREE_GB'
export KEEP_CACHE='$KEEP_CACHE' SIGNING='${SIGNING:-auto}' REMOTE_DIR='$REMOTE_DIR' SHA='$SHA' FLAVOR='$FLAVOR' BRAND_IOS_ID='$BRAND_IOS_ID'
export MODE='$MODE' SIM_DEVICE='$SIM_DEVICE' HUI_IOS_BUILD_NUMBER='$HUI_IOS_BUILD_NUMBER' HUI_APS_ENV='$HUI_APS_ENV'
export ASC_KEY_ID='$([ "$UPLOAD" = 1 ] && echo "$ASC_KEY_ID")' ASC_ISSUER_ID='$([ "$UPLOAD" = 1 ] && echo "$ASC_ISSUER_ID")'
$PUBLIC_ENV
ENV
if [ "$UPLOAD" = 1 ]; then
  # App Store Connect API key for signing (-authenticationKey*) and upload: only while this build runs, mode 600
  # in a mode-700 dir, removed on every exit (also on failure) and by the upload step.
  rm_asc_key() { "${SSH[@]}" "rm -rf $REMOTE_DIR/asc" 2>/dev/null || true; }
  trap rm_asc_key EXIT
  "${SSH[@]}" "rm -rf $REMOTE_DIR/asc && mkdir -m 700 $REMOTE_DIR/asc && umask 077 && cat > $REMOTE_DIR/asc/AuthKey_$ASC_KEY_ID.p8" < "$ASC_KEY_PATH"
fi
"${SSH[@]}" "REMOTE_DIR='$REMOTE_DIR' MODE='$MODE' bash -s" <<'LAUNCH'
set -euo pipefail
B="$REMOTE_DIR"; RUN=(/bin/bash -c "source '$B/remote-build.env'; exec /bin/bash '$B/remote-build.sh'")
[ "$MODE" = simulator ] && { echo "(simulator build: no signing, building directly)"; exec "${RUN[@]}"; }
IDENT="$(security find-identity -v -p codesigning | awk '/Apple Development/{print $2; exit}')"
T="$(mktemp)"; cp /usr/bin/true "$T"
if [ -n "$IDENT" ] && codesign --force -s "$IDENT" "$T" >/dev/null 2>&1; then
  rm -f "$T"; echo "(signing works over ssh, building directly)"; exec "${RUN[@]}"
fi
rm -f "$T"
launchctl print "gui/$(id -u)" >/dev/null 2>&1 || { echo "keychain locked over ssh and nobody logged in at the Mac's screen: log in once (or run the build in Terminal on the Mac)"; exit 1; }
echo "(keychain locked for ssh -> running the build as a one-shot LaunchAgent in the GUI session)"
L=hermes-ui.ios-build; PL="$B/$L.plist"; LOGF="$B/remote-build.log"; RC="$B/remote-build.rc"
rm -f "$LOGF" "$RC"; : > "$LOGF"
cat > "$PL" <<X
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$L</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>-c</string>
<string>source '$B/remote-build.env'; /bin/bash '$B/remote-build.sh' &gt;&gt; '$LOGF' 2&gt;&amp;1; echo \$? &gt; '$RC'</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>ProcessType</key><string>Interactive</string>
</dict></plist>
X
launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
trap 'launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true; rm -f "$PL"' EXIT
launchctl bootstrap "gui/$(id -u)" "$PL"
tail -n +1 -f "$LOGF" & TP=$!
while [ ! -s "$RC" ]; do sleep 2; done
sleep 1; kill $TP 2>/dev/null || true
exit "$(cat "$RC")"
LAUNCH
: <<'# <<< REMOTE BUILD'
# >>> REMOTE BUILD
# ---- runs on the Mac (uploaded as $REMOTE_DIR/remote-build.sh); this block is inert on the build machine
set -Eeuo pipefail
t() { echo "--- [mac $(date +%T)] $*"; }
export EXPO_PUBLIC_FLAVOR="$FLAVOR"
if [ "$FLAVOR" = personal ]; then export HUI_PRIVATE_DIR="$REMOTE_DIR/private"; else unset HUI_PRIVATE_DIR; fi
export PATH="$HOME/.local/node/bin:$HOME/.local/ruby/bin:$HOME/.local/cocoapods/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GEM_HOME="$HOME/.local/cocoapods" GEM_PATH="$HOME/.local/cocoapods"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 CI=1 EXPO_NO_TELEMETRY=1 COCOAPODS_DISABLE_STATS=1
export NODE_OPTIONS="--max-old-space-size=4096"
B="$REMOTE_DIR"; export npm_config_cache="$B/.npm-cache"  # never touch the user's ~/.npm
DD="$B/DerivedData"; ARCH="$B/Hermes.xcarchive"; EXP="$B/export"; PUB="$B/out"

START="$(date +%s)"
free_gb() { df -g "$HOME" | awk 'NR==2{print $4}'; }
cleanup() {
  t "cleanup (KEEP_CACHE=$KEEP_CACHE)"
  rm -rf "$DD" "$ARCH" "$EXP" "$B/ExportOptions.plist" "$B/profile.plist" "$B/remote-build.env" "$B/expo-config.json"
  gzip -f "$B/xcodebuild-archive.log" 2>/dev/null || true   # kept for diagnosis (~1 MB compressed)
  if [ "$KEEP_CACHE" != 1 ]; then
    rm -rf "$B/app/node_modules" "$B/app/ios" "$B/app/.expo"
    # download caches created by this build (none of them existed on the Mac before the first iOS build)
    rm -rf "$npm_config_cache" "$HOME/Library/Caches/CocoaPods" "$HOME/Library/Caches/ReactNative" "$HOME/.cocoapods/repos"
    rmdir "$HOME/.cocoapods" 2>/dev/null || true
    # Metro caches + codegen/export temp dirs, but only if this run created them (other projects on the Mac may use Metro too)
    TD="${TMPDIR:-$(getconf DARWIN_USER_TEMP_DIR)}"; for f in "$TD"/metro-cache "$TD"/metro-file-map-* "$TD"/*.xcdistributionlogs "$TD"/rn[a-z]* "$TD"/RNC* "$TD"/safeareacontext*; do
      [ -e "$f" ] && [ "$(stat -f %B "$f")" -ge "$START" ] && rm -rf "$f"
    done
  fi
  echo "disk free after: $(free_gb) GB"
}
trap cleanup EXIT

echo "disk free before: $(free_gb) GB (need >= $MIN_FREE_GB GB)"
[ "$(free_gb)" -ge "$MIN_FREE_GB" ] || { echo "REFUSING TO BUILD: not enough free disk on the Mac"; exit 1; }
command -v node >/dev/null && command -v pod >/dev/null && [ -x "$HOME/.local/ruby/bin/ruby" ] || { echo "toolchain missing (~/.local/node, ~/.local/ruby, ~/.local/cocoapods)"; exit 1; }
echo "node $(node -v), $(ruby -v | cut -d" " -f1-2), pod $(pod --version), $(xcodebuild -version | head -1)"

cd "$B/app"
LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
if [ -f node_modules/.lock-hash ] && [ "$LOCK_HASH" = "$(cat node_modules/.lock-hash)" ]; then
  t "node_modules up to date"
else
  t "npm ci"; rm -rf node_modules; npm ci --no-audit --no-fund; echo "$LOCK_HASH" > node_modules/.lock-hash
fi

t "expo prebuild -p ios --clean"
npx expo prebuild --platform ios --clean --no-install
t "pod install"
(cd ios && pod install)

WS="$(cd ios && ls -d *.xcworkspace | head -1)"; SCHEME="${WS%.xcworkspace}"
npx expo config --json --type public > "$B/expo-config.json"
BID="$(node -p "require('$B/expo-config.json').ios.bundleIdentifier")"
ICON="$(node -p "require('$B/expo-config.json').icon")"
echo "flavor $FLAVOR: bundle id $BID"
if [ "$FLAVOR" = hermes ] && [ "$BID" != "$BRAND_IOS_ID" ]; then echo "hermes build with bundle id $BID – refusing"; exit 1; fi
rm -rf "$ARCH" "$EXP" "$PUB"

if [ "$MODE" = simulator ]; then
  # Release configuration = JS bundle embedded (no Metro); arm64 simulator slice only; no signing at all.
  t "xcodebuild build ($SCHEME, Release, iphonesimulator, unsigned)"
  xcodebuild -workspace "ios/$WS" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DD" ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
    CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO build > "$B/xcodebuild-sim.log" 2>&1 || true
  grep -E 'error:|\*\* BUILD' "$B/xcodebuild-sim.log" | sort -u | head -40 || true
  SAPP="$(ls -d "$DD"/Build/Products/Release-iphonesimulator/*.app 2>/dev/null | head -1 || true)"
  [ -n "$SAPP" ] || { echo "SIMULATOR BUILD FAILED, last lines of $REMOTE_DIR/xcodebuild-sim.log:"; tail -40 "$B/xcodebuild-sim.log"; exit 1; }
  gzip -f "$B/xcodebuild-sim.log"
  # the .app stays on the Mac (simctl install / smoke test); a zip goes back to the build machine
  rm -rf "$B/sim"; mkdir -p "$B/sim" "$PUB"; ditto "$SAPP" "$B/sim/$(basename "$SAPP")"
  (cd "$B/sim" && ditto -c -k --keepParent "$(basename "$SAPP")" "$PUB/hermes-ui-sim.zip")
  VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SAPP/Info.plist")"
  echo "$(basename "$SAPP")|$BID|$VER|$(du -sh "$B/sim" | cut -f1)" > "$PUB/meta.txt"
  if [ -n "$SIM_DEVICE" ]; then
    UDID="$(xcrun simctl list devices available -j | node -e '
      const n = process.argv[1], d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
      const all = Object.entries(d).filter(([r]) => r.includes("iOS")).flatMap(([, l]) => l).filter((x) => x.name === n);
      process.stdout.write((all.at(-1) || {}).udid || "");' "$SIM_DEVICE")"
    [ -n "$UDID" ] || { echo "no available simulator named '$SIM_DEVICE' (xcrun simctl list devices available)"; exit 1; }
    t "simulator $SIM_DEVICE ($UDID): boot, install, launch"
    xcrun simctl bootstatus "$UDID" -b >/dev/null
    xcrun simctl terminate "$UDID" "$BID" 2>/dev/null || true
    xcrun simctl install "$UDID" "$B/sim/$(basename "$SAPP")"
    xcrun simctl launch "$UDID" "$BID"
    echo "$UDID" > "$B/sim/udid"
  fi
  exit 0
fi
# App Store Connect API key (MODE=appstore with ASC_*): lets -allowProvisioningUpdates create/refresh the
# distribution certificate + App Store profile without an Apple ID in Xcode
AUTH=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -f "$B/asc/AuthKey_$ASC_KEY_ID.p8" ]; then
  AUTH=(-authenticationKeyPath "$B/asc/AuthKey_$ASC_KEY_ID.p8" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
if [ "$MODE" = appstore ]; then
  # Expo prebuild already wrote version (numeric) + build number; refuse anything App Store Connect would reject
  PL0="ios/$SCHEME/Info.plist"
  V0="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PL0")"; N0="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PL0")"
  [[ "$V0" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || { echo "CFBundleShortVersionString '$V0' is not numeric"; exit 1; }
  [ "$N0" = "$HUI_IOS_BUILD_NUMBER" ] || { echo "CFBundleVersion '$N0' != build number $HUI_IOS_BUILD_NUMBER"; exit 1; }
  [ "$(/usr/libexec/PlistBuddy -c 'Print :aps-environment' "ios/$SCHEME/$SCHEME.entitlements" 2>/dev/null)" = production ] \
    || { echo "aps-environment is not production in the generated entitlements"; exit 1; }
  echo "appstore: version $V0 ($N0), aps-environment production"
fi
archive() {  # extra build settings as args
  xcodebuild -workspace "ios/$WS" -scheme "$SCHEME" -configuration Release -destination generic/platform=iOS \
    -archivePath "$ARCH" -derivedDataPath "$DD" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
    DEVELOPMENT_TEAM="$TEAM_ID" COMPILER_INDEX_STORE_ENABLE=NO "$@" \
    archive > "$B/xcodebuild-archive.log" 2>&1 || true
  grep -E 'error:|\*\* (ARCHIVE|BUILD)' "$B/xcodebuild-archive.log" | sort -u | head -40 || true
}

# Pick the newest valid local development profile for $TEAM_ID covering $BID (exact App ID first, then wildcard).
pick_profile() {
  local f tmp best="" bestscore=-1 now; now="$(date +%s)"; tmp="$(mktemp)"
  for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision \
           "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$f" ] || continue
    security cms -D -i "$f" > "$tmp" 2>/dev/null || continue
    local pb="/usr/libexec/PlistBuddy -c" appid exp team gta score
    appid="$($pb 'Print :Entitlements:application-identifier' "$tmp" 2>/dev/null)"
    team="$($pb 'Print :TeamIdentifier:0' "$tmp" 2>/dev/null)"
    gta="$($pb 'Print :Entitlements:get-task-allow' "$tmp" 2>/dev/null)"
    exp="$(date -j -f '%a %b %d %T %Z %Y' "$($pb 'Print :ExpirationDate' "$tmp")" +%s 2>/dev/null || echo 0)"
    [ "$team" = "$TEAM_ID" ] && [ "$gta" = true ] && [ "$exp" -gt "$now" ] || continue
    case "$appid" in "$TEAM_ID.$BID") score=2;; "$TEAM_ID.*") score=1;; *) continue;; esac
    [ "$score" -gt "$bestscore" ] && { best="$f"; bestscore=$score; }
  done
  rm -f "$tmp"; echo "$best"
}

SIGN_MODE="${SIGNING:-auto}"; [ "$MODE" = appstore ] && SIGN_MODE=auto   # local dev profiles cannot ship
if [ "$SIGN_MODE" = auto ]; then
  t "xcodebuild archive ($SCHEME, Release, automatic signing, team $TEAM_ID)"
  archive CODE_SIGN_STYLE=Automatic
  if [ "$MODE" = appstore ] && [ ! -d "$ARCH/Products/Applications" ] && grep -qE 'No Accounts|No signing certificate|requires a provisioning profile' "$B/xcodebuild-archive.log"; then
    echo "!!! App Store signing failed: needs the paid Apple Developer Program team in Xcode > Settings > Accounts"
    echo "!!! (with an Apple Distribution certificate / cloud signing) or an App Store Connect API key (ASC_*). docs/IOS.md"
    exit 1
  fi
  if [ ! -d "$ARCH/Products/Applications" ] && grep -q 'No Accounts' "$B/xcodebuild-archive.log"; then
    echo "!!! Xcode has no Apple ID (Xcode > Settings > Accounts), automatic provisioning impossible."
    echo "!!! Falling back to a locally installed development profile (no new devices, no profile refresh)."
    SIGN_MODE=local
  fi
fi
if [ "$SIGN_MODE" = local ]; then
  PROFILE="$(pick_profile)"
  [ -n "$PROFILE" ] || { echo "no valid local development profile for $TEAM_ID / $BID"; exit 1; }
  security cms -D -i "$PROFILE" > "$B/profile.plist"
  PUUID="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$B/profile.plist")"
  PNAME="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$B/profile.plist")"
  echo "using profile: $PNAME ($PUUID)"
  ENT="ios/$SCHEME/$SCHEME.entitlements"
  if [ -f "$ENT" ] && /usr/libexec/PlistBuddy -c 'Print :aps-environment' "$ENT" >/dev/null 2>&1 \
     && ! /usr/libexec/PlistBuddy -c 'Print :Entitlements:aps-environment' "$B/profile.plist" >/dev/null 2>&1; then
    echo "!!! profile has no Push capability -> removing aps-environment from $ENT (build copy only;"
    echo "!!! the app uses local notifications only, remote push tokens would not work in this build)"
    /usr/libexec/PlistBuddy -c 'Delete :aps-environment' "$ENT"
  fi
  # Xcode-managed profiles cannot be used with CODE_SIGN_STYLE=Manual; automatic style without an account
  # still picks a matching local profile once the entitlements fit it.
  t "xcodebuild archive ($SCHEME, Release, automatic signing with the local profile)"
  archive CODE_SIGN_STYLE=Automatic
fi
[ -d "$ARCH/Products/Applications" ] || { echo "ARCHIVE FAILED, last lines of $REMOTE_DIR/xcodebuild-archive.log:"; tail -40 "$B/xcodebuild-archive.log"; exit 1; }

t "export ($EXPORT_METHOD)"
cat > "$B/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>$EXPORT_METHOD</string>
  <key>teamID</key><string>$TEAM_ID</string>
$(if [ "$SIGN_MODE" = local ]; then cat <<X
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Development</string>
  <key>provisioningProfiles</key><dict><key>$BID</key><string>$PUUID</string></dict>
X
else echo '  <key>signingStyle</key><string>automatic</string>'; fi)
  <key>compileBitcode</key><false/>
$(if [ "$MODE" = appstore ]; then cat <<X
  <key>destination</key><string>export</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
X
else echo '  <key>thinning</key><string>&lt;none&gt;</string>'; fi)
  <key>stripSwiftSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCH" -exportPath "$EXP" -exportOptionsPlist "$B/ExportOptions.plist" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} > "$B/xcodebuild-export.log" 2>&1 || true
grep -E 'error|\*\* ' "$B/xcodebuild-export.log" || true
IPA="$(ls "$EXP"/*.ipa 2>/dev/null | head -1 || true)"
if [ -z "$IPA" ] && [ "$SIGN_MODE" = local ] && [ "$EXPORT_METHOD" = debugging ]; then
  # Without an Apple ID, -exportArchive may refuse. The archived app is already signed with the development
  # identity + embedded development profile, which is exactly what a development export contains.
  echo "!!! exportArchive failed without an Xcode account -> packaging the signed app from the archive"
  rm -rf "$EXP"; mkdir -p "$EXP/Payload"
  ditto "$(ls -d "$ARCH"/Products/Applications/*.app | head -1)" "$EXP/Payload/$SCHEME.app"
  codesign --verify --deep --strict "$EXP/Payload/$SCHEME.app"
  (cd "$EXP" && zip -qry "$SCHEME.ipa" Payload) && rm -rf "$EXP/Payload"
  IPA="$EXP/$SCHEME.ipa"
fi
[ -n "$IPA" ] || { echo "EXPORT FAILED:"; tail -30 "$B/xcodebuild-export.log"; exit 1; }

mkdir -p "$PUB"; cp "$IPA" "$PUB/hermes-ui.ipa"
if [ "$MODE" = appstore ]; then
  # short report without team, profile or certificate details (the build log is not private)
  TMPX="$(mktemp -d)"; (cd "$TMPX" && unzip -q "$PUB/hermes-ui.ipa")
  EAPP="$(ls -d "$TMPX"/Payload/*.app | head -1)"; PL="$EAPP/Info.plist"; pb() { /usr/libexec/PlistBuddy -c "Print :$1" "$PL"; }
  VER="$(pb CFBundleShortVersionString)"; BUILD="$(pb CFBundleVersion)"; NAME="$(pb CFBundleDisplayName 2>/dev/null || pb CFBundleName)"
  codesign -d --entitlements - --xml "$EAPP" 2>/dev/null > "$TMPX/ent.plist" || true
  APS="$(/usr/libexec/PlistBuddy -c 'Print :aps-environment' "$TMPX/ent.plist" 2>/dev/null || echo none)"
  GTA="$(/usr/libexec/PlistBuddy -c 'Print :get-task-allow' "$TMPX/ent.plist" 2>/dev/null || echo false)"
  DIST="$(codesign -dvv "$EAPP" 2>&1 | grep -c '^Authority=Apple Distribution' || true)"
  echo "app store build: $NAME $BID $VER ($BUILD), aps-environment $APS, get-task-allow $GTA, distribution-signed: $([ "$DIST" -gt 0 ] && echo yes || echo NO)"
  echo "ipa size: $(du -h "$PUB/hermes-ui.ipa" | cut -f1)"
  rm -rf "$TMPX"
  [ "$APS" = production ] && [ "$GTA" = false ] && [ "$DIST" -gt 0 ] || { echo "not a valid App Store build (see above)"; exit 1; }
  echo "$NAME|$BID|$VER|$BUILD" > "$PUB/meta.txt"
  exit 0
fi
APP="$(ls -d "$ARCH"/Products/Applications/*.app | head -1)"
PL="$APP/Info.plist"
VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PL")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PL")"
NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$PL" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$PL")"
sips -z 57 57 "$ICON" --out "$PUB/icon-57.png" >/dev/null
sips -z 512 512 "$ICON" --out "$PUB/icon-512.png" >/dev/null

# signing report from the exported app
TMPX="$(mktemp -d)"; (cd "$TMPX" && unzip -q "$PUB/hermes-ui.ipa")
EAPP="$(ls -d "$TMPX"/Payload/*.app | head -1)"
security cms -D -i "$EAPP/embedded.mobileprovision" > "$TMPX/prof.plist"
{
  echo "signing:    $SIGN_MODE"
  echo "bundle id:  $BID  version $VER ($BUILD)  commit $SHA"
  echo "profile:    $(/usr/libexec/PlistBuddy -c 'Print :Name' "$TMPX/prof.plist")  (expires $(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$TMPX/prof.plist"))"
  echo "team:       $(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$TMPX/prof.plist")"
  echo "signed by:  $(codesign -dvv "$EAPP" 2>&1 | grep -m1 '^Authority=')"
  echo "entitlements:"; codesign -d --entitlements - --xml "$EAPP" 2>/dev/null | plutil -p - | sed 's/^/  /'
  echo "provisioned devices (UDIDs):"; /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$TMPX/prof.plist" 2>/dev/null | sed -n 's/^ *\([0-9A-Fa-f-]\{20,\}\)$/  \1/p'
  echo "ipa size:   $(du -h "$PUB/hermes-ui.ipa" | cut -f1)"
} | tee "$B/signing.txt"   # build log only: never published (team, profile, device UDIDs)
rm -rf "$TMPX"

cat > "$PUB/manifest.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>items</key><array><dict>
    <key>assets</key><array>
      <dict><key>kind</key><string>software-package</string><key>url</key><string>$PUBLIC_BASE/hermes-ui.ipa?b=$SHA</string></dict>
      <dict><key>kind</key><string>display-image</string><key>url</key><string>$PUBLIC_BASE/icon-57.png</string></dict>
      <dict><key>kind</key><string>full-size-image</string><key>url</key><string>$PUBLIC_BASE/icon-512.png</string></dict>
    </array>
    <key>metadata</key><dict>
      <key>bundle-identifier</key><string>$BID</string>
      <key>bundle-version</key><string>$VER</string>
      <key>kind</key><string>software</string>
      <key>title</key><string>$NAME</string>
    </dict>
  </dict></array>
</dict></plist>
PLIST
plutil -lint "$PUB/manifest.plist"
echo "$NAME|$BID|$VER|$BUILD" > "$PUB/meta.txt"
# <<< REMOTE BUILD

# ---------------------------------------------------------------- simulator: copy back the zipped .app, guard it
if [ "$MODE" = simulator ]; then
  SZ="$ROOT/dist/hermes-ui-ios-sim-$SHA.zip"
  rsync -a "$MAC_HOST:$REMOTE_DIR/out/hermes-ui-sim.zip" "$SZ"
  IFS='|' read -r SAPPN BID VER SSIZE < <("${SSH[@]}" "cat $REMOTE_DIR/out/meta.txt")
  "${SSH[@]}" "rm -rf $REMOTE_DIR/out"
  if [ "$FLAVOR" = hermes ]; then
    GX="$(mktemp -d)"; (cd "$GX" && unzip -q "$SZ")
    flavor_guard_output "$GX" || { rm -rf "$GX" "$SZ"; echo "hermes simulator app contains private content – removed"; exit 1; }
    rm -rf "$GX"
  fi
  echo
  echo "simulator app: $SAPPN ($BID $VER, $SSIZE) -> $SZ; on the Mac: $REMOTE_DIR/sim/$SAPPN"
  [ -n "$SIM_DEVICE" ] && echo "installed + launched on '$SIM_DEVICE' (udid in $REMOTE_DIR/sim/udid)"
  echo "OK in $(( (SECONDS-T0)/60 )) min. Log: $LOG"
  exit 0
fi

# ---------------------------------------------------------------- appstore: copy back, gate, counter, upload
if [ "$MODE" = appstore ]; then
  STAGE="$ROOT/dist/.ios-appstore-$TS"
  rm -rf "$STAGE"; mkdir -p "$STAGE" "$ROOT/dist/appstore"
  rsync -a "$MAC_HOST:$REMOTE_DIR/out/" "$STAGE/"
  IFS='|' read -r NAME BID VER BUILD < "$STAGE/meta.txt"
  GX="$(mktemp -d)"; (cd "$GX" && unzip -q "$STAGE/hermes-ui.ipa")
  flavor_guard_output "$GX" || { rm -rf "$GX" "$STAGE"; "${SSH[@]}" "rm -rf $REMOTE_DIR/out"; echo "App Store .ipa contains private content – removed"; exit 1; }
  rm -rf "$GX"
  t "release gate: scripts/scan-artifact.sh"
  "$ROOT/scripts/scan-artifact.sh" "$STAGE/hermes-ui.ipa" || { rm -rf "$STAGE"; "${SSH[@]}" "rm -rf $REMOTE_DIR/out"; echo "release gate failed – not uploaded"; exit 1; }
  IPA_OUT="$ROOT/dist/appstore/hermes-ui-$VER-$BUILD-$SHA.ipa"
  mv "$STAGE/hermes-ui.ipa" "$IPA_OUT"; rm -rf "$STAGE"
  # the number is used up once an .ipa with it exists (App Store Connect never accepts it twice)
  printf '%s\n' "$BUILD" > "$COUNTER.tmp" && mv "$COUNTER.tmp" "$COUNTER"
  echo "app store .ipa: $IPA_OUT ($NAME $VER, build $BUILD); counter $COUNTER = $BUILD"
  if [ "$SEND" = 1 ]; then
    t "validate + upload (altool, App Store Connect API key)"
    "${SSH[@]}" "API_PRIVATE_KEYS_DIR=$REMOTE_DIR/asc ASC_KEY_ID=$ASC_KEY_ID ASC_ISSUER_ID=$ASC_ISSUER_ID REMOTE_DIR=$REMOTE_DIR bash -s" <<'UPLOAD'
set -euo pipefail
trap 'rm -rf "$REMOTE_DIR/asc" "$REMOTE_DIR/out"' EXIT
I="$REMOTE_DIR/out/hermes-ui.ipa"
xcrun altool --validate-app -f "$I" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" --output-format normal
xcrun altool --upload-app -f "$I" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" --output-format normal
UPLOAD
    echo "uploaded. App Store Connect processes the build (5-30 min), then: TestFlight > build $BUILD > export compliance"
    echo "is answered by the app (ITSAppUsesNonExemptEncryption=false) > add testers. docs/IOS.md \"TestFlight\"."
  else
    "${SSH[@]}" "rm -rf $REMOTE_DIR/out"
    echo
    echo "Not uploaded ($([ "$UPLOAD" = 1 ] && echo "ASC_UPLOAD=0" || echo "ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH not set")). Next steps (docs/IOS.md \"TestFlight\"):"
    echo "  - upload with Transporter (Mac App Store) or:  xcrun altool --upload-app -f <ipa> -t ios --apiKey <id> --apiIssuer <issuer>"
    echo "  - or re-run with ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=…/AuthKey_<id>.p8 BUILD_NUMBER=$BUILD $0 --appstore"
  fi
  echo "OK in $(( (SECONDS-T0)/60 )) min. Log: $LOG"
  exit 0
fi

# ---------------------------------------------------------------- copy back + install page
# Staged first; only after the flavor guard and the release gate (scripts/scan-artifact.sh) pass does it replace
# the published $OUT (served at $PUBLIC_BASE). A failed check leaves the previous install page untouched.
STAGE="$ROOT/dist/.ios-stage-$TS"
t "copy back -> $STAGE"
rm -rf "$STAGE"; mkdir -p "$STAGE"
rsync -a --delete "$MAC_HOST:$REMOTE_DIR/out/" "$STAGE/"
"${SSH[@]}" "rm -rf $REMOTE_DIR/out"
IFS='|' read -r NAME BID VER BUILD < "$STAGE/meta.txt"; rm -f "$STAGE/meta.txt"
if [ "$FLAVOR" = hermes ]; then  # the shipped app must not contain private content
  GX="$(mktemp -d)"; (cd "$GX" && unzip -q "$STAGE/hermes-ui.ipa")
  flavor_guard_output "$GX" || { rm -rf "$GX" "$STAGE"; echo "hermes .ipa contains private content – removed, nothing published"; exit 1; }
  rm -rf "$GX"
fi
t "release gate: scripts/scan-artifact.sh"
"$ROOT/scripts/scan-artifact.sh" "$STAGE/hermes-ui.ipa" || { rm -rf "$STAGE"; echo "release gate failed – nothing published"; exit 1; }
cp "$STAGE/hermes-ui.ipa" "$ROOT/dist/hermes-ui-ios-$SHA.ipa"
LINK="itms-services://?action=download-manifest&amp;url=$PUBLIC_BASE/manifest.plist"
cat > "$STAGE/index.html" <<HTML
<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$NAME für iPhone installieren</title>
<style>
 body{font-family:-apple-system,system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}
 img{width:96px;height:96px;border-radius:22px} .btn{display:block;text-align:center;background:#2563EB;color:#fff;
 padding:1rem;border-radius:12px;text-decoration:none;font-weight:600;font-size:1.15rem;margin:1.5rem 0}
 small{color:#666} li{margin:.4rem 0} @media(prefers-color-scheme:dark){body{background:#000;color:#eee}small{color:#999}}
</style></head><body>
<img src="icon-512.png" alt="">
<h1>$NAME</h1>
<p>Version $VER ($BUILD) &middot; Build ${SHA} &middot; $(date +%Y-%m-%d)</p>
<a class="btn" href="$LINK">Auf diesem iPhone installieren</a>
<ol>
 <li>Diese Seite in <b>Safari</b> öffnen und auf „Installieren“ tippen, dann bestätigen.</li>
 <li>Beim ersten Mal: <b>Einstellungen → Datenschutz &amp; Sicherheit → Entwicklermodus</b> einschalten, iPhone neu starten
     und den Entwicklermodus bestätigen (nötig für Entwickler-signierte Apps).</li>
 <li>Funktioniert nur auf iPhones, die im Apple-Developer-Team registriert sind (sonst „App konnte nicht installiert werden“).</li>
</ol>
<p><small>Nur im Tailnet erreichbar.</small></p>
</body></html>
HTML
chmod -R o+rX "$STAGE"; mkdir -p "$(dirname "$OUT")"; rm -rf "$OUT"; mv "$STAGE" "$OUT"; chmod o+rx "$ROOT/dist/share"
echo
rm -f "$OUT/signing.txt"; ssh "${SSH_OPTS[@]:-}" "$MAC_HOST" "cat $REMOTE_DIR/signing.txt" 2>/dev/null || true
echo "install page: $PUBLIC_BASE/"
echo "OK in $(( (SECONDS-T0)/60 )) min. Log: $LOG"
