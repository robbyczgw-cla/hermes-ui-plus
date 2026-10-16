#!/usr/bin/env node
// related-tests: what `scripts/check.sh quick` runs for the current change. No dependencies.
//
//   related-tests.mjs [--base REF] [--json | --sh]      (run anywhere inside the repo; default output: --json)
//
// Changed files = merge-base(HEAD, REF; default main) vs the working tree: committed + staged + unstaged changes and
// untracked files. Renames count as delete + add; deleted files count as changed.
// Areas, each with the tests `check.sh all` runs for it: app (app/src/**/*.test.ts), scripts (scripts/*.test.mjs,
// scripts/e2e/*.test.mjs) and bridge (bridge/test/security-*.test.mjs). A test is related when
//   - it changed itself (a changed test is also mapped like any other file: tests that import or name it run too),
//   - it (transitively) imports a changed file: static import / export-from / side-effect import / require / literal
//     import(), relative specifiers resolved like the bundler (.ts/.tsx/.js/.mjs/.json, '.js' -> '.ts', /index.*,
//     React Native platform suffixes .native/.ios/.android/.web),
//   - it mentions the changed file: the basename in its source, or a './' '../' literal (also a template prefix) that
//     resolves to the file or a parent directory. Scripts tests spawn scripts that source/spawn others: there the
//     mentions of every scripts/ code file the test reaches count too,
//   - it reads directories (readdir/glob calls, `git ls-files`) and the change is inside its area or a directory it
//     names (a quoted path or directory name),
//   - its import graph has an unresolved relative specifier or a non-literal import()/require() (an "unsure" test:
//     it runs whenever its area changed).
// An area runs in FULL (exactly what `check.sh all` runs for it) when the mapping is unsure: package.json / lock /
// patches, tsconfig, metro/babel/app config, test helpers and fixtures, a changed code file with an unresolvable
// relative import or that cannot be read, a non-code file under app/src|locales|brand that no test reaches (fs-loaded
// data), or a changed file that more than THRESHOLD of the area's tests depend on (the full run costs about the same).
// check.sh, scripts/lib/heavy.sh and this script make every area run in full.
// tsc runs when a file tsc sees changed (app/**/*.ts|tsx|js|json incl. tsconfig/package.json, or a file outside app/
// that app code imports); only changed *.test.ts -> only tsconfig.test.json.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const THRESHOLD = 0.3;
const MAX_BYTES = 2 * 1024 * 1024;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const RESOLVE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const PLATFORMS = ['', '.native', '.ios', '.android', '.web'];

export const AREAS = {
  app: { root: 'app/', isTest: (p) => /^app\/src\/(.+\/)?[^/]+\.test\.ts$/.test(p) },
  scripts: { root: 'scripts/', isTest: (p) => /^scripts\/(e2e\/)?[^/]+\.test\.mjs$/.test(p) },
  bridge: { root: 'bridge/', isTest: (p) => /^bridge\/test\/security-[^/]+\.test\.mjs$/.test(p) },
};
// every area in full: the check runner and this mapping
const GLOBAL_FULL = /^(scripts\/check\.sh|scripts\/lib\/(related-tests\.mjs|heavy\.sh)|\.nvmrc|\.node-version|package(-lock)?\.json)$/;
// one area in full: dependencies, compiler / bundler / Expo config
const AREA_FULL = {
  app: /^app\/(package(-lock)?\.json|patches\/.+|tsconfig[^/]*\.json|(metro|babel)\.config\.[cm]?js|app\.json|app\.config\.[cm]?[jt]s|expo-env\.d\.ts)$/,
  scripts: /^scripts\/package(-lock)?\.json$/,
  bridge: /^bridge\/(package(-lock)?\.json|patches\/.+)$/,
};
// test helpers and fixtures (path based: what they feed is not visible in the import graph)
const HELPER = new RegExp(
  [
    '(^|/)(__)?(fixtures?|mocks|test-?helpers?|test-?utils?|testing|testkit)(__)?/',
    '(^|/)[^/]*[.-](mocks?|helpers)\\.[cm]?[jt]sx?$',
    '(^|/)[^/]*([Ff]ixtures?|[Tt]est-?[Kk]it|[Tt]est-?[Hh]elpers?|[Tt]est-?[Uu]tils?)[^/]*\\.[cm]?[jt]sx?$',
    '(^|/)(test|tests|__tests__)/(?![^/]*\\.test\\.)[^/]+$',
  ].join('|'),
);
// non-code files there are usually loaded at runtime (fs, Expo config), not imported: unreached = unsure
const FS_DATA = /^app\/(src|locales|brand)\//;
// directory readers: fs calls in code (not in strings or comments), or a spawned `git ls-files`
const SCANNER = /\b(readdir|readdirSync|opendir|opendirSync|glob|globSync)\s*\(/;
const SHELLISH = /\.(sh|bash|py)$/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const areaOf = (p) => Object.keys(AREAS).find((a) => p.startsWith(AREAS[a].root)) ?? null;
const testAreaOf = (p) => Object.keys(AREAS).find((a) => AREAS[a].isTest(p)) ?? null;
const ancestors = (p) => {
  const out = [];
  for (let d = posix.dirname(p); d !== '.' && d !== '/'; d = posix.dirname(d)) out.push(d);
  return out;
};

const REGEX_BEFORE = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await', 'delete', 'throw', 'new']);

/**
 * Blanks comments and string / template / regex contents (length and newlines kept) so regexes see only code.
 * Returns {code, strings: Map(offset of the opening quote -> {text, head, tpl, interp})}; head = text before the
 * first ${...} of a template. A heuristic lexer: good enough for import specifiers, not a parser.
 */
export function lex(s) {
  const n = s.length;
  const out = s.split('');
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const strings = new Map();
  const tpls = []; // open templates: {start, parts, depth}
  let depth = 0;
  let i = 0;
  // scan a template chunk from i (just after ` or }) to the closing ` or the next ${
  const chunk = (t, from) => {
    let j = from;
    while (j < n && s[j] !== '`' && !(s[j] === '$' && s[j + 1] === '{')) j += s[j] === '\\' ? 2 : 1;
    t.parts.push(s.slice(from, j));
    blank(from, j);
    if (j < n && s[j] === '$') {
      t.depth = depth;
      tpls.push(t);
      return j + 2;
    }
    strings.set(t.start, { text: t.parts.join('${}'), head: t.parts[0], tpl: true, interp: t.parts.length > 1 });
    return j + 1;
  };
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const e = s.indexOf('\n', i);
      blank(i, e < 0 ? n : e);
      i = e < 0 ? n : e;
    } else if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      blank(i, e < 0 ? n : e + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      strings.set(i, { text: s.slice(i + 1, j), head: s.slice(i + 1, j), tpl: false, interp: false });
      blank(i + 1, j);
      i = j + 1;
    } else if (c === '`') {
      i = chunk({ start: i, parts: [] }, i + 1);
    } else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      if (tpls.length && tpls.at(-1).depth === depth) i = chunk(tpls.pop(), i + 1);
      else {
        depth--;
        i++;
      }
    } else if (c === '/') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(out[k])) k--;
      let word = '';
      for (let w = k; w >= 0 && /[\w$]/.test(s[w]); w--) word = s[w] + word;
      if (k < 0 || REGEX_BEFORE.test(s[k]) || REGEX_KEYWORDS.has(word)) {
        let j = i + 1;
        let cls = false;
        while (j < n && s[j] !== '\n' && (cls || s[j] !== '/')) {
          if (s[j] === '\\') j++;
          else if (s[j] === '[') cls = true;
          else if (s[j] === ']') cls = false;
          j++;
        }
        blank(i + 1, j);
        i = j + 1;
      } else i++;
    } else i++;
  }
  return { code: out.join(''), strings };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
const zsplit = (s) => s.split('\0').filter(Boolean);

/** Changed files vs merge-base(HEAD, base), working tree included. Returns {mergeBase, changed: [{path, status}]}. */
export function listChanged(root, base = 'main') {
  let mergeBase;
  try {
    mergeBase = git(root, ['merge-base', 'HEAD', base]).trim();
  } catch (e) {
    throw new Error(`no merge-base of HEAD and '${base}' (${(e.stderr || e.message).toString().trim()}); pass --base REF`);
  }
  const changed = new Map();
  const raw = zsplit(git(root, ['diff', '--name-status', '-z', '--no-renames', mergeBase]));
  for (let i = 0; i + 1 < raw.length; i += 2) changed.set(raw[i + 1], raw[i][0]);
  for (const p of zsplit(git(root, ['ls-files', '-z', '--others', '--exclude-standard']))) changed.set(p, '?');
  return { mergeBase, changed: [...changed].map(([path, status]) => ({ path, status })).sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Every existing tracked or untracked (not ignored) file. */
export function listFiles(root) {
  const out = [];
  for (const p of new Set(zsplit(git(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard'])))) {
    try {
      if (lstatSync(join(root, p)).isFile()) out.push(p);
    } catch {
      // tracked but deleted in the working tree
    }
  }
  return out;
}

export function makeGraph(root, files) {
  const fileSet = new Set(files);
  const byBase = new Map(); // basename -> scripts/ code files (mention edges between scripts)
  for (const f of files) {
    if (!f.startsWith('scripts/') || !(CODE.test(f) || SHELLISH.test(f))) continue;
    const b = posix.basename(f);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const src = new Map();
  const read = (p) => {
    if (!src.has(p)) {
      let s = null;
      try {
        const st = lstatSync(join(root, p));
        if (st.isFile() && st.size <= MAX_BYTES) s = readFileSync(join(root, p), 'utf8');
      } catch {
        // unreadable: null
      }
      src.set(p, s);
    }
    return src.get(p);
  };

  const resolveSpec = (from, spec) => {
    const clean = spec.split(/[?#]/)[0].replace(/\/+$/, '');
    const base = posix.normalize(posix.join(posix.dirname(from), clean || '.'));
    if (base.startsWith('../')) return []; // outside the repo: not ours
    if (fileSet.has(base)) return [base];
    const stems = [base];
    if (/\.[cm]?jsx?$/.test(base)) stems.push(base.replace(/\.[cm]?jsx?$/, ''));
    const out = [];
    for (const s of [...stems, `${base}/index`]) for (const p of PLATFORMS) for (const e of RESOLVE_EXT) if (fileSet.has(s + p + e)) out.push(s + p + e);
    return out;
  };

  const parsed = new Map();
  /** {deps: string[], unresolved: string[], dynamic: boolean, unreadable: boolean} for a code file. */
  const parse = (p) => {
    if (parsed.has(p)) return parsed.get(p);
    const r = { deps: [], unresolved: [], dynamic: false, unreadable: false, scanner: false, mentions: [], strings: [] };
    parsed.set(p, r);
    const s = read(p);
    if (s === null) {
      r.unreadable = true;
      return r;
    }
    const lexed = CODE.test(p) ? lex(s) : null;
    r.strings = lexed ? [...lexed.strings.values()] : [];
    r.scanner = SCANNER.test(lexed ? lexed.code : s) || r.strings.some((x) => /^ls-files$|\bgit ls-files\b/.test(x.text));
    if (lexed) {
      const specs = [];
      const at = (m) => lexed.strings.get(m.index + m[0].length - 1);
      for (const re of [/\bfrom\s*['"]/g, /(?<![.\w$])import\s*['"]/g, /(?<![.\w$])(?:import|require)\s*\(\s*['"`]/g]) {
        for (const m of lexed.code.matchAll(re)) {
          const lit = at(m);
          if (lit?.interp) r.dynamic = true;
          else if (lit) specs.push(lit.text);
        }
      }
      if (/(?<![.\w$])(?:import|require)\s*\(\s*(?![\s'"`)])/.test(lexed.code)) r.dynamic = true;
      for (const spec of new Set(specs)) {
        if (/^(@|~)\//.test(spec)) r.unresolved.push(spec); // path alias: not resolved here
        if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '.' && spec !== '..') continue;
        const t = resolveSpec(p, spec);
        if (t.length) r.deps.push(...t);
        else r.unresolved.push(spec);
      }
    }
    if (p.startsWith('scripts/') && (CODE.test(p) || SHELLISH.test(p))) {
      // shell / python: any mention (sourced, spawned); JS: only inside string literals (spawned), not in comments.
      // 'e2e/mock.mjs' names that file; a bare 'mock.mjs' prefers the one next to the mentioning file
      const text = lexed ? r.strings.map((x) => x.text).join('\n') : s;
      for (const m of text.matchAll(/[\w.@+/-]*?([\w@+-][\w.@+-]*\.(?:sh|bash|py|mjs|cjs|js|ts))\b/g)) {
        const cands = (byBase.get(m[1]) ?? []).filter((t) => t !== p);
        const dir = m[0].replace(/^(\.{0,2}\/)+/, '').slice(0, -m[1].length).replace(/\/$/, '');
        const named = dir ? cands.filter((t) => posix.dirname(t).endsWith(dir)) : [];
        const near = cands.filter((t) => posix.dirname(t) === posix.dirname(p));
        r.mentions.push(...(named.length ? named : near.length ? near : cands));
      }
    }
    return r;
  };

  /** Files reachable from a test or a list of roots (included), plus unsure flags. Mention edges: scripts tests. */
  const closure = (roots, mentionEdges) => {
    const seen = new Set([roots].flat());
    const queue = [...seen];
    const unsure = [];
    while (queue.length) {
      const f = queue.pop();
      if (!CODE.test(f) && !SHELLISH.test(f)) continue;
      const r = parse(f);
      if (r.unresolved.length) unsure.push(`${f}: unresolved ${r.unresolved.slice(0, 3).join(', ')}`);
      if (r.dynamic && CODE.test(f)) unsure.push(`${f}: non-literal import()/require()`);
      for (const d of mentionEdges ? [...r.deps, ...r.mentions] : r.deps) {
        if (!seen.has(d)) {
          seen.add(d);
          queue.push(d);
        }
      }
    }
    return { files: seen, unsure };
  };

  /** './' '../' literals of a file, resolved: [{path, prefix}] (prefix: cut at a template ${...}). */
  const relLiterals = (p) => {
    const out = [];
    for (const lit of parse(p).strings) {
      if (!/^\.{1,2}\//.test(lit.head)) continue;
      const path = posix.normalize(posix.join(posix.dirname(p), lit.head)).replace(/\/+$/, '');
      if (!path.startsWith('..') && path !== '.') out.push({ path, prefix: lit.interp });
    }
    return out;
  };

  return { fileSet, read, parse, closure, relLiterals };
}

/**
 * The plan for a list of changed files. `files` = every existing file (listFiles).
 * Returns {mode, global, reasons, tsc: {app, test}, areas: {app|scripts|bridge: {mode, total, tests, reasons}}, notes}.
 */
export function buildPlan(root, changedList, files, { threshold = THRESHOLD } = {}) {
  const g = makeGraph(root, files);
  const changed = changedList.map((c) => c.path);
  const plan = { mode: 'none', global: false, reasons: [], tsc: { app: false, test: false }, areas: {}, notes: [] };
  const areas = {};
  for (const a of Object.keys(AREAS)) {
    const tests = files.filter(AREAS[a].isTest).sort();
    areas[a] = { tests, full: [], selected: new Map(), info: new Map() };
  }

  for (const p of changed) if (GLOBAL_FULL.test(p)) plan.reasons.push(`${p}: check runner / mapping changed`);
  plan.global = plan.reasons.length > 0;

  // per-test closure, mentions, scanner flag
  for (const a of Object.keys(AREAS)) {
    for (const t of areas[a].tests) {
      const c = g.closure(t, a === 'scripts');
      const sources = [t, ...(a === 'scripts' ? [...c.files].filter((f) => f !== t && f.startsWith('scripts/') && (CODE.test(f) || SHELLISH.test(f))) : [])];
      areas[a].info.set(t, { files: c.files, unsure: c.unsure, scanner: g.parse(t).scanner, sources, rel: g.relLiterals(t) });
    }
  }
  const mentions = (info, p) => {
    const re = new RegExp(`(^|[^\\w.-])${esc(posix.basename(p))}($|[^\\w-])`);
    if (info.sources.some((f) => re.test(g.read(f) ?? ''))) return true;
    return info.rel.some((r) => p === r.path || p.startsWith(`${r.path}/`) || (r.prefix && p.startsWith(r.path)));
  };
  const scans = (info, t, a, p) => {
    if (!info.scanner) return false;
    if (p.startsWith(AREAS[a].root)) return true;
    const s = g.read(t) ?? '';
    return ancestors(p).some((d) => new RegExp(`['"\`](${esc(d)}|${esc(posix.basename(d))})['"\`]`).test(s));
  };

  const touched = new Set(); // areas with any change inside them
  for (const p of changed) {
    const a = areaOf(p);
    if (a) touched.add(a);
  }

  for (const p of changed) {
    // a changed test runs itself, and whatever imports / names it (shared test modules, scanners)
    const ta = testAreaOf(p);
    if (ta) {
      if (g.fileSet.has(p)) areas[ta].selected.set(p, 'changed');
      else plan.notes.push(`${p}: deleted test`);
    }
    const own = areaOf(p);
    if (!ta && own && AREA_FULL[own].test(p)) {
      areas[own].full.push(`${p}: dependencies / config`);
      continue;
    }
    // which tests reach p (imports or mentions), per area; scanners separately (they do not count for the threshold)
    const reach = {};
    for (const a of Object.keys(AREAS)) {
      reach[a] = [];
      for (const [t, info] of areas[a].info) {
        if (info.files.has(p) || mentions(info, p)) reach[a].push(t);
        else if (scans(info, t, a, p) && !areas[a].selected.has(t)) areas[a].selected.set(t, `reads directories (${p})`);
      }
    }
    if (ta) {
      // no helper / resolve / data rules for tests: they run themselves; only the threshold below applies
    } else if (HELPER.test(p)) {
      const hit = Object.keys(AREAS).filter((a) => a === own || reach[a].length);
      for (const a of hit) areas[a].full.push(`${p}: test helper / fixture`);
      continue;
    } else if (g.fileSet.has(p) && CODE.test(p) && (g.parse(p).unreadable || g.parse(p).unresolved.length)) {
      const r = g.parse(p);
      const hit = Object.keys(AREAS).filter((a) => a === own || reach[a].length);
      for (const a of hit) areas[a].full.push(`${p}: ${r.unreadable ? 'cannot be read' : `unresolved import ${r.unresolved[0]}`}`);
      continue;
    } else if (FS_DATA.test(p) && !CODE.test(p) && !reach.app.length) {
      areas.app.full.push(`${p}: data file no test imports or names (loaded at runtime)`);
      continue;
    }
    for (const a of Object.keys(AREAS)) {
      const n = reach[a].length;
      const total = areas[a].tests.length;
      if (n && total && n / total > threshold) areas[a].full.push(`${p}: ${n}/${total} tests depend on it (> ${Math.round(threshold * 100)} %)`);
      else for (const t of reach[a]) if (!areas[a].selected.has(t)) areas[a].selected.set(t, areas[a].info.get(t).files.has(p) ? `${a === 'scripts' ? 'reaches' : 'imports'} ${p}` : `mentions ${p}`);
    }
  }
  // unsure tests (graph not fully resolved) run whenever their area changed
  for (const a of touched) for (const [t, info] of areas[a].info) if (info.unsure.length && !areas[a].selected.has(t)) areas[a].selected.set(t, `unsure: ${info.unsure[0]}`);

  // tsc: app files tsc sees, or files outside app/ that app code imports
  const appCode = files.filter((f) => f.startsWith('app/') && /\.(ts|tsx)$/.test(f) && !AREAS.app.isTest(f));
  const appReach = new Set();
  for (const d of g.closure(appCode, false).files) appReach.add(d);
  for (const info of areas.app.info.values()) for (const d of info.files) appReach.add(d);
  for (const p of changed) {
    const tscSees = (p.startsWith('app/') && /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/.test(p)) || appReach.has(p) || AREA_FULL.app.test(p);
    if (!tscSees) continue;
    plan.tsc.test = true;
    if (!AREAS.app.isTest(p)) plan.tsc.app = true;
  }
  if (plan.global) plan.tsc = { app: true, test: true };

  for (const a of Object.keys(AREAS)) {
    const x = areas[a];
    const full = plan.global || x.full.length > 0;
    const tests = full ? x.tests : x.tests.filter((t) => x.selected.has(t));
    plan.areas[a] = {
      mode: full ? 'full' : tests.length ? 'related' : 'none',
      total: x.tests.length,
      tests,
      reasons: plan.global ? ['global'] : x.full,
      unsure: tests.filter((t) => x.info.get(t).unsure.length && !full).length,
      why: full ? {} : Object.fromEntries(tests.map((t) => [t, x.selected.get(t)])),
    };
  }
  const modes = Object.values(plan.areas).map((x) => x.mode);
  // full = everything (global); area-full = at least one area in full; related = only related tests / tsc
  plan.mode = plan.global ? 'full' : modes.includes('full') ? 'area-full' : modes.includes('related') || plan.tsc.app || plan.tsc.test ? 'related' : 'none';
  return plan;
}

export function cacheDir(root, env = process.env) {
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'hui-check', createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16));
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function describe(plan, changed) {
  const lines = [`quick plan: ${changed.length} changed file(s) vs ${plan.mergeBase?.slice(0, 10) ?? '?'} (${plan.base}), mode ${plan.mode}`];
  for (const r of plan.reasons) lines.push(`  full: ${r}`);
  lines.push(`  tsc: ${plan.tsc.app ? 'app' : ''}${plan.tsc.app && plan.tsc.test ? ' + ' : ''}${plan.tsc.test ? 'test' : ''}${plan.tsc.app || plan.tsc.test ? '' : 'skip (nothing tsc sees changed)'}`);
  for (const [a, x] of Object.entries(plan.areas)) {
    lines.push(`  ${a}: ${x.mode}, ${x.tests.length}/${x.total} tests${x.unsure ? ` (${x.unsure} unsure: graph not fully resolved)` : ''}`);
    if (!plan.global) for (const r of x.reasons.slice(0, 5)) lines.push(`    full: ${r}`);
    if (x.reasons.length > 5) lines.push(`    ... ${x.reasons.length - 5} more`);
  }
  for (const n of plan.notes) lines.push(`  note: ${n}`);
  return lines.join('\n');
}

export function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  let base = 'main';
  let format = 'json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) base = argv[++i];
    else if (argv[i] === '--json' || argv[i] === '--sh') format = argv[i].slice(2);
    else {
      console.error(`usage: related-tests.mjs [--base REF] [--json | --sh]`);
      return 2;
    }
  }
  let root;
  let res;
  try {
    root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
    res = listChanged(root, base);
  } catch (e) {
    console.error(`related-tests: ${e.message.trim()}`);
    return 2;
  }
  const plan = { base, mergeBase: res.mergeBase, changed: res.changed, ...buildPlan(root, res.changed, listFiles(root)), cache: cacheDir(root, env) };
  if (format === 'json') {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  console.error(describe(plan, res.changed));
  const out = [
    `Q_MODE=${shq(plan.mode)}`,
    `Q_CHANGED=${res.changed.length}`,
    `Q_TSC_APP=${plan.tsc.app ? 1 : 0}`,
    `Q_TSC_TEST=${plan.tsc.test ? 1 : 0}`,
    `Q_CACHE=${shq(plan.cache)}`,
  ];
  for (const [a, x] of Object.entries(plan.areas)) {
    const A = a.toUpperCase();
    out.push(`Q_${A}_MODE=${shq(x.mode)}`, `Q_${A}_TOTAL=${x.total}`, `Q_${A}_TESTS=(${x.tests.map(shq).join(' ')})`);
  }
  console.log(out.join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
