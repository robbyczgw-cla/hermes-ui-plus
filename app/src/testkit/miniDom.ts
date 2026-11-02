/// <reference types="node" />
// Test harness: the smallest DOM that react-dom/client and react-native-web need to mount the real answer
// components in Node (no jsdom dependency): elements, text, attributes, inline styles, events with capture/bubble,
// a <style> sheet, and a fixed phone layout (every element is PHONE_WIDTH wide), so `onLayout` (ResizeObserver
// below) fires and width-dependent parts (carousels, agenda grid, charts) draw like on a phone.
//
// Not a browser: no CSS cascade (react-native-web styles are classes; nothing is ever "display:none" here), no
// real geometry, no focus model beyond `activeElement`. Use it to read what is drawn and to tap things.

/** content width of a 390 px phone screen inside the chat's padding */
export const PHONE_WIDTH = 358;
const ROW_HEIGHT = 24;

type Listener = { fn: (e: FakeEvent) => void; capture: boolean; once: boolean };

export class FakeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  target: MiniNode | null = null;
  currentTarget: MiniNode | null = null;
  eventPhase = 0;
  defaultPrevented = false;
  timeStamp = Date.now();
  isTrusted = true;
  altKey = false;
  ctrlKey = false;
  metaKey = false;
  shiftKey = false;
  button = 0;
  buttons = 0;
  detail = 1;
  pageX = 0;
  pageY = 0;
  clientX = 0;
  clientY = 0;
  key?: string;
  _stop = false;
  _stopNow = false;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    Object.assign(this, init);
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stop = true;
  }
  stopImmediatePropagation() {
    this._stop = true;
    this._stopNow = true;
  }
  composedPath(): MiniNode[] {
    const out: MiniNode[] = [];
    for (let n: MiniNode | null = this.target; n; n = n.parentNode) out.push(n);
    return out;
  }
}

export class MiniNode {
  nodeType: number;
  nodeName: string;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  ownerDocument: MiniDocument;
  private _listeners = new Map<string, Listener[]>();
  [k: string]: unknown;
  constructor(type: number, name: string, doc: MiniDocument) {
    this.nodeType = type;
    this.nodeName = name;
    this.ownerDocument = doc;
  }
  get parentElement(): MiniNode | null {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): MiniNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): MiniNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) - 1] ?? null;
  }
  get isConnected(): boolean {
    let n: MiniNode | null = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  get children(): MiniNode[] {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  appendChild<T extends MiniNode>(c: T): T {
    return this.insertBefore(c, null);
  }
  insertBefore<T extends MiniNode>(c: T, ref: MiniNode | null): T {
    if (c.nodeType === 11) {
      for (const x of [...c.childNodes]) this.insertBefore(x, ref);
      return c;
    }
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild<T extends MiniNode>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  replaceChild(n: MiniNode, old: MiniNode) {
    this.insertBefore(n, old);
    return this.removeChild(old);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  contains(o: MiniNode | null): boolean {
    for (let n = o; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  getRootNode(): MiniNode {
    let n: MiniNode = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }
  get textContent(): string {
    if (this.nodeType === 3 || this.nodeType === 8) return String(this.data ?? '');
    return this.childNodes.map((c) => (c.nodeType === 8 ? '' : c.textContent)).join('');
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  get nodeValue() {
    return this.nodeType === 3 || this.nodeType === 8 ? String(this.data ?? '') : null;
  }
  set nodeValue(v: string | null) {
    if (this.nodeType === 3 || this.nodeType === 8) this.data = v ?? '';
  }
  addEventListener(type: string, fn: unknown, opts?: boolean | { capture?: boolean; once?: boolean }) {
    if (typeof fn !== 'function') return;
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this._listeners.get(type) ?? [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn: fn as Listener['fn'], capture, once: typeof opts === 'object' && !!opts?.once });
    this._listeners.set(type, list);
  }
  removeEventListener(type: string, fn: unknown, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this._listeners.get(type);
    if (list) this._listeners.set(type, list.filter((l) => !(l.fn === fn && l.capture === capture)));
  }
  _fire(e: FakeEvent, capture: boolean) {
    const list = this._listeners.get(e.type);
    if (!list) return;
    e.currentTarget = this;
    for (const l of [...list]) {
      if (l.capture !== capture && e.eventPhase !== 2) continue;
      if (l.once) this.removeEventListener(e.type, l.fn, l.capture);
      l.fn.call(this, e);
      if (e._stopNow) return;
    }
  }
  dispatchEvent(e: FakeEvent): boolean {
    e.target = this;
    const path = e.composedPath();
    const win = globalThis as unknown as { event?: unknown };
    const prev = win.event;
    win.event = e;
    try {
      for (let i = path.length - 1; i > 0 && !e._stop; i--) {
        e.eventPhase = 1;
        path[i]._fire(e, true);
      }
      if (!e._stop) {
        e.eventPhase = 2;
        this._fire(e, true);
        if (!e._stopNow) this._fire(e, false);
      }
      if (e.bubbles) {
        for (let i = 1; i < path.length && !e._stop; i++) {
          e.eventPhase = 3;
          path[i]._fire(e, false);
        }
      }
      // the document's window listeners (react-native-web's modality / responder system listen there too)
      if (e.bubbles && !e._stop) (globalThis as unknown as { _miniWindow?: MiniNode })._miniWindow?._fire(e, false);
    } finally {
      win.event = prev;
      e.currentTarget = null;
      e.eventPhase = 0;
    }
    return !e.defaultPrevented;
  }
}

function styleDecl(): Record<string, unknown> {
  const props: Record<string, string> = {};
  return new Proxy(props, {
    get(t, k) {
      if (k === 'setProperty') return (name: string, v: string) => void (t[name] = String(v));
      if (k === 'removeProperty') return (name: string) => void delete t[name];
      if (k === 'getPropertyValue') return (name: string) => t[name] ?? '';
      if (k === 'cssText') return Object.entries(t).map(([a, b]) => `${a}: ${b}`).join('; ');
      if (typeof k === 'string') return t[k] ?? '';
      return undefined;
    },
    set(t, k, v) {
      if (typeof k === 'string') {
        if (k === 'cssText') {
          for (const key of Object.keys(t)) delete t[key];
          for (const part of String(v).split(';')) {
            const [a, ...b] = part.split(':');
            if (a?.trim()) t[a.trim()] = b.join(':').trim();
          }
        } else t[k] = v == null ? '' : String(v);
      }
      return true;
    },
  }) as Record<string, unknown>;
}

export class MiniElement extends MiniNode {
  tagName: string;
  namespaceURI: string;
  attributes = new Map<string, string>();
  style = styleDecl();
  scrollLeft = 0;
  scrollTop = 0;
  constructor(tag: string, doc: MiniDocument, ns = 'http://www.w3.org/1999/xhtml') {
    super(1, tag.toUpperCase(), doc);
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns;
    if (this.tagName === 'STYLE') {
      const rules: { cssText: string }[] = [];
      this.sheet = { cssRules: rules, insertRule: (r: string, i = rules.length) => (rules.splice(i, 0, { cssText: r }), i), deleteRule: (i: number) => void rules.splice(i, 1) };
    }
  }
  get localName() {
    return this.tagName.toLowerCase();
  }
  setAttribute(k: string, v: unknown) {
    this.attributes.set(k, String(v));
  }
  setAttributeNS(_ns: string | null, k: string, v: unknown) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attributes.has(k) ? this.attributes.get(k)! : null;
  }
  hasAttribute(k: string) {
    return this.attributes.has(k);
  }
  removeAttribute(k: string) {
    this.attributes.delete(k);
  }
  removeAttributeNS(_ns: string | null, k: string) {
    this.attributes.delete(k);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get offsetWidth() {
    return PHONE_WIDTH;
  }
  get offsetHeight() {
    return ROW_HEIGHT;
  }
  get clientWidth() {
    return PHONE_WIDTH;
  }
  get clientHeight() {
    return ROW_HEIGHT;
  }
  get scrollWidth() {
    return PHONE_WIDTH;
  }
  get scrollHeight() {
    return ROW_HEIGHT;
  }
  offsetLeft = 0;
  offsetTop = 0;
  clientLeft = 0;
  clientTop = 0;
  get offsetParent(): MiniNode | null {
    return null;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: PHONE_WIDTH, bottom: ROW_HEIGHT, width: PHONE_WIDTH, height: ROW_HEIGHT, toJSON() {} };
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click() {
    this.dispatchEvent(new FakeEvent('click'));
  }
  scrollTo() {}
  scrollBy() {}
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  matches() {
    return false;
  }
  closest(): MiniNode | null {
    return null;
  }
  querySelector(): MiniNode | null {
    return null;
  }
  querySelectorAll(): MiniNode[] {
    return [];
  }
  set innerHTML(v: string) {
    this.textContent = '';
    this._innerHTML = v;
  }
  get innerHTML(): string {
    return String(this._innerHTML ?? '');
  }
}

export class MiniDocument extends MiniNode {
  documentElement: MiniElement;
  head: MiniElement;
  body: MiniElement;
  activeElement: MiniNode;
  defaultView: unknown = globalThis;
  readyState = 'complete';
  visibilityState = 'visible';
  hidden = false;
  constructor() {
    super(9, '#document', null as unknown as MiniDocument);
    this.ownerDocument = this as unknown as MiniDocument;
    this.documentElement = new MiniElement('html', this);
    this.head = new MiniElement('head', this);
    this.body = new MiniElement('body', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string) {
    return new MiniElement(tag, this);
  }
  createElementNS(ns: string, tag: string) {
    return new MiniElement(tag, this, ns);
  }
  createTextNode(t: string) {
    const n = new MiniNode(3, '#text', this);
    n.data = String(t);
    return n;
  }
  createComment(t: string) {
    const n = new MiniNode(8, '#comment', this);
    n.data = String(t);
    return n;
  }
  createDocumentFragment() {
    return new MiniNode(11, '#document-fragment', this);
  }
  getElementById(id: string): MiniNode | null {
    const walk = (n: MiniNode): MiniNode | null => {
      if (n.nodeType === 1 && (n as MiniElement).getAttribute('id') === id) return n;
      for (const c of n.childNodes) {
        const f = walk(c);
        if (f) return f;
      }
      return null;
    };
    return walk(this);
  }
  querySelector(): MiniNode | null {
    return null;
  }
  querySelectorAll(): MiniNode[] {
    return [];
  }
  getSelection() {
    return null;
  }
  hasFocus() {
    return true;
  }
}

/** Install `window`/`document` and the browser globals react-dom and react-native-web touch. Idempotent. */
export function installMiniDom(): MiniDocument {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.document instanceof MiniDocument) return g.document as MiniDocument;
  const doc = new MiniDocument();
  const win = new MiniNode(0, '#window', doc);
  g._miniWindow = win;
  const set = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  set('document', doc);
  set('window', globalThis);
  g.addEventListener ??= (t: string, f: unknown, o?: boolean | { capture?: boolean }) => win.addEventListener(t, f, o);
  g.removeEventListener ??= (t: string, f: unknown, o?: boolean | { capture?: boolean }) => win.removeEventListener(t, f, o);
  g.dispatchEvent ??= (e: FakeEvent) => (win._fire(e, false), true);
  for (const name of ['ShadowRoot', 'DocumentFragment', 'HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'SVGElement']) {
    if (!g[name]) set(name, class {});
  }
  if (!g.Node) set('Node', MiniNode);
  set('innerWidth', 390);
  set('innerHeight', 844);
  set('devicePixelRatio', 1);
  set('screen', { width: 390, height: 844, availWidth: 390, availHeight: 844 });
  set('visualViewport', { width: 390, height: 844, scale: 1, addEventListener() {}, removeEventListener() {} });
  set('scrollX', 0);
  set('scrollY', 0);
  set('getComputedStyle', (el: MiniElement) => el?.style ?? styleDecl());
  set('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  set('requestAnimationFrame', (f: (t: number) => void) => setTimeout(() => f(Date.now()), 0) as unknown as number);
  set('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
  set('getSelection', () => null);
  set('scrollTo', () => undefined);
  set('location', { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', pathname: '/', search: '', hash: '' });
  // onLayout: observing an element reports the phone width right away (react-native-web's useElementLayout)
  set(
    'ResizeObserver',
    class {
      cb: (entries: { target: unknown }[]) => void;
      constructor(cb: (entries: { target: unknown }[]) => void) {
        this.cb = cb;
      }
      observe(target: unknown) {
        setTimeout(() => this.cb([{ target }]), 0);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  set('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  set('MutationObserver', class { observe() {} disconnect() {} takeRecords() { return []; } });
  return doc;
}

/** The text a reader sees under `root`, in document order (blocks separated by spaces, <style>/<script> skipped). */
export function domText(root: MiniNode): string {
  const out: string[] = [];
  const walk = (n: MiniNode) => {
    if (n.nodeType === 3) {
      out.push(String(n.data ?? ''));
      return;
    }
    if (n.nodeType === 1) {
      const tag = (n as MiniElement).tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT') return;
    }
    for (const c of n.childNodes) walk(c);
    if (n.nodeType === 1) out.push(' ');
  };
  walk(root);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** All elements under `root` matching a predicate, in document order. */
export function findAll(root: MiniNode, pred: (el: MiniElement) => boolean): MiniElement[] {
  const out: MiniElement[] = [];
  const walk = (n: MiniNode) => {
    if (n.nodeType === 1 && pred(n as MiniElement)) out.push(n as MiniElement);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}
