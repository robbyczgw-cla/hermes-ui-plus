// Searchable settings sections. Each section is data (title + rows with search texts) so the screen can filter
// by the search field and hide empty sections. Customization sections (Darstellung, Chat, Medien, Bedienung)
// read/write the preferences store; every section has "Zurücksetzen" for its own keys.
import { Fragment, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useLocale, useT } from '../i18n';
import { FONT_SIZES, Loader, useMotionReduced, type Density, type FontSizePref } from '../ui';
import type { UnknownImagePolicy } from '../images/trust';
import { ImageSearchSettings } from './ImageSearchSettings';
import { usePreferences } from './PreferencesProvider';
import {
  LARGE_ATTACHMENT_BYTES,
  sectionIsDefault,
  type BubbleStylePref,
  type ChatScopePref,
  type ChatWidthPref,
  type ImageLoadingPref,
  type MotionPref,
  type PrefSection,
  type ThemeMode,
  type ToolDetailsPref,
  type WaitingAnimationsPref,
} from './preferences';
import { AccentPicker, LivePreview, ThemeFamilyGrid } from './ThemePicker';
import { Footnote, Group, SectionHeader, Segmented, SubLabel, SwitchRow } from './ui';
import { joinSentences } from './flavorTexts';
import { BG_SERVICE_ENABLED } from '../background/bgService';

export type SettingsRow = {
  key: string;
  /** texts the search field matches against (labels, subtitles, option names) */
  texts: string[];
  /** true → rendered inside a grouped list together with neighbouring `group` rows (last-row border handled) */
  group?: boolean;
  render(last: boolean): ReactNode;
};

export type SettingsSection = { id: string; title: string; rows: SettingsRow[]; reset?: PrefSection };

const norm = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Search predicate: every word of the query must appear in one of the texts. Empty query → everything. */
export function makeMatcher(query: string): (texts: string[]) => boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (texts) => {
    const hay = norm(texts.join(' '));
    return words.every((w) => hay.includes(w));
  };
}

/** Visible rows of a section for a query (section title hit → all rows). */
export function visibleRows(section: SettingsSection, match: (texts: string[]) => boolean): SettingsRow[] {
  if (match([section.title])) return section.rows;
  return section.rows.filter((r) => match([section.title, ...r.texts]));
}

export function SettingsSectionView({ section, rows }: { section: SettingsSection; rows: SettingsRow[] }) {
  const tr = useT();
  const { prefs, reset } = usePreferences();
  const out: ReactNode[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].group) {
      const start = i;
      while (i < rows.length && rows[i].group) i++;
      const groupRows = rows.slice(start, i);
      out.push(
        <Group key={`g-${groupRows[0].key}`}>
          {groupRows.map((r, j) => (
            <Fragment key={r.key}>{r.render(j === groupRows.length - 1)}</Fragment>
          ))}
        </Group>,
      );
    } else {
      const r = rows[i];
      out.push(<Fragment key={r.key}>{r.render(true)}</Fragment>);
      i++;
    }
  }
  return (
    <>
      <SectionHeader
        title={section.title}
        resetLabel={section.reset ? tr('settings.reset.label') : undefined}
        resetA11y={tr('settings.reset.a11y', { section: section.title })}
        onReset={section.reset ? () => reset(section.reset as PrefSection) : undefined}
        resetDisabled={section.reset ? sectionIsDefault(prefs, section.reset) : true}
      />
      {out}
    </>
  );
}

/** Darstellung · Chat · Medien · Bedienung */
export function useCustomizationSections(): SettingsSection[] {
  const tr = useT();
  const { formatNumber } = useLocale();
  const { prefs, set } = usePreferences();
  const reducedMotion = useMotionReduced();

  const block = (key: string, label: string, options: { value: string; label: string }[], node: ReactNode, extra: string[] = []): SettingsRow => ({
    key,
    texts: [label, ...options.map((o) => o.label), ...extra],
    render: () => (
      <>
        <SubLabel>{label}</SubLabel>
        {node}
      </>
    ),
  });
  const sw = (key: keyof typeof prefs & string, title: string, subtitle?: string): SettingsRow => ({
    key,
    group: true,
    texts: [title, subtitle ?? ''],
    render: (last) => <SwitchRow title={title} subtitle={subtitle} value={prefs[key] as boolean} onChange={(v) => set(key, v as never)} last={last} />,
  });

  // ---- Darstellung
  const modeOpts: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: tr('settings.appearance.system') },
    { value: 'light', label: tr('settings.appearance.light') },
    { value: 'dark', label: tr('settings.appearance.dark') },
  ];
  const familyNames = (['standard', 'oled', 'graphite', 'paper', 'nord', 'solarized', 'rose', 'forest', 'ocean'] as const).map((id) => tr(`settings.themes.${id}`));
  const fontOpts: { value: FontSizePref; label: string }[] = FONT_SIZES.map((f) => ({ value: f, label: f.toUpperCase() }));
  const densityOpts: { value: Density; label: string }[] = [
    { value: 'compact', label: tr('settings.look.compact') },
    { value: 'normal', label: tr('settings.look.normal') },
    { value: 'airy', label: tr('settings.look.airy') },
  ];
  const widthOpts: { value: ChatWidthPref; label: string }[] = [
    { value: 'narrow', label: tr('settings.look.narrow') },
    { value: 'normal', label: tr('settings.look.normal') },
    { value: 'wide', label: tr('settings.look.wide') },
    { value: 'full', label: tr('settings.look.full') },
  ];
  const bubbleOpts: { value: BubbleStylePref; label: string }[] = [
    { value: 'bubble', label: tr('settings.look.bubbleBubble') },
    { value: 'plain', label: tr('settings.look.bubblePlain') },
  ];
  const waitOpts: { value: WaitingAnimationsPref; label: string }[] = [
    { value: 'subtle', label: tr('waiting.settings.subtle') },
    { value: 'playful', label: tr('waiting.settings.playful') },
    { value: 'off', label: tr('waiting.settings.off') },
  ];
  const waitHint =
    prefs.waitingAnimations === 'off'
      ? tr('waiting.settings.hintOff')
      : prefs.waitingAnimations === 'subtle'
        ? tr('waiting.settings.hintSubtle')
        : reducedMotion
          ? `${tr('waiting.settings.hintPlayful')} ${tr('waiting.settings.reduced')}`
          : tr('waiting.settings.hintPlayful');
  const appearance: SettingsSection = {
    id: 'appearance',
    title: tr('settings.sections.appearance'),
    reset: 'appearance',
    rows: [
      {
        key: 'family',
        texts: [tr('settings.look.family'), tr('settings.look.preview'), ...familyNames],
        render: () => (
          <>
            <SubLabel>{tr('settings.look.family')}</SubLabel>
            <ThemeFamilyGrid value={prefs.themeFamily} onChange={(v) => set('themeFamily', v)} />
            <LivePreview bubbleStyle={prefs.bubbleStyle} />
          </>
        ),
      },
      block(
        'mode',
        tr('settings.look.mode'),
        modeOpts,
        <>
          <Segmented<ThemeMode> label={tr('settings.look.mode')} value={prefs.themeMode} options={modeOpts} onChange={(v) => set('themeMode', v)} />
          <Footnote>{tr('settings.look.modeHint')}</Footnote>
        </>,
        [tr('settings.appearance.theme')],
      ),
      {
        key: 'accent',
        texts: [tr('settings.look.accent'), tr('settings.look.accentCustom'), tr('settings.look.accentHex')],
        render: () => (
          <>
            <SubLabel>{tr('settings.look.accent')}</SubLabel>
            <AccentPicker value={prefs.accent} family={prefs.themeFamily} onChange={(v) => set('accent', v)} />
          </>
        ),
      },
      block(
        'fontSize',
        tr('settings.look.fontSize'),
        fontOpts,
        <>
          <Segmented<FontSizePref> label={tr('settings.look.fontSize')} value={prefs.fontSize} options={fontOpts} onChange={(v) => set('fontSize', v)} />
          <Footnote>{tr('settings.look.fontHint')}</Footnote>
        </>,
      ),
      block('density', tr('settings.look.density'), densityOpts, <Segmented<Density> label={tr('settings.look.density')} value={prefs.density} options={densityOpts} onChange={(v) => set('density', v)} />),
      block('width', tr('settings.look.width'), widthOpts, <Segmented<ChatWidthPref> label={tr('settings.look.width')} value={prefs.chatWidth} options={widthOpts} onChange={(v) => set('chatWidth', v)} />),
      block('bubble', tr('settings.look.bubble'), bubbleOpts, <Segmented<BubbleStylePref> label={tr('settings.look.bubble')} value={prefs.bubbleStyle} options={bubbleOpts} onChange={(v) => set('bubbleStyle', v)} />),
      block(
        'waiting',
        tr('waiting.settings.label'),
        waitOpts,
        <>
          <Segmented<WaitingAnimationsPref> label={tr('waiting.settings.label')} value={prefs.waitingAnimations} options={waitOpts} onChange={(v) => set('waitingAnimations', v)} />
          {prefs.waitingAnimations === 'off' ? (
            <Footnote>{waitHint}</Footnote>
          ) : (
            // live preview of the chosen style next to the hint (Footnote brings its own side margins)
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 14, marginTop: 6 }}>
              <Loader kind={prefs.waitingAnimations === 'playful' && !reducedMotion ? 'sparkle' : 'pulse'} size={22} animate={!reducedMotion} />
              <View style={{ flex: 1 }}>
                <Footnote>{waitHint}</Footnote>
              </View>
            </View>
          )}
        </>,
        [tr('waiting.settings.hintPlayful')],
      ),
    ],
  };

  // ---- Chat
  const toolOpts: { value: ToolDetailsPref; label: string }[] = [
    { value: 'off', label: tr('settings.appearance.off') },
    { value: 'compact', label: tr('settings.appearance.compact') },
    { value: 'verbose', label: tr('settings.appearance.verbose') },
  ];
  const toolHint = prefs.toolDetails === 'off' ? tr('settings.appearance.toolOff') : prefs.toolDetails === 'compact' ? tr('settings.appearance.toolCompact') : tr('settings.appearance.toolVerbose');
  const largeSize = `${formatNumber(LARGE_ATTACHMENT_BYTES / (1024 * 1024))} MB`;
  // "Chats": which of the app's own chats the drawer lists on THIS device (conversations/chatScope.ts)
  const scopeOpts: { value: ChatScopePref; label: string }[] = [
    { value: 'all', label: tr('settings.chat.chatScopeAll') },
    { value: 'device', label: tr('settings.chat.chatScopeDevice') },
  ];
  const chat: SettingsSection = {
    id: 'chat',
    title: tr('settings.sections.chat'),
    reset: 'chat',
    rows: [
      sw('showTimestamps', tr('settings.chat.timestamps'), tr('settings.chat.timestampsSub')),
      sw('sendOnEnter', tr('settings.chat.sendOnEnter'), tr('settings.chat.sendOnEnterSub')),
      sw('autoScroll', tr('settings.chat.autoScroll'), tr('settings.chat.autoScrollSub')),
      sw('showFollowups', tr('settings.chat.followups'), tr('settings.chat.followupsSub')),
      sw('showStarters', tr('settings.chat.starters'), tr('settings.chat.startersSub')),
      sw('autoTitles', tr('settings.chat.autoTitles'), tr('settings.chat.autoTitlesSub')),
      sw('confirmLargeAttachments', tr('settings.chat.largeConfirm'), tr('settings.chat.largeConfirmSub', { size: largeSize })),
      block(
        'toolDetails',
        tr('settings.appearance.toolDetails'),
        toolOpts,
        <>
          <Segmented<ToolDetailsPref> label={tr('settings.appearance.toolDetails')} value={prefs.toolDetails} options={toolOpts} onChange={(v) => set('toolDetails', v)} />
          <Footnote>{toolHint}</Footnote>
        </>,
      ),
      block(
        'chatScope',
        tr('settings.chat.chatScope'),
        scopeOpts,
        <>
          <Segmented<ChatScopePref> label={tr('settings.chat.chatScope')} value={prefs.chatScope} options={scopeOpts} onChange={(v) => set('chatScope', v)} />
          <Footnote>{prefs.chatScope === 'device' ? tr('settings.chat.chatScopeDeviceHint') : tr('settings.chat.chatScopeAllHint')}</Footnote>
        </>,
        [tr('settings.chat.chatScopeAllHint'), tr('settings.chat.chatScopeDeviceHint'), tr('settings.chat.chatScopeKeywords')],
      ),
    ],
  };

  // ---- Medien
  const imgOpts: { value: ImageLoadingPref; label: string }[] = [
    { value: 'always', label: tr('settings.media.always') },
    { value: 'wifi', label: tr('settings.media.wifi') },
    { value: 'never', label: tr('settings.media.never') },
  ];
  const imgHint = prefs.imageLoading === 'never' ? tr('settings.media.imagesNever') : prefs.imageLoading === 'wifi' ? tr('settings.media.imagesWifi') : tr('settings.media.imagesAlways');
  // security review H1: model-written image URLs / favicons on unknown hosts
  // proxied answer images load through the bridge by default; "Erst nach Tippen" holds them back too
  const unknownOpts: { value: UnknownImagePolicy; label: string }[] = [
    { value: 'bridge', label: tr('settings.media.unknownBridge') },
    { value: 'tap', label: tr('settings.media.unknownTap') },
    { value: 'always', label: tr('settings.media.unknownAlways') },
  ];
  const unknownHint =
    prefs.unknownImages === 'always' ? tr('settings.media.unknownAlwaysHint') : prefs.unknownImages === 'tap' ? tr('settings.media.unknownTapHint') : tr('settings.media.unknownBridgeHint');
  const media: SettingsSection = {
    id: 'media',
    title: tr('settings.sections.media'),
    reset: 'media',
    rows: [
      block(
        'images',
        tr('settings.media.images'),
        imgOpts,
        <>
          <Segmented<ImageLoadingPref> label={tr('settings.media.images')} value={prefs.imageLoading} options={imgOpts} onChange={(v) => set('imageLoading', v)} />
          <Footnote>{imgHint}</Footnote>
        </>,
        ['Wikipedia', 'Wikimedia'],
      ),
      block(
        'unknownImages',
        tr('settings.media.unknownImages'),
        unknownOpts,
        <>
          <Segmented<UnknownImagePolicy> label={tr('settings.media.unknownImages')} value={prefs.unknownImages} options={unknownOpts} onChange={(v) => set('unknownImages', v)} />
          <Footnote>{unknownHint}</Footnote>
        </>,
        ['Favicon'],
      ),
      {
        key: 'imageSearch',
        texts: [tr('settings.media.imageSearch.label'), tr('settings.media.imageSearch.bridge'), tr('settings.media.imageSearch.own'), tr('settings.media.imageSearch.wiki'), 'Serper', 'Brave', 'API'],
        render: () => (
          <>
            <SubLabel>{tr('settings.media.imageSearch.label')}</SubLabel>
            <ImageSearchSettings />
          </>
        ),
      },
      sw('codeWrap', tr('settings.media.codeWrap'), tr('settings.media.codeWrapSub')),
    ],
  };

  // ---- Bedienung
  const motionOpts: { value: MotionPref; label: string }[] = [
    { value: 'system', label: tr('settings.controls.motionSystem') },
    { value: 'on', label: tr('settings.controls.motionOn') },
    { value: 'off', label: tr('settings.controls.motionOff') },
  ];
  const controls: SettingsSection = {
    id: 'controls',
    title: tr('settings.sections.controls'),
    reset: 'controls',
    rows: [
      sw('haptics', tr('settings.controls.haptics'), tr('settings.controls.hapticsSub')),
      block(
        'motion',
        tr('settings.controls.motion'),
        motionOpts,
        <>
          <Segmented<MotionPref> label={tr('settings.controls.motion')} value={prefs.reduceMotion} options={motionOpts} onChange={(v) => set('reduceMotion', v)} />
          <Footnote>{tr('settings.controls.motionHint')}</Footnote>
        </>,
      ),
      // background turns (background/): Android keeps the stream alive with a foreground service; iOS gets no
      // extra time from any Expo API, so the switch is Android only there
      ...(Platform.OS === 'android' && BG_SERVICE_ENABLED ? [sw('finishInBackground', tr('settings.controls.finishInBackground'), tr('settings.controls.finishInBackgroundSub'))] : []),
      ...(Platform.OS !== 'web' ? [sw('notifyWhenDone', tr('settings.controls.notifyWhenDone'), tr('settings.controls.notifyWhenDoneSub'))] : []),
    ],
  };

  // ---- Antworten (v4 answer polish; every switch default ON except the interim notes)
  const answers: SettingsSection = {
    id: 'answers',
    title: tr('settings.answers.title'),
    reset: 'answers',
    rows: [
      sw('answers.summary', tr('settings.answers.summary'), tr('settings.answers.summarySub')),
      sw('answers.collapseLong', tr('settings.answers.collapseLong'), tr('settings.answers.collapseLongSub')),
      sw('answers.footnotes', tr('settings.answers.footnotes'), tr('settings.answers.footnotesSub')),
      sw('answers.entities', tr('settings.answers.entities'), tr('settings.answers.entitiesSub')),
      sw('answers.transformBar', tr('settings.answers.transformBar'), tr('settings.answers.transformBarSub')),
      sw('answers.progressNotes', tr('settings.answers.progressNotes'), tr('settings.answers.progressNotesSub')),
      sw('answers.motion', tr('settings.answers.motion'), tr('settings.answers.motionSub')),
      sw(
        'answers.shareImage',
        tr('settings.answers.shareImage'),
        Platform.OS === 'web' ? joinSentences(tr('settings.answers.shareImageSub'), tr('settings.answers.shareImageWeb')) : tr('settings.answers.shareImageSub'),
      ),
    ],
  };

  return [appearance, chat, answers, media, controls];
}
