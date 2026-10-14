# 61 Architektur auf einen Blick: geteilter Kernel vs. eigene VMs (blocks, nur Anzeige)

Router-Hint: `UI-ROUTER-HINT: format=blocks confidence=0.75 - Aufbau auf einen Blick`

Nutzer: Wie unterscheiden sich OrbStack und Parallels im Aufbau, wenn ich vier Agenten laufen lasse?

Assistent (1-3 Spalten, kurze Box-Labels, gemeinsame Schicht als `base`, ehrliche Bildunterschrift, Kernaussage im Text):
````markdown
OrbStack lässt alle vier Agenten auf einem gemeinsamen Linux-Kernel laufen, Parallels startet für jeden Agenten eine eigene VM mit eigenem Kernel. Das spart bei OrbStack Speicher und Startzeit, die VMs sind dafür stärker voneinander getrennt.

```hui
{"type":"blocks","id":"mac-vm-aufbau","title":"Vier Agenten auf dem Mac","columns":[{"title":"OrbStack","grid":2,"items":[{"label":"Agent 1","icon":"container"},{"label":"Agent 2","icon":"container"},{"label":"Agent 3","icon":"container"},{"label":"Agent 4","icon":"container"}],"base":{"label":"1 Linux-Kernel","sub":"Gemeinsam genutzt","icon":"terminal"}},{"title":"Parallels","grid":2,"items":[{"label":"Agent 1","sub":"Kernel 1","icon":"vm","style":"framed"},{"label":"Agent 2","sub":"Kernel 2","icon":"vm","style":"framed"},{"label":"Agent 3","sub":"Kernel 3","icon":"vm","style":"framed"},{"label":"Agent 4","sub":"Kernel 4","icon":"vm","style":"framed"}]}],"caption":"Vereinfachtes Architekturmodell – ein geteilter Kernel vs. ein Kernel pro VM."}
```
````
