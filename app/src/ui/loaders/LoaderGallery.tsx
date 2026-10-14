// Dev Gallery → "Loader": every indicator of the library + the WaitingIndicator in all states / modes.
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { HText } from '../primitives/basics';
import { RouteSkeleton } from '../skeletons';
import { useTheme } from '../theme';
import { Loader } from './Loader';
import { WaitingIndicator } from './WaitingIndicator';
import { LOADER_KINDS, TOOL_CATEGORIES, type WaitState } from './waiting';

export function LoaderGallery() {
  const tr = useT();
  const t = useTheme();
  const [now] = useState(() => Date.now());
  const first: WaitState = { kind: 'first' };
  return (
    <View style={{ gap: t.spacing.xl }}>
      <Block title={tr('waiting.gallery.indicators')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
          {LOADER_KINDS.map((k) => (
            <View
              key={k}
              testID={`loader-${k}`}
              style={{ width: 96, height: 88, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: t.radii.m, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border }}
            >
              <Loader kind={k} size={36} />
              <HText variant="caption" color="muted" numberOfLines={1}>
                {tr(`waiting.loaders.${k}` as TKey)}
              </HText>
            </View>
          ))}
        </View>
      </Block>

      <Block title={tr('waiting.gallery.states')}>
        <Row label={tr('waiting.gallery.first')}>
          <WaitingIndicator state={first} mode="playful" seed={1} />
        </Row>
        <Row label={tr('waiting.gallery.persona')}>
          <WaitingIndicator state={first} mode="playful" seed={2} persona="chameleon" />
        </Row>
        {TOOL_CATEGORIES.map((c) => (
          <Row key={c} label={`tool · ${c}`}>
            <WaitingIndicator state={{ kind: 'tool', category: c }} mode="playful" seed={3} />
          </Row>
        ))}
        <Row label={tr('waiting.gallery.slow')}>
          <WaitingIndicator state={first} mode="playful" seed={4} startedAt={now - 12_000} />
        </Row>
        <Row label={tr('waiting.gallery.still')}>
          <WaitingIndicator state={first} mode="playful" seed={5} persona="chameleon" startedAt={now - 35_000} />
        </Row>
      </Block>

      <Block title={tr('waiting.gallery.route')}>
        {(['chart', 'table', 'map', 'recipe'] as const).map((f) => (
          <View key={f} style={{ gap: 4 }}>
            <HText variant="micro" color="muted">{`route · ${f}`}</HText>
            <View>
              <RouteSkeleton format={f} />
              <WaitingIndicator variant="badge" state={{ kind: 'route', shape: f }} mode="playful" seed={6} />
            </View>
          </View>
        ))}
      </Block>

      <Block title={tr('waiting.gallery.modes')}>
        <Row label={tr('waiting.settings.playful')}>
          <WaitingIndicator state={first} mode="playful" seed={7} />
        </Row>
        <Row label={tr('waiting.settings.subtle')}>
          <WaitingIndicator state={{ kind: 'tool', category: 'search' }} mode="subtle" />
        </Row>
        <Row label={tr('waiting.settings.off')}>
          <WaitingIndicator state={first} mode="off" />
        </Row>
      </Block>
    </View>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.m }}>
      <HText variant="title">{title}</HText>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2, paddingVertical: 4, borderBottomWidth: 1, borderColor: t.colors.border }}>
      <HText variant="micro" color="muted">
        {label}
      </HText>
      {children}
    </View>
  );
}
