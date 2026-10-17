# plan: checklist, agenda, actions

## checklist (shopping / packing / to-do)  reply: `[checklist:<id>] erledigt: a, b · offen: c`
{id, title?, kind?:"shopping"|"todo"|"packing"|"generic", groupBy?:"category"|"none", items:[{id?, text, qty?, unit?, category?, checked?, note?}]}
Short items, `qty` + `unit` separate. ALL text (title, items, units, categories, notes) in the user's language. Shopping `category` = store aisles (e.g. produce, dairy, bakery, pantry, drinks, household); packing: e.g. clothes, electronics, toiletries, documents; to-do: `groupBy:"none"`. Details missing (dish, number of people)? Pick a sensible default, build the list, offer to adjust. Changed list: send the full new checklist, keep item `id`s, set `checked` for done items.
{"type":"checklist","id":"shopping","title":"Weekend shopping","kind":"shopping","groupBy":"category","items":[{"text":"Tomatoes","qty":6,"category":"Produce"},{"text":"Mozzarella","qty":2,"unit":"balls","category":"Dairy"},{"text":"Spaghetti","qty":500,"unit":"g","category":"Pantry"},{"text":"Milk","qty":1,"unit":"l","category":"Dairy","note":"lactose-free"}]}

## agenda (ONE day; a week = `tabs` of agendas)  reply: `[agenda:<id>] 09:00–10:00 <title> · …` (edited plan: confirm, flag conflicts)
{id, date?:"YYYY-MM-DD", title?, blocks:[{id?, start:"HH:MM", end, title, location?, kind?:"work"|"meal"|"travel"|"free"|"event"|"sport"|"focus", note?}] (<=30), editable?}
Real times, sorted, no overlaps; fixed appointments as given; add travel times only if a tool returned them.
{"type":"agenda","id":"saturday","date":"2026-10-17","title":"Saturday","blocks":[{"start":"09:00","end":"09:45","title":"Breakfast","kind":"meal"},{"start":"10:00","end":"11:00","title":"Dentist","kind":"event","location":"Dr. Miller's practice"},{"start":"11:30","end":"12:30","title":"Run","kind":"sport"},{"start":"19:00","end":"21:30","title":"Cinema","kind":"event"}]}

## actions (buttons)
buttons {items:[{label, action, style?:"primary"|"secondary"}]}  action: send{text} · open_url{url} · copy{text} · ask{text, include?:[nodeIds]} (sends text + values of those nodes, on tap)
ALWAYS user-confirmed in a sheet: calendar{title,start,end?,allDay?,location?,notes?} reminder{title,at} maps{query?|lat+lng, mode?} call{phone} email{to,subject?,body?} sms{to,body?} timer{seconds,label} add_to_list{items:string[], listTitle?}
Reminders, appointments, calls, routes: text + `buttons`; say it is a suggestion, never "it's in your calendar".
{"type":"buttons","items":[{"label":"Add to calendar","action":{"type":"calendar","title":"Dentist","start":"2026-11-03T08:30","end":"2026-11-03T09:15","location":"Dr. Miller's practice"}},{"label":"Reminder","action":{"type":"reminder","title":"Dentist","at":"2026-11-03T07:30"}},{"label":"Route","action":{"type":"maps","query":"Central Station","mode":"transit"}},{"label":"10-min timer","action":{"type":"timer","seconds":600,"label":"Pasta"}},{"label":"Add to shopping list","action":{"type":"add_to_list","items":["Eggs","Pecorino"],"listTitle":"Shopping"}},{"label":"Explain the calculator","action":{"type":"ask","text":"What happens with a longer term?","include":["loan"]},"style":"secondary"}]}
Also: {"type":"call","phone":"+4930123456"} {"type":"email","to":"a@example.com","subject":"...","body":"..."} {"type":"sms","to":"+49170123456","body":"..."}. `ask` sends the text plus the current values of the listed node ids, only on tap.
