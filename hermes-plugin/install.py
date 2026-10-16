#!/usr/bin/env python3
"""Install the hermes-ui-plus plugin into a Hermes home (stdlib only).

    python3 hermes-plugin/install.py [--hermes-home DIR] [--copy] [--group-readable-secret]

1. Links (default) or copies hermes_ui_plus/ to HERMES_HOME/plugins/hermes-ui-plus.
2. Generates the bridge<->plugin secret at HERMES_HOME/hermes-ui-plus/secret (0600; 0640 with
   --group-readable-secret for a bridge running as another user in the file's group). Never overwrites.
3. Prints the remaining steps (enable the plugin, restart the gateway, point the bridge at the secret).

It does not edit config.yaml, does not touch services and never prints the secret.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from hermes_ui_plus.config import DEFAULT_PORT, PLUGIN_NAME  # noqa: E402
from hermes_ui_plus.secret import create_secret, default_secret_path  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--hermes-home", default=os.environ.get("HERMES_HOME") or str(Path.home() / ".hermes"))
    ap.add_argument("--copy", action="store_true", help="copy instead of symlink")
    ap.add_argument("--group-readable-secret", action="store_true")
    args = ap.parse_args(argv)

    home = Path(args.hermes_home).expanduser()
    if not home.is_dir():
        print(f"Hermes home not found: {home}", file=sys.stderr)
        return 1
    src = HERE / "hermes_ui_plus"
    dest = home / "plugins" / PLUGIN_NAME
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink() or dest.exists():
        print(f"plugin path exists, leaving it: {dest}")
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
