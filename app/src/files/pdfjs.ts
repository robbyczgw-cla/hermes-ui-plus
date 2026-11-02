/**
 * pdf.js for the in-app PDF viewer, loaded on demand from the app's own origin (`/pdfjs/`, copied into the web export
 * by scripts/web-pdfjs.mjs): one module <script> that sets `globalThis.__huiPdfjs`. Never part of the Metro bundle,
 * never from a CDN. Web / desktop only.
 */

/** The parts of the pdf.js API the viewer uses. */
export type PdfViewport = { width: number; height: number };
export type PdfPage = {
  getViewport: (o: { scale: number }) => PdfViewport;
  render: (o: { canvas: HTMLCanvasElement; viewport: PdfViewport; transform?: number[] }) => { promise: Promise<void>; cancel: () => void };
  cleanup: () => void;
};
export type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfLib = {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
  version?: string;
};

export const PDFJS_BASE = '/pdfjs/';
const LOAD_TIMEOUT_MS = 20_000;

let loading: Promise<PdfLib> | null = null;

/** pdf.js, loaded once. Rejects when the files are missing (e.g. `expo start --web` without the build step). */
export function loadPdfjs(): Promise<PdfLib> {
  const g = globalThis as { __huiPdfjs?: PdfLib };
  if (g.__huiPdfjs) return Promise.resolve(g.__huiPdfjs);
  if (loading) return loading;
  loading = new Promise<PdfLib>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    const done = () => {
      clearTimeout(timer);
      removeEventListener('hui-pdfjs', done);
      if (g.__huiPdfjs) resolve(g.__huiPdfjs);
      else reject(new Error('pdf.js did not initialise'));
    };
    const timer = setTimeout(() => {
      removeEventListener('hui-pdfjs', done);
      reject(new Error('pdf.js load timeout'));
    }, LOAD_TIMEOUT_MS);
    addEventListener('hui-pdfjs', done);
    const s = document.createElement('script');
    s.type = 'module';
    s.src = `${PDFJS_BASE}load.js`;
    s.onerror = () => {
      clearTimeout(timer);
      removeEventListener('hui-pdfjs', done);
      s.remove();
      reject(new Error('pdf.js not available'));
    };
    document.head.appendChild(s);
  });
  // a failed load may be retried (network back, files deployed)
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Open a PDF from its bytes (no network access from pdf.js except its own data files on this origin). */
export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocument; cancel: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: bytes,
    isEvalSupported: false,
    enableXfa: false,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${PDFJS_BASE}wasm/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
  });
  const cancel = () => {
    try {
      void Promise.resolve(task.destroy()).catch(() => undefined);
    } catch {
      // already gone
    }
  };
  try {
    return { doc: await task.promise, cancel };
  } catch (e) {
    cancel();
    throw e;
  }
}
