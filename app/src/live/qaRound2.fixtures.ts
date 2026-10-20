// Verbatim transcripts from the 0.2 real-user round 2 (default bridge as a pure Hermes pass-through, router heuristic,
// claude-haiku-4-5, German UI): message texts as stored by the app, user messages with the live-card batches their
// `[hui:live]` trailer carried. No personal data (made-up shopping, trip and movie lists). Used by qaRound2*.test.ts.
export interface FixtureMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  live?: Record<string, unknown>;
}

export const QA_ROUND2: Record<string, FixtureMessage[]> = {
 "salzburg": [
  {
   "id": "u-da13cee69be40a54",
   "role": "user",
   "text": "Wir fahren Samstag und Sonntag nach Salzburg, zu zweit ohne Auto. Plane ein entspanntes Wochenende mit drei schönen Orten und einer Karte. Budget 200 Euro ohne Hotel.",
   "createdAt": 1792473467906
  },
  {
   "id": "a-481896619a7a08c8",
   "role": "assistant",
   "text": "Ich hole mir Infos zu Salzburg und plane euer Wochenende.\n\nKein Web-Tool für Live-Daten verfügbar. Ich plane euch ein klassisches, entspanntes Salzburg-Wochenende mit bewährten Orten und Tipps:\n\n```hui\n{\n  \"type\": \"tabs\",\n  \"items\": [\n    {\n      \"title\": \"Übersicht\",\n      \"blocks\": [\n        {\n          \"type\": \"stats\",\n          \"items\": [\n            {\"label\": \"Budget/Tag\", \"value\": \"~100 €\"},\n            {\"label\": \"Fortbewegung\", \"value\": \"Zu Fuß + öffentlich\"},\n            {\"label\": \"Übernachtung\", \"value\": \"Nicht im Budget\"}\n          ]\n        },\n        {\n          \"type\": \"table\",\n          \"columns\": [\"Ort\", \"Samstag/Sonntag\", \"Kosten\", \"Art\"],\n          \"rows\": [\n            [\"Altstadt\", \"beide Tage\", \"kostenlos\", \"Spaziergang\"],\n            [\"Hohensalzburg\", \"Sa od. So\", \"€16–18\", \"Festung + Aussicht\"],\n            [\"Salzburg Museum\", \"Sa od. So\", \"€8–9\", \"Geschichte\"],\n            [\"Mönchsberg\", \"Sa od. So\", \"€5 Aufzug\", \"Natur + Aussicht\"],\n            [\"Cafés + Essen\", \"beide Tage\", \"€60–80\", \"Kulinarik\"],\n            [\"Salzburg Sound\", \"Sa Abend\", \"€15–25\", \"Kultur (optional)\"]\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Karte\",\n      \"blocks\": [\n        {\n          \"type\": \"map\",\n          \"markers\": [\n            {\n              \"title\": \"Altstadt (Zentrum)\",\n              \"description\": \"Getreidegasse, Residenzplatz, Dom – kostenlos\"\n            },\n            {\n              \"title\": \"Hohensalzburg\",\n              \"description\": \"Festung mit Panoramablick – €16–18 (Bus 3 oder Fußweg ~30 min)\"\n            },\n            {\n              \"title\": \"Salzburg Museum\",\n              \"description\": \"Residenzplatz 1 – Geschichte & Kultur – €8–9\"\n            },\n            {\n              \"title\": \"Mönchsberg\",\n              \"description\": \"Aufzug + Klosterrestaurant – €5 Aufzug, Aussicht kostenlos\"\n            }\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Samstag\",\n      \"blocks\": [\n        {\n          \"type\": \"agenda\",\n          \"blocks\": [\n            {\n              \"start\": \"09:00\",\n              \"end\": \"12:00\",\n              \"title\": \"Altstadt erkunden (Getreidegasse, Dom, Residenzplatz)\"\n            },\n            {\n              \"start\": \"12:00\",\n              \"end\": \"13:30\",\n              \"title\": \"Mittagessen – traditionelles Café (€10–15 pro Person)\"\n            },\n            {\n              \"start\": \"14:00\",\n              \"end\": \"16:00\",\n              \"title\": \"Hohensalzburg oder Salzburg Museum (€8–18)\"\n            },\n            {\n              \"start\": \"16:30\",\n              \"end\": \"18:00\",\n              \"title\": \"Mönchsberg: Aufzug + Spaziergang, Aussicht genießen\"\n            },\n            {\n              \"start\": \"18:30\",\n              \"end\": \"20:00\",\n              \"title\": \"Abendessen an der Salzach oder Altstadt (€15–20 pro Person)\"\n            }\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Sonntag\",\n      \"blocks\": [\n        {\n          \"type\": \"agenda\",\n          \"blocks\": [\n            {\n              \"start\": \"09:00\",\n              \"end\": \"10:30\",\n              \"title\": \"Frühstück in einem Altstadt-Café\"\n            },\n            {\n              \"start\": \"11:00\",\n              \"end\": \"12:30\",\n              \"title\": \"Schloss Mirabell + Gärten (kostenlos, wunderschön)\"\n            },\n            {\n              \"start\": \"13:00\",\n              \"end\": \"14:30\",\n              \"title\": \"Mittagessen (€10–15)\"\n            },\n            {\n              \"start\": \"15:00\",\n              \"end\": \"17:00\",\n              \"title\": \"Kapuzinerberg (Berg + Kloster, kostenlos, leichte Wanderung)\"\n            },\n            {\n              \"start\": \"17:30\",\n              \"end\": \"19:00\",\n              \"title\": \"Spaziergang am Ufer oder letzte Altstadt-Bummel\"\n            },\n            {\n              \"start\": \"19:00\",\n              \"end\": \"20:30\",\n              \"title\": \"Abschließendes Abendessen oder Aprés-Drink\"\n            }\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Budget-Tipps\",\n      \"blocks\": [\n        {\n          \"type\": \"list\",\n          \"style\": \"bullet\",\n          \"items\": [\n            {\n              \"title\": \"Kostenlos\",\n              \"subtitle\": \"Altstadt, Mirabell-Gärten, Kapuzinerberg, Dom von außen, Uferspaziergang\"\n            },\n            {\n              \"title\": \"Essen sparen\",\n              \"subtitle\": \"Würstel-Stand (€3–5), Supermarkt-Snacks, Happy Hour in Cafés\"\n            },\n            {\n              \"title\": \"Öffentliche Verkehrsmittel\",\n              \"subtitle\": \"Salzburg ist klein – alles zu Fuß erreichbar; Tickets ~€2–3 pro Fahrt\"\n            },\n            {\n              \"title\": \"Museum-Tipps\",\n              \"subtitle\": \"Salzburg Museum ist günstiger als Festung; Mirabell kostenlos\"\n            },\n            {\n              \"title\": \"Packliste\",\n              \"subtitle\": \"Festes Schuhwerk (viele Stiegen!), Wasser, Kamera\"\n            }\n          ]\n        }\n      ]\n    }\n  ]\n}\n```\n\n**Drei Highlights für euch:**\n\n1. **Hohensalzburg-Festung** – Panoramablick über die ganze Stadt, beeindruckend vom Tal aus; Fußweg 30 min oder Bus 3 (€16–18).\n2. **Schloss Mirabell & Gärten** – Sonntag morgens besonders schön, kostenlos; Kunstfiguren, Wasser, Wien-Flair ohne Gedränge.\n3. **Kapuzinerberg** – Leichte Wanderung mit Kloster, großartige Aussicht und deutlich weniger touristisch als die Festung.\n\n**Budget-Aufteilung (~200 €):**\n- Festung oder Museum: €18–25\n- Mönchsberg Aufzug: €5\n- Essen & Trinken (beide Tage): €120–140\n- Sonstiges: €30–40\n\nSalzburg ist perfekt für zwei ohne Auto – zentral, kompakt, überall zu Fuß. Genießt die Altstadt, nehmt euch Zeit für Cafés, und die Berge machen das Wochenende entspannt besonders.",
   "createdAt": 1792473467906
  },
  {
   "id": "u-90460b23d944ba43",
   "role": "user",
   "text": "Was machen wir wenns regnet? Bitte mit konkreten Adressen.",
   "createdAt": 1792473490271
  },
  {
   "id": "a-44f3fc946ac5cede",
   "role": "assistant",
   "text": "Ich hole mir konkrete Indoor-Orte für Salzburg.\n\nKein Live-Tool verfügbar. Hier eure bewährten Regen-Alternativen mit konkreten Adressen:\n\n```hui\n{\n  \"type\": \"tabs\",\n  \"items\": [\n    {\n      \"title\": \"Museen & Galerien\",\n      \"blocks\": [\n        {\n          \"type\": \"table\",\n          \"columns\": [\"Ort\", \"Adresse\", \"Kosten\", \"Dauer\", \"Empfehlung\"],\n          \"rows\": [\n            [\"Salzburg Museum\", \"Residenzplatz 1, 5020\", \"€9\", \"1–2h\", \"Geschichte & Kultur, zentral\"],\n            [\"Haus für Mozart\", \"Hofstallgasse 13, 5020\", \"€10–15\", \"1–1,5h\", \"Mozart-Ausstellung, kompakt\"],\n            [\"Salzburg Kunsthalle\", \"Bergstraße 12, 5020\", \"€7\", \"1–2h\", \"Moderne Kunst\"],\n            [\"NAWI Salzburg\", \"Museumsplatz 5, 5020\", \"€7\", \"1–2h\", \"Naturkunde für jeden\"]\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Cafés & Lokale\",\n      \"blocks\": [\n        {\n          \"type\": \"table\",\n          \"columns\": [\"Name\", \"Adresse\", \"Typ\", \"Budget\", \"Highlights\"],\n          \"rows\": [\n            [\"Café Tomaselli\", \"Alter Markt 9, 5020\", \"Wiener Café\", \"€5–10\", \"Ältestes Café Salzburgs (seit 1705), Tradition\"],\n            [\"Café Gigi\", \"Getreidegasse 63, 5020\", \"Modern\", \"€6–12\", \"Altstadt-Lage, Instagram-freundlich\"],\n            [\"Bärenwirt\", \"Münzgasse 8, 5020\", \"Lokal\", \"€8–15\", \"Traditionell, gemütlich, Eintöpfe\"],\n            [\"Fräulein Florentine\", \"Getreidegasse 15, 5020\", \"Café/Bistro\", \"€7–14\", \"Salzburg Sound, Kultur-Treffpunkt\"],\n            [\"Augustiner Bräu\", \"Augustinerstraße 4, 5020\", \"Bierlokal\", \"€8–16\", \"Halbe Dunkel, traditionell, groß\"]\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Aktivitäten drinnen\",\n      \"blocks\": [\n        {\n          \"type\": \"list\",\n          \"style\": \"bullet\",\n          \"items\": [\n            {\n              \"title\": \"Salzburg Museum\",\n              \"subtitle\": \"Residenzplatz 1 – Geschichte, Archäologie, Kunst; entspannte Stunden möglich\"\n            },\n            {\n              \"title\": \"Salzburg Sound (Kultur-Live)\",\n              \"subtitle\": \"Getreidegasse – Salzburg-Dokumentation im Kino-Format, tägl. 14:00 & 16:00 Uhr (€12–15)\"\n            },\n            {\n              \"title\": \"Shopping: Getreidegasse\",\n              \"subtitle\": \"Salzburgs berühmteste Einkaufsstraße – überdacht, Läden überall\"\n            },\n            {\n              \"title\": \"Bücherflohmarkt oder Antiquariat\",\n              \"subtitle\": \"Bergstraße oder Residenzgasse – gemütliches Stöbern\"\n            },\n            {\n              \"title\": \"Thermalbad Bad Gastein (Halbtag)\",\n              \"subtitle\": \"20 min Zugfahrt, aber bei echtem Regen: Therme & Wellness (€18–25)\"\n            }\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Regen-Plan (Samstag)\",\n      \"blocks\": [\n        {\n          \"type\": \"agenda\",\n          \"blocks\": [\n            {\n              \"start\": \"09:00\",\n              \"end\": \"10:00\",\n              \"title\": \"Frühstück bei Tomaselli (Alter Markt 9)\"\n            },\n            {\n              \"start\": \"10:30\",\n              \"end\": \"12:30\",\n              \"title\": \"Salzburg Museum (Residenzplatz 1, €9)\"\n            },\n            {\n              \"start\": \"12:45\",\n              \"end\": \"14:15\",\n              \"title\": \"Mittagessen: Bärenwirt (Münzgasse 8, €10–15)\"\n            },\n            {\n              \"start\": \"14:30\",\n              \"end\": \"16:00\",\n              \"title\": \"Shopping Getreidegasse oder Haus für Mozart (€10)\"\n            },\n            {\n              \"start\": \"16:15\",\n              \"end\": \"17:30\",\n              \"title\": \"Café Gigi (Getreidegasse 63, Kaffee & Kuchen €8–10)\"\n            },\n            {\n              \"start\": \"18:00\",\n              \"end\": \"20:00\",\n              \"title\": \"Abendessen & Salzburg Sound (Getreidegasse, 19:00 oder 20:00 Uhr)\"\n            }\n          ]\n        }\n      ]\n    },\n    {\n      \"title\": \"Regen-Plan (Sonntag)\",\n      \"blocks\": [\n        {\n          \"type\": \"agenda\",\n          \"blocks\": [\n            {\n              \"start\": \"09:00\",\n              \"end\": \"10:30\",\n              \"title\": \"Frühstück bei Fräulein Florentine (Getreidegasse 15)\"\n            },\n            {\n              \"start\": \"11:00\",\n              \"end\": \"13:00\",\n              \"title\": \"Salzburg Kunsthalle (Bergstraße 12, €7) oder NAWI (€7)\"\n            },\n            {\n              \"start\": \"13:15\",\n              \"end\": \"14:45\",\n              \"title\": \"Mittagessen: Augustiner Bräu (Augustinerstraße 4, €10–15)\"\n            },\n            {\n              \"start\": \"15:00\",\n              \"end\": \"17:00\",\n              \"title\": \"Gemütlich durchs Museum oder Antiquariat stöbern\"\n            },\n            {\n              \"start\": \"17:30\",\n              \"end\": \"18:30\",\n              \"title\": \"Letztes Café (Lieblingsort von Sa) – Kaffee & genießen\"\n            },\n            {\n              \"start\": \"19:00\",\n              \"end\": \"20:30\",\n              \"title\": \"Abschied-Abendessen (nach Wahl)\"\n            }\n          ]\n        }\n      ]\n    }\n  ]\n}\n```\n\n**Konkrete Regen-Alternativen:**\n\n**Museen (zentral, alle Altstadt):**\n- **Salzburg Museum** (Residenzplatz 1) – €9, 1–2h, beste Wahl für Geschichte\n- **Haus für Mozart** (Hofstallgasse 13) – €10, Mozarts Leben & Werke, kompakt\n- **Salzburg Kunsthalle** (Bergstraße 12) – €7, moderne Kunst\n\n**Gemütliche Cafés (Klassiker):**\n- **Tomaselli** (Alter Markt 9) – seit 1705, Wien-Feeling, Wiener Melange & Apfelstrudel\n- **Café Gigi** (Getreidegasse 63) – Modern, Altstadt-Lage, perfekt zum Abhängen\n- **Bärenwirt** (Münzgasse 8) – Traditionell österreichisch, gemütlich, echte Lokale\n\n**Sparen bei Regen:**\n- Getreidegasse ist überdacht, ideal für Shopping & Bummel\n- Salzburg Sound (Getreidegasse) – täglich 14:00 & 16:00 Uhr, €12–15, Salzburg-Doku im Kino\n- Augustiner Bräu (Augustinerstraße 4) – großes Bierlokal, gemütlich, Klassiker\n\nAlles liegt zentral (5 min Fußweg untereinander). Selbst bei Dauerregen seid ihr gut versorgt – Salzburg-Erlebnis bleiben erhalten, nur eben drinnen. Budget bleibt ok.",
   "createdAt": 1792473490271
  },
  {
   "id": "u-e7e357f6910cee6a",
   "role": "user",
   "text": "Zeig die drei wichtigsten Orte bitte nochmal auf der Karte, wir laufen lieber weniger.",
   "createdAt": 1792473512653
  },
  {
   "id": "a-f46b32c06c5e18e3",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"map\",\n  \"markers\": [\n    {\n      \"title\": \"Altstadt (Zentrum)\",\n      \"description\": \"Getreidegasse, Residenzplatz, Dom – Herz von Salzburg, alles zu Fuß erreichbar, kostenlos\"\n    },\n    {\n      \"title\": \"Schloss Mirabell\",\n      \"description\": \"Mirabellplatz 4 – wunderschöne Gärten, kostenlos, 10 min Fußweg von der Altstadt\"\n    },\n    {\n      \"title\": \"Hohensalzburg\",\n      \"description\": \"Hohensalzburg 1 – Festung mit Panoramablick, €16–18, 30 min zu Fuß oder Bus 3\"\n    }\n  ]\n}\n```\n\nDiese drei sind dein perfektes Dreieck für zwei Tage: Altstadt als Basis (morgens & abends), Mirabell-Gärten am Sonntag (leicht, kostenlos), Hohensalzburg einmal als Highlight. Alles Übrige könnt ihr flexibel vor Ort spontan machen – Cafés, kleine Spaziergänge, bei Regen drinnen bleiben.",
   "createdAt": 1792473512653
  }
 ],
 "pasta": [
  {
   "id": "u-78ac0ef788e097b6",
   "role": "user",
   "text": "Ich möchte heute für vier eine schnelle Pasta mit Hähnchen kochen. Ein Rezept mit Mengen und Zeiten bitte.",
   "createdAt": 1792473523122
  },
  {
   "id": "a-f5d1f6dc37fd3ef2",
   "role": "assistant",
   "text": "\n\nHier ist ein schnelles und einfaches Rezept für Pasta mit Hähnchen für vier Personen:\n\n```hui\n{\n  \"type\": \"recipe\",\n  \"id\": \"pasta-huhn-schnell\",\n  \"title\": \"Schnelle Pasta mit Hähnchen\",\n  \"servings\": 4,\n  \"time\": {\n    \"prep\": 10,\n    \"cook\": 20,\n    \"total\": 30\n  },\n  \"ingredients\": [\n    {\"qty\": 400, \"unit\": \"g\", \"item\": \"Penne oder Fettuccine\"},\n    {\"qty\": 600, \"unit\": \"g\", \"item\": \"Hähnchenfilet\"},\n    {\"qty\": 3, \"unit\": \"EL\", \"item\": \"Olivenöl\"},\n    {\"qty\": 3, \"item\": \"Knoblauchzehen, gehackt\"},\n    {\"qty\": 200, \"unit\": \"ml\", \"item\": \"Sahne\"},\n    {\"qty\": 200, \"unit\": \"ml\", \"item\": \"Hühnerbrühe\"},\n    {\"qty\": 150, \"unit\": \"g\", \"item\": \"getrocknete Tomaten in Öl\"},\n    {\"qty\": 1, \"unit\": \"TL\", \"item\": \"italienische Kräuter\"},\n    {\"qty\": null, \"item\": \"Salz und Pfeffer nach Geschmack\"},\n    {\"qty\": 50, \"unit\": \"g\", \"item\": \"Parmesan, gerieben\"}\n  ],\n  \"steps\": [\n    {\"text\": \"Salzwasser aufkochen und Pasta nach Packungsanleitung garen.\"},\n    {\"text\": \"Hähnchenfilet in Streifen schneiden, mit Salz und Pfeffer würzen.\"},\n    {\"text\": \"Olivenöl in einer großen Pfanne erhitzen und Hähnchen von beiden Seiten 6–7 Min. braten, dann herausnehmen.\"},\n    {\"text\": \"Knoblauch in der Pfanne 1 Min. anbraten.\"},\n    {\"text\": \"Hühnerbrühe und Sahne hinzufügen, aufkochen lassen.\"},\n    {\"text\": \"Getrocknete Tomaten und italienische Kräuter einrühren, 3–4 Min. köcheln.\"},\n    {\"text\": \"Hähnchen zurück in die Pfanne, 2 Min. durcherwärmen.\"},\n    {\"text\": \"Mit Salz, Pfeffer und Parmesan abschmecken.\"},\n    {\"text\": \"Pasta zugeben oder auf Tellern anrichten, Sauce darüber verteilen.\"}\n  ]\n}\n```\n\nDie ganze Gericht ist in etwa 30 Minuten fertig. Das Hähnchen wird schnell gar, und die cremige Tomatensauce lässt sich währenddessen parallel zubereiten. Guten Appetit!",
   "createdAt": 1792473523122
  },
  {
   "id": "u-29247fbffcf832e0",
   "role": "user",
   "text": "Mach das bitte vegetarisch, kein Fleisch und kein Fisch.",
   "createdAt": 1792473532436
  },
  {
   "id": "a-c254bee559fa554e",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"recipe\",\n  \"id\": \"pasta-vegetarisch-schnell\",\n  \"title\": \"Schnelle vegetarische Pasta\",\n  \"servings\": 4,\n  \"time\": {\n    \"prep\": 10,\n    \"cook\": 20,\n    \"total\": 30\n  },\n  \"ingredients\": [\n    {\"qty\": 400, \"unit\": \"g\", \"item\": \"Penne oder Fettuccine\"},\n    {\"qty\": 300, \"unit\": \"g\", \"item\": \"Zucchini\"},\n    {\"qty\": 250, \"unit\": \"g\", \"item\": \"Champignons\"},\n    {\"qty\": 1, \"item\": \"rote Paprika\"},\n    {\"qty\": 3, \"unit\": \"EL\", \"item\": \"Olivenöl\"},\n    {\"qty\": 4, \"item\": \"Knoblauchzehen, gehackt\"},\n    {\"qty\": 200, \"unit\": \"ml\", \"item\": \"Sahne\"},\n    {\"qty\": 200, \"unit\": \"ml\", \"item\": \"Gemüsebrühe\"},\n    {\"qty\": 150, \"unit\": \"g\", \"item\": \"getrocknete Tomaten in Öl\"},\n    {\"qty\": 1, \"unit\": \"TL\", \"item\": \"italienische Kräuter\"},\n    {\"qty\": null, \"item\": \"Salz und Pfeffer nach Geschmack\"},\n    {\"qty\": 50, \"unit\": \"g\", \"item\": \"Parmesan, gerieben\"}\n  ],\n  \"steps\": [\n    {\"text\": \"Salzwasser aufkochen und Pasta nach Packungsanleitung garen.\"},\n    {\"text\": \"Zucchini in Scheiben, Champignons in Viertel, Paprika in Streifen schneiden.\"},\n    {\"text\": \"Olivenöl in einer großen Pfanne erhitzen und Champignons 4–5 Min. braten, dann herausnehmen.\"},\n    {\"text\": \"Zucchini und Paprika in der Pfanne 3–4 Min. anbraten.\"},\n    {\"text\": \"Knoblauch hinzufügen und 1 Min. mitbraten.\"},\n    {\"text\": \"Gemüsebrühe und Sahne einrühren, aufkochen lassen.\"},\n    {\"text\": \"Getrocknete Tomaten, italienische Kräuter und Champignons zurück in die Pfanne, 3–4 Min. köcheln.\"},\n    {\"text\": \"Mit Salz, Pfeffer und Parmesan abschmecken.\"},\n    {\"text\": \"Pasta zugeben oder auf Tellern anrichten, Sauce darüber verteilen.\"}\n  ]\n}\n```\n\nGleiche Zubereitungszeit, aber jetzt mit Zucchini, Champignons und Paprika statt Hähnchen. Die Sauce bleibt schön cremig und würzig.",
   "createdAt": 1792473532436
  },
  {
   "id": "u-ba468f6b9af8099c",
   "role": "user",
   "text": "Jetzt die Einkaufslsite zum Abhaken bitte. Salz und Öl haben wir schon.",
   "createdAt": 1792473539615
  },
  {
   "id": "a-28bb53fdf7427d7d",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"pasta-einkauf\",\n  \"items\": [\n    {\"title\": \"Penne oder Fettuccine\", \"qty\": \"400 g\"},\n    {\"title\": \"Zucchini\", \"qty\": \"300 g\"},\n    {\"title\": \"Champignons\", \"qty\": \"250 g\"},\n    {\"title\": \"Rote Paprika\", \"qty\": \"1\"},\n    {\"title\": \"Knoblauch\", \"qty\": \"4 Zehen\"},\n    {\"title\": \"Sahne\", \"qty\": \"200 ml\"},\n    {\"title\": \"Gemüsebrühe\", \"qty\": \"200 ml\"},\n    {\"title\": \"Getrocknete Tomaten in Öl\", \"qty\": \"150 g\"},\n    {\"title\": \"Italienische Kräuter\", \"qty\": \"1 TL\"},\n    {\"title\": \"Pfeffer\"},\n    {\"title\": \"Parmesan, gerieben\", \"qty\": \"50 g\"}\n  ]\n}\n```\n\nSalz und Olivenöl sind schon gestrichen. Einfach abhaken, was ihr kauft.",
   "createdAt": 1792473539615
  },
  {
   "id": "u-627977b85503490e",
   "role": "user",
   "text": "[checklist:pasta-einkauf] erledigt: 400 g Penne oder Fettuccine · offen: 300 g Zucchini, 250 g Champignons, 1 Rote Paprika, 4 Zehen Knoblauch, 200 ml Sahne, 200 ml Gemüsebrühe, 150 g Getrocknete Tomaten in Öl, 1 TL Italienische Kräuter, Pfeffer, 50 g Parmesan, gerieben",
   "createdAt": 1792474223845
  },
  {
   "id": "a-c8252cfd6f17b190",
   "role": "assistant",
   "text": "Pasta besorgt – der Rest steht noch auf der Liste. Viel Erfolg beim Einkaufen und guten Appetit beim Kochen!",
   "createdAt": 1792474223845
  }
 ],
 "learning": [
  {
   "id": "u-962a93de11effd96",
   "role": "user",
   "text": "Ich lerne Englisch. Gib mir fünf Wörter rund ums Reisen und danach ein kleines Quiz zum Antippen.",
   "createdAt": 1792473579207
  },
  {
   "id": "a-16b48a5716dc683f",
   "role": "assistant",
   "text": "Ich lerne Englisch. Gib mir fünf Wörter rund ums Reisen und danach ein kleines Quiz zum Antippen.\n\n```hui\n{\n  \"type\": \"vocab\",\n  \"id\": \"travel_vocab\",\n  \"from\": \"de\",\n  \"to\": \"en\",\n  \"items\": [\n    {\n      \"term\": \"Koffer\",\n      \"translation\": \"suitcase\",\n      \"example\": \"Ich packe meinen Koffer für die Reise.\"\n    },\n    {\n      \"term\": \"Flugticket\",\n      \"translation\": \"flight ticket\",\n      \"example\": \"Wo ist mein Flugticket?\"\n    },\n    {\n      \"term\": \"Unterkunft\",\n      \"translation\": \"accommodation\",\n      \"example\": \"Die Unterkunft ist sehr komfortabel.\"\n    },\n    {\n      \"term\": \"Reisepass\",\n      \"translation\": \"passport\",\n      \"example\": \"Vergiss deinen Reisepass nicht!\"\n    },\n    {\n      \"term\": \"Sehenswürdigkeit\",\n      \"translation\": \"landmark\",\n      \"example\": \"Der Eiffelturm ist eine berühmte Sehenswürdigkeit.\"\n    }\n  ]\n}\n```\n\n```hui\n{\n  \"type\": \"quiz\",\n  \"id\": \"travel_quiz\",\n  \"questions\": [\n    {\n      \"q\": \"Wie heißt 'Reisepass' auf Englisch?\",\n      \"options\": [\"passport\", \"baggage\", \"destination\"],\n      \"answer\": 0\n    },\n    {\n      \"q\": \"Welches Wort bedeutet 'Unterkunft'?\",\n      \"options\": [\"flight\", \"accommodation\", \"landmark\"],\n      \"answer\": 1\n    },\n    {\n      \"q\": \"'Suitcase' ist...\",\n      \"options\": [\"Flugticket\", \"Koffer\", \"Flughafen\"],\n      \"answer\": 1\n    },\n    {\n      \"q\": \"Was ist ein 'landmark'?\",\n      \"options\": [\"Sehenswürdigkeit\", \"Reisebus\", \"Reiseleiter\"],\n      \"answer\": 0\n    },\n    {\n      \"q\": \"Wie heißt 'flight ticket' auf Deutsch?\",\n      \"options\": [\"Flughafen\", \"Flugticket\", \"Bordkarte\"],\n      \"answer\": 1\n    }\n  ]\n}\n```",
   "createdAt": 1792473579207
  },
  {
   "id": "u-5a0221cce026dc76",
   "role": "user",
   "text": "Was bedeutet departure nochmal? Erklärs mir mit einem einfachen Beispielsatz.",
   "createdAt": 1792473586065
  },
  {
   "id": "a-facd1957eca3d757",
   "role": "assistant",
   "text": "\"Departure\" bedeutet \"Abfahrt\" oder \"Abflug\" – der Moment, wenn eine Reise losgeht.\n\nBeispielsatz: \"The departure of our flight is at 10 a.m.\" (Der Abflug unseres Fluges ist um 10 Uhr morgens.)\n\nOder: \"We need to be at the station before departure.\" (Wir müssen vor der Abfahrt am Bahnhof sein.)",
   "createdAt": 1792473586065
  },
  {
   "id": "u-35dd810c9bb18694",
   "role": "user",
   "text": "Noch eine Frage bitte, etwas schwerer und mit drei Antworten zum Auswählen.",
   "createdAt": 1792473588782
  },
  {
   "id": "a-2b82bea500bf04e1",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"choice\",\n  \"id\": \"travel_question\",\n  \"question\": \"Was ist der Unterschied zwischen 'departure' und 'arrival'?\",\n  \"options\": [\n    {\n      \"label\": \"Departure = Ankunft, Arrival = Abfahrt\",\n      \"description\": \"Das ist falsch herum.\"\n    },\n    {\n      \"label\": \"Departure = Abfahrt/Abflug, Arrival = Ankunft\",\n      \"description\": \"Richtig! Departure ist, wenn man losfährt, Arrival ist, wenn man ankommt.\"\n    },\n    {\n      \"label\": \"Beide bedeuten das Gleiche\",\n      \"description\": \"Nein, das sind Gegensätze.\"\n    }\n  ]\n}\n```",
   "createdAt": 1792473588782
  }
 ],
 "workout": [
  {
   "id": "u-212b0a5ed54661ef",
   "role": "user",
   "text": "Mach mir einen einfachen Trainingsplan für zuhause: 20 Minuten, ohne Geräte, für Anfänger. Ich möchte direkt mitmachen.",
   "createdAt": 1792473592883
  },
  {
   "id": "a-2d2b76c9ca474a7e",
   "role": "assistant",
   "text": "Ich erstelle dir einen 20-Minuten-Trainingsplan ohne Geräte für zu Hause.\n\nHier ist dein 20-Minuten-Anfänger-Trainingsplan für zu Hause — bereit zum Starten:\n\n```hui\n{\n  \"type\": \"workout\",\n  \"id\": \"home_20min\",\n  \"title\": \"20-Minuten Anfänger-Workout (keine Geräte)\",\n  \"warmup\": 2,\n  \"exercises\": [\n    {\n      \"name\": \"Jumping Jacks\",\n      \"seconds\": 30,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Kniebeugen\",\n      \"reps\": 15,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Liegestütze (auf den Knien möglich)\",\n      \"reps\": 10,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Plank\",\n      \"seconds\": 20,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Ausfallschritte (pro Bein)\",\n      \"reps\": 10,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Bergsteiger\",\n      \"seconds\": 30,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Sit-ups oder Crunches\",\n      \"reps\": 15,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"High Knees\",\n      \"seconds\": 30,\n      \"restSeconds\": 20\n    }\n  ],\n  \"cooldown\": 2\n}\n```\n\n**So funktioniert es:**\n- 2 Min Aufwärmen (langsam bewegen, dehnen)\n- 8 Übungen im Wechsel, insgesamt ~14–16 Min\n- 2 Min Cool-down (langsam atmen, dehnen)\n\n**Anfänger-Tipps:**\n- Liegestütze: Fang auf den Knien an, später auf den Füßen\n- Kniebeugen: Tiefe so, wie es sich gut anfühlt\n- Pausiert gerne länger, wenn nötig\n- Morgen oder abends — wann dir passt\n\nKlick \"Start\" in der App und trainiere los!",
   "createdAt": 1792473592883
  },
  {
   "id": "u-7cbe6bc0badd7897",
   "role": "user",
   "text": "Liegestütze sind mir zu schwer. Kannst du die austauschen?",
   "createdAt": 1792473601301
  },
  {
   "id": "a-ac69b88e4b918bc8",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"workout\",\n  \"id\": \"home_20min\",\n  \"title\": \"20-Minuten Anfänger-Workout (keine Geräte)\",\n  \"warmup\": 2,\n  \"exercises\": [\n    {\n      \"name\": \"Jumping Jacks\",\n      \"seconds\": 30,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Kniebeugen\",\n      \"reps\": 15,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Wandstütze (gegen die Wand lehnen, 30 Sekunden halten)\",\n      \"seconds\": 30,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Plank\",\n      \"seconds\": 20,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Ausfallschritte (pro Bein)\",\n      \"reps\": 10,\n      \"restSeconds\": 20\n    },\n    {\n      \"name\": \"Bergsteiger\",\n      \"seconds\": 30,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"Sit-ups oder Crunches\",\n      \"reps\": 15,\n      \"restSeconds\": 15\n    },\n    {\n      \"name\": \"High Knees\",\n      \"seconds\": 30,\n      \"restSeconds\": 20\n    }\n  ],\n  \"cooldown\": 2\n}\n```\n\nLiegestütze sind raus — stattdessen Wandstütze. Das ist viel einfacher: Du lehnst dich gegen die Wand, als würdest du sie hochdrücken. Trainiert die gleichen Muskeln, aber ohne Gewicht. Wenn das zu einfach wird, kannst du später auf Liegestütze hochfahren.\n\nViel Erfolg!",
   "createdAt": 1792473601301
  },
  {
   "id": "u-d5a21b261a1414a6",
   "role": "user",
   "text": "Und für die ganze Woche als übersichtlichen Plan bitte, nur Montag Mittwoch Freitag.",
   "createdAt": 1792473606530
  },
  {
   "id": "a-231ecd933d3dc77c",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"agenda\",\n  \"id\": \"weekly_workout\",\n  \"blocks\": [\n    {\n      \"start\": \"09:00\",\n      \"end\": \"09:20\",\n      \"title\": \"20-Min Anfänger-Workout\"\n    },\n    {\n      \"start\": \"09:00\",\n      \"end\": \"09:20\",\n      \"title\": \"20-Min Anfänger-Workout\"\n    },\n    {\n      \"start\": \"09:00\",\n      \"end\": \"09:20\",\n      \"title\": \"20-Min Anfänger-Workout\"\n    }\n  ]\n}\n```\n\nDas ist ein Tages-Plan. Für die ganze Woche brauch ich `timeline` statt `agenda`. Hier ist dein Wochenplan mit Montag, Mittwoch, Freitag:\n\n```hui\n{\n  \"type\": \"timeline\",\n  \"id\": \"weekly_workout\",\n  \"items\": [\n    {\n      \"time\": \"Montag, 09:00\",\n      \"title\": \"20-Min Anfänger-Workout\",\n      \"detail\": \"Warming up, Jumping Jacks, Kniebeugen, Wandstütze, Plank, Ausfallschritte, Bergsteiger, Sit-ups, High Knees, Cool-down\"\n    },\n    {\n      \"time\": \"Mittwoch, 09:00\",\n      \"title\": \"20-Min Anfänger-Workout\",\n      \"detail\": \"Warming up, Jumping Jacks, Kniebeugen, Wandstütze, Plank, Ausfallschritte, Bergsteiger, Sit-ups, High Knees, Cool-down\"\n    },\n    {\n      \"time\": \"Freitag, 09:00\",\n      \"title\": \"20-Min Anfänger-Workout\",\n      \"detail\": \"Warming up, Jumping Jacks, Kniebeugen, Wandstütze, Plank, Ausfallschritte, Bergsteiger, Sit-ups, High Knees, Cool-down\"\n    }\n  ]\n}\n```\n\nDrei Trainingstage pro Woche, dazwischen Ruhetage. Perfekt für Anfänger — dein Körper regeneriert besser.",
   "createdAt": 1792473606530
  }
 ],
 "shopping": [
  {
   "id": "u-52d60da88dae65c1",
   "role": "user",
   "text": "Einkaufsliste für Samstag",
   "createdAt": 1792473780991
  },
  {
   "id": "a-34eb741d1887e929",
   "role": "assistant",
   "text": "Ich kann dir eine Einkaufsliste für Samstag erstellen. Damit die Liste praktisch wird, brauchte ich noch ein paar Details:\n\n1. **Wofür brauchst du die Einkäufe?** (z.B. Wochenend-Mahlzeiten, Grill, Brunch, Party?)\n2. **Wie viele Personen?**\n3. **Spezielle Wünsche oder Diäten?** (vegetarisch, glutenfrei, etc.)\n4. **Budget oder Limits?**\n\nOder möchtest du eine Standard-Wocheneinkaufsliste? Dann kann ich dir direkt eine mit typischen Lebensmitteln vorschlagen, die du dann anpassen kannst.",
   "createdAt": 1792473780991
  },
  {
   "id": "u-2e164bca57de3799",
   "role": "user",
   "text": "füg Milch dazu",
   "createdAt": 1792473790824
  },
  {
   "id": "a-aad427476a72175e",
   "role": "assistant",
   "text": "Ich erstelle dir eine Einkaufsliste für Samstag mit Milch als Start:\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": false}\n  ]\n}\n```\n\nWas möchtest du noch hinzufügen? Nenne mir weitere Artikel, oder sag mir, wofür du einkaufen möchtest – dann ergänze ich die Liste sinnvoll.",
   "createdAt": 1792473790824
  },
  {
   "id": "u-3d74e74ff885e244",
   "role": "user",
   "text": "Eier hab ich schon",
   "createdAt": 1792473793557
  },
  {
   "id": "a-215bcee1313f5400",
   "role": "assistant",
   "text": "Verstanden. Deine Liste bleibt:\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": false}\n  ]\n}\n```\n\nWas kommt noch drauf?",
   "createdAt": 1792473793557
  },
  {
   "id": "u-f662fbcd8d79c5db",
   "role": "user",
   "text": "Wir sind zu zweit. Noch Brot, Eier und Tomaten dazu, bitte.",
   "createdAt": 1792473809391,
   "live": {
    "liste": {
     "v": 0,
     "create": "checklist",
     "state": {
      "items": [
       {
        "id": "milch",
        "text": "Milch"
       }
      ],
      "title": "Liste",
      "kind": "generic"
     },
     "bid": "b-mvg8mdoq18umx"
    }
   }
  },
  {
   "id": "a-d482195bd5eba50a",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": false},\n    {\"title\": \"Brot\", \"checked\": false},\n    {\"title\": \"Eier\", \"checked\": false},\n    {\"title\": \"Tomaten\", \"checked\": false}\n  ]\n}\n```\n\nFertig. Noch etwas?",
   "createdAt": 1792473809391
  },
  {
   "id": "u-3bcf686e7322b180",
   "role": "user",
   "text": "Eier hab ich schon",
   "createdAt": 1792473812140
  },
  {
   "id": "a-b8d5d2127f636c14",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": false},\n    {\"title\": \"Brot\", \"checked\": false},\n    {\"title\": \"Tomaten\", \"checked\": false}\n  ]\n}\n```\n\nEier raus. Noch was?",
   "createdAt": 1792473812140
  },
  {
   "id": "u-5bc52bcf70b46b7f",
   "role": "user",
   "text": "Was kann ich daraus zum Frühstück machen?",
   "createdAt": 1792473814889
  },
  {
   "id": "a-8c6e8af5de1685db",
   "role": "assistant",
   "text": "Mit Milch, Brot und Tomaten kannst du zum Frühstück machen:\n\n**Klassisch:** Brot mit Butter und Marmelade + Milch zum Trinken.\n\n**Herzhaft:** Tomaten auf getoastetem Brot (mit Salz, Pfeffer, Öl) + Milch oder Kaffee mit Milch.\n\n**Schnell & sättigend:** Milchbrei/Porridge aus Milch + Brot (zerbröckelt), dazu Tomaten als Saft oder gekocht.\n\n**Mit mehr Aroma:** Tomatenbrot toasten, mit Knoblauch und Olivenöl reiben, dazu Milchkaffee.\n\nWillst du noch was auf die Liste, um die Optionen zu erweitern? (z.B. Käse, Schinken, Kräuter, Müsli?)",
   "createdAt": 1792473814889
  },
  {
   "id": "u-6698677e4b678914",
   "role": "user",
   "text": "mehr Details",
   "createdAt": 1792473819290
  },
  {
   "id": "a-375d962da6e61052",
   "role": "assistant",
   "text": "Hier sind praktische Frühstücksideen mit Milch, Brot und Tomaten für zwei Personen:\n\n**1. Tomaten-Brot-Frühstück (herzhaft)**\nBrot toasten, mit Olivenöl einreiben, frische Tomaten drauflegen, Salz und Pfeffer. Dazu Milchkaffee oder Kakao. Einfach, schnell, sättigend.\n\n**2. Tomatensaft-Frühstück**\nTomaten kleinschneiden, leicht salzen, als erfrischenden Saft trinken oder im Glas essen. Brot dazu, Milch zum Trinken. Gut an wärmeren Tagen.\n\n**3. Geröstetes Tomatenbrot**\nBrot aufschneiden, toasten, mit Knoblauch (falls vorhanden) und Olivenöl einreiben. Frische Tomaten oben drauf oder Tomatenscheiben direkt mittoasten. Mit Milchkaffee.\n\n**4. Warmes Tomaten-Brot-Gericht**\nBrot würfeln, in Milch mit Tomaten (kleingeschnitten) kurz köcheln lassen – wie ein Frühstückseintopf. Mit Kräutern würzen, wenn vorhanden.\n\n**5. Französisches Frühstück**\nBrot mit Butter und Zucker oder Marmelade, Milch zum Tauchen oder trinken. Tomaten separat als frische Beilage (Vitamin).\n\n**Empfehlung für Samstag zu zweit:** Variiere – einer macht herzhaft (Variante 1 oder 3), der andere süß (Variante 5). So habt ihr Abwechslung und nutzt alle drei Zutaten.\n\nBrauchst du noch andere Sachen kaufen, um die Rezepte zu verfeinern?",
   "createdAt": 1792473819290
  },
  {
   "id": "u-04bb939c6e2a88cd",
   "role": "user",
   "text": "was fehlt noch?",
   "createdAt": 1792473826139
  },
  {
   "id": "a-3e76093b061937bc",
   "role": "assistant",
   "text": "Für ein volleres Frühstück zu zweit fehlen praktisch:\n\n**Basics:**\n- Butter (zum Brot)\n- Käse oder Schinken (herzhaft)\n- Marmelade oder Honig (süß)\n\n**Geschmack:**\n- Olivenöl (für Tomatenbrot)\n- Salz, Pfeffer, Kräuter (zum Würzen)\n\n**Getränke:**\n- Kaffee oder Tee (zur Milch)\n\n**Extra Sättigung:**\n- Müsli oder Joghurt (mit Milch)\n- Käsesorten (zu Brot und Tomaten)\n\n**Minimal für Samstag:** Butter + Käse/Schinken + Marmelade. Dann habt ihr süß und herzhaft.\n\nWas soll auf die Liste?",
   "createdAt": 1792473826139
  },
  {
   "id": "u-1bcb08d170c04265",
   "role": "user",
   "text": "Aktualisiere bitte diese Live-Karte: Milch, Brot und Tomaten fehlen noch; Eier habe ich schon.",
   "createdAt": 1792473863356,
   "live": {
    "liste": {
     "v": 1,
     "ops": [],
     "bid": "b-mvg8noos8gmb4",
     "focus": true
    }
   }
  },
  {
   "id": "a-3bcca584efe7bc5e",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": false},\n    {\"title\": \"Brot\", \"checked\": false},\n    {\"title\": \"Tomaten\", \"checked\": false}\n  ]\n}\n```\n\nListe aktualisiert – Eier raus, die drei Basics bleiben.",
   "createdAt": 1792473863356
  },
  {
   "id": "u-1242c44a3f438161",
   "role": "user",
   "text": "Was muss ich für Samstag noch besorgen?",
   "createdAt": 1792474309757,
   "live": {
    "liste": {
     "v": 1,
     "ops": [
      {
       "check": "milch"
      }
     ],
     "bid": "b-mvg8o3398y1dh"
    }
   }
  },
  {
   "id": "a-7b3765cd1eaa5aa7",
   "role": "assistant",
   "text": "Die Milch hast du schon abgehakt. Dir fehlen noch:\n\n```hui\n{\n  \"type\": \"checklist\",\n  \"id\": \"einkaufsliste_samstag\",\n  \"items\": [\n    {\"title\": \"Milch\", \"checked\": true},\n    {\"title\": \"Brot\", \"checked\": false},\n    {\"title\": \"Tomaten\", \"checked\": false}\n  ]\n}\n```\n\nBrot und Tomaten. Brauchst du noch etwas anderes zum Frühstück (Butter, Käse, Marmelade)?",
   "createdAt": 1792474309757
  }
 ],
 "trip": [
  {
   "id": "u-663aab975961a646",
   "role": "user",
   "text": "Plane uns zu zweit drei entspannte Tage in Salzburg, Freitag bis Sonntag ohne Auto. Freitag Anreise, Samstag Museen, Sonntag Gärten. Als übersichtlichen Reiseplan bitte.",
   "createdAt": 1792473884821
  },
  {
   "id": "a-55a768b490a834ce",
   "role": "assistant",
   "text": "Ich plane einen entspannten Wochenendtrip nach Salzburg für zwei Personen. Lass mich erst aktuelle Informationen zu Museen, Gärten und Verkehr zusammentragen.\n\nKeine Suchergebnisse für aktuelle Daten verfügbar. Ich erstelle dir einen realistischen Plan basierend auf bekannten Salzburg-Highlights und zeige dir die Struktur als übersichtliche Agenda:\n\n```hui\n{\n  \"type\": \"agenda\",\n  \"id\": \"salzburg_weekend\",\n  \"blocks\": [\n    {\n      \"start\": \"14:00\",\n      \"end\": \"18:00\",\n      \"title\": \"FREITAG: Anreise & Altstadt\"\n    },\n    {\n      \"start\": \"18:30\",\n      \"end\": \"20:30\",\n      \"title\": \"Dinner im Stadtzentrum\"\n    },\n    {\n      \"start\": \"09:00\",\n      \"end\": \"12:00\",\n      \"title\": \"SAMSTAG: Salzburg Museum (Altstadt)\"\n    },\n    {\n      \"start\": \"12:00\",\n      \"end\": \"13:30\",\n      \"title\": \"Mittagspause & Spaziergang\"\n    },\n    {\n      \"start\": \"14:00\",\n      \"end\": \"17:00\",\n      \"title\": \"Hohensalzburg Festung (Seilbahn)\"\n    },\n    {\n      \"start\": \"18:00\",\n      \"end\": \"19:30\",\n      \"title\": \"Getreidegasse & Restaurants\"\n    },\n    {\n      \"start\": \"09:30\",\n      \"end\": \"12:00\",\n      \"title\": \"SONNTAG: Hellbrunn Schloss & Gärten\"\n    },\n    {\n      \"start\": \"12:30\",\n      \"end\": \"14:00\",\n      \"title\": \"Mittagessen Hellbrunn-Bereich\"\n    },\n    {\n      \"start\": \"14:30\",\n      \"end\": \"16:30\",\n      \"title\": \"Mirabel-Garten (optional, Altstadt)\"\n    },\n    {\n      \"start\": \"17:00\",\n      \"end\": \"19:00\",\n      \"title\": \"Abreise / letzter Bummel\"\n    }\n  ]\n}\n```\n\n**Freitag – Anreise & Erster Eindruck**\nAnkunft am Bahnhof, mit der Lokalbahn oder zu Fuß ins Zentrum (ca. 15 min). Hotel-Einchecken, dann durch die Altstadt schlendern – Salzburg ist kompakt und ohnedies fußläufig. Abends ruhig Essen gehen, früh ins Bett.\n\n**Samstag – Museen & Festung**\nMorgens das Salzburg Museum (Altstadt, zur Salzburger Geschichte). Mittags Pause. Nachmittags mit der Seilbahn auf die Hohensalzburg Festung – spektakuläre Aussicht, wenig Anstrengung. Abends Getreidegasse (berühmte Gasse) zum Bummeln und Essen.\n\n**Sonntag – Gärten & Entspannung**\nHellbrunn Schloss mit seinen barocken Wasserspielen und Gärten – ca. 4 km südlich, mit Bus oder Taxi leicht erreichbar. Mittags entspannen. Optional noch der Mirabel-Garten in der Altstadt (eng mit Sound-of-Music verbunden). Entspannte Abreise am Nachmittag.\n\n**Verkehr ohne Auto:** Salzburg hat gutes Busnetz; eine Salzburg Card (3 Tage) deckt ÖV + viele Museen ab – kostet sich meist schnell aus.\n\nPasst dir dieser Mix, oder möchtest du andere Schwerpunkte?",
   "createdAt": 1792473884821
  },
  {
   "id": "u-0cf1cb64b1a19086",
   "role": "user",
   "text": "Samstag regnet es. Tausch die Festung gegen ein Museum drinnen und lass Sonntag entspannt. Bitte behalte den Plan als Live-Karte, die wir weiter ändern können.",
   "createdAt": 1792473912319
  },
  {
   "id": "a-c74d0738caaa748c",
   "role": "assistant",
   "text": "\n\n```hui\n{\n  \"type\": \"live\",\n  \"id\": \"salzburg_plan\",\n  \"blocks\": [\n    {\n      \"type\": \"agenda\",\n      \"blocks\": [\n        {\n          \"start\": \"14:00\",\n          \"end\": \"18:00\",\n          \"title\": \"FREITAG: Anreise & Altstadt\"\n        },\n        {\n          \"start\": \"18:30\",\n          \"end\": \"20:30\",\n          \"title\": \"Dinner im Stadtzentrum\"\n        },\n        {\n          \"start\": \"09:00\",\n          \"end\": \"12:00\",\n          \"title\": \"SAMSTAG: Mozart Wohnhaus (drinnen)\"\n        },\n        {\n          \"start\": \"12:00\",\n          \"end\": \"13:30\",\n          \"title\": \"Mittagspause\"\n        },\n        {\n          \"start\": \"14:00\",\n          \"end\": \"17:00\",\n          \"title\": \"Salzburg Museum oder Salzburg Schloss-Museum (drinnen)\"\n        },\n        {\n          \"start\": \"18:00\",\n          \"end\": \"19:30\",\n          \"title\": \"Abendessen & Entspannung\"\n        },\n        {\n          \"start\": \"09:30\",\n          \"end\": \"12:00\",\n          \"title\": \"SONNTAG: Frühstück & Altstadt-Bummel\"\n        },\n        {\n          \"start\": \"12:30\",\n          \"end\": \"14:00\",\n          \"title\": \"Mittagessen (gemütlich)\"\n        },\n        {\n          \"start\": \"14:30\",\n          \"end\": \"16:30\",\n          \"title\": \"Mirabel-Garten oder Shopping\"\n        },\n        {\n          \"start\": \"17:00\",\n          \"end\": \"19:00\",\n          \"title\": \"Abreise\"\n        }\n      ]\n    }\n  ]\n}\n```\n\nSamstag ist jetzt vollständig indoor: Mozart Wohnhaus am Morgen, dann ein zweites Museum nach Wahl (z.B. Salzburg Museum oder Schloss Leopoldskron). Sonntag entspannt – kein strammes Programm, nur Frühstück, Bummel, gemütliches Essen. Du kannst die Karte jederzeit anpassen, wenn etwas anderes reizt.",
   "createdAt": 1792473912319
  },
  {
   "id": "u-b450a7b8d9d83528",
   "role": "user",
   "text": "Wir kommen Freitag erst um 18 Uhr an. Pass den Freitag an.",
   "createdAt": 1792473920769
  },
  {
   "id": "a-051ead658648866c",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"live\",\n  \"id\": \"salzburg_plan\",\n  \"blocks\": [\n    {\n      \"type\": \"agenda\",\n      \"blocks\": [\n        {\n          \"start\": \"18:00\",\n          \"end\": \"18:45\",\n          \"title\": \"FREITAG: Anreise & Hotel-Check-in\"\n        },\n        {\n          \"start\": \"19:00\",\n          \"end\": \"20:30\",\n          \"title\": \"Abendessen (Altstadt)\"\n        },\n        {\n          \"start\": \"09:00\",\n          \"end\": \"12:00\",\n          \"title\": \"SAMSTAG: Mozart Wohnhaus (drinnen)\"\n        },\n        {\n          \"start\": \"12:00\",\n          \"end\": \"13:30\",\n          \"title\": \"Mittagspause\"\n        },\n        {\n          \"start\": \"14:00\",\n          \"end\": \"17:00\",\n          \"title\": \"Salzburg Museum oder Salzburg Schloss-Museum (drinnen)\"\n        },\n        {\n          \"start\": \"18:00\",\n          \"end\": \"19:30\",\n          \"title\": \"Abendessen & Entspannung\"\n        },\n        {\n          \"start\": \"09:30\",\n          \"end\": \"12:00\",\n          \"title\": \"SONNTAG: Frühstück & Altstadt-Bummel\"\n        },\n        {\n          \"start\": \"12:30\",\n          \"end\": \"14:00\",\n          \"title\": \"Mittagessen (gemütlich)\"\n        },\n        {\n          \"start\": \"14:30\",\n          \"end\": \"16:30\",\n          \"title\": \"Mirabel-Garten oder Shopping\"\n        },\n        {\n          \"start\": \"17:00\",\n          \"end\": \"19:00\",\n          \"title\": \"Abreise\"\n        }\n      ]\n    }\n  ]\n}\n```\n\nFreitag ist jetzt entspannt: Ankunft 18 Uhr, Check-in, dann gemütlich Essen gehen. Früh ins Bett für den Museumstag Samstag.",
   "createdAt": 1792473920769
  },
  {
   "id": "u-33de7086f750a656",
   "role": "user",
   "text": "als Tabelle?",
   "createdAt": 1792473926753
  },
  {
   "id": "a-605ac5f50bdcff2e",
   "role": "assistant",
   "text": "```hui\n{\n  \"type\": \"table\",\n  \"columns\": [\"Zeit\", \"Aktivität\"],\n  \"rows\": [\n    [\"FREITAG\", \"\"],\n    [\"18:00–18:45\", \"Anreise & Hotel-Check-in\"],\n    [\"19:00–20:30\", \"Abendessen (Altstadt)\"],\n    [\"\", \"\"],\n    [\"SAMSTAG\", \"\"],\n    [\"09:00–12:00\", \"Mozart Wohnhaus (drinnen)\"],\n    [\"12:00–13:30\", \"Mittagspause\"],\n    [\"14:00–17:00\", \"Salzburg Museum oder Schloss-Museum (drinnen)\"],\n    [\"18:00–19:30\", \"Abendessen & Entspannung\"],\n    [\"\", \"\"],\n    [\"SONNTAG\", \"\"],\n    [\"09:30–12:00\", \"Frühstück & Altstadt-Bummel\"],\n    [\"12:30–14:00\", \"Mittagessen (gemütlich)\"],\n    [\"14:30–16:30\", \"Mirabel-Garten oder Shopping\"],\n    [\"17:00–19:00\", \"Abreise\"]\n  ]\n}\n```",
   "createdAt": 1792473926753
  }
 ],
 "watchlist": [
  {
   "id": "u-5d96b74c4265d8f3",
   "role": "user",
   "text": "Ich möchte eine Watchlist für unsere Filmabende: Arrival, Interstellar und Die fabelhafte Welt der Amélie. Halte fest, was wir noch sehen möchten.",
   "createdAt": 1792473936285
  },
  {
   "id": "a-543019a7f08637bc",
   "role": "assistant",
   "text": "Ich erstelle dir eine Live-Watchlist für eure Filmabende.\n\nLass mich eine Live-Checkliste für eure Filmabende anlegen:\n\n```hui\n{\n  \"type\": \"live\",\n  \"id\": \"filmabend-watchlist\",\n  \"style\": \"checklist\",\n  \"items\": [\n    {\n      \"title\": \"Arrival\",\n      \"subtitle\": \"Sci-Fi Drama · 116 min\",\n      \"checked\": false\n    },\n    {\n      \"title\": \"Interstellar\",\n      \"subtitle\": \"Sci-Fi Epos · 169 min\",\n      \"checked\": false\n    },\n    {\n      \"title\": \"Die fabelhafte Welt der Amélie\",\n      \"subtitle\": \"Romantische Komödie · 122 min\",\n      \"checked\": false\n    }\n  ]\n}\n```\n\nDie Watchlist ist gespeichert. Ihr könnt jeden Film abhaken, wenn ihr ihn gemeinsam schauen werdet – die Liste merkt sich euren Fortschritt. Wenn ihr neue Filme hinzufügen möchtet, gebt mir Bescheid und ich erweitere sie.",
   "createdAt": 1792473936285
  },
  {
   "id": "u-f7baaf6d7dcdad02",
   "role": "user",
   "text": "Arrival haben wir gestern gesehen. Füg noch Dune dazu.",
   "createdAt": 1792473952867
  },
  {
   "id": "a-063ada7b91ff7c34",
   "role": "assistant",
   "text": "Ich aktualisiere deine Watchlist – Arrival als gesehen markiert und Dune hinzugefügt.\n\n```hui\n{\n  \"type\": \"live\",\n  \"id\": \"filmabend-watchlist\",\n  \"style\": \"checklist\",\n  \"items\": [\n    {\n      \"title\": \"Arrival\",\n      \"subtitle\": \"Sci-Fi Drama · 116 min\",\n      \"checked\": true\n    },\n    {\n      \"title\": \"Interstellar\",\n      \"subtitle\": \"Sci-Fi Epos · 169 min\",\n      \"checked\": false\n    },\n    {\n      \"title\": \"Die fabelhafte Welt der Amélie\",\n      \"subtitle\": \"Romantische Komödie · 122 min\",\n      \"checked\": false\n    },\n    {\n      \"title\": \"Dune\",\n      \"subtitle\": \"Sci-Fi Epos · 166 min\",\n      \"checked\": false\n    }\n  ]\n}\n```\n\nFertig. Arrival ist abgehakt, Dune ist on the list. Viel Spaß bei den nächsten Filmabenden!",
   "createdAt": 1792473952867
  },
  {
   "id": "u-ababe28922e3fb60",
   "role": "user",
   "text": "Was steht noch auf unserer Liste?",
   "createdAt": 1792473956417
  },
  {
   "id": "a-256af312c3cccfda",
   "role": "assistant",
   "text": "Auf eurer Watchlist stehen noch drei Filme:\n\n- Interstellar (Sci-Fi Epos · 169 min)\n- Die fabelhafte Welt der Amélie (Romantische Komödie · 122 min)\n- Dune (Sci-Fi Epos · 166 min)\n\nArrival habt ihr bereits gesehen.",
   "createdAt": 1792473956417
  }
 ]
};
