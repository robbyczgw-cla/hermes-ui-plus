/// <reference types="node" />
/**
 * Static screen-reader guard over every app/src/**\/*.tsx (TypeScript AST, no rendering):
 * 1. role: every raw Pressable / Touchable* has an accessibilityRole (or role), or is explicitly taken out of the
 *    accessibility tree (accessible={false}, importantForAccessibility="no"/"no-hide-descendants",
 *    accessibilityElementsHidden, aria-hidden). PressableScale defaults to role "button" (primitives/basics.tsx).
 * 2. name: an icon-only control (no text child) has an accessibilityLabel / aria-label; a Switch / Toggle always has one.
 * 3. nesting: an accessible pressable must not wrap other controls (iOS merges it into ONE VoiceOver element and the
 *    inner buttons become unreachable; on web role="button" makes its children presentational).
 * 4. web state: react-native-web 0.21 drops `accessibilityState` except `disabled`, so checked / selected / expanded /
 *    busy on a raw element must go through `a11yState()` (ui/lib/a11yState.ts), which adds the aria-* mirror.
 *    PressableScale already maps its state itself, and so does the one Button (primitives/Button.tsx renders a
 *    PressableScale with the caller's accessibilityState).
 * 5. no literal (untranslated) accessibilityLabel / accessibilityHint / aria-label strings.
 * Run: scripts/check.sh test src/ui/lib/a11yAudit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RAW_PRESSABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
const PRESSABLES = new Set([...RAW_PRESSABLES, 'PressableScale', 'Animated.Pressable', 'AnimatedPressable']);
const SWITCHES = new Set(['Switch', 'Toggle']);
/** controls that become unreachable when an accessible pressable wraps them */
const CONTROLS = new Set([...PRESSABLES, 'TextInput', 'Toggle', 'Btn', 'Button', 'RoundBtn', 'Chips', 'Slider']);
const LABEL_ATTRS = ['accessibilityLabel', 'aria-label', 'accessibilityLabelledBy', 'aria-labelledby'];
const ROLE_ATTRS = ['accessibilityRole', 'role'];
const TEXT_TAG = /(^|\.)(Text|HText|InlineText|AppText)$|Text$|Label$/;

/**
 * Known exceptions, kept tiny. key = `relative/path.tsx:<rule>:<tag>`.
 * - primitives/Toggle.tsx: the Toggle wrapper forwards its caller's props; the label is checked at every <Toggle> call site.
 */
const ALLOW = new Set(['ui/primitives/Toggle.tsx:name:Switch']);

type Finding = { file: string; line: number; rule: string; tag: string };

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

type Attrs = { names: Map<string, ts.JsxAttribute>; spreads: string[] };

function attrsOf(n: ts.JsxOpeningLikeElement): Attrs {
  const names = new Map<string, ts.JsxAttribute>();
  const spreads: string[] = [];
  for (const a of n.attributes.properties) {
    if (ts.isJsxAttribute(a)) names.set(a.name.getText(), a);
    else if (ts.isJsxSpreadAttribute(a)) spreads.push(a.expression.getText());
  }
  return { names, spreads };
}

/** literal value of an attribute: `"x"` / `{'x'}` / `{false}` → string | boolean; anything else → undefined */
function literal(a: ts.JsxAttribute | undefined): string | boolean | undefined {
  if (!a) return undefined;
  const init = a.initializer;
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  return undefined;
}

function hiddenFromA11y(a: Attrs): boolean {
  if (literal(a.names.get('accessible')) === false) return true;
  const ifa = literal(a.names.get('importantForAccessibility'));
  if (ifa === 'no' || ifa === 'no-hide-descendants') return true;
  if (a.names.has('accessibilityElementsHidden') && literal(a.names.get('accessibilityElementsHidden')) !== false) return true;
  if (a.names.has('aria-hidden') && literal(a.names.get('aria-hidden')) !== false) return true;
  return false;
}

const tagOf = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();
const elementOf = (n: ts.JsxOpeningLikeElement): ts.Node => (ts.isJsxOpeningElement(n) ? n.parent : n);

/** 'text' = a text child (or an expression that may render text), 'none' = only icons / views / images */
function childText(el: ts.Node): boolean {
  if (ts.isJsxSelfClosingElement(el)) return false;
  if (!ts.isJsxElement(el)) return false;
  let found = false;
  const visitExpr = (e: ts.Expression): void => {
    if (found) return;
    if (ts.isParenthesizedExpression(e)) return visitExpr(e.expression);
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return visitNode(e);
    if (ts.isConditionalExpression(e)) {
      visitExpr(e.whenTrue);
      visitExpr(e.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      visitExpr(e.right);
      return;
    }
    if (e.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(e) && e.text === 'undefined') return;
    // anything else (a variable, a call, a string) may render text: count it as text (no false alarms)
    found = true;
  };
  const visitNode = (m: ts.Node): void => {
    if (found) return;
    if (ts.isJsxText(m)) {
      if (m.getText().trim()) found = true;
      return;
    }
    if (ts.isJsxExpression(m)) {
      if (m.expression) visitExpr(m.expression);
      return;
    }
    if (ts.isJsxElement(m) || ts.isJsxSelfClosingElement(m)) {
      const open = ts.isJsxElement(m) ? m.openingElement : m;
      const a = attrsOf(open);
      if (TEXT_TAG.test(tagOf(open)) || LABEL_ATTRS.some((k) => a.names.has(k))) {
        found = true;
        return;
      }
      if (ts.isJsxElement(m)) m.children.forEach(visitNode);
      return;
    }
    if (ts.isJsxFragment(m)) {
      m.children.forEach(visitNode);
      return;
    }
  };
  el.children.forEach(visitNode);
  return found;
}

/** a descendant control inside this element's children (not in its props) */
function wrapsControl(el: ts.Node): string | null {
  if (!ts.isJsxElement(el)) return null;
  let hit: string | null = null;
  const visit = (m: ts.Node): void => {
    if (hit) return;
    if (ts.isJsxOpeningElement(m) || ts.isJsxSelfClosingElement(m)) {
      const tag = tagOf(m);
      if (CONTROLS.has(tag) && !hiddenFromA11y(attrsOf(m))) {
        hit = tag;
        return;
      }
    }
    ts.forEachChild(m, visit);
  };
  el.children.forEach(visit);
  return hit;
}

/** object-literal keys of accessibilityState={{ … }}; null when not a literal (unknown) */
function stateKeys(a: ts.JsxAttribute | undefined): string[] | null {
  const init = a?.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
  const keys: string[] = [];
  let known = true;
  const collect = (e: ts.Expression): void => {
    if (ts.isParenthesizedExpression(e)) return collect(e.expression);
    if (ts.isObjectLiteralExpression(e)) {
      for (const p of e.properties) {
        if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) keys.push(p.name.getText());
        else known = false;
      }
      return;
    }
    if (ts.isConditionalExpression(e)) {
      collect(e.whenTrue);
      collect(e.whenFalse);
      return;
    }
    if (e.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return;
    known = false;
  };
  collect(init.expression);
  return known ? keys : null;
}

/** keys of `{...a11yState({ … })}`; [] when there is no state at all, null when not a literal */
function spreadStateKeys(n: ts.JsxOpeningLikeElement): string[] | null {
  for (const p of n.attributes.properties) {
    if (!ts.isJsxSpreadAttribute(p) || !ts.isCallExpression(p.expression) || p.expression.expression.getText() !== 'a11yState') continue;
    const arg = p.expression.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
    return arg.properties.map((q) => q.name?.getText() ?? '');
  }
  return [];
}

/** `{...a11yState({ selected }, role)}` has its role argument (a toggle button needs it for aria-pressed) */
function spreadHasRole(n: ts.JsxOpeningLikeElement): boolean {
  return n.attributes.properties.some(
    (p) => ts.isJsxSpreadAttribute(p) && ts.isCallExpression(p.expression) && p.expression.expression.getText() === 'a11yState' && p.expression.arguments.length >= 2,
  );
}

function auditSource(rel: string, source: string, out: Finding[] = []): Finding[] {
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // `Switch` only counts when it is React Native's (Form.tsx / b/controls.tsx draw a visual-only knob of that name)
  const rnSwitch = sf.statements.some(
    (st) => ts.isImportDeclaration(st) && (st.moduleSpecifier as ts.StringLiteral).text === 'react-native' && /\bSwitch\b/.test(st.importClause?.getText() ?? ''),
  );
  const add = (n: ts.Node, rule: string, tag: string) => {
    if (ALLOW.has(`${rel}:${rule}:${tag}`)) return;
    out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, rule, tag });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagOf(n);
      const a = attrsOf(n);
      const hidden = hiddenFromA11y(a);
      const labelled = LABEL_ATTRS.some((k) => a.names.has(k));
      const el = elementOf(n);
      if (PRESSABLES.has(tag) && !hidden) {
        if (RAW_PRESSABLES.has(tag) && !ROLE_ATTRS.some((k) => a.names.has(k))) add(n, 'role', tag);
        if (!labelled && !childText(el)) add(n, 'name', tag);
        const inner = wrapsControl(el);
        if (inner) add(n, `nesting(${inner})`, tag);
      }
      if (SWITCHES.has(tag) && (tag !== 'Switch' || rnSwitch) && !hidden && !labelled) add(n, 'name', tag);
      const mirrored = a.spreads.some((s) => /webAriaState|a11yState/.test(s));
      if (tag !== 'PressableScale' && tag !== 'Button' && a.names.has('accessibilityState') && !mirrored) {
        const keys = stateKeys(a.names.get('accessibilityState'));
        if (keys === null || keys.some((k) => k !== 'disabled')) add(n, 'webState', tag);
      }
      // radio / checkbox / switch announce their value through `checked` (web: aria-checked; aria-selected is ignored there)
      const role = literal(a.names.get('accessibilityRole') ?? a.names.get('role'));
      if (role === 'radio' || role === 'checkbox' || role === 'switch') {
        const keys = a.names.has('accessibilityState') ? stateKeys(a.names.get('accessibilityState')) : spreadStateKeys(n);
        if (keys && !keys.includes('checked')) add(n, `checked(${role})`, tag);
      }
      // a button with selected / checked is a toggle: browsers ignore aria-selected / aria-checked there, so the web mirror needs the role
      if (role === 'button' && !a.names.has('accessibilityState')) {
        const keys = spreadStateKeys(n);
        if (keys?.some((k) => k === 'selected' || k === 'checked') && !spreadHasRole(n)) add(n, 'pressed(button)', tag);
      }
      for (const k of ['accessibilityLabel', 'accessibilityHint', 'aria-label']) {
        const v = literal(a.names.get(k));
        if (typeof v === 'string' && /\p{L}{2}/u.test(v)) add(n, 'literal', tag);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function audit(): Finding[] {
  const out: Finding[] = [];
  for (const file of walk(SRC, [])) auditSource(path.relative(SRC, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8'), out);
  return out;
}

test('screen-reader semantics of every control in app/src (role, name, nesting, web state, i18n)', () => {
  const found = audit();
  const lines = found.map((f) => `${f.file}:${f.line} <${f.tag}> ${f.rule}`);
  assert.deepEqual(lines, [], `a11y audit:\n${lines.join('\n')}`);
});

test('the audit itself catches the patterns it guards against', () => {
  // sanity: the parser sees the app (a broken SRC path would make the main test pass vacuously)
  assert.ok(walk(SRC, []).length > 100);
  const rules = (src: string) => auditSource('x.tsx', `import { Pressable, Switch, View } from 'react-native';\nexport const X = () => (${src});`).map((f) => f.rule);
  // no role; icon-only without a name
  assert.deepEqual(rules('<Pressable onPress={f}><Icon name="x" /></Pressable>'), ['role', 'name']);
  // fine: role + label, or text child, or explicitly out of the tree
  assert.deepEqual(rules('<Pressable onPress={f} accessibilityRole="button" accessibilityLabel={tr(\'a.b\')}><Icon name="x" /></Pressable>'), []);
  assert.deepEqual(rules('<Pressable onPress={f} accessibilityRole="button"><HText>{tr(\'a.b\')}</HText></Pressable>'), []);
  assert.deepEqual(rules('<Pressable onPress={f} accessible={false} />'), []);
  // a scrim wrapping the dialog's controls
  assert.deepEqual(rules('<Pressable onPress={close} accessibilityRole="button" accessibilityLabel={c}><View><Pressable accessibilityRole="button" accessibilityLabel={c} /></View></Pressable>'), ['nesting(Pressable)']);
  // raw state RNW drops; radio without checked; literal label; unlabelled RN Switch
  assert.deepEqual(rules('<Pressable accessibilityRole="button" accessibilityLabel={c} accessibilityState={{ expanded: open }} />'), ['webState']);
  assert.deepEqual(rules('<Pressable accessibilityRole="button" accessibilityLabel={c} {...a11yState({ expanded: open })} />'), []);
  assert.deepEqual(rules('<Pressable accessibilityRole="radio" accessibilityLabel={c} {...a11yState({ selected: on })} />'), ['checked(radio)']);
  assert.deepEqual(rules('<Pressable accessibilityRole="button" accessibilityLabel={c} {...a11yState({ selected: on })} />'), ['pressed(button)']);
  assert.deepEqual(rules('<Pressable accessibilityRole="button" accessibilityLabel={c} {...a11yState({ selected: on }, \'button\')} />'), []);
  assert.deepEqual(rules('<Pressable accessibilityRole="button" accessibilityLabel="Close" />'), ['literal']);
  assert.deepEqual(rules('<Switch value={v} onValueChange={f} />'), ['name']);
});
