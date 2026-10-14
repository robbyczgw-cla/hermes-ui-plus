/**
 * `guide` node model (pure): normalisation, progress, reply texts and a tiny markdown block split
 * for step bodies. Reply tags/keywords are PROTOCOL (German, not translated).
 */
import { oneLine } from '../a/replies.ts';
import { validSeconds } from './timerEngine.ts';

export const MAX_STEPS = 20;

export type GuideStep = {
  key: string;
  title: string;
  body: string;
  imageQuery?: string;
  tip?: string;
  warning?: string;
  seconds?: number;
};

export type GuideModel = { title: string; intro?: string; steps: GuideStep[]; stuckLabel?: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalizeGuide(node: Record<string, unknown>): GuideModel {
  const steps: GuideStep[] = [];
  const raw = Array.isArray(node.steps) ? node.steps : [];
  const used = new Set<string>();
  for (const s of raw) {
    if (steps.length >= MAX_STEPS) break;
    if (typeof s === 'string') {
      if (!s.trim()) continue;
      const key = uniq(`s${steps.length}`, used);
      steps.push({ key, title: oneLine(s).slice(0, 160), body: '' });
      continue;
    }
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const title = oneLine(str(o.title)).slice(0, 160);
    const body = str(o.body).slice(0, 4000);
    if (!title && !body) continue;
    const key = uniq(str(o.id) || `s${steps.length}`, used);
    const st: GuideStep = { key, title: title || oneLine(body).slice(0, 60), body: title ? body : '' };
    const iq = oneLine(str(o.imageQuery));
    if (iq) st.imageQuery = iq.slice(0, 120);
    const tip = str(o.tip);
    if (tip) st.tip = tip.slice(0, 600);
    const warning = str(o.warning);
    if (warning) st.warning = warning.slice(0, 600);
    const sec = validSeconds(o.seconds);
    if (sec) st.seconds = sec;
    steps.push(st);
  }
  const m: GuideModel = { title: oneLine(str(node.title)).slice(0, 160), steps };
  const intro = str(node.intro);
  if (intro) m.intro = intro.slice(0, 1200);
  const stuck = oneLine(str(node.stuckLabel));
  if (stuck) m.stuckLabel = stuck.slice(0, 60);
  return m;
}

function uniq(k: string, used: Set<string>): string {
  let key = k;
  for (let n = 2; used.has(key); n++) key = `${k}-${n}`;
  used.add(key);
  return key;
}

/** Done steps that still exist (ids from older stream states are ignored). */
export function doneCount(steps: readonly GuideStep[], done: readonly string[]): number {
  const set = new Set(done);
  return steps.reduce((n, s) => n + (set.has(s.key) ? 1 : 0), 0);
}

export function allDone(steps: readonly GuideStep[], done: readonly string[]): boolean {
  return steps.length > 0 && doneCount(steps, done) === steps.length;
}

/** First open step at/after `from` (wrapping), or -1 when all are done. */
export function nextOpen(steps: readonly GuideStep[], done: readonly string[], from = 0): number {
  const set = new Set(done);
  for (let k = 0; k < steps.length; k++) {
    const i = (from + k) % steps.length;
    if (!set.has(steps[i].key)) return i;
  }
  return -1;
}

export function toggleDone(done: readonly string[], key: string, on?: boolean): string[] {
  const has = done.includes(key);
  const want = on ?? !has;
  if (want === has) return done as string[];
  return want ? [...done, key] : done.filter((k) => k !== key);
}

export function clampStep(i: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(i) || 0));
}

/* ───────────── replies ───────────── */

const tag = (id: string) => `[guide:${oneLine(id) || 'guide'}]`;

/** `[guide:<id>] Schritt 3 („Titel“): Ich hänge fest – <detail>` (no detail → without the dash part). */
export function stuckReply(id: string, index: number, title: string, detail?: string): string {
  const d = detail ? oneLine(detail).slice(0, 500) : '';
  const t = oneLine(title).slice(0, 100);
  return `${tag(id)} Schritt ${index + 1}${t ? ` („${t}“)` : ''}: Ich hänge fest${d ? ` – ${d}` : ''}`;
}

/** `[guide:<id>] Fertig` */
export function finishReply(id: string): string {
  return `${tag(id)} Fertig`;
}

/* ───────────── step body (light markdown) ───────────── */

export type BodyBlock = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

/** Paragraphs + bullet/numbered lists; inline markdown stays (rendered by InlineText). */
export function bodyBlocks(md: string): BodyBlock[] {
  const out: BodyBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const text = (ul ?? ol)![1];
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else out.push({ kind, items: [text] });
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    para.push(h ? `**${h[1]}**` : line);
  }
  flush();
  return out;
}
