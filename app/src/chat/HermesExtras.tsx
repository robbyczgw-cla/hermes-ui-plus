/**
 * Hermes-specific blocks around an answer (all stroke icons, de/en/es via `hermesTools.*`):
 * - <ContextDivider/>   "Kontext komprimiert" (hermes.status compacted / pruned skill marker)
 * - <MemoryNotes/>      "gemerkt" chip per memory write
 * - <MediaFiles/>       `MEDIA:<path>` tags as file chips / inline images (bridge GET /bridge/media)
 * - <ReminderCards/>    "Erinnerung gesetzt · morgen 08:00 · …" with Ändern / Löschen (chat-native)
 * Pure logic: hermesTools.ts, mediaTags.ts, reminder.ts.
 */
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { formatBytes } from '../attachments/mime';
import { useI18n } from '../i18n';
import { Button, useTheme } from '../ui';
import { Photo, useNaturalAspect } from '../ui/components/imageParts';
import { useCopy } from './actions';
import type { MemoryNote } from './hermesTools';
import { Icon, type IconName } from './icons';
import { fetchMedia, MediaUnavailable, openLocalMedia, probeMedia, type MediaConn } from './mediaFetch';
import type { MediaKind, MediaRef } from './mediaTags';
import { reminderChangePrefill, reminderDeleteMessage, reminderWhen, type Reminder } from './reminder';
import { useToast } from './Toast';
import { useTurnActions } from './turnActions';

// ------------------------------------------------------------------ context divider

export const ContextDivider = memo(function ContextDivider() {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={styles.divider} accessible accessibilityRole="text" accessibilityLabel={tr('hermesTools.compacted.a11y')}>
      <View style={[styles.dividerLine, { backgroundColor: t.colors.border }]} />
      <Icon name="compress" size={13} color={t.colors.subtle} />
      <Text style={[t.typography.caption, { color: t.colors.subtle }]}>{tr('hermesTools.compacted.divider')}</Text>
      <View style={[styles.dividerLine, { backgroundColor: t.colors.border }]} />
    </View>
  );
});

// ------------------------------------------------------------------ "gemerkt"

export const MemoryNotes = memo(function MemoryNotes({ notes }: { notes: MemoryNote[] }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  if (!notes.length) return null;
  return (
    <View style={styles.notes}>
      {notes.map((n) => (
        <View
          key={n.id}
          accessible
          accessibilityLabel={n.text ? `${tr('hermesTools.memory.chipA11y')}: ${n.text}` : tr('hermesTools.memory.updated')}
          style={[styles.note, { borderRadius: t.radii.pill }, { backgroundColor: t.colors.surfaceAlt }]}
        >
          <Icon name="brain" size={14} color={t.colors.muted} />
          <Text style={[t.typography.caption, styles.noteText, { color: t.colors.muted }]} numberOfLines={2}>
            {n.text ? `${tr('hermesTools.memory.chip')} · ${n.text}` : tr('hermesTools.memory.updated')}
          </Text>
        </View>
      ))}
    </View>
  );
});

// ------------------------------------------------------------------ MEDIA files

const KIND_ICON: Record<MediaKind, IconName> = {
  image: 'image',
  pdf: 'file',
  audio: 'play',
  video: 'play',
  doc: 'file',
  sheet: 'file',
  slides: 'file',
  archive: 'download',
  text: 'file',
  file: 'file',
};

export const MediaFiles = memo(function MediaFiles({ refs, conn }: { refs: MediaRef[]; conn: MediaConn | null }) {
  if (!refs.length) return null;
  return (
    <View style={styles.media}>
      {refs.map((r) => (r.inlineImage && conn ? <MediaImage key={r.path} file={r} conn={conn} /> : <MediaChip key={r.path} file={r} conn={conn} />))}
    </View>
  );
});

type ChipState = 'checking' | 'ready' | 'server';

function MediaChip({ file, conn }: { file: MediaRef; conn: MediaConn | null }) {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const copy = useCopy();
  const toast = useToast();
  const [state, setState] = useState<ChipState>(conn ? 'checking' : 'server');
  const [size, setSize] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!conn) return;
    let alive = true;
    probeMedia(conn, file).then(
      (p) => {
        if (!alive) return;
        setSize(p.size);
        setState('ready');
      },
      () => alive && setState('server'),
    );
    return () => {
      alive = false;
    };
  }, [conn, file]);

  const kind = tr(`hermesTools.media.kind.${file.kind}`);
  const copyPath = () => copy(file.path, tr('hermesTools.media.pathCopied'));
  const open = async () => {
    if (!conn || state === 'server') return copyPath();
    if (busy) return;
    setBusy(true);
    try {
      await openLocalMedia(await fetchMedia(conn, file), file);
    } catch (e) {
      if (e instanceof MediaUnavailable) setState('server');
      toast(tr('hermesTools.media.failed'));
    } finally {
      setBusy(false);
    }
  };
  const sub =
    state === 'server' ? tr('hermesTools.media.onServer') : busy ? tr('hermesTools.media.loading') : size ? `${kind} · ${formatBytes(size, lang)}` : kind;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${tr('hermesTools.media.a11y', { kind, name: file.name })}. ${sub}`}
      accessibilityHint={state === 'server' ? tr('hermesTools.media.copyPath') : tr('hermesTools.media.open')}
      style={({ pressed }) => [styles.file, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, borderColor: t.colors.border, borderRadius: t.radii.control }]}
    >
      <Icon name={KIND_ICON[file.kind]} size={20} color={t.colors.muted} />
      <View style={styles.fileText}>
        <Text style={[t.typography.callout, styles.fileName, { color: t.colors.text }]} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={[t.typography.caption, styles.fileSub, { color: t.colors.muted }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {state === 'server' ? (
        // a visual shortcut only: on the server the whole row already copies the path (its hint says so); a button nested
        // in the row's button is unreachable for VoiceOver and invalid inside role="button" on web
        <Pressable onPress={copyPath} hitSlop={8} accessible={false} aria-hidden tabIndex={-1} style={styles.fileBtn}>
          <Icon name="copy" size={17} color={t.colors.muted} />
        </Pressable>
      ) : (
        <Icon name="external" size={17} color={t.colors.subtle} />
      )}
    </Pressable>
  );
}

/** Inline image of a MEDIA tag: fetched through the bridge into the cache, shown with the shared Photo node. */
function MediaImage({ file, conn }: { file: MediaRef; conn: MediaConn }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // keyed by the server path (the local copy's uri is only known after the fetch): no reflow when shown again
  const [aspect, onNaturalSize] = useNaturalAspect(`media:${file.path}`);

  useEffect(() => {
    let alive = true;
    fetchMedia(conn, file).then(
      (u) => alive && setUri(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [conn, file]);

  if (failed) return <MediaChip file={file} conn={null} />;
  if (!uri) return <View style={[styles.imagePending, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]} accessibilityLabel={file.name} />;
  return (
    <View style={styles.image}>
      <Photo
        uri={uri}
        aspect={Math.min(2.4, Math.max(0.6, aspect))}
        fit="contain"
        label={file.name}
        onPress={() => void openLocalMedia(uri, file)}
        onNaturalSize={onNaturalSize}
      />
    </View>
  );
}

// ------------------------------------------------------------------ reminder card

export const ReminderCards = memo(function ReminderCards({ reminders }: { reminders: Reminder[] }) {
  if (!reminders.length) return null;
  return (
    <View style={styles.cards}>
      {reminders.map((r) => (
        <ReminderCard key={r.id} r={r} />
      ))}
    </View>
  );
});

function ReminderCard({ r }: { r: Reminder }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const toast = useToast();
  const { sendMessage, prefillComposer } = useTurnActions();
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  const title = r.action === 'update' ? tr('hermesTools.reminder.titleUpdated') : tr('hermesTools.reminder.title');
  const when = reminderWhen(tr, locale, r);
  const head = [title, when, r.text].filter(Boolean).join(' · ');
  const showSchedule = !!r.schedule && r.recurring && r.schedule !== when;
  const remove = () => {
    if (!sendMessage) return;
    if (sendMessage(reminderDeleteMessage(tr, r))) setSent(true);
    else toast(tr('chat.busy'));
    setAsking(false);
  };
  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border, borderRadius: t.radii.control }]}
      accessible={false}
    >
      <View style={styles.cardHead} accessible accessibilityLabel={head}>
        <Icon name="bell" size={18} color={t.colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={[t.typography.callout, { color: t.colors.text }]} numberOfLines={3}>
            <Text style={{ fontWeight: '600' }}>{title}</Text>
            {when ? ` · ${when}` : ''}
            {r.text ? ` · ${r.text}` : ''}
          </Text>
          {showSchedule ? <Text style={[t.typography.caption, styles.cardSub, { color: t.colors.muted }]}>{r.schedule}</Text> : null}
        </View>
      </View>
      {sent ? null : asking ? (
        <View style={styles.cardButtons}>
          <Text style={[t.typography.caption, styles.cardAsk, { color: t.colors.muted }]}>{tr('hermesTools.reminder.deleteAsk')}</Text>
          <Button label={tr('hermesTools.reminder.cancel')} variant="tertiary" size="small" onPress={() => setAsking(false)} />
          <Button label={tr('hermesTools.reminder.deleteConfirm')} variant="primary" tone="seal" size="small" onPress={remove} />
        </View>
      ) : (
        <View style={styles.cardButtons}>
          <Button label={tr('hermesTools.reminder.change')} icon={(color, size) => <Icon name="edit" size={size} color={color} />} size="small" onPress={() => prefillComposer?.(reminderChangePrefill(tr, r))} disabled={!prefillComposer} />
          <Button label={tr('hermesTools.reminder.delete')} icon={(color, size) => <Icon name="trash" size={size} color={color} />} tone="seal" size="small" onPress={() => setAsking(true)} disabled={!sendMessage} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  noteText: { flexShrink: 1 },
  media: { gap: 8, marginTop: 12 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, maxWidth: 420 },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { fontWeight: '500' },
  fileSub: { marginTop: 1 },
  fileBtn: { padding: 4 },
  image: { maxWidth: 420 },
  imagePending: { width: '100%', maxWidth: 420, aspectRatio: 4 / 3 },
  cards: { gap: 8, marginTop: 12 },
  card: { padding: 12, borderWidth: StyleSheet.hairlineWidth, gap: 10, maxWidth: 480 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardSub: { marginTop: 2 },
  cardButtons: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  cardAsk: { marginRight: 4 },
});
