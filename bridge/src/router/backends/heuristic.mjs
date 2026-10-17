// Deterministic keyword/regex router (German, English, Spanish; French / Italian / Portuguese for shopping lists,
// products, places, weather and timers). Zero latency, no network.
// Used as fallback when the decision model times out or errors, and as a baseline in the eval.
// Philosophy: explicit format requests are reliable; implicit cues get moderate confidence;
// everything else is text with low confidence (=> no hint is injected).

import { reformatDecision } from '../reformat.mjs';

export const HEURISTIC_MODEL = 'heuristic-v1';

// Prefix word boundary that understands umlauts (JS \b does not).
const B = '(?<![\\p{L}\\p{N}])';
/** @param {string} src */
// `\b<` = letter-aware prefix boundary, `\b>` = letter-aware suffix boundary (JS \b treats é/ü as non-word).
const A = '(?![\\p{L}\\p{N}])';
const re = (src) => new RegExp(src.replaceAll('\\b<', B).replaceAll('\\b>', A), 'iu');

// Language names (DE/EN/ES) for translation cues.
const LANGS = ['spanisch', 'englisch', 'französisch', 'italienisch', 'portugiesisch', 'japanisch', 'chinesisch', 'koreanisch', 'türkisch', 'russisch', 'niederländisch', 'polnisch', 'griechisch', 'arabisch', 'schwedisch', 'deutsch', 'latein']
  .map((l) => `${l}\\p{L}*`)
  .concat(['spanish', 'english', 'french', 'italian', 'portuguese', 'japanese', 'chinese', 'korean', 'turkish', 'russian', 'dutch', 'polish', 'greek', 'arabic', 'swedish', 'german', 'latin',
    'español', 'espanol', 'alemán', 'aleman', 'inglés', 'ingles', 'francés', 'frances', 'italiano', 'portugués', 'portugues', 'japonés', 'japones', 'chino', 'coreano', 'ruso', 'catalán', 'catalan', 'latín', 'griego', 'árabe', 'turco', 'holandés', 'neerlandés', 'polaco', 'sueco'])
  .join('|');

// --- negations / guards -------------------------------------------------------------------
const NEGATED_VISUAL = re(String.raw`\b<(ohne|keine?n?|nicht als|kein|no|without|not as an?|not in an?|don't|do not)\s+(\p{L}+\s+){0,2}(tabelle|diagramm|chart|table|grafik|graph|karte|map|bilder?|visual|visuali|ui|widget|formular|form)`);
const PRESENTATION_REQUEST = re(String.raw`\b<(als|as an?|as|in (einer|einem|a|an)|im|zeig|show|visualisier|visualiz)\s*(\p{L}+[-\s]){0,2}\p{L}*(diagramm|tabelle|chart|table|grafik|graph|flowchart|karte|map|timeline|zeitstrahl)`);
const CODE = re([
  '```',
  String.raw`\b<(python|javascript|typescript|java|rust|golang|c\+\+|c#|bash|shell|powershell|sql|regex|html|css|react|node\.?js|kotlin|swift|php|ruby|matplotlib|pandas|numpy|docker-?compose|dockerfile|yaml|json)\b.{0,60}\b<(code|funktion|function|script|skript|schreib|write|fix|debug|error|fehler|bug|query|abfrage|class|klasse|methode|method|snippet|programm|program)`,
  String.raw`\b<(code|funktion|function|script|skript|klasse|class|methode|method|query|abfrage|regex|snippet|unit ?tests?)\b.{0,40}\b<(schreib|write|fix|debug|refactor|review|optimier|erklär|explain|implement)`,
  String.raw`\b<(schreib|write|fix|debug|refactor|review|optimier|implementier|implement)\p{L}*\b.{0,40}\b<(code|funktion|function|script|skript|klasse|class|methode|method|query|abfrage|regex|bug|unit ?tests?|endpoint|api)`,
  String.raw`traceback|stack ?trace|exception|segfault|compile error|syntax ?error|typeerror|nullpointer|undefined is not|exit code|npm err|cannot find module|merge conflict|\bgit\b`,
].join('|'));
const CHITCHAT = re(String.raw`^\s*(hi|hallo|hey|moin|servus|grüß gott|guten (morgen|tag|abend)|good (morning|evening|night)|danke|vielen dank|thanks|thank you|thx|ok(ay)?|super|cool|nice|perfekt|top|wie geht'?s|wie geht es dir|how are you|what'?s up|tschüss|ciao|bye|gute nacht|haha|lol|ja|nein|yes|no|genau)\b`);
const EMOTIONAL = re([
  String.raw`\b<(ich (bin|fühle mich|fühl mich)|mir geht'?s|i'?m|i am|i feel|feeling)\b.{0,30}(traurig|einsam|gestresst|überfordert|deprimiert|ängstlich|wütend|erschöpft|ausgebrannt|verzweifelt|unglücklich|sad|lonely|stressed|depressed|anxious|overwhelmed|angry|burnt? out|hopeless|scared)`,
  String.raw`\b<(trauer|liebeskummer|heartbreak|gestorben|verstorben|died|passed away|panikattacke|panic attack|trennung|breakup|broke up|schluss gemacht|selbstzweifel|mobbing|bullied)`,
  String.raw`\b<(ich habe angst|i'?m afraid|mach mir sorgen|i'?m worried|kann nicht schlafen|can'?t sleep)`,
].join('|'));
const WRITING = re([
  String.raw`\b<(schreib|verfass|formulier|entwirf|write|draft|compose)\p{L}*\b.{0,40}\b<(e-?mail|mail|brief|nachricht|text|gedicht|poem|essay|aufsatz|bewerbung|anschreiben|rede|speech|toast|post|tweet|lied|song|geschichte|story|absage|kündigung|einladung|invitation|glückwunsch|reply|antwort|caption|bio|haiku|limerick)`,
  String.raw`\b<(übersetz|translate|korrigier|proofread|umformulier|rephrase|paraphras|zusammenfass|fasse .{0,40}zusammen|summari[sz]e|tl;?dr|kürzer|shorter|ausführlicher|more detail)`,
].join('|'));
const ACTION = re(String.raw`\b<(erinner|remind|stell\p{L}* (mir )?(einen |den )?(wecker|alarm)|weck mich|wake me|set (a |an )?(alarm|reminder)|schick|send|sende|lösch|delete|starte? .{0,20}neu|restart|reboot|deploy|merk dir|remember that|ruf .{0,30} an|call |speicher .{0,30}(ab|in)|save .{0,30} to|leg .{0,30} an|kauf .{0,20} ein|bestell\p{L}* (mir|bei))`);
const SHORT_FACT = re(String.raw`^\s*(wer|wie (hoch|alt|lang|groß|viel|viele|weit|spät|schwer|tief)|wann|wo|was (ist|sind|bedeutet|heißt)|welche[rs]? (ist|war)|who|when|where|what('?s| is| are| does)|how (tall|old|long|far|many|much|heavy|deep)|is |ist |gibt es|kann man|can you|kannst du)\b`);
const WHY = re(String.raw`^\s*(warum|wieso|weshalb|why|how come)\b`);
const FOLLOWUP = re(String.raw`^\s*(und|and|what about|wie ist es mit|wie sieht'?s mit|jetzt|now|same|dasselbe|das gleiche|auch|nochmal|noch ?mal|again|bitte|please|mach|make|zeig|show|kannst du (das|es)|can you (make|show|turn|put) (it|that|this)|das|this|that|it)\b`);

const GENERIC_CHART = /^(diagramm|grafisch|graphisch|grafik|visualisier|visuali[sz]e|graph|graphen)/i;
const STRUCTURE = re(String.raw`\b<(architektur|architecture|aufbau|ablauf|prozess|process|struktur|structure|zusammenhang|zusammenhänge|komponenten|components|handshake|protokoll|protocol|workflow|pipeline|hierarchie|hierarchy|funktioniert|works|sendet|sends|client|server)`);


// --- v4 cue vocab (DE / EN / ES) ----------------------------------------------------------------
const PLACE_NOUN_DE_EN_ES = String.raw`(restaurants?|cafés?|cafes?|lokale?|bistros?|kneipen?|bars?|pubs?|biergärten|biergarten|bäckereien|bäckerei|bäcker|metzgerei\p{L}*|apotheken?|tankstellen?|supermärkte?|supermarkt|friseure?|friseur|eisdielen?|imbiss\p{L}*|pizzerien|pizzeria|hotels?|pensionen|fitnessstudios?|werkstätten|werkstatt|zahnärzte?|zahnarzt|hausarzt|italiener|griechen|asiaten|inder|döner|brunch|coffee ?shops?|bakery|bakeries|pharmac(y|ies)|gas stations?|hairdressers?|gyms?|diners?|restaurantes?|cafeterías?|bares?|panader[ií]as?|farmacias?|gasolineras?|peluquer[ií]as?|gimnasios?|tapas|chiringuitos?)`;
const PLACE_CUE_DE_EN_ES = String.raw`(empfiehl\p{L}*|such\p{L}*|find\p{L}*|zeig\p{L}*|gibt es|gibt'?s|kennst du|beste[nrms]?|gute[nrms]?|schöne[nrms]?|günstige[nrms]?|nette[nrms]?|recommend\p{L}*|looking for|any|best|good|cheap|nice|busca\p{L}*|recomienda\p{L}*|recomi[eé]ndame|hay|mejor(es)?|buen[oa]s?)`;
const NEAR_DE_EN_ES = String.raw`(in der nähe|nahe|nearby|near me|close by|close to me|around here|cerca de m[ií]|cerca de aqu[ií]|por aqu[ií]|um die ecke|around the corner|öffnungszeiten|opening hours|horario|noch offen|jetzt geöffnet|jetzt offen|open now|abierto ahora)`;
const PRODUCT_NOUN_DE_EN_ES = String.raw`(kopfhörer|ohrhörer|earbuds|headphones|auriculares|laptops?|notebooks?|portátil(es)?|smartphones?|handys?|m[oó]vil(es)?|fernseher|tv-geräte|televisor(es)?|staubsauger|saugroboter|aspiradora|kaffeemaschinen?|kaffeevollautomat\p{L}*|waschmaschinen?|trockner|spülmaschinen?|monitore?|tablets?|kameras?|cámaras?|drucker|router|rucksäcke?|rucksack|laufschuhe|wanderschuhe|schuhe|matratzen?|e-?bikes?|fahrräder|smartwatch\p{L}*|lautsprecher|soundbars?|speakers?|mikrowellen?|backofen|toaster|mixer|bohrmaschinen?|akkuschrauber|powerbanks?|gaming-?(maus|tastatur|stuhl)|tastaturen?|mäuse|e-?reader|drohnen?|zelte?|schlafsäcke?|handhelds?|retro-?handhelds?|spielkonsolen?|konsolen?|consoles?|controller|gamepads?|vacuums?|washing machines?|dishwashers?|cameras?|keyboards?|monitors?|sneakers|running shoes|mattress(es)?)`;
const NUMW = String.raw`(\d+|einem|einer|zwei|drei|vier|fünf|sechs|acht|zehn|zwölf|one|two|three|four|five|six|eight|ten|twelve|un|una|dos|tres|cuatro|cinco|seis|ocho|doce)`;
const SPAN = String.raw`(wochen?|monate?n?|tage?n?|weeks?|months?|days?|semanas?|meses|d[ií]as?)`;
const DURATION = String.raw`(\d+|einer|einem|zehn|fünf|zwanzig|dreißig|eine halbe|ten|five|twenty|thirty|half an|half|a|an|one|un|una|diez|cinco|veinte|treinta|media|une|une demi-|un quart d['’]|deux|dix|quinze|vingt|trente|uno|due|cinque|dieci|quindici|venti|trenta|mezz['’]|mezza|um|uma|dois|duas|dez|vinte|trinta|meia) ?(min\p{L}*|stunde\p{L}*|std\b>|sek\p{L}*|h\b>|hours?|hrs?|seconds?|horas?|segundos?|minutes?|minutos?|heures?|secondes?|ore|ora|secondi)`;

// --- multilingual additions (en / es, plus fr / it / pt for the high-value classes) ----------------------------
// Kept per language so a reviewer can read each list on its own. Only words that point at a lookup on their own:
// no bare "phone"/"tv" (phone number, TV shows), no Italian "libreria" (code library), no French "enceinte" alone
// (pregnant), no "près de" / "perto de" / "pas loin de" alone (they also mean "nearly 50 %").
const alt = (...xs) => `(${xs.join('|')})`;
const PLACE_NOUN_ML = alt(
  // en
  String.raw`(ramen|sushi|pizza|burger|taco|brunch|breakfast|coffee|thai|indian|chinese|vegan|vegetarian) (places?|spots?|joints?)|places? to eat|takeaways?|take-?outs?|(hardware|grocery|book|bike|shoe|charity|thrift|convenience|liquor|pet|toy|furniture|sports?) (stores?|shops?)|bookshops?|bookstores?|supermarkets?|drugstores?`,
  // es
  String.raw`supermercados?|ferreter[ií]as?|helader[ií]as?|hostales?|hoteles?|churrer[ií]as?|marisquer[ií]as?|(sitios?|lugar(es)?) (para|donde|d[oó]nde) (comer|cenar|almorzar|desayunar|tapear|tomar (algo|copas|tapas|un caf[eé]))`,
  // fr
  String.raw`restos?|pharmacies?|boulangeries?|p[aâ]tisseries?|brasseries?|bistrots?|cr[eê]peries?|supermarch[eé]s?|[eé]piceries?|coiffeurs?|salles? de sport|h[oô]tels?|stations?[- ]service|boucheries?|fromageries?|endroits? (pour|o[uù]) (manger|d[iî]ner|d[eé]jeuner|bruncher|boire)`,
  // it
  String.raw`ristoranti?|trattori[ae]|osteri[ae]|pizzeri[ae]|caff[eè]|panifici?o?|panetteri[ae]|pasticceri[ae]|farmaci[ae]|supermercat[oi]|gelateri[ae]|parrucchier[ei]|palestr[ae]|alberghi|albergo|benzina[io]|enotec(a|he)|posti? (per|dove) (mangiare|cenare|pranzare|bere)`,
  // pt
  String.raw`padarias?|farm[aá]cias?|lanchonetes?|pizzarias?|sorveterias?|botecos?|churrascarias?|barbearias?|pastelarias?|academias?|hot[eé]is|postos? de gasolina|lugar(es)? (pra|para) (comer|jantar|almo[cç]ar|beber|tomar)`,
);
// asking for a recommendation / a lookup (fr / it / pt); adjectives alone ("bon", "buon") only count together with NEAR
const PLACE_ASK_ROM = String.raw`(trouve\p{L}*|cherche\p{L}*|conseill\p{L}*|recommand\p{L}*|indique\p{L}*|trova\p{L}*|cerco|cercami|consiglia\p{L}*|consigli|suggerisci\p{L}*|encontr\p{L}*|procur\p{L}*|recomend\p{L}*|indica\p{L}*|sugere|sugira)`;
const NEAR_ML = alt(
  String.raw`nearest|closest|still open|open (right )?now|in my area|around me`,
  String.raw`(aqu[ií]|por aqu[ií]) cerca|cerca de (casa|mi casa)|m[aá]s cercan[oa]s?|m[aá]s pr[oó]xim[oa]s?|de guardia|abiert[oa]s? (ahora|hoy|todav[ií]a)|por la zona|en mi zona`,
  String.raw`pr[eè]s d['’]ici|pr[eè]s de chez moi|pr[eè]s de moi|dans le coin|pas loin d['’]ici|[aà] proximit[eé]|autour de moi|dans le quartier|(le|la|les) plus proches?|ouverte?s? (maintenant|en ce moment|ce soir|aujourd['’]hui|le dimanche)|de garde`,
  String.raw`qui vicino|qua vicino|vicino a me|vicino (a|al|alla|allo|ai|alle|all['’])|nei dintorni|in zona|qui intorno|pi[uù] vicin[oaie]|apert[oaie] (adesso|ora|stasera|oggi|la domenica)|di turno`,
  String.raw`aqui perto|perto (de mim|daqui|de casa)|por perto|nas redondezas|(na minha|aqui na) regi[aã]o|mais pr[oó]xim[oa]s?|abert[oa]s? (agora|hoje|ainda|no domingo)|de plant[aã]o`,
);
// "where can I eat …": a food place lookup in any of the languages
const WHERE_TO_EAT = String.raw`(where can (i|we) (eat|get food|have (lunch|dinner|breakfast|brunch))|wo (kann|können) (ich|man|wir)\b>.{0,40}\b<(essen|frühstücken|brunchen)|d[oó]nde (puedo|podemos|se puede) (comer|cenar|desayunar|almorzar|tapear)|o[uù] (manger|d[iî]ner|d[eé]jeuner|bruncher)|o[uù] (est-ce qu['’]on peut|est-ce que je peux|puis-je|peut-on) (manger|d[iî]ner|d[eé]jeuner|bruncher)|dove (posso|possiamo|si pu[oò]) (mangiare|cenare|pranzare|fare colazione)|onde (eu )?(posso|podemos|d[aá] pra) (comer|jantar|almo[cç]ar|tomar caf[eé]))`;
// "where can I get … around here" (getting / buying something; "where can I find the settings" is not a place)
const WHERE_CAN_I = String.raw`(where (can|do) (i|we) (get|buy|grab)|where to (get|buy|grab)|d[oó]nde (puedo |se puede )?(comprar|conseguir|tomar)|d[oó]nde (hay|venden)|o[uù] (puis-je |est-ce que je peux |peut-on )?(acheter|trouver|boire)|dove (posso |si pu[oò] )?(comprare|trovare|bere)|dove (trovo|compro)|onde (eu )?(posso )?(comprar|encontrar|tomar)|onde (tem|h[aá]|encontro|compro))`;
const PRODUCT_NOUN_ML = alt(
  String.raw`espresso machines?|coffee (machines?|makers?)|air ?fryers?|e-?scooters?|smart ?watch(es)?|earphones|headsets?`,
  String.raw`freidoras?( de aire)?|cafeteras?|lavadoras?|lavavajillas|robots? aspiradores?|patinetes?( el[eé]ctricos?)?|colch[oó]n(es)?|zapatillas|altavoz|altavoces|relojes inteligentes`,
  String.raw`[eé]couteurs|casques? (audio|bluetooth|sans fil|[aà] r[eé]duction de bruit)|aspirateurs?( robots?)?|ordinateurs? portables?|ordis? portables?|pc portables?|machines? [aà] caf[eé]|cafeti[eè]res?|lave-linge|lave-vaisselle|t[eé]l[eé]viseurs?|trottinettes?( [eé]lectriques?)?|matelas|chaussures de (running|course|rando)|montres? connect[eé]es?|enceintes? (bluetooth|connect[eé]es?|portables?|sans fil)|imprimantes?|friteuses?( sans huile)?|tablettes? tactiles?|appareils? photo`,
  String.raw`cuffie|auricolari|aspirapolvere|portatil[ei]|cellular[ei]|telefonin[oi]|macchin(a|e|etta|ette) (del|da|per il) caff[eè]|lavatric[ei]|lavastoviglie|televisor[ei]|monopattin[oi]( elettric[oi])?|materass[oi]|scarpe da (corsa|running|trekking)|friggitric[ei]( ad aria)?|stampant[ei]|fotocamer[ae]|casse (bluetooth|wireless)`,
  String.raw`fones?( de ouvido)?|aspirador(es)?( rob[oô])?|rob[oô] aspirador|port[aá]teis|celular(es)?|telem[oó]ve(l|is)|cafeteiras?|m[aá]quinas? de (caf[eé]|lavar)|lava-lou[cç]as|televis(ão|ões|or(es)?)|smart ?tvs?|colch(ão|ões)|t[eê]nis de corrida|rel[oó]gios? inteligentes?|fritadeiras?|impressoras?|caixas? de som`,
);
const PLACE_NOUN = `(${PLACE_NOUN_DE_EN_ES}|${PLACE_NOUN_ML})`;
const PLACE_CUE = PLACE_CUE_DE_EN_ES;
const NEAR = `(${NEAR_DE_EN_ES}|${NEAR_ML})`;
const PRODUCT_NOUN = `(${PRODUCT_NOUN_DE_EN_ES}|${PRODUCT_NOUN_ML})`;
// price ceilings: "unter 200 €", "under $300", "por menos de 100 €", "à moins de 100 €", "sotto i 300 euro", "até 300 reais"
const PRICE_PREP = String.raw`(unter|bis|für|under|below|up to|for under|por menos de|hasta|[aà] moins de|moins de|pour moins de|jusqu['’][aà]|sous les|sotto( i)?|sui|intorno ai|fino a|entro|massimo|at[eé]|abaixo de|menos de|por at[eé])`;
const MONEY = String.raw`(\d[\d.,]* ?(€|eur\b>|euros?|dollars?|\$|usd|£|pounds?|quid|reais|r\$)|(€|\$|£|r\$) ?\d)`;
// "which X should I buy" in fr / it / pt / es: after the product noun
const WHICH = String.raw`(welche[rsnm]?|which|qu[eé]|cu[aá]l(es)?|quel(le)?s?|lequel|laquelle|quale|quali|che|qual|quais)`;
const BUY_AFTER = String.raw`(soll\p{L}*|should|kaufen|buy|comprar|compro|me compro|nehmen|take|empfiehl\p{L}*|recommend\p{L}*|recomiend\p{L}*|budget|lohnt\p{L}*|worth|elegir|merece la pena|vale la pena|achet(er|e)|prendre|choisir|conseill\p{L}*|vaut (le coup|la peine)|comprare|compro|prendo|prendere|scegliere|consigli\p{L}*|conviene|levar|escolher|recomend\p{L}*|vale a pena|compensa|${PRICE_PREP} \d)`;
const NEED_BEFORE = String.raw`(such\p{L}*|brauche|need|looking for|busco|necesito|empfiehl\p{L}*|recommend\p{L}*|recomienda\p{L}*|kauf\p{L}*|buy|comprar|compro|cherche|il me faut|j['’]ai besoin d['’]une?|conseill\p{L}*|recommand\p{L}*|cerco|mi serve|ho bisogno di|consigliami|procuro|preciso de|recomenda\p{L}*|indica\p{L}*)`;

// The user asks the assistant to question them first -> form, not the module itself.
const ASKS_FIRST = re(String.raw`\b<(stell\p{L}* mir .{0,25}fragen|frag mich|fragst du mich|ask me .{0,25}questions|ask me first|preg[uú]ntame|hazme (unas |algunas )?preguntas|pose-moi .{0,20}questions|fammi (delle |qualche )?domande|me (faz|fa[cç]a) (algumas )?perguntas)`);
const notAskingFirst = (t) => ASKS_FIRST.test(t);
// Writing a review / description ABOUT a place or product is text, not a lookup.
const WRITE_FIRST = re(String.raw`^\s*(bitte\s+)?(schreib|verfass|formulier|entwirf|write|draft|compose|escribe|redacta|[eé]cri[st]|[eé]crire|r[eé]dige|scrivi|scrivere|escrev[ae]|escrever)\p{L}*\b>`);
// programming "events" (DOM, event sourcing, webhooks …) are not things to go to
const TECH_EVENTS = /\b(javascript|typescript|dom|api|listener|handler|event[- ]?(sourcing|loop|bus|driven|emitter)|webhook|kafka|react|node|python|java|kotlin|swift|callback|trigger)\b/i;
const notAskingOrWriting = (t) => ASKS_FIRST.test(t) || WRITE_FIRST.test(t);
// "Necesito el número de móvil de Ana" asks for a contact, not a device
const PHONE_NUMBER = re(String.raw`\b<(n[uú]mero|num[eé]ro|number|nummer)\b>.{0,20}\b<(m[oó]vil|celular|tel[eé]fon\p{L}*|phone|handy|cellulare|telem[oó]vel)|\b<(m[oó]vil|celular|phone|cell)\s*(number|nummer)`);
const notProductLookup = (t) => notAskingOrWriting(t) || PHONE_NUMBER.test(t);

// --- product comparison (compare cue + concrete buyable products → products with component "compare") --------------
// Precision over recall: only product lines that name a device on their own ("iPhone 17", "Odin 2 mini", "Steam Deck")
// or a maker followed by a model token ("Sony XM6", "Bose QC", "BMW i4"). Concepts, plans and services ("Kubernetes vs
// Nomad", "Miete vs Kauf", "Apple Music vs Spotify") match neither and stay compare.
const PRODUCT_LINE = String.raw`(iphone|ipad|macbook|imac|mac mini|mac studio|airpods|apple watch|pixel \d+|pixel (pro|fold|buds|watch)|galaxy (s|z|a|tab|watch|buds)\s?\d*|xperia|oneplus|redmi|fairphone|thinkpad|ideapad|zenbook|vivobook|surface (pro|laptop|go|book)|kindle|kobo|tolino|playstation|ps[345]|xbox|nintendo|switch (\d|oled|lite)|steam deck|rog ally|legion go|ayaneo|trimui|anbernic|miyoo|retroid|powkiddy|odin \d|rg ?\d{2,3}\p{L}*|rg (rotate|cube|arc|nano|ds)|game ?boy|gopro|garmin|fitbit|roborock|dyson|thermomix|nespresso|tesla model|model [3ysx]\b>|vw id\.?\s?\d|wh-1000\p{L}*\d*|quietcomfort)`;
const PRODUCT_MAKER = String.raw`(apple|google|samsung|sony|bose|sennheiser|beyerdynamic|jbl|lg|lenovo|dell|hp|asus|acer|msi|razer|logitech|canon|nikon|fujifilm|panasonic|philips|bosch|siemens|miele|xiaomi|huawei|honor|oppo|anker|ecovacs|dji|nothing phone|vw|volkswagen|bmw|audi|mercedes|toyota|skoda|hyundai|kia|volvo|porsche|ford|renault|tesla)`;
// a model token right after the maker: has a digit ("XM6", "i4", "S25") or is a typical model word ("QC", "Ultra")
const MODEL_TOKEN = String.raw`([\p{L}-]*\d[\p{L}\p{N}-]*|qc|ultra|pro|max|mini|air|plus|lite|ultralight)`;
const PRODUCT_ITEM_SRC = String.raw`(\b<${PRODUCT_LINE}\b>|\b<${PRODUCT_MAKER}\s+${MODEL_TOKEN}\b>)`;
const PRODUCT_ITEM = re(PRODUCT_ITEM_SRC);
const COMPARE_CUE = re(String.raw`\b<(vergleich\p{L}*|gegenüberstell\p{L}*|vs\.?|versus|unterschied(e)? zwischen|difference(s)? between|compare|comparison|comparar|comparativa|comp[aá]r(a|ame|alos|alas)|comparaci[oó]n|comparer|comparez|comparatif|comparaison|confronta(re|mi)?|confronto|paragona(re|mi)?|comparação|comparativo)\b>`);
const PRODUCT_CATEGORY = re(String.raw`\b<${PRODUCT_NOUN}(n|s|en)?\b>`);
const SHOPPING_CUE = re(String.raw`\b<(preis\p{L}*|prices?|precios?|prix|prezz[oi]|pre[cç]os?|kosten|kaufen|buy|comprar|acheter|comprare|angebot\p{L}*|deals?|offerte?)\b>|${MONEY}`);
const EITHER_OR = re(String.raw`\b<(oder|or|o|ou)\b>`);

/** Does a comparison message name concrete buyable products (devices, gadgets, appliances, cars)? */
export function looksLikeProductComparison(text) {
  const t = String(text ?? '');
  if (!(COMPARE_CUE.test(t) || EITHER_OR.test(t)) || CODE.test(t)) return false;
  // named models, or a product category together with a shopping cue ("4 Staubsauger mit Preisen")
  return PRODUCT_ITEM.test(t) || (PRODUCT_CATEGORY.test(t) && SHOPPING_CUE.test(t));
}

// --- explicit format requests (ordered by priority) ------------------------------------------
/** @typedef {{format: string, re: RegExp, conf: number, component?: (m: string) => string|undefined, why: string, unless?: (t: string) => boolean}} Rule */

const diagramComponent = (t) =>
  /sequenz|sequence|handshake|client.{1,60}server|anfrage.{1,40}antwort/i.test(t) ? 'sequence'
  : /architektur|architecture|netzwerk|network|infrastruktur|infrastructure|aufbau|komponenten/i.test(t) ? 'architecture'
  : /organigramm|org(anization(al)?)?[ -]?chart|hierarchie|hierarchy/i.test(t) ? 'org'
  : /zustand|state/i.test(t) ? 'state'
  : /entscheidungsbaum|decision tree|stammbaum|family tree|baum|tree/i.test(t) ? 'tree'
  : /kreislauf|zyklus|cycle|lifecycle|lebenszyklus/i.test(t) ? 'cycle'
  : 'flowchart';
const chartComponent = (t) =>
  /radar|netz ?diagramm|spinnen ?netz|spider|spinnendiagramm|gr[aá]fico de ara[ñn]a|diagrama de radar/i.test(t) ? 'radar'
  : /tacho|gauge|speedometer|tachometer|zeigerdiagramm|veloc[ií]metro|medidor/i.test(t) ? 'gauge'
  : /heat ?map|wärmekarte|aktivitätskalender|contribution graph|mapa de calor/i.test(t) ? 'heatmap'
  : /wasserfall|waterfall|brückendiagramm|cascada/i.test(t) ? 'waterfall'
  : /gestapelt|stapel|stacked|apilad/i.test(t) ? 'stacked'
  : /streu|scatter|korrelation|correlation|punktdiagramm|punktwolke|dispersi[oó]n/i.test(t) ? 'scatter'
  : /horizontal|ranking|rangliste|liegende balken|hbar|clasificaci[oó]n/i.test(t) ? 'hbar'
  : /balken|säulen|bar|column|histogramm|histogram|barras/i.test(t) ? 'bar'
  : /donut|doughnut|ring/i.test(t) ? 'donut'
  : /kreis|torte|pie|anteil|verteilung|zusammensetzung|aufteilung|share|breakdown|proportion|prozentual|mix|circular/i.test(t) ? 'pie'
  : /fläche|area/i.test(t) ? 'area'
  : /linie|line|kurve|verlauf|entwicklung|trend|over time|seit|since|über die|jahre|years|monat|month|woche|week|l[ií]nea/i.test(t) ? 'line'
  : undefined;
const mapComponent = (t) => (/route|roadtrip|road trip|reise|itinerar|weg |wegbeschreibung|directions|von .{1,40} nach|from .{1,40} to/i.test(t) ? 'route' : 'markers');
const checklistComponent = (t) =>
  /pack|koffer|reisegepäck|mitnehmen|einpacken|camping|campen|zelten|urlaub|luggage|suitcase|maleta|acampada|valise|valigia|\bmala\b/i.test(t) ? 'packing'
  : /einkauf|zutat|supermarkt|shopping|grocery|groceries|besorg|kaufen|einkaufen|compra|courses|commissions|spesa|mercado|s[uú]per/i.test(t) ? 'shopping'
  : /to-?do|aufgaben|erledig|tasks?\b|umzug|steuererklärung|projekt|tareas|pendientes|t[aâ]ches|cose da fare|tarefas/i.test(t) ? 'todo'
  : undefined;
const quizComponent = (t) => (/karteikarte|flashcard|lernkarte|vokabel|vocab/i.test(t) ? 'flashcards' : 'quiz');
const choiceComponent = (t) => (/termin|uhrzeit|zeiten|zeitfenster|slots?\b|meeting|telefonat|appointment/i.test(t) ? 'slots' : undefined);
const calcComponent = (t) =>
  /kredit|darlehen|hypothek|baufinanzierung|mortgage|loan|tilgung|rate|annuität/i.test(t) ? 'loan'
  : /spar|zinseszins|compound|rendite|etf|savings|invest/i.test(t) ? 'savings'
  : /bmi/i.test(t) ? 'bmi'
  : /währung|currency|wechselkurs/i.test(t) ? 'currency'
  : /kalorien|calorie/i.test(t) ? 'calories'
  : /trinkgeld|tip\b|rechnung (teilen|aufteilen)|bill split|split the bill/i.test(t) ? 'tip'
  : /mehrwertsteuer|mwst|umsatzsteuer|vat\b/i.test(t) ? 'vat'
  : /rabatt|discount/i.test(t) ? 'discount'
  : undefined;
const imageComponent = (t) => (/erstell|generier|mal|zeichne|create|generate|draw|paint|render|design|logo|illustration|wallpaper|icon|comic|skizz|sketch/i.test(t) ? 'generate' : 'photo');
const interactiveComponent = (t) =>
  /spiel|game|play/i.test(t) ? 'game'
  : /streu|scatter|korrelation|correlation|punktdiagramm/i.test(t) ? 'scatter'
  : /3d/i.test(t) ? '3d'
  : /simul|pendel|pendulum|physik|physics|orbit|schwing|planet/i.test(t) ? 'simulation'
  : 'explorer';

/** @type {Rule[]} */
const EXPLICIT = [
  { format: 'calculator', why: 'custom / animated calculator', conf: 0.8, component: calcComponent,
    re: re(String.raw`(rechner|calculator|kalkulator|umrechner|converter)\b.{0,60}\b<(animiert\p{L}*|animation|animated|3d|zeichnung|spiel\p{L}*|bunte?r? grafik|visuell\p{L}*|visualisier\p{L}*)|\b<(animiert\p{L}*|animated|visuell\p{L}*) .{0,40}(rechner|calculator|kalkulator)`) },
  // ---- v3 modules (specific cues first) ----
  { format: 'translation', why: 'translation of a phrase', conf: 0.88,
    unless: (t) => t.length > 220 || (t.match(/\n/g) ?? []).length >= 2,
    re: re(String.raw`\b<(übersetz\p{L}*|translate|traduc\p{L}*|traduz\p{L}*)\b.{0,160}\b<(${LANGS})|\b<(was|wie) (heißt|heisst|bedeutet|lautet|sagt man|sag ich|schreibt man) .{1,80}\b<(auf|in|im) (${LANGS})|\b<wie man .{1,80}\b<(auf|in|im) (${LANGS})|\b<(what does|what'?s|how (do|would) (you|i|we) say|how to say|how do i say|what is the word for) .{1,80}\b<(in|into) (${LANGS})|\b<(what does|how do you say) .{1,60}\b<mean in (${LANGS})|\b<(c[oó]mo se dice|c[oó]mo digo|qu[eé] significa|qu[eé] quiere decir|c[oó]mo se traduce|c[oó]mo se escribe) .{1,80}\b<en (${LANGS})|\b<(übersetz\p{L}*|translate|traduce|traduzca) (mir |me )?(bitte |please |por favor )?["„“'«»‘].{1,150}["“”'»’]`) },
  { format: 'poll', why: 'group vote / poll', conf: 0.86,
    re: re(String.raw`\b<(abstimmung|abstimmen|stimmen? (wir )?ab|stimmt ab|umfrage (unter|für|mit) |poll\b|(mach|erstell|starte?|startet|bau)\p{L}* (mir |uns |bitte )?(eine |ne |kurze )?(kleine )?(umfrage|abstimmung|poll)|(familien|gruppen|team)-?(umfrage|abstimmung)|wir (können|kommen|schaffen) uns .{0,40}nicht einigen|wir sind uns (uneinig|nicht einig)|let'?s (vote|take a vote|do a poll)|(create|make|start|run|set up|build) (me |us )?(a |an )?(quick |small |family |group )?(poll|vote|voting)|poll (for|among|with) |vote (on|for) |we can'?t (agree|decide) |hagamos una (votaci[oó]n|encuesta)|(haz|crea|prepara|hacer) (una |un )?(votaci[oó]n|encuesta|sondeo)|votaci[oó]n (familiar|entre|para)|encuesta (familiar|entre nosotros|para)|no nos ponemos de acuerdo|votemos)`) },
  { format: 'scale', why: 'rating scale question', conf: 0.85,
    re: re(String.raw`\b<((frag|fragt|fragen sie)\p{L}* mich|ask me|preg[uú]ntame|pregunta\p{L}* me)\b.{0,70}\b<(skala|scale|escala|von 1 bis|1 bis \d|1 to \d|del 1 al|bewert\p{L}*|rate|valor\p{L}*|wie (gut|zufrieden|fit|stark|wichtig|müde|gestresst)|how (good|satisfied|tired|stressed|much))|\b<(bewertungsskala|rating scale|escala de valoraci[oó]n|stimmungsabfrage|zufriedenheitsskala|mood (check|scale))|\b<(lass mich|let me|d[eé]jame) .{0,30}(bewerten|rate|valorar|puntuar)|\b<ich (möchte|will|würde gern\p{L}*) .{0,50}bewerten\b.{0,30}\d ?(bis|-|to) ?\d|\d ?(bis|-|to) ?\d+ sterne`) },
  { format: 'rank', why: 'put items into a personal order', conf: 0.82,
    re: re(String.raw`\b<(sortier\p{L}*|ordne\p{L}*|bring\p{L}*|reih\p{L}*|priorisier\p{L}*|rank|order|put|ordena\p{L}*|prioriza\p{L}*|ordenar|clasifica)\b.{0,80}\b<(nach (meiner |meinen |der )?(wichtigkeit|priorität\p{L}*|präferenz\p{L}*|vorliebe\p{L}*|geschmack|beliebtheit)|in (die |meine |eine )?(richtige |meine )?(reihenfolge|rangfolge)|by (my )?(importance|priority|preference|priorities)|in (my |the right )?(order|ranking)|(by|in order of) (what matters|importance)|por (importancia|prioridad|preferencia)|según (mi |mis )?(importancia|prioridad|preferencia)|my priorities|meine prioritäten|mi orden)|\b<(rangfolge|rangliste|ranking) (meiner|der|von meinen|von mir)\b|\b<(prioritäten|priorities|prioridades) (sortieren|ordnen|setzen|festlegen|ranken|ordenar)`) },
  { format: 'rank', why: 'prioritise my items', conf: 0.74,
    re: re(String.raw`\b<priorisier\p{L}* (mir |bitte )?(meine|die|diese|unsere|mein)\b|\b<prioritize (my|the|these|our)\b`) },
  { format: 'decision', why: 'weighted decision matrix', conf: 0.85,
    re: re(String.raw`\b<(entscheidungsmatrix|entscheidungstabelle|nutzwertanalyse|bewertungsmatrix|scoring[- ]?(model|matrix)|decision[- ]matrix|weighted (decision|score|scoring|comparison|matrix)|matriz de decisi[oó]n|gewichte\p{L}* (entscheidung|bewertung|vergleich|punkte)|(mit|nach) gewichtung|(gewichte|gewichtet)\p{L}* (die |meine |nach )?(kriterien|optionen)|(bewert\p{L}*|vergleich\p{L}*|weigh|rate|score|rank|compare)\p{L}*.{0,100}(am wichtigsten|wichtiger als|matters most|most important|pesa más)|(bewert\p{L}*|vergleich\p{L}*|rate|score|rank|compare) .{0,60}(nach|anhand|by|using|según) (meinen |den |diesen |mehreren |folgenden |these |my |the )?(kriterien|criteria|criterios)|(nach|by) (preis|lage|price|cost|size|größe)[,\w\s]{0,30}(gewicht|wicht|weigh|weight)|(gewicht\p{L}*|weigh\p{L}*) .{0,30}(preis|lage|price|location|criteria))`) },
  { format: 'chart', why: 'explicit scatter plot', conf: 0.85, component: () => 'scatter',
    re: re(String.raw`\b<(streudiagramm|punktdiagramm|punktwolke|scatter ?plot|scatter chart|korrelationsdiagramm|gr[aá]fico de dispersi[oó]n)`) },
  { format: 'chart', why: 'special chart kind requested', conf: 0.88, component: chartComponent,
    re: re(String.raw`\b<(radar ?(chart|diagramm|grafik)?|netz ?diagramm|spinnen ?netz\p{L}*|spider ?(chart|diagram)|tacho\p{L}*|gauge|speedometer|tachometer|heat ?map|wärmekarte|aktivitäts-?heatmap|wasserfall\p{L}*|waterfall|brückendiagramm|gestapelt\p{L}*|stapel(diagramm|balken)|gewinnbrücke|ergebnisbrücke|profit bridge|bridge chart|gestapelte\p{L}* (balken|säulen)|(balken|säulen)\p{L}* gestapelt|stacked (bar|column)s?|horizontale\p{L}* (balken|säulen)|horizontal bars?|ranking-?balken|liegende balken|veloc[ií]metro|mapa de calor)`) },
  // ---- v4 modules ----
  { format: 'mindmap', why: 'mind map / concept overview', conf: 0.9,
    re: re(String.raw`\b<(mind ?-?map\p{L}*|gedankenkarte|gedankenlandkarte|concept map|mapa mental|mapa conceptual|begriffslandkarte|begriffsnetz)`) },
  { format: 'mindmap', why: 'overview of connections', conf: 0.8,
    re: re(String.raw`\b<(übersicht(en)? (der |über die |zu den )?zusammenhänge|zusammenhänge (als |in einer )?(übersicht|überblick|darstellen|zeigen|visualisier\p{L}*)|(zeig|stell|mach|erstell)\p{L}* .{0,30}zusammenhänge|map out the (concepts|connections|relationships)|overview of (the )?(connections|relationships)|mapa de (las )?relaciones|resumen de las relaciones)`) },
  // v5 blocks: an explicit block diagram is the native building-block card (before diagram/chart "…diagramm")
  { format: 'blocks', why: 'explicit block diagram', conf: 0.85,
    re: re(String.raw`\b<(block-?diagramm\p{L}*|block diagrams?|baustein-?diagramm\p{L}*|diagramas? de bloques)\b>`) },
  { format: 'diagram', why: 'explicit diagram type', conf: 0.88, component: diagramComponent,
    re: re(String.raw`(fluss|ablauf|architektur|sequenz|klassen|zustands|entscheidungs|netzwerk|uml-?|aktivitäts|prozess|struktur|komponenten|baum|venn|er-|infrastruktur)-?diagramm|\b<(flowchart|flow chart|flussplan|ablaufplan|organigramm|org(anization(al)?)? ?chart|sequence diagram|architecture diagram|system diagram|network diagram|state (machine|diagram)|entscheidungsbaum|decision tree|stammbaum|family tree|uml|mermaid|venn)`) },
  { format: 'diagram', why: 'draw/visualise a process or structure', conf: 0.75, component: diagramComponent,
    re: re(String.raw`\b<(zeichne|skizzier|visualisier|draw|sketch|visuali[sz]e|diagram)\p{L}*\b.{0,50}\b<(ablauf|prozess|process|architektur|architecture|aufbau|struktur|structure|zusammenhang|zusammenhänge|workflow|pipeline|flow|lebenszyklus|lifecycle|kreislauf|cycle|hierarchie|hierarchy|beziehung|relationship|abhängigkeit|dependenc|infrastruktur|infrastructure|netzwerk|network|setup)`) },
  { format: 'chart', why: 'explicit chart request', conf: 0.88, component: chartComponent,
    re: re(String.raw`(balken|säulen|linien|kreis|torten|flächen|kurven|ring|donut|stab)-?diagramm|diagramm|\b<(chart|graph(?!ql|ic)|graphen|plotte|plot (the|this|it|that|a|an|my|these|those|die|das|den)|grafik(?! ?(karte|design))|grafisch|graphisch|visualisier|visuali[sz]e|kurve|histogramm|histogram|bar chart|line chart|pie chart|als balken|as bars)`) },
  { format: 'table', why: 'explicit table request', conf: 0.9,
    re: re(String.raw`\b<(tabell|(?<!(book|reserve|get) an? )table|tabular|spreadsheet|excel|csv|übersichtstabelle|matrix (mit|of)|spalten|columns)`) },
  { format: 'weather', why: 'weather forecast', conf: 0.86,
    unless: (t) => /(?<![\p{L}\p{N}])(klima\p{L}*|climate|clima\p{L}*|climat\p{L}*|unterschied|difference|diferencia|diff[eé]rence|differenza|diferen[cç]a|warum|wieso|weshalb|why|por ?qu[eé]|pourquoi|perch[eé]|entsteht|entstehen|erklär\p{L}*|explain|expli\p{L}*|spiega\p{L}*|wie funktioniert|how does)/iu.test(t) && !/(?<![\p{L}\p{N}])(morgen|heute|übermorgen|wochenende|tomorrow|today|tonight|ma[ñn]ana|hoy|finde|fin de semana|demain|aujourd['’]hui|ce soir|week-end|domani|oggi|stasera|fine settimana|amanh[aã]|hoje|fim de semana)(?![\p{L}\p{N}])/iu.test(t),
    re: re(String.raw`\b<(wetter(vorhersage|bericht|app|aussichten|lage|prognose)?|weather|forecast|regnet es|wird es regnen|schneit es|gibt es .{0,30}(regen|schnee|gewitter|sonne|frost|nebel|sturm)|is there .{0,20}(rain|snow)|regenschirm|umbrella|will it (rain|snow)|is it (going to )?(rain|snow)|how'?s the weather|wie warm wird|wie kalt wird|how (hot|cold|warm) (is|will)|el tiempo (en|de|para|hoy|mañana|ma[ñn]ana)|qu[eé] tiempo (hace|har[aá])|va a llover|llover[aá]|pron[oó]stico|previsi[oó]n del tiempo|temperatur (morgen|heute|in|am|im)|qu[eé] tiempo (va a hacer|hizo)|c[oó]mo (va a estar|estar[aá]) el tiempo|va a (nevar|hacer (fr[ií]o|calor|viento|sol))|nevar[aá]|har[aá] (fr[ií]o|calor|viento|sol)|paraguas|m[eé]t[eé]o\b>|quel temps (fait-il|fera-t-il|il fait|il fera|va-t-il faire|il va faire)|(il|ça) va (pleuvoir|neiger|faire (chaud|froid|beau))|va-t-il (pleuvoir|neiger)|pleuvra|neigera|il (fait|fera) combien|parapluie|pr[eé]visions? (m[eé]t[eé]o|du temps)|meteo\b>|che tempo (fa|far[aà])|previsioni (del tempo|meteo)|piover[aà]|nevicher[aà]|far[aà] (caldo|freddo|bello|brutto)|ombrello|(piove|nevica)\b>.{0,30}\b<(oggi|domani|stasera|adesso|weekend|fine settimana)|\b<(oggi|domani|stasera)\b>.{0,30}\b<(piove|nevica)|previs[aã]o do tempo|como (vai estar|est[aá]|estar[aá]|vai ficar|fica) o (tempo|clima)|vai (chover|nevar|fazer (frio|calor|sol))|chover[aá]|guarda-chuva|(chove|chovendo)\b>.{0,30}\b<(hoje|amanh[aã]|agora))`) },
  { format: 'map', why: 'explicit map request', conf: 0.88, component: mapComponent,
    re: re(String.raw`\b<((auf|in) (einer|der|die) (land)?karte|on a map|auf der map|landkarte|karte (von|mit|der|aller)|map (of|with|showing)|kartenansicht|map view|reiseroute|routenplan|roadtrip|road trip|wegbeschreibung|directions (to|from))`) },
  { format: 'map', why: 'trip plan / itinerary', conf: 0.78, component: () => 'route',
    re: re(String.raw`\b<(reise ?plan|reiseverlauf|reiseprogramm|itinerar|trip plan|city ?trip plan|(plan|plane|plant|planen|planung|vorschlag|schlag|zeig)\p{L}*\b.{0,50}\b<(\d+|\d+-tages|ein|einen|einem|zwei|drei|vier|fünf|sechs|sieben|a|one|two|three|four|five|wochenend\p{L}*)[- ]?(tag|tage|tagen|tages|tagesroute|wochenende|wochenend\p{L}*|day|days|weekend|nächte|nights)\b.{0,40}\b<(in|nach|durch|auf|an|to|through|entlang|für)\b\s+\p{L}{3,}|(route|radtour|wandertour|rundreise|tagesausflug|city ?trip)\b.{0,50}\b<(durch|nach|entlang|in|von)\b)`) },
  { format: 'places', why: 'local places / opening hours', conf: 0.86, unless: notAskingOrWriting,
    re: re(String.raw`\b<${PLACE_CUE}\b>.{0,50}\b<${PLACE_NOUN}\b>.{0,40}\b<(in|bei|um|nahe|am|an|at|near|around|en|cerca|nearby|hier|here)\b>|\b<${PLACE_NOUN}\b>.{0,40}\b<${NEAR}|\b<${NEAR}\b>.{0,40}\b<${PLACE_NOUN}\b>`) },
  // fr / it / pt: a request verb + a place noun + a location ("Trouve-moi un resto dans le 11e", "Consigliami una trattoria a Bologna")
  { format: 'places', why: 'local places (fr / it / pt)', conf: 0.86, unless: notAskingOrWriting,
    re: re(String.raw`\b<${PLACE_ASK_ROM}\b>.{0,40}\b<${PLACE_NOUN}\b>.{0,40}\b<(à|a|au|aux|dans|en|em|no|na|nos|nas|in|nel|nella|vers|près|perto|vicino)\b>`) },
  { format: 'places', why: 'where to eat', conf: 0.86, unless: notAskingOrWriting,
    re: re(String.raw`\b<${WHERE_TO_EAT}\b>`) },
  { format: 'places', why: 'where to get something nearby', conf: 0.82, unless: notAskingOrWriting,
    re: re(String.raw`\b<${WHERE_CAN_I}\b>.{0,50}\b<${NEAR}`) },
  { format: 'places', why: 'events / what is on (city or date)', conf: 0.86, unless: (t) => notAskingOrWriting(t) || TECH_EVENTS.test(t),
    re: re(String.raw`\b<(events?|veranstaltung\p{L}*|konzert\p{L}*|konzerte|theater\p{L}*|festivals?|ausstellung\p{L}*|partys?|kino ?programm|spielplan|lesung\p{L}*|concerts?|gigs?|shows?|exhibitions?|eventos?|conciertos?|qu[eé] hacer)\b>.{0,50}\b<(heute|morgen|übermorgen|abend|heute abend|am wochenende|wochenende|diese woche|nächste woche|tonight|today|tomorrow|this weekend|weekend|this week|hoy|mañana|este fin de semana|(in|im|bei|near|en) \p{Lu}\p{L}{2,})\b|\b<(was ist|was geht|what'?s on|what is on|what'?s happening|qu[eé] hay)\b>.{0,40}\b<(los|on|happening|que hacer)\b>.{0,40}\b<(in|im|en)\b\s+\p{L}{3,}`) },
  { format: 'places', why: 'opening hours', conf: 0.76, unless: notAskingOrWriting,
    re: re(String.raw`\b<(öffnungszeiten|opening hours|horarios? de apertura|horaires d['’]ouverture|orari(o)? di apertura|hor[aá]rios? de (funcionamento|abertura))`) },
  { format: 'products', why: 'product buying guide / comparison', conf: 0.86, unless: notProductLookup,
    re: re(String.raw`\b<(kaufempfehlung\p{L}*|kaufberatung|kauftipps?|preisvergleich|produktvergleich|vergleich (von |der |zwischen )?(produkten|geräten)|testsieger|buying guide|product comparison|price comparison|guía de compra|comparativa de productos)|\b<(beste[rnms]?|bestes|gute[rnms]?|günstige[rnms]?|best|good|top|cheapest|mejor(es)?|el mejor|la mejor|meilleur(e)?s?|miglior[ei]?|melhor(es)?)\b>.{1,60}\b<${PRICE_PREP} ${MONEY}`) },
  { format: 'products', why: 'product ranking / best on the market', conf: 0.86, unless: notProductLookup,
    re: re(String.raw`\b<(top[- ]?\d{1,2}|beste[rnms]?|bestes|komfortabelste[rnms]?|leichteste[rnms]?|günstigste[rnms]?|best|most comfortable|lightest|mejor(es)?|meilleur(e)?s?|miglior[ei]?|melhor(es)?|ranking|rangliste)\b>.{0,80}\b<${PRODUCT_NOUN}\b>|\b<${PRODUCT_NOUN}\b>.{0,80}\b<(am markt|auf dem markt|on the market|en el mercado|top[- ]?\d{1,2}|ranking|rangliste)\b>`) },
  { format: 'products', why: 'which product to buy', conf: 0.78, unless: notProductLookup,
    re: re(String.raw`\b<${NEED_BEFORE}\b>.{0,50}\b<${PRODUCT_NOUN}\b>|\b<${WHICH}\b>.{0,50}\b<${PRODUCT_NOUN}\b>.{0,60}\b<${BUY_AFTER}|\b<${PRODUCT_NOUN}\b>.{0,50}\b<(kaufen|kauf|buy|comprar|empfehlung|recommendation|recomendaci[oó]n|lohnt sich|worth (it|buying)|testsieger|vale a pena|vale la pena|merece la pena|vaut le coup|compensa|calidad-precio|custo-benef[ií]cio|rapport qualit[eé]-prix|qualit[aà]-prezzo)\b>`) },
  { format: 'workout', why: 'workout / training plan', conf: 0.86, unless: notAskingFirst,
    re: re(String.raw`\b<(trainingsplan|trainingspläne\p{L}*|workouts?|work-out|trainingsprogramm|hiit\b>|fitness ?plan|übungsplan|trainingseinheit|beintraining|brusttraining|rückentraining|bauchtraining|home workout|training plan|exercise (plan|routine)|gym (plan|routine)|(push|pull|leg)[- ]day|plan de entrenamiento|rutina de (ejercicios|entrenamiento|gimnasio)|entrenamiento de fuerza)`) },
  { format: 'studyplan', why: 'learning plan', conf: 0.86, unless: notAskingFirst,
    re: re(String.raw`\b<(lernplan|lernpläne\p{L}*|studienplan|study plan|study schedule|learning plan|plan de estudios?|plan de aprendizaje)|\b<(in|innerhalb von|binnen|within|en|dentro de) ${NUMW} ${SPAN}\b>.{0,60}\b<(lernen|beherrschen|schaffen|vorbereiten|learn|master|prepare|aprender|dominar|preparar)|\b<(lernen|learn|aprender|vorbereit\p{L}*|prepar\p{L}*)\b>.{0,60}\b<(in|within|en) ${NUMW} ${SPAN}\b>|\b<plan\b>.{0,40}\b<(prüfung|klausur|abitur|exam|examen)`) },
  { format: 'vocab', why: 'vocabulary drill', conf: 0.86, unless: notAskingFirst,
    re: re(String.raw`\b<(vokabel\p{L}*|vocab\b>|vocabulary|vocabulario|wortschatz)`) },
  { format: 'timer', why: 'timer / countdown request', conf: 0.88,
    re: re(String.raw`\b<(timer|countdown|eieruhr|küchentimer|kuechentimer|stoppuhr|stopwatch|cronómetro|cronometro|cron[oô]metro|temporizador|cuenta atrás|cuenta regresiva|minuteur|minuterie|compte [aà] rebours|chrono(m[eè]tre)?\b>|conto alla rovescia|contagem regressiva|stell\p{L}* (mir )?(einen |den )?(\d+ ?(min\p{L}*|sek\p{L}*|stunden?|h) ?)?(stoppuhr))`) },
  { format: 'timer', why: 'relative-duration reminder = timer', conf: 0.8,
    re: re(String.raw`\b<(erinner\p{L}*|remind\p{L}*|weck\p{L}*|wake|recuérda\p{L}*|recuerda\p{L}*|avísa\p{L}*|avisa\p{L}*)\b>.{0,12}\b<(mich|me|mir)\b>.{0,12}\b<(in|en|after|nach) ${DURATION}`) },
  // es / fr / it / pt: the pronoun is often glued on ("avísame", "rappelle-moi", "ricordami", "me lembra")
  { format: 'timer', why: 'relative-duration reminder = timer', conf: 0.8,
    re: re(String.raw`\b<(recu[eé]rda\p{L}*|av[ií]sa\p{L}*|rappelle\p{L}*|pr[eé]viens\p{L}*|ricorda\p{L}*|avvisa\p{L}*|lembr[ae]\p{L}*|avise\p{L}*)\b>.{0,20}\b<(en|dentro de|dans|tra|fra|daqui a|em) ${DURATION}`) },
  { format: 'quiz', why: 'quiz / flashcards / learning request', conf: 0.86, component: quizComponent,
    re: re(String.raw`\b<(quiz|quizz|karteikarten|flashcards?|lernkarten|vokabeltrainer|vokabeln?\b.{0,40}(lernen|üben|abfragen|trainieren)|(lern|üb)\p{L}* .{0,40}vokabeln|teste mich|test me|quiz me|prüf mich|quiz mich|abfragen|frag mich (zu|über|die|das|meine) .{0,50}\b<(ab|vokabeln|begriffe|fragen)|frag mich .{0,50}fragen (zu|über))`) },
  { format: 'recipe', why: 'cooking recipe request', conf: 0.86,
    re: re(String.raw`\b<(rezept|recipe|kochanleitung|backanleitung|wie (backe|koche|brate|grille|mache|bereite) ich .{0,60}(zu|auf|für|nach)?|wie (backt|kocht|brät) man|how (do i|to) (bake|cook|make|roast|grill) )`) },
  { format: 'recipe', why: 'cooking recipe request (es)', conf: 0.86,
    unless: (t) => /receta (m[eé]dica|electr[oó]nica)|del m[eé]dico|sin receta/iu.test(t),
    re: re(String.raw`\b<recetas?\b>|\b<c[oó]mo (se )?(cocina|cocino|prepara|preparo|hornea|horneo)\b>`) },
  { format: 'checklist', why: 'shopping / packing / to-do list', conf: 0.88, component: checklistComponent,
    re: re(String.raw`\b<(einkaufs(liste|zettel)|einkaufsliste|shopping list|grocery list|groceries list|packliste|packing list|koffer ?liste|to-?do-?liste|to-?do list|todo list|aufgabenliste|checkliste|checklist|merkliste|(auf|für) (die|eine|meine) (einkaufs)?liste|was (muss|soll|sollte) ich (alles )?(einpacken|mitnehmen|einkaufen|mitbringen)|was (gehört|muss) (alles )?(in|auf) (den koffer|die liste|die packliste)|what (do|should) i (need to )?(pack|bring|buy)|lista de (la )?compras?|lista del (s[uú]per|supermercado|mercado)|lista de tareas|lista de pendientes|qu[eé] (me )?(llevo|meto|tengo que llevar|debo llevar) (en|a) (la )?(maleta|mochila)|listes? (de|des) courses|liste de commissions|listes? de t[aâ]ches|qu['’]est-ce que (je|j['’]) ?(dois )?(mets|mettre|prends|prendre|emporte|emporter) dans (ma|la|mon) (valise|sac)|lista della spesa|lista per la spesa|lista (delle|di) cose da fare|cosa (mi )?(porto|metto|devo portare|devo mettere) in (valigia|zaino)|lista (de|do) (compras|mercado|supermercado)|lista de tarefas|o que (eu )?(levo|coloco|ponho|devo levar) na (mala|mochila))`) },
  { format: 'agenda', why: 'plan a day/week with times', conf: 0.86,
    re: re(String.raw`\b<(tagesplan|tagesablauf|wochenplan|agenda|stundenplan für (heute|morgen)|zeitplan (für|fürs) |schedule for (today|tomorrow|my day|the week)|plane? (mir )?(meinen|mir den|den|meine|die) (tag|morgen|abend|vormittag|nachmittag|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|woche)|plan (out )?my (day|morning|evening|saturday|sunday|monday|week|friday)|organi[sz]\p{L}* (mir )?(meinen|den|my|meine|die) (tag|woche|day|week)|strukturier\p{L}* (meinen|den) tag|time[- ]?block\p{L}*|planific\p{L}* (mi|el|la) (d[ií]a|semana|ma[ñn]ana|tarde)|organiza mi (d[ií]a|semana)|mi agenda|plan(ea|ear)\p{L}* (mi|el) d[ií]a)`) },
  { format: 'timeline', why: 'explicit timeline request', conf: 0.88,
    re: re(String.raw`\b<(zeitstrahl|timeline|zeitleiste|zeittafel|chronolog|meilensteine|milestones|lebenslauf von|biografie|biographie|biography)`) },
  { format: 'guide', why: 'step-by-step guide request', conf: 0.86, unless: notAskingFirst,
    re: re(String.raw`\b<(schritt für schritt|schritt-für-schritt|step[- ]by[- ]step|anleitung|tutorial|walkthrough|how[- ]to\b>|paso a paso|gu[ií]a (para|de)|instrucciones para)`) },
  { format: 'steps', why: 'explicit steps request', conf: 0.88,
    re: re(String.raw`\b<(in welchen schritten|welche schritte|which steps|qué pasos)`) },
  { format: 'calc', why: 'explicit calculator request', conf: 0.88, component: calcComponent,
    re: re(String.raw`(rechner|calculator|kalkulator|umrechner|converter)\b|\b<(berechne|ausrechnen|rechne) .{0,40}(mit reglern|interaktiv|selbst|verschiedene)|\b<(mit|per|via) (schieberegler|reglern?|sliders?) (zum )?(ausprobieren|verstellen|anpassen)|zum (ausprobieren|verstellen) .{0,30}(zahlen|werte|zins|betrag)|(adjust|change|play with) the (numbers|values|rate)|let me adjust`) },
  { format: 'image', why: 'image request', conf: 0.85, component: imageComponent,
    re: re(String.raw`\b<(erstell|generier|mal|male|zeichne|create|generate|draw|paint|render|design)\p{L}*\s+(mir\s+|me\s+|us\s+|uns\s+)?(bitte\s+|please\s+)?(ein(en|e)?\s+|an?\s+|das\s+|the\s+)?(\p{L}+\s+){0,2}(bild|foto|image|picture|illustration|logo|zeichnung|porträt|portrait|wallpaper|hintergrundbild|icon|comic|skizze|sketch|poster|avatar|gemälde|painting)|\b<(bilder|fotos|photos|pictures|images) (von|of|aus|from)|zeig\p{L}* (mir )?(ein |eine |ein paar )?(bild|bilder|foto|fotos)|show me (an? )?(image|photo|picture|images|photos|pictures)|wie sieht .{1,40} aus|what does .{1,40} look like`) },
  { format: 'image', why: 'draw something', conf: 0.75, component: () => 'generate',
    re: re(String.raw`^\s*(bitte\s+)?(zeichne|male|draw|paint)\s+(mir\s+|me\s+)?(ein(en|e)?|an?)\s+\p{L}+`) },
  { format: 'interactive', why: 'interactive widget request', conf: 0.82, component: interactiveComponent,
    re: re(String.raw`\b<(simulation|simulier|simulate|interaktiv|interactive|quiz|quizz|teste mich|test me|abfragen|lass uns .{0,20}spielen|let'?s play|(ein|an?) (kleines |simples |simple |small )?(spiel|game)|zum (ausprobieren|rumspielen|spielen)|rumspielen|herumspielen|play around|experimentier|explorable|playground|3d[- ]?(modell|model|ansicht|view)|schieberegler|slider|regler|verstellbar|adjustable)`) },
  { format: 'form', why: 'form / questionnaire request', conf: 0.82,
    re: re(String.raw`\b<(formular|fragebogen|questionnaire|anmeldeformular|sign[- ]?up form|form (for|to)|frag mich .{0,30}ab|ask me (some |a few )?questions|stell\p{L}* mir .{0,20}fragen|interview me|ask me what you need|frag mich,? was du (brauchst|wissen musst))`) },
  // ways / variants with a verdict (v5 paths) – only clear cues, before compare: "where should the files live: A or B",
  // "Backup-Wege", three-way "Docker vs VM vs bare metal" (a two-way "Docker oder VM" stays compare)
  { format: 'paths', why: 'ways / variants compared with a verdict', conf: 0.8,
    re: re(String.raw`\b<(wo (sollen|sollten|soll|liegen|landen|speichere|lege) .{0,50}\b<(dateien|daten|projekte?|backups?)\b>.{0,80}\b<(oder|vs\.?|versus)\b>|where (should|do|does|will|to) .{0,50}\b<(files|data|projects?|backups?)\b>.{0,80}\b<(or|vs\.?|versus)\b>|d[oó]nde (deber[ií]an?|guardo|guardar|est[aá]n|viven|pongo) .{0,50}\b<(archivos|datos|proyectos?|copias)\b>.{0,80}\b<(o|vs\.?)\b>|(backup|sicherungs|deploy(ment)?|sync|hosting)-?(wege|pfade|routen|varianten)\b>|(backup|deploy(ment)?|sync|hosting) (paths|routes)\b>|(docker|container|vm|virtuelle maschine|virtual machine|bare[- ]metal)\b>.{0,25}\b<(vs\.?|versus|oder|or)\b>.{0,25}\b<(docker|container|vm|virtuelle maschine|virtual machine|bare[- ]metal)\b>.{0,25}\b<(vs\.?|versus|oder|or)\b>.{0,25}\b<((docker|container|vm|virtuelle maschine|virtual machine|bare[- ]metal)|nativ\p{L}*|native))`) },
  // architecture / setup at a glance (v5 blocks) – only clear cues, before compare (and stats' "auf einen Blick"): "Aufbau auf einen
  // Blick", "aus welchen Bausteinen besteht", "unterscheiden sich … im Aufbau" (drawings with arrows stay diagram)
  { format: 'blocks', why: 'architecture / setup at a glance', conf: 0.75,
    re: re(String.raw`\b<(architektur|aufbau|setup|architecture|arquitectura|estructura)\b>.{0,40}\b<(auf einen blick|im überblick|at a glance|de un vistazo)\b>|\b<aus welchen (bausteinen|komponenten|schichten) (besteht|bestehen)\b>|\b<what (building blocks|components|layers) (make up|does .{1,40} consist of|is .{1,40} made of)|\b<de qu[eé] (bloques|componentes|capas) (se compone|consta)|\b<(unterscheid|unterschied)\p{L}*\b>.{0,60}\b<(im|vom|in der|in ihrer|in seiner) (aufbau|architektur)\b>|\b<im (aufbau|architektur)\b>.{0,30}\b<unterscheid\p{L}*|\b<differ\p{L}* in (their |its )?(architecture|setup|structure)\b>|\b<(architectural|architecture) differences?\b>|\b<diferencias? de arquitectura`) },
  // two named products joined by "or" (en / es / fr / it / pt: "AirPods Pro 3 or Galaxy Buds 4", "iPhone 17 o Pixel 11",
  // "la PS5 o la Switch 2"); how-to questions about two devices ("¿Cómo paso fotos del iPhone o iPad al PC?") stay out.
  // Needs a question or a short message. German "oder" is left to the compare rules (holdout h20 "MacBook Air oder
  // ThinkPad X1" is labelled compare).
  { format: 'products', why: 'product comparison (either / or)', conf: 0.84, component: () => 'compare',
    unless: (t) => HOW_TO_ASK.test(t) || /^[\s¿¡]*(c[oó]mo|comment|come|como|wie|warum|why|por ?qu[eé]|pourquoi|perch[eé])\b/iu.test(t) || !(t.includes('?') || t.length < 40),
    re: re(String.raw`${PRODUCT_ITEM_SRC}(\s+[\p{L}\p{N}+-]+){0,2}\s*,?\s+(or|o|ou|vs\.?|versus)\s+((the|la|le|el|il|lo|o|a|der|die|das|den)\s+|l['’])?${PRODUCT_ITEM_SRC}`) },
  { format: 'compare', why: 'comparison request', conf: 0.78,
    re: re(String.raw`\b<(vergleich|vergleiche|gegenüberstell|vs\.?\b|versus|unterschied(e)? zwischen|difference(s)? between|compare|comparison|comp[aá]r(a|ame|alos|alas)\b>|comparar\b>|comparaci[oó]n|comparativa|ventajas (e|y) (inconvenientes|desventajas)|pros y contras|diferencias? (hay )?entre|qu[eé] (es|ser[ií]a) mejor|cu[aá]l es mejor|comparer|comparez|comparatif|comparaison|avantages et inconv[eé]nients|le pour et le contre|confronta(re|mi)?\b>|metti a confronto|paragona(re|mi)?\b>|pro e contro|vantaggi e svantaggi|compara(r|ção)?\b>|comparativo|pr[oó]s e contras|vantagens e desvantagens|pros?( and | & | und )cons?|vor- und nachteile|vorteile und nachteile|(überlege|entscheide|schwanke) (mich )?zwischen|(choose|choosing|decide|deciding|torn) between|was ist besser|welche[rs]? ist besser|which is better|which (one )?should i (buy|choose|pick|get|take)|was soll ich nehmen|soll ich .{1,40} oder .{1,40}(nehmen|kaufen|wählen|machen|holen)\??$)`) },
  { format: 'choice', why: 'appointment times to pick', conf: 0.75, component: () => 'slots',
    re: re(String.raw`\b<(schlag\p{L}* (mir )?.{0,30}(termin\p{L}*|uhrzeit\p{L}*|zeit\p{L}*|zeitfenster) .{0,30}vor|(mach|gib)\p{L}* mir .{0,25}vorschläge? (für|zu)\p{L}* .{0,20}(termin|zeit\p{L}*|uhrzeit\p{L}*)|vorschläge? (für|zu) (termine?n?|zeiten|uhrzeiten)|propose .{0,20}(times|slots)|suggest .{0,20}(times|slots)|find\p{L}* (mir )?(einen |ein )?(termin|zeitfenster|slot)\b)`) },
  { format: 'choice', why: 'user needs help deciding', conf: 0.8,
    re: re(String.raw`\b<(hilf mir (bei der |beim |zu )?(entscheid|wähl|auswahl)\p{L}*|hilf mir,? (mich )?(zu )?(entscheiden|zu wählen)|(ich )?(kann|könnte|weiß) (mich )?(nicht|nich) (zu )?(entscheiden|wählen)|ich (bin|bleibe) (unentschlossen|unschlüssig)|ich weiß (nicht|nich),? (was|welche[rsnm]?|wohin|wo|ob) ich .{0,40}(soll|sollte|nehmen|wählen|machen|kaufen|schenken)|hin- und hergerissen|help me (decide|choose|pick)|can'?t (decide|choose)|i don'?t know (what|which|where) (to|i should)|entscheide für mich|decide for me|was würdest du (an meiner stelle )?(nehmen|wählen|machen))`) },
  { format: 'stats', why: 'KPI / key figures request', conf: 0.8,
    re: re(String.raw`\b<(kennzahl|kpis?\b|dashboard|eckdaten|auf einen blick|at a glance|key (figures|metrics|numbers|stats|facts)|kerndaten|steckbrief|fact ?sheet|die wichtigsten zahlen|the main numbers|in zahlen\b)`) },
];

// --- implicit cues (only when no explicit request and no text guard) --------------------------
/** @type {Rule[]} */
const IMPLICIT = [
  { format: 'calc', why: 'financing / formula with inputs', conf: 0.68, component: calcComponent,
    re: re(String.raw`\b<(zinseszins|compound interest|kredit|darlehen|hypothek|baufinanzierung|mortgage|loan|tilgung|sparplan|savings plan|monatliche rate|monthly payment|break[- ]even|bmi\b|kalorienbedarf|calorie needs|trinkgeld|tip (for|on)|rechnung (teilen|aufteilen|splitten)|split the bill|mehrwertsteuer (in|auf|von)|rabatt (auf|von)|\d+ ?% rabatt|netto (in )?brutto|brutto (in )?netto)`) },
  { format: 'checklist', why: 'what do I need for X', conf: 0.58, component: checklistComponent,
    re: re(String.raw`\b<(was brauche ich (alles )?(für|zum|zur|um)|was muss ich (alles )?(für|zum|zur) .{0,40}(kaufen|besorgen|haben)|what do i need (for|to)|ausstattung (für|eines|einer))`) },
  { format: 'chart', why: 'budget flow', conf: 0.66, component: () => 'waterfall',
    re: re(String.raw`\b<(wohin (geht|fließt|floss) (mein|das) geld|where does (my|the) money go|von netto bis (übrig|zum rest)|netto (bis|zu) übrig|einnahmen und ausgaben|income and expenses|a dónde va mi dinero|ingresos y gastos)`) },
  { format: 'chart', why: 'one KPI against a target', conf: 0.66, component: () => 'gauge',
    re: re(String.raw`\b<(wie weit bin ich (bei|mit|von) .{0,30}(ziel|plan)|\d+ ?% (meines|von meinem|des) (sparziels|jahresziels|ziels)|fortschritt (zum|beim|bei meinem) .{0,20}ziel|progress (toward|to) (my )?.{0,20}goal|how far (am i|along am i) .{0,30}goal|cu[aá]nto me falta para (mi )?(meta|objetivo))`) },
  { format: 'chart', why: 'activity per day', conf: 0.64, component: () => 'heatmap',
    re: re(String.raw`\b<(aktivität\p{L}* (pro|je|der letzten|über die) (tag|tage|wochen|monate)|activity (per|by|over the last) (day|days|week)|commits (pro|per) tag|trainingstage im überblick|actividad por d[ií]a)`) },
  { format: 'chart', why: 'trend over time', conf: 0.66, component: () => 'line',
    re: re(String.raw`\b<(entwicklung|verlauf|trend|veränderung|wachstum|gestiegen|gesunken|over time|over the (last|past)|seit \d{4}|since \d{4}|von \d{4} bis \d{4}|from \d{4} to \d{4}|zwischen \d{4} und \d{4}|in den letzten \d+ (jahren|monaten)|in the (last|past) \d+ (years|months)|über die (jahre|jahrzehnte|monate)|historisch|kursverlauf|kursentwicklung|price history|preisentwicklung|inflation (der|in den) letzten)`) },
  { format: 'chart', why: 'share of a total', conf: 0.62, component: () => 'pie',
    re: re(String.raw`\b<(anteile?\b|anteil (der|an|von)|zusammensetzung|aufteilung|aufgeteilt|share of|breakdown|proportion|prozentual|strommix|energiemix|marktanteil|market share|wofür .{0,30}(ausgegeben|ausgebe)|where .{0,20}money goes)`) },
  { format: 'table', why: 'ranking / list with attributes', conf: 0.58,
    re: re(String.raw`\b<(top ?\d+|die \d+ (größten|höchsten|reichsten|teuersten|günstigsten|besten|meistverkauften|beliebtesten|längsten)|the \d+ (largest|biggest|tallest|richest|most|best|cheapest|longest)|liste? (alle|aller|der|von) .{0,40} mit|list (of|all) .{0,40} with|übersicht (aller|über alle|der) |fahrplan|abfahrtszeiten|öffnungszeiten (aller|der)|preisliste|price list|nährwerte|nutrition facts|specs|spezifikationen|technische daten)`) },
  { format: 'stats', why: 'status / current figures', conf: 0.58,
    re: re(String.raw`\b<(status (meines|meiner|des|der|von)|auslastung|speicherplatz|disk usage|cpu|wie viele .{0,30} (habe ich|hab ich|hatte ich)|how many .{0,30} (do i have|did i)|meine (ausgaben|nutzung|statistik)|my (usage|spending|stats)|aktuelle[nr]? (kurs|stand|preis)|current (price|rate))`) },
  { format: 'compare', why: 'choice between options', conf: 0.6,
    re: re(String.raw`\b<(welche[snr]? .{1,40} (soll|sollte) ich|which .{1,40} should i|oder lieber|or rather|\p{L}+ oder \p{L}+\s*\?$|\p{L}+ or \p{L}+\s*\?$)`) },
  { format: 'guide', why: 'hands-on how-to', conf: 0.72,
    re: re(String.raw`\b<(wie|how) (kann|muss|soll|do|can|should|would) (ich|man|i|you|one) .{0,60}(wechsel|tausch|ersetz|repar|montier|einbau|aufbau|zusammenbau|anschließ|entkalk|reinig|assemble|replace|change a|fix|repair|mount|unclog|bleed|clean)|\b<wie (wechsle|tausche|ersetze|repariere|montiere|befestige|verlege|tapeziere|entkalke|reinige|schließe) ich|\b<cómo (cambio|reparo|monto|instalo un|limpio|sustituyo)`) },
  { format: 'steps', why: 'technical how-to', conf: 0.64,
    re: re(String.raw`\b<(wie|how) (kann|muss|soll|do|can|should|would) (ich|man|i|you|one) .{0,60}(installier|einricht|konfigurier|aktualisier|updat|install|set ?up|configure|reset|zurücksetz|wechsel|ersetz|anschließ|connect|einbau|flash|migrier|migrate|backup|sicher|beantrag|anmeld|ummeld|kündig|apply for|register|replace|change the|aufbau|zusammenbau|assemble)|\b<wie (installiere|richte|konfiguriere|baue|backe|koche|mache|erstelle|wechsle|tausche|beantrage|kündige|melde) ich`) },
  { format: 'timeline', why: 'history / chronology', conf: 0.6,
    re: re(String.raw`\b<(geschichte (der|des|von)|history of|wann (geschah|passierte|war|wurde)|in welcher reihenfolge|reihenfolge der|zeitlicher ablauf|what happened (in|during)|ereignisse (des|der|im)|events of)`) },
  { format: 'diagram', why: 'structure / flow explanation', conf: 0.55, component: diagramComponent,
    re: re(String.raw`\b<((wie|how) (funktioniert|hängt|läuft|hängen|do|does) .{0,40}(architektur|architecture|aufbau|prozess|process|ablauf|pipeline|workflow|zusammen|kreislauf|lifecycle|lebenszyklus|cycle|pipeline)|stammbaum|family tree|hierarchie|hierarchy|abhängigkeiten|dependencies between|beziehungen zwischen)`) },
  { format: 'map', why: 'geographic question', conf: 0.55, component: mapComponent,
    re: re(String.raw`\b<(wo (liegt|liegen|befindet|befinden)|where (is|are) .{1,30} located|in der nähe|nearby|near me|sehenswürdigkeiten in|attractions in|standorte|locations of|route von .{1,30} nach|route from .{1,30} to|von .{1,30} nach .{1,30} (fahren|reisen|radeln|wandern)|reise durch|trip through|rundreise)`) },
];

// v5 coding views (diff / terminal / changes). Checked before the generic code guard (which sends coding requests to text):
// only clear cues – showing a change, REALLY running a command / the tests, listing the changed files.
const HOW_TO_ASK = re(String.raw`^\s*(how (do|can|should|would) i|how to|wie (kann|muss|soll|würde) ich|wie führe ich|cómo (puedo )?(ejecuto|ejecutar|correr)|what (does|is)|how does|wie funktioniert|was (macht|ist|bedeutet)|erkl[äa]r\p{L}*|explain|qué (hace|es)|cómo funciona)\b>`);
const RUN_VERB = String.raw`(run|rerun|re-run|execute|ejecuta\p{L}*|ejecutar|corre|correr|führ\p{L}*|start(e|en))`;
const RUN_OBJECT = String.raw`(tests?|testsuite|test suite|unit tests?|pruebas|specs?|pytest|jest|vitest|npm|pnpm|yarn|npx|git|make|cargo|go test|pip|docker (ps|compose|build|logs|images)|tsc|eslint|prettier|ruff|lint\p{L}*|builds?|compil\p{L}*|typecheck|type-?check|ls|grep|curl|systemctl|journalctl|kubectl|terraform|ansible)`;
const CODING = [
  { format: 'diff', why: 'show a code change / patch', conf: 0.85,
    unless: (t) => HOW_TO_ASK.test(t) || WRITE_FIRST.test(t),
    re: re(String.raw`\bgit diff\b>|\b<(zeig\p{L}*|show|display|gib|give|muestra\p{L}*|mostrar|erstell\p{L}*|create|generate|generier\p{L}*|mach\p{L}*|make|als|as an?|as|en forma de|como|in form of)\b>.{0,30}\b<(diff|patch|unified diff)(?![\p{L}\p{N}-])|\b<(den|der|das|the|el) (diff|patch)(?![\p{L}\p{N}-])|\b<(was würde sich|what would change|what will change|what changes|qué cambiar[ií]a|qué cambia)\b>.{0,50}\b<(datei|file|archiv\p{L}*|code|config\p{L}*|funktion|function|script|skript|zeile|line)|\b<(vorher[ /-]+nachher|before[ /-]*(and |&)?[ /-]*after|antes y después)\b>.{0,40}\b<(code|config\p{L}*|datei|file|funktion|function|archivo|skript|script)|\b<(code|config\p{L}*|datei|file|funktion|function|archivo)\b>.{0,30}\b<(vorher[ /-]+nachher|before[ /-]*(and |&)?[ /-]*after|antes y después)`) },
  { format: 'terminal', why: 'run a command / show its output', conf: 0.85,
    unless: (t) => HOW_TO_ASK.test(t) || WRITE_FIRST.test(t),
    re: re(String.raw`\b<${RUN_VERB}\b>.{0,25}\b<${RUN_OBJECT}\b>|\b<(die |den |das |the |los |las |el )?${RUN_OBJECT}\b>.{0,25}\b<(aus ?führ\p{L}*|laufen|durchlaufen|ausführen|run|execute)\b>|\b<(ausgabe|output|log|ergebnis(se)?|salida|logs)\b>\s+(von|vom|des|der|of|from|de|del)\s+(dem |den |the |el |la )?\x60?${RUN_OBJECT}\b>|\b<(test|build|lint|ci|npm|git|docker|befehl|command|comando)-?\s?(output|ausgabe|log|logs|salida)\b>|\b<(show|zeig\p{L}*|muestra\p{L}*|gib)\b>.{0,25}\b<(output|ausgabe|log|salida)\b>.{0,20}\b<(of|from|von|vom|de|del)\b>.{0,20}\x60?${RUN_OBJECT}\b>`) },
  { format: 'changes', why: 'files changed in a task', conf: 0.8,
    re: re(String.raw`\b<(welche )?(dateien|files|archivos)\b>.{0,25}\b<(hast du|habt ihr|hat der agent|did you|have you|were|wurden|has the agent|has el agente|cambiaste|has cambiado|modificaste|has modificado)\b>.{0,20}\b<(geändert|verändert|angefasst|bearbeitet|angepasst|change[d]?|touch(ed)?|edit(ed)?|modif(y|ied)|cambiad\p{L}*|modificad\p{L}*)|\b<(which|what) files (did you|have you|were|got)\b>|\b<(geänderte|veränderte|bearbeitete|changed|modified|touched|edited|modificados|cambiados)\s+(dateien|files|archivos)\b>|\b<(list|liste|zeig\p{L}*|show)\b>.{0,25}\b<(changed|modified|geänderten|geänderte|veränderten) (files|dateien)\b>|\b<(archivos|ficheros) (modificados|cambiados|que (cambiaste|modificaste))\b>|\b<qu[eé] (archivos|ficheros) (cambiaste|has cambiado|modificaste|has modificado|tocaste|has tocado)\b>|\b<git status\b>|\b<(zusammenfassung|übersicht|summary|overview|resumen) (der |von |of |de )?(deine[nr] |your |tus )?(änderungen|changes|cambios)\b>`) },
  { format: 'changes', why: 'what did you change (agent task)', conf: 0.6,
    re: re(String.raw`\b<(was hast du (alles |denn |eigentlich )?(geändert|verändert|angepasst)|what (all )?did you (change|modify|touch|edit)|what have you (changed|modified|edited)|qué (has )?(cambiado|cambiaste|modificaste))\b>`) },
];

const HUI_TYPE = /```hui\s*\n\s*\{\s*"type"\s*:\s*"(\w+)"(?:[^`]*?"kind"\s*:\s*"(\w+)")?/;
const HUI_TO_FORMAT = { table: 'table', chart: 'chart', stats: 'stats', compare: 'compare', steps: 'steps', timeline: 'timeline', form: 'form', image: 'image', checklist: 'checklist', recipe: 'recipe', calc: 'calc', map: 'map', weather: 'weather', agenda: 'agenda', places: 'places', products: 'products', guide: 'guide', workout: 'workout', studyplan: 'studyplan', vocab: 'vocab', mindmap: 'mindmap', timer: 'timer', blocks: 'blocks', diff: 'diff', terminal: 'terminal', changes: 'changes' };

/** @param {string} format @param {number} confidence @param {string} reason @param {string} [component] */
function decision(format, confidence, reason, component) {
  /** @type {any} */
  const d = { format, confidence, reason };
  if (component) d.component = component;
  return d;
}

/** @param {Rule[]} rules @param {string} text */
function firstMatch(rules, text) {
  for (const r of rules) {
    const m = r.re.exec(text);
    if (m && !r.unless?.(text)) return { rule: r, match: m[0] };
  }
  return null;
}

/**
 * Classify the latest user turn. Pure and synchronous.
 * @param {{role: string, content: string}[]} turns
 * @returns {{format: string, component?: string, confidence: number, reason: string}}
 */
export function classifyHeuristic(turns) {
  const latest = [...turns].reverse().find((t) => t.role === 'user');
  if (!latest) return decision('text', 0, 'no user message');
  const text = latest.content.trim();
  const prevAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
  const isFollowup = Boolean(prevAssistant) && text.length < 120 && FOLLOWUP.test(text);

  const reformat = reformatDecision(turns);
  if (reformat) return reformat;

  if (/^\[(form|choice|checklist|calc|quiz|slot|confirm|pin|poll|agenda|decision|rank|scale|guide|workout|studyplan|vocab|products|paths):[\w-]+\]|^\[mindmap\]/.test(text)) return decision('text', 0.3, 'machine reply from an app widget');
  if (NEGATED_VISUAL.test(text)) return decision('text', 0.8, 'visual explicitly declined');

  const coding = firstMatch(CODING, text);
  if (coding) return decision(coding.rule.format, isFollowup ? Math.max(coding.rule.conf, 0.85) : coding.rule.conf, `${isFollowup ? 'follow-up: ' : ''}${coding.rule.why}`);

  const explicit = firstMatch(EXPLICIT, text);
  const codey = CODE.test(text);
  if (explicit && !(codey && !PRESENTATION_REQUEST.test(text))) {
    const { rule } = explicit;
    // German "Diagramm"/"grafisch" without a chart kind and without data in sight is usually a
    // structure/flow drawing ("Architektur ... mit Diagramm", TCP handshake "als Diagramm").
    if (rule.format === 'chart' && GENERIC_CHART.test(explicit.match) && !chartComponent(text)) {
      const ctx = `${text}\n${prevAssistant?.content ?? ''}`;
      const numbers = (ctx.match(/\d[\d.,]*/g) ?? []).length;
      if (numbers < 3 && (STRUCTURE.test(ctx) || prevAssistant)) {
        return decision('diagram', 0.7, `${isFollowup ? 'follow-up: ' : ''}diagram of a structure/process (no data)`, diagramComponent(ctx));
      }
    }
    let component = rule.component?.(text);
    // Follow-up "als Diagramm" without a kind: infer chart kind from the previous context.
    if (rule.format === 'chart' && !component && prevAssistant) {
      const prior = HUI_TYPE.exec(prevAssistant.content);
      component = prior?.[2] ?? undefined;
    }
    const conf = isFollowup ? Math.max(rule.conf, 0.85) : rule.conf;
    const pre = isFollowup ? 'follow-up: ' : '';
    // concrete devices side by side: product cards (photos, prices, specs table) instead of generic compare columns
    if (rule.format === 'compare' && looksLikeProductComparison(text)) return decision('products', Math.max(conf, 0.84), `${pre}product comparison`, 'compare');
    if (rule.format === 'products' && !component && COMPARE_CUE.test(text)) component = 'compare';
    return decision(rule.format, conf, `${pre}${rule.why}`, component);
  }

  if (codey) return decision('text', 0.85, 'coding request');
  if (EMOTIONAL.test(text)) return decision('text', 0.85, 'personal/emotional topic');
  if (CHITCHAT.test(text) && text.length < 60) return decision('text', 0.9, 'chit-chat');
  if (WRITING.test(text)) return decision('text', 0.85, 'writing/editing task');
  if (ACTION.test(text)) return decision('text', 0.8, 'agent action');
  if (WHY.test(text)) return decision('text', 0.7, 'why-question (explanation)');

  const implicit = firstMatch(IMPLICIT, text);
  if (implicit) {
    const { rule } = implicit;
    // Short "Wie viele Einwohner hat Berlin?"-style questions stay text even with a cue word,
    // except for cues that are strong on their own.
    const strong = ['calc', 'calculator', 'chart', 'steps', 'timeline', 'checklist', 'map'].includes(rule.format);
    if (!strong && SHORT_FACT.test(text) && text.length < 50) return decision('text', 0.6, 'short factual question');
    if (rule.format === 'compare' && looksLikeProductComparison(text)) return decision('products', 0.7, 'product choice', 'compare');
    return decision(rule.format, rule.conf, rule.why, rule.component?.(text));
  }

  // Follow-up without a format cue ("und für 2023?"): keep the previous native format.
  if (isFollowup && prevAssistant && text.length < 60) {
    const prior = HUI_TYPE.exec(prevAssistant.content);
    const f = prior && HUI_TO_FORMAT[/** @type {keyof typeof HUI_TO_FORMAT} */ (prior[1])];
    if (f) return decision(f, 0.55, 'follow-up keeps previous format', f === 'chart' ? prior[2] : undefined);
  }

  if (SHORT_FACT.test(text)) return decision('text', 0.6, 'short factual question');
  // No rule fired: `fallthrough` tells a heuristic-first router to ask the model instead.
  return { ...decision('text', 0.4, 'no visual cue'), fallthrough: true };
}

/** Backend adapter (same shape as LLM backends). */
export function createHeuristicBackend() {
  return {
    id: 'heuristic',
    model: HEURISTIC_MODEL,
    /** @param {{role: string, content: string}[]} turns */
    async decide(turns) {
      return classifyHeuristic(turns);
    },
  };
}
