/**
 * The "Send to HUI+" sheet (docs/SHARE-TARGET.md): preview of what was shared, target (new chat on a connection / bot,
 * or the last chat), quick intents as chips plus an own instruction, then Send. Loaded lazily by ShareHost.
 *
 * Send never talks to the network itself: it opens the target chat and hands the message + files to that chat's
 * composer (inbox.ts deliverShare → Composer useShareDelivery), which uses the normal attachment / upload / send path.
 * Whatever cannot be sent there (offline upload, a turn still running) stays in the composer with a notice.
 */
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { formatBytes, typeLabel } from '../attachments/mime';
import { Icon } from '../chat/icons';
import { useConversations } from '../conversations';
import { DEFAULT_BOT } from '../hermes/bots';
import { useHermesBots } from '../hermes/useHermesBots';
import { useLocale, useT } from '../i18n';
import { openOnboarding } from '../onboarding/hostEvents';
import { closeQuick } from '../quick/nav';
import { useConnection } from '../settings/ConnectionProvider';
import { Button, SheetGrabber, SheetModal, Text, TextInput, textStyle, useTheme } from '../ui';
import { a11yState } from '../ui/lib/a11yState';
import { deliverShare, dismissShare, type OfferedShare } from './inbox';
import {
  SHARE_INTENTS,
  canSendShare,
  composeShareMessage,
  defaultShareProfile,
  lastShareChat,
  shareKind,
  shareProfiles,
  type ShareGate,
  type ShareIntentId,
  type SharedFile,
} from './model';

const INTENT_KEYS = {
  summarize: 'share.intents.summarize',
  explain: 'share.intents.explain',
  translate: 'share.intents.translate',
  save: 'share.intents.save',
} as const;
const PROMPT_KEYS = {
  summarize: 'share.prompts.summarize',
  explain: 'share.prompts.explain',
  translate: 'share.prompts.translate',
  save: 'share.prompts.save',
} as const;
const MAX_THUMBS = 4;
const MAX_FILE_ROWS = 3;

export default function ShareSheet({ share, gate }: { share: OfferedShare | null; gate: ShareGate }) {
  const tr = useT();
  const cancel = () => share && dismissShare(share.id);
  return (
    <SheetModal
      visible={!!share}
      onClose={cancel}
      closeLabel={tr('actions.cancel')}
      label={tr('share.sheet.title')}
      maxHeight="92%"
      style={styles.sheet}
      animationType="slide"
      empty={!share}
    >
      {share ? gate === 'pair' ? <PairBody key={share.id} share={share} onCancel={cancel} /> : <SendBody key={share.id} share={share} onCancel={cancel} /> : null}
    </SheetModal>
  );
}

// ---------------------------------------------------------------- not paired yet

function PairBody({ share, onCancel }: { share: OfferedShare; onCancel(): void }) {
  const tr = useT();
  const t = useTheme();
  return (
    <>
      <SheetGrabber />
      <Text style={[textStyle(t, 'headline'), styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('share.pair.title')}
      </Text>
      <Preview share={share} />
      <Text style={[textStyle(t, 'callout'), styles.lead, { color: t.colors.muted }]}>{tr('share.pair.text')}</Text>
      <View style={styles.buttons}>
        <Button label={tr('actions.cancel')} variant="tertiary" onPress={onCancel} grow testID="share-cancel" />
        {/* the share stays in the inbox; the sheet comes back once the flow is closed */}
        <Button label={tr('share.pair.connect')} variant="primary" icon={(c, s) => <Icon name="server" size={s} color={c} />} onPress={() => openOnboarding('choose')} grow testID="share-pair" />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- send

function SendBody({ share, onCancel }: { share: OfferedShare; onCancel(): void }) {
  const tr = useT();
  const t = useTheme();
  const { profiles, active, setActive } = useConnection();
  const convs = useConversations();
  const real = useMemo(() => shareProfiles(profiles), [profiles]);
  const last = useMemo(() => lastShareChat(convs.list, profiles), [convs.list, profiles]);

  const [target, setTarget] = useState<'new' | 'last'>('new');
  const [profileId, setProfileId] = useState(() => defaultShareProfile(profiles, active.id)?.id);
  const profile = real.find((p) => p.id === profileId) ?? real[0];
  const { bots } = useHermesBots(profile);
  const [bot, setBot] = useState<string | undefined>(undefined);
  // another connection picked: its bot list differs, back to its default
  useEffect(() => setBot(undefined), [profile?.id]);
  const [intent, setIntent] = useState<ShareIntentId | null>(null);
  const [note, setNote] = useState('');
  const sendable = canSendShare(share, note);

  const send = () => {
    if (!sendable) return;
    const text = composeShareMessage(share, { prompt: intent ? tr(PROMPT_KEYS[intent]) : null, note });
    let conversationId: string;
    if (target === 'last' && last) {
      if (last.profileId !== active.id) setActive(last.profileId);
      convs.setActiveId(last.id);
      conversationId = last.id;
    } else {
      if (!profile) return;
      if (profile.id !== active.id) setActive(profile.id);
      conversationId = convs.create(profile, { bot: bot && bot !== DEFAULT_BOT ? bot : undefined }).id;
    }
    // the files move on to the composer: their stored copy (web) is freed once the draft holds them
    deliverShare(conversationId, { text, files: share.files, release: share.release });
    dismissShare(share.id, { keepStorage: true });
    closeQuick();
    router.navigate('/');
  };

  return (
    <>
      <SheetGrabber />
      <Text style={[textStyle(t, 'headline'), styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('share.sheet.title')}
      </Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        <Preview share={share} />

        <Section label={tr('share.sheet.target')}>
          <ChipRow>
            <Chip label={tr('share.sheet.newChat')} selected={target === 'new'} onPress={() => setTarget('new')} testID="share-target-new" />
            {last ? (
              <Chip
                label={`${tr('share.sheet.lastChat')}: ${last.title || tr('share.sheet.untitled')}`}
                a11yLabel={tr('share.sheet.lastChatA11y', { title: last.title || tr('share.sheet.untitled') })}
                selected={target === 'last'}
                onPress={() => setTarget('last')}
                testID="share-target-last"
              />
            ) : null}
          </ChipRow>
        </Section>

        {target === 'new' && real.length > 1 ? (
          <Section label={tr('share.sheet.connection')}>
            <ChipRow>
              {real.map((p) => (
                <Chip key={p.id} label={p.name} selected={p.id === profile?.id} onPress={() => setProfileId(p.id)} />
              ))}
            </ChipRow>
          </Section>
        ) : null}

        {target === 'new' && bots.length > 1 ? (
          <Section label={tr('bots.picker.section')}>
            <ChipRow>
              {bots.map((b) => {
                const on = b.default ? !bot || bot === DEFAULT_BOT : bot === b.name;
                return <Chip key={b.name} label={b.default ? tr('bots.picker.default') : (b.label ?? b.name)} selected={on} onPress={() => setBot(b.default ? undefined : b.name)} />;
              })}
            </ChipRow>
          </Section>
        ) : null}

        <Section label={tr('share.sheet.intents')}>
          <ChipRow>
            {SHARE_INTENTS.map((id) => (
              <Chip key={id} label={tr(INTENT_KEYS[id])} selected={intent === id} onPress={() => setIntent((cur) => (cur === id ? null : id))} toggle testID={`share-intent-${id}`} />
            ))}
          </ChipRow>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={tr('share.sheet.notePlaceholder')}
            placeholderTextColor={t.colors.subtle}
            multiline
            maxLength={2000}
            accessibilityLabel={tr('share.sheet.note')}
            testID="share-note"
            style={[textStyle(t, 'body'), styles.note, { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, fontFamily: t.fonts.sans }]}
          />
        </Section>
        {!share.text && !share.files.length ? (
          <Text style={[textStyle(t, 'caption'), styles.hint, { color: t.colors.muted }]}>{tr('share.sheet.nothing')}</Text>
        ) : null}
      </ScrollView>
      <View style={styles.buttons}>
        <Button label={tr('actions.cancel')} variant="tertiary" onPress={onCancel} grow testID="share-cancel" />
        <Button label={tr('actions.send')} variant="primary" icon={(c, s) => <Icon name="send" size={s} color={c} />} onPress={send} disabled={!sendable} grow testID="share-send" />
      </View>
    </>
  );
}

// ---------------------------------------------------------------- preview

function Preview({ share }: { share: OfferedShare }) {
  const tr = useT();
  const t = useTheme();
  const kind = shareKind(share);
  const images = share.files.filter((f) => f.mimeType.startsWith('image/'));
  const others = share.files.filter((f) => !f.mimeType.startsWith('image/'));
  const count = share.files.length;
  const kindLabel =
    kind === 'link' ? tr('share.sheet.kinds.link')
    : kind === 'text' ? tr('share.sheet.kinds.text')
    : kind === 'image' ? tr('share.sheet.kinds.image', { count })
    : kind === 'file' ? tr('share.sheet.kinds.file', { count })
    : kind === 'mixed' ? tr('share.sheet.kinds.mixed', { count })
    : null;
  return (
    <View style={[styles.preview, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]} testID="share-preview">
      {kindLabel ? (
        <View style={styles.kindRow}>
          <Icon name={kind === 'link' ? 'globe' : kind === 'text' ? 'edit' : kind === 'image' ? 'image' : 'file'} size={15} color={t.colors.muted} />
          <Text style={[textStyle(t, 'caption'), { color: t.colors.muted, fontWeight: '600' }]}>{kindLabel}</Text>
        </View>
      ) : null}
      {share.title ? (
        <Text style={[textStyle(t, 'callout'), { color: t.colors.text, fontWeight: '600' }]} numberOfLines={2}>
          {share.title}
        </Text>
      ) : null}
      {share.text ? (
        <Text style={[textStyle(t, 'callout'), { color: kind === 'link' && share.text === share.url ? t.colors.accentText : t.colors.text }]} numberOfLines={kind === 'link' ? 3 : 5} selectable>
          {share.text}
        </Text>
      ) : null}
      {images.length ? (
        <View style={styles.thumbs}>
          {images.slice(0, MAX_THUMBS).map((f, i) => (
            <Thumb key={`${f.name}-${i}`} file={f} />
          ))}
          {images.length > MAX_THUMBS ? (
            <Text style={[textStyle(t, 'caption'), styles.more, { color: t.colors.muted }]}>{tr('share.sheet.more', { count: images.length - MAX_THUMBS })}</Text>
          ) : null}
        </View>
      ) : null}
      {others.slice(0, MAX_FILE_ROWS).map((f, i) => (
        <FileRow key={`${f.name}-${i}`} file={f} />
      ))}
      {others.length > MAX_FILE_ROWS ? (
        <Text style={[textStyle(t, 'caption'), { color: t.colors.muted }]}>{tr('share.sheet.more', { count: others.length - MAX_FILE_ROWS })}</Text>
      ) : null}
      {share.truncated ? <Text style={[textStyle(t, 'caption'), { color: t.colors.muted }]}>{tr('share.sheet.truncated')}</Text> : null}
      {share.refused.length ? (
        <View style={styles.refused} accessible accessibilityRole="text">
          <Text style={[textStyle(t, 'caption'), { color: t.colors.danger, fontWeight: '600' }]}>{tr('share.sheet.refused')}</Text>
          {share.refused.map((m, i) => (
            <Text key={i} style={[textStyle(t, 'caption'), { color: t.colors.danger }]}>
              {tr(m.key, m.vars)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function useWebObjectUrl(file: File | undefined): string | undefined {
  const url = useMemo(() => (file && Platform.OS === 'web' ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function Thumb({ file }: { file: SharedFile }) {
  const t = useTheme();
  const webUrl = useWebObjectUrl(file.webFile);
  const uri = webUrl ?? file.uri;
  return (
    <Image
      source={uri ? { uri } : undefined}
      style={[styles.thumb, { borderRadius: t.radii.control, backgroundColor: t.colors.surfacePressed }]}
      contentFit="cover"
      accessibilityLabel={file.name}
      accessible
    />
  );
}

function FileRow({ file }: { file: SharedFile }) {
  const tr = useT();
  const t = useTheme();
  const { lang } = useLocale();
  return (
    <View style={styles.fileRow}>
      <View style={[styles.fileBadge, { backgroundColor: t.colors.surfacePressed, borderRadius: t.radii.control }]}>
        <Text style={[textStyle(t, 'caption'), { color: t.colors.muted, fontWeight: '700' }]}>{typeLabel(file.name, file.mimeType, tr)}</Text>
      </View>
      <Text style={[textStyle(t, 'callout'), styles.fileName, { color: t.colors.text }]} numberOfLines={1}>
        {file.name}
      </Text>
      {typeof file.size === 'number' ? <Text style={[textStyle(t, 'caption'), { color: t.colors.muted }]}>{formatBytes(file.size, lang)}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- chips

function Section({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[textStyle(t, 'caption'), styles.sectionLabel, { color: t.colors.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

/**
 * One choice chip. Single-choice rows (target, connection, bot) are radios; intent chips are toggles (tap again to
 * clear), announced as checked / not checked.
 */
function Chip({ label, a11yLabel, selected, onPress, toggle, testID }: { label: string; a11yLabel?: string; selected: boolean; onPress(): void; toggle?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={toggle ? 'togglebutton' : 'radio'}
      accessibilityLabel={a11yLabel}
      {...a11yState({ checked: selected })}
      hitSlop={4}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: t.radii.pill,
          borderColor: selected ? t.colors.accent : t.colors.border,
          backgroundColor: selected ? t.colors.accentSoft : pressed ? t.colors.surfacePressed : 'transparent',
        },
      ]}
    >
      {selected ? <Icon name="check" size={14} color={t.colors.accent} strokeWidth={2.4} /> : null}
      <Text style={[textStyle(t, 'callout'), { color: selected ? t.colors.text : t.colors.muted, fontWeight: selected ? '600' : '400' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  title: { marginBottom: 10 },
  lead: { marginTop: 12 },
  scroll: { flexGrow: 0 },
  scrollBody: { paddingBottom: 4 },
  preview: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thumbs: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  thumb: { width: 60, height: 60 },
  more: { marginLeft: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  fileBadge: { minWidth: 40, height: 26, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1 },
  refused: { marginTop: 4, gap: 2 },
  section: { marginTop: 14 },
  sectionLabel: { marginBottom: 8, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderWidth: 1, maxWidth: '100%' },
  note: { marginTop: 10, minHeight: 44, maxHeight: 120, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: 'top' },
  hint: { marginTop: 10 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
