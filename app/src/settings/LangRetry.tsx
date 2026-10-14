// Shown under the language picker when the selected language's dictionary could not be loaded (offline first use of
// en/es): explains what happens and retries the load (i18n/langController.ts).
import { useI18n } from '../i18n';
import { Button, Footnote } from './ui';

export function LangRetry() {
  const { t, langFailed, retryLanguage } = useI18n();
  if (!langFailed) return null;
  return (
    <>
      <Footnote tone="warning">{t('settings.appearance.languageFailed')}</Footnote>
      <Button label={t('settings.appearance.languageRetry')} onPress={retryLanguage} kind="secondary" />
    </>
  );
}
