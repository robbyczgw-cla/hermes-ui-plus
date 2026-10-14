# invalid 61: blocks written with common model variants

Must FAIL. A model wrote the `blocks` node with `cols` instead of `columns`, `boxes` instead of `items`, string
boxes, `subtitle` instead of `sub`, `framed:true` instead of `style:"framed"` and `shared` instead of `base`. The app
maps all of these (the boxes still render), but the skill contract is
`columns:[{title, items:[{label, sub?, style?}], base?}]` with 1-3 columns.

<!-- expect: unknown field (use "columns") -->
<!-- expect: 1-3 columns -->
<!-- expect: unknown field (use "items") -->
<!-- expect: unknown field (use "base") -->
<!-- expect: box must be {label, sub?, icon?, style?, tone?} -->
<!-- expect: unknown field (use "sub") -->
<!-- expect: unknown field (use style:"framed") -->

````markdown
So sind die beiden Varianten aufgebaut.

```hui
{"type":"blocks","title":"Aufbau","cols":[{"title":"OrbStack","boxes":["Agent 1","Agent 2"],"shared":"1 Linux-Kernel"},{"title":"Parallels","boxes":[{"label":"Agent 1","subtitle":"Kernel 1","framed":true}]}]}
```
````
