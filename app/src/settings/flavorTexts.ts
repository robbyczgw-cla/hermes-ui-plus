// Flavor-dependent settings texts and the "Über" links (pure; tested in flavorTexts.test.ts).
// The official (hermes) build never mentions backends it does not ship.
import type { Brand } from '../brand.ts';
import { FLAVOR, type Flavor } from '../flavor.ts';
import type { TKey } from '../i18n/core.ts';

/** Push settings: "this profile cannot receive notifications" */
export function pushUnsupportedKey(flavor: Flavor = FLAVOR): TKey {
  return flavor === 'personal' ? 'push.status.unsupportedBridge' : 'push.status.unsupportedBridge';
}

/** Profile editor: hint under the waiting-animation picker */
export function personaHintKey(flavor: Flavor = FLAVOR): TKey {
  return flavor === 'personal' ? 'waiting.persona.hintGeneric' : 'waiting.persona.hintGeneric';
}

export type AboutLinkKey = 'website' | 'source' | 'privacy';

/** Settings → Über: website / source / privacy rows; links that are not set are left out (never "folgt"). */
export function aboutLinkRows(b: Pick<Brand, 'homepage' | 'repoUrl' | 'privacyUrl'>): { key: AboutLinkKey; url: string }[] {
  const rows: { key: AboutLinkKey; url: string | null }[] = [
    { key: 'website', url: b.homepage },
    { key: 'source', url: b.repoUrl },
    { key: 'privacy', url: b.privacyUrl },
  ];
  return rows.filter((r): r is { key: AboutLinkKey; url: string } => typeof r.url === 'string' && /^https?:\/\//.test(r.url));
}

/** Two hint sentences in one subtitle: the first one gets its full stop if it has none. */
export function joinSentences(a: string, b: string): string {
  const x = a.trim();
  if (!x) return b;
  if (!b.trim()) return x;
  return `${/[.!?…:]$/.test(x) ? x : `${x}.`} ${b.trim()}`;
}
