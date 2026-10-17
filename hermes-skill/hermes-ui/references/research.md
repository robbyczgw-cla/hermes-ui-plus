# research: summary, sources and footnotes, entity links, tabs

## summary (TL;DR head, not interactive)
{text (<=600), points?:string[] (<=4, each <=200), verdict?: string (<=200)}
- ONLY for long answers (> ~250 words: research, comparisons, reports, explainers). FIRST node of the answer, followed by the details (Markdown sections, tables). Never on short answers, chat, or answers that are one node.
- `text` = the result in 1-3 sentences; `points` = the key takeaways; `verdict` = recommendation/bottom line. No new facts that are not in the details.
{"type":"summary","text":"For your budget a used compact car with a petrol engine is the better deal. An electric car only pays off from about 15,000 km a year.","points":["Used saves 35-45 % compared with new","Electric maintenance about 30 % cheaper","Charging at home decides the running costs"],"verdict":"Recommendation: Golf or i30, 3-5 years old"}

## sources + footnotes
sources {items:[{title, url, snippet?, siteName?}]} (URLs only from tools/user, never constructed)
After researching with sources: put a `sources` node at the END of the answer and cite with `[^1]`, `[^2]` right after the sentence they support (number = 1-based position in `sources.items`; max 12). Only cite items you really used; one claim, one or two footnotes. No `[^n]` without a matching sources item, and no footnote syntax in answers without sources.
The rail operator plans to digitise all main lines by 2030.[^1] The cost is estimated at €8 billion.[^2]
{"type":"sources","items":[{"title":"Digital rail programme","url":"https://example.org/dsd","siteName":"example.org","snippet":"Programme to digitise the rail infrastructure."},{"title":"Audit office cost estimate","url":"https://example.org/brh"}]}

## Entity links in Markdown (`hui:` scheme; tappable chips in normal Markdown text, not inside code)
`[label](hui:<kind>?<params>)` with URL-encoded params (`%20`, `%2B`). Tag only values you are sure about.
- place: `[Colosseum](hui:place?q=Colosseum%20Rome)` → map / route / copy. `q` = searchable name + city.
- date: `[Oct 12, 9:00](hui:date?start=2026-10-12T09:00&end=2026-10-12T10:00&title=Dentist)` → add to calendar. `start` ISO local, `end`/`title` optional.
- tel: `[+43 660 1234567](hui:tel?n=%2B436601234567)` → call / SMS / copy. Only numbers a tool or the user gave.
- price: `[€ 249](hui:price?v=249&c=EUR&q=Sony%20WH-1000XM6)` → copy / search product. `v` number, `c` currency, `q` product.
Tag the first mention of each entity in an answer; don't tag everything. The app also auto-detects plain phone numbers, e-mail and dates, so untagged ones still work.

## tabs / accordion (long content in parts: days, FAQ; children are normal nodes, keep each short)
tabs {tabs:[{label, children[]}]}  accordion {items:[{title, children[]}], open?}
{"type":"tabs","tabs":[{"label":"Day 1","children":[{"type":"timeline","items":[{"time":"09:00","title":"Colosseum"},{"time":"13:00","title":"Lunch in Monti"}]}]},{"label":"Day 2","children":[{"type":"list","items":[{"title":"Vatican"},{"title":"Trastevere"}]}]}]}
{"type":"accordion","open":0,"items":[{"title":"How long is the ticket valid?","children":[{"type":"text","text":"24 hours from validation."}]},{"title":"Are there discounts?","children":[{"type":"text","text":"Yes, for children up to 14."}]}]}
