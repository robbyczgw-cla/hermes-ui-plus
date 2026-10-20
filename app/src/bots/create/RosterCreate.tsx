/**
 * The Bots tab's create parts (spec 2.1): the ink "Neuer Bot" button on top, and the box shown while there is no bot
 * besides Hermes: "Eigene Bots" with one sentence and "Ersten Bot anlegen", or, when this device cannot create bots,
 * who can and why, plus the owner's one command to copy (admin devices only). Never an empty tab.
 */
import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { Button, HText, Icon, useCopiedFlash, useTheme } from '../../ui';
import { ENABLE_COMMAND, type CreateOffer } from './core';

export function NewBotButton({ onPress }: { onPress(): void }) {
  const tr = useT();
  return (
    <View style={styles.newWrap}>
      <Button label={tr('botCreate.newBot')} icon="plus" variant="primary" size="small" onPress={onPress} testID="bots-new" />
    </View>
  );
}

export function BotsEmptyBox({ offer, onCreate }: { offer: CreateOffer; onCreate(): void }) {
  const t = useTheme();
  const tr = useT();
  const [copied, flash] = useCopiedFlash();
  const owner = offer?.kind === 'owner' ? offer : null;
  const reason = owner ? tr(`botCreate.reasons.${owner.reason}` as TKey) : '';
  return (
    <View testID="bots-empty" style={[styles.box, { borderColor: t.colors.borderStrong, borderRadius: t.radii.card }]}>
      <HText variant="bodyStrong">{tr('botCreate.empty.title')}</HText>
      <HText variant="callout" color="muted">
        {tr('botCreate.empty.body')}
      </HText>
      {offer?.kind === 'create' ? (
        <Button label={tr('botCreate.empty.cta')} variant="secondary" size="small" onPress={onCreate} testID="bots-empty-create" style={styles.cta} />
      ) : (
        <View style={styles.owner} accessibilityRole="text">
          <HText variant="callout">{tr('botCreate.empty.ownerOnly')}</HText>
          {reason ? (
            <HText variant="caption" color="subtle">
              {tr('botCreate.empty.why', { reason })}
            </HText>
          ) : null}
          {owner?.command ? (
            <View style={styles.cmdBlock}>
              <HText variant="caption" color="muted">
                {tr('botCreate.empty.command')}
              </HText>
              <Pressable
                onPress={() => {
                  void Clipboard.setStringAsync(ENABLE_COMMAND).then(flash, () => {});
                }}
                accessibilityRole="button"
                accessibilityLabel={`${tr('botCreate.empty.copy')}: ${ENABLE_COMMAND}`}
                testID="bots-enable-command"
                style={({ pressed }) => [styles.cmd, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.codeBg, borderRadius: t.radii.control }]}
              >
                <HText variant="mono" style={[styles.flex, { color: t.colors.codeText }]} selectable>
                  {ENABLE_COMMAND}
                </HText>
                <Icon name={copied ? 'check' : 'copy'} size={16} color={copied ? t.colors.success : t.colors.muted} />
              </Pressable>
              {copied ? (
                <HText variant="caption" color="muted" accessibilityLiveRegion="polite">
                  {tr('botCreate.empty.copied')}
                </HText>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  newWrap: { marginHorizontal: 12, marginBottom: 8, alignItems: 'flex-start' },
  box: { marginHorizontal: 12, marginTop: 10, padding: 14, gap: 8, borderWidth: 1, borderStyle: 'dashed' },
  cta: { alignSelf: 'flex-start', marginTop: 4 },
  owner: { gap: 6, marginTop: 2 },
  cmdBlock: { gap: 6, marginTop: 4 },
  cmd: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44 },
});
