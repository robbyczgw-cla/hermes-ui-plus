// Memory tab: MEMORY.md / USER.md entries when the hermes-ui-plus plugin shares them (read-only), otherwise an
// explanation. Either way the user can ask Hermes in the chat what it remembers or to forget something.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { SkeletonLines } from '../ui/primitives/Skeleton';
import { Icon } from '../chat/icons';
import { confirmAsync } from '../chat/commands/confirm';
import { useLocale, useT, type TKey } from '../i18n';
import { Footnote, Group, SectionTitle } from '../settings/ui';
import { fillLevel, quoteEntry, type MemoryStore } from './model';
import type { MemoryLoad } from './LibraryScreen';
import { Notice } from './parts';

type Ask = (text: string, mode: 'send' | 'fill') => void;

const REASON_KEYS: Record<string, TKey> = {
  memory_not_exposed: 'library.memory.reasons.memory_not_exposed',
  other_bot: 'library.memory.reasons.other_bot',
};

export function MemoryPane({ load, botName, onRetry, onAsk }: { load: MemoryLoad; botName: string; onRetry(): void; onAsk: Ask }) {
  const th = useTheme();
  const t = useT();
  const forget = async (entry: string) => {
    const quoted = quoteEntry(entry);
    const ok = await confirmAsync(t('library.memory.forgetTitle'), t('library.memory.forgetBody', { bot: botName, entry: quoted }), t('library.memory.forgetSend'), t('library.memory.cancel'));
    if (ok) onAsk(t('library.memory.forgetEntryPrompt', { entry: quoted }), 'send');
  };

  return (
    <View style={styles.gap}>
      <Text style={[textStyle(th, 'callout'), styles.intro, { color: th.colors.muted }]}>{t('library.memory.intro', { bot: botName })}</Text>
      {load.kind === 'loading' ? (
        <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
          <SkeletonLines lines={4} />
        </View>
      ) : load.kind === 'failed' ? (
        <Notice icon="alert" tone="warning" title={t('library.tabs.memory')} body={t('library.loadFailed', { message: load.message })}>
          <Button label={t('library.retry')} onPress={onRetry} variant="secondary" size="small" />
        </Notice>
      ) : load.kind === 'unavailable' ? (
        <Notice icon="brain" title={t('library.memory.unavailableTitle')} body={`${t('library.memory.unavailable')}\n\n${load.reason && REASON_KEYS[load.reason] ? t(REASON_KEYS[load.reason], { bot: botName }) : t('library.memory.reasons.plugin')}`} />
      ) : (
        <>
          {load.memory.stores.map((s) => (
            <StoreSection key={s.target} store={s} onForget={(e) => void forget(e)} />
          ))}
          {load.memory.provider ? <Footnote>{t('library.memory.provider', { name: load.memory.provider })}</Footnote> : null}
        </>
      )}
      <AskBox botName={botName} onAsk={onAsk} />
      <Footnote>{t('library.memory.editNote')}</Footnote>
    </View>
  );
}

function StoreSection({ store, onForget }: { store: MemoryStore; onForget(entry: string): void }) {
  const th = useTheme();
  const t = useT();
  const { formatRelative, formatNumber } = useLocale();
  const level = fillLevel(store);
  const full = level >= 0.9;
  const meta = [store.updatedAt ? t('library.memory.updated', { when: formatRelative(store.updatedAt) }) : t('library.memory.neverWritten'), store.limit ? t('library.memory.fill', { used: formatNumber(store.chars), limit: formatNumber(store.limit) }) : ''].filter(Boolean).join(' · ');
  return (
    <View style={styles.section} testID={`memory-${store.target}`}>
      <SectionTitle>{t(`library.memory.stores.${store.target}` as TKey)}</SectionTitle>
      <Group>
        <View style={[styles.storeHead, { borderBottomColor: th.colors.border }]}>
          <Text style={[textStyle(th, 'caption'), { color: th.colors.muted }]}>{t(`library.memory.storesHint.${store.target}` as TKey)}</Text>
          {store.enabled ? (
            <>
              <Text style={[textStyle(th, 'caption'), { color: full ? th.colors.warning : th.colors.subtle }]}>{meta}</Text>
              {store.limit ? (
                <View
                  style={[styles.bar, { backgroundColor: th.colors.surfaceAlt }]}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('library.memory.fillA11y', { percent: Math.round(level * 100) })}
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100) }}
                >
                  <View style={[styles.barFill, { width: `${Math.max(2, Math.round(level * 100))}%`, backgroundColor: full ? th.colors.warning : th.colors.accent }]} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
        {!store.enabled ? (
          <Text style={[textStyle(th, 'callout'), styles.entry, { color: th.colors.muted }]}>{t('library.memory.storeOff')}</Text>
        ) : store.entries.length === 0 ? (
          <Text style={[textStyle(th, 'callout'), styles.entry, { color: th.colors.muted }]}>{t('library.memory.empty')}</Text>
        ) : (
          store.entries.map((e, i) => (
            <View key={`${i}-${e.slice(0, 24)}`} style={[styles.entryRow, i < store.entries.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.colors.border }]}>
              <Text style={[textStyle(th, 'body'), styles.flex, { color: th.colors.text }]} selectable>
                {e}
              </Text>
              <Pressable
                onPress={() => onForget(e)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('library.memory.forgetA11y')}
                accessibilityHint={quoteEntry(e, 80)}
                style={({ pressed }) => [styles.forget, pressed && { backgroundColor: th.colors.surfacePressed }]}
                testID={`memory-forget-${store.target}-${i}`}
              >
                <Icon name="close" size={16} color={th.colors.subtle} />
              </Pressable>
            </View>
          ))
        )}
      </Group>
    </View>
  );
}

function AskBox({ botName, onAsk }: { botName: string; onAsk: Ask }) {
  const th = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onAsk(t('library.memory.forgetSomethingPrompt', { text: v }), 'send');
  };
  return (
    <View style={styles.section}>
      <SectionTitle>{t('library.memory.actions')}</SectionTitle>
      <View style={[styles.card, styles.askCard, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
        <View style={styles.actions}>
          <Button label={t('library.memory.askWhat')} onPress={() => onAsk(t('library.memory.askWhatPrompt'), 'send')} variant="secondary" size="small" testID="memory-ask-what" />
          {!open ? <Button label={t('library.memory.forgetSomething')} onPress={() => setOpen(true)} variant="secondary" size="small" testID="memory-forget-open" /> : null}
        </View>
        {open ? (
          <View style={styles.askForm}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('library.memory.forgetPlaceholder')}
              placeholderTextColor={th.colors.subtle}
              accessibilityLabel={t('library.memory.forgetPlaceholder')}
              accessibilityHint={botName}
              autoFocus
              multiline
              maxLength={500}
              style={[styles.input, textStyle(th, 'body'), { color: th.colors.text, borderColor: th.colors.borderControl, borderRadius: th.radii.control }]}
              testID="memory-forget-input"
            />
            <View style={styles.actions}>
              <Button label={t('library.memory.send')} onPress={send} variant="primary" size="small" disabled={!text.trim()} testID="memory-forget-send" />
              <Button
                label={t('library.memory.cancel')}
                onPress={() => {
                  setOpen(false);
                  setText('');
                }}
                variant="tertiary"
                size="small"
              />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: 8 },
  intro: { marginHorizontal: 4, marginTop: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  askCard: { gap: 10, paddingVertical: 12 },
  section: { gap: 2, marginTop: 6 },
  storeHead: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 4, borderRadius: 2 },
  entry: { paddingHorizontal: 14, paddingVertical: 12 },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 14, paddingRight: 6, paddingVertical: 10 },
  forget: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: -6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  askForm: { gap: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, minHeight: 72, textAlignVertical: 'top' },
});
