#!/usr/bin/env bash
# One-time setup of the throwaway Hermes test instance on THIS host (no sudo, nothing listens publicly).
#   scripts/test-instance/setup.sh [--force-config]
# docker flavor (Linux): needs docker (user in the docker group), node >= 22, npm, python3, systemd user session, openssl.
# native flavor (macOS): needs git, python3.14 (Homebrew), node >= 22, npm, openssl. Hermes comes from a pinned git
#   checkout in $TI_DIR/hermes-agent and its own venv in $TI_DIR/venv; nothing is written outside $TI_DIR.
# Before: put the model key into $TI_DIR/secrets/anthropic.env (one line ANTHROPIC_API_KEY=..., mode 600), see README.
# Re-runnable: keeps existing keys, data and sessions; --force-config rewrites the config files it owns.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
REPO="$(cd "$here/../.." && pwd)"
FORCE=0
[ "${1:-}" = "--force-config" ] && FORCE=1

if [ "$TI_FLAVOR" = docker ]; then
  command -v docker >/dev/null || die "docker missing"
else
  command -v git >/dev/null || die "git missing"
  command -v python3.14 >/dev/null || die "python3.14 missing (brew install python@3.14)"
fi
command -v openssl >/dev/null || die "openssl missing"
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "node >= 22 missing"
command -v python3 >/dev/null || die "python3 missing"
[ -d "$REPO/bridge/src" ] && [ -d "$REPO/hermes-plugin/hermes_ui_plus" ] || die "run from a repo copy (bridge/ + hermes-plugin/ next to scripts/)"
heavy_running && die "an emulator or Gradle runs on this host; run the setup when it is idle"
[ "$(mem_avail_gb)" -ge 4 ] || die "less than 4 GB available"
mac_heavy_check

umask 077
mkdir -p "$TI_DATA" "$TI_SECRETS" "$TI_SRC" "$TI_BRIDGE_STATE" "$TI_RUN"
chmod 700 "$TI_DIR" "$TI_SECRETS" "$TI_BRIDGE_STATE" "$TI_RUN"

ANTHROPIC_ENV="$TI_SECRETS/anthropic.env"
[ -f "$ANTHROPIC_ENV" ] || die "$ANTHROPIC_ENV missing (one line ANTHROPIC_API_KEY=...)"
chmod 600 "$ANTHROPIC_ENV"
grep -q '^ANTHROPIC_API_KEY=.' "$ANTHROPIC_ENV" || die "$ANTHROPIC_ENV has no ANTHROPIC_API_KEY="
anthropic_line="$(grep -m1 '^ANTHROPIC_API_KEY=' "$ANTHROPIC_ENV")"

# One API_SERVER_KEY for the default profile, every test profile and the bridge (Hermes v0.22: a named profile
# authenticates /p/<name>/ with the API_SERVER_KEY of ITS OWN .env and fails closed without one).
KEY_FILE="$TI_SECRETS/api_server_key"
[ -s "$KEY_FILE" ] || { openssl rand -hex 32 > "$KEY_FILE"; say "generated $KEY_FILE"; }
chmod 600 "$KEY_FILE"
api_key="$(cat "$KEY_FILE")"

if [ "$TI_FLAVOR" = docker ]; then
  say "pulling $TI_IMAGE"
  docker pull -q "$TI_IMAGE" >/dev/null
else
  # --- Hermes from the pinned commit of the release tag, own venv (pip, no pm/setup-hermes.sh: that one writes to
  # ~/.local/bin and the shell rc files) -----------------------------------------------------------------------------
  if [ ! -d "$TI_HERMES_SRC/.git" ]; then git init -q "$TI_HERMES_SRC"; fi
  if [ "$(git -C "$TI_HERMES_SRC" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$TI_HERMES_COMMIT" ]; then
    say "fetching $TI_HERMES_TAG ($TI_HERMES_COMMIT)"
    git -C "$TI_HERMES_SRC" fetch -q --depth 1 "$TI_HERMES_REPO" "$TI_HERMES_COMMIT"
    git -C "$TI_HERMES_SRC" checkout -q --detach FETCH_HEAD
  fi
  [ "$(git -C "$TI_HERMES_SRC" rev-parse HEAD)" = "$TI_HERMES_COMMIT" ] || die "checkout is not $TI_HERMES_COMMIT"
  stamp="$TI_VENV/.ti-installed"
  if [ ! -x "$TI_VENV/bin/hermes" ] || [ "$(cat "$stamp" 2>/dev/null)" != "$TI_HERMES_COMMIT $TI_HERMES_EXTRAS" ]; then
    say "installing Hermes into $TI_VENV (extras: $TI_HERMES_EXTRAS)"
    python3.14 -m venv "$TI_VENV"
    # aiohttp: the API server platform; the bulk `messaging` extra (Telegram/Discord/Slack) is not needed
    PIP_CACHE_DIR="$TI_DIR/pip-cache" PIP_DISABLE_PIP_VERSION_CHECK=1 nice "$TI_VENV/bin/pip" install -q \
      -e "$TI_HERMES_SRC[$TI_HERMES_EXTRAS]" aiohttp==3.14.3
    printf '%s %s\n' "$TI_HERMES_COMMIT" "$TI_HERMES_EXTRAS" > "$stamp"
  fi
  say "Hermes: $(hermes_oneoff --version 2>&1 | head -1)"
fi

# --- default profile ---------------------------------------------------------------------------------------------
write_file() { # path (only when missing or --force-config), content on stdin
  if [ -e "$1" ] && [ "$FORCE" = 0 ]; then cat >/dev/null; say "kept $1"; return; fi
  cat > "$1"; chmod 600 "$1"; say "wrote $1"
}

write_file "$TI_DATA/config.yaml" <<EOF
# Throwaway HUI+ test instance (scripts/test-instance). Cheap model, no dangerous tools.
model:
  provider: anthropic
  default: $TI_MODEL
gateway:
  # explicit: inside the s6 image the implicit default may stay standalone
  multiplex_profiles: true
# API clients get the todo list only: no terminal, files, code, browser, web, memory or delegation
platform_toolsets:
  api_server: [todo]
auxiliary:
  title_generation: {provider: anthropic, model: $TI_MODEL}
  compression: {provider: anthropic, model: $TI_MODEL}
  hui_quick: {provider: anthropic, model: $TI_QUICK_MODEL}
# Plugins are enabled HERE, never with \`hermes plugins enable\` (that can make Hermes' package manager build and
# switch to a new environment under installs/).
plugins:
  enabled: [hermes-ui-plus]
  entries:
    hermes-ui-plus:
      settings:
        server: {port: $TI_PLUGIN_PORT}
        quick: {max_tokens: 400}
telemetry:
  shared_metrics: {enabled: false, send: false}
updates:
  check: false
EOF

write_file "$TI_DATA/.env" <<EOF
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=$TI_API_PORT
API_SERVER_KEY=$api_key
$anthropic_line
EOF

# --- profile "writer" (own model and personality) -------------------------------------------------------------------
W="$TI_DATA/profiles/writer"
if [ ! -d "$W" ]; then
  say "creating profile writer (hermes profile create)"
  hermes_oneoff profile create writer --no-alias --no-skills > "$TI_DIR/profile-create.log" 2>&1 \
    || { tail -20 "$TI_DIR/profile-create.log" >&2; die "hermes profile create failed"; }
  FORCE_SAVED=$FORCE; FORCE=1 # replace the files Hermes just created
fi
[ -d "$W" ] || die "profile writer was not created"
write_file "$W/config.yaml" <<EOF
model:
  provider: anthropic
  default: $TI_WRITER_MODEL
platform_toolsets:
  api_server: [todo]
auxiliary:
  title_generation: {provider: anthropic, model: $TI_WRITER_MODEL}
  compression: {provider: anthropic, model: $TI_WRITER_MODEL}
telemetry:
  shared_metrics: {enabled: false, send: false}
updates:
  check: false
EOF
# its own .env: the SAME API_SERVER_KEY as the default profile and the bridge, plus its own model key
write_file "$W/.env" <<EOF
API_SERVER_KEY=$api_key
$anthropic_line
EOF
write_file "$W/SOUL.md" <<'EOF'
You are Quill, a writing assistant with a dry, slightly poetic voice.
Keep every answer short (at most four sentences).
End every answer with the signature line: — Quill
EOF
FORCE=${FORCE_SAVED:-$FORCE}

# --- hermes-ui-plus plugin (copy, the container cannot follow a symlink into the repo) --------------------------------
rm -rf "$TI_SRC/hermes-plugin"
cp -a "$REPO/hermes-plugin" "$TI_SRC/hermes-plugin"
find "$TI_SRC/hermes-plugin" -name __pycache__ -prune -exec rm -rf {} +
rm -rf "$TI_DATA/plugins/hermes-ui-plus"
"${TI_PY3:-python3}" "$TI_SRC/hermes-plugin/install.py" --hermes-home "$TI_DATA" --copy >/dev/null
[ -f "$TI_DATA/hermes-ui-plus/secret" ] || die "plugin secret missing"
say "plugin installed (enabled via plugins.enabled in config.yaml)"

# --- bridge (repo copy, production deps only, memory-capped install) --------------------------------------------------
rm -rf "$TI_SRC/bridge"
mkdir -p "$TI_SRC/bridge"
tar -C "$REPO/bridge" --exclude=node_modules --exclude=eval -cf - . | tar -C "$TI_SRC/bridge" -xf -
# the bridge reads the skill bootstrap message from ../hermes-skill (source checkout layout)
rm -rf "$TI_SRC/hermes-skill"
cp -a "$REPO/hermes-skill" "$TI_SRC/hermes-skill"
user_bus
if [ "$TI_FLAVOR" = docker ]; then
  systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 \
    npm --prefix "$TI_SRC/bridge" ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
else
  nice npm --prefix "$TI_SRC/bridge" ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
fi
say "bridge installed in $TI_SRC/bridge"

write_file "$TI_BRIDGE_ENV" <<EOF
HERMES_BASE_URL=http://127.0.0.1:$TI_API_PORT
HERMES_API_KEY=$api_key
BRIDGE_HOST=127.0.0.1
BRIDGE_PORT=$TI_BRIDGE_PORT
BRIDGE_NAME=Hermes test
# the Android emulator on this host reaches 127.0.0.1 as 10.0.2.2 (from another machine: ssh tunnel, see README)
BRIDGE_PUBLIC_URL=http://10.0.2.2:$TI_BRIDGE_PORT
BRIDGE_STATE_DIR=$TI_BRIDGE_STATE
# explicit list (a hardened service cannot read the Hermes home for "auto")
BRIDGE_PROFILES=writer=Writer
BRIDGE_HERMES_PLUGIN_URL=http://127.0.0.1:$TI_PLUGIN_PORT
# BRIDGE_HERMES_PLUGIN_SECRET_FILE is set by start.sh (docker: systemd's LoadCredential, \$CREDENTIALS_DIRECTORY;
# native: the secret file path), so the bridge needs no access to the Hermes home
BRIDGE_QUICK_RATE=5
BRIDGE_QUICK_DAILY=60
ROUTER_BACKEND=heuristic
EOF

say "setup done. Start with: $here/start.sh"
