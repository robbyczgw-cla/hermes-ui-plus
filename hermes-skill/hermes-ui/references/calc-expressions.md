# calc: node and expressions (safe engine, no eval)

{id, title?, basis?, inputs:[{name, label, kind:"slider"|"number"|"select"|"toggle", min?, max?, step?, default, unit?, options?:[{label,value}]}], outputs:[{name?, label, expr, format?:"number"|"currency"|"percent"|"duration"|"integer", decimals?, unit?, emphasis?}], chart?:{kind:"line"|"bar", sweep:{input, from, to, steps}, y:expr, label?}, note?}  reply: `[calc:<id>] Loan 20,000 € · Interest 4.5 % → Payment 372.86 €` (labels from your node, numbers in the app's format)
`expr` uses input names + EARLIER output names; percent inputs `/ 100`, decimal POINT, guard zero divisors, assumptions in `note`. Labels, units and `note` in the user's language. Orientation only. Missing amounts: realistic defaults, the user moves the sliders. Replaces hui-html calculators, converters, what-if, bill split.
{"type":"calc","id":"tip","title":"Split the bill","basis":"calculated","inputs":[{"name":"bill","label":"Bill amount","kind":"number","default":84.5,"unit":"€"},{"name":"tip","label":"Tip","kind":"slider","min":0,"max":20,"step":1,"default":10,"unit":"%"},{"name":"people","label":"People","kind":"slider","min":1,"max":12,"step":1,"default":4}],"outputs":[{"name":"total","label":"Total with tip","expr":"bill * (1 + tip / 100)","format":"currency"},{"label":"Per person","expr":"total / max(people, 1)","format":"currency","emphasis":true}],"note":"Tip on the total; cent rounding not distributed."}
Optional chart: "chart":{"kind":"line","sweep":{"input":"people","from":1,"to":12,"steps":12},"y":"total / people","label":"Per person"}

Used in `calc.outputs[].expr` and `calc.chart.y`. Identifiers = input `name`s + EARLIER named outputs. Names: letters/digits/underscore
(`loan`, `months`, `height`); avoid `e` and `pi` as names. Write every number with a decimal POINT.

## Grammar
- Operators high to low: `^` (right-assoc, `2^3^2=512`, `(1+r)^-n` ok) · unary `- + !` · `* / %` · `+ -` · `< <= > >=` · `== !=` · `&&` · `||` · `c ? a : b`.
- `%` is MODULO, not percent. Percent inputs are divided by 100 inside the expression (`rate / 100`).
- Constants `pi`, `e`. Functions: `min max` (1+ args) · `round(x)` / `round(x, d)` · `floor ceil abs sqrt` · `pow(x,y)` · `log` (base 10) · `ln` · `exp` · `clamp(x, lo, hi)` · `if(c, a, b)`.
- Toggle inputs are 1/0. Comparisons give 1/0. Division by zero, `sqrt(-1)`, `log(0)` give "–" and propagate; a dead ternary branch is not evaluated.
- NOT available: strings, `a.b`, `[]`, `{}`, `=`, `;`, single `&`/`|`, `3,5` (decimal comma), `1.000` thousands dots (that is 1.0; write `1000` or `1_000`), chained `a < b < c`, unknown names (error shown to the user).
- Limits: 500 chars, nesting depth 50, 200 AST nodes (avoid sums of > ~49 terms). Chart sweep: max 60 steps.

## Formats (`outputs[].format`, shown in the app's number format)
`number` (max 2 decimals) · `integer` · `currency` (EUR, 2 decimals) · `percent` (value is a FRACTION: 0.045 shows 4.5 %; if already in percent units use `number` + `unit:"%"`) · `duration` (value in MONTHS: 63 shows 5 years 3 months). `decimals` fixes fraction digits; `unit` is appended (ignored for duration).

## Inputs
`slider` {min,max,step,default,unit} (bounded values) · `number` (free amounts) · `select` {options:[{label,value}]} (value numeric) · `toggle` (1/0). Always give `default` inside min/max; 2-6 inputs; 1-4 outputs, mark the main one `emphasis:true`.

## Ready expressions
| Use case | Expression |
|---|---|
| Compound interest (yearly) | `capital * (1 + rate / 100) ^ years` |
| Savings plan (`monthly` deposit, `rate` p.a.) | `rate == 0 ? monthly * 12 * years : monthly * (((1 + rate / 100 / 12) ^ (12 * years) - 1) / (rate / 100 / 12))` |
| Tip per person | `(bill * (1 + tip / 100)) / max(people, 1)` |
| BMI | `weight / (height / 100) ^ 2` |
| BMI category (1-4) | `bmi < 18.5 ? 1 : bmi < 25 ? 2 : bmi < 30 ? 3 : 4` |
| Net -> gross (VAT) | `net * (1 + vat / 100)` |
| Gross -> net | `gross / (1 + vat / 100)` |
| Celsius -> Fahrenheit | `c * 9 / 5 + 32` |
| km <-> miles (toggle `miles`) | `miles ? km * 0.621371 : km` |
| Percent change (format percent) | `before == 0 ? 0 : (after - before) / before` |
| Round to 5 cents | `round(price * 20) / 20` |
| Clamp | `clamp(value, 0, 100)` |
| Circle area | `pi * r ^ 2` |
| Months to pay off (format duration) | `ceil(debt / max(payment, 1))` |
| Discount | `price * (1 - discount / 100)` |

## Rules
- Show units on inputs and outputs; state formula/assumptions in `note` (one line).
- Rounded shares must sum to the total: compute the last share as `total - (n - 1) * share` instead of rounding every share.
- Guard divisions that can hit zero (`b == 0 ? 0 : a / b`) or accept "–". Keep defaults realistic; the user can reset in the app.
- Do not claim a payment, booking or contract: results are orientation only.
