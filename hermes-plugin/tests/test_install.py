"""install.py --copy: first install, update of an older copy, no-op, newer kept, symlink kept."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
INSTALL = PLUGIN / "install.py"
SRC = PLUGIN / "hermes_ui_plus"


def run(home: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(INSTALL), "--hermes-home", str(home), *extra],
                          capture_output=True, text=True, timeout=60)


def current_version() -> str:
    for line in (SRC / "plugin.yaml").read_text().splitlines():
        if line.startswith("version:"):
            return line.split(":", 1)[1].strip().strip('"')
    raise AssertionError("no version")


def manifest_version(home: Path) -> str:
    for line in (home / "plugins" / "hermes-ui-plus" / "plugin.yaml").read_text().splitlines():
        if line.startswith("version:"):
            return line.split(":", 1)[1].strip().strip('"')
    raise AssertionError("no version")


def old_copy(home: Path, version: str) -> Path:
    """An installed copy as an older release left it (older manifest, older code)."""
    dest = home / "plugins" / "hermes-ui-plus"
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("__pycache__"))
    (dest / "plugin.yaml").write_text((dest / "plugin.yaml").read_text().replace(
        f'version: "{current_version()}"', f'version: "{version}"'))
    (dest / "library.py").unlink(missing_ok=True)  # 0.1.x had no library/bots
    (dest / "bots.py").unlink(missing_ok=True)
    return dest


class InstallUpdate(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name) / "home"
        self.home.mkdir()
        self.addCleanup(self._tmp.cleanup)
        (self.home / "config.yaml").write_text("plugins:\n  enabled: []\n")

    def test_fresh_copy(self) -> None:
        r = run(self.home, "--copy")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("copied plugin", r.stdout)
        self.assertEqual(manifest_version(self.home), current_version())

    def test_repro_old_copy_is_updated(self) -> None:
        dest = old_copy(self.home, "0.1.1")
        r = run(self.home, "--copy")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"updated plugin 0.1.1 → {current_version()}", r.stdout)
        self.assertNotIn("leaving it", r.stdout)
        self.assertEqual(manifest_version(self.home), current_version())
        self.assertTrue((dest / "library.py").is_file())
        self.assertTrue((dest / "bots.py").is_file())
        backup = self.home / "hermes-ui-plus" / "backup-0.1.1"
        self.assertEqual((backup / "plugin.yaml").read_text().count('version: "0.1.1"'), 1)
        self.assertFalse((backup / "library.py").exists())
        # the backup is not under plugins/ (Hermes would see a second plugin there)
        self.assertEqual([p.name for p in (self.home / "plugins").iterdir()], ["hermes-ui-plus"])
        self.assertFalse((self.home / "hermes-ui-plus" / "staging").exists())

    def test_update_also_without_copy_flag(self) -> None:
        old_copy(self.home, "0.1.1")
        r = run(self.home)
        self.assertIn("updated plugin 0.1.1", r.stdout)
        self.assertEqual(manifest_version(self.home), current_version())

    def test_same_version_is_noop(self) -> None:
        self.assertEqual(run(self.home, "--copy").returncode, 0)
        r = run(self.home, "--copy")
        self.assertEqual(r.returncode, 0)
        self.assertIn("already up to date", r.stdout)
        self.assertFalse(any(p.name.startswith("backup-") for p in (self.home / "hermes-ui-plus").iterdir()))

    def test_same_version_changed_content_is_updated(self) -> None:
        self.assertEqual(run(self.home, "--copy").returncode, 0)
        edited = self.home / "plugins" / "hermes-ui-plus" / "quick.py"
        edited.write_text(edited.read_text() + "\n# local edit\n")
        r = run(self.home, "--copy")
        self.assertIn("files changed", r.stdout)
        self.assertNotIn("# local edit", edited.read_text())
        self.assertIn("# local edit", (self.home / "hermes-ui-plus" / f"backup-{current_version()}" / "quick.py").read_text())

    def test_newer_installed_is_kept_unless_forced(self) -> None:
        old_copy(self.home, "99.0.0")
        r = run(self.home, "--copy")
        self.assertEqual(r.returncode, 0)
        self.assertIn("newer", r.stdout)
        self.assertEqual(manifest_version(self.home), "99.0.0")
        r = run(self.home, "--copy", "--force")
        self.assertIn(f"updated plugin 99.0.0 → {current_version()}", r.stdout)
        self.assertEqual(manifest_version(self.home), current_version())

    def test_symlink_is_left_alone(self) -> None:
        dest = self.home / "plugins" / "hermes-ui-plus"
        dest.parent.mkdir()
        target = Path(self._tmp.name) / "elsewhere"
        shutil.copytree(SRC, target)
        dest.symlink_to(target, target_is_directory=True)
        r = run(self.home, "--copy")
        self.assertEqual(r.returncode, 0)
        self.assertIn("symlink", r.stdout)
        self.assertTrue(dest.is_symlink())
        self.assertEqual(os.readlink(dest), str(target))

    def test_config_and_secret_untouched(self) -> None:
        old_copy(self.home, "0.1.1")
        cfg = (self.home / "config.yaml").read_text()
        run(self.home, "--copy")
        secret = (self.home / "hermes-ui-plus" / "secret").read_text()
        run(self.home, "--copy")
        self.assertEqual((self.home / "config.yaml").read_text(), cfg)
        self.assertEqual((self.home / "hermes-ui-plus" / "secret").read_text(), secret)

    def test_manifest_missing_is_updated(self) -> None:
        dest = old_copy(self.home, "0.1.1")
        (dest / "plugin.yaml").unlink()
        r = run(self.home, "--copy")
        self.assertIn("updated plugin unknown", r.stdout)
        self.assertEqual(manifest_version(self.home), current_version())


if __name__ == "__main__":
    unittest.main()
