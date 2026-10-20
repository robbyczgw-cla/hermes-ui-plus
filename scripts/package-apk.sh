#!/usr/bin/env bash
# Package the official Android APK as a release asset: dist/release/hermes-ui-plus-<version>.apk + .apk.sha256
#
# Usage: [VERSION=x.y.z] [APK=dist/latest-hermes-release.apk] [OUT_DIR=dist/release] scripts/package-apk.sh
#   Build it first with the release key: HERMES_KEYSTORE=… HERMES_KEYSTORE_PASS=… scripts/build-apk.sh release
#   (heavy, not done here). This script is light: it only checks, scans and copies.
#   VERSION            release version [bridge/package.json "version"]; must equal the APK's versionName
#   APK                the release APK [dist/latest-hermes-release.apk]
#   OUT_DIR            where the asset goes [dist/release]
#   ASSET_SUFFIX       optional name suffix, e.g. -universal -> hermes-ui-plus-<version>-universal.apk (release.sh
#                      --universal-apk); lower-case letters and digits after one dash
#   HERMES_CERT_SHA256 expected signer fingerprint (env or $HUI_PRIVATE_DIR/build.env). REQUIRED: a published APK
#                      must carry the release certificate that README.md names.
#   ANDROID_HOME       SDK with build-tools/36.0.0 (apksigner, aapt2) [/Users/Shared/hiui-android-sdk (macOS), /var/tmp/hiui-android-sdk,
#                      then ~/android/sdk]
# Refuses when the APK is debug-signed (-debugsigned name or another signer), is not the official app id, has another
# versionName, or fails the release gate (scripts/scan-artifact.sh). The sha256 file is in `sha256sum -c` format.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${APK:-$ROOT/dist/latest-hermes-release.apk}"
OUT_DIR="${OUT_DIR:-$ROOT/dist/release}"
die() { echo "package-apk: $*" >&2; exit 1; }
ASSET_SUFFIX="${ASSET_SUFFIX:-}"
[ -z "$ASSET_SUFFIX" ] || [[ "$ASSET_SUFFIX" =~ ^-[a-z0-9]+$ ]] || die "bad ASSET_SUFFIX '$ASSET_SUFFIX' (e.g. -universal)"

[ -f "$APK" ] || die "$APK not found. Build it first: HERMES_KEYSTORE=… scripts/build-apk.sh release"
APK_REAL="$(realpath "$APK")"
case "$(basename "$APK_REAL")" in *debugsigned*) die "$APK_REAL is a debug-signed test build (ALLOW_DEBUG_SIGNED=1); never publish it" ;; esac

if [ -z "${ANDROID_HOME:-}" ]; then
  for d in /Users/Shared/hiui-android-sdk /var/tmp/hiui-android-sdk "$HOME/android/sdk"; do [ -d "$d/build-tools/36.0.0" ] && { ANDROID_HOME="$d"; break; }; done
fi
BT="${ANDROID_HOME:-}/build-tools/36.0.0"
[ -x "$BT/apksigner" ] && [ -x "$BT/aapt2" ] || die "apksigner/aapt2 not found in $BT (set ANDROID_HOME)"
[ -n "${JAVA_HOME:-}" ] || JAVA_HOME="$HOME/android/jdk-17"
export PATH="$JAVA_HOME/bin:$PATH"

VERSION="${VERSION:-$(node -p "require('$ROOT/bridge/package.json').version")}"
[[ "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z.+_-]*$ ]] || die "bad VERSION '$VERSION'"

export FLAVOR=hermes EXPO_PUBLIC_FLAVOR=hermes
# shellcheck source=lib/flavor.sh
. "$ROOT/scripts/lib/flavor.sh"
flavor_init
# shellcheck source=lib/signing.sh
. "$ROOT/scripts/lib/signing.sh"
# expected fingerprint: env or build.env (signing_preflight's lookup), mandatory here
[ -n "${HERMES_CERT_SHA256:-}" ] || HERMES_CERT_SHA256="$(_signing_expected_from_private)"
[ -n "${HERMES_CERT_SHA256:-}" ] || die "HERMES_CERT_SHA256 is not set (env or \$HUI_PRIVATE_DIR/build.env): cannot prove the release signer"
HERMES_CERT_SHA256="$(normalize_sha256 "$HERMES_CERT_SHA256")"
GOT="$(APKSIGNER="$BT/apksigner" signer_sha256 "$APK_REAL")" || die "apksigner cannot verify $APK_REAL"
[ "$GOT" = "$HERMES_CERT_SHA256" ] || die "signer $GOT is not the release certificate $HERMES_CERT_SHA256"

BADGING="$("$BT/aapt2" dump badging "$APK_REAL")" || die "cannot read $APK_REAL"
PKG="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$BADGING")"
VNAME="$(sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING")"
VCODE="$(sed -n "s/^package: .*versionCode='\([^']*\)'.*/\1/p" <<<"$BADGING")"
[ "$PKG" = "$BRAND_ANDROID_ID" ] || die "package $PKG is not the official app id $BRAND_ANDROID_ID"
[ "$VNAME" = "$VERSION" ] || die "APK versionName $VNAME != VERSION $VERSION"

release_gate "$APK_REAL" || die "release gate (scripts/scan-artifact.sh) failed for $APK_REAL; nothing packaged"

mkdir -p "$OUT_DIR"
NAME="$BRAND_ARTIFACT-$VERSION$ASSET_SUFFIX.apk"
cp "$APK_REAL" "$OUT_DIR/$NAME.tmp.$$"
mv "$OUT_DIR/$NAME.tmp.$$" "$OUT_DIR/$NAME"
( cd "$OUT_DIR" && sha256sum "$NAME" > "$NAME.sha256" )
echo "package-apk: $OUT_DIR/$NAME ($(du -h "$OUT_DIR/$NAME" | cut -f1), $PKG $VNAME, versionCode $VCODE, signer $GOT)"
echo "package-apk: $(cat "$OUT_DIR/$NAME.sha256")"
