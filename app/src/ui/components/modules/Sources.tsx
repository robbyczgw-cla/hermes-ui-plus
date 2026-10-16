import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { FadeIn, HText, PressableScale } from '../../primitives/basics';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { asObjects, asOptString, asString } from '../../lib/format';
import type { HuiSources } from '../../types';
import { domainOf, faviconUrl, hashString, isHttpUrl } from './a/misc.ts';
import { useS } from './useS';
import { SourcesSkeleton } from '../../skeletons';
import { useImageGate } from '../../../images';
import { useAnswerUiPrefs } from '../../lib/answerPrefs';

const COLLAPSED = 3;

/**
 * `sources` – compact source cards: favicon (from the site itself only for trusted hosts or "Immer laden", else a letter avatar), title,
 * domain / site name, snippet. Tap opens the URL (http/https only). Snippets are shown as plain
 * text, never as instructions or markup.
 */
export function Sources({ node }: { node: Partial<HuiSources> }) {
  const S = useS();
  const t = useTheme();
  const { streaming, onAction } = useHui();
  // up to 30: a cited research answer's closing list (chat/answers/citations.ts) must keep every number
  const items = asObjects(node.items).slice(0, 30);
  const [expanded, setExpanded] = useState(false);
  if (!items.length) {
    return streaming ? <SourcesSkeleton /> : null;
  }
  const visible = expanded ? items : items.slice(0, COLLAPSED);
  const hidden = items.length - visible.length;
  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="external" size={13} color={t.colors.muted} />
        <HText variant="caption" weight="600" color="muted" accessibilityRole="header">
          {S.sources.title(items.length)}
        </HText>
      </View>
      <View style={{ gap: 6 }}>
        {visible.map((it, i) => (
          <FadeIn key={i} delay={streaming ? 0 : Math.min(i, 5) * 40}>
            <SourceRow t={t} index={i} item={it} onOpen={(url) => onAction({ type: 'open_url', url })} />
          </FadeIn>
        ))}
        {streaming ? <Skeleton height={56} radius={t.radii.control} /> : null}
      </View>
      {hidden > 0 || (expanded && items.length > COLLAPSED) ? (
        <Button
          label={expanded ? S.sources.showLess : S.sources.showAll(items.length)}
          variant="tertiary"
          size="small"
          onPress={() => setExpanded((e) => !e)}
          accessibilityState={{ expanded }}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </View>
  );
}

function SourceRow({ t, index, item, onOpen }: { t: Theme; index: number; item: Record<string, unknown>; onOpen: (url: string) => void }) {
  const S = useS();
  const url = asString(item.url).trim();
  const valid = isHttpUrl(url);
  const domain = valid ? domainOf(url) : '';
  const title = asString(item.title) || domain || url;
  const site = asOptString(item.siteName);
  const snippet = asOptString(item.snippet);
  const meta = [site, domain && domain !== site?.toLowerCase() ? domain : undefined].filter(Boolean).join(' · ') || S.sources.invalidUrl;
  // cited by the model, but no web tool of this turn retrieved it (chat/answers/webSources.ts) – a subtle hint only
  const unverified = item.unverified === true;
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.99}
      disabled={!valid}
      onPress={() => onOpen(url)}
      accessibilityRole="link"
      accessibilityLabel={`${index + 1}. ${title}, ${meta}${unverified ? `, ${S.sources.notRetrieved}` : ''}`}
      accessibilityHint={valid ? S.sources.open(domain) : undefined}
      style={{ flexDirection: 'row', gap: t.spacing.m, padding: t.spacing.m, borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <Favicon t={t} url={valid ? url : ''} domain={domain || title} />
      <View style={{ flex: 1, gap: 2 }}>
        <HText variant="callout" weight="600" numberOfLines={2}>
          {title}
        </HText>
        <HText variant="caption" color="muted" numberOfLines={1}>
          {meta}
          {unverified ? <HText variant="caption" color="subtle" style={{ fontStyle: 'italic' }}>{` · ${S.sources.notRetrieved}`}</HText> : null}
        </HText>
        {snippet ? (
          <HText variant="caption" color="subtle" numberOfLines={2} style={{ marginTop: 2 }}>
            {snippet}
          </HText>
        ) : null}
      </View>
      <SourceNumber n={index + 1} />
    </PressableScale>
  );
}

/**
 * The item's number. With footnotes on (Settings → Antworten) it is styled like the `[^n]` pills in the
 * answer text, so "1" in the text visibly matches source 1 here.
 */
function SourceNumber({ n }: { n: number }) {
  const t = useTheme();
  const { footnotes } = useAnswerUiPrefs();
  if (!footnotes) {
    return (
      <HText variant="micro" color="subtle" tabular style={{ paddingTop: 2 }}>
        {n}
      </HText>
    );
  }
  return (
    <View style={{ minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
      <HText variant="micro" weight="700" tabular style={{ color: t.colors.accentText }}>
        {n}
      </HText>
    </View>
  );
}

/** Favicon of a source (trust policy: site icon only for trusted hosts / "Immer laden", else a letter avatar). */
export function Favicon({ t, url, domain }: { t: Theme; url: string; domain: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const icon = url ? faviconUrl(url) : undefined;
  // H1: a favicon request tells the (model-chosen) host that this chat cited it → only trusted hosts or "Immer laden";
  // everything else keeps the letter avatar (no tap prompt for a 18 px icon)
  const gate = useImageGate(icon);
  const src = gate.allowed ? icon : undefined;
  const color = t.colors.chart[parseInt(hashString(domain), 36) % t.colors.chart.length];
  return (
    <View style={{ width: 28, height: 28, borderRadius: t.radii.inline, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {!loaded ? (
        <HText variant="caption" weight="700" style={{ color }}>
          {(domain[0] ?? '?').toUpperCase()}
        </HText>
      ) : null}
      {src && !failed ? (
        <Image
          source={{ uri: src }}
          style={{ position: 'absolute', width: 18, height: 18 }}
          contentFit="contain"
          cachePolicy="disk"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          accessible={false}
        />
      ) : null}
    </View>
  );
}
