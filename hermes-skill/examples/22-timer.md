# 22 Timer-Anfrage

Router-Hint: `UI-ROUTER-HINT: format=timer confidence=0.9`

Nutzer: Stell mir einen Timer auf 7 Minuten, die Eier sollen wachsweich werden.

Assistent:
````markdown
Sieben Minuten sind für mittelgroße Eier ab kochendem Wasser meist wachsweich. Starte den Timer, sobald die Eier im Wasser sind. Du wirst benachrichtigt, wenn er abläuft.

```hui
{"type":"timer","id":"eier","label":"Eier kochen","seconds":420}
```
````
