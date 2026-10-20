// Live card in the offline demo: a barbecue shopping list Hermes keeps up to date over two turns. Turn 1 makes the
// live checklist (pinned at the top of the chat, progress ring in the tray); turn 2 sends a patch (`livePatch`), which
// the app shows as a change receipt under the answer. The user's own ticks and edits ride along with the next message
// (`ctx.live`, the `[hui:live]` batches) and are kept, like a real Hermes would. Fully offline, en/de/es.
import { chips } from './scenes-core.ts';
import { L, hui, type DemoContext, type DemoScenario, type DemoStep } from './kit.ts';

export const LIVE_LIST_ID = 'bbq-saturday';

type Tri = [de: string, en: string, es: string];
type Item = { id: string; text: Tri; qty: number; unit?: Tri; category: string };

/** first version; `category` stays the German built-in key (the checklist localizes it) */
const ITEMS: Item[] = [
  { id: 'sausages', text: ['Bratwürste', 'Sausages', 'Salchichas'], qty: 8, category: 'Fleisch & Fisch' },
  { id: 'veggie-skewers', text: ['Gemüsespieße', 'Veggie skewers', 'Brochetas de verduras'], qty: 4, category: 'Obst & Gemüse' },
  { id: 'corn', text: ['Maiskolben', 'Corn on the cob', 'Mazorcas de maíz'], qty: 4, category: 'Obst & Gemüse' },
  { id: 'tomatoes', text: ['Tomaten', 'Tomatoes', 'Tomates'], qty: 6, category: 'Obst & Gemüse' },
  { id: 'baguette', text: ['Baguette', 'Baguette', 'Barra de pan'], qty: 2, category: 'Brot & Backwaren' },
  { id: 'mustard', text: ['Senf', 'Mustard', 'Mostaza'], qty: 1, unit: ['Glas', 'jar', 'tarro'], category: 'Vorrat' },
  { id: 'lemonade', text: ['Zitronenlimonade', 'Lemonade', 'Limonada'], qty: 6, unit: ['Flaschen', 'bottles', 'botellas'], category: 'Getränke' },
];
/** what turn 2 adds */
const CHARCOAL: Item = { id: 'charcoal', text: ['Grillkohle', 'Charcoal', 'Carbón'], qty: 1, unit: ['Sack', 'bag', 'saco'], category: 'Haushalt' };
const HALLOUMI: Item = { id: 'halloumi', text: ['Halloumi', 'Halloumi', 'Halloumi'], qty: 2, unit: ['Packungen', 'packs', 'paquetes'], category: 'Kühlregal' };

const li = (ctx: Pick<DemoContext, 'lang'>) => (ctx.lang === 'en' ? 1 : ctx.lang === 'es' ? 2 : 0);
const item = (ctx: Pick<DemoContext, 'lang'>, it: Item, checked = false) => ({
  id: it.id,
  text: it.text[li(ctx)],
  qty: it.qty,
  ...(it.unit ? { unit: it.unit[li(ctx)] } : {}),
  category: it.category,
  ...(checked ? { checked: true } : {}),
});
const title = (ctx: Pick<DemoContext, 'lang'>) => L(ctx, 'Grillen am Samstag', 'Saturday barbecue', 'Barbacoa del sábado');

function listNode(ctx: DemoContext, items: ReturnType<typeof item>[]) {
  return hui({ type: 'checklist', id: LIVE_LIST_ID, live: true, title: title(ctx), kind: 'shopping', groupBy: 'category', items });
}

/** the user's own edits of the list that came with this message (ops of its `[hui:live]` batch) */
function userOps(ctx: DemoContext) {
  const b = ctx.live?.[LIVE_LIST_ID];
  return b?.ops ?? [];
}

export const liveList: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => [
    {
      text: L(
        ctx,
        'Ich habe dir eine Einkaufsliste fürs Grillen angelegt und oben im Chat angeheftet. Hak ab, was du schon hast. Wenn sich etwas ändert, sag es mir einfach, dann pflege ich die Liste weiter.\n\n',
        "I've started a shopping list for the barbecue and pinned it to the top of this chat. Tick off what you already have. When something changes, just tell me and I'll keep the list up to date.\n\n",
        'He creado una lista de la compra para la barbacoa y la he fijado arriba en este chat. Marca lo que ya tienes. Si algo cambia, dímelo y mantengo la lista al día.\n\n',
      ),
    },
    { text: listNode(ctx, ITEMS.map((i) => item(ctx, i))) },
    { text: '\n' + chips(ctx, 'liveAdd', 'tour') },
  ],
};

export const liveAdd: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const ops = userOps(ctx);
    const goneTomatoes = ops.some((op) => 'del' in op && op.del === 'tomatoes');
    const ticked = ops.some((op) => 'check' in op);
    const after: DemoStep = {
      text:
        '\n' +
        L(
          ctx,
          'Jede Änderung erscheint so als kurze Notiz, der Verlauf bleibt in der Karte. Mit deinem eigenen Hermes kannst du Tage später zur Liste zurückkommen und weitermachen.\n\n',
          'Every change shows up as a short note like this one, and the card keeps the history. With your own Hermes you can come back to the list days later and carry on.\n\n',
          'Cada cambio aparece así, como una nota breve, y la tarjeta guarda el historial. Con tu propio Hermes puedes volver a la lista días después y seguir.\n\n',
        ) + chips(ctx, 'memoryWhat', 'tour'),
    };
    // no list in this chat yet: start it with the additions (a patch needs a card to change)
    if (!ctx.earlier?.includes('liveList')) {
      const items = [...ITEMS.slice(0, 2).map((i) => item(ctx, i)), item(ctx, HALLOUMI), ...ITEMS.slice(2).map((i) => item(ctx, i, i.id === 'tomatoes')), item(ctx, CHARCOAL)];
      return [
        {
          text: L(
            ctx,
            'Hier ist eine Grillliste mit Grillkohle und Halloumi, oben im Chat angeheftet. Die Tomaten sind schon abgehakt, die hast du ja.\n\n',
            "Here is a barbecue list with charcoal and halloumi, pinned to the top of this chat. The tomatoes are already ticked off since you have them.\n\n",
            'Aquí tienes una lista para la barbacoa con carbón y halloumi, fijada arriba en este chat. Los tomates ya están marcados, porque los tienes.\n\n',
          ),
        },
        { text: listNode(ctx, items) },
        after,
      ];
    }
    const patchOps = [
      { add: item(ctx, CHARCOAL) },
      { add: item(ctx, HALLOUMI), after: 'veggie-skewers' },
      ...(goneTomatoes ? [] : [{ check: 'tomatoes' }]),
    ];
    const receipt = [`+ ${CHARCOAL.text[li(ctx)]}`, `+ ${HALLOUMI.text[li(ctx)]} (2)`, ...(goneTomatoes ? [] : [`✓ ${L(ctx, 'Tomaten', 'Tomatoes', 'Tomates')}`])].join(', ');
    return [
      {
        text:
          L(
            ctx,
            goneTomatoes ? 'Grillkohle und Halloumi stehen drauf. Die Tomaten hattest du schon gestrichen.' : 'Grillkohle und Halloumi stehen drauf, die Tomaten sind abgehakt.',
            goneTomatoes ? 'Charcoal and halloumi are on the list. You had already removed the tomatoes.' : 'Charcoal and halloumi are on the list, and the tomatoes are ticked off.',
            goneTomatoes ? 'El carbón y el halloumi ya están en la lista. Los tomates ya los habías quitado.' : 'El carbón y el halloumi ya están en la lista, y los tomates quedan marcados.',
          ) +
          (ticked ? L(ctx, ' Deine eigenen Häkchen bleiben, wie sie sind.', ' Your own ticks stay as they are.', ' Tus marcas se quedan como están.') : '') +
          '\n\n',
      },
      {
        text: hui({
          type: 'callout',
          tone: 'info',
          title: L(ctx, 'Grillen am Samstag aktualisiert', 'Saturday barbecue updated', 'Barbacoa del sábado actualizada'),
          text: receipt,
          livePatch: { card: LIVE_LIST_ID, ops: patchOps },
        }),
      },
      after,
    ];
  },
};

export const LIVE_SCENES: Record<string, DemoScenario> = { liveList, liveAdd };
