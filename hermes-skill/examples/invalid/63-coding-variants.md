# invalid 63: coding nodes written with common model variants

Must FAIL. A model wrote `terminal` with `cmd` / `stdout`, `diff` with `diffs`, a bad hunk line and a status outside
the enum, `changes` without `id` and with `items`, and a ```terminal fence without `$ ` and a free-form exit line. The skill contract is `terminal{command, output, exitCode}`,
`diff{patch | files}`, `changes{id, files}`.

<!-- expect: unknown field (use "command") -->
<!-- expect: unknown field (use "output") -->
<!-- expect: terminal needs command or output -->
<!-- expect: unknown field (use "files") -->
<!-- expect: diff needs "patch" (unified text) or "files" -->
<!-- expect: line must start with " ", "+", "-" -->
<!-- expect: bad status changed -->
<!-- expect: interactive node needs a short id -->
<!-- expect: 1-200 files -->
<!-- expect: durationMs: number >= 0 -->
<!-- expect: first line is `$ <command>` -->
<!-- expect: exit line -->

````markdown
Die Tests sind durchgelaufen.

```hui
{"type":"terminal","cmd":"npm test","stdout":"ok","exitCode":0,"durationMs":-5}
```

```hui
{"type":"diff","diffs":[{"path":"a.ts","status":"modified","hunks":[{"oldStart":1,"newStart":1,"lines":["const a = 1;"]}]}]}
```

```hui
{"type":"changes","items":[{"path":"a.ts","status":"changed"}]}
```

```terminal
npm test
ok
[exit: one]
```
````
