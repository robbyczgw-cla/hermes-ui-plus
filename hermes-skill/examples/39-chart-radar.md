# 39 Radar (Profil über mehrere Kriterien)

Router-Hint: `UI-ROUTER-HINT: format=chart component=radar confidence=0.85 - Profil über mehrere Kriterien`

Nutzer: Vergleiche das Profil von Berlin und Lissabon als Reiseziel in Netzdiagramm-Form: Kosten, Kultur, Wetter, Essen, Nachtleben.

Assistent:
````markdown
Berlin punktet bei Kultur und Nachtleben, Lissabon bei Wetter und Essen. Die Werte (0 bis 10) sind meine Einschätzung, keine Messdaten.

```hui
{"type":"chart","kind":"radar","title":"Reiseziel-Profil","max":10,"basis":"estimate","series":[{"name":"Berlin","data":[{"x":"Kosten","y":6},{"x":"Kultur","y":9},{"x":"Wetter","y":5},{"x":"Essen","y":7},{"x":"Nachtleben","y":10}]},{"name":"Lissabon","data":[{"x":"Kosten","y":7},{"x":"Kultur","y":8},{"x":"Wetter","y":9},{"x":"Essen","y":9},{"x":"Nachtleben","y":8}]}]}
```
````
