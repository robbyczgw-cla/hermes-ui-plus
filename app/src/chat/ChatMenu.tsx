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
  onExport(): void;
  onPin(): void;
  onRename(title: string): void;
  onArchive(): void;
  onDelete(): void;
};

export const ChatMenu = memo(function ChatMenu({ open, onClose, meta, hasMessages, onFind, onExport, onPin, onRename, onArchive, onDelete }: Props) {
  const tr = useT();
  const [renaming, setRenaming] = useState(false);
  const stored = !!meta && hasMessages;
  const items: MenuItem[] = [
    { key: 'find', icon: 'search', label: tr('menus.chat.find'), onPress: onFind, disabled: !hasMessages },
    { key: 'share', icon: 'share', label: tr('menus.chat.share'), onPress: onExport, disabled: !hasMessages },
    { key: 'pin', icon: 'pin', label: meta?.pinned ? tr('menus.chat.unpin') : tr('menus.chat.pin'), onPress: onPin, disabled: !stored },
    { key: 'rename', icon: 'edit', label: tr('menus.chat.rename'), onPress: () => setRenaming(true), disabled: !stored },
    { key: 'archive', icon: 'archive', label: meta?.archived ? tr('menus.chat.unarchive') : tr('menus.chat.archive'), onPress: onArchive, disabled: !stored },
    { key: 'delete', icon: 'trash', label: tr('menus.chat.delete'), onPress: onDelete, danger: true, disabled: !hasMessages },
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
