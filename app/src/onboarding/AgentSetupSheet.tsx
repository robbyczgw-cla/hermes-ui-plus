// "Let your agent set it up": a sheet on the first-run connect screen (classic ChooseConnection and guided
// SetupChoiceScreen, so also Settings → Connections → "Add connection"). Two lines of explanation, the canonical setup
// prompt (docs/SETUP-WITH-AGENT.md → agentSetupPrompt.generated.ts, English in every UI language), Copy / Share
// (agentSetupShare.ts) and the way on to the paste-link flow once the agent sent the pairing link.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { HText, Icon, SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
import { AGENT_SETUP_PROMPT } from './agentSetupPrompt.generated';
import { copySetupPrompt, shareSetupPrompt } from './agentSetupShare';
import { Button, OnbIcon } from './ui';

type Status = 'copied' | 'copiedInstead' | 'failed' | null;

/** web: the prompt is English inside a possibly German / Spanish page (screen readers switch the voice) */
const LANG_EN = (Platform.OS === 'web' ? { lang: 'en' } : {}) as object;

export function AgentSetupSheet({ visible, onClose, onPasteLink }: { visible: boolean; onClose: () => void; onPasteLink: () => void }) {
  const t = useTheme();
  const tr = useT();
  const [status, setStatus] = useState<Status>(null);
  const [sharing, setSharing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // a fresh sheet starts without the last "copied" note
  useEffect(() => {
    if (!visible) setStatus(null);
  }, [visible]);

  const show = (s: Exclude<Status, null>) => {
    setStatus(s);
    haptic(s === 'failed' ? 'warning' : 'success');
    // Android / web read the live region; iOS needs the announcement
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(tr(`onboarding.agentSetup.${s}`));
    if (timer.current) clearTimeout(timer.current);
    if (s !== 'failed') timer.current = setTimeout(() => setStatus(null), 4000);
  };

  const copy = async () => show((await copySetupPrompt(AGENT_SETUP_PROMPT)) ? 'copied' : 'failed');
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const r = await shareSetupPrompt(AGENT_SETUP_PROMPT, tr('onboarding.agentSetup.shareTitle'));
      if (r === 'copied') show('copiedInstead');
      else if (r === 'failed') show('failed');
    } finally {
      setSharing(false);
    }
  };

  const title = tr('onboarding.agentSetup.title');
  return (
    <SheetModal visible={visible} onClose={onClose} closeLabel={tr('onboarding.common.close')} label={title} maxWidth={560} maxHeight="92%" animationType="slide">
      <SheetGrabber />
      <ScrollView style={styles.flexShrink} contentContainerStyle={[styles.body, { paddingHorizontal: t.spacing.xl - 4, gap: t.spacing.m }]} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <View style={[styles.headIcon, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]} accessible={false} importantForAccessibility="no-hide-descendants">
            <OnbIcon name="agent" size={22} color={t.colors.text} />
          </View>
          <HText variant="headline" accessibilityRole="header" style={styles.flex1}>
            {title}
          </HText>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={tr('onboarding.common.close')}
            style={({ pressed }) => [styles.close, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}
          >
            <Icon name="x" size={18} color={t.colors.text} />
          </Pressable>
        </View>

        <View style={{ gap: 4 }}>
          <HText variant="body">{tr('onboarding.agentSetup.lead')}</HText>
          <HText variant="callout" color="muted">
            {tr('onboarding.agentSetup.lead2')}
          </HText>
        </View>

        <View style={[styles.promptBox, { borderColor: t.colors.border, backgroundColor: t.colors.codeBg, borderRadius: t.radii.l }]}>
          <View style={[styles.promptHead, { borderBottomColor: t.colors.border }]}>
            <HText variant="caption" color="muted" weight="600">
              {tr('onboarding.agentSetup.promptLabel')}
            </HText>
          </View>
          <ScrollView style={styles.promptScroll} nestedScrollEnabled contentContainerStyle={{ padding: 12 }}>
            <HText variant="mono" selectable style={{ color: t.colors.codeText }} {...LANG_EN}>
              {AGENT_SETUP_PROMPT}
            </HText>
          </ScrollView>
        </View>

        <View style={styles.btnCol}>
          <Button icon={status === 'copied' ? 'check' : 'copy'} label={status === 'copied' ? tr('onboarding.agentSetup.copied') : tr('onboarding.agentSetup.copy')} onPress={() => void copy()} />
          <Button variant="secondary" icon="send" label={tr('onboarding.agentSetup.share')} loading={sharing} onPress={() => void share()} />
        </View>
        <View accessibilityLiveRegion="polite" style={styles.status}>
          {status === 'copiedInstead' || status === 'failed' ? (
            <HText variant="caption" color={status === 'failed' ? 'danger' : 'muted'} align="center">
              {tr(`onboarding.agentSetup.${status}`)}
            </HText>
          ) : null}
        </View>

        <View style={[styles.linkBox, { borderTopColor: t.colors.border }]}>
          <HText variant="callout" color="muted">
            {tr('onboarding.agentSetup.linkHint')}
          </HText>
          <Button variant="ghost" icon="qr" label={tr('onboarding.agentSetup.pasteLink')} onPress={onPasteLink} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  body: { paddingTop: 4, paddingBottom: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  promptBox: { borderWidth: 1, overflow: 'hidden' },
  promptHead: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  promptScroll: { maxHeight: 240 },
  btnCol: { gap: 8 },
  status: { minHeight: 0 },
  linkBox: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
});
