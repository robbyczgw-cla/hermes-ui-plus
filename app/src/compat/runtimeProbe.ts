// One-line runtime capability report, logged once at start (logcat tag ReactNativeJS, also in release
// builds). Makes device bug reports and emulator runs verifiable: which APIs does THIS engine have?
// Never throws; every probe is isolated. Keep in sync with scripts/hermes-compat-check.mjs.

type G = Record<string, unknown>;

function probe(fn: () => unknown): boolean | string {
  try {
    const v = fn();
    return typeof v === 'boolean' || typeof v === 'string' ? v : !!v;
  } catch (e) {
    return `throws: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`;
  }
}

function re(src: string, flags: string, input: string): boolean | string {
  return probe(() => new RegExp(src, flags).test(input));
}

export function runtimeReport(): Record<string, boolean | string> {
  const g = globalThis as unknown as G;
  const intl = (typeof Intl !== 'undefined' ? Intl : {}) as unknown as G;
  const hi = g.HermesInternal as { getRuntimeProperties?: () => Record<string, unknown> } | undefined;
  const props = probe(() => {
    const p = hi?.getRuntimeProperties?.();
    return p ? String(p['OSS Release Version'] ?? p['Build'] ?? 'hermes') : 'not-hermes';
  });
  const fn = (o: unknown, k: string) => probe(() => typeof (o as G | undefined)?.[k] === 'function');
  return {
    engine: props,
    'Intl.PluralRules': fn(intl, 'PluralRules'),
    'Intl.RelativeTimeFormat': fn(intl, 'RelativeTimeFormat'),
    'Intl.ListFormat': fn(intl, 'ListFormat'),
    'Intl.Segmenter': fn(intl, 'Segmenter'),
    'Intl.DisplayNames': fn(intl, 'DisplayNames'),
    'Intl.Locale': fn(intl, 'Locale'),
    'Intl.NumberFormat': fn(intl, 'NumberFormat'),
    'Intl.DateTimeFormat': fn(intl, 'DateTimeFormat'),
    'DTF.dateStyle': probe(() => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(0).length > 0),
    'DTF.hourCycle+tz': probe(() => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(0)),
    'DTF.formatToParts': probe(() => typeof new Intl.DateTimeFormat('de-DE').formatToParts === 'function'),
    'NF.formatToParts': probe(() => typeof new Intl.NumberFormat('de-DE').formatToParts === 'function'),
    'NF.currency': probe(() => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.5)),
    'Array#toSorted': fn(Array.prototype, 'toSorted'),
    'Array#findLast': fn(Array.prototype, 'findLast'),
    'Array#at': fn(Array.prototype, 'at'),
    'Object.groupBy': fn(Object, 'groupBy'),
    'String#replaceAll': fn(String.prototype, 'replaceAll'),
    'String#normalize': probe(() => 'é'.normalize('NFD').length === 2),
    'Promise.withResolvers': fn(Promise, 'withResolvers'),
    structuredClone: fn(g, 'structuredClone'),
    TextDecoder: fn(g, 'TextDecoder'),
    TextEncoder: fn(g, 'TextEncoder'),
    URL: probe(() => new URL('https://a.example/x?y=1').hostname === 'a.example'),
    'URLSearchParams.get': probe(() => new URLSearchParams('a=1').get('a') === '1'),
    'AbortSignal.timeout': fn(g.AbortSignal, 'timeout'),
    'crypto.randomUUID': fn(g.crypto, 'randomUUID'),
    'crypto.getRandomValues': fn(g.crypto, 'getRandomValues'),
    queueMicrotask: fn(g, 'queueMicrotask'),
    WeakRef: fn(g, 'WeakRef'),
    FinalizationRegistry: fn(g, 'FinalizationRegistry'),
    're.lookbehind': re('(?<=a)b', '', 'ab'),
    're.namedGroups': probe(() => /(?<y>\d{4})/.exec('2026')?.groups?.y === '2026'),
    're.pL': re('^\\p{L}+$', 'u', 'Äpfel'),
    're.ExtPict': re('\\p{Extended_Pictographic}', 'u', '🚆'),
    're.vFlag': re('[\\p{L}--[a-z]]', 'v', 'Ä'),
  };
}

let logged = false;

/** Log the report once (cheap; runs after the first frame is scheduled). */
export function logRuntimeOnce(): void {
  if (logged) return;
  logged = true;
  setTimeout(() => {
    try {
      console.log('[hui] runtime', JSON.stringify(runtimeReport()));
    } catch {
      /* never break the app for diagnostics */
    }
  }, 0);
}
