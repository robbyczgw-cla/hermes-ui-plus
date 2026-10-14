/** Settings → Medien → Bildersuche (pure types, shared by preferences and the image modules). */
export type ImageSearchMode = 'bridge' | 'own' | 'wikipedia';
export const IMAGE_SEARCH_MODES: readonly ImageSearchMode[] = ['bridge', 'own', 'wikipedia'];
