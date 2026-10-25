#!/usr/bin/env bash
# Desktop pairing check on a Linux host (docs/RELEASING.md "Every platform: install, pair, chat"): the Linux desktop
# app as users get it (an AppImage, fresh HOME), a bridge set up by the default setup wizard (`setup --yes`, nothing
# about CORS), pair by pasting the wizard's link, one chat turn. Real window in Xvfb, driven via WebDriver.
#
# usage (on the Linux host, Hermes API reachable on this host, e.g. inside `ti.sh --host linux hold --start -- …`):
#   scripts/desktop-check/linux.sh --appimage FILE --hermes-home DIR [--out DIR] [--bridge-port 18791] [--tls-port 18443]
#     [--public-url URL|none]   default https://bridge.test:<tls-port>; `none` = no address (the wizard's 127.0.0.1 link)
# Needs: docker (image hui-desktop-check:22.04 from scripts/docker/desktop-check.Dockerfile, built when missing),
# openssl, Node 22 (NODE_DIR, default: the node on PATH), bridge/node_modules (npm ci). Exit 0 = PASS.
# Everything it creates lives in a temp dir (wizard HOME, env file, state dir, test CA) and is removed at the end;
# the Hermes home is only read (the wizard's skill step may update the hermes-ui skill there, like a real setup).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPIMAGE='' HERMES_HOME_DIR='' OUT='' BRIDGE_PORT=18791 TLS_PORT=18443 PUBLIC_URL=''
while [ $# -gt 0 ]; do
  case "$1" in
    --appimage) APPIMAGE=$(realpath "$2"); shift 2 ;;
    --hermes-home) HERMES_HOME_DIR=$(realpath "$2"); shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --bridge-port) BRIDGE_PORT=$2; shift 2 ;;
    --tls-port) TLS_PORT=$2; shift 2 ;;
    --public-url) PUBLIC_URL=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -f "$APPIMAGE" ] && [ -d "$HERMES_HOME_DIR" ] || { echo "usage: linux.sh --appimage FILE --hermes-home DIR [--out DIR]" >&2; exit 2; }
NODE_DIR=${NODE_DIR:-$(dirname "$(dirname "$(command -v node)")")}
IMAGE=hui-desktop-check:22.04
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hui-desktop-check.XXXXXX")
OUT=${OUT:-$WORK/out}; mkdir -p "$OUT"; OUT=$(realpath "$OUT")
BRIDGE_PID=''
cleanup() {
  [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null && wait "$BRIDGE_PID" 2>/dev/null
  [ "$OUT" = "$WORK/out" ] && cp -a "$OUT" "${TMPDIR:-/tmp}/hui-desktop-check-last" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" -f "$ROOT/scripts/docker/desktop-check.Dockerfile" "$ROOT/scripts/docker"

echo "== app: $(basename "$APPIMAGE") ($(sha256sum "$APPIMAGE" | cut -c1-16)…), extracted"
(cd "$WORK" && "$APPIMAGE" --appimage-extract >/dev/null)
BIN=$(find "$WORK/squashfs-root/usr/bin" -maxdepth 1 -type f -perm -u+x ! -name '*.so*' | head -1)

echo "== throwaway TLS (the app's CSP allows https: servers only): test CA + bridge.test"
mkdir -p "$WORK/tls" && cd "$WORK/tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=HUI desktop-check test CA" -keyout ca.key -out ca.crt \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=bridge.test" -keyout server.key -out server.csr 2>/dev/null
printf 'subjectAltName=DNS:bridge.test\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 1 -extfile ext.cnf -out server.crt 2>/dev/null
cat server.crt server.key > server.pem && chmod 600 server.pem ca.key server.key
cd "$ROOT"

PUBLIC_URL=${PUBLIC_URL:-https://bridge.test:$TLS_PORT}
URL_ARGS=(--public-url "$PUBLIC_URL"); [ "$PUBLIC_URL" = none ] && URL_ARGS=()
echo "== setup wizard, defaults (--yes), public address: $PUBLIC_URL"
export PATH="$NODE_DIR/bin:$PATH"
HOME="$WORK/home" XDG_CONFIG_HOME="$WORK/home/.config" XDG_STATE_HOME="$WORK/home/.local/state" \
  node bridge/bin/hermes-ui-bridge.mjs setup --json --service none --no-tailscale --hermes-home "$HERMES_HOME_DIR" \
  --port "$BRIDGE_PORT" "${URL_ARGS[@]}" > "$WORK/setup.json" 2> "$OUT/setup.log"
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!r.ok || !r.pair?.link) { console.error("setup failed:", r.error ?? "no pair link"); process.exit(1); }
  require("fs").writeFileSync(process.argv[2], r.pair.link + "\n", { mode: 0o600 });
  const keys = Object.keys(r.envFile.keys).filter((k) => /CORS|DESKTOP/.test(k));
  console.log(`   env file keys about CORS: ${keys.join(", ") || "none"}; origins: ${(r.network.corsOrigins ?? ["(not reported)"]).join(", ")}`);
  require("fs").writeFileSync(process.argv[3], r.service.argv.join("\0"));
' "$WORK/setup.json" "$WORK/tls/pair-link.txt" "$WORK/argv"
mapfile -d '' START < "$WORK/argv"

echo "== bridge, started with the command the wizard printed (service none)"
HOME="$WORK/home" "${START[@]}" > "$OUT/bridge.log" 2>&1 &
BRIDGE_PID=$!
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$BRIDGE_PORT/bridge/live" >/dev/null && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$BRIDGE_PORT/bridge/live" >/dev/null || { echo "bridge did not start"; tail -20 "$OUT/bridge.log"; exit 1; }
grep -E '^\s+origins' "$OUT/bridge.log" || true

echo "== app in Xvfb (container $IMAGE), WebDriver: paste link → Connect → one chat turn"
rc=0
docker run --rm --network host --add-host bridge.test:127.0.0.1 --memory 2g --memory-swap 2g --shm-size 256m \
  -e "BRIDGE_PORT=$BRIDGE_PORT" -e "TLS_PORT=$TLS_PORT" -e "PAIR_CHECK_ARGS=${PAIR_CHECK_ARGS:-}" \
  -v "$WORK/squashfs-root:/app:ro" -v "$NODE_DIR:/node:ro" -v "$ROOT/scripts/desktop-check:/check:ro" \
  -v "$WORK/tls:/tls:ro" -v "$OUT:/out" "$IMAGE" bash /check/run-container.sh || rc=$?
grep -E 'pair_redeem|"path":"/bridge/pair/redeem"' "$OUT/bridge.log" | tail -2 || true
echo "== result: $([ $rc -eq 0 ] && echo PASS || echo "FAIL ($rc)"), screenshots + steps.json in $OUT"
exit $rc
