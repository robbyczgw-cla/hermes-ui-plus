/**
 * "Öffnen" and "Sichern" under a file in a chat (web app, installed web app, desktop app). What each does on this
 * device: webFile.ts. Every outcome the user did not see happen is said in a toast (failed, not possible here,
 * downloading, saved to Downloads, "tap again").
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '../chat/icons';
import { useI18n } from '../i18n';
import { Button } from '../ui';
import type { WebFileActionsProps } from './fileActionsTypes';
import { PdfViewer } from './PdfViewer';
import { useFileReport } from './useFileReport';
import { openMethod } from './webFile';
import { openWebFile, saveWebFile, type FileOutcome } from './webFileActions';
import { browserFileDeps } from './webFileDom';

export function WebFileActions({ src, fetchBytes, size = 'small' }: WebFileActionsProps) {
  const { t: tr } = useI18n();
  const [busy, setBusy] = useState<'open' | 'save' | null>(null);
  const [saveNow, setSaveNow] = useState(false);
  const [viewer, setViewer] = useState(false);
  // per file: the environment (canShare depends on the type) and the fetch; callers keep `src` / `fetchBytes` stable
  const deps = useMemo(() => browserFileDeps(src, fetchBytes), [src, fetchBytes]);

  const notify = useFileReport();
  const report = (o: FileOutcome, what: 'open' | 'save') => {
    setSaveNow(o.kind === 'needsTap');
    notify(o, what, src.name);
  };

  // both run synchronously up to the share sheet / window.open (the tap's user activation)
  const save = () => {
    if (busy === 'save') return;
    const p = saveWebFile(src, deps);
    setBusy('save');
    void p.then((o) => report(o, 'save')).finally(() => setBusy(null));
  };
  const openSystem = () => {
    const p = openWebFile(src, deps, { system: true });
    setBusy('open');
    void p.then((o) => report(o, 'open')).finally(() => setBusy(null));
  };
  const open = () => {
    if (busy === 'open') return;
    if (openMethod(deps.env, src) === 'viewer') setViewer(true);
    else openSystem();
  };

  return (
    <View style={styles.row}>
      <Button
        label={tr('attachments.web.open')}
        onPress={open}
        size={size}
        loading={busy === 'open'}
        icon={(c, s) => <Icon name="external" size={s} color={c} />}
        accessibilityLabel={tr('attachments.web.openA11y', { name: src.name })}
      />
      <Button
        label={saveNow ? tr('attachments.web.saveNow') : tr('attachments.web.save')}
        onPress={save}
        size={size}
        variant={saveNow ? 'primary' : 'secondary'}
        loading={busy === 'save' && !viewer}
        icon={(c, s) => <Icon name="download" size={s} color={c} />}
        accessibilityLabel={tr('attachments.web.saveA11y', { name: src.name })}
        accessibilityHint={tr('attachments.web.saveHint')}
      />
      {viewer ? (
        <PdfViewer
          src={src}
          deps={deps}
          onClose={() => setViewer(false)}
          onSave={save}
          saveNow={saveNow}
          saving={busy === 'save'}
          onOpenSystem={() => {
            setViewer(false);
            openSystem();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
