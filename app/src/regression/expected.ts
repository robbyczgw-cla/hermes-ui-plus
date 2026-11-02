// Recorded answers that are SUPPOSED to produce a finding (replay.ts): the model really said something false, which the
// live gate must catch, or a known content drop with its open ticket. Every other recorded answer must produce none.
// Remove an entry when its cause is fixed (the replay fails until you do, so the list cannot go stale).
//
//   '<conversation id>#<turn index>': { codes: [finding codes], why: 'one line' }
export const EXPECTED: Record<string, { codes: string[]; why: string }> = {
  // F01 (round 1): Haiku confirmed a reminder with no scheduling tool. The app shows the prose as written; the claim
  // check is what fails such an answer in the live gate.
  'r1-en-j11-tea-timer-reminder#2': { codes: ['claims-reminder'], why: 'F01: "Erledigt – morgen um 9 Uhr wirst du erinnert" without any tool' },
  'r1-de-j11-tea-timer-reminder#2': { codes: ['claims-reminder'], why: 'F01: "Erledigt – morgen um 9 Uhr wirst du erinnert" without any tool' },
  // round 2: "save this for future chats" / "forget it" acknowledged although the test instance has no memory tool
  'r2-de-n05-memory#0': { codes: ['claims-memory'], why: 'round 2: "Das behalte ich für künftige Gespräche im Gedächtnis" without a memory tool' },
  'r2-de-n05-memory#1': { codes: ['claims-memory'], why: 'round 2: "Ich vergesse die Notiz …" without a memory tool' },
  // R3-01 fix: `"price": 600, "note": "Zielpreis"` is read as the target price and drawn as "Wunschpreis 600 €"; the
  // word itself is not repeated (content kept, wording changed)
  'r2-de-n03-price-watchlist#0': { codes: ['dropped:products.note'], why: 'note "Zielpreis" is shown as "Wunschpreis …" (R3-01)' },
  'r2-de-n03-price-watchlist#1': { codes: ['dropped:products.note'], why: 'note "Zielpreis" is shown as "Wunschpreis …" (R3-01)' },
};
