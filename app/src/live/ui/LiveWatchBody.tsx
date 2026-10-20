/**
 * The open live watchlist (mockup 06): one row per product (image tile, name, "Sony · 3 Angebote", the price, its
 * change since the card's first version and a sparkline over the card's versions; the wish price line: sage
 * "unter Wunschpreis 249 €" when reached, else blue "Wunschpreis 299 €", the user's). Tap a row: set or clear the
 * wish price, "gekauft", "ausblenden" (hidden products wait in "Ausgeblendet (n)"). Below: where the prices come
 * from and the add field ("+ Produkt" in the card's footer opens it; Hermes fills in the prices next turn).
 * Every edit is an op (pending until the next message).
 */
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../../i18n';
import { HText, PressableScale, textStyle } from '../../ui/primitives/basics';
import { Button } from '../../ui/primitives/Button';
import { TextInput } from '../../ui/primitives/Text';
import { Icon } from '../../chat/icons';
import { haptic } from '../../ui/primitives/haptics';
import { noOutline } from '../../ui/lib/webStyle';
import type { Theme } from '../../ui/theme';
import { Sparkline } from '../../ui/components/Sparkline';
import { ImageSlotGroup } from '../../ui/components/imageSlot';
import { CardImage } from '../../ui/components/modules/d1/parts';
import { D1Icon } from '../../ui/components/modules/d1/icons';
import { formatPrice, numLang, productKind } from '../../ui/components/modules/d1/d1Model.ts';
import { productImageQuery } from '../../images';
import { productImageFit } from '../../images/slot';
import type { LiveCardModel } from '../derive.ts';
import type { LiveItem, LiveOp } from '../model.ts';
import { newUserItemId } from '../pending.ts';
import { parsePriceInput, priceDelta, priceSeries, underTarget } from '../watch.ts';
import { RemovedLine, Tag } from './parts';

const IMG = 64;

export function LiveWatchBody({ model, t, onEdit, adding, onAddDone }: { model: LiveCardModel; t: Theme; onEdit: (op: LiveOp) => void; adding: boolean; onAddDone: () => void }) {
  const tr = useT();
  const state = model.view.state;
  const shown = state.items.filter((it) => !it.hidden);
  const hidden = state.items.filter((it) => it.hidden);
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const interactive = !model.closed;
  return (
    <View style={{ paddingHorizontal: t.spacing.l, gap: t.spacing.s }}>
      <ImageSlotGroup>
        {shown.map((it) => (
          <ProductRow
            key={it.id}
            t={t}
            model={model}
            item={it}
            fresh={model.fresh.has(it.id) && !it.checked}
            mine={model.view.ownAdded.has(it.id)}
            open={open === it.id}
            interactive={interactive}
            onPress={() => setOpen((cur) => (cur === it.id ? null : it.id))}
            onEdit={onEdit}
          />
        ))}
      </ImageSlotGroup>
      {!shown.length ? (
        <HText variant="callout" color="muted" style={{ paddingVertical: t.spacing.s }}>
          {tr('live.card.empty')}
        </HText>
      ) : null}
      {hidden.length ? (
        <View>
          <PressableScale
            haptic="selection"
            scaleTo={0.99}
            onPress={() => setShowHidden((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
          >
            <HText variant="micro" weight="600" color="muted" style={{ flex: 1, letterSpacing: 1.1, textTransform: 'uppercase' }}>
              {tr('live.watch.hidden', { count: hidden.length })}
            </HText>
            <View style={{ transform: [{ rotate: showHidden ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={16} color={t.colors.muted} />
            </View>
          </PressableScale>
          {showHidden
            ? hidden.map((it) => (
                <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 44 }}>
                  <HText variant="body" color="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {it.text}
                  </HText>
                  {interactive ? (
                    <PressableScale haptic="selection" onPress={() => onEdit({ set: it.id, hidden: null })} accessibilityRole="button" accessibilityLabel={tr('live.watch.showA11y', { name: it.text })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <HText variant="callout" weight="600" color="accent">
                        {tr('live.watch.show')}
                      </HText>
                    </PressableScale>
                  ) : null}
                </View>
              ))
            : null}
        </View>
      ) : null}
      {model.removed.length && model.removedIn && interactive ? (
        <View style={{ marginHorizontal: -t.spacing.l }}>
          <RemovedLine t={t} n={model.removedIn} items={model.removed} onRestore={() => model.removed.forEach((it) => onEdit({ add: { ...it } }))} />
        </View>
      ) : null}
      <Provenance t={t} model={model} />
      {adding && interactive ? <AddProduct t={t} onAdd={(text) => onEdit({ add: { id: newUserItemId(), text } })} onDone={onAddDone} /> : null}
    </View>
  );
}

function usePrice(): (n: number, currency?: string) => string {
  const { lang } = useLocale();
  const L = numLang(lang);
  return (n, currency) => formatPrice(n, currency, L);
}

function ProductRow({
  t,
  model,
  item,
  fresh,
  mine,
  open,
  interactive,
  onPress,
  onEdit,
}: {
  t: Theme;
  model: LiveCardModel;
  item: LiveItem;
  fresh: boolean;
  mine: boolean;
  open: boolean;
  interactive: boolean;
  onPress: () => void;
  onEdit: (op: LiveOp) => void;
}) {
  const tr = useT();
  const price = usePrice();
  const series = useMemo(() => priceSeries(model.card, item.id), [model.card, item.id]);
  const hasPrice = typeof item.price === 'number';
  // the change only once there is a history (a first version alone shows no ± 0)
  const delta = series.length >= 2 ? priceDelta(model.card, item.id, item.price) : undefined;
  const deltaColor = delta === undefined || delta === 0 ? t.colors.muted : delta < 0 ? t.colors.success : t.colors.danger;
  const amount = delta === undefined ? '' : price(Math.abs(delta), item.currency);
  const deltaText = delta === undefined ? '' : tr(delta < 0 ? 'live.watch.deltaDown' : delta > 0 ? 'live.watch.deltaUp' : 'live.watch.deltaZero', { amount });
  const deltaA11y = delta === undefined ? '' : tr(delta < 0 ? 'live.watch.deltaA11y.down' : delta > 0 ? 'live.watch.deltaA11y.up' : 'live.watch.deltaA11y.zero', { amount });
  const offers = item.offers?.length ?? 0;
  const meta = [item.brand, offers ? tr('live.watch.offers', { count: offers }) : ''].filter(Boolean).join(' · ');
  const under = underTarget(item);
  const wish = typeof item.target === 'number' ? tr(under ? 'live.watch.under' : 'live.watch.target', { price: price(item.target, item.currency) }) : '';
  const done = !!item.checked;
  const priceText = hasPrice ? price(item.price!, item.currency) : tr('live.watch.noPrice');
  const label = [item.text, meta, priceText, deltaA11y, wish, done ? tr('live.watch.checked') : '', fresh ? tr('live.trip.changedA11y') : mine ? tr('live.card.tagMine') : ''].filter(Boolean).join(', ');
  return (
    <View style={{ borderRadius: t.radii.card, backgroundColor: fresh ? t.colors.accentSoft : t.colors.surfaceAlt, borderWidth: fresh ? 1.5 : 0, borderColor: fresh ? t.colors.accent : 'transparent', overflow: 'hidden' }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        accessibilityHint={interactive ? tr('live.watch.rowHint') : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.m, minHeight: IMG + 2 * t.spacing.m }}
        pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
      >
        <View style={{ width: IMG, height: IMG, borderRadius: t.radii.control, overflow: 'hidden', backgroundColor: t.dark ? t.colors.bg : t.colors.surface, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
          {/* neutral placeholder underneath; the product image (or its category tile) covers it when there is one */}
          <Icon name="image" size={22} color={t.colors.subtle} />
          <View style={StyleSheet.absoluteFill}>
            <CardImage query={item.imageQuery} autoQuery={productImageQuery({ brand: item.brand, name: item.text })} url={item.image} webOnly kind={productKind(item.text, item.brand)} height={IMG} fit={productImageFit('rank')} tile radius={t.radii.control} iconSize={24} inline />
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
            <HText variant="headline" numberOfLines={2} style={[{ flexShrink: 1 }, done ? { color: t.colors.subtle, textDecorationLine: 'line-through' } : null]}>
              {item.text}
            </HText>
            {done ? <Tag label={tr('live.watch.checked')} tone="info" t={t} /> : mine ? <Tag label={tr('live.card.tagMine')} tone="info" t={t} /> : null}
          </View>
          {meta ? (
            <HText variant="callout" color="muted" numberOfLines={2}>
              {meta}
            </HText>
          ) : null}
          {wish ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {under ? <D1Icon name="check" size={14} color={t.colors.success} strokeWidth={2.4} /> : null}
              <HText variant="caption" weight="600" style={{ flexShrink: 1, color: under ? t.colors.success : t.colors.info }} numberOfLines={2}>
                {wish}
              </HText>
            </View>
          ) : null}
        </View>
        <View style={{ width: 92, alignItems: 'flex-end', gap: 2 }}>
          <HText variant={hasPrice ? 'headline' : 'caption'} color={hasPrice ? 'text' : 'muted'} tabular style={hasPrice ? { fontFamily: t.typography.mono.fontFamily } : undefined} numberOfLines={1}>
            {priceText}
          </HText>
          {deltaText ? (
            <HText variant="callout" weight="600" tabular style={{ color: deltaColor, fontFamily: t.typography.mono.fontFamily }} numberOfLines={1}>
              {deltaText}
            </HText>
          ) : null}
          {series.length >= 2 ? (
            <View style={{ width: 84 }}>
              <Sparkline values={series} color={deltaColor} height={22} />
            </View>
          ) : null}
        </View>
      </PressableScale>
      {open && interactive ? <ProductEditor t={t} item={item} onEdit={onEdit} /> : null}
    </View>
  );
}

const inputStyle = (t: Theme) => [textStyle(t, 'callout'), { color: t.colors.text, paddingVertical: 10, ...(Platform.OS === 'web' ? noOutline : {}) } as object];

/** Wish price (set / clear), "gekauft", "ausblenden". */
function ProductEditor({ t, item, onEdit }: { t: Theme; item: LiveItem; onEdit: (op: LiveOp) => void }) {
  const tr = useT();
  const [value, setValue] = useState(item.target !== undefined ? String(item.target).replace('.', ',') : '');
  const [bad, setBad] = useState(false);
  const setTarget = () => {
    const n = parsePriceInput(value);
    if (n === undefined) {
      setBad(true);
      return;
    }
    if (n !== (item.target ?? null)) onEdit({ set: item.id, target: n });
    haptic('light');
  };
  const done = !!item.checked;
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border, padding: t.spacing.m, gap: t.spacing.m }}>
      <View style={{ gap: 4 }}>
        <HText variant="micro" weight="600" color="muted" style={{ letterSpacing: 1.1, textTransform: 'uppercase' }} aria-hidden>
          {tr('live.watch.targetLabel')}
        </HText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <View style={{ flex: 1, minHeight: 44, borderRadius: t.radii.control, borderWidth: 1, borderColor: bad ? t.colors.danger : t.colors.borderControl, backgroundColor: t.dark ? t.colors.bg : t.colors.surface, paddingHorizontal: t.spacing.m, justifyContent: 'center' }}>
            <TextInput
              value={value}
              onChangeText={(v) => {
                setValue(v);
                setBad(false);
              }}
              placeholder={tr('live.watch.targetPlaceholder')}
              placeholderTextColor={t.colors.subtle}
              keyboardType="decimal-pad"
              accessibilityLabel={tr('live.watch.targetLabel')}
              returnKeyType="done"
              onSubmitEditing={setTarget}
              maxLength={12}
              style={[...inputStyle(t), { fontFamily: t.typography.mono.fontFamily }]}
            />
          </View>
          <Button label={tr('live.watch.targetSet')} variant="primary" size="small" onPress={setTarget} disabled={!value.trim()} />
          {item.target !== undefined ? (
            <Button
              label={tr('live.watch.targetClear')}
              variant="tertiary"
              size="small"
              onPress={() => {
                setValue('');
                onEdit({ set: item.id, target: null });
              }}
            />
          ) : null}
        </View>
        {bad ? (
          <HText variant="caption" color="danger" accessibilityRole="alert">
            {tr('live.watch.badPrice')}
          </HText>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Button
          label={tr('live.watch.bought')}
          variant="secondary"
          size="small"
          grow
          icon={done ? 'check' : undefined}
          accessibilityState={{ checked: done }}
          onPress={() => {
            haptic(done ? 'selection' : 'light');
            onEdit(done ? { uncheck: item.id } : { check: item.id });
          }}
        />
        <Button label={tr('live.watch.hide')} variant="secondary" size="small" grow onPress={() => onEdit({ set: item.id, hidden: true })} />
      </View>
    </View>
  );
}

/** "Websuche, abgerufen … · Preise ohne Gewähr. Änderung und Kurve seit v1, aus den 9 Versionen dieser Karte." */
function Provenance({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const source = model.view.state.source?.trim();
  const versions = model.card.versions.length;
  return (
    <HText variant="caption" color="muted" style={{ paddingTop: t.spacing.s }}>
      {source ? `${tr('live.watch.source', { source })} ` : ''}
      {tr('live.watch.basis', { count: versions })}
    </HText>
  );
}

function AddProduct({ t, onAdd, onDone }: { t: Theme; onAdd: (text: string) => void; onDone: () => void }) {
  const tr = useT();
  const [text, setText] = useState('');
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    haptic('light');
    onAdd(v.slice(0, 160));
    setText('');
    onDone();
  };
  return (
    <View style={{ gap: 4, paddingTop: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <View style={{ flex: 1, minHeight: 44, borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.accent, backgroundColor: t.colors.surfaceAlt, paddingHorizontal: t.spacing.m, justifyContent: 'center' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            placeholder={tr('live.watch.addPlaceholder')}
            placeholderTextColor={t.colors.subtle}
            accessibilityLabel={tr('live.watch.addA11y')}
            returnKeyType="done"
            onSubmitEditing={submit}
            maxLength={160}
            style={inputStyle(t)}
          />
        </View>
        <PressableScale haptic="selection" onPress={submit} accessibilityRole="button" accessibilityLabel={tr('live.watch.addA11y')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={18} color={t.colors.onInk} strokeWidth={2.2} />
        </PressableScale>
      </View>
      <HText variant="caption" color="muted">
        {tr('live.watch.addHint')}
      </HText>
    </View>
  );
}
