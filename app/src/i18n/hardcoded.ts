// AST scan for user-visible strings that bypass t(). Heuristic, used by i18nQuality.test.ts.
// Flags: JSX text, string literals in user-facing JSX props, Alert.alert / toast-style call arguments and
// user-facing object properties (title, label, message ...). Brand names and technical tokens are ignored.
import ts from 'typescript';

export interface Hit {
  line: number;
  kind: string;
  text: string;
}

const JSX_PROPS = new Set([
  'title', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'label', 'subtitle', 'description', 'headerTitle',
  'message', 'helperText', 'caption', 'emptyText', 'hint', 'tooltip', 'alt',
]);
const OBJ_PROPS = new Set(['title', 'label', 'message', 'subtitle', 'description', 'placeholder', 'accessibilityLabel', 'hint', 'body', 'text']);
const CALLS = new Set(['alert', 'toast', 'showToast', 'show', 'prompt']);

/** Words that may stand alone as visible text without translation (brand, product and protocol names). */
export const BRAND_WORDS = new Set([
  'HUI+', 'HUI', 'Hermes', 'Hermes UI+', 'Claude', 'ChatGPT', 'OpenAI', 'Anthropic', 'Meta',
  'Tailscale', 'GitHub', 'Forgejo', 'Markdown', 'JSON', 'URL', 'API', 'HTTP', 'HTTPS', 'SSH', 'QR', 'OK', 'PDF', 'CSV',
  'Android', 'iOS', 'Expo', 'Pi', 'MCP', 'TTS', 'STT', 'CLI', 'Nord', 'Solarized', 'Dracula',
]);

const UMLAUT = /[äöüÄÖÜß]/;
const GERMAN_WORDS = /\b(und|oder|nicht|der|die|das|ein|eine|keine|bitte|fehler|senden|abbrechen|speichern|löschen|wird|werden|ist|mit|für|von|zum|zur|noch|neu|alle|hier|wähle|wählen|verbinden|einstellungen|nachricht|suche|bild|erzeugen)\b/i;
const looksGerman = (s: string) => UMLAUT.test(s) || GERMAN_WORDS.test(s);

const hasLetters = (s: string) => /\p{L}{2,}/u.test(s);
const looksTechnical = (s: string) =>
  !/\s/.test(s) && (/^[\w./:@#%+=&?~…|-]+$/.test(s) || /^[^\p{L}]*$/u.test(s)) && !/^[A-ZÄÖÜ][a-zäöüß]{3,}$/.test(s);

export function isAllowed(text: string): boolean {
  const t = text.trim();
  if (!hasLetters(t)) return true;
  if (BRAND_WORDS.has(t)) return true;
  // every word is a brand word / symbol / number / identifier-like token
  const words = t.split(/[\s·•|/,;:()]+/).filter(Boolean);
  if (words.length && words.every((w) => BRAND_WORDS.has(w) || !hasLetters(w) || /^[a-z]+(?:[A-Z]\w*)+$/.test(w))) return true;
  return looksTechnical(t);
}

export function scanHardcoded(fileName: string, source: string): Hit[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const seen = new Set<number>();
  const add = (node: ts.Node, kind: string, text: string) => {
    if (isAllowed(text) || seen.has(node.getStart(sf))) return;
    seen.add(node.getStart(sf));
    hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind, text: text.trim().replace(/\s+/g, ' ') });
  };
  const lit = (n: ts.Node | undefined): string | undefined =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
  const visit = (n: ts.Node) => {
    // L(lang, de, en, es): per-language triples (demo content), already localized
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'L' && n.arguments.length >= 4) return;
    if (ts.isJsxText(n)) {
      add(n, 'jsx-text', n.text);
    } else if (ts.isJsxAttribute(n) && n.initializer && JSX_PROPS.has(n.name.getText(sf))) {
      const init = n.initializer;
      const v = lit(init) ?? (ts.isJsxExpression(init) ? lit(init.expression) : undefined);
      if (v !== undefined) add(n, `prop:${n.name.getText(sf)}`, v);
    } else if (ts.isPropertyAssignment(n) && OBJ_PROPS.has(n.name.getText(sf))) {
      const v = lit(n.initializer);
      // object props are only user-visible by convention: require a space or a capitalised word of length > 3
      if (v !== undefined && /\s/.test(v.trim())) add(n, `obj:${n.name.getText(sf)}`, v);
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && looksGerman(n.text) && /\s|^[A-ZÄÖÜ]/.test(n.text.trim()) && !ts.isImportDeclaration(n.parent) && !ts.isJsxAttribute(n.parent) && !ts.isPropertyAssignment(n.parent)) {
      add(n, 'german-literal', n.text);
    } else if (ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ts.isIdentifier(n.expression) ? n.expression.text : '';
      if (CALLS.has(callee) && (ts.isIdentifier(n.expression) || /^(Alert|Toast)$/.test(n.expression.getChildAt(0).getText(sf)))) {
        for (const a of n.arguments.slice(0, 2)) {
          const v = lit(a);
          if (v !== undefined) add(a, `call:${callee}`, v);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
