# shellcheck shell=bash
# Release signing of the official (FLAVOR=hermes) Android APK (scripts/build-apk.sh, docs/RELEASING.md).
# Every published APK must carry the same release certificate: Android and Obtainium refuse updates signed with a
# different key, and README.md publishes its SHA-256 fingerprint. The Expo template signs release builds with the
# per-machine debug key, so a release without HERMES_KEYSTORE must never look publishable.
#
#   signing_preflight VARIANT   before the build. Sets SIGNING_MODE:
#                                 release-key   hermes release, HERMES_KEYSTORE (+ HERMES_KEYSTORE_PASS) usable
#                                 debug-signed  hermes release without a keystore, ALLOW_DEBUG_SIGNED=1 (local tests;
#                                               the file name gets a -debugsigned suffix)
#                                 none          debug builds and the personal flavor (no requirements)
#                               Loads HERMES_CERT_SHA256 from $HUI_PRIVATE_DIR/build.env when it is not in the env.
#                               Returns 1 with a message when a hermes release cannot be signed with the release key.
#   signer_sha256 APK           lowercase hex SHA-256 of the APK's (first) signer certificate (apksigner)
#   signing_verify APK          release-key mode: the APK must verify, and match HERMES_CERT_SHA256 when it is set
#   normalize_sha256 VALUE      "17:9B:…" / "179b…" -> "179b…"
# Needs APKSIGNER (path to build-tools' apksigner) for signer_sha256 / signing_verify.

normalize_sha256() { printf '%s' "$1" | tr -d ': \t\r\n' | tr 'A-F' 'a-f'; }

_signing_expected_from_private() { # only this one key, as data (no sourcing of the private file)
  local f="${HUI_PRIVATE_DIR:-}/build.env" line
  [ -n "${HUI_PRIVATE_DIR:-}" ] && [ -f "$f" ] || return 0
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?HERMES_CERT_SHA256=' "$f" | tail -1)" || return 0
  line="${line#*=}"; line="${line%$'\r'}"
  if [[ "$line" =~ ^\"(.*)\"$ ]] || [[ "$line" =~ ^\'(.*)\'$ ]]; then line="${BASH_REMATCH[1]}"; fi
  printf '%s' "$line"
}

signing_preflight() {
  local variant="$1"
  SIGNING_MODE=none
  if [ "${FLAVOR:-hermes}" != hermes ] || [ "$variant" != release ]; then return 0; fi
  if [ -z "${HERMES_CERT_SHA256:-}" ]; then HERMES_CERT_SHA256="$(_signing_expected_from_private)"; fi
  if [ -n "${HERMES_CERT_SHA256:-}" ]; then
    HERMES_CERT_SHA256="$(normalize_sha256 "$HERMES_CERT_SHA256")"
    [[ "$HERMES_CERT_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "HERMES_CERT_SHA256 is not a SHA-256 fingerprint" >&2; return 1; }
  fi
  export HERMES_CERT_SHA256
  if [ -n "${HERMES_KEYSTORE:-}" ]; then
    [ -f "$HERMES_KEYSTORE" ] || { echo "HERMES_KEYSTORE not found: $HERMES_KEYSTORE" >&2; return 1; }
    [ -n "${HERMES_KEYSTORE_PASS:-}" ] || { echo "set HERMES_KEYSTORE_PASS for $HERMES_KEYSTORE" >&2; return 1; }
    SIGNING_MODE=release-key
    [ -n "${HERMES_CERT_SHA256:-}" ] \
      || echo "warning: HERMES_CERT_SHA256 is not set (env or \$HUI_PRIVATE_DIR/build.env): the signer fingerprint is printed but not checked" >&2
    return 0
  fi
  if [ "${ALLOW_DEBUG_SIGNED:-0}" = 1 ]; then
    SIGNING_MODE=debug-signed
    echo "warning: ALLOW_DEBUG_SIGNED=1: release APK signed with this machine's DEBUG key (local tests only, never publish;" \
      "the file name ends in -debugsigned)" >&2
    return 0
  fi
  cat >&2 <<'EOF'
REFUSING a FLAVOR=hermes release build without the release key: it would be signed with this machine's debug key,
and installs/updates of the published app (README fingerprint, Obtainium) would break.
  Publishable build:  HERMES_KEYSTORE=<path/to/release.jks> HERMES_KEYSTORE_PASS=<…> [HERMES_KEY_ALIAS=hermes]
                      [HERMES_CERT_SHA256=<expected fingerprint>] scripts/build-apk.sh release
  Local test build:   ALLOW_DEBUG_SIGNED=1 scripts/build-apk.sh release   (output named *-debugsigned.apk)
EOF
  return 1
}

signer_sha256() {
  local out
  out="$("${APKSIGNER:?APKSIGNER not set}" verify --print-certs "$1" 2>&1)" || { printf '%s\n' "$out" >&2; return 1; }
  out="$(grep -m1 -E 'Signer #1 certificate SHA-256 digest:' <<<"$out")" || { echo "no signer certificate in $1" >&2; return 1; }
  normalize_sha256 "${out##*:}"
}

signing_verify() {
  local apk="$1" got
  [ "${SIGNING_MODE:-none}" = release-key ] || return 0
  got="$(signer_sha256 "$apk")" || { echo "apksigner cannot verify $apk" >&2; return 1; }
  echo "signer SHA-256: $got"
  if [ -n "${HERMES_CERT_SHA256:-}" ] && [ "$got" != "$HERMES_CERT_SHA256" ]; then
    echo "SIGNER MISMATCH: expected HERMES_CERT_SHA256=$HERMES_CERT_SHA256 (wrong keystore or alias?)" >&2
    return 1
  fi
  [ -z "${HERMES_CERT_SHA256:-}" ] || echo "signer matches HERMES_CERT_SHA256"
}
