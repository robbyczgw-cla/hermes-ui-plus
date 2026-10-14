# Agent rules for this repository

## Never write private content into tracked files

This repository is (or will become) **public**. Everything tracked must be safe to publish.

- **Never** write real hostnames (tailnet names, `*.ts.net`, device names, internal server names), personal or family
  names, e-mail addresses, IP addresses (Tailscale/CGNAT `100.64/10`, LAN ranges), agent/group ids, tokens, API keys,
  VAPID keys, signing material or team ids into any tracked file: code, tests, docs, comments, fixtures, commit messages,
  screenshots.
- Use placeholders instead: `<host>.<tailnet>.ts.net`, `example.com`, `192.0.2.x` / `198.51.100.x` (documentation
  ranges), `<user>`, `<phone>`, `nca_<token>`, `Alice`/`Bob` for example people.
- Test fixtures use obviously fake values (`nca_user_test_token_000...` style: contains `test`/`fake`/`dummy`, or a long
  run of one character) and live under `test/`, `tests/`, `__tests__/` or `*.test.*`.
- Private stuff (real hosts, names, notes, deploy prompts, the denylist, reports) lives in **`$HUI_PRIVATE_DIR`**
  (default `~/work/hermesiui-private`), outside the repo.
- Before committing/pushing and before sharing any build: `node scripts/leak-guard.mjs --staged` (or `--tree`) and, for
  built artifacts, `scripts/scan-artifact.sh <apk|dir|app>`. Hooks: `scripts/install-hooks.sh`. Details: `docs/LEAK-GUARD.md`.
- If a scanner flags something, fix the content (placeholder + move the real value to the private dir). Do not add
  allow-list entries or `leak-guard:allow` markers to silence a real finding, and do not use `--no-verify`.

## Checks

`scripts/check.sh all` (tsc + tests, memory-capped; never wrap it in `flock` yourself). Leak-guard tests:
`node --test scripts/leak-guard.test.mjs`.
