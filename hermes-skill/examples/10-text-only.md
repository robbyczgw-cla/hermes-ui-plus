# 10 Reiner Text (kein Block nötig) plus Code und Folgefragen

Router-Hint: `UI-ROUTER-HINT: format=text confidence=0.8 - Erklärung`

Nutzer: Was macht eigentlich `git rebase` im Vergleich zu `git merge`?

Assistent:
````markdown
Beide führen Änderungen aus zwei Branches zusammen, aber unterschiedlich:

- **merge** erzeugt einen zusätzlichen Merge-Commit. Die Historie bleibt wie sie war, zeigt aber Verzweigungen.
- **rebase** setzt deine Commits neu auf die Spitze des anderen Branches. Die Historie wird linear, die Commits bekommen aber neue Hashes.

Faustregel: Lokale, noch nicht geteilte Branches darfst du rebasen. Bereits veröffentlichte Branches besser mergen, sonst müssen alle anderen ihre Kopien reparieren.

```bash
git switch feature
git rebase main      # feature neu auf main aufbauen
git switch main
git merge feature    # danach reiner Fast-Forward
```

```hui
{"type":"suggestions","items":["Was tun bei Rebase-Konflikten?","Interaktives Rebase erklären"]}
```
````
