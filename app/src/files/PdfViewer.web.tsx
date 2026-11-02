/**
 * In-app PDF viewer of the web / desktop app ("Öffnen" on a PDF): a full-screen sheet with "Zurück", the page number and
 * "Sichern" on top, the pages below. pdf.js is loaded on the first PDF (pdfjs.ts, files from the app's own origin).
 * Pages are rendered only while near the viewport (IntersectionObserver), canvases of pages far away are released, so
 * long PDFs stay light on a phone. Zoom: pinch (touch), ctrl/⌘ + wheel or trackpad pinch, and the −/+ buttons; the
 * pages are re-rendered sharp at the new size. A PDF that cannot be shown says why and offers "Im System öffnen".
 * Escape and the system back (Android) close it.
 */
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatBytes } from '../attachments/mime';
import { Icon } from '../chat/icons';
import { useI18n } from '../i18n';
import { Button, useTheme } from '../ui';
import { Text } from '../ui/primitives/Text';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import type { PdfError, PdfViewerProps } from './fileActionsTypes';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, pageAt, pageBox, zoomScroll } from './pdfLayout';
import { loadPdfjs, openPdf, type PdfDocument, type PdfPage } from './pdfjs';
import { MAX_VIEW_BYTES } from './webFile';
import { loadFailure, loadWebFile } from './webFileActions';

export function PdfViewer(props: PdfViewerProps) {
  useBackToClose(props.onClose);
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <ViewerBoundary {...props}>
        <ViewerBody {...props} />
      </ViewerBoundary>
    </Modal>
  );
}

/** a pdf.js / render error stays inside the sheet: its "cannot show" state instead of a broken chat message */
class ViewerBoundary extends Component<PdfViewerProps & { children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('[pdf viewer]', String(e).slice(0, 200));
  }
  render() {
    return this.state.failed ? <ViewerBody {...this.props} forceError="broken" /> : this.props.children;
  }
}

type Phase = { kind: 'loading' } | { kind: 'ready'; doc: PdfDocument; aspect: number; widthPt: number } | { kind: 'error'; error: PdfError };

/**
 * The system back gesture / button (Android PWA, browser back) closes the viewer, not the app: a history entry while
 * it is open. It carries the router's own state, so expo-router sees the same entry on the way back; closing by
 * "Zurück" removes the entry again.
 */
function useBackToClose(onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.pushState) return;
    const marker = `hui-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const base = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.pushState({ ...base, huiOverlay: marker }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      latest.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && (window.history.state as { huiOverlay?: string } | null)?.huiOverlay === marker) window.history.back();
    };
  }, []);
}

function ViewerBody({ src, deps, onClose, onSave, saveNow, saving, onOpenSystem, forceError }: PdfViewerProps & { forceError?: PdfError }) {
  useEscapeToClose(true, onClose);
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>(forceError ? { kind: 'error', error: forceError } : { kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (forceError) return;
    let alive = true;
    let cancel: (() => void) | null = null;
    setPhase({ kind: 'loading' });
    (async () => {
      if ((src.size ?? 0) > MAX_VIEW_BYTES) return setPhase({ kind: 'error', error: 'tooLarge' });
      let bytes: Uint8Array;
      try {
        const f = await loadWebFile(src, deps);
        if (f.size > MAX_VIEW_BYTES) return alive && setPhase({ kind: 'error', error: 'tooLarge' });
        // a copy: pdf.js hands its buffer to the worker
        bytes = new Uint8Array(await f.arrayBuffer());
      } catch (e) {
        return alive && setPhase({ kind: 'error', error: loadFailure(e) });
      }
      try {
        await loadPdfjs();
      } catch {
        return alive && setPhase({ kind: 'error', error: 'noViewer' });
      }
      try {
        const r = await openPdf(bytes);
        cancel = r.cancel;
        if (!alive) return r.cancel();
        const first = await r.doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (alive) setPhase({ kind: 'ready', doc: r.doc, aspect: vp.height / vp.width, widthPt: vp.width });
      } catch {
        if (alive) setPhase({ kind: 'error', error: 'broken' });
      }
    })();
    return () => {
      alive = false;
      // the loading task owns the document (and its worker): destroying it frees both
      cancel?.();
    };
  }, [src, deps, attempt, forceError]);

  const count = phase.kind === 'ready' ? phase.doc.numPages : 0;
  const errorText = (e: PdfError) =>
    e === 'tooLarge'
      ? tr('attachments.pdf.tooLarge', { size: formatBytes(src.size ?? MAX_VIEW_BYTES + 1, lang), max: formatBytes(MAX_VIEW_BYTES, lang) })
      : e === 'broken'
        ? tr('attachments.pdf.broken')
        : e === 'noViewer'
          ? tr('attachments.pdf.noViewer')
          : e === 'unavailable'
            ? tr('attachments.pdf.unavailable')
            : tr('attachments.web.openFailed', { name: src.name });

  return (
    <View style={[styles.root, { backgroundColor: t.dark ? '#1d1d1f' : '#e9e9ec', paddingTop: insets.top }]}>
      <View style={[styles.bar, { backgroundColor: t.colors.bg, borderBottomColor: t.colors.border }]}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('attachments.pdf.backA11y')}
          hitSlop={8}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="chevronLeft" size={22} color={t.colors.text} />
          <Text style={[t.typography.callout, { color: t.colors.text, fontWeight: '600' }]}>{tr('attachments.pdf.back')}</Text>
        </Pressable>
        <View style={styles.title}>
          <Text numberOfLines={1} style={[t.typography.callout, { color: t.colors.text, fontWeight: '600' }]}>
            {src.name}
          </Text>
          {count > 0 ? (
            <Text numberOfLines={1} style={[t.typography.caption, { color: t.colors.muted }]} accessibilityLiveRegion="polite">
              {tr('attachments.pdf.page', { page, count })}
            </Text>
          ) : null}
        </View>
        <Button
          label={saveNow ? tr('attachments.web.saveNow') : tr('attachments.web.save')}
          onPress={onSave}
          variant={saveNow ? 'primary' : 'secondary'}
          size="small"
          loading={saving}
          icon={(c, s) => <Icon name="download" size={s} color={c} />}
          accessibilityLabel={tr('attachments.web.saveA11y', { name: src.name })}
          accessibilityHint={tr('attachments.web.saveHint')}
        />
      </View>
      {phase.kind === 'ready' ? (
        <Pages doc={phase.doc} aspect={phase.aspect} widthPt={phase.widthPt} zoom={zoom} onZoom={setZoom} onPage={setPage} count={count} />
      ) : phase.kind === 'loading' ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={t.colors.muted} />
          <Text style={[t.typography.callout, { color: t.colors.muted, marginTop: 12 }]}>{tr('attachments.pdf.loading')}</Text>
        </View>
      ) : (
        <View style={styles.center} accessibilityLiveRegion="assertive">
          <Icon name="file" size={36} color={t.colors.muted} />
          <Text style={[t.typography.callout, styles.errorText, { color: t.colors.text }]}>{errorText(phase.error)}</Text>
          <View style={styles.errorButtons}>
            <Button label={tr('attachments.pdf.openSystem')} onPress={onOpenSystem} variant="primary" icon={(c, s) => <Icon name="external" size={s} color={c} />} />
            {phase.error === 'noViewer' || phase.error === 'error' ? (
              <Button label={tr('attachments.pdf.retry')} onPress={() => setAttempt((n) => n + 1)} variant="secondary" />
            ) : null}
          </View>
        </View>
      )}
      {phase.kind === 'ready' ? (
        <View style={[styles.zoomPill, { bottom: 16 + insets.bottom, backgroundColor: t.colors.bg, borderColor: t.colors.border }]}>
          <Pressable
            onPress={() => setZoom((z) => clampZoom(z / 1.25))}
            disabled={zoom <= MIN_ZOOM}
            accessibilityRole="button"
            accessibilityLabel={tr('attachments.pdf.zoomOut')}
            style={[styles.zoomBtn, { opacity: zoom <= MIN_ZOOM ? 0.35 : 1 }]}
          >
            <Text style={[styles.zoomGlyph, { color: t.colors.text }]}>−</Text>
          </Pressable>
          <Pressable
            onPress={() => setZoom((z) => clampZoom(z * 1.25))}
            disabled={zoom >= MAX_ZOOM}
            accessibilityRole="button"
            accessibilityLabel={tr('attachments.pdf.zoomIn')}
            style={[styles.zoomBtn, { opacity: zoom >= MAX_ZOOM ? 0.35 : 1 }]}
          >
            <Text style={[styles.zoomGlyph, { color: t.colors.text }]}>+</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const GAP = 12;

function Pages({
  doc,
  aspect,
  widthPt,
  zoom,
  onZoom,
  onPage,
  count,
}: {
  doc: PdfDocument;
  aspect: number;
  widthPt: number;
  zoom: number;
  onZoom: (z: number) => void;
  onPage: (n: number) => void;
  count: number;
}) {
  const { t: tr } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([1]));
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // available width (the sheet resizes with rotation / window size)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setAvail(Math.max(200, el.clientWidth - 2 * GAP));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // which pages are near the viewport (one screen ahead / behind)
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: '100% 0px 100% 0px' },
    );
    for (const el of pageEls.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [count, avail]);

  const updatePage = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    onPage(pageAt(pageEls.current.map((p) => p?.offsetTop ?? 0), el.scrollTop, el.clientHeight));
  }, [onPage]);

  // keep the point under the fingers / pointer (or, for the −/+ buttons, the middle of the view) in place after a zoom
  const shownZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = shownZoom.current;
    shownZoom.current = zoom;
    if (!el) return;
    const s =
      pendingScroll.current ??
      (prev !== zoom
        ? zoomScroll({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, x: el.clientWidth / 2, y: el.clientHeight / 2, factor: zoom / prev })
        : null);
    if (s) {
      el.scrollLeft = s.left;
      el.scrollTop = s.top;
      pendingScroll.current = null;
    }
    updatePage();
  }, [zoom, updatePage]);

  // pinch (two fingers) and ctrl/⌘ + wheel (desktop trackpad pinch) zoom
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    let start: { d: number; x: number; y: number } | null = null;
    let factor = 1;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const commit = (f: number, x: number, y: number) => {
      const next = clampZoom(zoomRef.current * f);
      const real = next / zoomRef.current;
      if (Math.abs(real - 1) < 0.01) return;
      const r = el.getBoundingClientRect();
      pendingScroll.current = zoomScroll({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, x: x - r.left, y: y - r.top, factor: real });
      onZoom(next);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const r = el.getBoundingClientRect();
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      start = { d: dist(e), x, y };
      factor = 1;
      inner.style.transformOrigin = `${x - r.left + el.scrollLeft}px ${y - r.top + el.scrollTop}px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault(); // no page zoom of the whole app
      const z = clampZoom(zoomRef.current * (dist(e) / start.d));
      factor = z / zoomRef.current;
      inner.style.transform = `scale(${factor})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length > 1) return;
      const s = start;
      start = null;
      inner.style.transform = '';
      commit(factor, s.x, s.y);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      commit(Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [onZoom]);

  const pages = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count]);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const box = avail ? pageBox({ pageWidthPt: widthPt, pageHeightPt: widthPt * aspect, availWidth: avail, zoom, dpr }) : null;

  return (
    <div ref={scroller} onScroll={updatePage} style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}>
      <div ref={content} style={{ padding: GAP, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: GAP, minWidth: 'min-content' }}>
        {box
          ? pages.map((n) => (
              <PageView
                key={n}
                ref={(el) => {
                  pageEls.current[n - 1] = el;
                }}
                doc={doc}
                n={n}
                count={count}
                near={visible.has(n)}
                fallbackHeight={box.cssHeight}
                width={box.cssWidth}
                avail={avail}
                zoom={zoom}
                dpr={dpr}
                label={tr('attachments.pdf.page', { page: n, count })}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function PageView({
  ref,
  doc,
  n,
  near,
  fallbackHeight,
  width,
  avail,
  zoom,
  dpr,
  label,
}: {
  ref: (el: HTMLDivElement | null) => void;
  doc: PdfDocument;
  n: number;
  count: number;
  near: boolean;
  fallbackHeight: number;
  width: number;
  avail: number;
  zoom: number;
  dpr: number;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!near) {
      // far away: give the memory back, keep the placeholder size
      c.width = 0;
      c.height = 0;
      return;
    }
    let task: { cancel: () => void } | null = null;
    let alive = true;
    let pg: PdfPage | null = null;
    doc
      .getPage(n)
      .then((p) => {
        if (!alive) return;
        pg = p;
        const vp = p.getViewport({ scale: 1 });
        const b = pageBox({ pageWidthPt: vp.width, pageHeightPt: vp.height, availWidth: avail, zoom, dpr });
        setSize({ w: b.cssWidth, h: b.cssHeight });
        c.width = b.pixelWidth;
        c.height = b.pixelHeight;
        const r = p.render({ canvas: c, viewport: p.getViewport({ scale: b.renderScale }) });
        task = r;
        return r.promise;
      })
      .then(
        () => alive && setFailed(false),
        (e: { name?: string }) => {
          if (alive && e?.name !== 'RenderingCancelledException') setFailed(true);
        },
      );
    return () => {
      alive = false;
      task?.cancel();
      pg?.cleanup();
    };
  }, [doc, n, near, avail, zoom, dpr]);

  const w = size?.w ?? width;
  const h = size?.h ?? fallbackHeight;
  return (
    <div
      ref={ref}
      data-page={n}
      role="img"
      aria-label={label}
      style={{ width: w, height: h, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.18)', flex: 'none', position: 'relative' }}
    >
      <canvas ref={canvas} style={{ width: w, height: h, display: 'block' }} />
      {failed ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 14 }}>⚠︎</div> : null}
    </div>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: 6 },
  title: { flex: 1, minWidth: 0, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { textAlign: 'center', marginTop: 12, maxWidth: 420 },
  errorButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, justifyContent: 'center' },
  zoomPill: { position: 'absolute', right: 16, flexDirection: 'row', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  zoomBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  zoomGlyph: { fontSize: 22, lineHeight: 24 },
});
