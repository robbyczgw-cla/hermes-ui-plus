import type { support as de } from './support.de.ts';

// Namespace 'support' (Spanish): "Informar de un problema" y el aviso de actualización (app/src/support). Must have exactly the keys of support.de.ts.
export const support = {
  report: {
    row: 'Informar de un problema',
    rowSub: 'Abre una incidencia de GitHub preparada. Antes ves exactamente lo que se envía.',
    title: 'Informar de un problema',
    intro: 'Solo estos datos técnicos se incluyen en una nueva incidencia de GitHub: ni direcciones de servidor, ni claves, ni mensajes. Después describes tú el problema en GitHub.',
    open: 'Abrir en GitHub',
    copy: 'Copiar en su lugar',
    copied: 'Informe copiado',
    openFailed: 'No se pudo abrir el navegador. El informe se ha copiado.',
    fromError: 'Informar de un problema',
  },
  update: {
    setting: 'Buscar actualizaciones',
    settingSub: 'Pregunta a GitHub por una nueva versión como máximo una vez al día. No se envían datos sobre ti.',
    available: 'Actualización disponible: {version}',
    apk: 'Descarga la nueva APK de GitHub o deja que Obtainium actualice la app automáticamente.',
    release: 'Abrir la página de la versión en GitHub.',
    web: 'Actualiza el paquete web de tu bridge y vuelve a cargar esta página.',
    toast: '{appShort} {version} está disponible. Más en Ajustes → Acerca de.',
  },
} satisfies typeof de;
