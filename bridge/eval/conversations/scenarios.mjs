// Realistic multi-turn conversations for the live conversation test (run.mjs). Written like real phone input
// (dictation typos, short follow-ups that only make sense in context). Each turn goes to the bridge exactly like the
// app sends it: only the new user message, the session continues server-side (X-Hermes-Session-Id).
//
// Per turn: `expect` lists node types of which at least one should appear (soft: reported, not failed; models vary),
// the hard checks are the same for every answer (check.mjs).
export const SCENARIOS = [
  {
    id: 'handheld-photos',
    note: 'bug report 2026-10-19: product comparison with typos, then "Fotos?" rendered as an empty gap',
    turns: [
      { text: 'Trim ui hammer vs RG 3gxx plus für GBA', expect: ['products', 'compare', 'table'] },
      { text: 'Fotos?', expect: ['gallery', 'image', 'products'] },
      { text: 'als Tabelle?', expect: ['table'] },
      { text: 'mehr Details?' },
    ],
  },
];
