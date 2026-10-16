#!/usr/bin/env bash
# Create a one-time pairing link for the app (device token, works once, expires in 1 hour) and write it to a file
# (mode 600) instead of the terminal: it is a credential.
#   scripts/test-instance/pair.sh [OUT_FILE] [LABEL]      default OUT_FILE: $TI_DIR/pair-link.txt
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
out="${1:-$TI_DIR/pair-link.txt}"
label="${2:-test-instance}"
umask 077
node "$TI_SRC/bridge/bin/hermes-ui-bridge.mjs" devices add "$label" --env-file "$TI_BRIDGE_ENV" 2>/dev/null \
  | grep -m1 -o 'hermesuiplus://pair?[^[:space:]]*' > "$out"
[ -s "$out" ] || die "no pairing link produced"
chmod 600 "$out"
say "one-time pairing link written to $out (open it on the emulator or paste it in the app)"
