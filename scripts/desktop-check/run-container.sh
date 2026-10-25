#!/usr/bin/env bash
# Inside the desktop-check container (linux.sh starts it): trust the throwaway test CA, TLS in front of the bridge
# (the desktop app's CSP allows only https: servers), Xvfb, WebKitWebDriver, then pair-check.mjs.
set -euo pipefail
cp /tls/ca.crt /usr/local/share/ca-certificates/hui-desktop-check-ca.crt && update-ca-certificates >/dev/null 2>&1
export HOME=/tmp/fresh-home XDG_CONFIG_HOME=/tmp/fresh-home/.config XDG_DATA_HOME=/tmp/fresh-home/.local/share
mkdir -p "$HOME"   # fresh install: no app data, no settings
socat "openssl-listen:${TLS_PORT},fork,reuseaddr,bind=127.0.0.1,cert=/tls/server.pem,verify=0" "tcp:127.0.0.1:${BRIDGE_PORT}" &
Xvfb :99 -screen 0 1280x860x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
sleep 1
TAURI_WEBVIEW_AUTOMATION=true WEBKIT_DISABLE_COMPOSITING_MODE=1 WebKitWebDriver --port=4445 >/out/webdriver.log 2>&1 &
for _ in $(seq 1 50); do curl -sf http://127.0.0.1:4445/status >/dev/null 2>&1 && break; sleep 0.2; done 2>/dev/null || true
/node/bin/node /check/pair-check.mjs --app /app/usr/bin/hermes-ui-plus --link-file /tls/pair-link.txt --out /out ${PAIR_CHECK_ARGS:-}
