// Expo config per build flavor (EXPO_PUBLIC_FLAVOR, see src/flavor.ts and docs/BUILD.md "Flavors").
// app.json holds everything both flavors share; this file only sets the identity:
//   hermes   (default) the official build: OFFICIAL_IDENTITY below (from ./brand/identity.json), icons from ./assets
//            (generated from ./brand/icon/*.svg by scripts/brand-icons.mjs).
//            Never reads the private overlay.
//   personal name / ids / scheme / icons from the private overlay: $HUI_PRIVATE_DIR/app/identity.json
//            (default ~/work/hermesiui-private). Different ids → both apps install side by side.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Official identity: app/brand/identity.json is the single source (also read by the build scripts and guards). */
type BrandFile = {
  name: string;
  shortName: string;
  tagline: string;
  slug: string;
  iosBundleId: string;
  androidPackage: string;
  scheme: string;
  colors: { ink: string };
};
const BRAND: BrandFile = JSON.parse(readFileSync(join(__dirname, 'brand', 'identity.json'), 'utf8'));

/**
 * The Expo `name` is the home-screen label (iOS CFBundleDisplayName / Android app_name), so it is the short name;
 * the full name ("Hermes Interactive UI+") is the store listing title and is shown inside the app (src/brand.ts).
 */
export const OFFICIAL_IDENTITY = {
  name: BRAND.shortName,
  slug: BRAND.slug,
  iosBundleId: BRAND.iosBundleId,
  androidPackage: BRAND.androidPackage,
  scheme: BRAND.scheme,
} as const;

type Identity = {
  name: string;
  slug: string;
  iosBundleId: string;
  androidPackage: string;
  scheme: string;
  icon?: string;
  favicon?: string;
  adaptiveIcon?: { backgroundColor?: string; foregroundImage?: string; backgroundImage?: string; monochromeImage?: string };
};

export function buildFlavor(): 'hermes' | 'personal' {
  return (process.env.EXPO_PUBLIC_FLAVOR ?? '').trim().toLowerCase() === 'personal' ? 'personal' : 'hermes';
}

export function privateDir(): string {
  const d = process.env.HUI_PRIVATE_DIR?.trim() || join(homedir(), 'work', 'hermesiui-private');
  return d.startsWith('~/') ? join(homedir(), d.slice(2)) : resolve(d);
}

function readPersonalIdentity(): Identity {
  const dir = join(privateDir(), 'app');
  const file = join(dir, 'identity.json');
  if (!existsSync(file)) {
    throw new Error(`EXPO_PUBLIC_FLAVOR=personal needs ${file} (set HUI_PRIVATE_DIR, see docs/BUILD.md "Flavors")`);
  }
  const id = JSON.parse(readFileSync(file, 'utf8')) as Identity;
  for (const k of ['name', 'slug', 'iosBundleId', 'androidPackage', 'scheme'] as const) {
    if (typeof id[k] !== 'string' || !id[k].trim()) throw new Error(`${file}: "${k}" missing`);
  }
  if (id.iosBundleId === OFFICIAL_IDENTITY.iosBundleId || id.androidPackage === OFFICIAL_IDENTITY.androidPackage) {
    throw new Error(`${file}: the personal build needs its own bundle id / package (side-by-side install)`);
  }
  const abs = (p?: string) => (p ? (isAbsolute(p) ? p : join(dir, p)) : undefined);
  const a = id.adaptiveIcon;
  return {
    ...id,
    icon: abs(id.icon),
    favicon: abs(id.favicon),
    adaptiveIcon: a
      ? { ...a, foregroundImage: abs(a.foregroundImage), backgroundImage: abs(a.backgroundImage), monochromeImage: abs(a.monochromeImage) }
      : undefined,
  };
}

/**
 * Build number from scripts/build-apk.sh (HUI_BUILD_NUMBER, a local counter that grows with every build): becomes the
 * Android versionCode / iOS buildNumber and is shown next to the version in Settings. Unset: the app.json values.
 */
function buildNumber(): number | undefined {
  const n = Number((process.env.HUI_BUILD_NUMBER ?? '').trim());
  return Number.isInteger(n) && n > 0 && n < 2_100_000_000 ? n : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const flavor = buildFlavor();
  const id: Identity = flavor === 'personal' ? readPersonalIdentity() : { ...OFFICIAL_IDENTITY };
  const base = config as ExpoConfig;
  const build = buildNumber();
  const source = (process.env.HUI_BUILD_SOURCE ?? '').trim().replace(/[^0-9a-z-]/gi, '').slice(0, 20) || undefined;
  const adaptive = id.adaptiveIcon ? Object.fromEntries(Object.entries(id.adaptiveIcon).filter(([, v]) => v !== undefined)) : {};
  return {
    ...base,
    name: id.name,
    slug: id.slug,
    scheme: id.scheme,
    ...(id.icon ? { icon: id.icon } : {}),
    ios: { ...base.ios, bundleIdentifier: id.iosBundleId, ...(build ? { buildNumber: String(build) } : {}) },
    android: {
      ...base.android,
      package: id.androidPackage,
      adaptiveIcon: { ...base.android?.adaptiveIcon, ...adaptive },
      ...(build ? { versionCode: build } : {}),
    },
    web: { ...base.web, ...(id.favicon ? { favicon: id.favicon } : {}) },
    ...(flavor === 'hermes' ? { description: BRAND.tagline } : {}),
    extra: { ...base.extra, flavor, ...(build ? { buildNumber: build } : {}), ...(source ? { buildSource: source } : {}) },
    // EXPO_PUBLIC_BG_SERVICE=0 (store builds): drop the dataSync foreground service from the manifest (no-op otherwise)
    plugins: [...(base.plugins ?? []), './plugins/withBgService'],
  };
};
