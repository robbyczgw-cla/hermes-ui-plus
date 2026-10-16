# shellcheck shell=bash
# JS fast path for test APKs (scripts/build-apk-fast.sh, scripts/lib/apk-fast.mjs, docs/BUILD.md "Fast test APKs").
# Needs FLAVOR (flavor_init), ROOT and scripts/lib/hostmem.sh (sha256_stdin: sha256sum or shasum). Sets:
#   FAST_BASES  base cache, one dir per native fingerprint (HUI_FAST_BASES, default ~/builds/apk-bases)
#   fast_key APP_DIR ABIS          print the cache key of APP_DIR's native fingerprint; fails when it is unknown
#   fast_register APK APP_DIR VARIANT BUILD_NUMBER KEY_FILE
#                                  scripts/build-apk.sh: store a finished debug-signed release APK as the base for the key
#                                  in KEY_FILE (fast_key of the build input, taken before `expo prebuild` rewrites
#                                  package.json; APP_DIR = the Gradle build copy, which holds the generated JS output)
FAST_BASES="${HUI_FAST_BASES:-$HOME/builds/apk-bases}"

fast_key() {
  local app="$1" abis="$2" fp
  fp="$(ABIS="$abis" NODE_OPTIONS=--max-old-space-size=1024 node "$ROOT/scripts/lib/apk-fast.mjs" fingerprint "$app" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s).hash;if(!h)process.exit(1);process.stdout.write(h)})')" \
    || return 1
  node "$ROOT/scripts/lib/apk-fast.mjs" key "$FLAVOR" "$abis" "$fp"
}

fast_register() {
  local apk="$1" app="$2" variant="$3" number="$4" keyfile="$5" key sha
  key="$(cat "$keyfile" 2>/dev/null)" && [ -n "$key" ] || { echo "fast path: no native fingerprint of the build input"; return 1; }
  sha="$(unzip -p "$apk" assets/index.android.bundle | sha256_stdin | cut -d' ' -f1)"
  node "$ROOT/scripts/lib/apk-fast.mjs" register "$FAST_BASES" "$key" "$apk" "$app" "$variant" "$number" \
    "$app/android/app/debug.keystore" "$sha" >/dev/null || return 1
  echo "fast path: registered base $key (build $number)"
}
