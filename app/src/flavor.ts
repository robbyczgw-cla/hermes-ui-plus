// Build flavor (build-time, `EXPO_PUBLIC_FLAVOR`, inlined into the bundle by Expo):
//   hermes   (default) the official build: Hermes (bridge / direct) + the offline demo only. No other
//            backends.
//   personal Hermes + demo, with a private identity overlay. Built with
//            the private overlay (HUI_PRIVATE_DIR, docs/BUILD.md "Flavors").
// Pure (no React / native imports) so the gating is unit-testable (flavor.test.ts). Every check takes the
// flavor as an optional argument; the default is the flavor of this bundle.

export type Flavor = 'hermes' | 'personal';
export const FLAVORS: readonly Flavor[] = ['hermes', 'personal'];

/** Unknown / empty → 'hermes' (the safe default: never expose hidden backends by accident). */
export function parseFlavor(raw: string | null | undefined): Flavor {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'personal' ? 'personal' : 'hermes';
}

/** Must be read with static dot access so Expo inlines it. */
export const FLAVOR: Flavor = parseFlavor(process.env.EXPO_PUBLIC_FLAVOR);

/** Profile kinds (settings/profiles.ts ProfileKind) a build may create, show or connect to. */
const KINDS: Record<Flavor, readonly string[]> = {
  hermes: ['hermes', 'demo'],
  personal: ['hermes', 'demo'],
};

export function allowedKinds(flavor: Flavor = FLAVOR): readonly string[] {
  return KINDS[flavor];
}

export function isKindAllowed(kind: string, flavor: Flavor = FLAVOR): boolean {
  return KINDS[flavor].includes(kind);
}

/** Pair-link kinds (`kind=` parameter) this build accepts. */
export function allowedPairKinds(flavor: Flavor = FLAVOR): readonly string[] {
  return ['hermes'];
}


/** Profile kinds offered under Settings → "Neue Verbindung" (order = list order); the hidden ones never appear. */
export function pickableKinds(flavor: Flavor = FLAVOR): string[] {
  return ['hermes'].filter((k) => isKindAllowed(k, flavor));
}

/** Onboarding "Andere Verbindung" card: only when a non-Hermes kind exists (never in this source tree). */
export function otherBackendsAllowed(flavor: Flavor = FLAVOR): boolean {
  return allowedKinds(flavor).some((k) => k !== 'hermes' && k !== 'demo');
}


/**
 * Pair-link schemes. The build registers one (app.config.ts: official `hermesuiplus`, app/brand/identity.json;
 * personal `hermesui` from the overlay); parsing accepts all of them, including the retired `hermesiui`.
 */
export const PAIR_SCHEMES = ['hermesuiplus', 'hermesiui', 'hermesui'] as const;
export function pairScheme(flavor: Flavor = FLAVOR): string {
  return flavor === 'personal' ? 'hermesui' : 'hermesuiplus';
}

/**
 * Conversations of other kinds stay on disk (hidden profiles are kept untouched) but this build neither lists,
 * searches nor restores them as the open chat.
 */
export function isConversationVisible(meta: { profileKind?: string } | null | undefined, flavor: Flavor = FLAVOR): boolean {
  return !meta || !meta.profileKind || isKindAllowed(meta.profileKind, flavor);
}

/**
 * Split stored profiles into the ones this build shows and the hidden ones (other kinds). Hidden profiles are
 * kept untouched in storage (written back unchanged) but never listed, activated or connected.
 */
export function partitionByFlavor<T extends { kind: string }>(list: readonly T[], flavor: Flavor = FLAVOR): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const p of list) (isKindAllowed(p.kind, flavor) ? visible : hidden).push(p);
  return { visible, hidden };
}

/**
 * Dictionary key prefixes (i18n `ns.key`) that name a non-Hermes provider and are therefore only reachable in the
 * personal flavor (exact key, `prefix.`-subtree, or `prefix*` = any key starting with it). flavorLeaks.test.ts fails for any other dictionary string that mentions such a provider, so a new
 * provider mention must either be gated and listed here, or be a deliberate entry of PROVIDER_MENTION_ALLOWED.
 */
export const PERSONAL_ONLY_KEY_PREFIXES: readonly string[] = [];

/** Provider mentions that are shown in the official build on purpose (key prefix → reason). */
export const PROVIDER_MENTION_ALLOWED: Readonly<Record<string, string>> = {
  'compliance.consent': 'discloses the AI services a Hermes server may forward to (App Store 5.1.2(i))',
  'onboarding.guided.agent.useCoder': 'tells the user which coding agents can run the setup prompt; not a connection kind of the app',
};
