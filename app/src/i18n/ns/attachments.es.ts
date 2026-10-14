import type { attachments as de } from './attachments.de.ts';

// Namespace 'attachments' (Spanish). Keys: <area>.<element>. See ../README.md.
// El texto dirigido al modelo (`[Datei angehängt: …]`, `[Anhang nicht mehr verfügbar: …]`) no está aquí: se queda en encodeHermes/encodeClaude.
export const attachments = {
  type: {
    image: 'IMAGEN',
    file: 'ARCHIVO',
  },
  source: {
    camera: 'Cámara',
    library: 'Fotos',
    document: 'Archivo',
  },
  button: {
    a11y: 'Añadir adjunto',
  },
  tray: {
    count: '{count, plural, one {# adjunto} other {# adjuntos}}',
    uploading: 'Subiendo…',
    uploadingPct: 'Subiendo… {percent} %',
    errorGeneric: 'Error',
    errorRetry: '{name}: {error}. Toca para reintentar',
    remove: 'Quitar {name}',
    fileA11y: '{name}, {sub}',
    fileA11yRetry: '{name}, {sub}. Toca para reintentar',
  },
  message: {
    openImage: 'Abrir imagen {name}',
    fileA11y: '{name}, {size}. Toca para abrir o compartir',
  },
  validate: {
    unsupportedType: '“{name}”: tipo de archivo no admitido.',
    unsupportedImage: '“{name}”: formato de imagen no admitido.',
    tooLarge: '“{name}” es demasiado grande ({size}, máx. {max}).',
    needsBridge: 'Los archivos necesitan la UI-Bridge. Sin ella, solo son posibles imágenes y archivos de texto pequeños (≤ {limit}).',
    tooLargeInline: '“{name}” es demasiado grande para incrustarlo ({size}, máx. {max}). Los archivos más grandes necesitan la UI-Bridge.',
    tooLargeText: '“{name}” es demasiado grande ({size}, máx. {max} para archivos de texto).',
    tooMany: 'Como máximo {max} adjuntos por mensaje.',
    defective: '“{name}” tiene un error. Quítalo, por favor.',
    payloadTooLarge: 'Adjuntos demasiado grandes: {size} (máx. {max} por mensaje). Adjunta menos imágenes, por favor.',
    historyTooLarge: 'Adjuntos demasiado grandes: el chat ya contiene {history} de adjuntos (máx. {max} en total). Empieza un chat nuevo, por favor.',
    openaiTextOnly: 'Este servidor solo admite imágenes y archivos de texto.',
    openaiNoImages: 'Este servidor no acepta imágenes.',
    claudeTooLarge: 'Adjuntos demasiado grandes: {size} (máx. {max}).',
  },
  upload: {
    unauthorized: 'Subida rechazada: token del bridge no válido. Revisa la clave de API en los ajustes.',
    notSupported: 'Esta conexión no admite subidas de archivos. ¿La UI-Bridge está actualizada?',
    tooLarge: '“{name}” es demasiado grande para subirlo (máx. {max}).',
    unsupportedType: '“{name}”: el servidor no acepta este tipo de archivo.',
    failedWithReason: 'La subida de “{name}” ha fallado: {reason}',
    failed: 'La subida de “{name}” ha fallado.',
    failedNoConnection: 'La subida de “{name}” ha fallado: sin conexión.',
    failedStatus: 'La subida de “{name}” ha fallado (HTTP {status}).',
    badResponse: 'Subida de “{name}”: respuesta inesperada del servidor.',
    aborted: 'Subida cancelada.',
    noBridge: 'No hay ninguna conexión con el bridge configurada.',
    failedGeneric: 'La subida ha fallado.',
  },
  file: {
    prepareFailed: '“{name}” no se pudo procesar.',
    openFailed: '“{name}” no se pudo abrir.',
  },
  encode: {
    readFailed: '“{name}” no se pudo leer.',
    notUploaded: '“{name}” todavía no se ha subido.',
    messageTooLarge: 'Mensaje demasiado grande: {size} (máx. {max}). Adjunta menos, por favor.',
  },
  picker: {
    cameraNoAccess: 'Sin acceso a la cámara, Hermes no puede hacer una foto.',
    cameraDenied: 'El acceso a la cámara está desactivado. Puedes permitirlo en los ajustes de la app.',
    cameraUnavailable: 'Sin acceso a la cámara.',
    videoUnsupported: 'Los vídeos no son compatibles.',
    imageFailed: 'No se pudo procesar una imagen.',
    limitedPick: 'Solo se añadieron las primeras {limit} imágenes.',
    onlyRemaining: 'Solo son posibles {remaining} adjuntos más.',
    unsupportedType: '“{name}”: tipo de archivo no admitido (PDF, texto, Markdown, CSV, JSON, Word, Excel o imágenes).',
    failedCamera: 'No se pudo abrir la cámara.',
    failedLibrary: 'No se pudo abrir el selector de fotos.',
    failedDocument: 'No se pudo abrir el selector de archivos.',
  },
  share: {
    unavailableTitle: 'No disponible',
    gone: '“{name}” ya no está en este dispositivo.',
    impossibleTitle: 'No se puede compartir',
    noDialog: 'No hay ningún diálogo para compartir disponible en este dispositivo.',
  },
  send: {
    notUploaded: 'No todos los archivos se han subido. Inténtalo de nuevo, por favor.',
    failed: 'No se pueden enviar los adjuntos.',
  },
  permission: {
    title: 'Sin acceso',
    settings: 'Ajustes',
  },
} satisfies typeof de;
