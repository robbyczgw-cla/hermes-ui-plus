# shellcheck shell=bash
# Automatic Android lane selection (HUI_ANDROID_LANE=auto): build + emulator on the Mac, or build here + emulator on the
# Linux emulator host (E2E_HOST). Only for TEST builds and the smoke suite, never for release / store builds.
#
#   HUI_ANDROID_LANE   mac | local (alias: linux) | auto | unset
#       mac    always the Mac;   local  never the Mac;   auto  decide by the Mac's state (below)
#       unset  build-apk.sh: local unless --smoke is given (then auto); smoke.sh: auto by the APK's ABI (below)
#   An explicit --host / E2E_HOST flag always wins over the lane.
#
# The Mac is preferred when ALL hold (every value is probed over ssh in one short call, scripts/lib/maclock.sh status etc.):
#   the Mac's heavy-job lock is free        no xcodebuild running          no booted iOS simulator
#   available memory >= HUI_LANE_MIN_AVAIL_MB [4096]   not swapping hard: page-outs <= HUI_LANE_MAX_PAGEOUTS [50] per s
#                                              and swap used <= HUI_LANE_MAX_SWAP_PCT [90] % of the swap file
#   free disk >= HUI_LANE_MIN_DISK_GB [8]      CPU_Speed_Limit >= HUI_LANE_MIN_SPEED [80] (no thermal throttling)
#   the Android SDK is installed (/Users/Shared/hiui-android-sdk, or the old /var/tmp one the next build moves there)
# Otherwise: build here (ABIS=x86_64) + emulator on E2E_HOST. The decision and its reason are printed ("lane: …").
#
#   lane_decide_mac            pure: reads MAC_LOCK ("free" or text) MAC_XCODEBUILD MAC_BOOTED MAC_AVAIL_MB MAC_SWAP_USED_MB
#                              MAC_SWAP_TOTAL_MB MAC_PAGEOUTS_S MAC_DISK_GB MAC_SPEED_LIMIT MAC_SDK (1 = installed, unset = unknown);
#                              sets LANE_CHOICE (mac|local), LANE_REASON
#   lane_probe_mac HOST        ssh probe; sets those MAC_* variables (returns 1 when the Mac is unreachable)
#   lane_auto HOST             probe + decide + print; sets LANE_CHOICE / LANE_REASON
#   lane_for_apk APK           smoke.sh: ABI rule for a local APK file -> LANE_CHOICE / LANE_REASON (mac needs arm64-v8a, the
#                              Linux emulator host needs x86_64; both present: the Mac if lane_auto says so)

lane_decide_mac() {
  local why=""
  if [ "${MAC_LOCK:-free}" != free ]; then why="the Mac's heavy-job lock is taken (${MAC_LOCK})"
  elif [ "${MAC_SDK:-1}" = 0 ]; then why="the Android SDK is missing on the Mac (/Users/Shared/hiui-android-sdk; docs/BUILD.md has the sdkmanager line)"
  elif [ "${MAC_XCODEBUILD:-0}" -gt 0 ]; then why="xcodebuild is running on the Mac"
  elif [ "${MAC_BOOTED:-0}" -gt 0 ]; then why="${MAC_BOOTED} iOS simulator(s) are booted on the Mac"
  elif [ "${MAC_AVAIL_MB:-0}" -lt "${HUI_LANE_MIN_AVAIL_MB:-4096}" ]; then why="only ${MAC_AVAIL_MB:-0} MB available on the Mac (< ${HUI_LANE_MIN_AVAIL_MB:-4096})"
  elif [ "${MAC_PAGEOUTS_S:-0}" -gt "${HUI_LANE_MAX_PAGEOUTS:-50}" ]; then why="the Mac is swapping hard (${MAC_PAGEOUTS_S} page-outs/s)"
  elif [ "${MAC_SWAP_TOTAL_MB:-0}" -gt 0 ] && [ $(( ${MAC_SWAP_USED_MB:-0} * 100 / MAC_SWAP_TOTAL_MB )) -gt "${HUI_LANE_MAX_SWAP_PCT:-90}" ]; then
    why="the Mac's swap is ${MAC_SWAP_USED_MB}/${MAC_SWAP_TOTAL_MB} MB full"
  elif [ "${MAC_DISK_GB:-0}" -lt "${HUI_LANE_MIN_DISK_GB:-8}" ]; then why="only ${MAC_DISK_GB:-0} GB free disk on the Mac (< ${HUI_LANE_MIN_DISK_GB:-8})"
  elif [ "${MAC_SPEED_LIMIT:-100}" -lt "${HUI_LANE_MIN_SPEED:-80}" ]; then why="the Mac is thermally throttled (CPU_Speed_Limit ${MAC_SPEED_LIMIT})"
  fi
  if [ -n "$why" ]; then LANE_CHOICE=local; LANE_REASON="$why"
  else
    LANE_CHOICE=mac
    LANE_REASON="the Mac is idle: lock free, ${MAC_AVAIL_MB} MB available, ${MAC_PAGEOUTS_S:-0} page-outs/s, ${MAC_DISK_GB} GB disk free, speed limit ${MAC_SPEED_LIMIT:-100}"
  fi
}

lane_probe_mac() { # lane_probe_mac HOST [LANE_DIR]
  local host="$1" lane="${2:-${HUI_LANE_HOME:-hui-lane}}" out k v
  local libdir; libdir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # the lock library travels along (3 kB) so that a lock left by a dead process counts as free
  ssh -o BatchMode=yes -o ConnectTimeout=6 "$host" "mkdir -p '$lane' && cat > '$lane/maclock.sh'" < "$libdir/maclock.sh" 2>/dev/null || return 1
  out="$(ssh -o BatchMode=yes -o ConnectTimeout=6 "$host" "bash -s" 2>/dev/null <<PROBE
. "\$HOME/$lane/maclock.sh"
echo "MAC_LOCK=\$(maclock_status | tr ' ' '_')"
echo "MAC_XCODEBUILD=\$(ps -axo comm | grep -c '/xcodebuild\$')"
echo "MAC_BOOTED=\$(xcrun simctl list devices booted 2>/dev/null | grep -c Booted)"
echo "MAC_AVAIL_MB=\$(vm_stat | awk '/page size of/ { ps = \$8 } /^Pages (free|inactive|speculative|purgeable):/ { gsub("\\\\.", "", \$NF); n += \$NF } END { printf "%d", n * ps / 1048576 }')"
read -r total used < <(sysctl -n vm.swapusage | awk '{ gsub("M", "", \$3); gsub("M", "", \$6); printf "%d %d\n", \$3, \$6 }')
echo "MAC_SWAP_TOTAL_MB=\$total"; echo "MAC_SWAP_USED_MB=\$used"
po1=\$(vm_stat | awk '/Pageouts/ { gsub("\\\\.", "", \$2); print \$2 }'); sleep 2
po2=\$(vm_stat | awk '/Pageouts/ { gsub("\\\\.", "", \$2); print \$2 }')
echo "MAC_PAGEOUTS_S=\$(( (po2 - po1) / 2 ))"
echo "MAC_DISK_GB=\$(df -g /Users/Shared | awk 'NR==2 { print \$4 }')"
if [ -d /Users/Shared/hiui-android-sdk/platforms/android-36 ] || [ -d /var/tmp/hiui-android-sdk/platforms/android-36 ]; then echo MAC_SDK=1; else echo MAC_SDK=0; fi
echo "MAC_SPEED_LIMIT=\$(pmset -g therm 2>/dev/null | awk '/CPU_Speed_Limit/ { print \$NF }')"
PROBE
)" || return 1
  [ -n "$out" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in MAC_LOCK|MAC_XCODEBUILD|MAC_BOOTED|MAC_AVAIL_MB|MAC_SWAP_TOTAL_MB|MAC_SWAP_USED_MB|MAC_PAGEOUTS_S|MAC_DISK_GB|MAC_SPEED_LIMIT|MAC_SDK)
      case "$k" in MAC_LOCK) printf -v "$k" '%s' "${v//_/ }" ;; *) [[ "$v" =~ ^[0-9]+$ ]] && printf -v "$k" '%s' "$v" || printf -v "$k" '%s' 0 ;; esac ;;
    esac
  done <<<"$out"
  MAC_SPEED_LIMIT="${MAC_SPEED_LIMIT:-100}"; [ "$MAC_SPEED_LIMIT" != 0 ] || MAC_SPEED_LIMIT=100
  return 0
}

lane_auto() { # lane_auto HOST
  if lane_probe_mac "$1"; then lane_decide_mac
  else LANE_CHOICE=local; LANE_REASON="the Mac is not reachable over ssh"; fi
  echo "lane: auto -> $LANE_CHOICE: $LANE_REASON"
}

lane_for_apk() { # lane_for_apk APK MAC_HOST_OR_EMPTY
  local apk="$1" mac="${2:-}" n_arm n_x86
  n_arm="$(unzip -l "$apk" 2>/dev/null | grep -c ' lib/arm64-v8a/' || true)"
  n_x86="$(unzip -l "$apk" 2>/dev/null | grep -c ' lib/x86_64/' || true)"
  if [ "$n_arm" -gt 0 ] && [ "$n_x86" -eq 0 ]; then
    LANE_CHOICE=mac; LANE_REASON="the APK is arm64-v8a only (the Linux emulator host is x86_64)"
  elif [ "$n_x86" -gt 0 ] && [ "$n_arm" -eq 0 ]; then
    LANE_CHOICE=local; LANE_REASON="the APK is x86_64 only (the Mac runs an arm64 emulator)"
  elif [ -n "$mac" ]; then lane_auto "$mac"; return 0
  else LANE_CHOICE=local; LANE_REASON="no Mac configured"; fi
  echo "lane: auto -> $LANE_CHOICE: $LANE_REASON"
}

# lane_resolve_build DEFAULT_MODE SMOKE TEST_BUILD   the one place that turns HUI_ANDROID_LANE into a lane for a BUILD
#   DEFAULT_MODE  the mode when HUI_ANDROID_LANE is unset: "" (scripts/build-apk.sh: local, but auto together with --smoke) or
#                 auto (scripts/build-apk-fast.sh: always a test build)
#   TEST_BUILD    1 for debug / debug-signed builds; auto never applies to a release / store build (0)
# Sets LANE_CHOICE (mac|local); returns 2 for an invalid HUI_ANDROID_LANE. Needs android_resolve_host (android-remote.sh).
lane_resolve_build() {
  local mode="${HUI_ANDROID_LANE:-$1}" smoke="${2:-0}" test="${3:-0}" mac
  case "$mode" in ''|auto|mac|local|linux) ;; *) echo "HUI_ANDROID_LANE must be mac, local or auto (got '$mode')" >&2; return 2 ;; esac
  [ -n "$mode" ] || [ "$smoke" != 1 ] || mode=auto
  LANE_CHOICE=local
  case "$mode" in
    mac) LANE_CHOICE=mac ;;
    auto)
      if [ "$test" != 1 ]; then
        echo "lane: auto -> local: this is a release / store build (the Mac lane is for test builds only)"
      elif [ "${ABIS:-arm64-v8a}" != arm64-v8a ]; then
        echo "lane: auto -> local: ABIS=${ABIS} (the Mac lane builds arm64-v8a only)"
      elif mac="$(android_resolve_host mac 2>/dev/null)"; then
        lane_auto "$mac"
      else
        echo "lane: auto -> local: no MAC_HOST configured"
      fi ;;
  esac
  return 0
}
