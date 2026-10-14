import type { sandbox as de } from './sandbox.de.ts';

// Namespace 'sandbox' (English). Must have exactly the keys of sandbox.de.ts.
export const sandbox = {
  block: {
    a11y: 'Interactive widget',
    loading: 'Loading widget …',
    creating: 'Creating widget …',
    errorTitle: 'Error in widget',
    reload: 'Reload',
    reloadA11y: 'Reload widget',
  },
  frame: {
    title: 'Widget',
    crash: 'The widget process has ended.',
  },
  error: {
    unknown: 'Unknown error',
  },
  shell: {
    error: 'Error',
    atLine: '(line {line})',
    scriptFailed: 'Script could not be loaded: {src}',
    promiseRejected: 'Promise rejected: {reason}',
  },
} satisfies typeof de;
