// App identity shown in the UI, per build flavor. Pure (no React / native imports), unit-tested (brand.test.ts).
// The official values mirror app/brand/identity.json (the single source, also read by app.config.ts and the build
// scripts); brand.test.ts fails if they drift. The personal flavor keeps its previous wording.
import { FLAVOR, type Flavor } from './flavor.ts';

export type Brand = {
  /** full product name (welcome screen, about) */
  name: string;
  /** short project name (docs, website); not shown as the app's name on the device */
  shortName: string;
  /** on-device name: home-screen label / header / {appShort} / share wordmark (≤ 12 characters) */
  displayName: string;
  /** the optional UI bridge, as named in the UI */
  bridgeName: string;
  /** deep-link scheme of the pair links this build creates (parsing accepts all of PAIR_SCHEMES) */
  scheme: string;
  /** project website; null = none (Settings → Über hides the row) */
  homepage: string | null;
  /** public source repository; null = not published yet (row hidden, skill step without clone) */
  repoUrl: string | null;
  /** privacy policy page; null = row hidden */
  privacyUrl: string | null;
  /** support address ("Antwort melden" → "An Entwickler senden" mailto); null = no mail option */
  supportEmail: string | null;
};

const BRANDS: Record<Flavor, Brand> = {
  hermes: {
    name: 'Hermes Interactive UI+',
    shortName: 'Hermes UI+',
    displayName: 'HUI+',
    bridgeName: 'Hermes UI+ Bridge',
    scheme: 'hermesuiplus',
    homepage: 'https://hermesui.xyz',
    repoUrl: 'https://github.com/robbyczgw-cla/hermes-ui-plus',
    privacyUrl: 'https://hermesui.xyz/privacy',
    supportEmail: 'robby@robbyczesany.com',
  },
  personal: { name: 'Hermes UI', shortName: 'Hermes UI', displayName: 'Hermes UI', bridgeName: 'Hermes UI Bridge', scheme: 'hermesui', homepage: null, repoUrl: null, privacyUrl: null, supportEmail: null },
};

export function brand(flavor: Flavor = FLAVOR): Brand {
  return BRANDS[flavor];
}

/** Variables every translation can use: {app} {appShort} {bridge} {scheme}. */
export function brandVars(flavor: Flavor = FLAVOR): Record<'app' | 'appShort' | 'bridge' | 'scheme', string> {
  const b = BRANDS[flavor];
  return { app: b.name, appShort: b.displayName, bridge: b.bridgeName, scheme: b.scheme };
}

/**
 * Header / browser-tab title. Build-time overrides (scripts/build-web.sh): official builds use
 * EXPO_PUBLIC_APP_SHORT_NAME, personal builds EXPO_PUBLIC_APP_NAME (as before). Static dot access → inlined by Expo.
 */
export const APP_TITLE: string =
  FLAVOR === 'personal'
    ? process.env.EXPO_PUBLIC_APP_NAME || 'Hermes'
    : process.env.EXPO_PUBLIC_APP_SHORT_NAME || BRANDS.hermes.displayName;

/** Wordmark of the share-as-image frame (chat/answers/ShareFrame.tsx). */
export function shareWordmark(flavor: Flavor = FLAVOR): string {
  return flavor === 'personal' ? 'Hermes' : BRANDS.hermes.displayName;
}
