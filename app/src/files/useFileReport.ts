/** Toasts for what "Öffnen" / "Sichern" did when the user cannot see it happen (webFileActions.ts outcomes). */
import { useCallback } from 'react';
import { formatBytes } from '../attachments/mime';
import { useToast } from '../chat/Toast';
import { useI18n } from '../i18n';
import { MAX_IN_MEMORY_BYTES } from './webFile';
import type { FileOutcome } from './webFileActions';

export function useFileReport(): (o: FileOutcome | void, what: 'open' | 'save', name: string) => void {
  const { t: tr, lang } = useI18n();
  const toast = useToast();
  return useCallback(
    (o, what, name) => {
      if (!o) return;
      if (o.kind === 'needsTap') toast(tr('attachments.web.tapAgain', { name }));
      else if (o.kind === 'downloaded') toast(tr('attachments.web.downloaded', { name }));
      else if (o.kind === 'savedTo') toast(tr('attachments.web.savedTo', { name }));
      else if (o.kind === 'failed') {
        const r = o.reason;
        toast(
          r === 'unavailable'
            ? tr('attachments.web.unavailable', { name })
            : r === 'tooLarge'
              ? tr('attachments.web.tooLarge', { name, max: formatBytes(MAX_IN_MEMORY_BYTES, lang) })
              : r === 'notHere'
                ? tr(what === 'save' ? 'attachments.web.saveNotHere' : 'attachments.web.openNotHere', { name })
                : tr(what === 'save' ? 'attachments.web.saveFailed' : 'attachments.web.openFailed', { name }),
        );
      }
    },
    [tr, lang, toast],
  );
}
