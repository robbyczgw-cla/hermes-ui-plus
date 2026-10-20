// The sample of "Ask several bots": one question, a different answer per bot (ctx.bot). The default bot answers short and
// practical with a choice it can act on; the "research" bot looks things up and brings a table with its sources. Fully
// offline, fictional numbers (labelled as sample data), written in en/de/es.
import { L, hui, tool, type DemoScenario } from './kit.ts';

export const MULTI_CHOICE_ID = 'multi-help';

const researchSteps: DemoScenario['steps'] = (ctx) => [
  { reasoning: L(ctx, 'Preise sind regional verschieden; ich nehme Beispielwerte und sage das dazu.', 'Prices differ by region; I will use sample values and say so.', 'Los precios varían según la región; usaré valores de ejemplo y lo diré.') },
  tool.search(L(ctx, 'Umzug Kosten Transporter Umzugsfirma', 'moving costs van rental moving company', 'costes mudanza furgoneta empresa de mudanzas'), 1100),
  { text: L(ctx, 'Ich habe Vergleichswerte zusammengestellt (Beispieldaten, keine Live-Preise):\n\n', 'I put comparison figures together (sample data, not live prices):\n\n', 'He reunido valores de comparación (datos de ejemplo, no precios en vivo):\n\n') },
  {
    text: hui({
      type: 'table',
      caption: L(ctx, 'Umzug, 2-Zimmer-Wohnung, 30 km', 'Move, 2-room flat, 30 km', 'Mudanza, piso de 2 habitaciones, 30 km'),
      source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
      basis: 'illustrative',
      columns: [L(ctx, 'Variante', 'Option', 'Opción'), L(ctx, 'Kosten', 'Cost', 'Coste'), L(ctx, 'Dein Aufwand', 'Your effort', 'Tu esfuerzo')],
      rows: [
        [L(ctx, 'Transporter + Helfer', 'Van + helpers', 'Furgoneta + ayuda'), L(ctx, 'ca. 180 €', 'about €180', 'unos 180 €'), L(ctx, 'hoch', 'high', 'alto')],
        [L(ctx, 'Transporter + Träger', 'Van + carriers', 'Furgoneta + mozos'), L(ctx, 'ca. 420 €', 'about €420', 'unos 420 €'), L(ctx, 'mittel', 'medium', 'medio')],
        [L(ctx, 'Umzugsfirma', 'Moving company', 'Empresa de mudanzas'), L(ctx, 'ca. 750 €', 'about €750', 'unos 750 €'), L(ctx, 'gering', 'low', 'bajo')],
      ],
    }),
  },
  {
    text:
      L(
        ctx,
        '\nAb etwa 40 Kartons und schweren Möbeln kippt es meist zugunsten der Firma. Mit zwei, drei Helfern bleibt der Transporter die günstigste Wahl.\n\n',
        '\nFrom about 40 boxes and heavy furniture it usually tips towards the company. With two or three helpers the van stays the cheapest choice.\n\n',
        '\nA partir de unas 40 cajas y muebles pesados suele inclinarse hacia la empresa. Con dos o tres ayudantes, la furgoneta sigue siendo lo más barato.\n\n',
      ) +
      hui({
        type: 'sources',
        items: [
          {
            title: L(ctx, 'Umzugskosten im Überblick', 'Moving costs at a glance', 'Costes de mudanza: resumen'),
            url: 'https://example.com/moving-costs',
            siteName: 'example.com',
            snippet: L(ctx, 'Beispielquelle: typische Preisspannen nach Wohnungsgröße und Entfernung.', 'Sample source: typical price ranges by flat size and distance.', 'Fuente de ejemplo: rangos de precio típicos según tamaño y distancia.'),
          },
        ],
      }),
  },
];

const defaultSteps: DemoScenario['steps'] = (ctx) => [
  { text: L(ctx, 'Kurz gesagt: **kommt darauf an, wie viel Hilfe du hast.**\n\n', 'In short: **it depends on how much help you have.**\n\n', 'En resumen: **depende de cuánta ayuda tengas.**\n\n') },
  {
    text: L(
      ctx,
      'Mit zwei, drei Freunden und einer Wohnung bis etwa 60 m² ist der Transporter fast immer die bessere Wahl: günstiger und flexibel. Bei vielen schweren Möbeln, Treppen ohne Aufzug oder wenig Zeit lohnt sich die Firma.\n\n',
      'With two or three friends and a flat up to about 60 m² the van is almost always the better choice: cheaper and flexible. With a lot of heavy furniture, stairs without a lift or little time, the company pays off.\n\n',
      'Con dos o tres amigos y un piso de hasta unos 60 m², la furgoneta es casi siempre mejor: más barata y flexible. Con muchos muebles pesados, escaleras sin ascensor o poco tiempo, compensa la empresa.\n\n',
    ),
  },
  {
    text: hui({
      type: 'choice',
      id: MULTI_CHOICE_ID,
      question: L(ctx, 'Wie viel Hilfe hast du?', 'How much help do you have?', '¿Cuánta ayuda tienes?'),
      layout: 'list',
      options: [
        { label: L(ctx, 'Mehrere Helfer', 'Several helpers', 'Varios ayudantes'), description: L(ctx, 'Transporter reicht', 'A van is enough', 'Basta con una furgoneta') },
        { label: L(ctx, 'Ein bis zwei Helfer', 'One or two helpers', 'Uno o dos ayudantes'), description: L(ctx, 'Transporter plus Träger', 'Van plus carriers', 'Furgoneta y mozos') },
        { label: L(ctx, 'Niemand', 'Nobody', 'Nadie'), description: L(ctx, 'Lieber die Firma', 'Better the company', 'Mejor la empresa') },
      ],
    }),
  },
];

export const multi: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => (ctx.bot && ctx.bot !== 'default' ? researchSteps(ctx) : defaultSteps(ctx)),
};
