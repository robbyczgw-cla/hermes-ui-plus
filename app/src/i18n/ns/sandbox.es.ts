import type { sandbox as de } from './sandbox.de.ts';

// Namespace 'sandbox' (Spanish). Must have exactly the keys of sandbox.de.ts.
export const sandbox = {
  block: {
    a11y: 'Widget interactivo',
    loading: 'Cargando widget …',
    creating: 'Creando widget …',
    errorTitle: 'Error en el widget',
    reload: 'Recargar',
    reloadA11y: 'Recargar widget',
  },
  frame: {
    title: 'Widget',
    crash: 'El proceso del widget ha terminado.',
  },
  error: {
    unknown: 'Error desconocido',
  },
  shell: {
    error: 'Error',
    atLine: '(línea {line})',
    scriptFailed: 'No se pudo cargar el script: {src}',
    promiseRejected: 'Promesa rechazada: {reason}',
  },
} satisfies typeof de;
