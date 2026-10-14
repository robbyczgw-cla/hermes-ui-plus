import { useT } from '../../../i18n';
import { stringsFor, type ModuleStrings } from './a/text.ts';

/**
 * Active-language module copy (same shape the components used before: `S.choice.submit` …).
 * Built once per translate function (= per active language), shared by every instance.
 */
export function useS(): ModuleStrings {
  return stringsFor(useT());
}
