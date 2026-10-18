/**
 * Web result card: what one web search / extract call did (model: webCard.ts). Shown inside the tool detail sheet
 * (verbose tool details, ToolTimeline.tsx) and as its own sheet from a web chip (compact tool details, ToolChips.tsx).
 *
 *   ┌ 🔍  python 3.14 free threading ────────────┐   the query as it was searched
 *   Provider    Brave · chosen automatically · …       only facts the tool output really carried
 *   Cache       from the cache, 42 s old
 *   6 results · 2 cited in the answer
 *   [favicon] Title                         [2]        cited rows carry the answer's source number
 *             docs.example.org · 14 Oct 2026
 *             snippet …
 *
 * Titles and snippets are untrusted web text: plain Text only, links http(s) only (the parser dropped the rest),
 * WSP's security notice never shows. Favicons follow the image privacy settings (images/favicon.ts).
 */
import { memo, useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ChatMessage, ToolEvent } from '../hermes';
import { useI18n } from '../i18n';
import { SheetGrabber, SheetModal, useTheme } from '../ui';
import { Favicon } from '../ui/components/modules/Sources';
import { Text } from '../ui/primitives/Text';
import { Icon } from './icons';
import { formatNumber } from '../i18n/core';
import { buildWebCard, type WebCard, type WebCardFact, type WebCardHit } from './webCard';

const TITLE_KEY = { search: 'hermesTools.webCard.search', research: 'hermesTools.webCard.research', extract: 'hermesTools.webCard.extract' } as const;

export function useWebCard(message: Pick<ChatMessage, 'text'>, tool: ToolEvent | undefined): WebCard | null {
  const { t, locale } = useI18n();
  return useMemo(() => (tool ? buildWebCard(message, tool, t, locale) : null), [message.text, tool, t, locale]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function webCardTitle(card: WebCard, t: ReturnType<typeof useI18n>['t']): string {
  return t(TITLE_KEY[card.mode]);
}

export const WebResultCard = memo(function WebResultCard({ card }: { card: WebCard }) {
  const th = useTheme();
  const { t, locale } = useI18n();
  const extract = card.mode === 'extract';
  const count = card.hits.length;
  // research mode: pages read, results and duration as a summary band instead of fact rows
  const stats: WebCardFact[] =
    card.mode === 'research'
      ? [
          ...card.facts.filter((f) => f.key === 'pages'),
          { key: 'results', label: t('hermesTools.webCard.resultsLabel'), value: formatNumber(locale, card.reported ?? count) },
          ...card.facts.filter((f) => f.key === 'duration'),
        ]
      : [];
  const facts = stats.length ? card.facts.filter((f) => f.key !== 'pages' && f.key !== 'duration') : card.facts;
  return (
    <View style={styles.card}>
      {card.query ? (
        <View
          style={[styles.query, { backgroundColor: th.colors.surfaceAlt, borderColor: th.colors.border, borderRadius: th.radii.pill }]}
          accessible
          accessibilityLabel={`${webCardTitle(card, t)}: ${card.query}`}
        >
          <Icon name={extract ? 'globe' : 'search'} size={16} color={th.colors.muted} />
          <Text style={[th.typography.body, styles.queryText, { color: th.colors.text }]} numberOfLines={3} selectable>
            {card.query}
          </Text>
        </View>
      ) : null}

      {stats.length ? <ResearchStats stats={stats} /> : null}

      {facts.length ? (
        <View style={styles.block}>
          <Text style={[th.typography.caption, styles.blockTitle, { color: th.colors.muted }]} accessibilityRole="header">
            {t(extract ? 'hermesTools.webCard.howRead' : 'hermesTools.webCard.how')}
          </Text>
          <View style={[styles.facts, { borderColor: th.colors.border, borderRadius: th.radii.control }]}>
            {facts.map((f, i) => (
              <View
                key={f.key}
                style={[styles.fact, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.colors.border }]}
                accessible
                accessibilityLabel={`${f.label}: ${f.value}`}
              >
                <Text style={[th.typography.caption, styles.factLabel, { color: th.colors.muted }]}>{f.label}</Text>
                <Text style={[th.typography.callout, styles.factValue, { color: th.colors.text }]}>{f.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {card.error ? (
        <View style={[styles.error, { backgroundColor: th.colors.dangerSoft, borderRadius: th.radii.control }]} accessible accessibilityRole="alert">
          <View style={styles.errorHead}>
            <Icon name="alert" size={15} color={th.colors.danger} />
            <Text style={[th.typography.callout, styles.bold, { color: th.colors.danger, flex: 1 }]}>{t('hermesTools.webCard.error')}</Text>
          </View>
          <Text style={[th.typography.caption, { color: th.colors.text }]}>{card.error}</Text>
          {card.providerErrors?.map((p) => (
            <Text key={p.provider} style={[th.typography.caption, { color: th.colors.muted }]}>
              {`${p.provider}: ${p.reason}`}
            </Text>
          ))}
        </View>
      ) : null}

      {count || !card.error ? (
        <View style={styles.block}>
          <View style={styles.resultsHead}>
            <Text style={[th.typography.caption, styles.blockTitle, { color: th.colors.muted }]} accessibilityRole="header">
              {t(extract ? 'hermesTools.webCard.pages' : 'hermesTools.webCard.results', { count })}
            </Text>
            {card.cited ? (
              <View style={styles.citedLegend}>
                <View style={[styles.legendDot, { backgroundColor: th.colors.accent }]} />
                <Text style={[th.typography.caption, { color: th.colors.muted }]}>{t('hermesTools.webCard.citedSummary', { cited: card.cited })}</Text>
              </View>
            ) : null}
          </View>
          {count ? (
            <View style={[styles.list, { borderColor: th.colors.border, borderRadius: th.radii.control }]}>
              {card.hits.map((h, i) => (
                <HitRow key={`${h.url}-${i}`} hit={h} index={i} first={i === 0} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {count ? <Text style={[th.typography.micro, { color: th.colors.subtle }]}>{t('hermesTools.webCard.untrusted')}</Text> : null}
    </View>
  );
});

function ResearchStats({ stats }: { stats: WebCardFact[] }) {
  const th = useTheme();
  return (
    <View style={[styles.stats, { backgroundColor: th.colors.accentSoft, borderRadius: th.radii.control }]}>
      {stats.map((s) => (
        <View key={s.key} style={styles.stat} accessible accessibilityLabel={`${s.label}: ${s.value}`}>
          <Text style={[th.typography.stat, { color: th.colors.text, fontVariant: ['tabular-nums'] }]}>{s.value}</Text>
          <Text style={[th.typography.caption, { color: th.colors.muted }]} numberOfLines={1}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function HitRow({ hit, index, first }: { hit: WebCardHit; index: number; first: boolean }) {
  const th = useTheme();
  const { t } = useI18n();
  const cited = hit.cited !== undefined;
  const meta = [hit.domain, hit.date].filter(Boolean).join(' · ');
  const citedText = !cited ? '' : hit.cited ? t('hermesTools.webCard.citedA11y', { n: hit.cited }) : t('hermesTools.webCard.linkedA11y');
  return (
    <Pressable
      onPress={() => Linking.openURL(hit.url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={[`${index + 1}. ${hit.title}`, meta, citedText, hit.failed ? `${t('hermesTools.webCard.failed')}: ${hit.failed}` : ''].filter(Boolean).join(', ')}
      accessibilityHint={t('hermesTools.webCard.open', { domain: hit.domain })}
      style={({ pressed }) => [
        styles.hit,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.colors.border },
        pressed && { backgroundColor: th.colors.surfacePressed },
      ]}
    >
      <View style={[styles.citedBar, { backgroundColor: cited ? th.colors.accent : 'transparent' }]} />
      <Favicon t={th} url={hit.url} domain={hit.domain} size={26} />
      <View style={styles.hitBody}>
        <Text style={[th.typography.callout, styles.bold, { color: hit.failed ? th.colors.muted : th.colors.text }]} numberOfLines={2}>
          {hit.title}
        </Text>
        <Text style={[th.typography.caption, { color: th.colors.muted }]} numberOfLines={1}>
          {meta}
        </Text>
        {hit.failed ? (
          <View style={styles.failed}>
            <Icon name="alert" size={12} color={th.colors.danger} />
            <Text style={[th.typography.caption, { color: th.colors.danger, flexShrink: 1 }]} numberOfLines={2}>
              {`${t('hermesTools.webCard.failed')}: ${hit.failed}`}
            </Text>
          </View>
        ) : hit.snippet ? (
          <Text style={[th.typography.caption, styles.snippet, { color: th.colors.subtle }]} numberOfLines={3}>
            {hit.snippet}
          </Text>
        ) : null}
      </View>
      {cited ? (
        <View style={[styles.pill, { backgroundColor: th.colors.accentSoft, borderRadius: th.radii.pill }]}>
          <Text style={[th.typography.micro, styles.pillText, { color: th.colors.accentText }]}>{hit.cited ? String(hit.cited) : t('hermesTools.webCard.cited')}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Own sheet for a web chip (compact tool details). */
export function WebResultSheet({ message, toolId, onClose }: { message: ChatMessage; toolId: string | null; onClose(): void }) {
  const th = useTheme();
  const { t } = useI18n();
  const tool = toolId ? message.tools.find((x) => x.id === toolId) : undefined;
  const card = useWebCard(message, tool);
  const title = card ? webCardTitle(card, t) : '';
  return (
    <SheetModal visible={!!card} onClose={onClose} closeLabel={t('actions.close')} label={title} empty={!card} maxWidth={720} maxHeight="88%" bottomPadding={0} style={styles.sheet}>
      {card ? (
        <>
          <SheetGrabber style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Icon name={card.mode === 'extract' ? 'globe' : 'search'} size={20} color={th.colors.muted} />
            <Text style={[th.typography.headline, styles.sheetTitle, { color: th.colors.text }]} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('actions.close')}
              style={({ pressed }) => [styles.closeBtn, pressed && { backgroundColor: th.colors.surfacePressed }]}
            >
              <Icon name="close" size={18} color={th.colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <WebResultCard card={card} />
          </ScrollView>
        </>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  query: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
  queryText: { flex: 1, fontWeight: '500' },
  block: { gap: 6 },
  blockTitle: { fontWeight: '600' },
  facts: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fact: { flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'flex-start' },
  factLabel: { width: 112, paddingTop: 1 },
  factValue: { flex: 1 },
  bold: { fontWeight: '600' },
  error: { padding: 12, gap: 4 },
  errorHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  citedLegend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  list: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hit: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingRight: 12, paddingVertical: 10 },
  citedBar: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  hitBody: { flex: 1, minWidth: 0, gap: 2 },
  snippet: { marginTop: 2 },
  failed: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  pill: { minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  pillText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 4 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  sheet: { paddingHorizontal: 0 },
  grabber: { marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  sheetTitle: { flex: 1, fontWeight: '600' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16 },
});
