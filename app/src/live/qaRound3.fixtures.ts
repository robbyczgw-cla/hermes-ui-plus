// Verbatim transcripts from the 0.2 real-user round 3 (default bridge as a pure Hermes pass-through, router heuristic,
// claude-haiku-4-5, German UI): message texts as stored by the app, user messages with the live-card batches their
// `[hui:live]` trailer carried. No personal data (made-up watchlist, shopping list, trip choice and day plan). Used by
// qaRound3*.test.ts.
import type { FixtureMessage } from './qaRound2.fixtures.ts';

export const QA_ROUND3: Record<'watchlist' | 'shopping' | 'calculator' | 'agenda', FixtureMessage[]> = {
 "watchlist": [
  {
   "id": "u-429f38296d4b8649",
   "role": "user",
   "text": "Ich will iPhone 16 und Pixel 9 auf einer Watchlist behalten. Gib mir eine Liste mit Zielpreisen 600 und 500 Euro, damit ich die Angebote später vergleichen kann. Preise musst du jetzt nicht suchen.",
   "createdAt": 1792494078175
  },
  {
   "id": "a-6d8184584dfb20e4",
   "role": "assistant",
   "text": "Ich erstelle dir eine Live-Watchlist für die beiden Phones mit deinen Zielpreisen:\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"phone-watchlist\",\n  \"title\": \"Smartphone-Watchlist\",\n  \"live\": true,\n  \"items\": [\n    {\n      \"text\": \"iPhone 16\",\n      \"trailing\": \"Ziel: 600€\"\n    },\n    {\n      \"text\": \"Pixel 9\",\n      \"trailing\": \"Ziel: 500€\"\n    }\n  ]\n}\n```\n\nDie Liste ist gespeichert und du kannst sie jederzeit aktualisieren — einfach Items abhaken, wenn du Angebote findest, oder neue hinzufügen. Wenn du später aktuelle Preise und Angebote vergleichen möchtest, kann ich die für dich recherchieren.",
   "createdAt": 1792494078175
  },
  {
   "id": "u-f50ed3d30911e356",
   "role": "user",
   "text": "Beim Pixel ist mein Ziel jetzt 450 Euro. iPhone streichen, das interessiert mich nicht mehr.",
   "createdAt": 1792494089114
  },
  {
   "id": "a-5e34f47de1b59bf4",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"phone-watchlist\",\n  \"title\": \"Smartphone-Watchlist\",\n  \"live\": true,\n  \"items\": [\n    {\n      \"text\": \"Pixel 9\",\n      \"trailing\": \"Ziel: 450€\"\n    }\n  ]\n}\n```\n\nErledigt — iPhone weg, Pixel-Ziel auf 450€ gesenkt.",
   "createdAt": 1792494089114
  },
  {
   "id": "u-52101731376a83aa",
   "role": "user",
   "text": "Was steht noch auf meiner Watchlist? Mehr Details bitte.",
   "createdAt": 1792494093498
  },
  {
   "id": "a-8429df5d461b8ced",
   "role": "assistant",
   "text": "Auf deiner Watchlist steht aktuell nur noch:\n\n**Pixel 9** mit einem Zielpreis von 450 Euro.\n\nDas ist dein Preisziel für einen Kauf — sobald du das Gerät zu diesem Preis oder günstiger findest, lohnt sich ein Zugriff. Die Liste ist leer ansonsten; wenn du später andere Produkte beobachten möchtest, kann ich sie einfach hinzufügen.",
   "createdAt": 1792494093498
  }
 ],
 "shopping": [
  {
   "id": "u-0cea95f3547c0462",
   "role": "user",
   "text": "Einkaufslsite für Samstag: Milch, Brot und Tomaten. Eier haben wir schon. Zum Abhaken bitte.",
   "createdAt": 1792493946937
  },
  {
   "id": "a-0c27bdb74b2b7523",
   "role": "assistant",
   "text": "\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"shopping_saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Milch\"},\n    {\"text\": \"Brot\"},\n    {\"text\": \"Tomaten\"}\n  ]\n}\n```\n\nDeine Einkaufsliste für Samstag ist fertig. Die Eier lasse ich weg. Häkchen beim Abholen — sag mir Bescheid, wenn du abhaken möchtest.",
   "createdAt": 1792493946937
  },
  {
   "id": "u-7dde0c07c55b0051",
   "role": "user",
   "text": "Noch Hafermilch und Äpfel dazu bitte, normale Milch streichen.",
   "createdAt": 1792493972569,
   "live": {
    "shopping-saturday": {
     "v": 0,
     "create": "checklist",
     "state": {
      "items": [
       {
        "id": "milch",
        "text": "Milch"
       },
       {
        "id": "brot",
        "text": "Brot"
       },
       {
        "id": "tomaten",
        "text": "Tomaten"
       }
      ],
      "title": "Einkaufsliste Samstag",
      "kind": "generic"
     },
     "bid": "b-mvgkmjde7ny38"
    }
   }
  },
  {
   "id": "a-abd993c1e4729e14",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"shopping_saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\"},\n    {\"text\": \"Brot\"},\n    {\"text\": \"Tomaten\"},\n    {\"text\": \"Äpfel\"}\n  ]\n}\n```\n\nErledigt — normale Milch raus, Hafermilch und Äpfel rein.",
   "createdAt": 1792493972569
  },
  {
   "id": "u-4b13b72a84624b7d",
   "role": "user",
   "text": "Tomaten hab ich schon. Was fehlt noch?",
   "createdAt": 1792493979518
  },
  {
   "id": "a-a5e50a5f7c8fb53b",
   "role": "assistant",
   "text": "Fehlt noch: Hafermilch, Brot und Äpfel.\n\nTomaten streiche ich raus?",
   "createdAt": 1792493979518
  },
  {
   "id": "u-b8638e386188cc9f",
   "role": "user",
   "text": "Ja, Tomaten streichen. Brot habe ich gerade abgehakt. Mehr Details: was fehlt jetzt noch?",
   "createdAt": 1792493999601,
   "live": {
    "shopping-saturday": {
     "v": 2,
     "ops": [
      {
       "check": "brot"
      }
     ],
     "bid": "b-mvgkn8xa6ifae"
    }
   }
  },
  {
   "id": "a-09ad0781fe680f65",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"shopping_saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\"},\n    {\"text\": \"Äpfel\"}\n  ]\n}\n```\n\nNoch zu kaufen: Hafermilch und Äpfel. Brot ist abgehakt, Tomaten gestrichen.",
   "createdAt": 1792493999601
  }
 ],
 "calculator": [
  {
   "id": "u-6e32917edd587623",
   "role": "user",
   "text": "Ich schwanke fürs Wochenende zwischen Zug und Auto von Wien nach Graz. Wir sind zwei Personen. Lass mich Kosten, Zeit und Umwelt selbst gewichten.",
   "createdAt": 1792494268592
  },
  {
   "id": "a-6769e36c43db4ef1",
   "role": "assistant",
   "text": "Ich hole mir die aktuellen Daten für beide Varianten.\n\nIch kann keine Live-Fahrpreise abrufen, aber ich kann dir die realistischen Daten basierend auf typischen Wochenendpreisen geben und eine Entscheidungshilfe bauen, die du selbst gewichten kannst.\n\n**Route Wien–Graz: ca. 200 km**\n\n**Zug (ÖBB):**\n- Dauer: ~2,5 Stunden\n- Preis (2 Personen): €40–60 (Sparschiene) bis €90–100 (Vollpreis), meistens €50–70 am Wochenende\n- CO₂: ~15 kg für zwei Personen\n- Komfort: Sitze, Arbeit möglich, kein Parkplatzstress\n\n**Auto (VW Golf/ähnlich):**\n- Dauer: ~2,5 Stunden reine Fahrt + Parkplatz\n- Kosten (2 Personen): Spritkosten ca. €20–25 (8L/100km, €1,30/L), Parkplatz Graz ca. €5–10/Tag = **€25–35 Hin+Rück**\n- CO₂: ~60–70 kg für zwei Personen\n- Komfort: Flexibilität, aber Ermüdung, Parkplatzsuche\n\n```hui\n{\n  \"type\": \"decision\",\n  \"id\": \"wien_graz_transport\",\n  \"title\": \"Wien → Graz: Zug vs. Auto\",\n  \"criteria\": [\n    {\"id\": \"kosten\", \"label\": \"Kosteneffizienz\", \"weight\": 5},\n    {\"id\": \"zeit\", \"label\": \"Reisezeit\", \"weight\": 5},\n    {\"id\": \"umwelt\", \"label\": \"CO₂-Fußabdruck\", \"weight\": 5}\n  ],\n  \"options\": [\n    {\n      \"label\": \"Zug (ÖBB)\",\n      \"scores\": {\n        \"kosten\": 8,\n        \"zeit\": 9,\n        \"umwelt\": 9\n      }\n    },\n    {\n      \"label\": \"Auto\",\n      \"scores\": {\n        \"kosten\": 7,\n        \"zeit\": 6,\n        \"umwelt\": 3\n      }\n    }\n  ]\n}\n```\n\nGewichte die Kriterien nach deinen Prioritäten – der Zug gewinnt deutlich bei Umwelt und Zeitverlässlichkeit, das Auto ist flexibler und kostet unwesentlich mehr. Schau auf oeebb.at für aktuelle Preise.",
   "createdAt": 1792494268592
  },
  {
   "id": "u-8f495c2ebc0c4858",
   "role": "user",
   "text": "Kosten sind mir 50 Prozent wichtig, Zeit 20 und Umwelt 30. Ich will die Gewichte selbst verschieben können.",
   "createdAt": 1792494278654
  },
  {
   "id": "a-91bb12fab2db474e",
   "role": "assistant",
   "text": "\n\n```hui\n{\n  \"type\": \"calc\",\n  \"id\": \"wien_graz_calc\",\n  \"title\": \"Wien–Graz: Kosten–Zeit–Umwelt Kalkulator\",\n  \"inputs\": [\n    {\n      \"name\": \"kosten_weight\",\n      \"label\": \"Kosten Gewicht (%)\",\n      \"kind\": \"slider\",\n      \"min\": 0,\n      \"max\": 100,\n      \"default\": 50\n    },\n    {\n      \"name\": \"zeit_weight\",\n      \"label\": \"Zeit Gewicht (%)\",\n      \"kind\": \"slider\",\n      \"min\": 0,\n      \"max\": 100,\n      \"default\": 20\n    },\n    {\n      \"name\": \"umwelt_weight\",\n      \"label\": \"Umwelt Gewicht (%)\",\n      \"kind\": \"slider\",\n      \"min\": 0,\n      \"max\": 100,\n      \"default\": 30\n    }\n  ],\n  \"outputs\": [\n    {\n      \"label\": \"Zug-Score (0–100)\",\n      \"expr\": \"(8 * kosten_weight + 9 * zeit_weight + 9 * umwelt_weight) / (kosten_weight + zeit_weight + umwelt_weight)\"\n    },\n    {\n      \"label\": \"Auto-Score (0–100)\",\n      \"expr\": \"(7 * kosten_weight + 6 * zeit_weight + 3 * umwelt_weight) / (kosten_weight + zeit_weight + umwelt_weight)\"\n    },\n    {\n      \"label\": \"Empfehlung\",\n      \"expr\": \"IF((8 * kosten_weight + 9 * zeit_weight + 9 * umwelt_weight) / (kosten_weight + zeit_weight + umwelt_weight) > (7 * kosten_weight + 6 * zeit_weight + 3 * umwelt_weight) / (kosten_weight + zeit_weight + umwelt_weight), \\\"→ Zug\\\", \\\"→ Auto\\\")\"\n    }\n  ]\n}\n```\n\nVerschieb die Schieber – der Score aktualisiert sich live. Mit deinen Startwerten (50 % Kosten, 20 % Zeit, 30 % Umwelt) gewinnt der Zug klar.",
   "createdAt": 1792494278654
  },
  {
   "id": "u-57deced1d3a93680",
   "role": "user",
   "text": "Ich nehme den Zug. Lass mich bitte morgens oder nachmittags als zwei Optionen antippen.",
   "createdAt": 1792494287973
  },
  {
   "id": "a-fb7352001e268346",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"choice\",\n  \"id\": \"wien_graz_time\",\n  \"question\": \"Wann fährst du nach Graz?\",\n  \"options\": [\n    {\n      \"label\": \"Morgens\",\n      \"description\": \"Früher Start, mehr Zeit vor Ort\"\n    },\n    {\n      \"label\": \"Nachmittags\",\n      \"description\": \"Später Aufbruch, gemütlicherer Start\"\n    }\n  ]\n}\n```",
   "createdAt": 1792494287973
  },
  {
   "id": "u-6a4ef3b1d1a786a6",
   "role": "user",
   "text": "[choice:wien_graz_time] Wann fährst du nach Graz? → Morgens",
   "createdAt": 1792494711572
  },
  {
   "id": "a-21984c874e5cfebf",
   "role": "assistant",
   "text": "Perfekt. Morgens gibt dir mehr Zeit in Graz. Schau auf oeebb.at nach Verbindungen ab ca. 7–9 Uhr – am Wochenende sind Sparscheine oft bis 18 Uhr gültig. Rückfahrt am Sonntag früh buchen für bessere Preise. Gute Fahrt!",
   "createdAt": 1792494711572
  }
 ],
 "agenda": [
  {
   "id": "u-ee26c13cabf32dcb",
   "role": "user",
   "text": "Plane meinen Samstag: um 9 Uhr 30 Minuten Sport, um 10 Uhr eine Stunde einkaufen, um 13 Uhr Mittagessen. Bitte als übersichtlichen Tagesplan.",
   "createdAt": 1792494380453
  },
  {
   "id": "a-1924ea9f33463de2",
   "role": "assistant",
   "text": "Ich erstelle dir einen übersichtlichen Tagesplan für Samstag.\n\n```hui\n{\n  \"type\": \"agenda\",\n  \"id\": \"samstag-plan\",\n  \"blocks\": [\n    {\n      \"start\": \"09:30\",\n      \"end\": \"10:30\",\n      \"title\": \"Sport\"\n    },\n    {\n      \"start\": \"10:30\",\n      \"end\": \"11:30\",\n      \"title\": \"Einkaufen\"\n    },\n    {\n      \"start\": \"13:00\",\n      \"end\": \"14:00\",\n      \"title\": \"Mittagessen\"\n    }\n  ]\n}\n```\n\nDein Samstag ist geplant: Sport von 9:30 bis 10:30, Einkaufen von 10:30 bis 11:30, Mittagessen ab 13:00. Du hast noch Zeit zwischen 11:30 und 13:00 – Pause oder weitere Aktivitäten?",
   "createdAt": 1792494380453
  },
  {
   "id": "u-49a31542a6bc5ca6",
   "role": "user",
   "text": "Einkaufen lieber erst um 11, mehr Details bitte.",
   "createdAt": 1792494386433
  },
  {
   "id": "a-9e4e34c22bf4b657",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"agenda\",\n  \"id\": \"samstag-plan\",\n  \"blocks\": [\n    {\n      \"start\": \"09:30\",\n      \"end\": \"10:30\",\n      \"title\": \"Sport\",\n      \"detail\": \"Workout, Joggen oder Fitness – je nach Vorliebe\"\n    },\n    {\n      \"start\": \"11:00\",\n      \"end\": \"12:00\",\n      \"title\": \"Einkaufen\",\n      \"detail\": \"Eine Stunde Zeit für Besorgungen\"\n    },\n    {\n      \"start\": \"13:00\",\n      \"end\": \"14:00\",\n      \"title\": \"Mittagessen\",\n      \"detail\": \"Essen gehen oder zu Hause kochen\"\n    }\n  ]\n}\n```\n\nPasst besser: nach dem Sport um 10:30 hast du 30 Minuten Puffer vor dem Einkaufen, und nach dem Einkaufen um 12:00 noch Zeit zum Entspannen vor dem Mittagessen um 13:00.",
   "createdAt": 1792494386433
  }
 ]
};
