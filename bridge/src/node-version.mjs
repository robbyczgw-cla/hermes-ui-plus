// Node.js version gate for the CLI. Kept free of new Node APIs on purpose: bin/hermes-ui-bridge.mjs imports this
// statically and checks BEFORE it loads anything else, because on an older Node the first real import fails with a
// cryptic SyntaxError (`node:util` has no export `parseEnv`). Ubuntu 24.04's own `nodejs` package is Node 18.
export const MIN_NODE_MAJOR = 22;

/** @param {string} version  e.g. process.versions.node ("22.23.3") */
export function nodeTooOld(version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  return !Number.isInteger(major) || major < MIN_NODE_MAJOR;
}

/** One actionable message (stderr) for a too-old Node. */
export function nodeTooOldMessage(version, execPath) {
  return `hermes-ui-plus-bridge needs Node.js ${MIN_NODE_MAJOR} or newer, but this is Node ${String(version).replace(/^v?/, 'v')} (${execPath}).\n`
    + '  Install a current Node.js LTS (https://nodejs.org/en/download). On Ubuntu/Debian the distribution package is\n'
    + '  often too old: use the NodeSource packages or nvm. Then run the command again. Check with: node --version\n';
}
