# ask the user: form, choice, slots, confirm, scale, rank, poll, decision

Ask, then STOP: one short sentence + the node, no answer yet. Max one input node per answer. Options concrete and exclusive; free text via `allowOther`. Every input node needs a unique short `id`; the app locks it after the answer, never re-show it. Replies are user messages: use the values, answer directly.

## choice (ONE decision, 2-6 options, instead of a prose question; single select sends on tap)
{id, question?, options:[{id?, label, description?, icon?:emoji}], multiple?, min?, max?, allowOther?, layout?, submitLabel?}  reply: `[choice:<id>] <question> → <label>, <label>` (+ `Andere: <text>`)
{"type":"choice","id":"stil","question":"Welcher Reisestil passt zu dir?","options":[{"label":"Städtetrip","description":"Museen, Cafés, viel zu Fuß","icon":"🏙️"},{"label":"Natur","description":"Wandern, Seen","icon":"🥾"},{"label":"Strand","icon":"🏖️"}],"allowOther":true}
multi select (needs submit): add "multiple":true,"min":1,"max":3,"submitLabel":"Weiter". Option with photo: "imageQuery":"Lissabon".

## form (3+ input values)  reply: `[form:<id>] {json}`
{id, title?, fields:[{name, label, kind:"text"|"number"|"slider"|"select"|"toggle"|"date", placeholder?, min?, max?, step?, unit?, options?:string[], default?}], submit:{label}}
{"type":"form","id":"trip","title":"Reise planen","fields":[{"name":"ziel","label":"Ziel","kind":"text","placeholder":"z. B. Rom"},{"name":"tage","label":"Tage","kind":"slider","min":1,"max":14,"step":1,"default":4},{"name":"budget","label":"Budget","kind":"number","unit":"€","default":900},{"name":"stil","label":"Stil","kind":"select","options":["Kultur","Natur","Strand"]},{"name":"fruehstueck","label":"Frühstück inklusive","kind":"toggle","default":true},{"name":"ab","label":"Abreise","kind":"date"}],"submit":{"label":"Vorschlag erstellen"}}
Never collect secrets in forms. Several ratings at once: form.

## slots (propose appointment times)  reply: `[slot:<id>] <label>` or `keiner passt` (ask for their availability)
{id, title?, slots:[{id?, start, end?, label?}] (ISO local), timezone?}
slots (propose appointment times; the app always adds "Keiner passt"; only offer times you can justify, e.g. from a calendar tool)
{"type":"slots","id":"termin","title":"Wann passt es?","timezone":"Europe/Berlin","slots":[{"id":"a","start":"2026-11-03T10:00","end":"2026-11-03T10:30","label":"Di, 3. Nov., 10:00"},{"id":"b","start":"2026-11-04T15:00","end":"2026-11-04T15:30","label":"Mi, 4. Nov., 15:00"}]}

## confirm (yes/no on your proposal)  reply: `[confirm:<id>] ja|nein`: ja = proceed (claim success only if a tool did it, else offer a button); nein = drop it, ask what instead
{id, title, text?, confirmLabel?, cancelLabel?}
{"type":"confirm","id":"lang","title":"Auf Italienisch umstellen?","text":"Dann bekommst du die Vokabeln mit Aussprachehilfe.","confirmLabel":"Ja, umstellen","cancelLabel":"Nein"}

## scale (ONE rating question; sends on tap)  reply: `[scale:<id>] 4/5` (react briefly)
{id, question, min?:1, max?:5, step?, style?:"slider"|"stars"|"emoji"|"segments" (<=10 steps), labels?:{min?, max?}, emojis?}
{"type":"scale","id":"training","question":"Wie gut war das Training heute?","min":1,"max":5,"style":"stars","labels":{"min":"Schlecht","max":"Super"}}

## rank (order by taste or priority, not facts)  reply: `[rank:<id>] 1. A · 2. B`
{id, prompt?, items:[{id?, label, description?}] (2-10), submitLabel?}
{"type":"rank","id":"prio","prompt":"Was ist dir im Urlaub am wichtigsten?","items":[{"label":"Strand","description":"Baden, Liegen"},{"label":"Wandern"},{"label":"Städte"},{"label":"Essen"}],"submitLabel":"Reihenfolge senden"}

## poll (only when SEVERAL people decide; one person: choice)  reply: `[poll:<id>] Pizza 3 · Sushi 1 (4 Stimmen)` (name winner/tie, offer next step, never re-show)
{id, question, options:[{id?, label, emoji?}] (2-8), multiple?, voters?:string[] (names for pass-the-phone), allowAdd?, anonymous?}
{"type":"poll","id":"essen","question":"Was essen wir am Samstag?","options":[{"label":"Pizza","emoji":"🍕"},{"label":"Sushi","emoji":"🍣"},{"label":"Burger","emoji":"🍔"}]}

## decision (weighted matrix)  reply: `[decision:<id>] Gewinner: B (7,8) · Gewichte: Preis 8, …` (comment the winner, how close it is, which weight would flip it)
{id, title?, criteria:[{id?, label, weight 0-10}] (2-8), options:[{id?, label, scores:{<criterion id>:0-10}, note?}] (2-6), note?}
Every criterion needs an `id`, `scores` keyed by it; weights = the user's priorities (else say your assumption); scores = your estimate (say so in `note`). Two options without weights: `compare`.
{"type":"decision","id":"wohnung","title":"Welche Wohnung?","criteria":[{"id":"preis","label":"Preis","weight":9},{"id":"lage","label":"Lage","weight":8},{"id":"balkon","label":"Balkon","weight":4}],"options":[{"label":"Wohnung A","scores":{"preis":5,"lage":9,"balkon":3},"note":"Altbau, zentral"},{"label":"Wohnung B","scores":{"preis":9,"lage":4,"balkon":7},"note":"Neubau, Stadtrand"}],"note":"Bewertungen sind eine Schätzung."}
