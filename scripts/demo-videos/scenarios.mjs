// Public, fictional sample content. All images reuse the existing CC0/generated media and credits.
const hui = (node) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
export const IMAGE_MAP = [
  ['green lantern', 'cacio.jpg'], ['river fork', 'carbonara.jpg'], ['crunchy comet', 'pizza.jpg'],
  ['scoop cloud', 'gelato.jpg'], ['tiny cup', 'espresso.jpg'], ['shakshuka', 'shakshuka.jpg'],
  ['aurel', 'hp-aurel.jpg'], ['nordwell', 'hp-nordwell.jpg'], ['kiro', 'hp-kiro.jpg'],
  ['halden', 'hp-halden.jpg'], ['vela', 'hp-vela.jpg'], ['bike brake', 'bike-brake.jpg'], ['bike tire', 'bike-mantel.jpg'],
];
const PLACES = {
  type: 'places', id: 'dinner-demo', title: 'Dinner near the Pantheon', basis: 'illustrative',
  places: [
    { id: 'vicolo', name: 'Green Lantern Kitchen', category: 'Roman cooking', address: '18 Example Lane, Rome',
      lat: 41.9006, lng: 12.4715, rating: 4.7, reviews: 1284, price: '€€', openNow: true, hoursToday: '12:00–15:00, 19:00–23:30',
      hours: ['Tue–Sun 12:00–15:00, 19:00–23:30', 'Closed Mondays'], website: 'https://example.com/green-lantern',
      imageQuery: 'Green Lantern Kitchen pasta', distance: '450 m', note: 'Peppery pasta, a tiny courtyard, big holiday energy. Book after 8 pm.',
      tags: ['Courtyard', 'Booking recommended', 'Vegetarian options'] },
    { id: 'ponte', name: 'River Fork Kitchen', category: 'Italian cooking', address: '7 Example Walk, Rome',
      lat: 41.8946, lng: 12.4691, rating: 4.5, reviews: 862, price: '€€', openNow: true, hoursToday: '18:30–23:00',
      hours: ['Mon–Sat 18:30–23:00', 'Sun 12:00–15:00'], website: 'https://example.com/river-fork',
      imageQuery: 'River Fork carbonara', distance: '900 m', note: 'Creamy carbonara and tables overlooking the river.', tags: ['Terrace', 'House wine'] },
    { id: 'forno', name: 'Crunchy Comet Pizza', category: 'Pizza', address: '31 Example Street, Rome',
      lat: 41.8915, lng: 12.4689, rating: 4.4, reviews: 2140, price: '€', openNow: false, hoursToday: 'Opens at 19:00',
      hours: ['Daily 19:00–00:30'], imageQuery: 'Crunchy Comet pizza', distance: '1.3 km',
      note: 'Thin, crispy wood-fired pizza. Quick, cheerful and easy on the wallet.', tags: ['Walk-ins', 'Wood-fired oven'] },
    { id: 'gelato', name: 'Scoop Cloud', category: 'Ice cream', address: '5 Example Alley, Rome',
      lat: 41.8969, lng: 12.4917, rating: 4.8, reviews: 3312, price: '€', openNow: true, hoursToday: '11:00–00:00',
      imageQuery: 'Scoop Cloud gelato', distance: '1.6 km', note: 'Pistachio and sweet cream: a very good excuse for a longer walk.', tags: ['Takeaway', 'Vegan flavors'] },
    { id: 'caffe', name: 'Tiny Cup Café', category: 'Café & bar', address: '2 Example Square, Rome',
      lat: 41.8989, lng: 12.4768, rating: 4.2, reviews: 975, price: '€€', openNow: true, hoursToday: '07:00–22:00',
      imageQuery: 'Tiny Cup espresso', distance: '60 m', note: 'Espresso with a view. Standing at the counter costs less.' },
  ],
};
// These product labels match the existing generated fictional headphone illustrations.
const HEADPHONES = {
  type: 'products', id: 'anc-top5', title: 'Top 5: noise-canceling headphones under €350', ranked: true, compare: true, basis: 'illustrative',
  products: [
    { id: 'aurel', name: 'Quiet Pro', brand: 'Aurel', imageQuery: 'Aurel Quiet Pro', price: 329, currency: 'EUR', rating: 4.7, reviews: 1840, badge: 'Best overall',
      verdict: 'Great noise canceling and crystal-clear calls. The all-rounder.',
      scores: [{ label: 'ANC', value: 9.4 }, { label: 'Sound', value: 9.0 }, { label: 'Comfort', value: 8.6 }, { label: 'Battery', value: 8.2 }],
      specs: [{ label: 'ANC', value: 'Adaptive, 8 mics' }, { label: 'Battery', value: '32 h' }, { label: 'Weight', value: '252 g' }, { label: 'Codecs', value: 'AAC, LDAC' }, { label: 'Multipoint', value: 'Yes' }],
      pros: ['Excellent ANC', 'Clear calls', 'Folds into a case'], cons: ['Highest price', 'No aptX'],
      offers: [{ merchant: 'Sound Sprout Demo', price: 329, url: 'https://example.com/shop/aurel' }, { merchant: 'Gadget Grove Demo', price: 339, url: 'https://example.com/aurel' }] },
    { id: 'nordwell', name: 'ANC 5', brand: 'Nordwell', imageQuery: 'Nordwell ANC 5', price: 279, currency: 'EUR', rating: 4.6, reviews: 1205, badge: 'Most comfortable',
      verdict: 'Light as a cloud. Your ears will thank you on long flights.',
      scores: [{ label: 'ANC', value: 8.8 }, { label: 'Sound', value: 8.5 }, { label: 'Comfort', value: 9.5 }, { label: 'Battery', value: 8.0 }],
      specs: [{ label: 'ANC', value: 'Adaptive, 6 mics' }, { label: 'Battery', value: '30 h' }, { label: 'Weight', value: '228 g' }, { label: 'Codecs', value: 'AAC, aptX' }, { label: 'Multipoint', value: 'Yes' }],
      pros: ['Very light', 'Soft cushions'], cons: ['Sound a little restrained'], offers: [{ merchant: 'Audio Acorn Demo', price: 279, url: 'https://example.com/shop/nordwell' }] },
    { id: 'halden', name: 'Studio Q', brand: 'Halden', imageQuery: 'Halden Studio Q', price: 249, currency: 'EUR', rating: 4.5, reviews: 690,
      verdict: 'The best sound on this list, with solid noise canceling.',
      scores: [{ label: 'ANC', value: 8.1 }, { label: 'Sound', value: 9.3 }, { label: 'Comfort', value: 8.4 }, { label: 'Battery', value: 7.6 }],
      specs: [{ label: 'ANC', value: 'Hybrid' }, { label: 'Battery', value: '26 h' }, { label: 'Weight', value: '270 g' }, { label: 'Codecs', value: 'AAC, LDAC' }, { label: 'Multipoint', value: 'No' }],
      pros: ['Detailed sound', 'In-app EQ'], cons: ['No multipoint', 'A little heavy'], offers: [{ merchant: 'Sound Sprout Demo', price: 249, url: 'https://example.com/shop/halden' }] },
    { id: 'kiro', name: 'Pulse 2', brand: 'Kiro', imageQuery: 'Kiro Pulse 2', price: 199, currency: 'EUR', rating: 4.4, reviews: 2310, badge: 'Best value',
      verdict: 'Almost as good as second place, for €80 less.',
      scores: [{ label: 'ANC', value: 8.3 }, { label: 'Sound', value: 8.2 }, { label: 'Comfort', value: 8.5 }, { label: 'Battery', value: 9.4 }],
      specs: [{ label: 'ANC', value: 'Adaptive' }, { label: 'Battery', value: '45 h' }, { label: 'Weight', value: '245 g' }, { label: 'Codecs', value: 'AAC' }, { label: 'Multipoint', value: 'Yes' }],
      pros: ['Huge battery', 'Great value'], cons: ['AAC only'], offers: [{ merchant: 'Gadget Grove Demo', price: 199, url: 'https://example.com/kiro' }, { merchant: 'Audio Acorn Demo', price: 209, url: 'https://example.com/shop/kiro' }] },
    { id: 'vela', name: 'Go', brand: 'Vela', imageQuery: 'Vela Go', price: 129, currency: 'EUR', rating: 4.1, reviews: 3105, badge: 'Budget pick',
      verdict: 'An affordable start. Enough ANC for trains and the office.',
      scores: [{ label: 'ANC', value: 7.0 }, { label: 'Sound', value: 7.4 }, { label: 'Comfort', value: 7.8 }, { label: 'Battery', value: 8.8 }],
      specs: [{ label: 'ANC', value: 'Standard' }, { label: 'Battery', value: '40 h' }, { label: 'Weight', value: '238 g' }, { label: 'Codecs', value: 'SBC, AAC' }, { label: 'Multipoint', value: 'Yes' }],
      pros: ['Affordable', 'Fun colors'], cons: ['Weaker ANC', 'Plasticky feel'], offers: [{ merchant: 'Audio Acorn Demo', price: 129, url: 'https://example.com/shop/vela' }] },
  ],
};
const GUIDE = {
  type: 'guide', id: 'tube-demo', title: 'Change a bike inner tube',
  intro: 'About 20 minutes. Grab two tire levers, a new tube with the right valve, and a pump. Let’s get you rolling!',
  steps: [
    { id: 'wheel', title: 'Remove the wheel', body: 'Shift to the **smallest cog** and release the brake if you have rim brakes.\n\n- Undo the quick release or through-axle\n- Pull the wheel down out of the frame', imageQuery: 'Bike brake rim', warning: 'With disc brakes, do not squeeze the brake lever while the wheel is out.' },
    { id: 'air', title: 'Let the air out', body: 'Unscrew the valve cap and release all the air. For a Presta valve, loosen the small knurled nut first.' },
    { id: 'lever', title: 'Lift the tire off', body: 'Slide a tire lever under the bead opposite the valve and hook it in place. Put the second lever 10 cm away and work around the rim.', imageQuery: 'Bike tire', tip: 'Push the tire into the deep center channel of the rim first. That little bit of slack helps a lot.' },
    { id: 'check', title: 'Check inside the tire', body: '**Carefully** feel inside the tread and remove any glass or thorns.' },
    { id: 'tube', title: 'Fit the new tube', body: 'Add a little air so the tube holds its shape. Push the valve through the rim hole, then tuck the tube into the tire.' },
    { id: 'fit', title: 'Refit the tire', body: 'Start at the valve and push the bead onto the rim with both thumbs.' },
    { id: 'pump', title: 'Pump up and check', body: 'Inflate halfway, check the tire is seated evenly, then inflate to the recommended pressure.', seconds: 120, tip: 'Check the pressure range on the tire sidewall.' },
    { id: 'ride', title: 'Refit the wheel', body: 'Fit the wheel, secure the axle and reconnect the brake. Check everything, then take a gentle test ride.' },
  ],
};
const WORKOUT = {
  type: 'workout', id: 'fullbody20', title: 'Full body in 20 minutes', kind: 'mixed',
  warmup: '3 minutes of jumping jacks and arm circles, then 10 easy squats.',
  exercises: [
    { id: 'squat', name: 'Squats', sets: 3, reps: 15, restSeconds: 30, note: 'Knees follow your toes. Keep your back straight.' },
    { id: 'push', name: 'Push-ups', sets: 3, reps: 10, restSeconds: 30, note: 'Too tough? Start on your knees.' },
    { id: 'lunge', name: 'Lunges', sets: 2, reps: 12, restSeconds: 30, note: 'On each side.' },
    { id: 'plank', name: 'Plank', sets: 3, seconds: 40, restSeconds: 20 },
    { id: 'burpee', name: 'Burpees', sets: 2, reps: 8, restSeconds: 45 },
  ], cooldown: 'Stretch thighs, hips, chest and shoulders for 30 seconds each.',
};
// Shared with record.mjs so quiz automation follows the actual scenario content.
export const VOCAB = {
  type: 'vocab', id: 'spanish-trip', title: 'Spanish for your next adventure', from: 'en', to: 'es',
  items: [
    { term: 'the bill', translation: 'la cuenta', example: 'The bill, please. → La cuenta, por favor.' },
    { term: 'How much is it?', translation: '¿Cuánto cuesta?' },
    { term: 'the station', translation: 'la estación', example: 'Where is the station? → ¿Dónde está la estación?' },
    { term: 'the ticket', translation: 'el billete', note: 'Handy for trains and buses.' },
    { term: 'a coffee', translation: 'un café', note: 'Add “con leche” for milk.' },
    { term: 'thank you very much', translation: 'muchas gracias' },
    { term: 'open', translation: 'abierto', note: 'Closed = cerrado.' },
    { term: 'to the right', translation: 'a la derecha', note: 'To the left = a la izquierda.' },
  ],
};
const MINDMAP = {
  type: 'mindmap', id: 'heat-pump', title: 'Heat pump',
  root: { label: 'Heat pump', note: 'Uses heat from air, ground or water, then electricity lifts it to heating temperature.', children: [
    { label: 'How it works', note: 'A cooling cycle, like a refrigerator running in reverse.', children: [
      { label: 'Evaporator', note: 'Refrigerant absorbs outside heat and turns into gas.' },
      { label: 'Compressor', note: 'Compresses the gas, raising its temperature.' },
      { label: 'Condenser', note: 'Transfers heat into the heating circuit.' },
      { label: 'Expansion valve', note: 'Lowers the refrigerant pressure. Around we go again!' },
    ] },
    { label: 'Heat sources', children: [
      { label: 'Air', note: 'Lower upfront cost; less efficient in cold weather.' },
      { label: 'Ground', note: 'Boreholes or buried loops. Efficient, but needs ground work.' },
      { label: 'Groundwater', note: 'Efficient where conditions suit; permissions may be needed.' },
    ] },
    { label: 'Efficiency', children: [
      { label: 'Seasonal COP', note: 'Heat delivered per unit of electricity across the year.' },
      { label: 'Low flow temp', note: 'Underfloor heating or larger radiators can help.' },
    ] },
    { label: 'Costs', children: [
      { label: 'Installation', note: 'Depends on the house and system. Compare quotes.' },
      { label: 'Incentives', note: 'Vary by region. Check current local programs.' },
      { label: 'Electricity', note: 'Running cost depends on efficiency and your tariff.' },
    ] },
    { label: 'Older homes', note: 'Often possible. Assess heating demand first.', children: [{ label: 'Insulation' }, { label: 'Check radiators' }] },
  ] },
};
const RECIPE = {
  type: 'recipe', id: 'shakshuka', title: 'Shakshuka', imageQuery: 'Shakshuka skillet', servings: 2,
  time: { prep: 10, cook: 20, total: 30 },
  ingredients: [
    { qty: 4, item: 'eggs' }, { qty: 1, item: 'red pepper' }, { qty: 1, item: 'onion' }, { qty: 2, item: 'garlic cloves' },
    { qty: 400, unit: 'g', item: 'canned chopped tomatoes' }, { qty: 1, unit: 'tsp', item: 'ground cumin' },
    { qty: 1, unit: 'tsp', item: 'sweet paprika' }, { qty: 80, unit: 'g', item: 'feta' }, { unit: 'a little', item: 'parsley or cilantro' },
  ],
  steps: [
    { text: 'Dice the onion and pepper. Finely chop the garlic.' },
    { text: 'Soften the onion and pepper in olive oil. Add garlic and spices and stir briefly.', timerSeconds: 360 },
    { text: 'Add the tomatoes and simmer until the sauce thickens.', timerSeconds: 600 },
    { text: 'Make four little wells, crack in the eggs, cover and cook until set.', timerSeconds: 420 },
    { text: 'Crumble over feta, scatter with herbs and serve straight from the skillet.' },
  ], tips: ['For runny yolks, lift the lid after 5 minutes and check the eggs.', 'Bring flatbread. You’ll want to scoop up every last drop.'],
};
const LONG_EBIKE =
  'For a **12 km commute, an e-bike could be a great fit**, especially if you currently drive alone. Here’s a fictional comparison to get you thinking.\n\n' +
  '**Cost.** Imagine a €2,500–3,500 commuter bike. Budget for electricity, maintenance and a secure lock. In this example, ' +
  'the bike works out at about €40 a month over five years, while the car costs €150–250 for fuel, wear and parking.\n\n' +
  '**Time.** At an assisted pace of 22–25 km/h, allow around 35 minutes each way. Our example car trip takes 30 minutes, ' +
  'before the parking hunt. The gap is smaller than you might expect.\n\n' +
  '**Movement and emissions.** You get about 70 minutes of daily movement and a lighter travel footprint. ' +
  'Actual emissions depend on your electricity, vehicle and mileage.\n\n' +
  '**The catch.** Heavy rain or ice calls for a backup plan. A safe place to park matters too. Rain jacket? Yes. Superhero cape? Optional.';
const EBIKE_TABLE = {
  type: 'table', caption: '12 km commute: e-bike vs car', basis: 'illustrative', columns: ['', 'E-bike', 'Car'],
  // Short cells keep all three columns visible on a phone, including the last column.
  rows: [['€/month', '≈ 40*', '150–250'], ['min/trip', '≈ 35', '≈ 30**'], ['kg CO₂/yr', '≈ 30', '≈ 1,100'], ['Exercise', '70 min/day', 'None'], ['Rain/ice', 'Plan B', 'Sheltered']],
};
const SERVER_TABLE = {
  type: 'table', caption: 'Disk and logs (sample server)', basis: 'illustrative', columns: ['Item', 'Size', 'Status'],
  rows: [['Disk /', '49 of 80 GB', 'OK'], ['app.log', '2.1 GB', 'No rotation'], ['syslog', '640 MB', 'Weekly'], ['journal', '410 MB', 'Capped']],
};
export const SCENARIOS = {
  research: { format: 'text', steps: () => [
    { reasoning: 'Search for self-hosted RSS readers, read the best candidates, save notes to a file, then summarize with sources.' },
    { tool: { name: 'web_search', label: 'self-hosted RSS reader comparison', emoji: '🔍', ms: 2000 } },
    { tool: { name: 'web_extract', label: 'example.com/rss-readers/compare', emoji: '📄', ms: 2200 } },
    { tool: { name: 'terminal', label: 'git ls-remote --tags https://example.com/feedfox.git | tail -3', emoji: '💻', ms: 1600 } },
    { tool: { name: 'read_file', label: 'notes/rss-candidates.md', emoji: '📖', ms: 1100 } },
    { tool: { name: 'web_search', label: 'FeedFox vs Tiny Pulse memory usage', emoji: '🔍', ms: 2000 } },
    { tool: { name: 'write_file', label: 'notes/rss-summary.md', emoji: '✍️', ms: 1200 } },
    { text: '**Summary:** three self-hosted readers are worth a weekend. **FeedFox** is the best all-rounder [1], **Tiny Pulse** is the lightest at about 40 MB of RAM [2], and **Inkwell** has the nicest reading view but needs a database [3].\n\n', fast: 3 },
    { text: '- **Start with FeedFox** if you want folders, search and a mobile-friendly UI [1].\n', fast: 3 },
    { text: '- **Pick Tiny Pulse** for a small VPS or a Raspberry Pi [2].\n', fast: 3 },
    { text: '- **Skip Inkwell** unless you already run PostgreSQL [3].\n\n', fast: 3 },
    { text: 'I saved the full notes to `notes/rss-summary.md`.\n\n', fast: 3 },
    { text: 'Sources:\n[1] https://example.com/rss-readers/feedfox — FeedFox: features and setup\n[2] https://example.org/pulse/benchmarks — Tiny Pulse memory benchmarks\n[3] https://example.net/inkwell/requirements — Inkwell: requirements\n', fast: 3 },
  ] },
  serverCheck: { format: 'table', steps: () => [
    { reasoning: 'Check disk usage first, then the biggest logs, then how rotation is configured.' },
    { tool: { name: 'terminal', label: 'df -h /', emoji: '💻', ms: 1500 } },
    { tool: { name: 'terminal', label: 'du -sh /var/log/* | sort -rh | head -4', emoji: '💻', ms: 2100 } },
    { tool: { name: 'read_file', label: '/etc/logrotate.d/app', emoji: '📖', ms: 1500 } },
    { tool: { name: 'web_search', label: 'logrotate maxsize daily compress', emoji: '🔍', ms: 2000 } },
    { tool: { name: 'terminal', label: 'journalctl --disk-usage', emoji: '💻', ms: 1300 } },
    { text: 'The disk is fine, but one log is growing without rotation:\n\n' },
    { text: hui(SERVER_TABLE) },
    { text: '\nFix: add `daily`, `rotate 7` and `compress` to `/etc/logrotate.d/app`. Want me to apply it?' },
  ] },
  places: { format: 'places', steps: () => [
    { tool: { name: 'web_search', label: 'Dinner near the Pantheon, open tonight', emoji: '🔍', ms: 1300 } },
    { text: 'Five fictional spots within strolling distance. Bring an appetite!\n\n' }, { text: hui(PLACES) },
    { text: '\nMy pick: **Green Lantern Kitchen**. Book a courtyard table after 8 pm.' },
  ] },
  products: { format: 'products', steps: () => [
    { tool: { name: 'web_search', label: 'Noise-canceling headphones: sample comparison', emoji: '🔍', ms: 1100 } },
    { text: 'Five fictional favorites under €350, ranked by overall score:\n\n' }, { text: hui(HEADPHONES) },
    { text: '\nBattery first? The **Kiro Pulse 2** is the value pick.' },
  ] },
  productsPick: { format: 'text', steps: () => [{ text: 'Nice pick! The **Aurel Quiet Pro** is €329 at Sound Sprout Demo in this sample. Want a price alert below €300?' }] },
  guide: { format: 'guide', steps: () => [{ text: 'Let’s get that bike back on the road, one step at a time:\n\n' }, { text: hui(GUIDE) }] },
  guideStuck: { format: 'text', steps: () => [
    { text: 'A tight tire can be stubborn. Try these three tricks:\n\n' },
    { text: '1. **Let all the air out.** Hold the valve open and squeeze the tire all the way around.\n' },
    { text: '2. **Push the bead into the center channel.** Opposite the lever, press the tire into the deepest part of the rim. That gives you extra slack.\n' },
    { text: '3. **Two levers, small steps.** Hook the first one in, then place the second just 5 cm away.\n\n' },
    { text: hui({ type: 'callout', tone: 'warning', title: 'Skip the screwdriver', text: 'Sharp tools can damage the tube and rim. Use plastic tire levers instead.' }) },
  ] },
  workout: { format: 'workout', steps: () => [{ text: 'Your no-equipment session is ready. Tick off a set and the rest timer starts automatically:\n\n' }, { text: hui(WORKOUT) }] },
  workoutDone: { format: 'text', steps: () => [{ text: 'Strong work! 💪 Next time, let’s try 12 push-ups per set.' }] },
  vocab: { format: 'vocab', steps: () => [{ text: 'Adventure starts with a few words! English → Spanish essentials:\n\n' }, { text: hui(VOCAB) }] },
  vocabDone: { format: 'text', steps: () => [{ text: 'Great job! Tomorrow we’ll revisit the trickier words first.' }] },
  mindmap: { format: 'mindmap', steps: () => [{ text: 'Here’s the big picture. Tap a branch to explore the details:\n\n' }, { text: hui(MINDMAP) }] },
  mindmapDeepen: { format: 'text', steps: () => [
    { text: '**Ground as a heat source:** Below the surface, temperatures are steadier than outdoor air. ' },
    { text: 'A heat pump collects that heat through **vertical boreholes** or **horizontal loops** buried in the garden.\n\n' },
    { text: '- **Upside:** steady performance, even on frosty days\n- **Trade-off:** drilling or excavation adds cost; local permission may be needed' },
  ] },
  ebike: { format: 'text', steps: () => [{ wait: 300 }, { text: LONG_EBIKE }] },
  ebikeTable: { format: 'table', steps: () => [{ text: 'Same idea, easier to scan:\n\n' }, { text: hui(EBIKE_TABLE) }, { text: '\n\\* Five-year depreciation, electricity and maintenance. \\** Plus parking. All figures are illustrative.' }] },
  approval: {
    format: 'text', steps: () => [
      { reasoning: 'Check the folder first, then ask for approval before deleting old files.' },
      { tool: { name: 'terminal', label: 'du -sh ~/Downloads', emoji: '💻', ms: 700 } },
      { tool: { name: 'terminal', label: 'find ~/Downloads -type f -mtime +90 | wc -l', emoji: '💻', ms: 900 } },
      { text: 'The sample folder holds 4.2 GB. **214 files are older than 90 days** (3.1 GB). I need your approval before deleting them.' },
      { approval: { command: 'find ~/Downloads -type f -mtime +90 -delete', description: 'Deletes files in ~/Downloads that are older than 90 days', pattern_key: 'find -delete', pattern_keys: ['find -delete'] } },
    ],
    after: (choice) => choice === 'deny' || choice === 'timeout' ? [{ text: '\n\nUnderstood. Nothing was deleted.' }] : [
      { tool: { name: 'terminal', label: 'find ~/Downloads -type f -mtime +90 -delete', emoji: '💻', ms: 1200 } },
      { text: '\n\nDone! Your sample Downloads folder has room to breathe:\n\n' },
      { text: hui({ type: 'stats', items: [{ label: 'Files deleted', value: '214' }, { label: 'Space freed', value: '3.1 GB', trend: 'up' }, { label: 'Still in folder', value: '1.1 GB' }] }) },
    ],
  },
  recipe: { format: 'recipe', steps: () => [{ wait: 300 }, { text: 'One skillet, two happy people. Here’s a quick shakshuka:\n\n' }, { text: hui(RECIPE) }, { text: '\nEnjoy! Tap “Add ingredients to shopping list” to make your grocery run easy.' }] },
  theme: { format: 'text', steps: () => [{ text: 'Open **Settings → Appearance** to find your favorite light or dark theme:\n\n' }, { text: hui({ type: 'suggestions', items: ['Paper', 'OLED black', 'Standard', 'Nord'] }) }] },
  hello: { format: 'text', steps: () => [{ text: 'Hi! I’m Hermes. Ask me something: I can answer with cards, lists, timers and more when they help.' }] },
};
export function pickV4(text) {
  const t = text.toLowerCase();
  if (/^\[products:/.test(t)) return 'productsPick';
  if (/^\[guide:/.test(t)) return 'guideStuck';
  if (/^\[workout:/.test(t)) return 'workoutDone';
  if (/^\[vocab:/.test(t)) return 'vocabDone';
  if (/^\[mindmap\]/.test(t)) return 'mindmapDeepen';
  if (/^\[reformat:table\]/.test(t)) return 'ebikeTable';
  if (/rome|pantheon/.test(t) && /eat|restaurant|dinner/.test(t)) return 'places';
  if (/headphones/.test(t)) return 'products';
  if (/inner tube/.test(t)) return 'guide';
  if (/training|workout/.test(t)) return 'workout';
  if (/spanish|vocab/.test(t)) return 'vocab';
  if (/mindmap|mind map|heat pump/.test(t)) return 'mindmap';
  if (/e-bike|commute/.test(t)) return 'ebike';
  if (/self-hosted|rss/.test(t)) return 'research';
  if (/server/.test(t) && /disk|log/.test(t)) return 'serverCheck';
  if (/downloads/.test(t)) return 'approval';
  if (/shakshuka/.test(t)) return 'recipe';
  if (/design|theme/.test(t)) return 'theme';
  if (/^(hello|hi)\b/.test(t)) return 'hello';
  return null;
}
