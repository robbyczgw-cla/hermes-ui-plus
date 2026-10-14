# calc – safe expression engine for the `calc` node

Pure TypeScript, no dependencies, **no `eval` / `new Function`**. Expressions come from an LLM that
may have read hostile web pages, so the engine is a hand-written tokenizer + Pratt/recursive-descent
parser + tree-walking evaluator over a closed set of operations. Nothing in an expression can reach
JS objects: there is no property access, no strings, no assignment, no unknown calls, and identifiers
only resolve to OWN keys of the scope (never `constructor`, `__proto__`, `globalThis`, ...).

```ts
import { evaluateOutputs, sweep, formatValue, compile } from './calc/index.ts';

const res = evaluateOutputs(
  { kredit: 20000, zins: 4.5, monate: 60 },                 // current input values
  [
    { name: 'r',    expr: 'zins / 100 / 12' },
    { name: 'rate', expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)' },
    { expr: 'rate * monate - kredit' },                     // no name -> not referenceable
  ],
);
formatValue(res[1].value, { format: 'currency' });          // "372,86 €"  (NBSP before €)
```

## API

| Function | Notes |
|---|---|
| `tokenize(src): Token[]` | throws `CalcError` |
| `parse(src): Ast` | throws `CalcError` (code, message with "(Position N)", `pos`) |
| `evaluate(ast, scope): EvalResult` | never throws; `{ok:true, value:number\|null}` or `{ok:false, error}` |
| `compile(expr): CompileResult` | `{ok:true, ast, identifiers, fn(scope)}` or `{ok:false, error}`; LRU cache (200 entries, failures cached too) |
| `evalExpr(expr, scope)` | compile + evaluate |
| `evaluateOutputs(inputs, outputs[]): OutputResult[]` | outputs in order; named outputs are visible to later ones; never throws |
| `sweep(chart, inputs, outputs): {ok,points[{x,y}]}\|{ok:false,error}` | for the optional chart, see below |
| `formatValue(v, opts): string` | see "Formatting" |

`scope` = plain object or `Map` (own keys only). Values: numbers; booleans (toggle) become 1/0; numeric
strings (`"12"`) are accepted; anything else counts as "no value" -> result `null`.

`error` = `{code, message, pos, end}`; `message` is German and contains `(Position N)` (1-based),
`pos`/`end` are 0-based offsets. Codes: `empty too_long too_deep too_complex syntax char number
unknown_function arity unknown_identifier reserved type sweep internal`.

**Values and `null`:** every value is a number. Comparisons/logic give `1`/`0`. Division by zero,
`%` by zero, `sqrt(-1)`, `log(0)`, overflow (`10^400`), NaN and Infinity all produce `null`
(UI shows "–") and propagate through the rest of the expression. A dead ternary/`if`/`&&`/`||`
branch is not evaluated, so `b == 0 ? 0 : a / b` works. **Unknown identifiers are errors** (not
`null`), so typos are visible: `Unbekannter Bezeichner „y“ (Position 5) (verfügbar: x)`.
An output that fails or is `null` makes outputs that use it `null` too.

## Grammar

```
expr     := ternary
ternary  := or ( '?' ternary ':' ternary )?             right-assoc
or       := and ( '||' and )*
and      := equal ( '&&' equal )*
equal    := rel ( ('==' | '!=') rel )?                  non-associative
rel      := add ( ('<' | '<=' | '>' | '>=') add )?      non-associative ("a < b < c" is an error)
add      := mul ( ('+' | '-') mul )*
mul      := unary ( ('*' | '/' | '%') unary )*          '%' is MODULO (sign of dividend)
unary    := ('-' | '+' | '!') unary | power
power    := primary ( '^' unary )?                      right-assoc; binds tighter than unary minus
primary  := number | ident | ident '(' [ expr (',' expr)* ] ')' | '(' expr ')'
number   := digits ['.' digits] [('e'|'E') ['+'|'-'] digits]  |  '.' digits ...
            digits may contain '_' between digits:  1_000_000
ident    := (letter | '_') (letter | digit | '_')*      Unicode letters ok (größe)
```

Precedence, high to low: `^` · unary `- + !` · `* / %` · `+ -` · `< <= > >=` · `== !=` · `&&` · `||` · `?:`.
So `-2^2 = -4`, `2^3^2 = 512`, `2^-n` works, `(1 + r)^-n` works.

* **Numbers use a decimal POINT.** The German decimal comma is NOT accepted: `3,5` is a syntax error
  ("Dezimalzahlen mit Punkt schreiben"); commas only separate function arguments. A German thousands
  dot is not understood either: `1.000` is **one** (1.0) - use `1000` or `1_000`.
* Typographic `× · ÷ − ≤ ≥ ≠` are accepted as `* * / - <= >= !=`.
* `==` / `<` / `<=` etc. compare with a relative tolerance of 1e-9 (so `0.1 + 0.2 == 0.3` is true).
* Constants: `pi`, `e`. An input/output with the same name takes precedence (`e` as an input name works).
* Functions (case-sensitive, wrong arity is a compile error):

  | Function | Meaning |
  |---|---|
  | `min(a, b, ...)`, `max(a, b, ...)` | 1+ arguments |
  | `round(x)`, `round(x, d)` | half away from zero, `d` integer -10..15 (`round(1.005, 2) = 1.01`) |
  | `floor(x)`, `ceil(x)`, `abs(x)`, `sqrt(x)` | |
  | `pow(x, y)` | same as `x ^ y` |
  | `log(x)` | base 10 · `ln(x)` natural log · `exp(x)` |
  | `clamp(x, lo, hi)` | `lo <= hi` required, else `null` |
  | `if(c, a, b)` | lazy, same as `c ? a : b` |

* Not available (clear error): strings, `.` property access, `[]`, `{}`, `=`, `;`, `&`/`|` single,
  `++`, arrow functions, unknown function names, `constructor` / `__proto__` / `prototype`.

## Limits

| Limit | Value | Error code |
|---|---|---|
| expression length | 500 chars | `too_long` |
| AST depth / nesting | 50 | `too_deep` |
| AST nodes | 200 | `too_complex` |
| sweep points | 60 | (clamped) |
| compile cache | 200 entries (LRU) | |

Note: a left-leaning chain `1+1+1+...` has depth = number of terms, so sums with more than ~49 terms
are rejected; use fewer, larger sub-expressions.

## Formatting

`formatValue(v, {format, decimals?, unit?, locale: 'de-DE', currency: 'EUR', durationUnit?})`.
`null`/NaN/Infinity -> `"–"`. German separators (`1.234,56`), a non-breaking space (` `) between
number and unit/symbol. Rounding is half away from zero. `decimals` fixes the number of fraction digits
(0..10); without it each format has a default.

| format | convention | example |
|---|---|---|
| `number` | max. 2 decimals, trailing zeros trimmed (more digits for values < 1) | `1234.5` -> `1.234,5` |
| `integer` | rounded to 0 decimals | `1234.5` -> `1.235` |
| `currency` | always 2 decimals (or `decimals`), symbol after the number (€ $ £, else ISO code) | `372.8625` -> `372,86 €` |
| `percent` | **multiplies by 100**: the expression yields a *fraction*; max. 2 decimals trimmed | `0.045` -> `4,5 %` |
| `duration` | value is in **months** by default (`durationUnit`: `years`, `hours`, `minutes`, `seconds`) | `63` -> `5 J 3 M`, `7` -> `7 M`, `24` -> `2 J`; seconds `3725` -> `1 h 2 min 5 s` |

`unit` is appended (after NBSP) for number/integer/currency/percent (a unit equal to the symbol is
dropped), and ignored for `duration`.

**Percent convention:** inputs that the user sees in percent units (slider "Zins" 0-10 meaning 4.5 %)
are divided by 100 *inside* the expression (`zins / 100`). An output shown as `percent` must evaluate to
a fraction (`0.045` for 4.5 %). If the output is already in percent units (4.5), use `format: 'number'`
with `unit: '%'` instead.

## Chart sweep

```ts
sweep(
  { kind: 'line', sweep: { input: 'monate', from: 12, to: 120, steps: 10 }, y: 'rate' },
  inputs, outputs,
) // -> { ok: true, points: [{ x: 12, y: ... }, ..., { x: 120, y: ... }] }
```

`steps` = number of points (clamped 2..60, default 20; `from === to` gives one point; descending
ranges are fine). The swept input is overridden by `x` for each point, all outputs are re-evaluated
per point, so `y` may be an output name or any expression. `y: null` for a point that is not
computable. A compile/unknown-name error in `y` is returned once as `{ok:false, error}`.

## Examples for the skill

Write every number with a decimal point; percent inputs are divided by 100 in the expression.

```jsonc
// Kreditrate (Annuität)
{ "type": "calc", "id": "kredit", "title": "Kreditrechner",
  "inputs": [
    { "name": "kredit", "label": "Kreditsumme", "kind": "slider", "min": 1000, "max": 100000, "step": 500, "default": 20000, "unit": "€" },
    { "name": "zins",   "label": "Zins p. a.",  "kind": "slider", "min": 0, "max": 12, "step": 0.1, "default": 4.5, "unit": "%" },
    { "name": "monate", "label": "Laufzeit",    "kind": "slider", "min": 6, "max": 120, "step": 6, "default": 60, "unit": "Monate" }
  ],
  "outputs": [
    { "name": "r",    "label": "Monatszins", "expr": "zins / 100 / 12", "format": "percent", "decimals": 3 },
    { "name": "rate", "label": "Monatliche Rate", "expr": "r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)", "format": "currency", "emphasis": true },
    { "name": "gesamt", "label": "Gesamtkosten", "expr": "rate * monate", "format": "currency" },
    { "label": "Zinsen gesamt", "expr": "gesamt - kredit", "format": "currency" }
  ],
  "chart": { "kind": "line", "sweep": { "input": "monate", "from": 12, "to": 120, "steps": 10 }, "y": "rate", "label": "Rate je Laufzeit" } }
```

More expressions (inputs in comments):

| Use case | Expression |
|---|---|
| Zinseszins (jährlich) | `kapital * (1 + zins / 100) ^ jahre` |
| Sparplan (monatl. Einzahlung `rate`, Zins p. a.) | `zins == 0 ? rate * 12 * jahre : rate * (((1 + zins / 100 / 12) ^ (12 * jahre) - 1) / (zins / 100 / 12))` |
| Trinkgeld pro Person | `(rechnung * (1 + trinkgeld / 100)) / max(personen, 1)` |
| BMI | `gewicht / (groesse / 100) ^ 2` |
| BMI-Kategorie (1-4) | `bmi < 18.5 ? 1 : bmi < 25 ? 2 : bmi < 30 ? 3 : 4` |
| Netto -> Brutto (MwSt) | `netto * (1 + mwst / 100)` |
| Brutto -> Netto | `brutto / (1 + mwst / 100)` |
| Celsius -> Fahrenheit | `c * 9 / 5 + 32` |
| km <-> Meilen (toggle `meilen`) | `meilen ? km * 0.621371 : km` |
| Prozentuale Änderung (als Anteil, format percent) | `alt == 0 ? 0 : (neu - alt) / alt` |
| Runden auf 5 Cent | `round(preis * 20) / 20` |
| Begrenzen | `clamp(wert, 0, 100)` |
| Kreisfläche | `pi * r ^ 2` |
| Restlaufzeit in Monaten (format duration) | `ceil(schulden / max(rate, 1))` |

Pitfalls to tell the model: `%` is modulo, not percent; no `3,5`; no `a < b < c`; no strings or
`x.y`; only earlier outputs are referenceable; guard divisions that can hit zero (`b == 0 ? 0 : a / b`)
or accept the "–" result.
