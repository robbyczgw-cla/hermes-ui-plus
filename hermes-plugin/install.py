#!/usr/bin/env python3
"""Install the hermes-ui-plus plugin into a Hermes home (stdlib only).

    python3 hermes-plugin/install.py [--hermes-home DIR] [--copy] [--force] [--group-readable-secret]

1. Links (default) or copies hermes_ui_plus/ to HERMES_HOME/plugins/hermes-ui-plus. An existing copy is
   updated when its manifest version or content differs (old copy kept as
   <home>/hermes-ui-plus/backup-<old version>, swapped in with renames); same version and content = no-op; a newer
   installed version is kept unless --force; a symlinked install is never touched.
2. Generates the bridge<->plugin secret at HERMES_HOME/hermes-ui-plus/secret (0600; 0640 with
   --group-readable-secret for a bridge running as another user in the file's group). Never overwrites.
3. Prints the remaining steps (enable the plugin, restart the gateway, point the bridge at the secret).

It does not edit config.yaml, does not touch services and never prints the secret.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hermes_ui_plus.config import DEFAULT_PORT, PLUGIN_NAME  # noqa: E402
from hermes_ui_plus.secret import create_secret, default_secret_path  # noqa: E402


def _version(plugin_dir: Path) -> str | None:
    try:
        text = (plugin_dir / "plugin.yaml").read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r'^version:\s*["\']?([^"\'\s#]+)', text, re.M)
    return m.group(1) if m else None


def _vkey(version: str | None) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", version or ""))


def _digest(plugin_dir: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(plugin_dir.rglob("*")):
        if f.is_file() and "__pycache__" not in f.parts:
            h.update(f.relative_to(plugin_dir).as_posix().encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()


def _copy(src: Path, dest: Path) -> None:
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__"))


def update_copy(src: Path, dest: Path, store: Path, force: bool = False) -> None:
    """Bring an existing (non-symlink) installed copy up to date; never touches Hermes config."""
    new_v, old_v = _version(src), _version(dest)
    old_label = old_v or "unknown"
    if _digest(src) == _digest(dest):
        print(f"plugin already up to date ({new_v}): {dest}")
        return
    if old_v and new_v and _vkey(old_v) > _vkey(new_v) and not force:
        print(f"installed plugin {old_v} is newer than this installer's {new_v}; kept (use --force to replace): {dest}")
        return
    # Backup and staging live in the plugin's own state dir, not under plugins/: Hermes scans plugins/*
    # and a second copy there could register the plugin twice. Same Hermes home = same filesystem.
    store.mkdir(parents=True, exist_ok=True)
    backup = store / f"backup-{old_label}"
    n = 1
    while backup.exists() or backup.is_symlink():
        n += 1
        backup = store / f"backup-{old_label}-{n}"
    stage = store / "staging"
    if stage.exists():
        shutil.rmtree(stage)
    _copy(src, stage)
    os.rename(dest, backup)
    try:
        os.rename(stage, dest)
    except OSError:
        os.rename(backup, dest)
        raise
    if old_v == new_v:
        print(f"updated plugin {new_v} (files changed): {dest}")
    else:
        print(f"updated plugin {old_label} \u2192 {new_v}: {dest}")
    print(f"old copy kept as {backup}; remove it when the new one runs. Restart the Hermes gateway to load the new code.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hermes-home", default=os.environ.get("HERMES_HOME") or str(Path.home() / ".hermes"))
    ap.add_argument("--copy", action="store_true", help="copy instead of symlink")
    ap.add_argument("--force", action="store_true", help="replace a newer installed copy")
    ap.add_argument("--group-readable-secret", action="store_true")
    args = ap.parse_args(argv)

    home = Path(args.hermes_home).expanduser()
    if not home.is_dir():
        print(f"Hermes home not found: {home}", file=sys.stderr)
        return 1
    src = HERE / "hermes_ui_plus"
    dest = home / "plugins" / PLUGIN_NAME
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink():
        print(f"plugin is a symlink, leaving it: {dest} -> {os.readlink(dest)}")
        print("  (a linked install follows the repo; update it with git pull. Remove the link and re-run with --copy to switch.)")
    elif dest.exists():
        if not dest.is_dir():
            print(f"plugin path exists but is not a directory, leaving it: {dest}", file=sys.stderr)
            return 1
        update_copy(src, dest, default_secret_path(home).parent, args.force)
    elif args.copy:
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("__pycache__"))
        print(f"copied plugin to {dest}")
    else:
        dest.symlink_to(src, target_is_directory=True)
        print(f"linked {dest} -> {src}")

    secret_path = default_secret_path(home)
    if create_secret(secret_path, group_readable=args.group_readable_secret):
        print(f"generated secret: {secret_path}")
    else:
        print(f"secret exists, kept: {secret_path}")

    print(f"""
Next steps (owner):
  1. back up config.yaml, .env and installs/ of this Hermes home, then add {PLUGIN_NAME} to plugins.enabled
     in config.yaml (not `hermes plugins enable`: it can switch the gateway to a new environment under installs/)
  2. restart the Hermes gateway and check that it still runs from its usual Python environment
  3. bridge env: BRIDGE_HERMES_PLUGIN_URL=http://127.0.0.1:{DEFAULT_PORT}
                 BRIDGE_HERMES_PLUGIN_SECRET_FILE={secret_path}
Kill switch: HERMES_UI_PLUS_DISABLE=1 in the gateway environment, then restart.""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
