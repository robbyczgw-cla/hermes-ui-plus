# 64 Testlauf zeigen: echte Ausgabe als ```terminal-Fence mit Exit-Code (nur Anzeige)

Router-Hint: `UI-ROUTER-HINT: format=terminal confidence=0.9 - Befehlsausgabe`

Nutzer: Lauf mal die Tests und sag mir, was kaputt ist.

Assistent (nach dem `terminal`-Tool-Lauf von `npm test`: Ausgabe unverändert aus dem Tool-Ergebnis, nur der relevante Teil; letzte Zeile `[exit <code>, <Dauer>]` aus dem Ergebnis; Kernaussage in 1-2 Sätzen davor):
````markdown
Ein Test schlägt fehl: `merge keeps newest entry` erwartet 3 Einträge, bekommt aber 2. Die anderen 42 Tests laufen durch.

```terminal
$ npm test
> app@1.0.0 test
> node --test

✔ parse handles empty input (1.2ms)
✔ parse keeps order (0.8ms)
✖ merge keeps newest entry (2.4ms)
  AssertionError: expected 3 but got 2
      at merge.test.ts:18:10

ℹ tests 43
ℹ pass 42
ℹ fail 1
[exit 1, 4.2s]
```
````
