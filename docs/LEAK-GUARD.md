# Leak guard: keeping private content out of the public repo

Three layers, all driven by files in this repo plus **one private directory that is never in the repo**:

| Layer | What it catches | Where it runs |
|---|---|---|
| **gitleaks** (`.gitleaks.toml`) | Secrets: `hbd_` bridge device tokens, `nca_` adapter tokens, `sk-ant-`, `xai-`, Groq (`gsk_`), Deepgram, Serper, Brave (`BSA…`), VAPID private keys, PEM/`.p8` private keys, Tailscale keys, plus gitleaks' default rules | pre-commit, pre-push, CI, `scan-artifact.sh` |
| **leak-guard denylist** (`scripts/leak-guard.mjs`) | Private names/hosts/ids from `$HUI_PRIVATE_DIR/leak-denylist.txt` (tailnet name, device names, family names, e-mail, agent group ids ...) | pre-commit, pre-push, `scan-artifact.sh` (required there) |
| **leak-guard generic** (same script) | `*.ts.net` hosts (except `example.ts.net` / `<placeholder>`), CGNAT `100.64.0.0/10` + Tailscale `fd7a:115c:a1e0::` addresses, RFC1918 IPs in non-test code, e-mail addresses (except `example.com|org|net`, `noreply`, `git@github.com`) | everywhere, including CI | <!-- leak-guard:allow (pattern docs) -->

## The private directory

`HUI_PRIVATE_DIR` (default `~/work/hermesiui-private` if it exists) holds everything personal. For leak-guard:

- `leak-denylist.txt` (required for a real check). One entry per line, `#` comments. Plain term = case-insensitive,
  word-bounded at alphanumeric edges (`acme` does not hit `acmes`); `cs:Term` = case-sensitive; `re:REGEX` = raw regex.
- `leak-allow.txt` (optional): regexes (matched against the matched text) for accepted false positives that should
  not live in the repo. The tracked equivalent is `.leak-guard-allow` in the repo root.
- Reports (`leak-report-<date>.md`) are written there too, never into the repo.

Without the denylist file the tools **warn** and run the generic patterns only; they never silently report "clean".
`--require-denylist` (used by `scan-artifact.sh`) turns a missing denylist into an error.

## Install (user level, no sudo)

```
v=8.30.1; cd "$(mktemp -d)"
curl -sLO https://github.com/gitleaks/gitleaks/releases/download/v$v/gitleaks_${v}_linux_x64.tar.gz
curl -sLO https://github.com/gitleaks/gitleaks/releases/download/v$v/gitleaks_${v}_checksums.txt
grep linux_x64 gitleaks_${v}_checksums.txt | sha256sum -c -        # must print OK
tar -xzf gitleaks_${v}_linux_x64.tar.gz gitleaks && install -m755 gitleaks ~/.local/bin/gitleaks
```
(macOS: take the `darwin_arm64` tarball and verify it against the same checksums file with `shasum -a 256 -c`.)

## Git hooks

Tracked in `.githooks/`; enabled per clone, **not** on the private archive repo by default:

```
export HUI_PRIVATE_DIR=~/work/hermesiui-private
scripts/install-hooks.sh            # git config core.hooksPath .githooks
scripts/install-hooks.sh --remove
```
- `pre-commit`: `gitleaks git --staged` + `leak-guard --staged` (scans the staged blobs, not the working tree).
- `pre-push`: `gitleaks git --log-opts=<pushed range>` + `leak-guard --tree --ref <pushed commit>`.
- A missing `gitleaks`/`node`, or any scanner error, **blocks** (exit non-zero). Only `--no-verify` bypasses, consciously.

## Manual use

```
node scripts/leak-guard.mjs --tree                 # all tracked files (working tree)
node scripts/leak-guard.mjs --tree --ref HEAD      # the committed tree
node scripts/leak-guard.mjs --staged
node scripts/leak-guard.mjs --path dist/web        # any directory, binary-safe (APK contents, .app)
node scripts/leak-guard.mjs --tree --generic-only  # what CI runs
```
Matches are masked by default (`ab***[12]` = first 2 chars + length) so logs are safe to paste; `--show` reveals them,
`--json` gives machine-readable output. Exit codes: 0 clean, 1 findings, 2 environment error (unreadable files, bad
denylist, not a git repo ...). Suppress one line with the marker `leak-guard:allow`; suppress a match globally via
`.leak-guard-allow`. Test fixtures: write obviously fake tokens (`nca_alice_test_token_0000...`); the gitleaks
allow-list only accepts them inside test paths *and* when the token text itself looks fake.

Binary files are scanned like `strings` (printable ASCII runs plus UTF-16LE runs, so `resources.arsc`, `classes.dex` and
`.so` files are covered), plus UTF-8 and UTF-16LE runs with non-ASCII characters (UTF-16 limited to Latin, Greek and
Cyrillic letters; only matches that contain a non-ASCII character count there).

**Hermes bytecode** (`index.android.bundle` in APK/AAB, `main.jsbundle` in IPA, recognized by its magic) gets more: the
compiler packs all strings into one storage blob without separators (strings even share bytes) and stores non-ASCII
strings as UTF-16, so a `strings` scan misses a name glued to its neighbour (word boundary) and every non-ASCII name.
`hermesStrings` decodes the string table (small and overflow entries, 8-bit and UTF-16) and every string is scanned on
its own, with the text rules of a plain JS bundle. A file with the Hermes magic whose layout does not validate is a
scan error (exit 2), never clean. `--expect-hermes` (set by `scan-artifact.sh` whenever the artifact contains a JS bundle)
additionally fails when a bundle is not Hermes bytecode; an AAB or IPA without a bundle fails the gate. Tests use a real
bytecode fixture (`scripts/fixtures/hermes/`, compiled with the hermesc from `app/node_modules`; a second test
recompiles it with the installed hermesc to catch layout changes on Hermes upgrades) and synthetic pre-v98 layouts.
`scan-artifact.sh` always uses the repository's `.leak-guard-allow`, whatever directory it is called from. Compressed media skips the e-mail check (random bytes look like addresses).
For structurally valid MP4 A/V files with recognized compressed codecs, isolated four-byte ASCII runs inside
`mdat` are treated as compression noise. Metadata, longer readable payloads and UTF-16 strings still scan.
Subtitle tracks, unknown codecs and malformed/truncated containers receive the full scan. This is format-aware
noise handling, not a denylist allowance; regression tests cover retained private-metadata detection.
The scanner does not OCR video frames: review visible content as well.

## CI (`.github/workflows/ci.yml`, jobs `leak-guard` and `gitleaks`)

Runs the pinned gitleaks action (full history) and `leak-guard --tree --generic-only` plus its unit tests on every
push and PR, next to the test jobs (app, bridge, push, scripts). Actions are pinned to commit SHAs; update the SHA together with the version comment. The gitleaks action
needs a `GITLEAKS_LICENSE` secret only for organisation-owned repositories.

**Manual step for the repository owner (GitHub settings, cannot be done from the repo):**
Settings -> Code security -> enable **Secret scanning** and **Push protection** (and Dependabot alerts).

## Release artifacts

`scripts/scan-artifact.sh <apk|aab|ipa|zip|dir|.app>`; part of the release steps in `docs/BUILD.md`.

### Code signatures (iOS)

A signed `.ipa`/`.app` inevitably contains the developer's name, team id and certificate ids in its code signature
and provisioning profile. The maintainer accepted this: **signature data may pass** the artifact scans
(`leak-guard --path`, which `scan-artifact.sh` uses, and `flavor-guard.mjs --output`). The allowance is narrow:

- Skipped completely: files under any `_CodeSignature/` directory (`CodeResources`) and `*.mobileprovision`
  (`embedded.mobileprovision` of the app, its extensions and frameworks).
- Mach-O executables (app binary, `Frameworks/*.framework/*`, `*.dylib`, thin or fat/universal, 32/64-bit, either byte
  order) are still scanned; only the byte range of the `LC_CODE_SIGNATURE` blob is zeroed before string extraction.
  The range comes from the load commands (`dataoff`/`datasize`, per fat slice) and is only excluded if it really starts
  with the embedded-signature SuperBlob magic `0xfade0cc0`; a malformed or truncated binary excludes nothing.
- Everything else (JS bundle, Hermes bytecode, assets, `Info.plist`, privacy manifest, the rest of every binary)
  is scanned as strictly as before. Repository scans (`--tree`, `--staged`) have no allowance at all.
- `gitleaks` (secrets) still scans everything unchanged; certificate/profile data contains no secret keys.

The CLI prints `N code-signature file(s) skipped` so the allowance stays visible in the build log. Implementation:
`isSignaturePath`, `machoSignatureRanges`, `maskSignatures` in `scripts/leak-guard.mjs` (tests with a synthetic
Mach-O in `scripts/leak-guard.test.mjs`, flavor-guard case in `scripts/flavor-guard.test.mjs`).

## Tests

`node --test scripts/leak-guard.test.mjs` (also run by `scripts/check.sh all`). Synthetic samples only, assembled at
runtime so the test file itself stays clean.
