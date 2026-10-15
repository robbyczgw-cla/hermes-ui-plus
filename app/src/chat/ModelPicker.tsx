/**
 * Bottom sheet to pick the model of the open conversation: searchable, virtualised list
 * (ModelSearchList) with favorites, recents, provider sections and capability badges.
 * Hermes: "Standard" + model_routes aliases (GET /v1/models) + the models of every authenticated
 * provider of GET /api/model/options (cached per profile, refreshed when the sheet opens and the cache is old).
 */
import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useHermesCapabilities } from '../hermes/useHermesCapabilities';
import { botBaseUrl, botDisplayName, botOf, withBot, type HermesBot } from '../hermes/bots';
import type { ConnectionProfile } from '../settings/profiles';
import { useT } from '../i18n';
import { SheetGrabber, SheetModal, useTheme } from '../ui';
import { useModalPresence } from '../ui/lib/useModalPresence';
import { lightHaptic } from './actions';
import { Icon } from './icons';
import { HERMES_DEFAULT_MODEL, listsServerModels, modelEntries } from './models';
import { ModelSearchList } from './ModelSearchList';
import { useModelList } from './useModelList';
import { useModelPrefs } from './useModelPrefs';

type Props = {
  open: boolean;
  onClose(): void;
  profile: ConnectionProfile;
  /** effective model of the conversation (undefined = Hermes server default) */
  current: string | undefined;
  onPick(model: string | undefined): void;
  /** prefilled search ("/model <name>" slash command) */
  initialQuery?: string;
  /** sheet title (default "Modell für diesen Chat"; the answer menu's one-turn retry uses its own) */
  title?: string;
  /** Hermes bot of the chat (hermes/bots.ts): the model list is the bot's (`/p/<bot>/v1/models`) */
  bot?: string;
  /** more than the default profile → compact "Bot" section above the models */
  bots?: readonly HermesBot[];
  onPickBot?(bot: string | undefined): void;
};

/** memo + renders nothing while closed (the chat view re-renders on every streaming update) */
export const ModelPicker = memo(function ModelPicker(props: Props) {
  const present = useModalPresence(props.open);
  return present ? <ModelPickerSheet {...props} /> : null;
});

function ModelPickerSheet({ open, onClose, profile, current, onPick, initialQuery, title, bot, bots, onPickBot }: Props) {
  const tr = useT();
  const win = useWindowDimensions();
  const hermes = profile.kind === 'hermes';
  // a bot has its own models: list them under its own cache key and base URL (/p/<bot>/v1/models)
  const chatBot = hermes ? botOf(bot) : undefined;
  const listProfile = useMemo(
    () => (chatBot ? { ...profile, id: `${profile.id}~${chatBot}`, baseUrl: botBaseUrl(profile.baseUrl, chatBot) } : profile),
    [profile, chatBot],
  );
  const models = useModelList(listProfile);
  const { ensureFresh } = models;
  const fetchable = listsServerModels(profile.kind);
  // Hermes provider catalog (GET /api/model/options, cached app-wide by the hook)
  const hermesConn = useMemo(
    () => (hermes ? withBot({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }, chatBot) : undefined),
    [hermes, profile.baseUrl, profile.apiKey, chatBot],
  );
  const hermesCaps = useHermesCapabilities(hermesConn);
  const prefs = useModelPrefs(profile.id);

  useEffect(() => {
    if (open && fetchable) ensureFresh();
  }, [open, fetchable, ensureFresh]);

  const selected = hermes && current === HERMES_DEFAULT_MODEL ? undefined : current;
  const entries = useMemo(
    () =>
      modelEntries({
        kind: profile.kind,
        t: tr,
        current: selected,
        serverIds: models.ids,
        hermes: hermesCaps.catalog,
      }),
    [profile.kind, tr, selected, models.ids, hermesCaps.catalog]
  );

  const pick = useCallback(
    (id: string | undefined) => {
      lightHaptic();
      prefs.recordUse(id);
      onPick(id);
      onClose();
    },
    [prefs, onPick, onClose]
  );
  const refresh = () => {
    models.refresh();
    if (hermes) hermesCaps.refresh();
  };
  const loading = models.loading || (hermes && hermesCaps.loading);
  const listHeight = Math.max(220, Math.min(win.height * 0.62 - 120, 560));

  return (
    <ModelSheet open={open} onClose={onClose} title={title ?? tr('chat.modelPicker.title')} subtitle={profile.name} loading={loading} onRefresh={fetchable ? refresh : undefined}>
      {bots && bots.length > 1 && onPickBot ? <BotRow bots={bots} selected={botOf(bot)} onPick={onPickBot} /> : null}
      <ModelSearchList
        entries={entries}
        selected={selected}
        onPick={pick}
        prefs={prefs.prefs}
        onToggleFavorite={prefs.toggleFavorite}
        loading={loading}
        error={fetchable ? models.error : null}
        onRetry={refresh}
        height={listHeight}
        onEscape={onClose}
        autoFocus={Platform.OS === 'web'}
        initialQuery={initialQuery}
      />
    </ModelSheet>
  );
}

/**
 * "Bot" section: the connection's Hermes profiles as one compact, horizontally scrolling row of chips (default
 * first). Each bot has its own model, memory and skills; picking one on a chat with messages starts a new chat.
 */
function BotRow({ bots, selected, onPick }: { bots: readonly HermesBot[]; selected: string | undefined; onPick(bot: string | undefined): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.bots}>
      <Text style={[styles.botsTitle, { color: t.colors.muted }]} accessibilityRole="header">
        {tr('bots.picker.section')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.botsRow} keyboardShouldPersistTaps="handled">
        {bots.map((b) => {
          const name = b.default ? undefined : b.name;
          const on = name === selected;
          const label = botDisplayName(b, tr('bots.picker.default'));
          return (
            <Pressable
              key={b.name}
              onPress={() => {
                lightHaptic();
                onPick(name);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={b.model ? tr('bots.picker.a11y', { name: label, model: b.model }) : label}
              style={({ pressed }) => [
                styles.bot,
                { borderColor: on ? t.colors.accent : t.colors.border, backgroundColor: on ? t.colors.surfaceAlt : pressed ? t.colors.surfacePressed : 'transparent' },
              ]}
            >
              <Text style={[styles.botName, { color: on ? t.colors.text : t.colors.muted }]} numberOfLines={1}>
                {label}
              </Text>
              {b.model ? (
                <Text style={[styles.botModel, { color: t.colors.subtle }]} numberOfLines={1}>
                  {b.model}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** bottom sheet chrome shared by the in-chat picker and the profile editor's model chooser */
export function ModelSheet({
  open,
  onClose,
  title,
  subtitle,
  loading,
  onRefresh,
  children,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  subtitle?: string;
  loading?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const tr = useT();
  return (
    <SheetModal visible={open} onClose={onClose} closeLabel={tr('actions.close')} label={title} style={styles.sheet}>
      <SheetGrabber />
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.colors.text }]}>{title}</Text>
        {onRefresh ? (
          <Pressable
            onPress={onRefresh}
            disabled={loading}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tr('chat.modelPicker.reload')}
            style={({ pressed }) => [styles.reload, pressed && { backgroundColor: t.colors.surfacePressed }]}
          >
            {loading ? <ActivityIndicator size="small" color={t.colors.muted} /> : <Icon name="retry" size={17} color={t.colors.muted} />}
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('actions.close')} style={styles.reload}>
          <Icon name="close" size={17} color={t.colors.muted} />
        </Pressable>
      </View>
      {subtitle ? (
        <Text style={[styles.sub, { color: t.colors.muted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 12 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12.5, paddingHorizontal: 8, marginTop: 2, marginBottom: 6 },
  reload: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  bots: { marginBottom: 8 },
  botsTitle: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.4, paddingHorizontal: 8, marginBottom: 4, textTransform: 'uppercase' },
  botsRow: { gap: 6, paddingHorizontal: 8 },
  bot: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
  botName: { fontSize: 13.5, fontWeight: '600' },
  botModel: { fontSize: 11, marginTop: 1 },
});
