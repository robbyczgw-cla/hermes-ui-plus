# 62 Setup at a glance: apps, bridge and agent (blocks, display only)

Router-Hint: `UI-ROUTER-HINT: format=blocks confidence=0.75 - setup at a glance`

Nutzer: How is Hermes UI+ set up? Which parts run where?

Assistent (columns = tiers, the shared server as `base`, caption says it is simplified):
````markdown
The apps on your phone, in the browser and on the Mac only talk to the UI-Bridge; the bridge and the Hermes Agent both run on your own server, so your chats never leave it.

```hui
{"type":"blocks","id":"hui-setup","title":"Hermes UI+ setup","columns":[{"title":"Apps","grid":3,"items":[{"label":"Phone app","icon":"phone"},{"label":"Web app","icon":"globe"},{"label":"Mac app","icon":"laptop"}]},{"title":"On your server","grid":2,"items":[{"label":"UI-Bridge","sub":"router + push","icon":"server","style":"framed"},{"label":"Hermes Agent","sub":"tools + memory","icon":"app","style":"framed"}],"base":{"label":"Your server","sub":"Linux box, NAS or Mac","icon":"server"}}],"caption":"Simplified – the apps only talk to the bridge, the bridge forwards every turn to Hermes."}
```
````
