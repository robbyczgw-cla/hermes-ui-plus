# coding (code change as diff, command output as terminal, files an agent changed as changes)
Three display-only views for coding answers. Shapes below; for `diff` and `terminal` a plain fence is the easiest way.

## When (after real tool work)
- You edited code (`patch`, `write_file`) or the user asks for "the diff": show the change as a ```` ```diff ```` fence. In a git repo take it from `git diff -- <files>` (`terminal`), else the patch you applied. 1-2 files; more: `changes`.
- You ran a command whose result the user cares about (tests, build, lint, install, `git log`, a server log): ONE ```` ```terminal ```` fence with that command and the relevant output (the tail for long logs). Not for every `ls` / `cat` / `grep` you ran to look around.
- A task changed 3+ files, or "what did you change?" / `git status`: `changes` (`git status --porcelain` + `git diff --numstat` for status and counts, `git diff` for the per-file patches).
- One view per kind per answer; a short result sentence before it. Never show output, diffs or files that no tool produced.

## diff (a code change: unified diff, per-file cards, +/- counts, collapse / copy in the app)
PREFERRED: a plain ```` ```diff ```` fence with standard unified diff text (what `git diff` / `diff -u` prints): `--- a/x` / `+++ b/x` / `@@ -a,b +c,d @@` headers, several files in one fence are fine. A headerless `-` / `+` snippet also renders, but without line numbers. A fence tagged `patch` works the same. No `hui` wrapper around it.
JSON form (structured data at hand): `{type:"diff", id?, title?, patch?, files?:[{path, oldPath?, status?, language?, binary?, hunks?:[{oldStart, newStart, header?, lines:[…]}], patch?, before?, after?}], view?:"unified"|"split"}`
- Use when: showing a code change, a patch, "what would change", reviewing or proposing edits, the result of an edit the agent made. Display-only, no tap reply.
- Not for: a whole new file or a snippet without a change (Markdown code block), comparing prose or options (`compare`), files an agent touched in a turn (`changes`).
- Needs `patch` OR `files` where each file has `hunks`, `patch`, or `before` + `after` (whole old / new text, the app computes the diff).
- `hunks[].lines`: every line starts with a prefix: `" "` context, `"+"` added, `"-"` removed, `"\\"` for "No newline at end of file". `oldStart` / `newStart` are 1-based first line numbers of the hunk.
- `status`: `added` | `modified` | `deleted` | `renamed` (+ `oldPath`); else derived from the headers. `language`: optional ("ts", "py"). `view`: `split` only on wide screens; leave it out normally.
- Real diffs come from a tool (git diff, the edit you just made); when you write one yourself, keep context lines exact and the `@@` counts right. Never invent a change the user did not ask for or that was not made.
- Text outside: 1-2 sentences (what changes and why). Many files or a whole turn: use `changes`.

## terminal (a shell command and its real output, ANSI colors, exit code)
Plain fence: ```` ```terminal ````, first line `$ <command>`, then the output as is (ANSI escapes fine), optional LAST line `[exit <code>]` or `[exit <code>, <duration>]` (`[exit 1, 4.2s]`) with the exit code from the tool result.
JSON form: `{type:"terminal", id?, title?, command?, cwd?, output?, exitCode?, durationMs?, status?:"running"|"done"|"error"}`
- Use when: showing the output of a command that REALLY ran (your `terminal` / `execute_code` result): test run, build, lint, git log, install log. Display-only. The fence is easiest; JSON when you also want `cwd` / `title`.
- Not for: commands the user should run themselves or sample output you imagine (normal ```` ```bash ```` code block), file contents (code block), a list of changed files (`changes`).
- Needs `command` or `output`. `output` is the raw text (stdout + stderr) with real ANSI SGR escapes, in JSON written `\u001b[31m`; `\n` between lines. Keep it to the useful part; for a very long log keep the last lines (the app also keeps the tail). Never reformat or "clean up" real output, never make up lines.
- `exitCode` integer (0 = ok), `durationMs` number ≥ 0 (a number, not "1.2s"), `cwd` = directory it ran in (relative like "app" is fine). `status` is derived from `exitCode` (default done / error); set `running` only for a command that has not finished. `title` optional ("Tests").
- Text outside: 1-2 sentences with the result (what failed, what it means). Do not repeat the output.

## changes (files changed in an agent turn: list with status, +/- counts, tap opens the diff)
`{type:"changes", id, title?, summary?, agent?, files:[{path, oldPath?, status, additions?, deletions?, patch?, hunks?, binary?, byAgent?}] (1-200), patch?}`
- Use when: after an agent / tool turn that edited several files ("what did you change?", "which files did you touch?"). Needs an `id` (the app keeps the per-file "viewed" state), sends no reply.
- Not for: one or two files you only want to show (`diff`), files that were not really changed (only real changes from tools, never invented), listing project files (Markdown list).
- `files[].status` (required): `added` | `modified` | `deleted` | `renamed` (+ `oldPath` for a rename). `additions` / `deletions` are non-negative integers; the app computes them from the diff when left out. `binary:true` for files without a text diff.
- Diff data so a tap opens the file: per file `patch` (unified text of that file) or `hunks` (as in `diff`), or ONE top-level `patch` with the combined diff (a file takes its section by path). Files without any diff are listed only.
- `summary` = one line under the title ("Refactored the stream parser"); `agent` = display name for the "<agent> only" filter; `byAgent:false` for a file the agent did not touch (else leave out).
- Text outside: 1-2 sentences with the gist; the node lists the files.

{"type":"diff","title":"Added a null check","files":[{"path":"src/user.ts","status":"modified","hunks":[{"oldStart":4,"newStart":4,"header":"function name","lines":[" function name(u: User) {","-  return u.name.trim();","+  return u?.name?.trim() ?? '';"," }"]}]}]}
{"type":"diff","files":[{"path":"README.md","language":"md","before":"# Title\nOld\n","after":"# Title\nNew\n"}],"view":"unified"}
{"type":"terminal","title":"Tests","command":"npm test","cwd":"app","output":"\u001b[32m✓\u001b[0m parse ok\n\u001b[31m✗\u001b[0m merge fails\n1 failing","exitCode":1,"durationMs":4210}
{"type":"terminal","command":"git status --short","output":" M src/a.ts\n?? notes.txt\n","exitCode":0}
{"type":"changes","id":"turn-3","title":"Changes","summary":"Cleaned up the parser","agent":"Pi","files":[{"path":"src/parse.ts","status":"modified","additions":2,"deletions":1,"patch":"@@ -1,2 +1,3 @@\n-const a = 1;\n+const a = 2;\n+const b = 3;\n export {};"},{"path":"src/old.ts","oldPath":"src/legacy.ts","status":"renamed"},{"path":"src/new.ts","status":"added","additions":12,"deletions":0}]}
