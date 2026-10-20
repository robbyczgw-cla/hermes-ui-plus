// Demo scenarios: scripted answers replayed locally (no network). Same step format as mock-server/scenarios.mjs.
//  - scenes-core.ts   the "Answers you can act on" showcase (approval, checklist, choices, products, recipe, quiz, …)
//  - replies.ts       follow-ups for taps on those answers (`[kind:id] …` replies, reformat chips)
//  - scenes-more.ts   one scenario per remaining block type
//  - scenes-live.ts   a live card (shopping list) Hermes keeps up to date over two turns
//  - scenes-library.ts the Skills & memory questions (what Hermes remembers, forget, skills, load / use a skill)
//  - prompts.ts       the sample requests (chips, starters) in en/de/es, checked against `pickScenario` by tests
// Everything is offline (no photos, map tiles or web lookups), fictional and written in en/de/es. Pure data – tested in
// demo.test.ts.
import { REPLIES } from './replies.ts';
import { CORE, detectCity, PATHS_ID, SHOPPING_ID, TRIP_CHOICE_ID, TRAVEL_CHOICE_ID } from './scenes-core.ts';
import { MORE } from './scenes-more.ts';
import { LIBRARY_SCENES } from './scenes-library.ts';
import { LIVE_SCENES } from './scenes-live.ts';
import { multi } from './scenes-multi.ts';
import { lastDone } from './scenes-bots.ts';
import type { DemoScenario } from './kit.ts';

export { L, type DemoApproval, type DemoBotRole, type DemoContext, type DemoLang, type DemoScenario, type DemoStep, type DemoTool } from './kit.ts';

export const scenarios: Record<string, DemoScenario> = { ...MORE, ...CORE, ...REPLIES, ...LIVE_SCENES, ...LIBRARY_SCENES, multi, lastDone };

/** `[kind:id]` tags that interactive blocks and chips put in front of the user's reply (ui/components/modules/a/replies.ts) */
const REPLY_TAG = /^\[([a-z]+)(?::([^\]\n]*))?\]/;
const REPLY_KINDS = new Set(['choice', 'checklist', 'calc', 'quiz', 'confirm', 'slot', 'slots', 'poll', 'decision', 'agenda', 'rank', 'scale', 'paths', 'products', 'vocab', 'guide', 'workout', 'studyplan', 'mindmap', 'reaction', 'ask', 'node', 'form', 'reformat']);

/** the scenario a protocol reply continues with (null = not a reply) */
function pickReply(t: string): string | null {
  const m = REPLY_TAG.exec(t);
  if (!m || !REPLY_KINDS.has(m[1])) return null;
  const [, kind, id = ''] = m;
  switch (kind) {
    case 'form':
      return 'formResult';
    case 'reformat':
      return 'reformat';
    case 'choice':
      return id === TRAVEL_CHOICE_ID ? 'reiseDecision' : id === TRIP_CHOICE_ID ? 'trip' : 'interaction';
    case 'checklist':
      return id === SHOPPING_ID ? 'checklistReply' : 'interaction';
    case 'quiz':
      return 'quizResult';
    case 'products':
      return 'productTake';
    case 'paths':
      return id === PATHS_ID ? 'pathsPick' : 'interaction';
    default:
      return 'interaction';
  }
}

/** keyword routes in priority order; every entry covers de, en and es (the sample requests of prompts.ts included) */
const ROUTES: [name: string, re: RegExp][] = [
  // Skills & memory first: a forget request quotes a memory entry, which may contain any other keyword
  ['memoryForget', /\bforget\b|vergiss|olvida|delete this entry|l[öo]sche diesen eintrag|borra esta entrada/],
  // typos too ("remmeber", "rember", "weisst", "recuedas"): the question a user types into the demo first
  ['memoryWhat', /\b(?:re?m+e*m*b\w*|know)\b.{0,12}\babout me\b|über mich (?:gemerkt|gespeichert)|(?:wei(?:ß|ss|s)t|gemerkt|merkst) du.{0,15}über mich|\brec(?:u?e|o)r?d\w*\s+(?:de|sobre)\s+m[ií](?![a-z])|\bsabes\s+(?:ya\s+)?(?:de|sobre)\s+m[ií](?![a-z])/],
  ['skillDoc', /load the skill|lade den skill|carga el skill/],
  // a starter of Hermes' own Bot Chat (bots/BotEmptyState): nothing done yet in the demo
  ['lastDone', /zuletzt.{0,25}erledigt|what did you last do|last (?:thing )?you did|hiciste por m[ií] la [uú]ltima|[uú]ltima vez.{0,20}hiciste/],
  ['skillUse', /use the skill|nutze den skill|usa el skill/],
  ['skillsList', /which skills|welche skills|qu[eé] skills|your skills|deine skills|tus skills/],
  // the live list before the plain shopping list ("Einkaufsliste")
  ['liveAdd', /grillkohle|charcoal|\bcarb[oó]n\b/],
  ['liveList', /grill|barbecue|\bbbq\b|barbacoa/],
  ['error', /fehler|error|crash/],
  ['approval', /freigabe|approval|genehmig|aprobaci[oó]n/],
  ['cacheList', /cach[eé]/],
  ['multi', /umzugsfirma|moving company|empresa de mudanzas/],
  ['schieberegler', /schieberegler/],
  ['gameTable', /ps2|spieletabelle|game table/],
  ['longWords', /oled|lcd/],
  ['checklist', /einkauf|checkliste|checklist|packliste|packing list|shopping|lista de la compra|lista de compras/],
  ['choice', /city break|st[aä]dtetrip|escapada|reiseziel|wochenendtrip|w[aä]hle ein|help me pick/],
  ['reiseChoice', /train or plane|plane or train|bahn oder flug|flug oder bahn|flugzeug oder bahn|bahn oder flugzeug|tren o avi[oó]n|avi[oó]n o tren/],
  ['paths', /\bpfade\b|\bpaths\b|back ?up|sichern|sicherung|copia de/],
  ['blocks', /architektur|architecture|arquitectura|\bblocks\b|bausteine|building blocks/],
  ['mindmap', /mind ?map|mapa mental/],
  ['coding', /\bdiff\b|\bcode\b|\bcoding\b|c[oó]digo|programmier|programar|bugfix|\bgit\b|\bterminal\b/],
  ['poll', /abstimm|umfrage|pizza oder paella|\bpoll\b|encuesta|votaci/],
  ['translation', /übersetz|auf spanisch|ins spanische|translate|traduc/],
  ['charts3', /strompreis|electricity price|precio de la luz/],
  ['agenda', /tagesplan|plan .*samstag|samstag planen|plan .*saturday|saturday plan|plan .*s[aá]bado|plan del s[aá]bado/],
  ['webSuche', /jetlag|jet lag/],
  ['products', /kopfh[öo]rer|headphones|auriculares/],
  ['recipe', /carbonara|recipe|rezept|receta|kochen|koch mit|\bcook|cocina|spaghetti|pasta/],
  ['flashcards', /flashcard|karteikarte|tarjetas/],
  ['quiz', /quiz|teste mich/],
  ['explain', /w[äa]rmepumpe|heat pump|bomba de calor/],
  ['calc', /zinseszins|sparplan|zinsrechner|\bcalc\b|compound interest|savings plan|inter[eé]s compuesto/],
  ['loan', /kredit|darlehen|\bloan|pr[eé]stamo/],
  ['calculator', /rechner|calculator|calculadora/],
  ['mixed', /gemischt|mixed|bericht|report|informe/],
  ['places', /restaurant|essen gehen|lokale|orte in der nähe|\bplaces\b|nearby/],
  ['werkzeuge', /projektstand|stand des projekts|project status|estado del proyecto|\bstatus\b|werkzeug|nerd/],
  ['tour', /was kannst du|what can you (do|show)|qu[eé] (sabes|puedes)|\btour\b|^(hi|hello|hey|hallo|hola)\b/],
  ['connect', /connect|verbind|conect/],
  ['needsNet', /\bmap\b|karte|\bmapa\b|spaziergang|\broute\b|bilder|\bbild\b|fotos?\b|photos?\b|images?|galerie|imagen|im[aá]genes/],
  ['long', /\blang\b|lange|\blong\b|largo/],
  ['chart', /chart|diagramm|verlauf|gr[aá]fico/],
  ['wideTable', /breite tabelle|wide table|tabla ancha/],
  ['weather', /wetter|weather|tiempo|clima/],
  ['table', /tabelle|table|tabla/],
  ['stats', /kennzahl|stats|kpi|estad[ií]stic/],
  ['compare', /vergleich|compare|compar/],
  ['form', /formular|\bform\b|formulario/],
  ['steps', /schritt|steps|anleitung|instruction|pasos/],
  ['timeline', /timeline|zeitleiste|ablauf|cronolog/],
  ['buttons', /button|vorschl|suggest|botones/],
  ['tools2', /tools|parallel|recherch|research/],
  ['tool', /tool|\buhr|zeit|datum|spät|\btime\b|clock|\bhora\b|fecha/],
];

/** Pick a scenario from the user's message: protocol replies first, then the keyword routes, else `plain`. */
export function pickScenario(userText: string): { name: string; scenario: DemoScenario } {
  const t = userText.trim().toLowerCase();
  let name = pickReply(t) ?? 'plain';
  if (name === 'plain') {
    // a weekend/city-break request that names a city (or asks for a plan) is the trip plan, before any other keyword
    if (detectCity(t) && /weekend|wochenende|fin de semana|trip|reise|viaje|escapada/.test(t)) name = 'trip';
    else {
      const route = ROUTES.find(([, re]) => re.test(t));
      if (route) name = route[0] === 'schieberegler' ? 'kreditCalc' : route[0];
      else if (/(plan|plane|plan[ée]ame|planea).*(weekend|wochenende|fin de semana)/.test(t)) name = 'trip';
    }
  }
  return { name, scenario: scenarios[name] };
}
