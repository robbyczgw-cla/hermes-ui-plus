/**
 * Chat menu of the open conversation (header ⋯ on phones, title menu on wide windows): Im Chat suchen, Teilen /
 * Exportieren, Anpinnen, Umbenennen, Archivieren, Löschen. "Zum Startbildschirm hinzufügen" is not offered: pinned /
 * dynamic Android shortcuts need ShortcutManager, which no installed Expo module exposes (a native module would be
 * required) – and there is nothing comparable on the web.
 */
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/primitives/Text';
import { displayTitle } from '../conversations/title';
import type { ConversationMeta } from '../conversations/types';
import { useT } from '../i18n';
import { Button, SheetGrabber, SheetModal, useTheme } from '../ui';
import { ActionMenu, type MenuItem } from './ActionMenu';

type Props = {
  open: boolean;
  onClose(): void;
  meta: ConversationMeta | undefined;
  /** the chat has messages (a draft has nothing to search / export / archive) */
  hasMessages: boolean;
  onFind(): void;
  /** the chat has live cards (live/LiveProvider): "Alle Live-Karten" opens their list */
  onLiveCards?: () => void;
  /** a Hermes chat: "Über <Name>" (bots/BotInfoSheet.tsx: model, the bot's routines); `aboutName` = the bot's name */
  onAbout?: () => void;
  aboutName?: string;
  onExport(): void;
  onPin(): void;
  onRename(title: string): void;
  onArchive(): void;
  onDelete(): void;
};

export const ChatMenu = memo(function ChatMenu({ open, onClose, meta, hasMessages, onFind, onLiveCards, onAbout, aboutName, onExport, onPin, onRename, onArchive, onDelete }: Props) {
  const tr = useT();
  const [renaming, setRenaming] = useState(false);
  const stored = !!meta && hasMessages;
  // a bot's Bot Chat is shared with Hermes Desktop and found by its title: no pin / rename / archive / delete here
  const botChat = !!meta?.botChat;
  const items: MenuItem[] = [
    // name, model and (unless Settings → Chat → "Routinen" is off) the bot's routines, for every Hermes chat, also without bots
    ...(onAbout ? [{ key: 'about', icon: 'bell' as const, label: tr('bots.info.title', { name: aboutName ?? 'Hermes' }), onPress: onAbout }] : []),
    { key: 'find', icon: 'search', label: tr('menus.chat.find'), onPress: onFind, disabled: !hasMessages },
    ...(onLiveCards ? [{ key: 'live', icon: 'checklist' as const, label: tr('live.list.open'), onPress: onLiveCards }] : []),
    { key: 'share', icon: 'share', label: tr('menus.chat.share'), onPress: onExport, disabled: !hasMessages },
    ...(botChat
      ? []
      : ([
          { key: 'pin', icon: 'pin', label: meta?.pinned ? tr('menus.chat.unpin') : tr('menus.chat.pin'), onPress: onPin, disabled: !stored },
          { key: 'rename', icon: 'edit', label: tr('menus.chat.rename'), onPress: () => setRenaming(true), disabled: !stored },
          { key: 'archive', icon: 'archive', label: meta?.archived ? tr('menus.chat.unarchive') : tr('menus.chat.archive'), onPress: onArchive, disabled: !stored },
          { key: 'delete', icon: 'trash', label: tr('menus.chat.delete'), onPress: onDelete, danger: true, disabled: !hasMessages },
        ] satisfies MenuItem[])),
  ];
  return (
    <>
      {open ? <ActionMenu visible onClose={onClose} label={tr('menus.chat.title')} items={items} /> : null}
      {renaming && meta ? (
        <RenameSheet
          initial={displayTitle(meta.title, tr('conversations.list.newChat'))}
          onCancel={() => setRenaming(false)}
          onSave={(title) => {
            setRenaming(false);
            onRename(title);
          }}
        />
      ) : null}
    </>
  );
});

function RenameSheet({ initial, onCancel, onSave }: { initial: string; onCancel(): void; onSave(title: string): void }) {
  const t = useTheme();
  const tr = useT();
  const [draft, setDraft] = useState(initial);
  const ok = !!draft.trim();
  return (
    <SheetModal visible onClose={onCancel} closeLabel={tr('actions.close')} label={tr('menus.chat.renameTitle')} maxWidth={420} style={styles.sheet}>
      <SheetGrabber />
      <Text style={[t.typography.headline, styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('menus.chat.renameTitle')}
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoFocus
        selectTextOnFocus
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => ok && onSave(draft.trim())}
        style={[t.typography.body, styles.input, { color: t.colors.text, borderColor: t.colors.borderControl, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, fontFamily: t.fonts.sans }]}
        accessibilityLabel={tr('menus.chat.renameField')}
      />
      <View style={styles.buttons}>
        <Button label={tr('actions.cancel')} variant="tertiary" onPress={onCancel} />
        <Button label={tr('actions.save')} variant="primary" onPress={() => ok && onSave(draft.trim())} disabled={!ok} />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 18 },
  title: { marginBottom: 12 },
  input: { height: 44, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 14 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
