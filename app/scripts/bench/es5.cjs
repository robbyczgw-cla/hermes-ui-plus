// Down-levels a bundled bench to ES5 for old Hermes CLI builds (no class syntax): node es5.cjs <in.js> <out.js>
const fs = require('node:fs');
const ts = require('typescript');
const [, , input, output] = process.argv;
const r = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES5, downlevelIteration: true, allowJs: true, module: ts.ModuleKind.None, removeComments: true },
});
fs.writeFileSync(output, r.outputText);
