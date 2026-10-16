// App preferences (Settings → Darstellung / Chat / Medien / Bedienung). Pure: types, defaults, sanitizing,
// migration from the old single-value keys, per-section reset and the layout math. Tested in preferences.test.ts.
// Stored as JSON under PREFS_KEY; the React store lives in PreferencesProvider.tsx (`usePreferences()`).
import { IMAGE_SEARCH_MODES, type ImageSearchMode } from '../images/mode.ts';
import { isImageProviderId, type ImageProviderId } from '../images/providers.ts';
import { UNKNOWN_IMAGE_POLICIES, type UnknownImagePolicy } from '../images/trust.ts';
import {
  DENSITIES,
  DENSITY_MESSAGE_GAP,
  FONT_SCALE,
  FONT_SIZES,
  isAccentPref,
  isThemeFamilyId,
  LEGACY_ACCENT_SWATCHES,
  scaleFont,
  type AccentPref,
  type Density,
  type FontSizePref,
  type ThemeFamilyId,
} from '../ui/themes.ts';

export const PREFS_KEY = 'hermes.prefs.v1';
export const PREFS_VERSION = 1;
/** keys of the previous app version (read once during migration, then left alone) */
export const LEGACY_APPEARANCE_KEY = 'hermes.appearance.v1';
export const LEGACY_TOOL_DETAILS_KEY = 'hermes.toolDetails.v1';

export type ThemeMode = 'system' | 'light' | 'dark';
/** "Werkzeug-Details": off = no tool UI, compact = chips, verbose = timeline panel + footer (default). */
export type ToolDetailsPref = 'off' | 'compact' | 'verbose';
export type ChatWidthPref = 'narrow' | 'normal' | 'wide' | 'full';
export type BubbleStylePref = 'bubble' | 'plain';
export type ImageLoadingPref = 'always' | 'wifi' | 'never';
export type MotionPref = 'system' | 'on' | 'off';
/** "Warte-Animationen": playful = varied indicators + rotating phrases (default) · subtle = dots + static text · off = text only */
/** "Chats": all Hermes UI chats (every device) or only the ones started on this device */
export type ChatScopePref = 'all' | 'device';
export type WaitingAnimationsPref = 'playful' | 'subtle' | 'off';

export type Preferences = {
  // Darstellung
  themeMode: ThemeMode;
  themeFamily: ThemeFamilyId;
  accent: AccentPref;
  fontSize: FontSizePref;
  density: Density;
  chatWidth: ChatWidthPref;
  bubbleStyle: BubbleStylePref;
  waitingAnimations: WaitingAnimationsPref;
  // Chat
  showTimestamps: boolean;
  sendOnEnter: boolean;
  autoScroll: boolean;
  showFollowups: boolean;
  /** starter tiles on the new-chat screen (off = greeting + composer only) */
  showStarters: boolean;
  autoTitles: boolean;
  toolDetails: ToolDetailsPref;
  confirmLargeAttachments: boolean;
  /**
   * "Chats" (this device only): `all` = every Hermes UI chat from every device (default), `device` = only chats started
   * on this device (conversations/chatScope.ts)
   */
  chatScope: ChatScopePref;
  // Medien
  imageLoading: ImageLoadingPref;
  /** images on hosts the app does not trust (model-written URLs): ask first (default, review H1) or always load */
  unknownImages: UnknownImagePolicy;
  /** web image search source (second image source after Wikimedia): UI bridge · own provider key · none */
  imageSearch: ImageSearchMode;
  /** provider of the own key (the key itself lives in secure storage, not here) */
  imageProvider: ImageProviderId;
  codeWrap: boolean;
  // Bedienung
  haptics: boolean;
  reduceMotion: MotionPref;
  /** Android: keep a running answer alive in the background (foreground service, background/keepAlive.ts) */
  finishInBackground: boolean;
  /** "Antwort ist da": local notification / banner when an answer finished elsewhere (background/notice.ts) */
  notifyWhenDone: boolean;
  // Antworten (v4 answer polish, docs/SPEC-modules-v4.md A1–A6; all default ON). Keys keep the spec's
  // dotted names: read them as `prefs['answers.summary']` / `usePreference('answers.summary')`.
  /** A1 "Umformen" chip row under finished answers */
  'answers.transformBar': boolean;
  /** A2 TL;DR head (`summary` node) */
  'answers.summary': boolean;
  /** A2 long markdown sections after a summary collapse to ~12 lines + "Weiterlesen" */
  'answers.collapseLong': boolean;
  /** A3 `[^1]` footnote pills with preview sheet */
  'answers.footnotes': boolean;
  /** A4 `hui:` entity chips + phone/e-mail/date auto-detection */
  'answers.entities': boolean;
  /** A5 staggered block entrance + stats count-up (reduce-motion still wins) */
  'answers.motion': boolean;
  /** A6 "Als Bild teilen" in the action row (native only) */
  'answers.shareImage': boolean;
  /**
   * UX1 "Zwischentexte in der Antwort zeigen": agent interim notes before tool calls stay in the answer body
   * (default OFF: they become status lines in the tool timeline, hermes/progressNotes.ts)
   */
  'answers.progressNotes': boolean;
};

/** the "Antworten" switches (all booleans; default ON except `answers.progressNotes`) */
export const ANSWER_PREF_KEYS = [
  'answers.summary',
  'answers.collapseLong',
  'answers.footnotes',
  'answers.entities',
  'answers.motion',
  'answers.shareImage',
  'answers.transformBar',
  'answers.progressNotes',
] as const;
export type AnswerPrefKey = (typeof ANSWER_PREF_KEYS)[number];

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  themeMode: 'system',
  themeFamily: 'standard',
  accent: 'theme',
  fontSize: 'm',
  density: 'normal',
  chatWidth: 'normal',
  bubbleStyle: 'bubble',
  // calm monochrome default; colourful loaders stay selectable under "Verspielt"
  waitingAnimations: 'subtle',
  showTimestamps: false,
  sendOnEnter: true,
  autoScroll: true,
  showFollowups: true,
  showStarters: true,
  autoTitles: true,
  toolDetails: 'verbose',
  confirmLargeAttachments: true,
  chatScope: 'all',
  imageLoading: 'always',
  unknownImages: 'bridge',
  imageSearch: 'bridge',
  imageProvider: 'serper',
  codeWrap: false,
  haptics: true,
  reduceMotion: 'system',
  finishInBackground: true,
  notifyWhenDone: true,
  'answers.transformBar': true,
  'answers.summary': true,
  'answers.collapseLong': true,
  'answers.footnotes': true,
  'answers.entities': true,
  'answers.motion': true,
  'answers.shareImage': true,
  'answers.progressNotes': false,
});

export type PrefSection = 'appearance' | 'chat' | 'media' | 'controls' | 'answers';

export const SECTION_KEYS: Record<PrefSection, readonly (keyof Preferences)[]> = {
  appearance: ['themeMode', 'themeFamily', 'accent', 'fontSize', 'density', 'chatWidth', 'bubbleStyle', 'waitingAnimations'],
  chat: ['showTimestamps', 'sendOnEnter', 'autoScroll', 'showFollowups', 'showStarters', 'autoTitles', 'toolDetails', 'confirmLargeAttachments', 'chatScope'],
  media: ['imageLoading', 'unknownImages', 'imageSearch', 'imageProvider', 'codeWrap'],
  controls: ['haptics', 'reduceMotion', 'finishInBackground', 'notifyWhenDone'],
  answers: ANSWER_PREF_KEYS,
};

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const VALIDATORS: { [K in keyof Preferences]: (v: unknown) => v is Preferences[K] } = {
  themeMode: oneOf(['system', 'light', 'dark'] as const),
  themeFamily: isThemeFamilyId,
  accent: isAccentPref,
  fontSize: oneOf(FONT_SIZES),
  density: oneOf(DENSITIES),
  chatWidth: oneOf(['narrow', 'normal', 'wide', 'full'] as const),
  bubbleStyle: oneOf(['bubble', 'plain'] as const),
  waitingAnimations: oneOf(['playful', 'subtle', 'off'] as const),
  showTimestamps: isBool,
  sendOnEnter: isBool,
  autoScroll: isBool,
  showFollowups: isBool,
  showStarters: isBool,
  autoTitles: isBool,
  toolDetails: oneOf(['off', 'compact', 'verbose'] as const),
  confirmLargeAttachments: isBool,
  chatScope: oneOf(['all', 'device'] as const),
  imageLoading: oneOf(['always', 'wifi', 'never'] as const),
  unknownImages: oneOf(UNKNOWN_IMAGE_POLICIES),
  imageSearch: oneOf(IMAGE_SEARCH_MODES),
  imageProvider: isImageProviderId,
  codeWrap: isBool,
  haptics: isBool,
  reduceMotion: oneOf(['system', 'on', 'off'] as const),
  finishInBackground: isBool,
  notifyWhenDone: isBool,
  'answers.transformBar': isBool,
  'answers.summary': isBool,
  'answers.collapseLong': isBool,
  'answers.footnotes': isBool,
  'answers.entities': isBool,
  'answers.motion': isBool,
  'answers.shareImage': isBool,
  'answers.progressNotes': isBool,
};

export function parseToolDetailsPref(v: unknown): ToolDetailsPref {
  return VALIDATORS.toolDetails(v) ? v : DEFAULT_PREFERENCES.toolDetails;
}

const legacyAccent = (v: string): string => (Object.hasOwn(LEGACY_ACCENT_SWATCHES, v) ? LEGACY_ACCENT_SWATCHES[v] : v);

/** Any object → complete, valid Preferences (unknown keys dropped, invalid values → default). */
export function sanitizePreferences(raw: unknown): Preferences {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PREFERENCES } as Preferences;
  for (const k of Object.keys(VALIDATORS) as (keyof Preferences)[]) {
    const v = k === 'accent' && typeof src[k] === 'string' ? legacyAccent((src[k] as string).toLowerCase()) : src[k];
    if (VALIDATORS[k](v)) (out as Record<string, unknown>)[k] = v;
  }
  // old switch "Websuche über UI-Bridge" (off) → Wikipedia only
  if (src.imageSearch === undefined && src.webImages === false) out.imageSearch = 'wikipedia';
  // old "Nachfragen" already loaded proxied answer images at once: that is today's "Über Bridge" (not "Erst nach Tippen")
  if (src.unknownImages === 'ask') out.unknownImages = 'bridge';
  return out;
}

/**
 * Stored JSON (or null) + old single-value keys → preferences. `changed` = should be written back
 * (first run after the update, or the stored value needed repair).
 */
export function migratePreferences(
  stored: string | null | undefined,
  legacy: { appearance?: string | null; toolDetails?: string | null } = {},
): { prefs: Preferences; changed: boolean; from: 0 | 1 } {
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const env = parsed as { v?: unknown; prefs?: unknown };
        const body = env.v === PREFS_VERSION && env.prefs && typeof env.prefs === 'object' ? env.prefs : parsed;
        const prefs = sanitizePreferences(body);
        return { prefs, changed: serializePreferences(prefs) !== stored, from: 1 };
      }
    } catch {
      // fall through to legacy migration
    }
  }
  const prefs: Preferences = { ...DEFAULT_PREFERENCES };
  let changed = false;
  if (legacy.appearance === 'light' || legacy.appearance === 'dark' || legacy.appearance === 'system') {
    prefs.themeMode = legacy.appearance;
    changed = true;
  }
  if (legacy.toolDetails && VALIDATORS.toolDetails(legacy.toolDetails)) {
    prefs.toolDetails = legacy.toolDetails;
    changed = true;
  }
  return { prefs, changed: changed || !!stored, from: 0 };
}

export function serializePreferences(p: Preferences): string {
  return JSON.stringify({ v: PREFS_VERSION, prefs: p });
}

/** Reset only the keys of one settings section. */
export function resetSection(p: Preferences, section: PrefSection): Preferences {
  const next = { ...p } as Record<string, unknown>;
  for (const k of SECTION_KEYS[section]) next[k] = DEFAULT_PREFERENCES[k];
  return next as Preferences;
}

/** Does a section differ from its defaults? (enables its "Zurücksetzen" button) */
export function sectionIsDefault(p: Preferences, section: PrefSection): boolean {
  return SECTION_KEYS[section].every((k) => p[k] === DEFAULT_PREFERENCES[k]);
}

// ---------------------------------------------------------------- layout math (used by chat/)

/** Max width of the message column; on phones the screen is narrower anyway (tablet / desktop only). */
export const CHAT_MAX_WIDTH: Record<ChatWidthPref, number | undefined> = { narrow: 620, normal: 760, wide: 980, full: undefined };

export function chatMaxWidth(p: Pick<Preferences, 'chatWidth'>): number | undefined {
  return CHAT_MAX_WIDTH[p.chatWidth];
}

/** Vertical padding above a message (inverted list: visual gap to the previous message). */
export function messageGap(base: number, density: Density): number {
  return Math.round(base * DENSITY_MESSAGE_GAP[density]);
}

export function fontScaleOf(p: Pick<Preferences, 'fontSize'>): number {
  return FONT_SCALE[p.fontSize];
}

/** Scaled font size (0.5 px steps) + line height for chat text that does not use theme typography. */
export const scaledText = scaleFont;

/** "Große Anhänge bestätigen": total bytes above which the composer asks before sending. */
export const LARGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function needsLargeAttachmentConfirm(sizes: readonly number[], p: Pick<Preferences, 'confirmLargeAttachments'>): boolean {
  if (!p.confirmLargeAttachments) return false;
  return sizes.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0) > LARGE_ATTACHMENT_BYTES;
}

/** Enter-key decision of the composer (web / hardware keyboard). */
export function enterAction(
  e: { shift?: boolean; meta?: boolean; ctrl?: boolean; composing?: boolean },
  sendOnEnter: boolean,
): 'send' | 'newline' {
  if (e.composing) return 'newline';
  if (e.meta || e.ctrl) return 'send'; // Cmd/Ctrl+Enter always sends
  if (e.shift) return 'newline';
  return sendOnEnter ? 'send' : 'newline';
}
