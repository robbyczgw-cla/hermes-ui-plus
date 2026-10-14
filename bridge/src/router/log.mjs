// JSON-lines logger. Never pass message content or secrets at info level.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** @param {{level?: string, sink?: (line: string) => void}} [o] */
export function createLogger(o = {}) {
  const min = LEVELS[/** @type {keyof typeof LEVELS} */ (o.level ?? 'info')] ?? LEVELS.info;
  const sink = o.sink ?? ((line) => process.stdout.write(`${line}\n`));
  /** @param {keyof typeof LEVELS} level */
  const at = (level) => (/** @type {string} */ msg, /** @type {object} */ fields = {}) => {
    if (LEVELS[level] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
  };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), enabled: (l) => LEVELS[l] >= min };
}

export const silentLogger = createLogger({ level: 'silent' });
