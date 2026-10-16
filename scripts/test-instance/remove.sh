#!/usr/bin/env bash
# Remove the test instance completely: stop it, delete $TI_DIR (Hermes home, keys, sessions, bridge state; native:
# also the Hermes checkout and venv) and, for the docker flavor, the image. Asks first unless --yes.
#   scripts/test-instance/remove.sh [--yes] [--keep-image]
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
yes=0; keep_image=0
for a in "$@"; do
  case "$a" in --yes) yes=1 ;; --keep-image) keep_image=1 ;; *) die "unknown option $a" ;; esac
done
if [ "$yes" = 0 ]; then
  read -r -p "Delete $TI_DIR and everything of the test instance? [y/N] " ok
  [ "$ok" = y ] || [ "$ok" = Y ] || { say "aborted"; exit 1; }
fi
TI_LOCK_OWNED=1 "$here/stop.sh" || true
if [ "$TI_FLAVOR" = docker ] && [ -d "$TI_DATA" ]; then
  # files in the Hermes home may belong to the container's remapped user: delete them from inside an image
  docker run --rm --entrypoint /bin/rm -v "$TI_DIR:/ti" "$TI_IMAGE" -rf /ti/data >/dev/null 2>&1 || true
fi
case "$TI_DIR" in "$HOME"/?*) rm -rf "$TI_DIR" ;; *) die "refusing to delete $TI_DIR (not below \$HOME)" ;; esac
tilock_is_session || tilock_release
if [ "$TI_FLAVOR" = docker ]; then
  [ "$keep_image" = 1 ] || docker rmi "$TI_IMAGE" >/dev/null 2>&1 || true
  say "removed $TI_DIR$([ "$keep_image" = 1 ] || echo ' and the image')"
else
  say "removed $TI_DIR"
fi
