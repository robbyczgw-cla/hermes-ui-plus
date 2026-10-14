/**
 * Per-answer scope of the v4 answer polish (docs/SPEC-modules-v4.md A3/A4):
 *  - footnote targets of the whole answer (sources node – incl. a closing `[n]` list turned into one by
 *    citations.ts – / definitions / trailing link list), computed once
 *    the answer is complete (pills stay inert while streaming – no O(text) work per token)
 *  - ONE sheet host per answer for footnote previews and entity action sheets (chips inside Text only
 *    call `open(...)`; the Modal lives outside the text runs)
 * Every external action goes through the confirmed action runner (`actions/`).
 */
import * as Clipboard from 'expo-clipboard';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOptionalActionRunner } from '../../actions';
import { useT } from '../../i18n';
import type { Segment } from '../../protocol/types';
import { SheetGrabber, SheetModal, haptic, useTheme } from '../../ui';
import { Favicon } from '../../ui/components/modules/Sources';
import { domainOf } from '../../ui/components/modules/a/misc.ts';
import { useToast } from '../Toast';
import { AnswerIcon, type AnswerIconName } from './answerIcons';
import { entityCopyText, type HuiEntity } from './entities';
import { footnoteTarget, footnoteTargets, type FootnoteTarget } from './footnotes';

export type AnswerSheet = { kind: 'footnote'; n: number } | { kind: 'entity'; entity: HuiEntity };

type ScopeValue = {
  /** null while the answer streams (pills inert) */
  targets: readonly FootnoteTarget[] | null;
  /** B3: highest numeric `[n]` citation (closing sources list, citations.ts); 0 = none */
  cites: number;
  open(sheet: AnswerSheet): void;
};

const ScopeCtx = createContext<ScopeValue | null>(null);

export function useAnswerScope(): ScopeValue | null {
  return useContext(ScopeCtx);
}

export function AnswerScope({
  segments,
  streaming,
  cites = 0,
  children,
}: {
  segments: readonly Segment[];
  streaming: boolean;
  cites?: number;
  children: ReactNode;
}) {
  const [sheet, setSheet] = useState<AnswerSheet | null>(null);
  const targets = useMemo(() => (streaming ? null : footnoteTargets(segments)), [streaming, segments]);
  const open = useCallback((s: AnswerSheet) => setSheet(s), []);
  const value = useMemo(() => ({ targets, open, cites }), [targets, open, cites]);
  return (
    <ScopeCtx.Provider value={value}>
      {children}
      {sheet ? <AnswerSheetHost sheet={sheet} targets={targets ?? []} onClose={() => setSheet(null)} /> : null}
    </ScopeCtx.Provider>
  );
}

/** Fallback for chips outside an answer scope (gallery, other Markdown users): local sheet state. */
export function useSheetOpener(): { open(sheet: AnswerSheet): void; host: ReactNode; targets: readonly FootnoteTarget[] | null } {
  const scope = useAnswerScope();
  const [local, setLocal] = useState<AnswerSheet | null>(null);
  if (scope) return { open: scope.open, host: null, targets: scope.targets };
  return { open: setLocal, host: local ? <AnswerSheetHost sheet={local} targets={[]} onClose={() => setLocal(null)} /> : null, targets: [] };
}

// ---------------------------------------------------------------- sheets

function AnswerSheetHost({ sheet, targets, onClose }: { sheet: AnswerSheet; targets: readonly FootnoteTarget[]; onClose(): void }) {
  return sheet.kind === 'footnote' ? (
    <FootnoteSheet n={sheet.n} target={footnoteTarget(targets, sheet.n)} onClose={onClose} />
  ) : (
    <EntitySheet entity={sheet.entity} onClose={onClose} />
  );
}

function SheetFrame({ title, icon, onClose, children }: { title: string; icon?: ReactNode; onClose(): void; children: ReactNode }) {
  const t = useTheme();
  const tr = useT();
  return (
    <SheetModal visible onClose={onClose} closeLabel={tr('chat.answers.close')} label={title} style={styles.sheet}>
      <SheetGrabber style={styles.grabber} />
      <View style={styles.head}>
        {icon}
        <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header" numberOfLines={3}>
          {title}
        </Text>
      </View>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 4 }}>
        {children}
      </ScrollView>
    </SheetModal>
  );
}

function SheetButton({ icon, label, onPress, primary }: { icon: AnswerIconName; label: string; onPress(): void; primary?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        primary ? { backgroundColor: t.colors.accent } : { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
        primary && pressed && { opacity: 0.85 },
      ]}
    >
      <AnswerIcon name={icon} size={18} color={primary ? t.colors.onAccent : t.colors.text} />
      <Text style={[styles.btnText, { color: primary ? t.colors.onAccent : t.colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const ENTITY_ICON: Record<HuiEntity['kind'], AnswerIconName> = { place: 'pin', date: 'calendar', tel: 'phone', email: 'mail', price: 'tag' };

export function entityIcon(kind: HuiEntity['kind']): AnswerIconName {
  return ENTITY_ICON[kind];
}

function EntitySheet({ entity: e, onClose }: { entity: HuiEntity; onClose(): void }) {
  const t = useTheme();
  const tr = useT();
  const run = useOptionalActionRunner();
  const toast = useToast();
  const act = (action: Record<string, unknown>) => {
    onClose();
    // the runner validates and shows the confirmation sheet (maps/calendar/call/sms/email)
    if (run) void run(action);
  };
  const copy = () => {
    onClose();
    Clipboard.setStringAsync(entityCopyText(e)).catch(() => {});
    toast(tr('chat.answers.copied'));
  };
  const copyBtn = <SheetButton key="copy" icon="copy" label={tr('chat.answers.act.copy')} onPress={copy} />;
  let buttons: ReactNode[];
  switch (e.kind) {
    case 'place': {
      const where = e.lat !== undefined ? { query: e.q || undefined, lat: e.lat, lng: e.lng } : { query: e.q };
      buttons = [
        <SheetButton key="maps" primary icon="pin" label={tr('chat.answers.act.openMaps')} onPress={() => act({ type: 'maps', ...where })} />,
        <SheetButton key="route" icon="route" label={tr('chat.answers.act.route')} onPress={() => act({ type: 'maps', ...where, mode: 'driving' })} />,
        copyBtn,
      ];
      break;
    }
    case 'date':
      buttons = [
        <SheetButton
          key="cal"
          primary
          icon="calendar"
          label={tr('chat.answers.act.calendar')}
          onPress={() => act({ type: 'calendar', title: e.title || tr('chat.answers.kind.date'), start: e.start, ...(e.end ? { end: e.end } : {}), allDay: e.allDay })}
        />,
        copyBtn,
      ];
      break;
    case 'tel':
      buttons = [
        <SheetButton key="call" primary icon="phone" label={tr('chat.answers.act.call')} onPress={() => act({ type: 'call', phone: e.n })} />,
        <SheetButton key="sms" icon="message" label={tr('chat.answers.act.sms')} onPress={() => act({ type: 'sms', to: [e.n] })} />,
        copyBtn,
      ];
      break;
    case 'email':
      buttons = [<SheetButton key="mail" primary icon="mail" label={tr('chat.answers.act.mail')} onPress={() => act({ type: 'email', to: [e.to] })} />, copyBtn];
      break;
    case 'price':
      buttons = [
        copyBtn,
        ...(e.q
          ? [
              <SheetButton
                key="search"
                icon="search"
                label={tr('chat.answers.act.searchProduct')}
                onPress={() => act({ type: 'open_url', url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(e.q ?? '')}` })}
              />,
            ]
          : []),
      ];
      break;
  }
  const sub = e.kind === 'price' && e.q ? e.q : e.kind === 'date' && e.title ? e.title : e.kind === 'place' && e.q && e.q !== e.label ? e.q : null;
  return (
    <SheetFrame
      title={e.label}
      onClose={onClose}
      icon={
        <View style={[styles.badge, { backgroundColor: t.colors.accentSoft }]}>
          <AnswerIcon name={ENTITY_ICON[e.kind]} size={18} color={t.colors.accent} />
        </View>
      }
    >
      <Text style={[styles.kind, { color: t.colors.muted }]}>{sub ? `${tr(`chat.answers.kind.${e.kind}`)} · ${sub}` : tr(`chat.answers.kind.${e.kind}`)}</Text>
      <View style={styles.btnCol}>{buttons}</View>
    </SheetFrame>
  );
}

function FootnoteSheet({ n, target, onClose }: { n: number; target: FootnoteTarget | undefined; onClose(): void }) {
  const t = useTheme();
  const tr = useT();
  const run = useOptionalActionRunner();
  const url = target?.url;
  const domain = url ? domainOf(url) : '';
  return (
    <SheetFrame
      title={target?.title || tr('chat.answers.footnoteTitle', { n })}
      onClose={onClose}
      icon={
        <View style={styles.favWrap}>
          <Favicon t={t} url={url ?? ''} domain={domain || target?.title || String(n)} />
        </View>
      }
    >
      <Text style={[styles.kind, { color: t.colors.muted }]}>
        {[tr('chat.answers.footnoteTitle', { n }), target?.siteName, domain].filter(Boolean).join(' · ')}
      </Text>
      {target?.snippet ? (
        <Text style={[styles.snippet, { color: t.colors.text }]} selectable>
          {target.snippet}
        </Text>
      ) : null}
      {!target ? <Text style={[styles.snippet, { color: t.colors.muted }]}>{tr('chat.answers.footnoteMissing')}</Text> : null}
      {url ? (
        <View style={styles.btnCol}>
          <SheetButton
            primary
            icon="external"
            label={tr('chat.answers.open')}
            onPress={() => {
              onClose();
              if (run) void run({ type: 'open_url', url });
            }}
          />
        </View>
      ) : null}
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  grabber: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  favWrap: { width: 34, alignItems: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 22 },
  kind: { fontSize: 13, lineHeight: 18 },
  snippet: { fontSize: 15, lineHeight: 21, marginTop: 6 },
  btnCol: { gap: 8, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 12, paddingHorizontal: 14 },
  btnText: { fontSize: 15.5, fontWeight: '600', flexShrink: 1 },
});
