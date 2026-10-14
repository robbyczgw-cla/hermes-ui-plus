# shellcheck shell=bash
# Official (FLAVOR=hermes) identity for the build scripts, read from app/brand/identity.json (the single source;
# docs/BUILD.md "Identity"). Source it; sets (not exported):
#   BRAND_NAME ("Hermes Interactive UI+")  BRAND_SHORT_NAME (home-screen label)  BRAND_TAGLINE
#   BRAND_IOS_ID  BRAND_ANDROID_ID  BRAND_DESKTOP_ID  BRAND_SCHEME  BRAND_ARTIFACT (APK / download file prefix)
#   BRAND_INK (icon background colour = dark app background)  BRAND_PAPER (light app background)
# The personal flavor never uses these ids (its identity comes from $HUI_PRIVATE_DIR/app/identity.json).
_BRAND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
eval "$(node -e '
const id = require(process.argv[1]);
const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
const out = { BRAND_NAME: id.name, BRAND_SHORT_NAME: id.shortName, BRAND_TAGLINE: id.tagline, BRAND_IOS_ID: id.iosBundleId,
  BRAND_ANDROID_ID: id.androidPackage, BRAND_DESKTOP_ID: id.desktopId, BRAND_SCHEME: id.scheme,
  BRAND_ARTIFACT: id.artifactBase, BRAND_INK: id.colors.ink, BRAND_PAPER: id.colors.paper };
for (const [k, v] of Object.entries(out)) console.log(`${k}=${q(v)}`);
' "$_BRAND_ROOT/app/brand/identity.json")" || { echo "cannot read app/brand/identity.json" >&2; return 1 2>/dev/null || exit 1; }
