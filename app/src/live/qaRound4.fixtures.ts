// Verbatim transcripts from the 0.3 real-user round 4 on the released 0.2.0 (web bundle, bridge 0.2.0 as a pure Hermes
// pass-through, router heuristic, skill 0.7.1, German UI): message texts as stored by the app, user messages with the
// live-card batches their `[hui:live]` trailer carried. No personal data (made-up shopping list and watchlist). Used by
// qaRound4.test.ts. Shopping: Hermes wrote every version as a typed ```checklist fence (no `hui`, no "live"), the card
// made from the first one stayed at Milch/Brot/Tomaten. Watchlist: Hermes' first version had no item ids, its patch then
// named ids it made up (`iphone16`, `pixel9`). Packing (English): a patch removed the raincoat, the next full version
// copied the first one and listed it again, unasked.
import type { FixtureMessage } from './qaRound2.fixtures.ts';

export const QA_ROUND4: Record<'shopping' | 'watchlist' | 'packing', FixtureMessage[]> = {
 "shopping": [
  {
   "id": "u-4c11ff2c7348b879",
   "role": "user",
   "text": "Einkaufslsite für Samstag: Milch, Brot und Tomaten. Eier haben wir schon. Zum Abhaken bitte.",
   "createdAt": 1792572938692
  },
  {
   "id": "a-d568fc698e57c2bb",
   "role": "assistant",
   "text": "\n\n```checklist\n{\n  \"id\": \"shopping-saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Milch\", \"checked\": false},\n    {\"text\": \"Brot\", \"checked\": false},\n    {\"text\": \"Tomaten\", \"checked\": false}\n  ]\n}\n```\n\nDeine Einkaufsliste für Samstag ist bereit. Abhaken, wenn du die Artikel erledigt hast.",
   "createdAt": 1792572986443
  },
  {
   "id": "u-65180b21a1900f78",
   "role": "user",
   "text": "Noch Hafermilch und Äpfel dazu bitte, normale Milch streichen.",
   "createdAt": 1792573025240,
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
     "bid": "b-mvhvoq6m7y5ft"
    }
   }
  },
  {
   "id": "a-03fa56ce4cf0cc27",
   "role": "assistant",
   "text": "\n\n```checklist\n{\n  \"id\": \"shopping-saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\", \"checked\": false},\n    {\"text\": \"Brot\", \"checked\": false},\n    {\"text\": \"Tomaten\", \"checked\": false},\n    {\"text\": \"Äpfel\", \"checked\": false}\n  ]\n}\n```\n\nErledigt: normale Milch raus, Hafermilch und Äpfel hinzugefügt.",
   "createdAt": 1792573025240
  },
  {
   "id": "u-300fde60c132f01b",
   "role": "user",
   "text": "Tomaten hab ich schon. Was fehlt noch?",
   "createdAt": 1792573030640
  },
  {
   "id": "a-1b03e22b718313dd",
   "role": "assistant",
   "text": "```checklist\n{\n  \"id\": \"shopping-saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\", \"checked\": false},\n    {\"text\": \"Brot\", \"checked\": false},\n    {\"text\": \"Äpfel\", \"checked\": false}\n  ]\n}\n```\n\nTomaten gestrichen. Noch auf der Liste: Hafermilch, Brot und Äpfel.",
   "createdAt": 1792573030640
  },
  {
   "id": "u-3decabfd70739b37",
   "role": "user",
   "text": "Ja, Tomaten streichen. Brot habe ich gerade abgehakt. Mehr Details: was fehlt jetzt noch?",
   "createdAt": 1792573070438,
   "live": {
    "shopping-saturday": {
     "v": 1,
     "ops": [
      {
       "check": "brot"
      }
     ],
     "bid": "b-mvhvq0ec2drju"
    }
   }
  },
  {
   "id": "a-3e5b797fc2aef34a",
   "role": "assistant",
   "text": "```checklist\n{\n  \"id\": \"shopping-saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\", \"checked\": false},\n    {\"text\": \"Äpfel\", \"checked\": false},\n    {\"text\": \"Brot\", \"checked\": true}\n  ]\n}\n```\n\nNoch zu kaufen: Hafermilch und Äpfel. Brot ist erledigt.",
   "createdAt": 1792573070438
  },
  {
   "id": "u-dffee636936d0d56",
   "role": "user",
   "text": "Aktualisiere bitte genau diese Live-Karte: Hafermilch und Äpfel fehlen; Brot bleibt abgehakt, Milch und Tomaten streichen.",
   "createdAt": 1792573099273,
   "live": {
    "shopping-saturday": {
     "v": 2,
     "ops": [],
     "bid": "b-mvhvqnm19hv44",
     "focus": true
    }
   }
  },
  {
   "id": "a-ebd088839e93e3a0",
   "role": "assistant",
   "text": "```checklist\n{\n  \"id\": \"shopping-saturday\",\n  \"title\": \"Einkaufsliste Samstag\",\n  \"items\": [\n    {\"text\": \"Hafermilch\", \"checked\": false},\n    {\"text\": \"Äpfel\", \"checked\": false},\n    {\"text\": \"Brot\", \"checked\": true}\n  ]\n}\n```\n\nAktualisiert: nur noch Hafermilch und Äpfel offen, Brot bleibt abgehakt.",
   "createdAt": 1792573099273
  }
 ],
 "watchlist": [
  {
   "id": "u-0d7d5b3432c3453a",
   "role": "user",
   "text": "Ich will iPhone 16 und Pixel 9 auf einer Watchlist behalten. Gib mir eine Liste mit Zielpreisen 600 und 500 Euro, damit ich die Angebote später vergleichen kann. Preise musst du jetzt nicht suchen.",
   "createdAt": 1792573144038
  },
  {
   "id": "a-17085108dbe7dc47",
   "role": "assistant",
   "text": "Ich erstelle dir eine Live-Watchlist mit iPhone 16 und Pixel 9 — du kannst später Angebote hinzufügen und mit deinen Zielpreisen vergleichen.\n\nIch erstelle dir direkt eine Live-Watchlist als Checklist, die du speichern und später aktualisieren kannst:\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"phone_watchlist\",\n  \"live\": true,\n  \"title\": \"Smartphone-Watchlist\",\n  \"items\": [\n    {\n      \"text\": \"iPhone 16\",\n      \"note\": \"Zielpreis: 600 €\",\n      \"checked\": false\n    },\n    {\n      \"text\": \"Pixel 9\",\n      \"note\": \"Zielpreis: 500 €\",\n      \"checked\": false\n    }\n  ]\n}\n```\n\nDie Liste ist jetzt gespeichert. Du kannst später Angebote als Notizen hinzufügen (z.B. \"Amazon 589 €\") oder abhaken, wenn du ein gutes Angebot gefunden hast. Sag mir Bescheid, wenn du Preise recherchieren möchtest oder weitere Modelle hinzufügen willst.",
   "createdAt": 1792573144038
  },
  {
   "id": "u-1164d55982977b5d",
   "role": "user",
   "text": "Beim Pixel ist mein Ziel jetzt 450 Euro. iPhone streichen, das interessiert mich nicht mehr.",
   "createdAt": 1792573150151
  },
  {
   "id": "a-b91d75bea702532a",
   "role": "assistant",
   "text": "\n\n```hui\n{\n  \"type\": \"callout\",\n  \"tone\": \"info\",\n  \"text\": \"iPhone entfernt, Pixel 9 Zielpreis auf 450 € gesetzt\",\n  \"livePatch\": {\n    \"card\": \"phone_watchlist\",\n    \"ops\": [\n      {\"del\": \"iphone16\"},\n      {\"set\": \"pixel9\", \"note\": \"Zielpreis: 450 €\"}\n    ]\n  }\n}\n```\n\nDeine Watchlist ist aktualisiert — nur noch Pixel 9 mit 450 € Ziel.",
   "createdAt": 1792573150151
  },
  {
   "id": "u-8e0168de008202a7",
   "role": "user",
   "text": "Was steht noch auf meiner Watchlist? Mehr Details bitte.",
   "createdAt": 1792573154586
  },
  {
   "id": "a-e8addfe95721db85",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"phone_watchlist\",\n  \"live\": true,\n  \"title\": \"Smartphone-Watchlist\",\n  \"items\": [\n    {\n      \"id\": \"pixel9\",\n      \"text\": \"Pixel 9\",\n      \"note\": \"Zielpreis: 450 €\",\n      \"checked\": false\n    }\n  ]\n}\n```\n\nAuf deiner Watchlist steht aktuell nur noch das **Google Pixel 9** mit einem Zielpreis von **450 Euro**.\n\nDas iPhone 16 hast du gerade entfernt — du interessierst dich also derzeit nur für das Pixel 9. Sobald du Angebote findest oder der Preis unter dein Ziel fällt, kannst du mir Bescheid geben und ich aktualisiere die Watchlist mit den aktuellen Preisen und Angeboten.\n\nMöchtest du noch andere Smartphones hinzufügen oder Angebote zum Pixel 9 suchen?",
   "createdAt": 1792573154586
  }
 ],
 "packing": [
  {
   "id": "u-6514e1a12251ffb6",
   "role": "user",
   "text": "A packing list for a weekend in London: raincoat, charger, socks and toothbrush. Make it a live list I can tick off.",
   "createdAt": 1792573942661
  },
  {
   "id": "a-9f54b9c873f81b01",
   "role": "assistant",
   "text": "\n\nYour London weekend packing list—tick each off as you pack.\n\n```hui\n{\"type\":\"checklist\",\"id\":\"london-packing\",\"live\":true,\"title\":\"London weekend\",\"items\":[{\"id\":\"raincoat\",\"text\":\"Raincoat\",\"checked\":false},{\"id\":\"charger\",\"text\":\"Charger\",\"checked\":false},{\"id\":\"socks\",\"text\":\"Socks\",\"checked\":false},{\"id\":\"toothbrush\",\"text\":\"Toothbrush\",\"checked\":false}]}\n```",
   "createdAt": 1792573942661
  },
  {
   "id": "u-e6e30e4eae110c79",
   "role": "user",
   "text": "I meant umbrella instead of raincoat, add a small towel too.",
   "createdAt": 1792573947225
  },
  {
   "id": "a-ecbea454f371466a",
   "role": "assistant",
   "text": "\n\nUmbrella replaces raincoat, small towel added.\n\n```hui\n{\"type\":\"callout\",\"tone\":\"info\",\"title\":\"London packing updated\",\"text\":\"− Raincoat, + Umbrella, + Small towel\",\"livePatch\":{\"card\":\"london-packing\",\"ops\":[{\"del\":\"raincoat\"},{\"add\":{\"id\":\"umbrella\",\"text\":\"Umbrella\"}},{\"add\":{\"id\":\"towel\",\"text\":\"Small towel\"}}]}}\n```",
   "createdAt": 1792573947225
  },
  {
   "id": "u-c79e7ccd40029595",
   "role": "user",
   "text": "I ticked the charger. What is still missing? Keep completed items on the card please.",
   "createdAt": 1792573993788,
   "live": {
    "london-packing": {
     "v": 2,
     "ops": [
      {
       "check": "charger"
      }
     ],
     "bid": "b-mvhw9spy6ch77"
    }
   }
  },
  {
   "id": "a-80b3a20b39308fb5",
   "role": "assistant",
   "text": "Charger is done. You still need umbrella, socks, and toothbrush.\n\n```hui\n{\"type\":\"checklist\",\"id\":\"london-packing\",\"live\":true,\"title\":\"London weekend\",\"items\":[{\"id\":\"raincoat\",\"text\":\"Raincoat\",\"checked\":false},{\"id\":\"charger\",\"text\":\"Charger\",\"checked\":true},{\"id\":\"socks\",\"text\":\"Socks\",\"checked\":false},{\"id\":\"toothbrush\",\"text\":\"Toothbrush\",\"checked\":false},{\"id\":\"umbrella\",\"text\":\"Umbrella\",\"checked\":false},{\"id\":\"towel\",\"text\":\"Small towel\",\"checked\":false}]}\n```",
   "createdAt": 1792573993788
  }
 ]
};
