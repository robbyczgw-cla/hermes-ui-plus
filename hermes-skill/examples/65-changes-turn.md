# 65 Was wurde geändert? Dateiliste eines Agent-Turns (changes, nur Anzeige)

Router-Hint: `UI-ROUTER-HINT: format=changes confidence=0.9 - geänderte Dateien`

Nutzer: Was hast du beim Aufräumen des Parsers alles angefasst?

Assistent (nur echte Änderungen aus den Tool-Ergebnissen; id vorhanden, Zähler und Diff pro Datei wo vorhanden, Kernaussage im Text):
````markdown
Ich habe den Parser in zwei Module aufgeteilt und die Tests angepasst. Vier Dateien sind betroffen, eine davon umbenannt und eine neu.

```hui
{"type":"changes","id":"parser-turn","title":"Parser aufgeräumt","summary":"Tokenizer ausgelagert, Tests angepasst","agent":"Hermes","files":[{"path":"src/parse/tokenize.ts","status":"added","additions":48,"deletions":0},{"path":"src/parse/index.ts","oldPath":"src/parser.ts","status":"renamed","additions":6,"deletions":31},{"path":"src/parse/index.test.ts","status":"modified","additions":3,"deletions":2,"patch":"@@ -1,5 +1,6 @@\n-import { parse } from '../parser';\n+import { parse } from './index';\n+import { tokenize } from './tokenize';\n \n test('parse handles empty input', () => {\n-  expect(parse('')).toEqual([]);\n+  expect(parse(tokenize(''))).toEqual([]);\n });"},{"path":"docs/parser.md","status":"modified","additions":4,"deletions":1}]}
```
````
