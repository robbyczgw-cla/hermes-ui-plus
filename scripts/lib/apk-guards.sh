# shellcheck shell=bash
# Guards on a finished APK that no build script may skip.
#   apk_check_dev_server_ip APK AAPT2   fails when the APK carries a build-host address as React Native's dev server host.
# React Native's Gradle plugin writes the first up, non-loopback IPv4 address of the BUILD HOST into the app as the string
# resource react_native_dev_server_ip (AgpConfiguratorUtils.getHostIpAddress): the Docker bridge on the Linux host, the tailnet
# address on the Mac. scripts/build-apk.sh pins it with reactNativeDevServerIp=localhost; this check proves the result for the
# APK that actually ships, whatever the Gradle properties said. Allowed: localhost and loopback.
apk_check_dev_server_ip() {
  local apk="$1" aapt2="$2" dump v
  dump="$("$aapt2" dump resources "$apk" 2>&1)" || { echo "apk guard: aapt2 cannot read $apk" >&2; return 1; }
  v="$(awk '/string\/react_native_dev_server_ip/ { f = 1; next } f && /"/ { match($0, /"[^"]*"/); print substr($0, RSTART + 1, RLENGTH - 2); exit }' <<<"$dump")"
  case "$v" in
    ''|localhost|127.*) return 0 ;;
  esac
  echo "apk guard: the APK carries a build-host address as its React Native dev server ('$v'): react_native_dev_server_ip must be localhost" \
    "(reactNativeDevServerIp in android/gradle.properties, see scripts/build-apk.sh)" >&2
  return 1
}
