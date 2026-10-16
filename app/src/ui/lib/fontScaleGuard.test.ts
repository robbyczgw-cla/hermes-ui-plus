/// <reference types="node" />
/**
 * Static guard for layouts that clipped at large system font scale (1.3 / 2.0, web check with scaled text):
 * - text-holding buttons and rows use minHeight, never a fixed height (a wrapped label grew out of the box:
 *   "New chat" spilled out of the drawer button at 2.0)
 * - the settings header sides are minWidth, not width ("Done" was cut to "D…")
 * - the approval card scrolls inside a shrinkable column (at 1.3 it pushed the composer off-screen, at 2.0 the
 *   "For this task" / "Always allow" choices were unreachable)
 * TypeScript AST over the source, no rendering. Run: scripts/check.sh test src/ui/lib/fontScaleGuard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, fs.readFileSync(path.join(SRC, rel), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** property names of `key: { … }` inside StyleSheet.create({ … }) */
function styleKeys(sf: ts.SourceFile, key: string): Set<string> | null {
  let found: Set<string> | null = null;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'StyleSheet.create' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of n.arguments[0].properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(sf) === key && ts.isObjectLiteralExpression(p.initializer)) {
          found = new Set(p.initializer.properties.map((q) => q.name?.getText(sf) ?? ''));
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function tagName(n: ts.JsxOpeningLikeElement): string {
  return n.tagName.getText();
}

test('text-holding buttons and rows grow with their label (minHeight, no fixed height)', () => {
  const cases: Record<string, string[]> = {
    // new chat / select / dialog actions are the one Button since the app identity (minHeight 36/44 there)
    'conversations/ConversationList.tsx': ['olderRow', 'footer', 'menuItem'],
  };
  for (const [file, keys] of Object.entries(cases)) {
    const sf = parse(file);
    for (const k of keys) {
      const props = styleKeys(sf, k);
      assert.ok(props, `${file}: style ${k} not found`);
      assert.equal(props.has('height'), false, `${file}: ${k} has a fixed height`);
      assert.equal(props.has('minHeight'), true, `${file}: ${k} lost its minHeight`);
    }
  }
});

test('settings header sides may grow ("Done" / "Back" at large text)', () => {
  const props = styleKeys(parse('settings/SettingsScreen.tsx'), 'headerSide');
  assert.ok(props);
  assert.equal(props.has('width'), false);
  assert.equal(props.has('minWidth'), true);
});

test('the approval card scrolls inside a shrinkable column', () => {
  const stack = parse('approvals/ApprovalStack.tsx');
  let sheetInScroll = false;
  const visit = (n: ts.Node, inScroll: boolean) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const open = ts.isJsxElement(n) ? n.openingElement : n;
      if (tagName(open) === 'ApprovalSheet' && inScroll) sheetInScroll = true;
      const scroll = inScroll || tagName(open) === 'ScrollView';
      ts.forEachChild(n, (c) => visit(c, scroll));
      return;
    }
    ts.forEachChild(n, (c) => visit(c, inScroll));
  };
  visit(stack, false);
  assert.equal(sheetInScroll, true, 'ApprovalSheet must render inside a ScrollView');
  assert.equal(styleKeys(stack, 'wrap')?.has('flexShrink'), true, 'ApprovalStack wrap must shrink');
  assert.equal(styleKeys(stack, 'scroll')?.has('flexShrink'), true, 'the scroll box must shrink');
  const chat = parse('chat/ChatView.tsx');
  assert.equal(styleKeys(chat, 'approvalCol')?.has('flexShrink'), true, 'ChatView approval column must shrink');
  assert.match(chat.text, /style=\{\[styles\.approvalCol, columnStyle\]\}>\s*<ApprovalStack/, 'ChatView must wrap ApprovalStack in the shrinkable column');
});
