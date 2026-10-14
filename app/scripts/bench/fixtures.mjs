// Synthetic, deterministic workloads for the benchmarks (example data only).

const WORDS = 'the quick answer covers prices, opening hours and a short comparison of three options with notes on delivery and service'.split(' ');

function words(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(i * 7 + seed * 13) % WORDS.length]);
  return out.join(' ');
}

/** a prose paragraph with inline markup, a link, a phone number and a date (entity detection) */
export function paragraph(seed) {
  return (
    `${words(18, seed)} **${words(3, seed + 1)}** and *${words(2, seed + 2)}*, see [example ${seed}](https://example.com/p/${seed}). ` +
    `${words(20, seed + 3)} \`code_${seed}\`, call +49 30 1234${String(seed % 100).padStart(2, '0')} or meet on 2026-10-${String((seed % 28) + 1).padStart(2, '0')} 14:30. ` +
    words(16, seed + 4) + '.'
  );
}

export function bulletList(n, seed) {
  return Array.from({ length: n }, (_, i) => `- **${words(2, seed + i)}**: ${words(14, seed + i + 5)}`).join('\n');
}

export function mdTable(rows, seed) {
  const head = '| Option | Price | Rating | Notes |\n|---|---:|:---:|---|';
  const body = Array.from({ length: rows }, (_, i) => `| Option ${seed}-${i} | ${(i * 3.7 + 10).toFixed(2)} € | ${(i % 5) + 1}/5 | ${words(6, seed + i)} |`);
  return [head, ...body].join('\n');
}

export function codeBlock(lines, seed) {
  const body = Array.from({ length: lines }, (_, i) => `  const value${i} = compute(${seed}, ${i}); // ${words(4, i)}`);
  return '```ts\nfunction example() {\n' + body.join('\n') + '\n}\n```';
}

export function huiTable(rows, seed) {
  return (
    '```hui\n' +
    JSON.stringify(
      {
        type: 'table',
        caption: `Comparison ${seed}`,
        columns: ['Name', 'Price (€)', 'Rating', 'Distance (km)'],
        rows: Array.from({ length: rows }, (_, i) => [`Place ${seed}-${i}`, Math.round((i * 7.3 + 9) * 100) / 100, (i % 5) + 1, Math.round(i * 13) / 10]),
      },
      null,
      1,
    ) +
    '\n```'
  );
}

export function huiProducts(n, seed) {
  return (
    '```hui\n' +
    JSON.stringify(
      {
        type: 'products',
        title: `Picks ${seed}`,
        items: Array.from({ length: n }, (_, i) => ({
          title: `Product ${seed}-${i}`,
          price: `${(i * 11.5 + 19).toFixed(2)} €`,
          rating: ((i % 5) + 1) * 0.9,
          url: `https://example.com/item/${seed}/${i}`,
          description: words(14, seed + i),
          specs: { weight: `${i + 1} kg`, color: 'grey' },
        })),
      },
      null,
      1,
    ) +
    '\n```'
  );
}

export function huiChecklist(n, seed) {
  return (
    '```hui\n' +
    JSON.stringify({ type: 'checklist', id: `list-${seed}`, title: `Steps ${seed}`, items: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: words(8, seed + i) })) }) +
    '\n```'
  );
}

/**
 * Long assistant answer: `sections` × (heading, paragraphs, list, one hui block, md table / code), about
 * 2.8 K chars per section.
 */
export function longAnswer(sections) {
  const parts = [];
  for (let s = 0; s < sections; s++) {
    parts.push(`## Section ${s + 1}: ${words(4, s)}`);
    parts.push(paragraph(s * 3));
    parts.push(paragraph(s * 3 + 1));
    parts.push(bulletList(5, s));
    const kind = s % 3;
    if (kind === 0) parts.push(huiTable(12, s));
    else if (kind === 1) parts.push(huiProducts(4, s));
    else parts.push(huiChecklist(6, s));
    parts.push(s % 2 ? mdTable(6, s) : codeBlock(12, s));
    parts.push(paragraph(s * 3 + 2));
  }
  return parts.join('\n\n') + '\n';
}

/** Plain markdown answer (no hui): `sections` × (heading, 3 paragraphs, list, table / code) */
export function longMarkdown(sections) {
  const parts = [];
  for (let s = 0; s < sections; s++) {
    parts.push(`### ${words(5, s)}`);
    parts.push(paragraph(s * 4), paragraph(s * 4 + 1));
    parts.push(bulletList(6, s));
    parts.push(s % 2 ? mdTable(8, s) : codeBlock(10, s));
    parts.push(paragraph(s * 4 + 2));
  }
  return parts.join('\n\n') + '\n';
}

export function chatMessage(i, text, role = i % 2 ? 'assistant' : 'user') {
  return { id: `${role[0]}-${i}`, role, text, tools: [], status: 'done', createdAt: 1_700_000_000_000 + i * 1000 };
}

/** `n` stored messages (alternating user / assistant answers of ~1.5 K chars) */
export function longChat(n) {
  return Array.from({ length: n }, (_, i) => chatMessage(i, i % 2 ? paragraph(i) + '\n\n' + bulletList(4, i) + '\n\n' + paragraph(i + 1) : `Question ${i}: ${words(20, i)}`));
}

/** Hermes session rows: `turns` × (user, assistant with a tool call, tool result, final assistant). `extract`: the
 * tool is a web extract whose result carries the full page text (5 pages × `extract` chars) */
export function hermesRows(turns, extract = 0) {
  const rows = [];
  let id = 1000;
  let ts = 1_790_000_000;
  for (let t = 0; t < turns; t++) {
    rows.push({ id: String(id++), role: 'user', content: `Question ${t}: ${words(16, t)}`, timestamp: ts++ });
    const call = `call-test-${t}`;
    rows.push({
      id: String(id++),
      role: 'assistant',
      content: `<think>${words(30, t)}</think>Let me look that up.`,
      toolCalls: [{ id: call, name: 'web_search', arguments: JSON.stringify({ query: words(5, t) }) }],
      timestamp: ts++,
    });
    const page = (k) => (extract ? { content: (words(40, k) + '\n\n').repeat(Math.ceil(extract / 260)).slice(0, extract) } : { snippet: words(25, k) });
    rows.push({ id: String(id++), role: 'tool', toolCallId: call, content: JSON.stringify({ results: Array.from({ length: 5 }, (_, k) => ({ title: words(5, k), url: `https://example.com/${t}/${k}`, ...page(k) })) }), timestamp: ts++ });
    rows.push({ id: String(id++), role: 'assistant', content: paragraph(t) + '\n\n' + bulletList(4, t) + '\n\n' + paragraph(t + 1), finishReason: 'stop', timestamp: ts++ });
  }
  return rows;
}
