/// <reference types="node" />
// Which Markdown paragraphs become a file card on the web (fileLinks.ts): an agent server's signed files
// (`[name](…/v1/attachments/<signed>) (2 KB)`) and links to files by extension; ordinary links stay links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileLinkOf, fileLinkParagraph, parseSizeText } from './fileLinks.ts';

const SIGNED = 'https://n.example.ts.net:10443/v1/attachments/eyJ1IjoiYm9iIn0.c2lnbmF0dXJl';

test('adapter file paragraph: name from the link text, type by extension, size, download variant', () => {
  assert.deepEqual(fileLinkParagraph(`[Rechnung März 2026.pdf](${SIGNED}) (2 KB)`), {
    href: SIGNED,
    name: 'Rechnung März 2026.pdf',
    mime: 'application/pdf',
    kind: 'pdf',
    downloadUrl: `${SIGNED}?download=1`,
    sizeText: '2 KB',
  });
  assert.equal(fileLinkParagraph(`[bericht.docx](${SIGNED}) (1.4 MB)`)?.kind, 'doc');
  assert.equal(fileLinkParagraph(`[r.pdf](${SIGNED})`)?.sizeText, undefined);
  assert.equal(fileLinkParagraph(`[Notiz (1).pdf](${SIGNED}) (12 KB)`)?.name, 'Notiz (1).pdf');
});

test('links to files by URL extension (name from the path when the text is not a file name)', () => {
  const l = fileLinkParagraph('[Hier das Handbuch](https://example.com/docs/Handbuch%202026.pdf)');
  assert.equal(l?.name, 'Handbuch 2026.pdf');
  assert.equal(l?.downloadUrl, undefined);
  assert.equal(fileLinkOf('Tabelle', 'https://example.com/t.xlsx?x=1')?.kind, 'sheet');
});

test('root-relative adapter links (no public origin configured) resolve against the page', () => {
  const l = fileLinkParagraph('[r.pdf](/v1/attachments/eyJ1IjoiYiJ9.c2ln) (2 KB)', 'https://app.example/chat/1');
  assert.equal(l?.href, 'https://app.example/v1/attachments/eyJ1IjoiYiJ9.c2ln');
  assert.equal(l?.downloadUrl, 'https://app.example/v1/attachments/eyJ1IjoiYiJ9.c2ln?download=1');
  assert.equal(fileLinkParagraph('[r.pdf](/v1/attachments/x.y)'), null, 'no base (native): not resolvable');
  assert.equal(fileLinkParagraph('[r.pdf](//evil.example/r.pdf)', 'https://app.example/'), null, 'protocol-relative is not root-relative');
});

test('ordinary links, prose and unsafe schemes stay as they are', () => {
  assert.equal(fileLinkParagraph('[Wikipedia](https://de.wikipedia.org/wiki/PDF)'), null);
  assert.equal(fileLinkParagraph(`Siehe [r.pdf](${SIGNED}) für Details.`), null, 'inside a sentence');
  assert.equal(fileLinkParagraph('[x.pdf](javascript:alert(1))'), null);
  assert.equal(fileLinkParagraph('[x.pdf](file:///etc/x.pdf)'), null);
  assert.equal(fileLinkParagraph(`[kein name](${SIGNED})`), null, 'signed URL without a file name in the text: unknown type');
  assert.equal(fileLinkParagraph(`[r.pdf](${SIGNED}) (Anhang)`)?.sizeText, undefined, 'non-size parenthesis ignored');
});

test('parseSizeText', () => {
  assert.equal(parseSizeText('2 KB'), 2000);
  assert.equal(parseSizeText('1.4 MB'), 1_400_000);
  assert.equal(parseSizeText('1,5 MB'), 1_500_000);
  assert.equal(parseSizeText('512 B'), 512);
  assert.equal(parseSizeText('viel'), undefined);
  assert.equal(parseSizeText(undefined), undefined);
});
