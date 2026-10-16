// Validates ```hui / ```hui-html blocks in examples/*.md (and optionally other .md files).
// Usage: node hermes-skill/examples/validate.mjs [files...]
// Strict checks per SPEC (docs/SPEC.md); also runs the app's lenient normalizeNode() to make sure
// the real renderer pipeline accepts the node without dropping it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let normalizeNode = null;
try {
  ({ normalizeNode } = await import(resolve(here, '../../app/src/protocol/validate.ts')));
} catch (e) {
  console.warn('note: app normalizeNode not importable (' + e.message + '), strict checks only');
}
let parseUnifiedDiff = null;
try {
  ({ parseUnifiedDiff } = await import(resolve(here, '../../app/src/ui/components/modules/e2/diffModel.ts')));
} catch (e) {
  console.warn('note: app parseUnifiedDiff not importable (' + e.message + '), ```diff fences are not parsed');
}

// Real calc engine (app/src/calc, TS via Node type stripping). Falls back to a light syntax check.
let calc = null;
try { calc = await import(resolve(here, '../../app/src/calc/index.ts')); }
catch (e) { console.warn('note: app calc engine not importable (' + e.message + '), using light expression check'); }

const V1_TYPES = ['card','stack','text','callout','stats','table','chart','list','steps','timeline','compare','image','gallery','progress','code','buttons','suggestions','form'];
const V2_TYPES = ['choice','checklist','calc','map','recipe','tabs','accordion','quiz','flashcards','sources','timer','slots','confirm'];
const V3_TYPES = ['translation','poll','agenda','weather','decision','rank','scale'];
const V4_TYPES = ['summary','places','products','guide','workout','studyplan','vocab','mindmap'];
const V5_TYPES = ['paths','blocks'];
const V6_TYPES = ['diff','terminal','changes'];
const TYPES = [...V1_TYPES, ...V2_TYPES, ...V3_TYPES, ...V4_TYPES, ...V5_TYPES, ...V6_TYPES];
const PATH_TONES = ['neutral','good','warn','bad'];
const BLOCK_STYLES = ['soft','framed'];
const PATH_ICONS = ['laptop','desktop','phone','server','cloud','disk','folder','file','database','network','lock','user','globe','app','container','vm','terminal'];
const CHART_KINDS = ['bar','line','area','pie','donut','hbar','stacked','scatter','radar','gauge','heatmap','waterfall'];
const WEATHER_CONDITIONS = ['clear','sunny','partly','cloudy','overcast','fog','drizzle','rain','showers','thunder','snow','sleet','wind','clear-night','partly-night'];
const AGENDA_KINDS = ['work','meal','travel','free','event','sport','focus'];
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const BASES = ['user','sourced','calculated','estimate','illustrative'];
const INPUT_NODES = ['choice','slots','confirm','form','poll','rank','scale','paths-select']; // decision/agenda are editable widgets but answered on demand; counted below too // max one per answer
const ID_NODES = ['form','choice','checklist','calc','recipe','quiz','flashcards','timer','slots','confirm','poll','agenda','decision','rank','scale','places','products','guide','workout','studyplan','vocab','changes']; // interactive: id required (mindmap: id optional)
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
let ctx = { ids: new Map(), refs: [], summaryAt: [], mindLabels: new Set(), pathTitles: new Map() }; // per assistant message: node id -> type; ask.include references
const MAX_IMAGES = 6; // per answer
let imageCount = 0;
// image query = article-title-like text, never a URL
function imgQuery(q, path, req = true) {
  if (q === undefined) { chk(!req, path, 'missing'); return; }
  chk(typeof q === 'string' && q.trim().length > 0 && q.length <= 120, path, 'query must be a non-empty string <= 120 chars');
  chk(!/https?:|www\.|\.(jpe?g|png|webp|gif|svg)\b/i.test(q || ''), path, 'query must be a title, not a URL/file');
  imageCount++;
}
const errs = [];
const is = (x, t) => typeof x === t;
const isArr = Array.isArray;
const oneOf = (v, a) => a.includes(v);

function chk(cond, path, msg) { if (!cond) errs.push(`${path}: ${msg}`); }
function str(v, path, req = true) { if (v === undefined) { chk(!req, path, 'missing'); return; } chk(is(v, 'string'), path, 'must be string'); }
const ACTION_TYPES = ['send','submit','open_url','copy','calendar','reminder','maps','call','email','sms','timer','add_to_list','ask'];
const PHONE = /^\+?\d{3,15}$/;
function checkAction(a, p) {
  chk(a && is(a, 'object'), p, 'action must be object');
  if (!a) return;
  chk(oneOf(a.type, ACTION_TYPES), p, 'bad action type ' + a.type);
  if (a.type === 'send' || a.type === 'copy') str(a.text, p + '.text');
  if (a.type === 'open_url') chk(/^https:\/\//.test(a.url || ''), p + '.url', 'must be https');
  if (a.type === 'calendar') { str(a.title, p + '.title'); chk(ISO.test(a.start || ''), p + '.start', 'ISO 8601 local time'); if (a.end !== undefined) chk(ISO.test(a.end) && a.end >= a.start, p + '.end', 'ISO and not before start'); }
  if (a.type === 'reminder') { str(a.title, p + '.title'); chk(ISO.test(a.at || ''), p + '.at', 'ISO 8601'); }
  if (a.type === 'maps') { chk(is(a.query, 'string') || (is(a.lat, 'number') && is(a.lng, 'number')), p, 'maps needs query or lat+lng'); if (a.mode) chk(oneOf(a.mode, ['driving','walking','transit']), p + '.mode', 'mode'); }
  if (a.type === 'call') chk(PHONE.test((a.phone || '').replace(/[\s()-]/g, '')), p + '.phone', 'phone');
  if (a.type === 'sms') chk(PHONE.test((a.to || '').replace(/[\s()-]/g, '')), p + '.to', 'phone');
  if (a.type === 'email') chk(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(a.to || ''), p + '.to', 'e-mail');
  if (a.type === 'timer') { chk(Number.isInteger(a.seconds) && a.seconds >= 1 && a.seconds <= 86400, p + '.seconds', 'integer 1..86400'); str(a.label, p + '.label'); }
  if (a.type === 'add_to_list') chk(isArr(a.items) && a.items.length >= 1 && a.items.length <= 50 && a.items.every(x => is(x, 'string') && x.trim()), p + '.items', '1..50 non-empty strings');
  if (a.type === 'ask') { str(a.text, p + '.text'); if (a.include !== undefined) { chk(isArr(a.include) && a.include.length <= 8 && a.include.every(x => is(x, 'string')), p + '.include', 'node id strings (<= 8)'); (a.include || []).forEach(id => ctx.refs.push({ id, where: p + '.include' })); } }
}

// ---- calc expressions ----
function lightExpr(src, p) {
  chk(!/\d,\d/.test(src), p, 'decimal comma in expression');
  chk(/^[\p{L}\p{N}_\s.+\-*\/^%()<>=!&|?:,]+$/u.test(src), p, 'illegal characters');
  let d = 0; for (const c of src) { if (c === '(') d++; if (c === ')') d--; if (d < 0) break; } chk(d === 0, p, 'unbalanced parentheses');
}
function checkExpr(src, scopeNames, p) {
  chk(is(src, 'string') && src.trim().length > 0 && src.length <= 500, p, 'expr must be a non-empty string <= 500 chars');
  if (!is(src, 'string')) return null;
  if (!calc) { lightExpr(src, p); return null; }
  const r = calc.compile(src);
  if (!r.ok) { errs.push(`${p}: expression "${src}" does not compile: ${r.error.message}`); return null; }
  for (const id of r.identifiers) if (!scopeNames.has(id) && id !== 'pi' && id !== 'e') errs.push(`${p}: unknown identifier "${id}" (in scope: ${[...scopeNames].join(', ')})`);
  return r;
}
function checkCalc(n, p) {
  chk(isArr(n.inputs) && n.inputs.length >= 1 && n.inputs.length <= 8, p + '.inputs', '1-8 inputs');
  chk(isArr(n.outputs) && n.outputs.length >= 1 && n.outputs.length <= 8, p + '.outputs', '1-8 outputs');
  const scope = new Set(); const values = {};
  (n.inputs || []).forEach((f, i) => { const q = `${p}.inputs[${i}]`;
    chk(is(f.name, 'string') && IDENT.test(f.name), q + '.name', 'identifier (letters, digits, _)'); chk(!scope.has(f.name), q + '.name', 'duplicate name'); chk(!['pi','e'].includes(f.name), q + '.name', 'clashes with constant');
    str(f.label, q + '.label'); chk(oneOf(f.kind, ['slider','number','select','toggle']), q + '.kind', 'kind');
    if (f.kind === 'toggle') chk(is(f.default, 'boolean') || f.default === 0 || f.default === 1, q + '.default', 'boolean or 0/1');
    else if (f.kind === 'select') { chk(isArr(f.options) && f.options.length >= 2 && f.options.every(o => is(o.label, 'string') && is(o.value, 'number')), q + '.options', '>=2 {label, numeric value}'); chk(isArr(f.options) && f.options.some(o => o.value === f.default), q + '.default', 'default must be one of the option values'); }
    else { chk(is(f.default, 'number') && Number.isFinite(f.default), q + '.default', 'number'); }
    if (f.kind === 'slider') { chk(is(f.min, 'number') && is(f.max, 'number') && f.min < f.max, q, 'slider needs min < max'); chk(f.step === undefined || (is(f.step, 'number') && f.step > 0), q + '.step', 'positive step'); chk(is(f.default, 'number') && f.default >= f.min && f.default <= f.max, q + '.default', 'default outside min..max'); }
    scope.add(f.name); values[f.name] = f.kind === 'toggle' ? (f.default ? 1 : 0) : f.default; });
  const fmt = ['number','currency','percent','duration','integer'];
  const results = [];
  (n.outputs || []).forEach((o, i) => { const q = `${p}.outputs[${i}]`;
    str(o.label, q + '.label'); if (o.format) chk(oneOf(o.format, fmt), q + '.format', 'format'); if (o.decimals !== undefined) chk(Number.isInteger(o.decimals) && o.decimals >= 0 && o.decimals <= 10, q + '.decimals', '0..10');
    if (o.name !== undefined) { chk(is(o.name, 'string') && IDENT.test(o.name), q + '.name', 'identifier'); chk(!scope.has(o.name), q + '.name', 'duplicate/clashing name'); }
    const r = checkExpr(o.expr, scope, q + '.expr');
    if (r) { const v = r.fn(values); const ok = v && v.ok && v.value !== null; if (!ok) errs.push(`${q}: expression gives "–"/error with the default inputs`); else if (o.name) values[o.name] = v.value;
      results.push({ o, v: ok ? v.value : null }); }
    if (o.name) scope.add(o.name); });
  // percent outputs are fractions: 4.5 shown as 450 % is a classic mistake
  for (const { o, v } of results) if (o.format === 'percent' && v !== null && Math.abs(v) > 5) errs.push(`${p}: output "${o.label}" format percent expects a fraction (got ${v}); use number + unit "%"`);
  if (n.chart !== undefined) { const c = n.chart, q = p + '.chart';
    chk(oneOf(c.kind, ['line','bar']), q + '.kind', 'line|bar'); chk(c.sweep && n.inputs.some(f => f.name === c.sweep.input), q + '.sweep.input', 'must be an input name');
    chk(c.sweep && is(c.sweep.from, 'number') && is(c.sweep.to, 'number') && Number.isInteger(c.sweep.steps) && c.sweep.steps >= 2 && c.sweep.steps <= 60, q + '.sweep', 'from/to numbers, steps 2..60');
    checkExpr(c.y, scope, q + '.y'); }
}

// ---- v4 helpers (mirror the app caps in app/src/protocol/validate.ts) ----
const HTTPS_URL = /^https:\/\/[^\s]+\.[^\s]+/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const PLACE_PRICES = ['€','€€','€€€','€€€€'];
const WORKOUT_KINDS = ['strength','cardio','mobility','mixed'];
const STUDY_KINDS = ['learn','practice','review','test'];
function keys(n, allowed, p) {
  for (const k of Object.keys(n)) {
    if (allowed.includes(k)) continue;
    const ctxKey = (/\.(products|places)(\[\d+\])?$/.exec(p) || [])[0];
    const hint = ctxKey ? FIELD_HINTS[ctxKey.slice(1).replace(/\[\d+\]$/, '[]') + '.' + k] : (n.type && FIELD_HINTS[`${n.type}.${k}`]);
    errs.push(`${p}.${k}: unknown field${hint ? ' (' + hint + ')' : ''}`);
  }
}
function optStr(o, k, max, p) { if (o[k] === undefined) return; chk(is(o[k], 'string') && o[k].trim().length > 0 && o[k].length <= max, `${p}.${k}`, `non-empty string <= ${max} chars`); }
function reqStr(o, k, max, p) { chk(o[k] !== undefined, `${p}.${k}`, 'missing'); optStr(o, k, max, p); }
function optInt(o, k, lo, hi, p) { if (o[k] === undefined) return; chk(Number.isInteger(o[k]) && o[k] >= lo && o[k] <= hi, `${p}.${k}`, `integer ${lo}..${hi}`); }
function optBool(o, k, p) { if (o[k] !== undefined) chk(is(o[k], 'boolean'), `${p}.${k}`, 'boolean'); }
function strList(o, k, max, len, p) { if (o[k] === undefined) return; chk(isArr(o[k]) && o[k].length >= 1 && o[k].length <= max && o[k].every(x => is(x, 'string') && x.trim() && x.length <= len), `${p}.${k}`, `1..${max} strings <= ${len} chars`); }
function optUrl(o, k, p) { if (o[k] !== undefined) chk(is(o[k], 'string') && HTTPS_URL.test(o[k]), `${p}.${k}`, 'https URL (only from a tool, never invented)'); }
function optRating(o, p) { if (o.rating !== undefined) chk(is(o.rating, 'number') && o.rating >= 0 && o.rating <= 5, p + '.rating', 'number 0..5'); if (o.reviews !== undefined) chk(Number.isInteger(o.reviews) && o.reviews >= 0, p + '.reviews', 'integer >= 0'); }
function itemIds(list, p) { const seen = new Set(); (list || []).forEach((it, i) => { if (it && it.id !== undefined) { chk(is(it.id, 'string') && /^[\w-]{1,40}$/.test(it.id), `${p}[${i}].id`, 'short id'); chk(!seen.has(it.id), `${p}[${i}].id`, 'duplicate id ' + it.id); seen.add(it.id); } }); }
function provenanceNeeded(n, p) { chk(is(n.source, 'string') && n.source.trim() && n.basis === 'sourced', p, 'needs source + basis "sourced" (tool data only; leave unknown fields out)'); }

function checkTimer(n, p) {
  keys(n, ['type','id','label','seconds','autostart','until','mode','timers'], p);
  str(n.label, p + '.label');
  const multi = isArr(n.timers) && n.timers.length > 0;
  const zero = n.seconds === 0 || n.seconds === undefined;
  if (n.seconds !== undefined) chk(Number.isInteger(n.seconds) && n.seconds >= 0 && n.seconds <= 86400, p + '.seconds', 'integer 0..86400');
  const alt = n.until !== undefined || n.mode === 'stopwatch' || multi;
  chk(alt ? zero || (n.seconds >= 1) : Number.isInteger(n.seconds) && n.seconds >= 1, p + '.seconds', 'integer 1..86400 (0/omitted only with until, stopwatch or timers)');
  if (n.autostart !== undefined) chk(n.autostart === false, p + '.autostart', 'timers never autostart');
  if (n.until !== undefined) chk(is(n.until, 'string') && ISO_TIME.test(n.until), p + '.until', 'ISO datetime with time, e.g. 2026-10-17T20:45');
  if (n.mode !== undefined) chk(oneOf(n.mode, ['countdown','stopwatch']), p + '.mode', 'countdown|stopwatch');
  if (n.until !== undefined) chk(n.mode !== 'stopwatch' && !multi, p, 'until excludes stopwatch/timers');
  if (n.timers !== undefined) {
    chk(isArr(n.timers) && n.timers.length >= 1 && n.timers.length <= 6, p + '.timers', '1-6 timers');
    (n.timers || []).forEach((t, i) => { const q = `${p}.timers[${i}]`; keys(t, ['id','label','seconds'], q); str(t.label, q + '.label'); chk(Number.isInteger(t.seconds) && t.seconds >= 1 && t.seconds <= 86400, q + '.seconds', 'integer 1..86400'); });
    itemIds(n.timers, p + '.timers');
  }
}

function checkV4(n, p) {
  switch (n.type) {
    case 'summary':
      keys(n, ['type','id','text','points','verdict'], p);
      reqStr(n, 'text', 600, p); optStr(n, 'verdict', 200, p); strList(n, 'points', 4, 200, p);
      ctx.summaryAt.push(p); break;
    case 'places': {
      keys(n, ['type','id','title','layout','places','source','basis'], p);
      optStr(n, 'title', 200, p); if (n.layout !== undefined) chk(oneOf(n.layout, ['carousel','list']), p + '.layout', 'carousel|list');
      chk(isArr(n.places) && n.places.length >= 1 && n.places.length <= 10, p + '.places', '1-10 places'); provenanceNeeded(n, p);
      itemIds(n.places, p + '.places');
      (n.places || []).forEach((o, i) => { const q = `${p}.places[${i}]`;
        keys(o, ['id','name','category','address','lat','lng','rating','reviews','price','openNow','hours','hoursToday','phone','website','imageQuery','image','distance','note','tags'], q);
        reqStr(o, 'name', 150, q); optStr(o, 'category', 80, q); optStr(o, 'address', 250, q); optRating(o, q);
        chk((o.lat === undefined) === (o.lng === undefined), q, 'lat and lng only together');
        if (o.lat !== undefined) chk(is(o.lat, 'number') && o.lat >= -90 && o.lat <= 90 && is(o.lng, 'number') && o.lng >= -180 && o.lng <= 180, q + '.lat', 'lat -90..90, lng -180..180');
        if (o.price !== undefined) chk(PLACE_PRICES.includes(o.price), q + '.price', '€|€€|€€€|€€€€');
        optBool(o, 'openNow', q); strList(o, 'hours', 7, 100, q); optStr(o, 'hoursToday', 100, q);
        if (o.phone !== undefined) chk(is(o.phone, 'string') && PHONE.test(o.phone.replace(/[\s()-]/g, '')), q + '.phone', 'digits with optional +');
        optUrl(o, 'website', q); optUrl(o, 'image', q); if (o.imageQuery !== undefined) imgQuery(o.imageQuery, q + '.imageQuery');
        optStr(o, 'distance', 40, q); optStr(o, 'note', 300, q); strList(o, 'tags', 8, 40, q); });
      break; }
    case 'products': {
      keys(n, ['type','id','title','layout','compare','ranked','products','source','basis'], p);
      optStr(n, 'title', 200, p); if (n.layout !== undefined) chk(oneOf(n.layout, ['carousel','grid']), p + '.layout', 'carousel|grid'); optBool(n, 'compare', p); optBool(n, 'ranked', p);
      chk(isArr(n.products) && n.products.length >= 1 && n.products.length <= 10, p + '.products', '1-10 products'); provenanceNeeded(n, p);
      if (n.compare) chk((n.products || []).length >= 2, p + '.compare', 'compare needs >= 2 products');
      itemIds(n.products, p + '.products');
      (n.products || []).forEach((o, i) => { const q = `${p}.products[${i}]`;
        keys(o, ['id','name','brand','imageQuery','image','price','currency','priceNote','rating','reviews','badge','verdict','scores','specs','pros','cons','offers','url'], q);
        reqStr(o, 'name', 200, q); optStr(o, 'brand', 80, q); optRating(o, q);
        if (o.price !== undefined) chk(is(o.price, 'number') && o.price >= 0, q + '.price', 'number >= 0 (JSON number)');
        optStr(o, 'currency', 8, q); optStr(o, 'priceNote', 100, q); optStr(o, 'badge', 40, q); optStr(o, 'verdict', 160, q);
        if (o.scores !== undefined) { chk(isArr(o.scores) && o.scores.length >= 1 && o.scores.length <= 5, q + '.scores', '1-5 scores'); (isArr(o.scores) ? o.scores : []).forEach((sc, j) => { const qq = `${q}.scores[${j}]`; keys(sc, ['label','value'], qq); reqStr(sc, 'label', 40, qq); chk(is(sc.value, 'number') && sc.value >= 0 && sc.value <= 10, qq + '.value', 'number 0-10'); }); } optUrl(o, 'url', q); optUrl(o, 'image', q);
        if (o.imageQuery !== undefined) imgQuery(o.imageQuery, q + '.imageQuery');
        if (o.price !== undefined) chk(o.currency !== undefined, q + '.currency', 'price needs a currency');
        strList(o, 'pros', 6, 200, q); strList(o, 'cons', 6, 200, q);
        if (o.specs !== undefined) { chk(isArr(o.specs) && o.specs.length >= 1 && o.specs.length <= 6, q + '.specs', '1-6 specs'); (o.specs || []).forEach((sp, j) => { keys(sp, ['label','value'], `${q}.specs[${j}]`); reqStr(sp, 'label', 60, `${q}.specs[${j}]`); reqStr(sp, 'value', 120, `${q}.specs[${j}]`); }); }
        if (o.offers !== undefined) { chk(isArr(o.offers) && o.offers.length >= 1 && o.offers.length <= 4, q + '.offers', '1-4 offers'); (o.offers || []).forEach((of, j) => { const r = `${q}.offers[${j}]`; keys(of, ['merchant','price','url'], r); reqStr(of, 'merchant', 80, r); chk(is(of.url, 'string') && HTTPS_URL.test(of.url), r + '.url', 'https URL from a tool'); if (of.price !== undefined) chk((is(of.price, 'number') && of.price >= 0) || (is(of.price, 'string') && of.price.trim() && of.price.length <= 40 && !/^\s*[\d.,]+\s*$/.test(of.price)), r + '.price', 'number >= 0 or display string'); }); } });
      break; }
    case 'guide': {
      keys(n, ['type','id','title','intro','steps','stuckLabel'], p);
      reqStr(n, 'title', 200, p); optStr(n, 'intro', 1000, p); optStr(n, 'stuckLabel', 80, p);
      chk(isArr(n.steps) && n.steps.length >= 1 && n.steps.length <= 20, p + '.steps', '1-20 steps'); itemIds(n.steps, p + '.steps');
      (n.steps || []).forEach((o, i) => { const q = `${p}.steps[${i}]`; keys(o, ['id','title','body','imageQuery','tip','warning','seconds'], q);
        reqStr(o, 'title', 200, q); reqStr(o, 'body', 2000, q); optStr(o, 'tip', 500, q); optStr(o, 'warning', 500, q); optInt(o, 'seconds', 1, 86400, q);
        if (o.imageQuery !== undefined) imgQuery(o.imageQuery, q + '.imageQuery'); });
      break; }
    case 'workout': {
      keys(n, ['type','id','title','kind','warmup','exercises','cooldown'], p);
      reqStr(n, 'title', 200, p); if (n.kind !== undefined) chk(oneOf(n.kind, WORKOUT_KINDS), p + '.kind', WORKOUT_KINDS.join('|'));
      optStr(n, 'warmup', 500, p); optStr(n, 'cooldown', 500, p);
      chk(isArr(n.exercises) && n.exercises.length >= 1 && n.exercises.length <= 20, p + '.exercises', '1-20 exercises'); itemIds(n.exercises, p + '.exercises');
      (n.exercises || []).forEach((o, i) => { const q = `${p}.exercises[${i}]`; keys(o, ['id','name','sets','reps','seconds','weight','restSeconds','note','imageQuery'], q);
        reqStr(o, 'name', 150, q); optInt(o, 'sets', 1, 50, q); optInt(o, 'seconds', 1, 86400, q); optInt(o, 'restSeconds', 0, 3600, q); optStr(o, 'weight', 30, q); optStr(o, 'note', 300, q);
        if (o.reps !== undefined) chk((Number.isInteger(o.reps) && o.reps >= 1 && o.reps <= 1000) || (is(o.reps, 'string') && o.reps.trim() && o.reps.length <= 20 && !/^\d+$/.test(o.reps)), q + '.reps', 'integer 1..1000 or short string like "8-12"/"AMRAP"');
        chk(o.reps !== undefined || o.seconds !== undefined, q, 'give reps or seconds');
        if (o.imageQuery !== undefined) imgQuery(o.imageQuery, q + '.imageQuery'); });
      break; }
    case 'studyplan': {
      keys(n, ['type','id','title','goal','weeks'], p);
      reqStr(n, 'title', 200, p); optStr(n, 'goal', 500, p);
      chk(isArr(n.weeks) && n.weeks.length >= 1 && n.weeks.length <= 26, p + '.weeks', '1-26 weeks');
      const taskIds = new Set();
      (n.weeks || []).forEach((w, wi) => { const q = `${p}.weeks[${wi}]`; keys(w, ['label','days'], q); reqStr(w, 'label', 150, q);
        chk(isArr(w.days) && w.days.length >= 1 && w.days.length <= 14, q + '.days', '1-14 days');
        (w.days || []).forEach((d, di) => { const r = `${q}.days[${di}]`; keys(d, ['label','tasks'], r); reqStr(d, 'label', 60, r);
          chk(isArr(d.tasks) && d.tasks.length >= 1 && d.tasks.length <= 20, r + '.tasks', '1-20 tasks');
          (d.tasks || []).forEach((t, ti) => { const u = `${r}.tasks[${ti}]`; keys(t, ['id','text','minutes','kind'], u); reqStr(t, 'text', 300, u); optInt(t, 'minutes', 1, 1440, u);
            if (t.kind !== undefined) chk(oneOf(t.kind, STUDY_KINDS), u + '.kind', STUDY_KINDS.join('|'));
            if (t.id !== undefined) { chk(is(t.id, 'string') && /^[\w-]{1,40}$/.test(t.id) && !taskIds.has(t.id), u + '.id', 'short id, unique in the plan'); taskIds.add(t.id); } }); }); });
      break; }
    case 'vocab': {
      keys(n, ['type','id','title','from','to','items','mode'], p);
      optStr(n, 'title', 200, p); chk(LANG.test(n.from || '') && LANG.test(n.to || ''), p, 'from/to language codes (de en es pt-BR ja)'); chk(n.from !== n.to, p, 'from and to must differ');
      if (n.mode !== undefined) chk(oneOf(n.mode, ['cards','quiz','type']), p + '.mode', 'cards|quiz|type');
      chk(isArr(n.items) && n.items.length >= 1 && n.items.length <= 40, p + '.items', '1-40 items'); itemIds(n.items, p + '.items');
      (n.items || []).forEach((o, i) => { const q = `${p}.items[${i}]`; keys(o, ['id','term','translation','example','note','romanization'], q);
        reqStr(o, 'term', 200, q); reqStr(o, 'translation', 200, q); optStr(o, 'example', 300, q); optStr(o, 'note', 300, q); optStr(o, 'romanization', 200, q); });
      chk(new Set((n.items || []).map(o => o.term)).size === (n.items || []).length, p, 'duplicate terms');
      break; }
    case 'mindmap': {
      keys(n, ['type','id','title','root'], p); optStr(n, 'title', 200, p);
      let count = 0; const ids = new Set();
      const walk = (m, depth, q) => { if (!m || !is(m, 'object')) return errs.push(`${q}: node must be object`); count++;
        keys(m, ['id','label','note','children'], q); reqStr(m, 'label', 150, q); optStr(m, 'note', 600, q);
        if (m.id !== undefined) { chk(is(m.id, 'string') && /^[\w-]{1,40}$/.test(m.id) && !ids.has(m.id), q + '.id', 'short id, unique'); ids.add(m.id); }
        if (is(m.label, 'string')) ctx.mindLabels.add(m.label);
        if (m.children !== undefined) { chk(isArr(m.children) && m.children.length >= 1, q + '.children', 'non-empty array'); chk(depth < 4, q, 'depth > 4'); (m.children || []).forEach((c, i) => walk(c, depth + 1, `${q}.children[${i}]`)); } };
      chk(n.root && is(n.root, 'object'), p + '.root', 'missing'); if (n.root) walk(n.root, 0, p + '.root');
      chk(count <= 60, p, `too many nodes (${count} > 60)`);
      chk(n.root && isArr(n.root.children) && n.root.children.length >= 2, p + '.root.children', 'root needs >= 2 branches');
      break; }
  }
}
// root shape: the app tolerates envelopes/arrays/wrappers since 2026-10-12, but the skill contract is
// ONE node object with a top-level "type" per ```hui block - say exactly what is wrong.
const ENVELOPE_KEYS = ['blocks', 'nodes', 'components', 'children', 'elements', 'content', 'sections'];
const WRAPPER_KEYS = ['node', 'component', 'hui', 'ui', 'block', 'root', 'widget', 'element', 'data'];
function checkRoot(n, p) {
  if (isArr(n)) { errs.push(`${p}: top-level JSON array - put ONE node object per \`\`\`hui block (several nodes: separate blocks or a stack/card with children)`); n.forEach((c, i) => checkNode(c, `${p}[${i}]`)); return; }
  if (n && is(n, 'object') && n.type === undefined) {
    const env = ENVELOPE_KEYS.find((k) => isArr(n[k]));
    if (env) { errs.push(`${p}: document envelope {${Object.keys(n).join(',')}} - no "version"/"${env}" wrapper; the block IS the node: {"type":…} at top level`); n[env].forEach((c, i) => checkNode(c, `${p}.${env}[${i}]`)); return; }
    const w = WRAPPER_KEYS.find((k) => n[k] && is(n[k], 'object'));
    if (w) { errs.push(`${p}: wrapper {"${w}": …} - the block IS the node: {"type":…} at top level`); checkNode(n[w], `${p}.${w}`); return; }
    const t = Object.keys(n).find((k) => TYPES.includes(k));
    if (t) { errs.push(`${p}: missing "type" (found key "${t}") - write {"type":"${t}", …}`); return; }
  }
  checkNode(n, p);
}
// common field mix-ups → hint in the "unknown field" error
const FIELD_HINTS = { 'products.items': 'use "products"', 'products[].title': 'use "name"', 'places.items': 'use "places"', 'places[].title': 'use "name"',
  'paths.rows': 'use "items"', 'paths.options': 'use "items"', 'paths.paths': 'use "items"', 'paths.selectable': 'use "select"',
  'blocks.cols': 'use "columns"', 'blocks.groups': 'use "columns"', 'blocks.sides': 'use "columns"', 'blocks.items': 'put boxes into columns[].items', 'blocks.select': 'blocks is display-only', 'blocks.footnote': 'use "caption"', 'blocks.note': 'use "caption"',
  'diff.diffs': 'use "files"', 'diff.changes': 'use "files"', 'diff.diff': 'use "patch"', 'diff.text': 'use "patch"', 'diff.unified': 'use "patch"', 'diff.layout': 'use "view"', 'diff.select': 'diff is display-only',
  'terminal.cmd': 'use "command"', 'terminal.stdout': 'use "output"', 'terminal.stderr': 'use "output"', 'terminal.text': 'use "output"', 'terminal.result': 'use "output"', 'terminal.code': 'use "exitCode"', 'terminal.exit': 'use "exitCode"', 'terminal.duration': 'use "durationMs"', 'terminal.dir': 'use "cwd"',
  'changes.items': 'use "files"', 'changes.changes': 'use "files"', 'changes.diffs': 'use "files"', 'changes.diff': 'use "patch"', 'changes.select': 'changes is display-only' };
const FILE_STATUSES = ['added','modified','deleted','renamed'];
const TERMINAL_STATUSES = ['running','done','error'];
const FILE_HINTS = { file: 'use "path"', name: 'use "path"', filename: 'use "path"', old_path: 'use "oldPath"', from: 'use "oldPath"', added: 'use "additions"', removed: 'use "deletions"', adds: 'use "additions"', dels: 'use "deletions"', diff: 'use "patch"', lang: 'use "language"' };

// hunks: {oldStart, newStart, header?, lines[]}; every line starts with ' ', '+', '-' (or '\\' for "No newline at end of file")
function checkHunks(hs, p) {
  chk(isArr(hs) && hs.length >= 1, p, 'non-empty hunks array');
  (isArr(hs) ? hs : []).forEach((h, i) => { const q = `${p}[${i}]`;
    if (!h || !is(h, 'object') || isArr(h)) return errs.push(`${q}: hunk must be {oldStart, newStart, header?, lines}`);
    keys(h, ['oldStart','newStart','header','lines'], q);
    chk(Number.isInteger(h.oldStart) && h.oldStart >= 0, q + '.oldStart', 'integer >= 0'); chk(Number.isInteger(h.newStart) && h.newStart >= 0, q + '.newStart', 'integer >= 0');
    optStr(h, 'header', 200, q);
    chk(isArr(h.lines) && h.lines.length >= 1, q + '.lines', 'non-empty array of prefixed lines');
    (isArr(h.lines) ? h.lines : []).forEach((l, j) => { chk(is(l, 'string') && /^[ +\-\\]/.test(l), `${q}.lines[${j}]`, 'line must start with " ", "+", "-" (or "\\")'); }); });
}
// one file entry of diff.files / changes.files (changes: status required, counts; diff: status optional, before/after)
function checkFileEntry(f, q, inChanges) {
  if (!f || !is(f, 'object') || isArr(f)) return errs.push(`${q}: file must be object`);
  const allowed = ['path','oldPath','status','binary','hunks','patch', ...(inChanges ? ['additions','deletions','byAgent'] : ['language','before','after'])];
  for (const k of Object.keys(f)) if (!allowed.includes(k)) errs.push(`${q}.${k}: unknown field${FILE_HINTS[k] ? ' (' + FILE_HINTS[k] + ')' : ''}`);
  reqStr(f, 'path', 300, q); optStr(f, 'oldPath', 300, q); optStr(f, 'language', 30, q); optBool(f, 'binary', q); optBool(f, 'byAgent', q);
  if (inChanges) chk(f.status !== undefined, q + '.status', 'missing');
  if (f.status !== undefined) chk(FILE_STATUSES.includes(f.status), q + '.status', 'bad status ' + f.status + ' (' + FILE_STATUSES.join('|') + ')');
  if (f.oldPath !== undefined) chk(f.status === 'renamed', q + '.oldPath', 'oldPath only with status "renamed"');
  if (f.hunks !== undefined) checkHunks(f.hunks, q + '.hunks');
  optStr(f, 'patch', 400000, q);
  for (const k of ['additions','deletions']) if (f[k] !== undefined) chk(Number.isInteger(f[k]) && f[k] >= 0, `${q}.${k}`, 'integer >= 0');
  if (!inChanges) {
    chk((f.before !== undefined) === (f.after !== undefined), q, 'before and after go together');
    if (f.before !== undefined) { chk(is(f.before, 'string') && is(f.after, 'string'), q + '.before', 'strings (whole old / new text)'); }
    chk(f.hunks !== undefined || f.patch !== undefined || f.before !== undefined || f.binary === true, q, 'file needs hunks, patch or before+after');
  }
}
// diff: display-only; `patch` (unified text) or `files`
function checkDiff(n, p) {
  keys(n, ['type','id','title','patch','files','view'], p); optStr(n, 'title', 200, p); optStr(n, 'patch', 800000, p);
  if (n.view !== undefined) chk(oneOf(n.view, ['unified','split']), p + '.view', 'unified|split');
  const files = isArr(n.files) ? n.files : [n.diffs, n.changes].find(isArr);
  chk(n.patch !== undefined || isArr(n.files), p, 'diff needs "patch" (unified text) or "files"');
  if (n.files !== undefined) chk(isArr(n.files) && n.files.length >= 1 && n.files.length <= 200, p + '.files', '1-200 files');
  (files || []).forEach((f, i) => checkFileEntry(f, `${p}.files[${i}]`, false));
}
// terminal: display-only; command and/or raw output
function checkTerminal(n, p) {
  keys(n, ['type','id','title','command','cwd','output','outputStart','truncated','exitCode','durationMs','status'], p);
  optStr(n, 'title', 200, p); optStr(n, 'command', 4000, p); optStr(n, 'cwd', 300, p);
  if (n.output !== undefined) chk(is(n.output, 'string'), p + '.output', 'string (raw output, ANSI escapes ok)');
  chk(n.command !== undefined || (is(n.output, 'string') && n.output.length > 0), p, 'terminal needs command or output');
  if (n.exitCode !== undefined) chk(Number.isInteger(n.exitCode), p + '.exitCode', 'integer');
  if (n.durationMs !== undefined) chk(is(n.durationMs, 'number') && Number.isFinite(n.durationMs) && n.durationMs >= 0, p + '.durationMs', 'number >= 0 (milliseconds)');
  if (n.status !== undefined) chk(TERMINAL_STATUSES.includes(n.status), p + '.status', 'bad status ' + n.status + ' (' + TERMINAL_STATUSES.join('|') + ')');
}
// changes: files an agent turn touched; needs an id (per-file "viewed" state), display-only
function checkChanges(n, p) {
  keys(n, ['type','id','title','summary','agent','files','patch'], p); optStr(n, 'title', 200, p); optStr(n, 'summary', 200, p); optStr(n, 'agent', 40, p); optStr(n, 'patch', 800000, p);
  if (is(n.summary, 'string')) chk(!/\n/.test(n.summary), p + '.summary', 'one line');
  const files = isArr(n.files) ? n.files : [n.items, n.changes, n.diffs].find(isArr);
  chk(isArr(n.files) && n.files.length >= 1 && n.files.length <= 200, p + '.files', '1-200 files');
  (files || []).forEach((f, i) => checkFileEntry(f, `${p}.files[${i}]`, true));
}
const PATH_ITEM_HINTS = { steps: 'use "path"', nodes: 'use "path"', chain: 'use "path"', flow: 'use "path"', label: 'use "title"', name: 'use "title"', description: 'use "note"', verdict: 'use "badge"', tone: 'put it into badge: {text, tone}' };

// paths: 2-6 rows (title, verdict badge, 1-6 node chain, one note line); select:true needs an id and counts as an input node
function checkPaths(n, p) {
  keys(n, ['type','id','title','items','basis','source','select'], p); optStr(n, 'title', 200, p); optBool(n, 'select', p);
  if (n.select === true) chk(is(n.id, 'string') && /^[\w-]{1,40}$/.test(n.id), p + '.id', 'select needs a short id (the reply is [paths:<id>] <title>)');
  chk(isArr(n.items) && n.items.length >= 2 && n.items.length <= 6, p + '.items', '2-6 items'); itemIds(n.items, p + '.items');
  const titles = new Set();
  // rows under a wrong key (options/rows/paths) are still checked, so every mistake is reported at once
  (isArr(n.items) ? n.items : [n.options, n.rows, n.paths].find(isArr) || []).forEach((it, i) => {
    const q = `${p}.items[${i}]`;
    if (!it || !is(it, 'object') || isArr(it)) return errs.push(`${q}: item must be object`);
    for (const k of Object.keys(it)) if (!['id','title','badge','path','note'].includes(k)) errs.push(`${q}.${k}: unknown field${PATH_ITEM_HINTS[k] ? ' (' + PATH_ITEM_HINTS[k] + ')' : ''}`);
    reqStr(it, 'title', 60, q); if (is(it.title, 'string')) titles.add(it.title);
    if (it.badge !== undefined) {
      chk(it.badge && is(it.badge, 'object') && !isArr(it.badge), q + '.badge', '{text, tone?} object');
      if (it.badge && is(it.badge, 'object')) { keys(it.badge, ['text','tone'], q + '.badge'); reqStr(it.badge, 'text', 24, q + '.badge'); if (it.badge.tone !== undefined) chk(PATH_TONES.includes(it.badge.tone), q + '.badge.tone', 'bad tone ' + it.badge.tone + ' (neutral|good|warn|bad)'); }
    }
    chk(isArr(it.path) && it.path.length >= 1 && it.path.length <= 6, q + '.path', '1-6 nodes');
    (isArr(it.path) ? it.path : []).forEach((s, j) => { const r = `${q}.path[${j}]`;
      if (!s || !is(s, 'object') || isArr(s)) return errs.push(`${r}: node must be {label, icon?, detail?}`);
      keys(s, ['label','icon','detail'], r); reqStr(s, 'label', 24, r); optStr(s, 'detail', 40, r);
      if (s.icon !== undefined) chk(PATH_ICONS.includes(s.icon), r + '.icon', 'unknown icon ' + s.icon + ' (' + PATH_ICONS.join(' ') + ')'); });
    optStr(it, 'note', 110, q); if (is(it.note, 'string')) chk(!/\n/.test(it.note), q + '.note', 'one line');
  });
  if (is(n.id, 'string')) ctx.pathTitles.set(n.id, titles);
}

const BLOCK_COLUMN_HINTS = { boxes: 'use "items"', nodes: 'use "items"', children: 'use "items"', shared: 'use "base"', layer: 'use "base"', foundation: 'use "base"', label: 'use "title"', perRow: 'use "grid"' };
const BLOCK_ITEM_HINTS = { subtitle: 'use "sub"', detail: 'use "sub"', note: 'use "sub"', title: 'use "label"', name: 'use "label"', text: 'use "label"', framed: 'use style:"framed"', outlined: 'use style:"framed"' };

// blocks: 1-3 columns (variants / tiers), each 1-12 short boxes in a grid of 1-3 per row and an optional shared base; display-only
function checkBlocks(n, p) {
  keys(n, ['type','id','title','columns','caption','basis','source'], p); optStr(n, 'title', 200, p);
  optStr(n, 'caption', 160, p); if (is(n.caption, 'string')) chk(!/\n/.test(n.caption), p + '.caption', 'one line');
  const cols = isArr(n.columns) ? n.columns : [n.cols, n.groups, n.sides].find(isArr) || [];
  chk(isArr(n.columns) && n.columns.length >= 1 && n.columns.length <= 3, p + '.columns', '1-3 columns');
  cols.forEach((c, i) => {
    const q = `${p}.columns[${i}]`;
    if (!c || !is(c, 'object') || isArr(c)) return errs.push(`${q}: column must be {title?, grid?, items, base?}`);
    for (const k of Object.keys(c)) if (!['title','grid','items','base'].includes(k)) errs.push(`${q}.${k}: unknown field${BLOCK_COLUMN_HINTS[k] ? ' (' + BLOCK_COLUMN_HINTS[k] + ')' : ''}`);
    optStr(c, 'title', 30, q);
    if (c.grid !== undefined) chk([1, 2, 3].includes(c.grid), q + '.grid', '1, 2 or 3 boxes per row');
    const items = isArr(c.items) ? c.items : [c.boxes, c.nodes, c.children].find(isArr) || [];
    chk(isArr(c.items) && c.items.length >= 1 && c.items.length <= 12, q + '.items', '1-12 boxes');
    items.forEach((b, j) => { const r = `${q}.items[${j}]`;
      if (!b || !is(b, 'object') || isArr(b)) return errs.push(`${r}: box must be {label, sub?, icon?, style?, tone?}`);
      for (const k of Object.keys(b)) if (!['label','sub','icon','style','tone'].includes(k)) errs.push(`${r}.${k}: unknown field${BLOCK_ITEM_HINTS[k] ? ' (' + BLOCK_ITEM_HINTS[k] + ')' : ''}`);
      reqStr(b, 'label', 24, r); optStr(b, 'sub', 30, r);
      if (b.icon !== undefined) chk(PATH_ICONS.includes(b.icon), r + '.icon', 'unknown icon ' + b.icon + ' (' + PATH_ICONS.join(' ') + ')');
      if (b.style !== undefined) chk(BLOCK_STYLES.includes(b.style), r + '.style', 'bad style ' + b.style + ' (soft|framed)');
      if (b.tone !== undefined) chk(PATH_TONES.includes(b.tone), r + '.tone', 'bad tone ' + b.tone + ' (neutral|good|warn|bad)'); });
    if (c.base !== undefined) {
      chk(c.base && is(c.base, 'object') && !isArr(c.base), q + '.base', '{label, sub?, icon?} object');
      if (c.base && is(c.base, 'object') && !isArr(c.base)) { keys(c.base, ['label','sub','icon'], q + '.base'); reqStr(c.base, 'label', 30, q + '.base'); optStr(c.base, 'sub', 30, q + '.base');
        if (c.base.icon !== undefined) chk(PATH_ICONS.includes(c.base.icon), q + '.base.icon', 'unknown icon ' + c.base.icon); }
    }
  });
}

function checkNode(n, p) {
  if (!n || !is(n, 'object') || isArr(n)) return errs.push(`${p}: node must be object`);
  if (!TYPES.includes(n.type)) return errs.push(`${p}: unknown type ${n.type}`);
  if (n.basis !== undefined) { chk(oneOf(n.type, ['table','chart','stats','compare','calc','map','weather','places','products','paths','blocks']), p + '.basis', 'basis only on data nodes'); chk(BASES.includes(n.basis), p + '.basis', 'bad basis ' + n.basis); }
  if (n.source !== undefined && n.type !== 'translation') str(n.source, p + '.source');
  if (ID_NODES.includes(n.type)) { chk(is(n.id, 'string') && /^[\w-]{1,40}$/.test(n.id || ''), p + '.id', 'interactive node needs a short id'); if (is(n.id, 'string')) { chk(!ctx.ids.has(n.id), p + '.id', 'duplicate id in message: ' + n.id); ctx.ids.set(n.id, n.type); } }
  else if (is(n.id, 'string')) ctx.ids.set(n.id, n.type === 'paths' && n.select === true ? 'paths-select' : n.type);
  const kids = (list) => { chk(isArr(list) && list.length > 0, p + '.children', 'non-empty array'); (list || []).forEach((c, i) => checkNode(c, `${p}.children[${i}]`)); };
  switch (n.type) {
    case 'card': kids(n.children); if (n.imageQuery !== undefined) imgQuery(n.imageQuery, p + '.imageQuery'); break;
    case 'stack': kids(n.children); if (n.direction) chk(oneOf(n.direction, ['vertical','horizontal']), p, 'direction'); if (n.gap) chk(oneOf(n.gap, ['s','m','l']), p, 'gap'); break;
    case 'text': str(n.text, p + '.text'); if (n.variant) chk(oneOf(n.variant, ['title','body','caption','mono']), p, 'variant'); break;
    case 'callout': chk(oneOf(n.tone, ['info','success','warning','danger']), p, 'tone'); str(n.text, p + '.text'); break;
    case 'stats': chk(isArr(n.items) && n.items.length >= 1 && n.items.length <= 6, p, 'items 1-6');
      (n.items || []).forEach((it, i) => { str(it.label, `${p}.items[${i}].label`); chk(is(it.value, 'string'), `${p}.items[${i}].value`, 'value must be string'); if (it.trend) chk(oneOf(it.trend, ['up','down','flat']), p, 'trend'); }); break;
    case 'table': chk(isArr(n.columns) && n.columns.length >= 1 && n.columns.length <= 12, p, 'columns 1-12');
      chk(isArr(n.rows) && n.rows.length <= 200, p, 'rows <= 200');
      (n.rows || []).forEach((r, i) => { chk(isArr(r) && r.length === n.columns.length, `${p}.rows[${i}]`, 'row length != columns'); (r || []).forEach(c => chk(c === null || is(c, 'string') || is(c, 'number'), `${p}.rows[${i}]`, 'cell type')); }); break;
    case 'chart': chk(oneOf(n.kind, CHART_KINDS), p, 'kind ' + n.kind); chk(isArr(n.series) && n.series.length >= 1, p, 'series');
      if (oneOf(n.kind, ['pie','donut'])) chk(n.series.length === 1, p, 'pie/donut needs exactly one series');
      for (const k of ['min','max','target']) if (n[k] !== undefined) chk(is(n[k], 'number') && Number.isFinite(n[k]), p + '.' + k, 'number');
      (n.series || []).forEach((s, i) => { str(s.name, `${p}.series[${i}].name`); chk(isArr(s.data) && s.data.length <= 60, `${p}.series[${i}].data`, 'array <= 60');
        (s.data || []).forEach((d, j) => { const q = `${p}.series[${i}].data[${j}]`; chk(is(d.x, 'string') || is(d.x, 'number'), q + '.x', 'x'); chk(is(d.y, 'number') && Number.isFinite(d.y), q + '.y', 'y must be number');
          if (n.kind === 'scatter') chk(is(d.x, 'number'), q + '.x', 'scatter x must be a number');
          if (n.kind === 'heatmap' && d.y2 === undefined) chk(/^\d{4}-\d{2}-\d{2}$/.test(d.x), q + '.x', 'calendar heatmap x must be an ISO date (or give y2 for a matrix)');
          if (d.total !== undefined) chk(n.kind === 'waterfall' && is(d.total, 'boolean'), q + '.total', 'boolean, waterfall only'); }); });
      if (n.kind === 'gauge') { chk(n.series.length === 1 && (n.series[0].data || []).length === 1, p, 'gauge: ONE series with ONE point');
        const v = n.series[0]?.data?.[0]?.y, mn = n.min ?? 0, mx = n.max ?? 100; chk(mx > mn, p, 'gauge max > min'); chk(v >= mn && v <= mx, p, 'gauge value outside min..max'); if (n.target !== undefined) chk(n.target >= mn && n.target <= mx, p + '.target', 'target outside min..max'); }
      if (n.kind === 'radar') { const ax = new Set(); n.series.forEach(s => (s.data || []).forEach(d => ax.add(d.x))); chk(ax.size >= 3 && ax.size <= 8, p, 'radar needs 3-8 axes'); n.series.forEach((s, i) => chk((s.data || []).length === ax.size, `${p}.series[${i}]`, 'every radar series covers every axis')); if (n.max !== undefined) n.series.forEach(s => (s.data || []).forEach(d => chk(d.y <= n.max, p, 'radar value above max'))); }
      if (n.kind === 'stacked') chk(n.series.length >= 2, p, 'stacked needs >= 2 series');
      if (n.kind === 'waterfall') chk(n.series.length === 1, p, 'waterfall: one series'); break;
    case 'list': chk(isArr(n.items), p, 'items'); (n.items || []).forEach((it, i) => { str(it.title, `${p}.items[${i}].title`); imgQuery(it.imageQuery, `${p}.items[${i}].imageQuery`, false); }); if (n.style) chk(oneOf(n.style, ['bullet','number','check']), p, 'style'); break;
    case 'steps': chk(isArr(n.items) && n.items.length, p, 'items'); (n.items || []).forEach((it, i) => { str(it.title, `${p}.items[${i}].title`); imgQuery(it.imageQuery, `${p}.items[${i}].imageQuery`, false); }); if (n.current !== undefined) chk(Number.isInteger(n.current) && n.current >= 0 && n.current < n.items.length, p, 'current out of range'); break;
    case 'timeline': chk(isArr(n.items) && n.items.length, p, 'items'); (n.items || []).forEach((it, i) => { str(it.time, `${p}.items[${i}].time`); str(it.title, `${p}.items[${i}].title`); imgQuery(it.imageQuery, `${p}.items[${i}].imageQuery`, false); }); break;
    case 'compare': chk(isArr(n.columns) && n.columns.length >= 2 && n.columns.length <= 4, p, 'columns 2-4'); (n.columns || []).forEach((c, i) => { str(c.title, `${p}.columns[${i}].title`); chk(isArr(c.items) && c.items.every(x => is(x, 'string')), `${p}.columns[${i}].items`, 'string[]'); imgQuery(c.imageQuery, `${p}.columns[${i}].imageQuery`, false); }); break;
    case 'image':
      chk((n.url === undefined) !== (n.query === undefined), p, 'image needs exactly one of query | url');
      if (n.url !== undefined) { chk(/^https:\/\//.test(n.url || ''), p + '.url', 'https url'); imageCount++; }
      else imgQuery(n.query, p + '.query');
      if (n.lang !== undefined) chk(/^[a-z]{2,3}$/.test(n.lang), p + '.lang', 'wiki language code');
      if (n.source !== undefined && n.type === 'image') { chk(n.source === 'web', p + '.source', "image.source must be 'web'"); chk(n.query !== undefined, p + '.source', 'source web needs a query'); } break;
    case 'gallery':
      chk(isArr(n.items) && n.items.length >= 2 && n.items.length <= 6, p, 'items 2-6');
      (n.items || []).forEach((it, i) => { const q = `${p}.items[${i}]`;
        chk((it.url === undefined) !== (it.query === undefined), q, 'needs exactly one of query | url');
        if (it.url !== undefined) { chk(/^https:\/\//.test(it.url || ''), q + '.url', 'https url'); imageCount++; } else imgQuery(it.query, q + '.query');
        if (it.caption !== undefined) str(it.caption, q + '.caption');
        if (it.source !== undefined) { chk(it.source === 'web' && it.query !== undefined, q + '.source', "only 'web' on a query item"); chk(/\s/.test(it.query || ''), q + '.query', 'web queries must be precise (several words)'); chk(it.caption, q + '.caption', 'web image items need a caption saying what is shown'); } });
      if (n.aspect !== undefined) chk(is(n.aspect, 'number') && n.aspect > 0, p + '.aspect', 'positive number'); break;
    case 'progress': str(n.label, p + '.label'); chk(is(n.value, 'number'), p + '.value', 'number'); break;
    case 'code': str(n.code, p + '.code'); break;
    case 'buttons': chk(isArr(n.items) && n.items.length, p, 'items'); (n.items || []).forEach((b, i) => { str(b.label, `${p}.items[${i}].label`); checkAction(b.action, `${p}.items[${i}].action`); }); break;
    case 'suggestions': chk(isArr(n.items) && n.items.length >= 1 && n.items.length <= 4 && n.items.every(x => is(x, 'string')), p, 'items 1-4 strings'); break;
    case 'form': str(n.id, p + '.id'); str(n.submit && n.submit.label, p + '.submit.label'); chk(isArr(n.fields) && n.fields.length, p, 'fields');
      (n.fields || []).forEach((f, i) => { const q = `${p}.fields[${i}]`; str(f.name, q + '.name'); str(f.label, q + '.label'); chk(oneOf(f.kind, ['text','number','slider','select','toggle','date']), q, 'kind');
        if (f.kind === 'select') chk(isArr(f.options) && f.options.length, q, 'select needs options'); if (f.kind === 'slider') chk(is(f.min, 'number') && is(f.max, 'number'), q, 'slider needs min/max'); }); break;
    case 'choice': chk(isArr(n.options) && n.options.length >= 2 && n.options.length <= 6, p + '.options', '2-6 options');
      if (n.question !== undefined) str(n.question, p + '.question');
      (n.options || []).forEach((o, i) => { const q = `${p}.options[${i}]`; str(o.label, q + '.label'); chk(o.label === undefined || o.label.length <= 60, q + '.label', 'label <= 60 chars'); if (o.description !== undefined) str(o.description, q + '.description'); if (o.icon !== undefined) chk(is(o.icon, 'string') && o.icon.length <= 8, q + '.icon', 'emoji'); if (o.imageQuery !== undefined) imgQuery(o.imageQuery, q + '.imageQuery'); });
      chk(new Set((n.options || []).map(o => o.label)).size === (n.options || []).length, p, 'duplicate option labels');
      if (n.multiple) { const mn = n.min ?? 1, mx = n.max ?? n.options.length; chk(mn >= 0 && mx >= mn && mx <= n.options.length, p, 'min/max out of range'); }
      else chk(n.min === undefined && n.max === undefined, p, 'min/max only with multiple'); break;
    case 'checklist': chk(n.kind === undefined || oneOf(n.kind, ['shopping','todo','packing','generic']), p + '.kind', 'kind'); chk(n.groupBy === undefined || oneOf(n.groupBy, ['category','none']), p + '.groupBy', 'groupBy');
      chk(isArr(n.items) && n.items.length >= 1 && n.items.length <= 100, p + '.items', '1-100 items');
      { const seen = new Set(); (n.items || []).forEach((it, i) => { const q = `${p}.items[${i}]`; str(it.text, q + '.text'); chk(!it.text || it.text.length <= 80, q + '.text', 'short item text (<= 80)');
        if (it.qty !== undefined) chk((is(it.qty, 'number') && it.qty > 0) || is(it.qty, 'string'), q + '.qty', 'number or string'); if (it.unit !== undefined) { str(it.unit, q + '.unit'); chk(it.qty !== undefined, q + '.unit', 'unit without qty'); }
        if (it.checked !== undefined) chk(is(it.checked, 'boolean'), q + '.checked', 'boolean'); if (it.category !== undefined) str(it.category, q + '.category'); if (it.note !== undefined) str(it.note, q + '.note');
        if (it.id !== undefined) { chk(!seen.has(it.id), q + '.id', 'duplicate item id'); seen.add(it.id); } });
        if (n.groupBy === 'category') chk((n.items || []).every(it => it.category), p, 'groupBy category needs a category on every item'); } break;
    case 'calc': checkCalc(n, p); break;
    case 'map': chk(isArr(n.markers) && n.markers.length >= 1 && n.markers.length <= 30, p + '.markers', '1-30 markers');
      chk(n.basis !== undefined || n.source !== undefined, p, 'map should carry basis (coordinates are approximate) or source');
      (n.markers || []).forEach((m, i) => { const q = `${p}.markers[${i}]`; chk(is(m.lat, 'number') && m.lat >= -90 && m.lat <= 90, q + '.lat', '-90..90'); chk(is(m.lng, 'number') && m.lng >= -180 && m.lng <= 180, q + '.lng', '-180..180'); chk(!(m.lat === 0 && m.lng === 0), q, 'null island (0,0) looks invented'); str(m.title, q + '.title'); if (m.number !== undefined) chk(Number.isInteger(m.number), q + '.number', 'integer'); if (m.imageQuery !== undefined) imgQuery(m.imageQuery, q + '.imageQuery'); });
      for (const k of ['route','animate']) if (n[k] !== undefined) chk(is(n[k], 'boolean'), p + '.' + k, 'boolean'); break;
    case 'recipe': str(n.title, p + '.title'); chk(is(n.servings, 'number') && n.servings > 0, p + '.servings', 'positive number');
      if (n.imageQuery !== undefined) imgQuery(n.imageQuery, p + '.imageQuery');
      if (n.time) for (const k of Object.keys(n.time)) chk(Number.isInteger(n.time[k]) && n.time[k] >= 0, p + '.time.' + k, 'minutes (integer)');
      chk(isArr(n.ingredients) && n.ingredients.length >= 1, p + '.ingredients', 'non-empty'); (n.ingredients || []).forEach((g, i) => { const q = `${p}.ingredients[${i}]`; str(g.item, q + '.item'); if (g.qty !== undefined) chk(is(g.qty, 'number') && g.qty > 0, q + '.qty', 'positive NUMBER (scaling)'); if (g.unit !== undefined) chk(is(g.unit, 'string') && g.qty !== undefined, q + '.unit', 'unit needs qty'); });
      chk(isArr(n.steps) && n.steps.length >= 1, p + '.steps', 'non-empty'); (n.steps || []).forEach((s, i) => { const q = `${p}.steps[${i}]`; str(s.text, q + '.text'); if (s.timerSeconds !== undefined) chk(Number.isInteger(s.timerSeconds) && s.timerSeconds >= 1 && s.timerSeconds <= 86400, q + '.timerSeconds', 'integer 1..86400'); });
      if (n.tips !== undefined) chk(isArr(n.tips) && n.tips.every(x => is(x, 'string')), p + '.tips', 'string[]'); break;
    case 'tabs': chk(isArr(n.tabs) && n.tabs.length >= 2 && n.tabs.length <= 6, p + '.tabs', '2-6 tabs'); (n.tabs || []).forEach((t, i) => { str(t.label, `${p}.tabs[${i}].label`); chk(isArr(t.children) && t.children.length > 0, `${p}.tabs[${i}].children`, 'non-empty'); (t.children || []).forEach((c, j) => checkNode(c, `${p}.tabs[${i}].children[${j}]`)); }); break;
    case 'accordion': chk(isArr(n.items) && n.items.length >= 1, p + '.items', 'items'); (n.items || []).forEach((t, i) => { str(t.title, `${p}.items[${i}].title`); chk(isArr(t.children) && t.children.length > 0, `${p}.items[${i}].children`, 'non-empty'); (t.children || []).forEach((c, j) => checkNode(c, `${p}.items[${i}].children[${j}]`)); });
      if (n.open !== undefined) chk(Number.isInteger(n.open) && n.open >= 0 && n.open < n.items.length, p + '.open', 'index in range'); break;
    case 'quiz': chk(isArr(n.questions) && n.questions.length >= 1 && n.questions.length <= 12, p + '.questions', '1-12 questions');
      (n.questions || []).forEach((qn, i) => { const q = `${p}.questions[${i}]`; str(qn.q, q + '.q'); chk(isArr(qn.options) && qn.options.length >= 2 && qn.options.length <= 6 && qn.options.every(x => is(x, 'string')), q + '.options', '2-6 strings');
        const inRange = (a) => Number.isInteger(a) && a >= 0 && a < (qn.options || []).length;
        chk(isArr(qn.answer) ? qn.answer.length >= 1 && qn.answer.every(inRange) : inRange(qn.answer), q + '.answer', '0-based option index (or array of indices) within options'); if (qn.explanation !== undefined) str(qn.explanation, q + '.explanation'); }); break;
    case 'flashcards': chk(isArr(n.cards) && n.cards.length >= 1 && n.cards.length <= 40, p + '.cards', '1-40 cards'); (n.cards || []).forEach((c, i) => { str(c.front, `${p}.cards[${i}].front`); str(c.back, `${p}.cards[${i}].back`); }); break;
    case 'sources': chk(isArr(n.items) && n.items.length >= 1, p + '.items', 'items'); (n.items || []).forEach((s, i) => { const q = `${p}.items[${i}]`; str(s.title, q + '.title'); chk(/^https:\/\/[^\s]+\.[^\s]+/.test(s.url || ''), q + '.url', 'https url (must come from a tool/user)'); if (s.snippet !== undefined) str(s.snippet, q + '.snippet'); if (s.siteName !== undefined) str(s.siteName, q + '.siteName'); }); break;
    case 'timer': checkTimer(n, p); break;
    case 'slots': chk(isArr(n.slots) && n.slots.length >= 1 && n.slots.length <= 8, p + '.slots', '1-8 slots');
      (n.slots || []).forEach((s, i) => { const q = `${p}.slots[${i}]`; chk(ISO.test(s.start || ''), q + '.start', 'ISO 8601 local time'); if (s.end !== undefined) chk(ISO.test(s.end) && s.end > s.start, q + '.end', 'ISO and after start'); if (s.label !== undefined) str(s.label, q + '.label'); }); break;
    case 'translation': chk(n.source && is(n.source.text, 'string') && n.source.text.trim() && LANG.test(n.source.lang || ''), p + '.source', '{lang code, text}');
      chk(isArr(n.targets) && n.targets.length >= 1 && n.targets.length <= 4, p + '.targets', '1-4 targets');
      (n.targets || []).forEach((t, i) => { const q = `${p}.targets[${i}]`; chk(LANG.test(t.lang || ''), q + '.lang', 'language code'); str(t.text, q + '.text'); chk(t.lang !== n.source?.lang, q + '.lang', 'target equals source language'); if (t.romanization !== undefined) str(t.romanization, q + '.romanization'); });
      chk(new Set((n.targets || []).map(t => t.lang)).size === (n.targets || []).length, p, 'duplicate target languages'); if (n.note !== undefined) str(n.note, p + '.note'); break;
    case 'poll': str(n.question, p + '.question'); chk(isArr(n.options) && n.options.length >= 2 && n.options.length <= 8, p + '.options', '2-8 options');
      (n.options || []).forEach((o, i) => { str(o.label, `${p}.options[${i}].label`); if (o.emoji !== undefined) chk(is(o.emoji, 'string') && o.emoji.length <= 16, `${p}.options[${i}].emoji`, 'emoji'); });
      chk(new Set((n.options || []).map(o => o.label)).size === (n.options || []).length, p, 'duplicate option labels');
      if (n.voters !== undefined) chk(isArr(n.voters) && n.voters.length >= 1 && n.voters.length <= 12 && new Set(n.voters).size === n.voters.length && n.voters.every(v => is(v, 'string') && v.trim()), p + '.voters', '1-12 unique names');
      for (const k of ['multiple','allowAdd','anonymous']) if (n[k] !== undefined) chk(is(n[k], 'boolean'), p + '.' + k, 'boolean'); break;
    case 'agenda': chk(isArr(n.blocks) && n.blocks.length >= 1 && n.blocks.length <= 30, p + '.blocks', '1-30 blocks'); if (n.date !== undefined) chk(/^\d{4}-\d{2}-\d{2}$/.test(n.date), p + '.date', 'ISO date');
      { let prevEnd = ''; (n.blocks || []).forEach((b, i) => { const q = `${p}.blocks[${i}]`; chk(HM.test(b.start || ''), q + '.start', 'HH:MM'); chk(HM.test(b.end || '') && b.end > b.start, q + '.end', 'HH:MM and after start'); str(b.title, q + '.title');
        if (b.kind !== undefined) chk(oneOf(b.kind, AGENDA_KINDS), q + '.kind', 'kind'); chk(!prevEnd || b.start >= prevEnd, q, 'blocks must be sorted and not overlap'); prevEnd = b.end || prevEnd; }); } break;
    case 'weather': str(n.location, p + '.location'); chk(n.source !== undefined && n.basis === 'sourced', p, 'weather needs source + basis "sourced" (tool data only)'); if (n.unit !== undefined) chk(oneOf(n.unit, ['C','F']), p + '.unit', 'C|F');
      chk(n.current || n.hourly || n.daily, p, 'needs current, hourly or daily');
      if (n.current) { chk(is(n.current.temp, 'number'), p + '.current.temp', 'number'); chk(oneOf(n.current.condition, WEATHER_CONDITIONS), p + '.current.condition', 'condition'); }
      if (n.hourly !== undefined) { chk(isArr(n.hourly) && n.hourly.length <= 24, p + '.hourly', '<= 24'); (n.hourly || []).forEach((h, i) => { chk(is(h.temp, 'number') && oneOf(h.condition, WEATHER_CONDITIONS) && (HM.test(h.time || '') || ISO.test(h.time || '')), `${p}.hourly[${i}]`, 'time, temp, condition'); }); }
      if (n.daily !== undefined) { chk(isArr(n.daily) && n.daily.length <= 10, p + '.daily', '<= 10'); (n.daily || []).forEach((d, i) => { chk(/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && is(d.min, 'number') && is(d.max, 'number') && d.min <= d.max && oneOf(d.condition, WEATHER_CONDITIONS), `${p}.daily[${i}]`, 'date, min<=max, condition'); }); } break;
    case 'decision': chk(isArr(n.criteria) && n.criteria.length >= 2 && n.criteria.length <= 8, p + '.criteria', '2-8 criteria'); chk(isArr(n.options) && n.options.length >= 2 && n.options.length <= 6, p + '.options', '2-6 options');
      { const cids = new Set(); (n.criteria || []).forEach((c, i) => { const q = `${p}.criteria[${i}]`; str(c.label, q + '.label'); chk(is(c.id, 'string') && c.id, q + '.id', 'give every criterion an id'); cids.add(c.id); chk(is(c.weight, 'number') && c.weight >= 0 && c.weight <= 10, q + '.weight', '0..10'); });
        chk(cids.size === (n.criteria || []).length, p + '.criteria', 'duplicate criterion ids');
        (n.options || []).forEach((o, i) => { const q = `${p}.options[${i}]`; str(o.label, q + '.label'); chk(o.scores && is(o.scores, 'object'), q + '.scores', 'object keyed by criterion id');
          for (const [k, v] of Object.entries(o.scores || {})) { chk(cids.has(k), q + '.scores.' + k, 'unknown criterion id'); chk(is(v, 'number') && v >= 0 && v <= 10, q + '.scores.' + k, '0..10'); }
          chk(Object.keys(o.scores || {}).length === cids.size, q + '.scores', 'score every criterion'); }); } break;
    case 'rank': chk(isArr(n.items) && n.items.length >= 2 && n.items.length <= 10, p + '.items', '2-10 items'); (n.items || []).forEach((it, i) => str(it.label, `${p}.items[${i}].label`));
      chk(new Set((n.items || []).map(i => i.label)).size === (n.items || []).length, p, 'duplicate item labels'); break;
    case 'scale': str(n.question, p + '.question'); { const mn = n.min ?? 1, mx = n.max ?? 5; chk(is(mn, 'number') && is(mx, 'number') && mx > mn && mx - mn <= 100, p, 'min < max, range <= 100');
      if (n.style !== undefined) { chk(oneOf(n.style, ['slider','stars','emoji','segments']), p + '.style', 'style'); if (n.style !== 'slider') chk(mx - mn + 1 <= 10, p, 'stars/emoji/segments: <= 10 steps'); }
      if (n.emojis !== undefined) chk(isArr(n.emojis) && n.emojis.length <= 10, p + '.emojis', '<= 10'); } break;
    case 'confirm': str(n.title, p + '.title'); if (n.text !== undefined) str(n.text, p + '.text'); break;
    case 'paths': checkPaths(n, p); break;
    case 'blocks': checkBlocks(n, p); break;
    case 'diff': checkDiff(n, p); break;
    case 'terminal': checkTerminal(n, p); break;
    case 'changes': checkChanges(n, p); break;
    default: if (V4_TYPES.includes(n.type)) checkV4(n, p);
  }
}

// Same hosts as the runtime CSP (app/src/sandbox/shell.ts CDN_ORIGINS + IMAGE_ORIGINS; parity test in shell.test.ts)
const ALLOWED_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'tile.openstreetmap.de', '*.tile.opentopomap.org', 'upload.wikimedia.org'];
const hostAllowed = (h) => ALLOWED_HOSTS.some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
const VARS = ['--h-bg','--h-surface','--h-text','--h-muted','--h-accent','--h-border','--h-radius','--h-font'];
function checkHtml(h, p) {
  const bytes = Buffer.byteLength(h);
  chk(bytes < 15360, p, `size ${bytes} B >= 15 KB`);
  chk(!/<\s*(html|head|body)\b|<!doctype/i.test(h), p, 'must be a fragment (html/head/body/doctype)');
  for (const m of h.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    if (m[1] === 'www.w3.org') continue;
    chk(hostAllowed(m[1].toLowerCase()), p, 'host not in allow-list: ' + m[1]);
  }
  chk(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|eval)\s*\(|document\.cookie|alert\(|confirm\(/.test(h), p, 'forbidden API');
  chk(!/<form\b/i.test(h), p, '<form> not allowed');
  for (const m of h.matchAll(/var\((--[a-z-]+)/g)) chk(VARS.includes(m[1]), p, 'unknown css var ' + m[1]);
  const open = (h.match(/<script\b/gi) || []).length, close = (h.match(/<\/script>/gi) || []).length;
  chk(open === close, p, 'unbalanced <script>');
  chk(((h.match(/<style\b/gi) || []).length) === ((h.match(/<\/style>/gi) || []).length), p, 'unbalanced <style>');
  const firstScript = h.search(/<script\b/i), firstStyle = h.search(/<style\b/i);
  if (firstScript >= 0 && firstStyle >= 0) chk(firstStyle < firstScript, p, '<style> should come before <script>');
  if (/window\.hermes\.(send|copy|openUrl)/.test(h)) chk(/window\.hermes\s*\)?\s*&&|if\s*\(\s*window\.hermes|window\.hermes\s*&&/.test(h) || /c&&window\.hermes|&&window\.hermes/.test(h), p, 'guard window.hermes before use');
  // naive tag balance for common block tags
  for (const t of ['div', 'svg', 'g', 'button', 'label', 'p']) {
    const o = (h.replace(/<script[\s\S]*?<\/script>/gi, '').match(new RegExp('<' + t + '(\\s[^>]*)?>', 'gi')) || []).filter(x => !x.endsWith('/>')).length;
    const c = (h.match(new RegExp('</' + t + '>', 'gi')) || []).length;
    chk(o === c, p, `<${t}> open ${o} != close ${c}`);
  }
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(here).filter(f => /^\d+.*\.md$/.test(f)).sort().map(f => join(here, f));
let total = 0, blocksN = 0;
for (const f of files) validateFile(f);
// Regression cases: invalid/*.md hold real failures (anonymised) that MUST fail with the error
// named in their `<!-- expect: … -->` lines. Only checked in the default run (no file args).
let invalidN = 0;
if (!process.argv.slice(2).length) {
  const dir = join(here, 'invalid');
  for (const name of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const f = join(dir, name);
    const expects = [...readFileSync(f, 'utf8').matchAll(/<!-- expect: (.+?) -->/g)].map(m => m[1]);
    const before = errs.length;
    validateFile(f, true);
    const got = errs.splice(before);
    if (!expects.length) errs.push(`invalid/${name}: needs at least one <!-- expect: … --> line`);
    if (!got.length) errs.push(`invalid/${name}: expected to FAIL but passed`);
    for (const e of expects) if (!got.some(g => g.includes(e))) errs.push(`invalid/${name}: missing expected error "${e}" (got: ${got.join(' | ') || 'none'})`);
    invalidN++;
  }
}
function validateFile(f, quiet = false) {
  const text = readFileSync(f, 'utf8');
  const before = errs.length;
  const outer = [...text.matchAll(/^````markdown\n([\s\S]*?)\n````$/gm)].map(m => m[1]);
  if (!outer.length) errs.push(`${f}: no assistant output (\`\`\`\`markdown fence)`);
  let nb = 0;
  imageCount = 0;
  const fileMind = new Set();
  const filePaths = new Map(); // paths id -> row titles (a [paths:<id>] reply names one of them)
  const fileIds = new Map(); // id -> type over the whole conversation file (reply tags refer to earlier nodes)
  for (const body of outer) {
    ctx = { ids: new Map(), refs: [], summaryAt: [], mindLabels: new Set(), pathTitles: new Map() };
    // fence-balance: every ``` opening has a closing one
    const types = []; let srcCount = 0;
    const fences = (body.match(/^```/gm) || []).length;
    chk(fences % 2 === 0, f, 'unbalanced ``` fences');
    for (const m of body.matchAll(/^```(hui|hui-html|diff|patch|terminal)\n([\s\S]*?)\n```$/gm)) {
      nb++;
      const [, kind, src] = m;
      const where = `${f.split('/').pop()}#${nb}(${kind})`;
      if (kind === 'hui') {
        let node;
        try { node = JSON.parse(src); } catch (e) { errs.push(`${where}: invalid JSON: ${e.message}`); continue; }
        checkRoot(node, where);
        types.push(node.type); if (node.type === 'sources' && isArr(node.items)) srcCount = node.items.length;
        if (normalizeNode) {
          const nn = normalizeNode(node);
          chk(nn && (nn.type === node.type || !node || node.type === undefined), where, 'app normalizeNode dropped node');
        }
      } else if (kind === 'diff' || kind === 'patch') {
        // typed text fence: the app's unified diff parser must find >= 1 file with >= 1 hunk
        if (parseUnifiedDiff) { const fl = parseUnifiedDiff(src); chk(fl.length >= 1 && fl.some(x => x.hunks && x.hunks.length >= 1), where, `\`\`\`${kind} fence: app parser finds no file with a hunk (needs --- / +++ / @@ headers or +/- lines)`); }
        chk(/^@@ |^[+-](?![+-]{2} )/m.test(src), where, `\`\`\`${kind} fence has no @@ header and no +/- change line (not a diff)`);
        chk(!/^\s*\{/.test(src), where, `\`\`\`${kind} fence holds JSON - use plain unified diff text or a \`\`\`hui diff node`);
        // @@ counts must match the body (a wrong count makes a parser read the next file's --- / +++ as lines)
        for (const h of src.matchAll(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@.*\n((?:[ +\-\\].*(?:\n|$)|\n)*)/gm)) {
          const want = [h[1] === undefined ? 1 : +h[1], h[2] === undefined ? 1 : +h[2]];
          let o = 0, n = 0;
          for (const l of h[3].split('\n')) {
            if ((o >= want[0] && n >= want[1]) || /^(--- (a\/|\/dev\/null)|\+\+\+ (b\/|\/dev\/null)|diff --git )/.test(l)) break;
            if (l.startsWith('-')) o++; else if (l.startsWith('+')) n++; else if (!l.startsWith('\\')) { o++; n++; }
          }
          chk(o === want[0] && n === want[1], where, `\`\`\`${kind} fence: hunk "${h[0].split('\n')[0].slice(0, 40)}" counts ${want[0]}/${want[1]} lines but has ${o}/${n}`);
        }
      } else if (kind === 'terminal') {
        chk(src.trim().length > 0, where, 'empty ```terminal fence');
        chk(/^[$%>❯] \S/.test(src), where, '```terminal fence: first line is `$ <command>`');
        // the optional exit line must be the app's form, else it shows as output
        const last = src.trimEnd().split('\n').pop();
        if (/^\s*\[exit/i.test(last)) chk(/^\[exit -?\d+(, [\d.]+ ?(ms|s|min|m|h))?\]$/.test(last.trim()), where, '```terminal exit line: `[exit <code>]` or `[exit <code>, 4.2s]`');
      }
      else checkHtml(src, where);
    }
    for (const [id, t] of ctx.ids) fileIds.set(id, t);
    for (const l of ctx.mindLabels) fileMind.add(l);
    for (const [id, titles] of ctx.pathTitles) filePaths.set(id, titles);
    // v4: summary rules, footnotes, hui: entity links
    const prose = body.replace(/^```[\s\S]*?^```$/gm, '').trim();
    if (types.includes('summary')) {
      chk(types.filter(t => t === 'summary').length === 1, f, 'only one summary per answer');
      chk(types[0] === 'summary', f, 'summary must be the FIRST node of the answer');
      chk(prose.split(/\s+/).length >= 120, f, 'summary only for long answers (> ~120 words of text besides the blocks here; real rule: > ~250 words)');
    }
    const notes = [...prose.matchAll(/\[\^(\d+)\]/g)].map(m => Number(m[1]));
    if (notes.length) { chk(srcCount > 0, f, 'footnotes [^n] need a sources node in the same answer'); chk(notes.every(k => k >= 1 && k <= srcCount), f, `footnote number outside sources 1..${srcCount}`); }
    for (const m of prose.matchAll(/\[([^\]]+)\]\((hui:[^)\s]*)\)/g)) {
      const [, label, href] = m; const where = f.split('/').pop() + ` hui-link "${label}"`;
      const mm = /^hui:(place|date|tel|price)\?(.*)$/.exec(href); chk(!!mm, where, 'hui: kind must be place|date|tel|price with ?params'); if (!mm) continue;
      const q = new URLSearchParams(mm[2]); const get = (k) => q.get(k);
      if (mm[1] === 'place') chk(!!get('q'), where, 'place needs q');
      if (mm[1] === 'date') { chk(ISO.test(get('start') || ''), where, 'date needs ISO start'); if (get('end')) chk(ISO.test(get('end')) && get('end') >= get('start'), where, 'end ISO and not before start'); }
      if (mm[1] === 'tel') chk(PHONE.test(get('n') || ''), where, 'tel needs n (digits, optional +, URL-encode the +)');
      if (mm[1] === 'price') { chk(Number.isFinite(Number(get('v'))) && get('v') !== null && get('v') !== '', where, 'price needs numeric v'); }
    }
    for (const r of ctx.refs) chk(ctx.ids.has(r.id), r.where, `references unknown node id "${r.id}" in this message`);
    const inputs = [...ctx.ids.values()].filter(t => INPUT_NODES.includes(t)).length;
    chk(inputs <= 1, f, 'more than one input node (choice/slots/confirm/form) in one answer');
    // text outside blocks must exist (graceful degradation)
    const outside = body.replace(/^```[\s\S]*?^```$/gm, '').trim();
    chk(outside.length > 20, f, 'needs explanatory text outside blocks');
  }
  chk(imageCount <= MAX_IMAGES, f, `too many images (${imageCount} > ${MAX_IMAGES})`);
  // reply tags in user turns (`[choice:id] ...`) must point at a node of the matching type
  const TAG_TYPE = { guide: 'guide', workout: 'workout', studyplan: 'studyplan', vocab: 'vocab', products: 'products', form: 'form', choice: 'choice', checklist: 'checklist', calc: 'calc', quiz: 'quiz', slot: 'slots', confirm: 'confirm', poll: 'poll', agenda: 'agenda', decision: 'decision', rank: 'rank', scale: 'scale', paths: 'paths-select' };
  for (const m of text.matchAll(/^`\[(\w+):([\w-]+)\]([^`]*)`$/gm)) {
    const [, tag, id, rest] = m; const where = f.split('/').pop() + ` reply [${tag}:${id}]`;
    chk(tag in TAG_TYPE, where, 'unknown reply tag'); if (!(tag in TAG_TYPE)) continue;
    chk(fileIds.get(id) === TAG_TYPE[tag], where, `no earlier ${TAG_TYPE[tag]} node with id "${id}" in this example`);
    if (tag === 'confirm') chk(/^\s*(ja|nein)\s*$/.test(rest), where, 'confirm reply is "ja" or "nein"');
    if (tag === 'quiz') chk(/^\s*\d+\/\d+ richtig\s*$/.test(rest), where, 'quiz reply is "<n>/<m> richtig"');
    if (tag === 'poll') chk(/\(\d+ Stimmen?\)\s*$/.test(rest), where, 'poll reply ends with "(<n> Stimmen)"');
    if (tag === 'agenda') chk(/\d\d:\d\d–\d\d:\d\d /.test(rest), where, 'agenda reply lists HH:MM–HH:MM blocks');
    if (tag === 'decision') chk(/Gewinner: .+ · Gewichte:/.test(rest), where, 'decision reply: Gewinner … · Gewichte: …');
    if (tag === 'rank') chk(/^\s*1\. .+ · 2\. /.test(rest), where, 'rank reply: 1. A · 2. B …');
    if (tag === 'scale') chk(/^\s*\d+\/\d+/.test(rest), where, 'scale reply: <v>/<max>');
    if (tag === 'guide') chk(/^\s*(Fertig|Schritt \d+ \(„[^“]+“\): Ich hänge fest(?: – .+)?)\s*$/.test(rest), where, 'guide reply: "Fertig" or "Schritt <n> („<title>“): Ich hänge fest[ – <detail>]"');
    if (tag === 'workout') chk(/^\s*\d+\/\d+ Sätze( · \d+ min)?( · .+)?\s*$/.test(rest), where, 'workout reply: "<d>/<n> Sätze · <m> min · …"');
    if (tag === 'studyplan') chk(/Woche \d+: \d+\/\d+ erledigt/.test(rest), where, 'studyplan reply: "Woche <n>: <d>/<m> erledigt"');
    if (tag === 'vocab') chk(/^\s*\d+\/\d+ richtig( · schwierig: .+)?\s*$/.test(rest), where, 'vocab reply: "<d>/<n> richtig[ · schwierig: …]"');
    if (tag === 'products') chk(/^\s*Favorit: .+$/.test(rest), where, 'products reply: "Favorit: <name>"');
    if (tag === 'paths') chk((filePaths.get(id) || new Set()).has(rest.trim()), where, 'paths reply: "[paths:<id>] <title of one row>"');
    if (tag === 'checklist') chk(/erledigt:.*·.*offen:|offen:|erledigt:/.test(rest), where, 'checklist reply has erledigt:/offen:');
  }
  for (const m of text.matchAll(/^`\[mindmap\]([^`]*)`$/gm)) {
    const where = f.split('/').pop() + ' reply [mindmap]'; const mm = /^ Erkläre „([^“]+)“ genauer$/.exec(m[1]);
    chk(!!mm, where, 'mindmap reply: "[mindmap] Erkläre „<label>“ genauer"'); if (mm) chk(fileMind.has(mm[1]), where, `no node labelled "${mm[1]}" in an earlier mindmap`);
  }
  if (quiet) return;
  blocksN += nb; total++;
  console.log(`${errs.length === before ? 'ok  ' : 'FAIL'} ${f.split('/').pop()}  (${nb} blocks)`);
}
// ---- skill structure: SKILL.md stays slim, every `ref` it names exists, per-topic references stay small, example nodes parse ----
{
  const skillDir = resolve(here, '../hermes-ui');
  const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  // Our own budget, not a Hermes limit: SKILL.md is read via skill_view on every app turn (~1 token per 4 chars),
  // so every line costs on each turn. Detail belongs in references/.
  chk(skillMd.length <= 9000, 'SKILL.md', `over our per-turn budget (${skillMd.length} > 9000 chars; read via skill_view on every app turn); move detail into references/`);
  const refFiles = readdirSync(join(skillDir, 'references')).filter(n => n.endsWith('.md'));
  const refNames = new Set(refFiles.map(n => n.replace(/\.md$/, '')));
  const tableRefs = new Set();
  for (const m of skillMd.matchAll(/^\|[^\n]*\|\s*([\w, -]*?)\s*\|$/gm)) for (const r of m[1].split(',')) { const n = r.trim().split(' ')[0]; if (n && n !== 'ref' && !/^-+$/.test(n)) tableRefs.add(n); }
  for (const n of tableRefs) chk(refNames.has(n), 'SKILL.md', `routing table names reference "${n}" but references/${n}.md does not exist`);
  for (const n of ['products', 'places', 'guide-workout', 'learning', 'mindmap', 'paths', 'blocks', 'coding', 'ask', 'plan', 'research', 'calc-expressions']) chk(tableRefs.has(n), 'SKILL.md', `reference "${n}" is not routed from the table`);
  const ACTION_TYPES = ['send', 'open_url', 'copy', 'ask', 'submit', 'calendar', 'reminder', 'maps', 'call', 'email', 'sms', 'timer', 'add_to_list'];
  for (const n of refFiles) {
    const t = readFileSync(join(skillDir, 'references', n), 'utf8');
    if (n !== 'NOTICE.md') chk(t.length <= 7600, `references/${n}`, `reference too big (${t.length} > 7600 chars): split by topic`);
    if (n === 'html-widgets.md' || n === 'svg-diagrams.md' || n === 'NOTICE.md') continue;
    chk(!/skill_view|nodes-v\d|SKILL\.md "Replies"/.test(t), `references/${n}`, 'stale pointer (skill_view / nodes-vN / SKILL.md Replies)');
    for (const line of t.split('\n')) {
      if (!line.startsWith('{"type":"')) continue;
      let node; try { node = JSON.parse(line); } catch (e) { errs.push(`references/${n}: example is not valid JSON: ${e.message} (${line.slice(0, 60)}…)`); continue; }
      chk(TYPES.includes(node.type) || ACTION_TYPES.includes(node.type), `references/${n}`, `unknown node type "${node.type}" in example`);
    }
  }
  console.log(`skill: SKILL.md ${skillMd.length} chars, ${refFiles.length} references, routing table -> ${tableRefs.size} refs`);
}
if (errs.length) { console.error('\n' + errs.join('\n')); process.exit(1); }
console.log(`\nall ${total} files, ${blocksN} blocks valid` + (invalidN ? `; ${invalidN} invalid/ regression cases rejected as expected` : ''));
