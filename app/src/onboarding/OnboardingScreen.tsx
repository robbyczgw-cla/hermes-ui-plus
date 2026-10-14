// Ready-made wrapper: OnboardingFlow wired to the app's ConnectionProvider (settings/ConnectionProvider).
// Must be rendered inside <ConnectionProvider>.
import { useCallback, useEffect } from 'react';
import { useConnection } from '../settings/ConnectionProvider';
import type { ConnectionProfile } from '../settings/profiles';
import { markOnboardingVisible } from './hostEvents';
import { OnboardingFlow, type OnboardingFlowProps } from './OnboardingFlow';
import { clearPairRecovery } from './storage';

export type OnboardingScreenProps = Omit<OnboardingFlowProps, 'existingProfiles' | 'onSaveConnection'> & {
  /** the flow saved a connection (the host holds back new pair links until the flow finished) */
  onSaved?: () => void;
};

export function OnboardingScreen({ onSaved, ...props }: OnboardingScreenProps) {
  const { profiles, upsertProfile, setActive } = useConnection();
  useEffect(() => markOnboardingVisible(), []);
  const onSaveConnection = useCallback(
    async (p: ConnectionProfile) => {
      await upsertProfile(p);
      setActive(p.id);
      // a redeemed token kept after a failed save (pairRecovery.ts) is safe now
      void clearPairRecovery(p.apiKey).catch(() => {});
      onSaved?.();
    },
    [upsertProfile, setActive, onSaved],
  );
  return <OnboardingFlow {...props} existingProfiles={profiles} onSaveConnection={onSaveConnection} />;
}
