// Skills tab: search, sections by category, a detail page with SKILL.md (plugin) or what Hermes' API knows.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { SkeletonLines } from '../ui/primitives/Skeleton';
import { scaledLineLimit } from '../ui/lib/fontScaleLayout';
import { Icon } from '../chat/icons';
import { Markdown } from '../chat/Markdown';
import { useT, type TKey } from '../i18n';
import { describeError } from '../hermes/stream';
import { Footnote, Group, SearchField, SectionTitle } from '../settings/ui';
import { countSkills, groupSkills, searchSkills, type LibraryFeatures, type LibrarySkill, type SkillDoc } from './model';
import type { LibrarySource, SkillList } from './source';
import type { SkillsLoad } from './LibraryScreen';
import { Notice, OffPill } from './parts';

type Ask = (text: string, mode: 'send' | 'fill') => void;

export function SkillsPane({ load, onOpen, onRetry, onAsk }: { load: SkillsLoad; onOpen(name: string): void; onRetry(): void; onAsk: Ask }) {
  const th = useTheme();
  const t = useT();
  const [query, setQuery] = useState('');
  const list = load.kind === 'ready' ? load.list : null;
  const shown = useMemo(() => (list ? searchSkills(list.skills, query) : []), [list, query]);
  const groups = useMemo(() => (query.trim() ? null : groupSkills(shown)), [shown, query]);

  if (load.kind === 'loading') {
    return (
      <View accessible accessibilityLabel={t('library.skills.search')} style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
        <SkeletonLines lines={4} />
      </View>
    );
  }
  if (load.kind === 'failed') {
    const askList = <Button label={t('library.skills.askList')} onPress={() => onAsk(t('library.skills.askListPrompt'), 'send')} variant="secondary" size="small" testID="library-ask-list" />;
    if (load.why === 'hermesBug') {
      return (
        <Notice icon="alert" tone="warning" title={t('library.skills.hermesBugTitle')} body={t('library.skills.hermesBug')}>
          {askList}
        </Notice>
      );
    }
    if (load.why === 'unsupported') {
      return (
        <Notice icon="book" title={t('library.skills.unsupportedTitle')} body={t('library.skills.unsupported')}>
          {load.message ? askList : null}
        </Notice>
      );
    }
    const body = load.why === 'auth' ? t('library.skills.authFailed') : load.why === 'offline' ? t('library.skills.offline') : t('library.loadFailed', { message: load.message });
    return (
      <Notice icon="alert" tone="warning" title={t('library.tabs.skills')} body={body}>
        <Button label={t('library.retry')} onPress={onRetry} variant="secondary" size="small" />
      </Notice>
    );
  }

  const counts = countSkills(load.list.skills);
  return (
    <View style={styles.gap}>
      {counts.total > 6 ? <SearchField value={query} onChange={setQuery} placeholder={t('library.skills.search')} clearLabel={t('library.skills.clearSearch')} /> : null}
      <Text style={[textStyle(th, 'caption'), styles.count, { color: th.colors.muted }]} accessibilityLiveRegion="polite">
        {counts.off ? t('library.skills.countOff', { count: counts.total, off: counts.off }) : t('library.skills.count', { count: counts.total })}
      </Text>
      {counts.total === 0 ? (
        <Notice icon="book" title={t('library.skills.empty')} />
      ) : shown.length === 0 ? (
        <Text style={[textStyle(th, 'callout'), styles.noMatch, { color: th.colors.muted }]}>{t('library.skills.noMatch', { query: query.trim() })}</Text>
      ) : groups ? (
        groups.map((g) => (
          <View key={g.category ?? '\u0000'} style={styles.section}>
            <SectionTitle>{g.category ? prettyCategory(g.category) : t('library.skills.uncategorized')}</SectionTitle>
            <Group>
              {g.skills.map((s, i) => (
                <SkillRow key={s.name} skill={s} onPress={() => onOpen(s.name)} last={i === g.skills.length - 1} />
              ))}
            </Group>
          </View>
        ))
      ) : (
        <Group>
          {shown.map((s, i) => (
            <SkillRow key={s.name} skill={s} showCategory onPress={() => onOpen(s.name)} last={i === shown.length - 1} />
          ))}
        </Group>
      )}
      <View style={styles.footer}>
        {load.list.via === 'api' ? <Footnote>{t('library.skills.apiNote')}</Footnote> : null}
        <Footnote>{t('library.skills.toggleNote')}</Footnote>
      </View>
    </View>
  );
}

/** "software-development" → "Software development" (Hermes categories are folder names). */
export function prettyCategory(c: string): string {
  const s = c.replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : c;
}

function SkillRow({ skill, onPress, last, showCategory }: { skill: LibrarySkill; onPress(): void; last: boolean; showCategory?: boolean }) {
  const th = useTheme();
  const t = useT();
  const off = skill.enabled === false;
  const lines = scaledLineLimit(2, useWindowDimensions().fontScale || 1);
  const sub = [showCategory && skill.category ? prettyCategory(skill.category) : '', skill.source ? t(`library.skills.source.${skill.source}` as TKey) : ''].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(off ? 'library.skills.rowOffA11y' : 'library.skills.rowA11y', { name: skill.name, description: skill.description ?? '' })}
      testID={`skill-${skill.name}`}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.colors.border }, pressed && { backgroundColor: th.colors.surfacePressed }]}
    >
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={[textStyle(th, 'bodyStrong'), styles.shrink, { color: off ? th.colors.muted : th.colors.text, fontFamily: th.fonts.mono }]} numberOfLines={1}>
            {skill.name}
          </Text>
          {off ? <OffPill label={t('library.skills.off')} /> : null}
        </View>
        {skill.description ? (
          <Text style={[textStyle(th, 'caption'), { color: th.colors.muted }]} numberOfLines={lines}>
            {skill.description}
          </Text>
        ) : null}
        {sub ? <Text style={[textStyle(th, 'micro'), styles.sub, { color: th.colors.subtle }]}>{sub}</Text> : null}
      </View>
      <Icon name="chevronRight" size={16} color={th.colors.subtle} />
    </Pressable>
  );
}

type DocLoad = { kind: 'loading' } | { kind: 'ready'; doc: SkillDoc } | { kind: 'none' } | { kind: 'failed'; message: string };

export function SkillDetail({ skill, via, src, features, onAsk }: { skill: LibrarySkill; via: SkillList['via']; src: LibrarySource; features: LibraryFeatures; onAsk: Ask }) {
  const th = useTheme();
  const t = useT();
  const [doc, setDoc] = useState<DocLoad>(via === 'api' ? { kind: 'none' } : { kind: 'loading' });
  useEffect(() => {
    if (via === 'api') return;
    let live = true;
    src.skillDoc(skill.name, features).then(
      (d) => live && setDoc(d ? { kind: 'ready', doc: d } : { kind: 'none' }),
      (e: unknown) => live && setDoc({ kind: 'failed', message: describeError(e, t) }),
    );
    return () => {
      live = false;
    };
  }, [skill.name, via, src, features, t]);

  const off = skill.enabled === false;
  const facts: { k: string; v: string }[] = [];
  if (skill.category) facts.push({ k: t('library.skill.category'), v: prettyCategory(skill.category) });
  if (skill.source) facts.push({ k: t('library.skill.source'), v: t(`library.skills.source.${skill.source}` as TKey) });
  if (skill.enabled !== undefined) facts.push({ k: t('library.skill.state'), v: t(off ? 'library.skill.offState' : 'library.skill.on') });
  if (doc.kind === 'ready') for (const m of doc.doc.meta) facts.push({ k: prettyCategory(m.key), v: m.value });

  return (
    <View style={styles.gap}>
      {skill.description ? <Text style={[textStyle(th, 'body'), styles.lead, { color: th.colors.text }]}>{skill.description}</Text> : null}
      {facts.length ? (
        <Group>
          {facts.map((f, i) => (
            <View key={`${f.k}-${i}`} style={[styles.fact, i < facts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.colors.border }]} accessible accessibilityLabel={`${f.k}: ${f.v}`}>
              <Text style={[textStyle(th, 'callout'), { color: th.colors.muted }]}>{f.k}</Text>
              <Text style={[textStyle(th, 'callout'), styles.factValue, { color: th.colors.text }]} numberOfLines={2}>
                {f.v}
              </Text>
            </View>
          ))}
        </Group>
      ) : null}
      {off ? <Footnote tone="warning">{t('library.skill.offNote')}</Footnote> : null}
      <View style={styles.actions}>
        <Button label={t('library.skill.use')} onPress={() => onAsk(t('library.skill.usePrompt', { name: skill.name }), 'fill')} variant="primary" size="small" disabled={off} testID="skill-use" />
        {doc.kind !== 'ready' ? <Button label={t('library.skill.askDoc')} onPress={() => onAsk(t('library.skill.askDocPrompt', { name: skill.name }), 'send')} variant="secondary" size="small" disabled={off} /> : null}
      </View>
      {doc.kind === 'loading' ? (
        <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
          <SkeletonLines lines={6} />
        </View>
      ) : doc.kind === 'ready' ? (
        <View style={styles.section}>
          <SectionTitle>{t('library.skill.docTitle')}</SectionTitle>
          <View style={[styles.doc, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]} testID="skill-doc">
            <Markdown text={doc.doc.body} />
          </View>
          {doc.doc.truncated ? <Footnote>{t('library.skill.truncated')}</Footnote> : null}
        </View>
      ) : doc.kind === 'failed' ? (
        <Footnote tone="warning">{`${t('library.skill.docFailed')} ${doc.message}`}</Footnote>
      ) : (
        <Footnote>{t('library.skill.noDoc')}</Footnote>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  gap: { gap: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  count: { marginLeft: 14, marginTop: 2 },
  noMatch: { textAlign: 'center', paddingVertical: 24 },
  section: { gap: 2, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 52 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sub: { marginTop: 3, textTransform: 'none' },
  footer: { marginTop: 10, gap: 4 },
  lead: { marginHorizontal: 4, marginTop: 4 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  factValue: { flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 6, marginHorizontal: 4 },
  doc: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 6 },
});
