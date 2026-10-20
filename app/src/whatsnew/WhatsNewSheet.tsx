/**
 * "Neu in dieser Version": a small sheet after an update (whatsnew/model.ts decides, storage.ts remembers). One row per
 * new feature that applies to the open connection; a tap closes the sheet and opens the feature. Shown once per app
 * version, never on a fresh install, never over onboarding or the consent sheet (the chat view passes `blocked`).
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../chat/icons';
import { useConversations } from '../conversations/ConversationsProvider';
import { botOf } from '../hermes/bots';
import { useT } from '../i18n';
import { askInNewChat } from '../library/askHermes';
import { libraryApplies, libraryRoute } from '../library/source';
import type { ConnectionProfile } from '../settings/profiles';
import { deliverShare } from '../share/inbox';
import { Button, SheetGrabber, SheetModal, useTheme } from '../ui';
import { Text } from '../ui/primitives/Text';
import { applicableItems, shortVersion, type WhatsNewItemId, type WhatsNewRelease } from './model';
import { markWhatsNewShown, whatsNewClaimed, whatsNewForLaunch } from './storage';

type Ctx = { profile: ConnectionProfile; bot: string | undefined; open(path: string): void; ask(text: string): void; t: ReturnType<typeof useT> };

/** per item: its icon, whether the open connection has it, and what a tap opens */
const ITEMS: Record<WhatsNewItemId, { icon: IconName; applies(p: ConnectionProfile): boolean; run(c: Ctx): void }> = {
  // a new chat with an example request in the composer: the user sends it (or not) and Hermes makes the live card
  liveCards: { icon: 'checklist', applies: (p) => p.kind === 'hermes' || p.kind === 'demo', run: (c) => c.ask(c.t('whatsNew.items.liveCards.prompt')) },
  skills: { icon: 'book', applies: libraryApplies, run: (c) => c.open(libraryRoute(c.bot)) },
  memory: { icon: 'brain', applies: libraryApplies, run: (c) => c.open(libraryRoute(c.bot, 'memory')) },
};

/** Mount once per chat view; at most one sheet per app run opens (the first unblocked view takes it). */
export function WhatsNew({ profile, bot, blocked }: { profile: ConnectionProfile; bot: string | undefined; blocked: boolean }) {
  const [release, setRelease] = useState<WhatsNewRelease | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void whatsNewForLaunch().then((r) => alive && setRelease(r));
    return () => {
      alive = false;
    };
  }, []);
  const items = release ? applicableItems(release, (id) => ITEMS[id].applies(profile)) : [];
  const ready = !!release && items.length > 0 && !blocked;
  useEffect(() => {
    if (!ready || open) return;
    // a moment after the chat settled, not in the middle of the first frame
    const timer = setTimeout(() => {
      if (whatsNewClaimed()) return;
      markWhatsNewShown();
      setOpen(true);
    }, 700);
    return () => clearTimeout(timer);
  }, [ready, open]);
  if (!open || !release) return null;
  return <WhatsNewSheet release={release} items={items} profile={profile} bot={bot} onClose={() => setOpen(false)} />;
}

export function WhatsNewSheet({ release, items, profile, bot, onClose }: { release: WhatsNewRelease; items: readonly WhatsNewItemId[]; profile: ConnectionProfile; bot: string | undefined; onClose(): void }) {
  const th = useTheme();
  const tr = useT();
  const router = useRouter();
  const convs = useConversations();
  const b = botOf(bot);
  const ctx: Ctx = {
    profile,
    bot: b,
    open: (path) => router.push(path as never),
    ask: (text) => void askInNewChat(convs, profile, b, text, 'fill', deliverShare),
    t: tr,
  };
  return (
    <SheetModal visible onClose={onClose} closeLabel={tr('actions.close')} label={tr('whatsNew.a11y', { count: items.length })} maxWidth={420} style={styles.sheet}>
      <SheetGrabber />
      <View style={styles.head}>
        <Text style={[th.typography.caption, { color: th.colors.muted }]}>{tr('whatsNew.version', { version: shortVersion(release.version) })}</Text>
        <Text style={[th.typography.headline, { color: th.colors.text }]} accessibilityRole="header">
          {tr('whatsNew.title')}
        </Text>
      </View>
      <View style={[styles.list, { borderColor: th.colors.border, borderRadius: th.radii.card, backgroundColor: th.colors.surface }]}>
        {items.map((id, i) => {
          const title = tr(`whatsNew.items.${id}.title`);
          const text = tr(`whatsNew.items.${id}.text`);
          return (
            <Pressable
              key={id}
              testID={`whatsnew-${id}`}
              onPress={() => {
                onClose();
                ITEMS[id].run(ctx);
              }}
              accessibilityRole="button"
              accessibilityLabel={tr('whatsNew.itemA11y', { title, text })}
              style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.colors.border }, pressed && { backgroundColor: th.colors.surfacePressed }]}
            >
              <View style={[styles.icon, { backgroundColor: th.colors.accentSoft }]}>
                <Icon name={ITEMS[id].icon} size={18} color={th.colors.accentText} />
              </View>
              <View style={styles.rowText}>
                <Text style={[th.typography.bodyStrong, { color: th.colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[th.typography.caption, { color: th.colors.muted }]} numberOfLines={2}>
                  {text}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={th.colors.subtle} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.foot}>
        <Button label={tr('whatsNew.dismiss')} variant="secondary" onPress={onClose} testID="whatsnew-dismiss" />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 18, paddingBottom: 18 },
  head: { gap: 2, paddingTop: 4, paddingBottom: 14 },
  list: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  foot: { alignItems: 'flex-end', paddingTop: 14 },
});
