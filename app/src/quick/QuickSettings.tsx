/**
 * Settings → Schnellfrage (only when the active connection offers quick answers): which model answers (Hermes'
 * catalog, default "Hermes-Standard" = the slot model the server picks), the limits in plain words, the ⚡ switch in
 * the composer, and deleting the local thread. The model chooser is the chat's searchable model list.
 */
import { useMemo, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { ModelSheet } from '../chat/ModelPicker';
import { ModelSearchList } from '../chat/ModelSearchList';
import type { ModelBadge, ModelEntry } from '../chat/modelSearch';
import { useModelPrefs } from '../chat/useModelPrefs';
import { useToast } from '../chat/Toast';
import { providerModelId, splitProviderModel, usableProviders, type ModelOptionsCatalog } from '../hermes/capabilities';
import { useHermesCapabilities } from '../hermes/useHermesCapabilities';
import { useLocale, useT } from '../i18n';
import { deleteConversationState } from '../nodestate';
import type { ConnectionProfile } from '../settings/profiles';
import { Footnote, Group, NavRow, SwitchRow } from '../settings/ui';
import { quickConversationId, shortModel, type QuickConfig } from './core';
import { DEMO_MODEL_CATALOG } from './demo';
import { clearThread, setQuickModel, setShowInComposer, useQuickSettings } from './store';

export function QuickSettingsSection({ profile, config }: { profile: ConnectionProfile; config: QuickConfig | null }) {
  const tr = useT();
  const toast = useToast();
  const { formatNumber } = useLocale();
  const settings = useQuickSettings();
  const [picking, setPicking] = useState(false);
  const demo = profile.kind === 'demo';
  const canPick = demo || !!config?.allowModelOverride;
  const picked = canPick ? settings.models[profile.id] : undefined;
  const serverModel = shortModel(config?.model ?? undefined);
  // value = the model that answers; the subtitle says whether that is the server's choice
  const modelValue = picked ? picked.model : (serverModel ?? tr('quick.settings.modelDefault'));
  const modelSub = !canPick ? tr('quick.settings.modelFixed') : !picked && serverModel ? tr('quick.settings.modelDefault') : undefined;
  const limits =
    config?.perMinute && config?.perDay
      ? tr('quick.settings.limits', { minute: formatNumber(config.perMinute), day: formatNumber(config.perDay) })
      : tr('quick.settings.limitsUnknown');

  return (
    <>
      <Group>
        <NavRow
          title={tr('quick.settings.model')}
          value={modelValue}
          subtitle={modelSub}
          onPress={canPick ? () => setPicking(true) : undefined}
        />
        <SwitchRow title={tr('quick.settings.show')} subtitle={tr('quick.settings.showSub')} value={settings.showInComposer} onChange={setShowInComposer} />
        <NavRow
          title={tr('quick.settings.clear')}
          tone="danger"
          chevron={false}
          onPress={() => {
            clearThread(profile.id);
            void deleteConversationState(quickConversationId(profile.id));
            toast(tr('quick.thread.cleared'));
          }}
          last
        />
      </Group>
      <Footnote>{limits}</Footnote>
      <Footnote>{demo ? `${tr('quick.settings.about')} ${tr('quick.settings.demo')}` : tr('quick.settings.about')}</Footnote>
      {picking ? <QuickModelSheet profile={profile} config={config} onClose={() => setPicking(false)} /> : null}
    </>
  );
}

function QuickModelSheet({ profile, config, onClose }: { profile: ConnectionProfile; config: QuickConfig | null; onClose(): void }) {
  const tr = useT();
  const win = useWindowDimensions();
  const settings = useQuickSettings();
  const demo = profile.kind === 'demo';
  const conn = useMemo(() => (demo ? undefined : { baseUrl: profile.baseUrl, apiKey: profile.apiKey }), [demo, profile.baseUrl, profile.apiKey]);
  const caps = useHermesCapabilities(conn);
  const catalog: ModelOptionsCatalog | null = demo ? DEMO_MODEL_CATALOG : caps.catalog;
  const prefs = useModelPrefs(`quick:${profile.id}`);
  const picked = settings.models[profile.id];
  const selected = picked ? providerModelId(picked.provider, picked.model) : undefined;
  const entries = useMemo<ModelEntry[]>(() => {
    const out: ModelEntry[] = [
      { id: undefined, label: tr('quick.settings.modelDefault'), detail: shortModel(config?.model ?? undefined) ?? tr('quick.settings.modelDefaultDetail'), pinned: true },
    ];
    for (const p of usableProviders(catalog)) {
      for (const m of p.models) {
        const badges: ModelBadge[] = p.caps[m]?.fast ? ['fast'] : [];
        out.push({ id: providerModelId(p.slug, m), label: m, group: p.name, badges });
      }
    }
    return out;
  }, [catalog, config?.model, tr]);
  const pick = (id: string | undefined) => {
    prefs.recordUse(id);
    if (!id) setQuickModel(profile.id, undefined);
    else {
      const s = splitProviderModel(id);
      if (s.provider) setQuickModel(profile.id, { provider: s.provider, model: s.model });
    }
    onClose();
  };
  const listHeight = Math.max(220, Math.min(win.height * 0.62 - 120, 560));
  return (
    <ModelSheet open onClose={onClose} title={tr('quick.settings.pickTitle')} subtitle={profile.name} loading={!demo && caps.loading} onRefresh={demo ? undefined : caps.refresh}>
      <ModelSearchList
        entries={entries}
        selected={selected}
        onPick={pick}
        prefs={prefs.prefs}
        onToggleFavorite={prefs.toggleFavorite}
        loading={!demo && caps.loading}
        height={listHeight}
        onEscape={onClose}
        autoFocus={Platform.OS === 'web'}
      />
    </ModelSheet>
  );
}
