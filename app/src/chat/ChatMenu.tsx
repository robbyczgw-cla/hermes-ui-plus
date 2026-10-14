/**
 * Chat menu of the open conversation (header ⋯ on phones, title menu on wide windows): Im Chat suchen, Teilen /
 * Exportieren, Anpinnen, Umbenennen, Archivieren, Löschen. "Zum Startbildschirm hinzufügen" is not offered: pinned /
 * dynamic Android shortcuts need ShortcutManager, which no installed Expo module exposes (a native module would be
 * required) – and there is nothing comparable on the web.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ConversationMeta } from '../conversations/types';
import { useT } from '../i18n';
import { SheetGrabber, SheetModal, useTheme } from '../ui';
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

export function ChatMenu({ open, onClose, meta, hasMessages, onFind, onExport, onPin, onRename, onArchive, onDelete }: Props) {
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
          initial={meta.title}
          onCancel={() => setRenaming(false)}
          onSave={(title) => {
            setRenaming(false);
            onRename(title);
          }}
        />
      ) : null}
    </>
  );
}

function RenameSheet({ initial, onCancel, onSave }: { initial: string; onCancel(): void; onSave(title: string): void }) {
  const t = useTheme();
  const tr = useT();
  const [draft, setDraft] = useState(initial);
  const ok = !!draft.trim();
  return (
    <SheetModal visible onClose={onCancel} closeLabel={tr('actions.close')} label={tr('menus.chat.renameTitle')} maxWidth={420} style={styles.sheet}>
      <SheetGrabber />
      <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header">
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
        style={[styles.input, { color: t.colors.text, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m, fontFamily: t.fonts.sans }]}
        accessibilityLabel={tr('menus.chat.renameField')}
      />
      <View style={styles.buttons}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}>
          <Text style={[styles.btnText, { color: t.colors.text }]}>{tr('actions.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={() => ok && onSave(draft.trim())}
          disabled={!ok}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ok }}
          style={({ pressed }) => [styles.btn, { backgroundColor: t.colors.text, opacity: !ok ? 0.45 : pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.btnText, { color: t.colors.bg }]}>{tr('actions.save')}</Text>
        </Pressable>
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 18 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 12 },
  input: { height: 44, paddingHorizontal: 12, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, marginBottom: 14 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
});
