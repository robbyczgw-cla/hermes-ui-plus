/// <reference types="node" />
// Test harness (node:test): what a user SEES of one assistant answer, through the real code path, and what happens
// when they tap something.
//
//   const av = await loadAnswerView();
//   const v = await av.mountAnswer({ role: 'assistant', text, tools: [] }, { lang: 'de' });
//   v.text()             visible text of the whole answer, as drawn
//   v.segments()         per segment: kind, node type, fallback/error, its visible text, images, open skeletons
//   v.announcement       what the screen reader announces when the answer is ready
//   await v.tap('Abfahrt')   click the deepest element showing that text (bubbles to its Pressable), then settle
//   v.sent               what the answer asked the chat to send (form/choice/quiz/buttons actions), in order
//   await v.unmount()
//   await av.streamAnswer(msg, { chunks: 6 })   every streamed snapshot as the live answer draws it
//
// The text pipeline is the one `useAnswerText` in chat/MessageItem.tsx runs for a finished answer (interim notes →
// hidden tool markup → MEDIA tags → stream parser → sources), and each segment is drawn by the chat's own
// `SegmentView` (Markdown with task lists, HuiSegment with its fallback note and raw block, HTML widget), mounted with
// react-dom into testkit/miniDom.ts (effects, onLayout at phone width, state updates all run). answerView.test.ts keeps
// the pipeline list in step with MessageItem.tsx. Image lookups settle as "nothing found" (a default setup without an
// image-search key once the lookup gave up); answer-provided https URLs count as photos.
import { installMiniDom, domText, findAll, FakeEvent, type MiniElement, type MiniNode } from './miniDom.ts';
import { installWebRenderHooks } from './webRender.ts';
import type { Segment } from '../protocol/types.ts';

type Msg = { id?: string; role: 'assistant'; text: string; tools?: unknown[]; status?: string };
export type Lang = 'de' | 'en' | 'es';

export type SegmentView = {
  kind: Segment['kind'];
  /** node type of a ```hui block (after normalisation), null for markdown/html or a block without node */
  type: string | null;
  fallback: boolean;
  error: string | null;
  complete: boolean;
  /** the block's raw source (hui), for checks that compare with what the model sent */
  raw: string;
  text: string;
  images: number;
  /** loading placeholders (`hui-skeleton`) still drawn after settling */
  skeletons: number;
};

export type MountedAnswer = {
  text(): string;
  segments(): SegmentView[];
  announcement: string;
  /** the answer text after tool markup was hidden (what copy/share/read-aloud get) */
  shownText: string;
  /** console.error output while mounting/tapping (render crashes land here and in the visible text) */
  errors: string[];
  /** actions the answer handed to the chat (send / form submit / open_url …), in order */
  sent: { action: unknown; values?: unknown }[];
  tap(label: string | RegExp, o?: { nth?: number; segment?: number }): Promise<void>;
  /**
   * Open what a reader can open without changing anything: every tab, every accordion section, "show all rows". Returns
   * per segment the union of the text seen on the way (for content checks: nothing the model sent is unreachable).
   */
  explore(): Promise<string[]>;
  /** let `ms` of real time pass (undo windows: a single choice sends 1.5 s after the tap), then settle */
  wait(ms: number): Promise<void>;
  unmount(): Promise<void>;
};

type Mods = {
  React: typeof import('react');
  createRoot: (el: unknown, o?: Record<string, unknown>) => { render(n: unknown): void; unmount(): void };
  SegmentView: unknown;
  FixedI18nProvider: unknown;
  makeT: (lang: Lang, locale: string) => (k: string, v?: Record<string, unknown>) => string;
  splitProgressNotes: (m: unknown) => { answer: string };
  hideToolMarkup: (t: string, o: { streaming: boolean; notice: string }) => string;
  extractMedia: (t: string, streaming: boolean) => { text: string };
  advanceSegments: (prev: unknown, text: string, complete: boolean) => { segs: Segment[] };
  withCitationSources: (s: readonly Segment[]) => { segments: Segment[] };
  dedupeTranslations: (s: readonly Segment[]) => Segment[];
  withRetrievedSources: (s: readonly Segment[], tools: unknown) => Segment[];
  answerAnnouncement: (m: unknown, t: unknown) => string;
};

let mods: Mods | null = null;
const LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES' };
/** "Alle 15 Zeilen anzeigen" / "Show all 15 rows" / "Mostrar las 15 filas": ui.table.showAll of every language */
let SHOW_ALL = /^$/;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const REACT_DOM_CLIENT: string = 'react-dom/client';

async function load(): Promise<Mods> {
  if (mods) return mods;
  installMiniDom();
  installWebRenderHooks();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const [React, client, mi, i18n, core, notes, tm, media, pc, cit, dd, ws, ann, web] = await Promise.all([
    import('react'),
    // react-dom ships no types here (the app renders through react-native); only createRoot is used
    import(REACT_DOM_CLIENT),
    import('../chat/MessageItem.tsx'),
    import('../i18n/index.ts'),
    import('../i18n/core.ts'),
    import('../hermes/progressNotes.ts'),
    import('../chat/toolMarkup.ts'),
    import('../chat/mediaTags.ts'),
    import('../chat/parseCache.ts'),
    import('../chat/answers/citations.ts'),
    import('../chat/answers/dedupe.ts'),
    import('../chat/answers/webSources.ts'),
    import('../chat/answerAnnounce.ts'),
    import('../images/web.ts'),
  ]);
  for (const l of ['en', 'es'] as const) await core.loadDictionary(l);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  SHOW_ALL = new RegExp(`^(${(['de', 'en', 'es'] as const).map((l) => esc(core.dictionaries[l].ui.table.showAll).replace(esc('{n}'), '\\d+')).join('|')})$`);
  const images = web.combinedImages as unknown as Record<string, unknown>;
  images.peek = () => null;
  images.resolve = async () => null;
  mods = {
    React: React as never,
    createRoot: client.createRoot as never,
    SegmentView: (mi as Record<string, unknown>).SegmentView,
    FixedI18nProvider: (i18n as Record<string, unknown>).FixedI18nProvider,
    makeT: core.makeT as never,
    splitProgressNotes: notes.splitProgressNotes as never,
    hideToolMarkup: tm.hideToolMarkup,
    extractMedia: media.extractMedia as never,
    advanceSegments: pc.advanceSegments as never,
    withCitationSources: cit.withCitationSources as never,
    dedupeTranslations: dd.dedupeTranslations as never,
    withRetrievedSources: ws.withRetrievedSources as never,
    answerAnnouncement: ann.answerAnnouncement as never,
  };
  return mods;
}

/** Deepest elements whose own text matches `label` (a Pressable's label sits in a text child). */
function byText(root: MiniNode, label: string | RegExp): MiniElement[] {
  const deepest = (cands: MiniElement[]) => cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
  if (typeof label === 'string') {
    const exact = deepest(findAll(root, (el) => domText(el) === label.trim()));
    if (exact.length) return exact;
    return deepest(findAll(root, (el) => domText(el).includes(label)));
  }
  return deepest(findAll(root, (el) => label.test(domText(el))));
}

/** labels of every tab and accordion section in a node tree, in order */
function openables(node: unknown, out: string[] = [], depth = 0): string[] {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const x of node) openables(x, out, depth + 1);
    return out;
  }
  const n = node as Record<string, unknown>;
  if (n.type === 'tabs' && Array.isArray(n.tabs)) for (const t of n.tabs) if (t && typeof (t as { label?: unknown }).label === 'string') out.push((t as { label: string }).label);
  if (n.type === 'accordion' && Array.isArray(n.items)) for (const t of n.items) if (t && typeof (t as { title?: unknown }).title === 'string') out.push((t as { title: string }).title);
  for (const v of Object.values(n)) if (v && typeof v === 'object') openables(v, out, depth + 1);
  return out;
}

export async function loadAnswerView() {
  const m = await load();
  const { React } = m;
  const doc = (globalThis as unknown as { document: { body: MiniElement; createElement(t: string): MiniElement } }).document;

  const notice = (lang: Lang) => m.makeT(lang, LOCALE[lang])('chat.message.toolMarkupHidden');

  /** Segments of a finished answer: useAnswerText (chat/MessageItem.tsx), finished branch, default preferences. */
  function finishedSegments(message: { text: string; tools: unknown[] }, lang: Lang): { segs: Segment[]; shownText: string } {
    const split = m.splitProgressNotes({ ...message, role: 'assistant', status: 'done' });
    const shownText = m.hideToolMarkup(split ? split.answer : message.text, { streaming: false, notice: notice(lang) });
    const media = m.extractMedia(shownText, false);
    const raw = m.advanceSegments(null, media.text, true).segs;
    const cited = m.withCitationSources(m.dedupeTranslations(raw));
    return { segs: m.withRetrievedSources(cited.segments, message.tools), shownText };
  }

  async function mountSegments(segs: readonly Segment[], lang: Lang, live: boolean) {
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const sent: MountedAnswer['sent'] = [];
    const errors: string[] = [];
    const onAction = (action: unknown, values?: unknown) => {
      sent.push({ action, values });
      return true;
    };
    const tree = () =>
      React.createElement(
        m.FixedI18nProvider as never,
        { lang } as never,
        ...segs.map((seg, i) =>
          React.createElement('div', { key: i, 'data-seg': String(i) }, React.createElement(m.SegmentView as never, { seg, first: i === 0, live: live && i === segs.length - 1, onAction, route: null } as never)),
        ),
      );
    const report = (kind: string) => (e: unknown) => void errors.push(`${kind}: ${e instanceof Error ? e.message + (e.cause instanceof Error ? ` (cause: ${e.cause.message} ${e.cause.stack?.split("\n")[1]?.trim() ?? ""})` : "") : String(e)}`.slice(0, 500));
    const root = m.createRoot(host, { onRecoverableError: report('recoverable'), onUncaughtError: report('uncaught'), onCaughtError: report('caught') });
    const origError = console.error;
    const settle = async (fn?: () => void) => {
      console.error = (...a: unknown[]) => void errors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 300));
      try {
        await React.act(async () => {
          fn?.();
          await tick();
        });
        // ResizeObserver → measure (setTimeout 0) → onLayout → state → commit → new observers …: act flushes the
        // updates only when its callback ends, so a few rounds
        for (let i = 0; i < 4; i++) {
          await React.act(async () => {
            await tick();
            await tick();
          });
        }
      } finally {
        console.error = origError;
      }
    };
    await settle(() => root.render(tree()));
    const segments = (): SegmentView[] =>
      segs.map((seg, i) => {
        const el = findAll(host, (e) => e.getAttribute('data-seg') === String(i))[0];
        const hui = seg.kind === 'hui' ? seg : null;
        return {
          kind: seg.kind,
          type: hui?.node && typeof (hui.node as { type?: unknown }).type === 'string' ? (hui.node as { type: string }).type : null,
          fallback: !!hui?.fallback,
          error: hui?.error ?? null,
          complete: seg.kind === 'markdown' ? true : !!(seg as { complete?: boolean }).complete,
          raw: hui?.raw ?? '',
          text: el ? domText(el) : '',
          images: el ? findAll(el, (e) => e.tagName === 'IMG' || e.getAttribute('data-stub') === 'Image').length : 0,
          skeletons: el ? findAll(el, (e) => e.getAttribute('data-testid') === 'hui-skeleton').length : 0,
        };
      });
    return {
      host,
      sent,
      errors,
      segments,
      text: () => segments().map((s) => s.text).filter(Boolean).join('\n'),
      async tap(label: string | RegExp, o: { nth?: number; segment?: number } = {}) {
        const scope = o.segment === undefined ? host : findAll(host, (e) => e.getAttribute('data-seg') === String(o.segment))[0];
        const els = scope ? byText(scope, label) : [];
        const el = els[o.nth ?? 0];
        if (!el) throw new Error(`nothing shows ${String(label)} (visible: ${domText(scope ?? host).slice(0, 300)})`);
        await settle(() => el.dispatchEvent(new FakeEvent('click', { detail: 1 })));
      },
      async explore() {
        const seen = segments().map((x) => x.text);
        for (const [i, seg] of segs.entries()) {
          if (seg.kind !== 'hui' || !seg.node) continue;
          const scope = () => findAll(host, (e) => e.getAttribute('data-seg') === String(i))[0];
          const add = () => void (seen[i] += ' ' + domText(scope()));
          for (const label of openables(seg.node)) {
            const el = byText(scope(), label)[0];
            if (!el) continue;
            await settle(() => el.dispatchEvent(new FakeEvent('click', { detail: 1 })));
            add();
          }
          // collapsed long tables / lists: "Alle 15 Zeilen anzeigen" (the label of every language)
          for (let k = 0; k < 3; k++) {
            const more = byText(scope(), SHOW_ALL)[0];
            if (!more) break;
            await settle(() => more.dispatchEvent(new FakeEvent('click', { detail: 1 })));
            add();
          }
        }
        return seen;
      },
      async wait(ms: number) {
        await React.act(async () => {
          await new Promise<void>((r) => setTimeout(r, ms));
        });
        await settle();
      },
      async unmount() {
        await settle(() => root.unmount());
        host.remove();
      },
    };
  }

  /** A finished answer as the chat draws it. */
  async function mountAnswer(msg: Msg, o: { lang?: Lang } = {}): Promise<MountedAnswer> {
    const lang = o.lang ?? 'de';
    const message = { id: msg.id ?? 'a-test', role: 'assistant', text: msg.text, tools: msg.tools ?? [], status: msg.status ?? 'done', createdAt: 0 };
    const { segs, shownText } = finishedSegments(message, lang);
    const mounted = await mountSegments(segs, lang, false);
    const announcement = m.answerAnnouncement(message, m.makeT(lang, LOCALE[lang]));
    return { text: mounted.text, segments: mounted.segments, announcement, shownText, errors: mounted.errors, sent: mounted.sent, tap: mounted.tap, explore: mounted.explore, wait: mounted.wait, unmount: mounted.unmount };
  }

  /** Mount, read (and with `explore`, open every tab/section/"show all"), unmount: the view of a finished answer. */
  async function viewAnswer(msg: Msg, o: { lang?: Lang; explore?: boolean } = {}) {
    const v = await mountAnswer(msg, o);
    const segments = v.segments();
    const explored = o.explore ? await v.explore() : segments.map((x) => x.text);
    const out = { text: v.text(), segments, explored, announcement: v.announcement, shownText: v.shownText, errors: v.errors };
    await v.unmount();
    return out;
  }

  /**
   * The answer streamed in `chunks` pieces (split at fixed character positions, also inside JSON and fences), each
   * snapshot drawn the way the live answer draws it (last segment live). Returns every snapshot's view.
   */
  async function streamAnswer(msg: Msg, o: { lang?: Lang; chunks?: number } = {}) {
    const lang = o.lang ?? 'de';
    const n = Math.max(2, o.chunks ?? 6);
    const full = msg.text;
    const snapshots: { text: string; segments: SegmentView[]; errors: string[] }[] = [];
    let st: unknown = null;
    for (let k = 1; k < n; k++) {
      const shown = m.hideToolMarkup(full.slice(0, Math.floor((full.length * k) / n)), { streaming: true, notice: notice(lang) });
      st = m.advanceSegments(st, m.extractMedia(shown, true).text, false);
      const v = await mountSegments((st as { segs: Segment[] }).segs, lang, true);
      snapshots.push({ text: v.text(), segments: v.segments(), errors: v.errors });
      await v.unmount();
    }
    return snapshots;
  }

  return { mountAnswer, viewAnswer, streamAnswer };
}
