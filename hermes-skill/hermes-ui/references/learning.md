# learning: quiz, flashcards, studyplan, vocab, translation

## quiz / flashcards
quiz {id, title?, questions:[{q, options:string[], answer:index|index[] (0-based), explanation?}]}  flashcards {id, title?, cards:[{front, back}]}
Quiz: 3-10 questions + `explanation`; flashcards 5-15. Reply `[quiz:<id>] 4/5 richtig`: praise briefly, offer weak topics.
{"type":"quiz","id":"hauptstaedte","title":"Hauptstädte Europas","questions":[{"q":"Hauptstadt von Portugal?","options":["Porto","Lissabon","Faro"],"answer":1,"explanation":"Lissabon liegt am Tejo."},{"q":"Welche sind Hauptstädte?","options":["Bern","Zürich","Wien"],"answer":[0,2]}]}
{"type":"flashcards","id":"vokabeln","title":"Italienisch: Essen","cards":[{"front":"il pane","back":"das Brot"},{"front":"l'acqua","back":"das Wasser"},{"front":"il formaggio","back":"der Käse"}]}

## studyplan (learning plan; reply `[studyplan:<id>] Woche 1: 9/12 erledigt` via "Fortschritt senden")
{id, title, goal?, weeks:[{label, days:[{label ("Mo", "Tag 3"), tasks:[{id?, text, minutes? (1-1440), kind?:"learn"|"practice"|"review"|"test"}] (<=20)}] (<=14)}] (<=26)}
- Realistic: 2-6 tasks per day, rest days are fine, the last week of an exam plan = review + test. Ask for goal, deadline and daily time first if unknown (`form`). `minutes` honest, small total per day; mix `kind`.
- For 8+ weeks give the first 2-4 weeks fully and say the rest follows after the reply. Keep task ids stable if you send an updated plan.
{"type":"studyplan","id":"spanisch-a2","title":"Spanisch A2 in 4 Wochen","goal":"Alltagsgespräche führen und einfache Texte lesen","weeks":[{"label":"Woche 1: Grundlagen auffrischen","days":[{"label":"Mo","tasks":[{"text":"Präsens regelmäßiger Verben wiederholen","minutes":25,"kind":"review"},{"text":"20 Vokabeln: Essen & Trinken","minutes":15,"kind":"learn"}]},{"label":"Mi","tasks":[{"text":"Bestellen im Restaurant als Dialog üben","minutes":30,"kind":"practice"}]},{"label":"Fr","tasks":[{"text":"Mini-Test Wochenstoff","minutes":20,"kind":"test"}]}]}]}

## vocab (language drill; reply `[vocab:<id>] 18/20 richtig · schwierig: …`)
{id, title?, from, to, mode?:"cards"|"quiz"|"type", items:[{id?, term, translation, example?, note?, romanization?}] (<=40)}
- `from` = language of `term` (code: de en es pt-BR ja), `to` = language of `translation`; the app reads `term` aloud in `from`. 10-25 items of one topic/level, correct articles/gender, `example` a short natural sentence in `from`, `romanization` for non-Latin scripts. Only 5-15 loose cards without a drill: `flashcards`.
- User writes Spanish: labels/text in Spanish. Reaction to the reply: praise, repeat the difficult ones in text or a new `vocab` with only those.
{"type":"vocab","id":"es-essen","title":"Spanisch: Im Restaurant","from":"es","to":"de","mode":"cards","items":[{"term":"la cuenta","translation":"die Rechnung","example":"¿Nos trae la cuenta, por favor?"},{"term":"el camarero","translation":"der Kellner","example":"El camarero es muy amable."},{"term":"la propina","translation":"das Trinkgeld","note":"In Spanien nicht üblich, aber gern gesehen"}]}

## translation (short phrases only; long texts: Markdown)
{id?, source:{lang, text}, targets:[{lang, text, romanization?}] (1-4), note?}  lang = code (de en es pt-BR ja)
{"type":"translation","id":"bahnhof","source":{"lang":"de","text":"Wo ist der nächste Bahnhof?"},"targets":[{"lang":"es","text":"¿Dónde está la estación de tren más cercana?"}],"note":"Mit \"por favor\" davor wird es höflicher."}
{"type":"translation","source":{"lang":"es","text":"Muchas gracias"},"targets":[{"lang":"de","text":"Vielen Dank"},{"lang":"ja","text":"どうもありがとうございます","romanization":"Dōmo arigatō gozaimasu"}]}
User writes Spanish -> answer in Spanish ("¿Cómo se dice … en alemán?"). Long texts, letters, emails: Markdown, no node.
The card IS the translation: don't repeat the translation (or the source phrase) as text before or after it. At most one short intro line without the translated words ("Auf Spanisch:"); usage hints go into `note`.
