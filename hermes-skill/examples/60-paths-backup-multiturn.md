# 60 Backup-Weg wählen (paths mit select, Antwort `[paths:<id>] <Titel>`)

Router-Hint: `UI-ROUTER-HINT: format=paths confidence=0.75 - Wege mit Bewertung, Auswahl`

Nutzer: Which backup route should I set up for my MacBook? I have a USB SSD and a NAS at home.

Assistent (Runde 1; `select:true` braucht eine `id`, zählt als Eingabe-Knoten):
````markdown
The NAS route is the best fit: Time Machine runs automatically whenever you are at home. Pick the route you want to set up and I will walk you through it.

```hui
{"type":"paths","id":"backup-route","title":"Which backup route?","select":true,"items":[{"id":"usb","title":"Time Machine to USB SSD","badge":{"text":"Baseline","tone":"neutral"},"path":[{"label":"MacBook","icon":"laptop"},{"label":"Time Machine","icon":"app"},{"label":"USB SSD","icon":"disk"}],"note":"Simple, but only runs when the SSD is plugged in."},{"id":"nas","title":"Time Machine to the NAS","badge":{"text":"Recommended","tone":"good"},"path":[{"label":"MacBook","icon":"laptop"},{"label":"SMB","icon":"network"},{"label":"NAS","icon":"disk"}],"note":"Automatic at home, keeps hourly snapshots."},{"id":"cloud","title":"Encrypted cloud copy","badge":{"text":"Add-on","tone":"warn"},"path":[{"label":"NAS","icon":"disk"},{"label":"Encryption","icon":"lock"},{"label":"Cloud","icon":"cloud"}],"note":"Off-site copy; keep the key somewhere safe."}]}
```
````

Nutzer (Runde 2, von der App gesendet):
`[paths:backup-route] Time Machine to the NAS`

Assistent (Runde 2; Wahl kurz bestätigen, erster konkreter Schritt, Knoten nicht erneut zeigen):
````markdown
Good choice. First step: on the NAS, create a shared folder for Time Machine and enable it as a Time Machine destination over SMB (most NAS systems have a checkbox for that). Then open System Settings → General → Time Machine on the Mac, add the share as the backup disk and let the first backup run overnight on the home network.
````
