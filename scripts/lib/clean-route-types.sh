#!/usr/bin/env bash
# Remove the generated expo-router types (app/.expo/types, git-ignored, written by `expo start`). A copy made before routes
# were added, renamed or removed breaks `tsc` ("Argument of type … is not assignable to … Href"), which is how the 0.2.0
# release run stopped. tsc does not need them (the fresh checkout of --host runs has none); Expo writes them again.
#   scripts/lib/clean-route-types.sh [<app dir>]      (default: the app/ next to scripts/)
set -euo pipefail
APP="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../app" && pwd)}"
[ -d "$APP" ] || { echo "clean-route-types: no app dir $APP" >&2; exit 2; }
if [ -d "$APP/.expo/types" ]; then
  rm -rf "$APP/.expo/types"
  echo "clean-route-types: removed stale generated types in $APP/.expo/types" >&2
fi
