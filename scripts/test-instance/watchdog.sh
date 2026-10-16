#!/usr/bin/env bash
# Memory cap of the native (macOS) flavor: kills the gateway or bridge process tree when its RSS passes the cap
# (TI_GATEWAY_MAX_MB, TI_BRIDGE_MAX_MB). Started and stopped by start.sh / stop.sh, tracked by pid file.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
watchdog_loop
