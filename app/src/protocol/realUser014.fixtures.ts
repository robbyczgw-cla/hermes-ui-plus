/**
 * Real hui blocks from the 0.1.4 real-user journeys (default bridge, claude-haiku-4-5, the model never loaded the
 * component references and wrote the shapes from memory), verbatim. `translation` came in a ```translation fence.
 * `workout-phases`, `calc-expressions`, `checklist-subtitle-en`, `calc-symbols`, `buttons-string-actions`: from the verification re-runs of the fixes (same setup;
 * the checklist cut to the first five items, the calc after its recommendation). Used by protocol/realUser.test.ts and the render sweep (ui/renderFixtures.ts).
 */
export const REAL_USER_014: Readonly<Record<string, Record<string, unknown>>> = {
 "map-salzburg": {
  "type": "map",
  "places": [
   {
    "name": "Salzburg Altstadt & Salzburg Museum",
    "address": "Mozartplatz 1, 5020 Salzburg",
    "lat": 47.8122,
    "lng": 13.0458,
    "imageQuery": "Salzburg Altstadt Museum",
    "hours": "Salzburg Museum: Di–So 09:00–17:00",
    "note": "Zentral, zu Fuß erkundbar"
   },
   {
    "name": "Festung Hohensalzburg",
    "address": "Mozartplatz 5, 5020 Salzburg",
    "lat": 47.8145,
    "lng": 13.0482,
    "imageQuery": "Hohensalzburg Festung",
    "hours": "täglich 09:00–17:00 (November bis März bis 16:30)",
    "note": "Festungsbahn ab Markusplatz (€13,50 für zwei retour)"
   },
   {
    "name": "Mirabell-Palais & Schloss Hellbrunn",
    "address": "Schloss Hellbrunn, Fürstenweg 37, 5020 Salzburg",
    "lat": 47.8155,
    "lng": 13.0748,
    "imageQuery": "Mirabell Palais Schloss Hellbrunn",
    "hours": "Mirabellgarten: täglich frei zugänglich | Hellbrunn: täglich 09:00–17:30",
    "note": "Bus 55 vom Zentrum direkt hin; Wasserspiele sind highlight"
   }
  ]
 },
 "agenda-weekend-days": {
  "type": "agenda",
  "id": "salzburg_weekend",
  "items": [
   {
    "time": "Samstag 09:00",
    "title": "Altstadt & Salzburg Museum",
    "detail": "Spaziergang durch die Altstadt, Getreidegasse (Mozart-Geburtshaus), Salzburg Museum (€13/Person). Kostenlos: Residenzplatz, Domplatz, Pferdeschwemme. Mittagessen in der Altstadt (€15–20/Person)",
    "imageQuery": "Salzburg Altstadt Getreidegasse"
   },
   {
    "time": "Samstag 14:30",
    "title": "Festung Hohensalzburg (Highlight)",
    "detail": "Mit der Festungsbahn rauffahren (€13,50 für zwei Person hin und zurück). Festung frei begehbar, Blick über die Stadt. Kaffee oben (€5/Person). Insgesamt €30–35",
    "imageQuery": "Hohensalzburg Festung Salzburg"
   },
   {
    "time": "Samstag 18:00",
    "title": "Abendessen & Salzach-Ufer",
    "detail": "Gemütliches Abendessen am Salzach-Ufer oder in der Altstadt. Budget €25–30 pro Person",
    "imageQuery": "Salzburg Salzach Fluss Abend"
   },
   {
    "time": "Sonntag 09:00",
    "title": "Mirabell-Palais & Schloss Hellbrunn",
    "detail": "Mirabellgarten kostenlos (wunderschön!). Dann mit Bus/Straßenbahn zu Schloss Hellbrunn (€15,50/Person; Wasserspiele & Gruotten). Gesamtbudget Bus €4 + Eintritt €31",
    "imageQuery": "Mirabell Palais Salzburg Garten"
   },
   {
    "time": "Sonntag 14:00",
    "title": "Picknick & Kapuzinerberg",
    "detail": "Picknicken im Mirabellgarten oder am Salzach-Ufer (€20 für zwei). Entspannter Aufstieg Kapuzinerberg (kostenlos, schöner Blick). Kaffeepause unterwegs",
    "imageQuery": "Kapuzinerberg Salzburg Aussicht"
   },
   {
    "time": "Sonntag 16:00",
    "title": "Entspannter Ausklang",
    "detail": "Kaffehaus in der Altstadt oder am Salzach-Ufer, danach gemütlich zurück zum Bahnhof"
   }
  ]
 },
 "agenda-rain-ranges": {
  "type": "agenda",
  "id": "salzburg_rainy_day",
  "items": [
   {
    "time": "09:00–11:00",
    "title": "Salzburg Museum",
    "detail": "Mozartplatz 1, 5020 Salzburg | Di–So 09:00–17:00 | €13/Person | Salzburgs Geschichte, Kunstsammlungen, gemütlich durchzuschauen (ca. 2h)"
   },
   {
    "time": "11:00–12:30",
    "title": "Mozart-Geburtshaus (Getreidegasse)",
    "detail": "Getreidegasse 9, 5020 Salzburg | täglich 09:00–17:30 | €12/Person | Mozarts Kindheit, enge historische Gassen, überdacht einkaufen"
   },
   {
    "time": "12:30–13:30",
    "title": "Mittagessen im Café",
    "detail": "Café Tomaselli, Alte Markt 9, 5020 Salzburg | ältestes Kaffeehaus Österreichs seit 1705 | gemütlich, trocken, €20–25/Person mit Kaffee"
   },
   {
    "time": "14:00–16:00",
    "title": "Festung Hohensalzburg (indoor)",
    "detail": "Festung 1, 5020 Salzburg | täglich 09:00–17:00 | €13,50 Festungsbahn hin/zurück für zwei | Innenräume, Puppenbahn-Museum, kein Regen beim Anblick genießen"
   },
   {
    "time": "16:00–17:30",
    "title": "Dommuseum oder Domquartier",
    "detail": "Residenzplatz 1, 5020 Salzburg | Di–So 10:00–17:00 | €13/Person | Mittelalter bis Gegenwart, kunsthistorische Sammlung, komplett indoor"
   },
   {
    "time": "17:30–19:00",
    "title": "Abendessen im Restaurant",
    "detail": "Stiftskeller St. Peter, St.-Peter-Bezirk 8, 5020 Salzburg | Österreichs ältestes Restaurant (803 gegründet!) | klassisch, gemütlich, €30–35/Person | Reservierung empfohlen"
   }
  ]
 },
 "recipe-de": {
  "type": "recipe",
  "title": "Schnelle Hähnchen-Pasta mit Knoblauch und Tomaten",
  "servings": 4,
  "totalTime": 25,
  "ingredients": [
   {
    "item": "Pasta (Penne oder Tagliatelle)",
    "qty": 400,
    "unit": "g"
   },
   {
    "item": "Hähnchenbrust",
    "qty": 500,
    "unit": "g"
   },
   {
    "item": "Knoblauchzehen",
    "qty": 3,
    "unit": ""
   },
   {
    "item": "Kirschtomaten",
    "qty": 300,
    "unit": "g"
   },
   {
    "item": "Olivenöl",
    "qty": 3,
    "unit": "EL"
   },
   {
    "item": "Weißwein",
    "qty": 100,
    "unit": "ml"
   },
   {
    "item": "Gemüsebrühe",
    "qty": 200,
    "unit": "ml"
   },
   {
    "item": "Frische Petersilie",
    "qty": 2,
    "unit": "Handvoll"
   },
   {
    "item": "Salz und Pfeffer",
    "qty": 1,
    "unit": "nach Geschmack"
   },
   {
    "item": "Parmesan",
    "qty": 50,
    "unit": "g"
   }
  ],
  "steps": [
   {
    "title": "Wasser aufsetzen",
    "detail": "Großer Topf mit Salzwasser zum Kochen bringen (ca. 2 Minuten)",
    "time": 2
   },
   {
    "title": "Hähnchen vorbereiten",
    "detail": "Brust in ca. 2 cm große Würfel schneiden",
    "time": 3
   },
   {
    "title": "Pasta kochen",
    "detail": "Pasta ins kochende Wasser, Packungsanweisung beachten (meist 10-12 Min)",
    "time": 10
   },
   {
    "title": "Hähnchen anbraten",
    "detail": "Olivenöl in großer Pfanne erhitzen, Hähnchenwürfel darin 5-6 Min braten bis goldbraun",
    "time": 6
   },
   {
    "title": "Aromaten hinzufügen",
    "detail": "Gehackten Knoblauch 1 Min mitbraten, dann halbierten Kirschtomaten 2 Min dazugeben",
    "time": 3
   },
   {
    "title": "Mit Wein ablöschen",
    "detail": "Weißwein angießen, aufkochen lassen, Brühe hinzufügen",
    "time": 2
   },
   {
    "title": "Sauce reduzieren",
    "detail": "Bei mittlerer Hitze 3-4 Min köcheln lassen bis die Sauce etwas eingekocht ist",
    "time": 4
   },
   {
    "title": "Pasta hinzufügen",
    "detail": "Gegarte Pasta abgießen, zur Sauce geben, kurz vermengen",
    "time": 1
   },
   {
    "title": "Abschmecken und servieren",
    "detail": "Mit Salz und Pfeffer würzen, Petersilie und Parmesan drüber, sofort servieren",
    "time": 2
   }
  ]
 },
 "checklist-de": {
  "type": "checklist",
  "title": "Einkaufsliste für vegetarische Pasta",
  "items": [
   {
    "title": "Pasta (Penne oder Tagliatelle)",
    "qty": "400 g"
   },
   {
    "title": "Champignons oder Austernpilze",
    "qty": "400 g"
   },
   {
    "title": "Knoblauchzehen",
    "qty": "4 Stück"
   },
   {
    "title": "Kirschtomaten",
    "qty": "300 g"
   },
   {
    "title": "Weißwein",
    "qty": "100 ml"
   },
   {
    "title": "Gemüsebrühe",
    "qty": "200 ml"
   },
   {
    "title": "Frische Petersilie",
    "qty": "2 Handvoll"
   },
   {
    "title": "Thymian oder Oregano (frisch)",
    "qty": "1 TL"
   },
   {
    "title": "Parmesan oder veganer Käse",
    "qty": "50 g"
   },
   {
    "title": "Zitrone",
    "qty": "1 Stück (für Saft)"
   }
  ]
 },
 "vocab": {
  "type": "vocab",
  "language": "en",
  "items": [
   {
    "word": "passport",
    "translation": "Reisepass",
    "example": "I need my passport to travel abroad."
   },
   {
    "word": "accommodation",
    "translation": "Unterkunft",
    "example": "We booked a nice accommodation near the beach."
   },
   {
    "word": "itinerary",
    "translation": "Reiseplan",
    "example": "Our itinerary includes three cities."
   },
   {
    "word": "luggage",
    "translation": "Gepäck",
    "example": "Please check your luggage before boarding."
   },
   {
    "word": "destination",
    "translation": "Reiseziel",
    "example": "Our destination is Paris for two weeks."
   }
  ]
 },
 "quiz": {
  "type": "quiz",
  "id": "travel_vocab_quiz",
  "items": [
   {
    "question": "What do you need to travel to another country?",
    "options": [
     "luggage",
     "passport",
     "itinerary"
    ],
    "correct": "passport"
   },
   {
    "question": "A plan of places you want to visit is called a(n)…",
    "options": [
     "accommodation",
     "itinerary",
     "destination"
    ],
    "correct": "itinerary"
   },
   {
    "question": "Where you want to go is your…",
    "options": [
     "destination",
     "passport",
     "luggage"
    ],
    "correct": "destination"
   },
   {
    "question": "A place where you sleep during your trip is…",
    "options": [
     "itinerary",
     "accommodation",
     "luggage"
    ],
    "correct": "accommodation"
   },
   {
    "question": "Your suitcases and bags are your…",
    "options": [
     "passport",
     "destination",
     "luggage"
    ],
    "correct": "luggage"
   }
  ]
 },
 "quiz-harder": {
  "type": "quiz",
  "id": "travel_vocab_advanced",
  "items": [
   {
    "question": "If you want to visit several countries in one trip, you might plan a…",
    "options": [
     "round trip",
     "departure",
     "layover"
    ],
    "correct": "round trip"
   }
  ]
 },
 "workout": {
  "type": "workout",
  "id": "home_20min",
  "duration": "20 Minuten",
  "level": "Anfänger",
  "equipment": "Keine",
  "location": "Zuhause",
  "warmup": {
   "duration": "2 Min",
   "exercises": [
    "30 Sekunden: Locker joggen auf der Stelle",
    "30 Sekunden: Armkreise (vorwärts und rückwärts)"
   ]
  },
  "main": [
   {
    "name": "Kniebeugen",
    "duration": "45 Sekunden",
    "rest": "15 Sekunden",
    "reps": "So viele wie möglich",
    "tip": "Rücken gerade, Gewicht in den Fersen"
   },
   {
    "name": "Liegestütze (an der Wand oder auf den Knien)",
    "duration": "45 Sekunden",
    "rest": "15 Sekunden",
    "reps": "So viele wie möglich",
    "tip": "Körper gerade halten, langsam senken und drücken"
   },
   {
    "name": "Ausfallschritte (alternierend)",
    "duration": "45 Sekunden",
    "rest": "15 Sekunden",
    "reps": "So viele wie möglich",
    "tip": "Großer Schritt nach vorne, hinteres Knie senken"
   },
   {
    "name": "Plank (Unterarmstütz)",
    "duration": "30 Sekunden",
    "rest": "30 Sekunden",
    "reps": "Halten",
    "tip": "Körper gerade wie ein Brett, Bauch anspannen"
   }
  ],
  "rounds": 3,
  "cooldown": {
   "duration": "2 Min",
   "exercises": [
    "Leichte Dehnungen: Oberschenkel, Brust, Schultern",
    "Tiefe Atemzüge zur Entspannung"
   ]
  },
  "notes": "3 Durchgänge à 6 Minuten Training + 1 Minute Pause zwischen den Runden = ~20 Min. Pausen anpassen nach Bedarf. Anfänger: kürzere Zeiten oder mehr Pausen sind OK."
 },
 "agenda-week": {
  "type": "agenda",
  "id": "weekly_training",
  "items": [
   {
    "time": "Montag",
    "title": "20-Minuten Ganzkörper-Workout",
    "detail": "Kniebeugen • Bergsteiger • Ausfallschritte • Plank (3 Runden)"
   },
   {
    "time": "Dienstag",
    "title": "Ruhetag",
    "detail": "Regeneration und Entspannung"
   },
   {
    "time": "Mittwoch",
    "title": "20-Minuten Ganzkörper-Workout",
    "detail": "Kniebeugen • Bergsteiger • Ausfallschritte • Plank (3 Runden)"
   },
   {
    "time": "Donnerstag",
    "title": "Ruhetag",
    "detail": "Regeneration und Entspannung"
   },
   {
    "time": "Freitag",
    "title": "20-Minuten Ganzkörper-Workout",
    "detail": "Kniebeugen • Bergsteiger • Ausfallschritte • Plank (3 Runden)"
   },
   {
    "time": "Samstag & Sonntag",
    "title": "Wochenende",
    "detail": "Frei – je nach Lust leichte Aktivität oder vollständige Ruhe"
   }
  ]
 },
 "choice-de": {
  "type": "choice",
  "id": "train_departure",
  "items": [
   "☀️ Morgens (z.B. 8:00 Uhr)",
   "☀️ Nachmittags (z.B. 14:00 Uhr)"
  ]
 },
 "translation": {
  "type": "translation",
  "language": "English",
  "original": "Hallo, leider schaffe ich es morgen erst um halb vier. Können wir unseren Termin verschieben? Danke für dein Verständnis!",
  "translated": "Hi, unfortunately I can't make it until 3:30 PM tomorrow. Can we reschedule our appointment? Thanks for your understanding!"
 },
 "timer-2min": {
  "type": "timer",
  "seconds": 120
 },
 "timer-3min": {
  "type": "timer",
  "seconds": 180
 },
 "remind": {
  "type": "remind",
  "time": "09:00",
  "title": "Tee kaufen"
 },
 "choice-en": {
  "type": "choice",
  "id": "picnic_lunch",
  "items": [
   {
    "title": "Sandwiches",
    "detail": "Easy to prep, eat one-handed, works for 4 people"
   },
   {
    "title": "Pasta salad",
    "detail": "Can be made ahead, filling, travels well in a container"
   }
  ]
 },
 "recipe-en": {
  "type": "recipe",
  "id": "veggie_pasta_salad",
  "title": "Vegetarian Pasta Salad for 4",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 10,
  "ingredients": [
   {
    "item": "Pasta (penne or fusilli)",
    "amount": 400,
    "unit": "g"
   },
   {
    "item": "Cherry tomatoes",
    "amount": 250,
    "unit": "g"
   },
   {
    "item": "Cucumber",
    "amount": 1,
    "unit": "whole"
   },
   {
    "item": "Bell pepper (any color)",
    "amount": 1,
    "unit": "whole"
   },
   {
    "item": "Feta cheese",
    "amount": 150,
    "unit": "g"
   },
   {
    "item": "Olive oil",
    "amount": 4,
    "unit": "tbsp"
   },
   {
    "item": "Balsamic vinegar",
    "amount": 2,
    "unit": "tbsp"
   },
   {
    "item": "Fresh basil",
    "amount": 10,
    "unit": "leaves"
   },
   {
    "item": "Salt and pepper",
    "amount": 1,
    "unit": "pinch"
   }
  ],
  "steps": [
   {
    "title": "Cook the pasta",
    "detail": "Boil pasta until al dente, drain and let cool slightly"
   },
   {
    "title": "Chop vegetables",
    "detail": "Halve tomatoes, dice cucumber and bell pepper into bite-sized pieces"
   },
   {
    "title": "Combine ingredients",
    "detail": "Mix pasta, vegetables, and feta in a large bowl"
   },
   {
    "title": "Make dressing",
    "detail": "Whisk olive oil and balsamic vinegar, pour over salad"
   },
   {
    "title": "Season and finish",
    "detail": "Tear basil over top, season with salt and pepper. Chill until picnic time"
   }
  ]
 },
 "checklist-en": {
  "type": "checklist",
  "id": "picnic_shopping",
  "title": "Pasta Salad Shopping List",
  "items": [
   {
    "title": "Cherry tomatoes",
    "detail": "250g"
   },
   {
    "title": "Cucumber",
    "detail": "1 whole"
   },
   {
    "title": "Bell pepper",
    "detail": "1 whole (any color)"
   },
   {
    "title": "Feta cheese",
    "detail": "150g"
   },
   {
    "title": "Balsamic vinegar",
    "detail": "2 tbsp needed"
   },
   {
    "title": "Fresh basil",
    "detail": "1 small bunch"
   }
  ]
 },
 "workout-phases": {"type": "workout", "duration": 1200, "intensity": "beginner", "blocks": [{"name": "Warm-up", "duration": 180, "exercises": [{"name": "Arme kreisen", "reps": "30 Sekunden"}, {"name": "Leichte Kniehebs", "reps": "30 Sekunden"}, {"name": "Marsch auf der Stelle", "reps": "30 Sekunden"}]}, {"name": "Haupttraining", "duration": 800, "rounds": 2, "exercises": [{"name": "Liegestütze (auf Knien ok)", "reps": 10, "rest": 30}, {"name": "Kniebeugen", "reps": 15, "rest": 30}, {"name": "Plank", "reps": "20 Sekunden", "rest": 30}, {"name": "Ausfallschritte (pro Bein)", "reps": 10, "rest": 30}, {"name": "Burpees (vereinfacht: Hände runter, Beine zurück)", "reps": 8, "rest": 30}]}, {"name": "Cool-down & Dehnen", "duration": 220, "exercises": [{"name": "Vorbeuge (stehend)", "duration": 30}, {"name": "Lunges-Dehnung", "duration": 30}, {"name": "Schmetterlings-Dehnung", "duration": 30}, {"name": "Rücken-Dehnung", "duration": 30}, {"name": "Tiefe Atemzüge", "duration": 30}]}]},
 "calc-expressions": {"type": "calc", "id": "wien_graz_choice", "title": "Zug vs Auto Wien–Graz", "description": "Gewichte Kosten, Zeit und Umwelt nach deinen Prioritäten", "expressions": [{"id": "cost_weight", "label": "Kostenwichtung (%)", "value": "33", "unit": "%"}, {"id": "time_weight", "label": "Zeitwichtung (%)", "value": "33", "unit": "%"}, {"id": "env_weight", "label": "Umweltwichtung (%)", "value": "34", "unit": "%"}, {"id": "zug_score", "label": "Zug-Gesamtscore", "formula": "(cost_weight * 9) + (time_weight * 8) + (env_weight * 10)", "unit": "Punkte"}, {"id": "auto_score", "label": "Auto-Gesamtscore", "formula": "(cost_weight * 6) + (time_weight * 10) + (env_weight * 3)", "unit": "Punkte"}]},
 "checklist-subtitle-en": {"type": "checklist", "id": "pasta_salad_shopping", "title": "Pasta Salad Shopping List", "items": [{"title": "Cherry tomatoes", "subtitle": "2 cups"}, {"title": "Cucumber", "subtitle": "1 large"}, {"title": "Red bell pepper", "subtitle": "1"}, {"title": "Red onion", "subtitle": "1 (you'll use ¼)"}, {"title": "Fresh mozzarella or feta", "subtitle": "8 oz"}]},
 "calc-symbols": {"type": "calc", "id": "wien_graz_transport", "title": "Wien → Graz: Zug vs Auto", "expressions": [{"name": "Gewicht Kosten (%)", "symbol": "w_cost", "value": 50, "min": 0, "max": 100, "step": 5}, {"name": "Gewicht Zeit (%)", "symbol": "w_time", "value": 20, "min": 0, "max": 100, "step": 5}, {"name": "Gewicht Umwelt (%)", "symbol": "w_env", "value": 30, "min": 0, "max": 100, "step": 5}, {"name": "Summe Gewichte", "symbol": "total_weight", "formula": "w_cost + w_time + w_env", "unit": "%"}, {"name": "", "symbol": "divider_zug", "value": "——— ZUG ———", "readonly": true}, {"name": "Zugkosten (€)", "symbol": "cost_train", "value": 80, "readonly": true}, {"name": "Zugzeit (min)", "symbol": "time_train", "value": 135, "readonly": true}, {"name": "Zug CO₂ (kg)", "symbol": "env_train", "value": 20, "readonly": true}, {"name": "Zug Score (0–1)", "symbol": "score_train", "formula": "(w_cost * (1 - cost_train / 200) + w_time * (1 - time_train / 300) + w_env * (1 - env_train / 80)) / total_weight", "unit": "Score"}, {"name": "", "symbol": "divider_auto", "value": "——— AUTO ———", "readonly": true}, {"name": "Autokosten (€)", "symbol": "cost_auto", "value": 24, "readonly": true}, {"name": "Autozeit (min)", "symbol": "time_auto", "value": 135, "readonly": true}, {"name": "Auto CO₂ (kg)", "symbol": "env_auto", "value": 80, "readonly": true}, {"name": "Auto Score (0–1)", "symbol": "score_auto", "formula": "(w_cost * (1 - cost_auto / 200) + w_time * (1 - time_auto / 300) + w_env * (1 - env_auto / 80)) / total_weight", "unit": "Score"}, {"name": "", "symbol": "divider_result", "value": "——— ERGEBNIS ———", "readonly": true}, {"name": "Empfehlung", "symbol": "recommendation", "formula": "if(score_train > score_auto, 'Zug besser', if(score_auto > score_train, 'Auto besser', 'Gleichstand'))", "unit": ""}]},
 "buttons-string-actions": {"type": "buttons", "items": [{"label": "Morgens (07:30 Wien → 09:45 Graz)", "action": "Morgens buchen", "style": "primary"}, {"label": "Nachmittags (14:15 Wien → 16:30 Graz)", "action": "Nachmittags buchen"}]}
};
