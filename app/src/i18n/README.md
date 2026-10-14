# i18n

German + English. Language setting `system | de | en` is stored in AsyncStorage key `hui.lang`; `system` resolves via
`expo-localization` (`useLocales`) to the first device locale that is de/en, otherwise `en`. Outside `<I18nProvider>`
everything falls back to German, so unextracted code keeps working.

## API (`import { ... } from '@/i18n'` or relative `../i18n`)
- `<I18nProvider>` wrap once in the root layout (inside it nothing else is required).
- `const t = useT(); t('actions.send'); t('errors.unknown', { message })` - keys are typed (`TKey`, dotted paths of `de.ts`).
- `useLocale()` -> `{ locale (BCP47), lang, formatNumber, formatDate, formatRelative }` (Intl, active locale).
- `useI18n()` -> all of the above plus `setting` / `setSetting('system'|'de'|'en')` for the settings screen
  (labels: `language.label|system|de|en`).
- Non-React code (`core.ts`): `makeT(lang, locale)`, `interpolate`, `resolveLocale`, `formatNumber/Date/Relative(locale, ...)`.

## Plural convention
ICU-lite inline in the value, one key per message (no `_one/_other` keys):
`'{count, plural, =0 {Keine Nachrichten} one {# Nachricht} other {# Nachrichten}}'`.
`#` = count formatted with the locale; `=N` exact matches win, then Intl.PluralRules category (`one`, `other`, ...), then `other`.
`{name}` variables also work inside branches. Unknown variables stay as `{name}`.

## Adding strings
1. Add the key to `de.ts` (source of truth), then to `en.ts` - `en` is `satisfies typeof de`, a missing/extra key fails `tsc`.
2. Nested by feature: `chat.*`, `settings.*`, `voice.*`, ... Reuse `actions.*`, `errors.*`, `time.*` for shared text.
3. Module-level constants holding text must become functions of `t` (or store keys, translate at render).
4. Run `node src/i18n/find-hardcoded.mjs [dir] [--all]` (`--all` also scans `.ts`) to list candidates (`file:line  kind  text`).
   It is heuristic: expect false positives (e.g. `Promise` in JSX text) and misses.

## Extraction plan (docs/I18N-INVENTORY.md did not exist when this was written; counts come from find-hardcoded.mjs, 244 candidates)
Rule: each owner edits only their folder's TSX **and** appends keys under their own top-level namespace in `de.ts`/`en.ts`
(one namespace per owner = conflict-free merges; shared `actions/errors/time` are frozen to i18n-core, request additions).
Re-diff against the inventory once it lands and adjust.

| Order | Folders | Namespace | Candidates |
|---|---|---|---|
| 0 | root layout: mount `I18nProvider` | - | - |
| 1 | `settings/` (+ language picker) | `settings` | 41 |
| 2 | `chat/` | `chat` | ~50 (EmptyState 16, MessageItem 11, ToolTimeline, ModelPicker, Composer, ChatHeader/View/ErrorScreen) |
| 3 | `voice/` | `voice` | ~37 |
| 4 | `conversations/` | `conversations` | 16 |
| 5 | `actions/`, `approvals/`, `attachments/`, `sandbox/` | same names | 14 + 9 + 8 + 5 |
| 6 | `ui/` (components, skeletons, Gallery) | `ui` | ~26 |
| 7 | non-TSX user-facing text (errors thrown in `hermes/`, `protocol/`) via `--all` | `errors.*` | TBD |

Also in the same pass: replace hardcoded `toLocaleString('de-DE')`/date formatting with `useLocale()` helpers, and
decide whether model-facing system prompts (bridge bootstrap, tool descriptions) stay German (recommended: leave untouched, not UI).
