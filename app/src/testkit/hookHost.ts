/// <reference types="node" />
// Test harness (node:test): run REAL hook modules without a React renderer.
//
//   const { useX } = await loadTsModule(fileURLToPath(new URL('./useX.ts', import.meta.url)), { react: host.react, … });
//   const host = createHookHost();
//   const out = host.render(() => useX(…));   // one render + the effects whose deps changed
//   host.rerender();                           // again while a state setter changed something (= React commits)
//
// `loadTsModule` transpiles the file and binds its imports: a specifier in `stubs` gets that object, any other
// relative import the real module (same instance as a test's own `import`, so module state is shared).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

type Obj = Record<string, unknown>;

export async function loadTsModule(file: string, stubs: Record<string, Obj>): Promise<Obj> {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const ast = ts.createSourceFile(file, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names: string[] = [];
  const values: unknown[] = [];
  const cuts: [number, number][] = [];
  const exported: string[] = [];
  for (const s of ast.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push(s.name.text);
    if (ts.isVariableStatement(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) exported.push(d.name.text);
    }
    if (!ts.isImportDeclaration(s)) continue;
    const spec = (s.moduleSpecifier as ts.StringLiteral).text;
    const mod: Obj = stubs[spec] ?? (await import(pathToFileURL(path.resolve(path.dirname(file), spec.endsWith('.ts') ? spec : spec + '.ts')).href));
    const bindings = s.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        names.push(el.name.text);
        values.push(mod[(el.propertyName ?? el.name).text]);
      }
    }
    cuts.push([s.pos, s.end]);
  }
  let body = js;
  for (const [a, b] of cuts.reverse()) body = body.slice(0, a) + body.slice(b);
  body = body.replace(/^export /gm, '');
  return new Function(...names, `${body}\nreturn { ${exported.join(', ')} };`)(...values) as Obj;
}

type Cell = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; set?: (v: unknown) => void };

const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * One component's hooks, by call order (useState / useRef / useMemo / useCallback / useEffect / useLayoutEffect).
 * Effects run after each render when their deps changed; `unmount` runs the cleanups.
 */
export function createHookHost() {
  const cells: Cell[] = [];
  let i = 0;
  let dirty = false;
  let effects: (() => void)[] = [];
  let component: (() => unknown) | null = null;
  const slot = () => (cells[i] ??= {});

  const useMemo = <T>(f: () => T, deps?: readonly unknown[]): T => {
    const c = slot();
    i++;
    if ('value' in c && sameDeps(c.deps, deps)) return c.value as T;
    c.value = f();
    c.deps = deps;
    return c.value as T;
  };
  const useEffect = (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const c = slot();
    i++;
    if (c.deps && sameDeps(c.deps, deps)) return;
    c.deps = deps ?? [Symbol('always')];
    effects.push(() => {
      c.cleanup?.();
      const r = fn();
      c.cleanup = typeof r === 'function' ? r : undefined;
    });
  };
  const react = {
    useState<T>(initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
      const c = slot();
      i++;
      if (!c.set) {
        c.value = typeof initial === 'function' ? (initial as () => T)() : initial;
        c.set = (v) => {
          const next = typeof v === 'function' ? (v as (p: unknown) => unknown)(c.value) : v;
          if (Object.is(next, c.value)) return;
          c.value = next;
          dirty = true;
        };
      }
      return [c.value as T, c.set as (v: T | ((p: T) => T)) => void];
    },
    useRef: <T>(v: T) => useMemo(() => ({ current: v }), []),
    useMemo,
    useCallback: <T>(f: T, deps?: readonly unknown[]) => useMemo(() => f, deps),
    useEffect,
    useLayoutEffect: useEffect,
  };

  function renderOnce(): unknown {
    i = 0;
    dirty = false;
    const out = component!();
    const run = effects;
    effects = [];
    for (const e of run) e();
    return out;
  }

  return {
    react,
    /** mount: first render + effects */
    render<T>(fn: () => T): T {
      component = fn;
      return renderOnce() as T;
    },
    /** re-render while a state setter changed something; returns the last render's result */
    rerender<T>(): T {
      let out = undefined as T;
      let n = 0;
      do {
        out = renderOnce() as T;
        if (++n > 50) throw new Error('hook host: render loop');
      } while (dirty);
      return out;
    },
    /** a state setter changed something since the last render */
    dirty: () => dirty,
    unmount(): void {
      for (const c of cells) c.cleanup?.();
      component = null;
    },
  };
}
