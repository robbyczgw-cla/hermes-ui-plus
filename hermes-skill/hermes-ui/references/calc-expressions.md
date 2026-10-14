# calc: node and expressions (safe engine, no eval)

{id, title?, basis?, inputs:[{name, label, kind:"slider"|"number"|"select"|"toggle", min?, max?, step?, default, unit?, options?:[{label,value}]}], outputs:[{name?, label, expr, format?:"number"|"currency"|"percent"|"duration"|"integer", decimals?, unit?, emphasis?}], chart?:{kind:"line"|"bar", sweep:{input, from, to, steps}, y:expr, label?}, note?}  reply: `[calc:<id>] Kredit 20.000 € · Zins 4,5 % → Rate 372,86 €`
`expr` uses input names + EARLIER output names; percent inputs `/ 100`, decimal POINT, guard zero divisors, assumptions in `note`. Orientation only. Replaces hui-html calculators, converters, what-if, bill split.
{"type":"calc","id":"tipp","title":"Rechnung teilen","basis":"calculated","inputs":[{"name":"rechnung","label":"Rechnungsbetrag","kind":"number","default":84.5,"unit":"€"},{"name":"trinkgeld","label":"Trinkgeld","kind":"slider","min":0,"max":20,"step":1,"default":10,"unit":"%"},{"name":"personen","label":"Personen","kind":"slider","min":1,"max":12,"step":1,"default":4}],"outputs":[{"name":"gesamt","label":"Gesamt mit Trinkgeld","expr":"rechnung * (1 + trinkgeld / 100)","format":"currency"},{"label":"Pro Person","expr":"gesamt / max(personen, 1)","format":"currency","emphasis":true}],"note":"Trinkgeld auf den Gesamtbetrag; Cent-Rundung nicht verteilt."}
Optional chart: "chart":{"kind":"line","sweep":{"input":"personen","from":1,"to":12,"steps":12},"y":"gesamt / personen","label":"Pro Person"}

Used in `calc.outputs[].expr` and `calc.chart.y`. Identifiers = input `name`s + EARLIER named outputs. Names: letters/digits/underscore
(`kredit`, `monate`, `groesse`); avoid `e` and `pi` as names. Write every number with a decimal POINT.

## Grammar
- Operators high to low: `^` (right-assoc, `2^3^2=512`, `(1+r)^-n` ok) · unary `- + !` · `* / %` · `+ -` · `< <= > >=` · `== !=` · `&&` · `||` · `c ? a : b`.
- `%` is MODULO, not percent. Percent inputs are divided by 100 inside the expression (`zins / 100`).
- Constants `pi`, `e`. Functions: `min max` (1+ args) · `round(x)` / `round(x, d)` · `floor ceil abs sqrt` · `pow(x,y)` · `log` (base 10) · `ln` · `exp` · `clamp(x, lo, hi)` · `if(c, a, b)`.
- Toggle inputs are 1/0. Comparisons give 1/0. Division by zero, `sqrt(-1)`, `log(0)` give "–" and propagate; a dead ternary branch is not evaluated.
- NOT available: strings, `a.b`, `[]`, `{}`, `=`, `;`, single `&`/`|`, `3,5` (German comma), `1.000` thousands dots (that is 1.0; write `1000` or `1_000`), chained `a < b < c`, unknown names (error shown to the user).
- Limits: 500 chars, nesting depth 50, 200 AST nodes (avoid sums of > ~49 terms). Chart sweep: max 60 steps.

## Formats (`outputs[].format`, German display)
`number` (max 2 decimals) · `integer` · `currency` (EUR, 2 decimals, `372,86 €`) · `percent` (value is a FRACTION: 0.045 shows `4,5 %`; if already in percent units use `number` + `unit:"%"`) · `duration` (value in MONTHS: 63 shows `5 J 3 M`). `decimals` fixes fraction digits; `unit` is appended (ignored for duration).

## Inputs
`slider` {min,max,step,default,unit} (bounded values) · `number` (free amounts) · `select` {options:[{label,value}]} (value numeric) · `toggle` (1/0). Always give `default` inside min/max; 2-6 inputs; 1-4 outputs, mark the main one `emphasis:true`.

## Ready expressions
| Use case | Expression |
|---|---|
| Zinseszins (jährlich) | `kapital * (1 + zins / 100) ^ jahre` |
| Sparplan (monatl. `rate`, Zins p. a.) | `zins == 0 ? rate * 12 * jahre : rate * (((1 + zins / 100 / 12) ^ (12 * jahre) - 1) / (zins / 100 / 12))` |
| Trinkgeld pro Person | `(rechnung * (1 + trinkgeld / 100)) / max(personen, 1)` |
| BMI | `gewicht / (groesse / 100) ^ 2` |
| BMI-Kategorie (1-4) | `bmi < 18.5 ? 1 : bmi < 25 ? 2 : bmi < 30 ? 3 : 4` |
| Netto -> Brutto (MwSt) | `netto * (1 + mwst / 100)` |
| Brutto -> Netto | `brutto / (1 + mwst / 100)` |
| Celsius -> Fahrenheit | `c * 9 / 5 + 32` |
| km <-> Meilen (toggle `meilen`) | `meilen ? km * 0.621371 : km` |
| Prozentuale Änderung (format percent) | `alt == 0 ? 0 : (neu - alt) / alt` |
| Runden auf 5 Cent | `round(preis * 20) / 20` |
| Begrenzen | `clamp(wert, 0, 100)` |
| Kreisfläche | `pi * r ^ 2` |
| Restlaufzeit in Monaten (format duration) | `ceil(schulden / max(rate, 1))` |
| Rabatt | `preis * (1 - rabatt / 100)` |

## Rules
- Show units on inputs and outputs; state formula/assumptions in `note` (one line).
- Rounded shares must sum to the total: compute the last share as `gesamt - (n - 1) * anteil` instead of rounding every share.
- Guard divisions that can hit zero (`b == 0 ? 0 : a / b`) or accept "–". Keep defaults realistic; the user can reset in the app.
- Do not claim a payment, booking or contract: results are orientation only.
