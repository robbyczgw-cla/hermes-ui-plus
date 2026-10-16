// describeCall (ported from Pi Pocket `web/calls.js`, MIT, © 2026 Tanner Middleton – see NOTICE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCall } from './calls.ts';

test('file tools show their path, a read its range', () => {
  assert.deepEqual(describeCall({ name: 'read', args: { path: 'src/a.ts', offset: 10, limit: 20 } }), { icon: '▤', label: 'Read', subject: 'src/a.ts:10+20', mono: true });
  assert.equal(describeCall({ name: 'read', args: { path: 'src/a.ts' } }).subject, 'src/a.ts');
  assert.equal(describeCall({ name: 'edit', args: { path: 'b.ts' } }).label, 'Edit');
  assert.equal(describeCall({ name: 'write', args: {} }).subject, '');
});

test('bash shows its command on one line, cut short', () => {
  const line = describeCall({ name: 'bash', args: { command: 'npm   test\n  -- --watch' } });
  assert.deepEqual(line, { icon: '>_', label: '', subject: 'npm test -- --watch', mono: true });
  const long = describeCall({ name: 'bash', args: { command: 'x'.repeat(200) } }).subject;
  assert.equal(long.length, 140);
  assert.ok(long.endsWith('…'));
});

test('codemode shows its first line that does something', () => {
  assert.equal(describeCall({ name: 'codemode', args: { code: '\n// options\n  const a = 1;\nreturn a;' } }).subject, 'const a = 1;');
});

test('browser shows what it acts on, and what it typed', () => {
  assert.equal(describeCall({ name: 'browser', args: { action: 'open', url: 'https://example.com' } }).subject, 'https://example.com');
  assert.equal(describeCall({ name: 'browser', args: { action: 'click', ref: '[e12]' } }).subject, '[e12]');
  assert.equal(describeCall({ name: 'browser', args: { action: 'type', selector: '#q', text: 'hello' } }).subject, '#q ← “hello”');
  assert.equal(describeCall({ name: 'browser', args: { action: 'type', text: 'hi' } }).subject, '“hi”');
  assert.equal(describeCall({ name: 'browser', args: { action: 'click', label: 'Save' } }).label, 'Browser click');
});

test('subagents, artifacts and other tools', () => {
  assert.equal(describeCall({ name: 'subagent', args: { action: 'spawn', name: 'tests', message: 'run them' } }).subject, 'tests · run them');
  assert.deepEqual(describeCall({ name: 'artifact', args: { id: 'a1', title: 'Report' } }), { icon: '✦', label: 'Artifact', subject: 'Report', mono: false });
  assert.deepEqual(describeCall({ name: 'mcp_x', args: { q: 1 } }), { icon: '⚙', label: 'mcp_x', subject: '{"q":1}', mono: true });
  assert.equal(describeCall({ name: 'mcp_x' }).subject, '{}');
});
