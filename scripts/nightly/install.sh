#!/usr/bin/env bash
# Installs the nightly fast-path cross-check as a systemd --user timer (03:30 local) on this host.
#   scripts/nightly/install.sh [--uninstall]
# Copies the harness (script, helper module, apk_swap.py) to ~/.local/share/hui-nightly so the timer keeps working when the
# worktree goes away; run it again to update. Records the source URLs of this clone's remotes "origin" (primary) and
# "forgejo" (fallback) in remotes.env; URLs that carry credentials are refused. See docs/BUILD.md "Nightly cross-check".
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS="${HUI_NIGHTLY_HARNESS:-$HOME/.local/share/hui-nightly}"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PRIVATE="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

if [ "${1:-}" = --uninstall ]; then
  systemctl --user disable --now hui-nightly-fastpath.timer 2>/dev/null || true
  rm -f "$UNITS/hui-nightly-fastpath.service" "$UNITS/hui-nightly-fastpath.timer"
  systemctl --user daemon-reload
  echo "removed the timer (harness $HARNESS and ~/builds/nightly left in place)"; exit 0
fi

command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 || { echo "systemd --user not usable here"; exit 1; }
for t in node python3 flock git rsync unzip; do command -v "$t" >/dev/null || { echo "$t missing"; exit 1; }; done

primary="$(git -C "$ROOT" remote get-url origin)"
# fallback: the GitHub mirror when origin is Forgejo, else the forgejo remote (older checkouts with GitHub as origin)
fallback="$(git -C "$ROOT" remote get-url github 2>/dev/null || git -C "$ROOT" remote get-url forgejo 2>/dev/null || true)"
[ "$fallback" = "$primary" ] && fallback=""
for u in "$primary" "$fallback"; do
  case "$u" in *://*@*) echo "a remote URL carries credentials; use a credential helper instead"; exit 1 ;; esac
done

mkdir -p "$HARNESS" "$UNITS" "$PRIVATE/reports/nightly"
install -m 755 "$ROOT/scripts/nightly/nightly-fastpath-check.sh" "$HARNESS/"
install -m 644 "$ROOT/scripts/lib/nightly-crosscheck.mjs" "$ROOT/scripts/lib/apk_swap.py" "$HARNESS/"
printf 'HUI_NIGHTLY_REMOTES=%s %s\n' "$primary" "$fallback" > "$HARNESS/remotes.env"
for u in service timer; do
  sed -e "s#@HARNESS_DIR@#$HARNESS#g" -e "s#@PATH@#$PATH#g" -e "s#@PRIVATE_DIR@#$PRIVATE#g" \
    "$ROOT/scripts/nightly/hui-nightly-fastpath.$u.in" > "$UNITS/hui-nightly-fastpath.$u"
done
systemd-analyze --user verify "$UNITS/hui-nightly-fastpath.service" "$UNITS/hui-nightly-fastpath.timer"
systemctl --user daemon-reload
systemctl --user enable --now hui-nightly-fastpath.timer
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
  echo "NOTE: lingering is off, the timer only fires while you are logged in: loginctl enable-linger $USER"
fi
systemctl --user list-timers hui-nightly-fastpath.timer --no-pager
echo "installed. Run once now: systemctl --user start hui-nightly-fastpath.service (follow: journalctl --user -u hui-nightly-fastpath -f)"
