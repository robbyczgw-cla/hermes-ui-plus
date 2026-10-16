// Pure checks on the dictionaries (used by i18nQuality.test.ts).

export type Flat = Record<string, string>;

export function flatten(o: object, prefix = ''): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

/** `{name}` / `{count, plural, ...}` variable names of a message, including the ones used inside plural branches. */
export function placeholders(template: string): string[] {
  const names = new Set<string>();
  const walk = (s: string): void => {
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '{') {
        i++;
        continue;
      }
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) break;
      }
      const inner = s.slice(i + 1, j);
      const m = /^\s*(\w+)\s*(?:,\s*plural\s*,([\s\S]*))?$/.exec(inner);
      if (m) {
        names.add(m[1]);
        if (m[2] !== undefined) {
          // branches: selector {text}
          const body = m[2];
          let k = 0;
          while (k < body.length) {
            const sel = /^\s*(=\d+|\w+)\s*\{/.exec(body.slice(k));
            if (!sel) break;
            const open = k + sel[0].length - 1;
            let d = 0;
            let e = open;
            for (; e < body.length; e++) {
              if (body[e] === '{') d++;
              else if (body[e] === '}' && --d === 0) break;
            }
            walk(body.slice(open + 1, e));
            k = e + 1;
          }
        }
      }
      i = j + 1;
    }
  };
  walk(template);
  return [...names].sort();
}

/** Structural problems of one message: unbalanced braces, plural without `other`. */
export function syntaxProblems(template: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const ch of template) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) break;
  }
  if (depth !== 0) out.push('unbalanced braces');
  for (const m of template.matchAll(/\{\s*\w+\s*,\s*plural\s*,/g)) {
    // the matching group must contain an `other` branch
    let d = 0;
    let end = m.index!;
    for (; end < template.length; end++) {
      if (template[end] === '{') d++;
      else if (template[end] === '}' && --d === 0) break;
    }
    if (!/(^|[\s}])other\s*\{/.test(template.slice(m.index!, end))) out.push('plural without "other"');
  }
  return out;
}
