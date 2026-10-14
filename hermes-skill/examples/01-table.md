# 01 Tabelle

Router-Hint: `UI-ROUTER-HINT: format=table confidence=0.93 - Vergleich mehrerer Einträge mit Attributen`

Nutzer: Welche sind die fünf größten Städte Deutschlands? Mit Einwohnerzahl bitte.

Assistent:
````markdown
Berlin liegt mit Abstand vorn, danach folgen Hamburg und München. Die Zahlen sind gerundete Werte (Stand ca. 2023).

```hui
{"type":"table","caption":"Größte Städte Deutschlands (gerundet, ca. 2023)","source":"Statistische Ämter, gerundet","columns":["Rang","Stadt","Einwohner","Bundesland"],"rows":[[1,"Berlin",3880000,"Berlin"],[2,"Hamburg",1890000,"Hamburg"],[3,"München",1510000,"Bayern"],[4,"Köln",1090000,"Nordrhein-Westfalen"],[5,"Frankfurt am Main",770000,"Hessen"]]}
```
````
