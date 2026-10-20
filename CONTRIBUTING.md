# Contributing to Hermes Interactive UI+

Thanks for helping out. Hermes Interactive UI+ is an unofficial client for the Hermes Agent. Start with [docs/SPEC.md](docs/SPEC.md) for the architecture and [docs/README.md](docs/README.md) for the rest of the documentation.

## Development setup

Requirements: Node 22+, Git. Android, iOS and desktop builds have extra toolchains, see [docs/BUILD.md](docs/BUILD.md). You rarely need them: most changes can be tested with the web preview, the unit tests and the mock server.

```bash
git clone https://github.com/robbyczgw-cla/hermes-ui-plus.git
cd hermes-ui-plus/app
npm ci
npx expo start --web        # web preview
```

Use `npx expo install <package>` to add dependencies, not `npm install <package>`; Expo pins versions per SDK. Expo changes quickly, so check the current docs and [app/AGENTS.md](app/AGENTS.md).

### Without a Hermes server (mock)

```bash
node mock-server/server.mjs --route      # http://localhost:8787/v1
```

Point the app at `http://localhost:8787/v1` (Android emulator: `http://10.0.2.2:8787/v1`). The mock picks a scenario from keywords in your last message, for example `chart`. See [mock-server/README.md](mock-server/README.md).

### With a real Hermes

Hermes Interactive UI+ targets **Hermes Agent v0.21 or newer**. When you change anything that touches the API (streaming events, sessions, approvals, slash commands, skills), test against a real Hermes of that version or newer and say which version you used in the PR. [docs/HERMES-API.md](docs/HERMES-API.md) documents the wire behaviour we depend on. Only test against a Hermes instance you own.

### Bridge

```bash
cd bridge
npm ci
BRIDGE_ALLOW_NO_AUTH=1 HERMES_BASE_URL=http://127.0.0.1:8787 HERMES_API_KEY=dev node src/server.mjs
```

`BRIDGE_ALLOW_NO_AUTH=1` is for local development only.

## Checks

```bash
scripts/check.sh all                       # tsc (app + tests), app unit tests, scripts/*.test.mjs, bridge, push, plugin
scripts/check.sh quick                     # inner loop: only what your change can affect (not a merge gate)
scripts/check.sh all --host <ssh-host>     # the same gate on another Linux machine (small laptop, wrong file system)
(cd bridge && npm test)                    # bridge tests
(cd push && npm test)                      # push library tests
(cd bridge && npm run eval)                # router evaluation set
(cd app && npx expo lint)
node hermes-skill/examples/validate.mjs    # validates the answer blocks in the skill examples
```

`scripts/check.sh` has two modes. On Linux with a systemd user session it runs each step memory-capped
(`systemd-run --user --scope`) and serialized with `flock`, for shared build machines. Everywhere else (macOS,
Windows/WSL without systemd, containers, CI) it runs the same commands directly; force that with `HUI_CHECK_PLAIN=1`.
`scripts/check.sh quick [--base REF]` is the fast inner loop. It compares merge-base(HEAD, main) with the working tree
(staged, unstaged and untracked files) and maps the changed files to related tests with `scripts/lib/related-tests.mjs`
(import graph plus path mentions). When the mapping is unsure (dependency, tsconfig or Expo config, test helpers or
fixtures, runtime-loaded data, or a file more than 30 % of the tests depend on), it runs that area's full suite instead.
tsc runs incrementally (cache in `~/.cache/hui-check/`) and is skipped when nothing it sees changed; leak-guard covers the
working-tree changes. It takes the same lock and memory scope as `all`, in at most two short steps. It is not a merge
gate: run `scripts/check.sh all` before merging.

`scripts/check.sh all` runs every step even after one fails and ends with one summary line, for example
`check: tsc ok, tsc-test ok, app tests 2210 pass/0 fail, scripts 640 pass/0 fail, bridge 630 pass/0 fail, ... - all green in 6m2s`
(exit 1 when a step failed, 75 when a step gave up waiting for the lock). The `bridge` step is the whole bridge suite
(`npm test` in `bridge/`, the security corpus included) and needs `npm ci` in `bridge/` as well as in `app/`;
`scripts/check.sh bridge` runs it alone, `scripts/check.sh bridge-security` only the dependency-free security corpus.

`scripts/check.sh all --host <host>` runs that gate on another Linux machine over ssh when yours is too small for it
(`<host>` is an ssh alias, or `linux` for `LINUX_HOST` from the environment or `$HUI_PRIVATE_DIR/build.env`). It ships
the committed tree of HEAD and refuses a dirty working tree; `--worktree` includes the uncommitted changes (staged,
unstaged and untracked), `--committed` checks HEAD anyway and only warns. Only the git objects the host does not have
yet travel (the host keeps a bare repository with the trees of earlier runs; the first run sends the whole tree once).
On the host, each run gets its own directory under `~/.cache/hui-check-remote/runs/` (`HUI_CHECK_REMOTE_DIR` changes
the base), which is removed at the end, also when the run fails or is interrupted. The run's temp files (`TMPDIR`) live
in that directory too, on disk, because a host's `/tmp` may be a small tmpfs other jobs fill up; set
`HUI_CHECK_REMOTE_TMPDIR` to an absolute path on the host to use a per-run directory below it instead. Node 22 with TypeScript stripping
comes from the host, or from a cached official nodejs.org tarball (SHA-256 checked, refreshed weekly), and
`node_modules` from a cache keyed by the lockfile, so `npm ci` only runs when a lockfile changed. The host's own capped
`check.sh all` does the rest; its per-step lock queues runs from several people or agents. The output is streamed, the
last line sums up the run, and the exit code is the remote one (255 when ssh failed). macOS hosts are refused: run
`check.sh all` there directly, in a case-sensitive volume.

The underlying commands, if you prefer to run them yourself:

```bash
cd app
npx tsc --noEmit && npx tsc --noEmit -p tsconfig.test.json
npm test                                   # node --test "src/**/*.test.ts" (Node 22.18+ runs TypeScript directly)
node --test ../scripts/*.test.mjs
```

### What CI runs

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. It needs no
secrets, so pull requests from forks get the same checks:

| Job | Same as locally |
|---|---|
| `app` | `scripts/check.sh all` (tsc app + tests, app unit tests, `scripts/*.test.mjs`, the bridge suite) after `npm ci` in `app/` and `bridge/` |
| `services` | `cd bridge && npm ci && npm test`, `cd push && npm test` |
| `website` | `node --test scripts/website.test.mjs` |
| `leak-guard` | `node scripts/leak-guard.mjs --tree --generic-only` and its unit tests |
| `gitleaks` | gitleaks over the git history with `.gitleaks.toml` |
| `workflows` | actionlint and `node --test scripts/workflows.test.mjs` (pinned actions, read-only token, nothing publishes) |

Run `scripts/check.sh all` (it includes the bridge and push tests) locally before opening a pull request. Do not start a native build just to test a JavaScript
change. Workflow changes: actions stay pinned to a full commit SHA with a version comment, and `permissions` stay
read-only; `scripts/workflows.test.mjs` fails otherwise. Dependency updates are made in the source repository and arrive
with the next export (Expo packages only through `npx expo install`), so this repository has no automatic update pull requests.

## Internationalization (i18n)

The app ships in **German (`de`), English (`en`) and Spanish (`es`)**. All user-facing strings live in `app/src/i18n/`.

- Strings are grouped by area in `app/src/i18n/ns/<area>.{de,en,es}.ts`. Add new keys to the `de` file first (the source of truth for key types), then to `en` and `es`. The compiler fails when a language is missing a key.
- Do not hard-code UI text in components. `node app/src/i18n/find-hardcoded.mjs` lists strings that slipped through.
- Slash commands have localized aliases; keep them in sync in `app/src/chat/commands/registry.ts`.
- See [app/src/i18n/README.md](app/src/i18n/README.md).

## Conventions

- TypeScript strict, function components only.
- Tests sit next to the code (`*.test.ts`) or in `bridge/test/`. Keep pure logic free of React Native imports so it runs under `node --test`.
- **Protocol changes** touch several places: `app/src/protocol/types.ts`, the validator, mock fixtures, the skill in `hermes-skill/hermes-ui/` and its examples, and the spec docs.
- The bootstrap message `hermes-skill/bootstrap-system-message.txt` must stay byte-identical to `app/src/hermes/bootstrap.ts`.
- Device actions (calendar, reminders, calls, messages) must always go through the confirmation sheet.
- Ported code keeps its license header and is listed in [NOTICE.md](NOTICE.md).

## Placeholders instead of private data

This repository is public. **Never commit real hostnames, IP addresses, tailnet names, names of people, tokens, keys, keystores, `.env` files or screenshots that show any of these.** Use placeholders everywhere: in code, tests, fixtures, docs, commit messages and issues.

| Instead of | Write |
|---|---|
| your machine's name | `<your-host>` |
| a Tailscale address | `<your-host>.<tailnet>.ts.net` |
| an IP address | `127.0.0.1`, or `192.0.2.x` (documentation range) |
| a token or API key | `<your API_SERVER_KEY>`, `<token>` |
| a person | `Alice`, `Bob`, or a role |
| an email address | `user@example.com` |

Check your diff and your screenshots before you push. Automated leak guards may reject a commit or CI run that contains private-looking data; fix the content instead of bypassing the check. If you committed a secret by accident, tell the maintainers (see [SECURITY.md](SECURITY.md)) and rotate it right away.

## Pull request checklist

- [ ] `scripts/check.sh all` passes (it runs the bridge and push tests too; CI runs the same).
- [ ] New strings exist in `de`, `en` and `es`.
- [ ] No private data in the diff, fixtures or screenshots.
- [ ] Protocol, router or skill changes are reflected in docs and examples.
- [ ] UI changes include a screenshot or short recording (light and dark if relevant).
- [ ] Security-relevant changes (keys, sandbox, actions, bridge auth, uploads) are described, and [SECURITY.md](SECURITY.md) is updated if the threat model changes.
- [ ] The Hermes Agent version you tested against is noted.

## Reporting bugs

Open an issue with the app version, platform, your Hermes Agent version, steps to reproduce and what you expected. Redact tokens and hostnames from logs. Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## License

By contributing, you agree that your contributions are licensed under the project license (see [LICENSE](LICENSE)).
