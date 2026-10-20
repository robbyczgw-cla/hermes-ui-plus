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

`scripts/check.sh all` (tsc + tests incl. the full bridge suite, memory-capped; never wrap it in `flock` yourself;
needs `npm ci` in `app/` and `bridge/`, the `--host` mode does that on the host). Leak-guard tests:
`node --test scripts/leak-guard.test.mjs`.
While iterating use `scripts/check.sh quick` (related tests + incremental tsc + leak-guard; not a merge gate); `scripts/check.sh all` is required before every merge.
On a machine too small for it, run the gate on a Linux build host: `scripts/check.sh all --host <ssh-host>` (or `--host linux`
for `LINUX_HOST`); it ships the committed HEAD (dirty tree refused, `--worktree` to include changes), caches Node and
node_modules there, queues behind other runs and returns the remote exit code. Details in CONTRIBUTING.md.

## Test what a normal user gets, not only what we built

Many tests check that our code does what we built it to do. Fewer check what a normal user with a normal setup
actually sees. Cover that side too:

- Test against the default configuration (bridge as a pure pass-through, no extras such as image search keys,
  router `heuristic`), not only against mocks, the demo or our own special test setups.
- Use realistic multi-turn conversations with typical follow-ups ("photos?", "as a table?", "more details?") and
  typos, not only single clean prompts.
- Every answer component must render something visible and understandable when its data is missing or cannot be
  resolved (no empty gap, no silent disappearance), with a test for it.
- Before a release, run the live conversation check against the default bridge on a Hermes test instance
  (docs/RELEASING.md).
