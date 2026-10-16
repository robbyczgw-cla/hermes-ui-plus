// Step 3a: scan the bridge's pair QR code (expo-camera CameraView barcode scanning) or paste the link.
// A valid link goes straight to the connection screen – a one-time code (`c=`, pairLink.ts) is NOT redeemed here:
// that happens only when the user taps "Verbinden" there (pairConnect.ts), so Back or an app kill never spends it.
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import type { TKey } from '../i18n';
import { HText, useTheme } from '../ui';
import { parsePairLink, type PairData, type PairErrorCode } from './pairLink';
import { pageOrigin } from './webOrigin';
import { Button, Field, Notice, OnbIcon, OnbScreen, SmallLink, Title } from './ui';

const hasWebCamera = () =>
  Platform.OS !== 'web' || (typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

const pairErrorKey = (code: PairErrorCode): TKey => `onboarding.pairErrors.${code}`;

export function ScanPair({
  onPair,
  onBack,
  initialLink,
  step,
  total,
}: {
  onPair: (p: PairData) => void;
  onBack: () => void;
  /** a deep link that still needs this screen: rejected (shown in the paste field with its error); a valid one is
   *  passed on to `onPair` right away (nothing is sent) */
  initialLink?: string | null;
  step?: number;
  total?: number;
}) {
  const t = useTheme();
  const tr = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanError, setScanError] = useState<TKey | null>(null);
  const [initial] = useState(() => (initialLink ? parsePairLink(initialLink, { origin: pageOrigin() }) : null));
  // a link with a one-time code never goes into the (visible, editable) paste field
  const [paste, setPaste] = useState(initial?.ok ? '' : (initialLink ?? ''));
  const [pasteError, setPasteError] = useState<TKey | null>(() => (initial && !initial.ok ? pairErrorKey(initial.error) : null));
  const locked = useRef(false);
  const lastBad = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** hand a valid pair to the flow (once); a one-time code stays unredeemed until "Verbinden" on the next screen */
  const accept = useCallback(
    (pair: PairData) => {
      if (locked.current) return;
      locked.current = true;
      onPair(pair);
    },
    [onPair],
  );

  // a valid deep link handed to this screen → on to the connection screen (once, also under StrictMode)
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initial?.ok) return;
    started.current = true;
    accept(initial.pair);
  }, [initial, accept]);

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (locked.current || !data || data === lastBad.current) return;
    const r = parsePairLink(data, { origin: pageOrigin() });
    if (r.ok) {
      accept(r.pair);
      return;
    }
    // Show the error once per distinct code; the same wrong code stays ignored (no flicker / haptic spam).
    lastBad.current = data;
    setScanError(r.error === 'not-pair-link' ? 'onboarding.scan.wrongCode' : pairErrorKey(r.error));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setScanError(null);
      lastBad.current = null;
    }, 3500);
  };

  const applyPaste = (text: string) => {
    const r = parsePairLink(text, { origin: pageOrigin() });
    if (r.ok) {
      setPasteError(null);
      accept(r.pair);
    } else setPasteError(pairErrorKey(r.error));
  };

  const fromClipboard = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text.trim()) {
      setPasteError('onboarding.scan.clipboardEmpty');
      return;
    }
    setPaste(text.trim());
    applyPaste(text);
  };

  const cameraAvailable = hasWebCamera();
  let camera: ReactNode;
  if (!cameraAvailable) {
    camera = <Notice tone="info" text={tr('onboarding.scan.noCamera')} />;
  } else if (!permission) {
    camera = <View style={[styles.frame, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.xl }]} />;
  } else if (!permission.granted) {
    camera = (
      <View style={[styles.permission, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.xl }]}>
        <OnbIcon name="camera" size={28} color={t.colors.text} />
        <HText variant="headline" align="center">
          {tr('onboarding.scan.permissionTitle')}
        </HText>
        <HText variant="callout" color="muted" align="center">
          {permission.canAskAgain ? tr('onboarding.scan.permissionText') : tr('onboarding.scan.permissionDenied')}
        </HText>
        <View style={{ alignSelf: 'stretch', marginTop: 4 }}>
          {permission.canAskAgain ? (
            <Button label={tr('onboarding.scan.permissionAllow')} onPress={() => void requestPermission()} />
          ) : Platform.OS !== 'web' ? (
            <Button variant="secondary" label={tr('onboarding.scan.openSettings')} onPress={() => void Linking.openSettings()} />
          ) : null}
        </View>
      </View>
    );
  } else {
    camera = (
      <View style={[styles.frame, { borderRadius: t.radii.xl }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
        <View pointerEvents="none" style={styles.reticleWrap}>
          <View style={styles.reticle} />
        </View>
        <View pointerEvents="none" style={styles.caption}>
          <View style={[styles.captionPill, { borderRadius: t.radii.pill }]}>
            <HText variant="caption" style={{ color: '#FFFFFF' }} accessibilityLiveRegion="polite">
              {scanError ? tr(scanError) : tr('onboarding.scan.hint')}
            </HText>
          </View>
        </View>
      </View>
    );
  }

  return (
    <OnbScreen onBack={onBack} step={step} total={total}>
      <Title lead={tr('onboarding.scan.lead')}>{tr('onboarding.scan.title')}</Title>
      {camera}
      <View style={{ marginTop: t.spacing.xl }}>
        <View style={[styles.row, { marginBottom: t.spacing.s }]}>
          <HText variant="headline" style={{ flex: 1 }}>
            {tr('onboarding.scan.pasteTitle')}
          </HText>
          <SmallLink label={tr('onboarding.scan.pasteFromClipboard')} onPress={() => void fromClipboard()} />
        </View>
        <Field
          label={tr('onboarding.scan.pasteTitle')}
          value={paste}
          onChangeText={(v) => {
            setPaste(v);
            setPasteError(null);
          }}
          placeholder={tr('onboarding.scan.pastePlaceholder')}
          keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
          returnKeyType="go"
          onSubmitEditing={() => applyPaste(paste)}
          error={pasteError ? tr(pasteError) : null}
        />
        <Button variant="secondary" label={tr('onboarding.scan.pasteUse')} onPress={() => applyPaste(paste)} disabled={!paste.trim()} />
      </View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  frame: { width: '100%', aspectRatio: 1, maxHeight: 360, alignSelf: 'center', overflow: 'hidden', backgroundColor: '#000' },
  permission: { alignItems: 'center', gap: 10, padding: 24 },
  reticleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: '62%', aspectRatio: 1, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 14, alignItems: 'center' },
  captionPill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, maxWidth: '90%' },
});
