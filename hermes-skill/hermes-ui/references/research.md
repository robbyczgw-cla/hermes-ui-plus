# research: summary, sources and footnotes, entity links, tabs

## summary (TL;DR head, not interactive)
{text (<=600), points?:string[] (<=4, each <=200), verdict?: string (<=200)}
- ONLY for long answers (> ~250 words: research, comparisons, reports, explainers). FIRST node of the answer, followed by the details (Markdown sections, tables). Never on short answers, chat, or answers that are one node.
- `text` = the result in 1-3 sentences; `points` = the key takeaways; `verdict` = recommendation/bottom line. No new facts that are not in the details.
{"type":"summary","text":"Für dein Budget lohnt sich ein gebrauchter Kompaktwagen mit Benzinmotor. Ein Elektroauto rechnet sich erst ab etwa 15.000 km pro Jahr.","points":["Gebraucht spart 35-45 % gegenüber neu","Wartung Elektro ca. 30 % günstiger","Laden zu Hause entscheidet über die Kosten"],"verdict":"Empfehlung: Golf oder i30, 3-5 Jahre alt"}

## sources + footnotes
sources {items:[{title, url, snippet?, siteName?}]} (URLs only from tools/user, never constructed)
After researching with sources: put a `sources` node at the END of the answer and cite with `[^1]`, `[^2]` right after the sentence they support (number = 1-based position in `sources.items`; max 12). Only cite items you really used; one claim, one or two footnotes. No `[^n]` without a matching sources item, and no footnote syntax in answers without sources.
Die Bahn will bis 2030 alle Hauptstrecken digitalisieren.[^1] Die Kosten werden auf 8 Mrd. € geschätzt.[^2]
{"type":"sources","items":[{"title":"Digitale Schiene Deutschland","url":"https://example.org/dsd","siteName":"example.org","snippet":"Programm zur Digitalisierung der Bahninfrastruktur."},{"title":"Kostenschätzung Bundesrechnungshof","url":"https://example.org/brh"}]}

## Entity links in Markdown (`hui:` scheme; tappable chips in normal Markdown text, not inside code)
`[label](hui:<kind>?<params>)` with URL-encoded params (`%20`, `%2B`). Tag only values you are sure about.
- place: `[Kolosseum](hui:place?q=Kolosseum%20Rom)` → map / route / copy. `q` = searchable name + city.
- date: `[12. Okt, 9:00](hui:date?start=2026-10-12T09:00&end=2026-10-12T10:00&title=Zahnarzt)` → add to calendar. `start` ISO local, `end`/`title` optional.
- tel: `[+43 660 1234567](hui:tel?n=%2B436601234567)` → call / SMS / copy. Only numbers a tool or the user gave.
- price: `[€ 249](hui:price?v=249&c=EUR&q=Sony%20WH-1000XM6)` → copy / search product. `v` number, `c` currency, `q` product.
Tag the first mention of each entity in an answer; don't tag everything. The app also auto-detects plain phone numbers, e-mail and dates, so untagged ones still work.

## tabs / accordion (long content in parts: days, FAQ; children are normal nodes, keep each short)
tabs {tabs:[{label, children[]}]}  accordion {items:[{title, children[]}], open?}
{"type":"tabs","tabs":[{"label":"Tag 1","children":[{"type":"timeline","items":[{"time":"09:00","title":"Kolosseum"},{"time":"13:00","title":"Mittagessen in Monti"}]}]},{"label":"Tag 2","children":[{"type":"list","items":[{"title":"Vatikan"},{"title":"Trastevere"}]}]}]}
{"type":"accordion","open":0,"items":[{"title":"Wie lange ist das Ticket gültig?","children":[{"type":"text","text":"24 Stunden ab Entwertung."}]},{"title":"Gibt es Ermäßigung?","children":[{"type":"text","text":"Ja, für Kinder bis 14."}]}]}
