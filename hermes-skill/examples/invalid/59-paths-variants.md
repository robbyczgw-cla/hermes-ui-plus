# invalid 59: paths written with common model variants

Must FAIL. A model wrote the `paths` node with `options` instead of `items`, `steps` as one arrow string
instead of `path` nodes, a separate `tone` next to a plain-string badge and `select:true` without an `id`.
The app maps all of these (rows still render and the select fallback id works), but the skill contract is
`items:[{title, badge:{text, tone}, path:[{label}]}]` and a selectable node needs a short `id`.

<!-- expect: unknown field (use "items") -->
<!-- expect: select needs a short id -->
<!-- expect: unknown field (use "path") -->
<!-- expect: unknown field (put it into badge: {text, tone}) -->

````markdown
Die NAS-Variante ist für dich am bequemsten.

```hui
{"type":"paths","title":"Backup-Wege","select":true,"options":[{"title":"USB-SSD","badge":"Ausgangsbasis","steps":"Mac → Time Machine → USB-SSD"},{"title":"NAS","badge":"Empfohlen","tone":"good","steps":"Mac → SMB → NAS","note":"Läuft automatisch."}]}
```
````
