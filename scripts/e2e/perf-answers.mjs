// Scripted content for the Android perf harness (scripts/perf/droid.sh, docs/PERF.md), served by scripts/e2e/mock.mjs:
//  - PERF_LONG: one long answer with everything the renderer has to handle while streaming (headings, paragraphs with
//    inline marks, nested lists, two Markdown tables, three code blocks, a quote and four interactive `hui` blocks),
//  - perfHistory(n): a deterministic Hermes transcript of n rows (user / assistant pairs, assistant answers of mixed
//    shape and length) for the "2000+ message chat" scenario.
// Deterministic: no clocks, no randomness beyond the seeded PRNG of the caller.
import { SCENARIOS } from '../demo-videos/scenarios.mjs';

const texts = (name) => SCENARIOS[name].steps({ userText: '', turn: 1, sessionId: 'perf', now: new Date(0) }).filter((s) => 'text' in s).map((s) => s.text).join('');

const para = (topic, i) =>
  `${topic} matters for **trip ${i + 1}** because the numbers change with distance, weather and *how often* you ride. ` +
  `A quick rule: under \`10 km\` the e-bike usually wins, between 10 and 20 km it depends on parking, and above that ` +
  `the car or a train is faster. See [the city mobility notes](https://example.com/mobility/${i}) for the method.\n\n`;

const tableWide = () => {
  const head = '| Month | Rides | km | Energy (kWh) | Cost (€) | Notes |\n|---|---:|---:|---:|---:|---|\n';
  const rows = Array.from({ length: 12 }, (_, i) => {
    const rides = 18 + ((i * 7) % 11);
    const km = rides * (6 + (i % 4));
    return `| ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]} | ${rides} | ${km} | ${(km * 0.011).toFixed(2)} | ${(km * 0.011 * 0.32).toFixed(2)} | ${i % 3 === 0 ? 'rain gear' : i % 3 === 1 ? 'tyre check' : '—'} |\n`;
  });
  return head + rows.join('') + '\n';
};

const codePy = () =>
  '```python\nfrom dataclasses import dataclass\n\n\n@dataclass\nclass Trip:\n    km: float\n    minutes: int\n    mode: str\n\n\n' +
  'def yearly_cost(trips: list[Trip], price_per_km: dict[str, float], days: int = 220) -> dict[str, float]:\n' +
  '    """Cost per mode for a year of the same weekly trips."""\n    out: dict[str, float] = {}\n    for t in trips:\n' +
  '        out[t.mode] = out.get(t.mode, 0.0) + t.km * price_per_km[t.mode] * days\n    return {k: round(v, 2) for k, v in out.items()}\n\n\n' +
  'TRIPS = [\n' + Array.from({ length: 10 }, (_, i) => `    Trip(km=${3 + i * 1.5}, minutes=${11 + i * 4}, mode="${i % 2 ? 'car' : 'ebike'}"),\n`).join('') +
  ']\nprint(yearly_cost(TRIPS, {"ebike": 0.04, "car": 0.32}))\n```\n\n';

const codeTs = () =>
  '```ts\ntype Mode = "ebike" | "car" | "bus";\n\ninterface Leg {\n  from: string;\n  to: string;\n  km: number;\n  mode: Mode;\n}\n\n' +
  'const SPEED: Record<Mode, number> = { ebike: 18, car: 26, bus: 15 };\n\n' +
  'export function minutes(legs: readonly Leg[]): number {\n  let total = 0;\n  for (const leg of legs) {\n' +
  '    const wait = leg.mode === "bus" ? 6 : leg.mode === "car" ? 4 : 1;\n    total += wait + (leg.km / SPEED[leg.mode]) * 60;\n  }\n  return Math.round(total);\n}\n\n' +
  'export function cheapest(options: readonly Leg[][], pricePerKm: Record<Mode, number>): Leg[] | undefined {\n' +
  '  let best: Leg[] | undefined;\n  let bestCost = Infinity;\n  for (const legs of options) {\n' +
  '    const cost = legs.reduce((sum, l) => sum + l.km * pricePerKm[l.mode], 0);\n    if (cost < bestCost) {\n      best = legs;\n      bestCost = cost;\n    }\n  }\n  return best;\n}\n\n' +
  Array.from({ length: 12 }, (_, i) => `console.log(minutes([{ from: "A${i}", to: "B${i}", km: ${2 + i}, mode: "${['ebike', 'car', 'bus'][i % 3]}" }]));\n`).join('') +
  '```\n\n';

const codeSh = () =>
  '```bash\n#!/usr/bin/env bash\nset -euo pipefail\n# log a ride: date, km, minutes\nlog=${HOME}/rides.csv\n[ -f "$log" ] || echo "date,km,minutes" > "$log"\n' +
  'echo "$(date +%F),${1:?km},${2:?minutes}" >> "$log"\nawk -F, \'NR > 1 { km += $2; min += $3 } END { printf "%.1f km in %d min\\n", km, min }\' "$log"\n```\n\n';

export const PERF_LONG = [
  '# E-bike, car or bus: a full year in numbers\n\nShort version: for most city trips under 10 km the **e-bike wins** on cost and often on time. ',
  'Below are the details, a monthly table, a small script to check your own numbers and a checklist to try it for two weeks.\n\n',
  '## 1. What matters most\n\n',
  '- **Distance:** most city trips are short\n  - under 5 km: walking or the e-bike\n  - 5–15 km: the e-bike, unless it pours\n- **Parking:** an e-bike parks at the door\n- **Weather:** rain gear makes most days fine\n- **Cargo:** a trailer or box handles shopping\n\n',
  ...Array.from({ length: 4 }, (_, i) => para(['Distance', 'Parking', 'Weather', 'Cargo'][i], i)),
  texts('ebike'),
  '\n\n## 2. A year of rides\n\n',
  tableWide(),
  '> Numbers are illustrative: energy at 11 Wh/km and €0.32/kWh. Your bike and tariff will differ, but the shape holds.\n\n',
  texts('ebikeTable'),
  '\n\n## 3. Check it yourself\n\n',
  codePy(),
  'The same idea in TypeScript, with waiting times per mode:\n\n',
  codeTs(),
  'And a tiny logger for your own rides:\n\n',
  codeSh(),
  '## 4. Network at home\n\n',
  texts('blocksWifi'),
  '\n\n## 5. Two-week trial\n\n1. Rent or borrow an e-bike for **14 days**\n2. Log every trip (the script above)\n3. Compare with the same two weeks by car\n4. Decide with your own numbers\n\n',
  texts('workout'),
  '\n\n',
  texts('recipe'),
  '\n\n| Trip | E-bike | Car | Bus |\n|---|---:|---:|---:|\n| 3 km to work | 11 min | 14 min | 19 min |\n| 7 km to the gym | 24 min | 21 min | 33 min |\n| 12 km to friends | 41 min | 27 min | 48 min |\n\n',
  ...Array.from({ length: 3 }, (_, i) => para(['Comfort', 'Safety', 'Health'][i], i + 4)),
  '**Bottom line:** try the e-bike for two weeks before deciding, and keep a car-sharing account for the rare long trip. [end of perf answer]',
].join('');

/** ~39k chars: the perf answer three times (a long coding/research answer; per-delta costs that grow with the text) */
export const PERF_HUGE = [1, 2, 3].map((n) => PERF_LONG.replace('# E-bike, car or bus', `# Part ${n}: e-bike, car or bus`).replace('[end of perf answer]', n === 3 ? '[end of perf answer]' : '')).join('\n\n---\n\n');

const QUESTIONS = ['How long does the battery last?', 'Is it worth it in winter?', 'What about theft?', 'Compare insurance options', 'Plan my week', 'Show the costs again'];

/** assistant answer of history row pair `i`: short text, a list, a table or code, a long paragraph run (mixed sizes) */
function historyAnswer(i) {
  switch (i % 5) {
    case 0:
      return `Sure. ${para('Battery range', i)}`;
    case 1:
      return `Here are the options:\n\n- **Option ${i}a:** cheapest, slower\n- **Option ${i}b:** balanced\n- **Option ${i}c:** fastest, more expensive\n\nPick one and I will plan it.`;
    case 2:
      return `| Item | Cost | Note |\n|---|---:|---|\n| Lock | €${40 + (i % 30)} | D-lock |\n| Insurance | €${60 + (i % 50)}/yr | theft + damage |\n| Service | €${80 + (i % 20)}/yr | twice a year |\n\nTotal per year depends on the lock.`;
    case 3:
      return `A quick check:\n\n\`\`\`python\nprint(round(${i % 17 + 3} * 0.04 * 220, 2))  # e-bike, € per year\n\`\`\`\n\nThat is about the price of a coffee per month.`;
    default:
      return Array.from({ length: 3 }, (_, k) => para(['Winter', 'Theft', 'Comfort'][k], i + k)).join('');
  }
}

/** `n` transcript rows (alternating user / assistant), oldest first, in the shape of the Hermes session API */
export function perfHistory(n, startTs = 1_760_000_000) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const pair = Math.floor(i / 2);
    const user = i % 2 === 0;
    rows.push({
      role: user ? 'user' : 'assistant',
      content: user ? `${QUESTIONS[pair % QUESTIONS.length]} (#${pair + 1})` : historyAnswer(pair),
      timestamp: startTs + i * 30,
      ...(user ? {} : { finish_reason: 'stop' }),
    });
  }
  return rows;
}
