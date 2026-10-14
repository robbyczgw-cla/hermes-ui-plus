# 59 Wege vergleichen: Wo liegen die Dateien einer Linux-VM? (paths, nur Anzeige)

Router-Hint: `UI-ROUTER-HINT: format=paths confidence=0.8 - Varianten mit Bewertung`

Nutzer: Ich lasse auf meinem Mac eine Linux-VM laufen. Wo sollten die Projektdateien liegen: im Mac, in der VM-Disk oder in einem geteilten Ordner?

Assistent (2-6 Zeilen, kurze Knoten, eine Notizzeile, Empfehlung im Text):
````markdown
Am besten liegen die Dateien in macOS und die VM greift über einen geteilten Ordner zu: so bleiben sie im Backup und du nutzt trotzdem die Linux-Werkzeuge. Die VM-Disk solltest du nur für Systemdateien der VM verwenden.

```hui
{"type":"paths","id":"dateien-ort","title":"Wo liegen die Dateien?","items":[{"id":"nativ","title":"Nativ in macOS","badge":{"text":"Ausgangsbasis","tone":"neutral"},"path":[{"label":"macOS","icon":"laptop"},{"label":"APFS","icon":"disk"},{"label":"interne SSD","icon":"disk"}],"note":"Schnellster Zugriff, Time Machine sichert alles mit."},{"id":"vm-disk","title":"In der VM-Disk","badge":{"text":"Vermeiden","tone":"bad"},"path":[{"label":"macOS","icon":"laptop"},{"label":"Linux-VM","icon":"vm"},{"label":"ext4-Image","icon":"file"},{"label":"SSD","icon":"disk"}],"note":"Alles steckt in einer Image-Datei, Backup und Zugriff aus macOS sind umständlich."},{"id":"geteilt","title":"Geteilter Ordner","badge":{"text":"Interessant","tone":"good"},"path":[{"label":"Linux-VM","icon":"vm"},{"label":"virtiofs","icon":"folder"},{"label":"macOS-Ordner","icon":"folder"},{"label":"APFS","icon":"disk"}],"note":"Linux-Werkzeuge in der VM, die Dateien bleiben in macOS gesichert."}]}
```
````
