// Root-level consent sheet for requests that do not come from the chat composer (remote voice, store.ts
// requestAiConsent). The chat shows its own sheet before the first message. Worded for the active connection.
import { useActiveProfile } from '../settings/ConnectionProvider';
import { ConsentSheet } from './Consent';
import { useConsentPrompt } from './store';

export function ConsentHost() {
  const p = useConsentPrompt();
  const profile = useActiveProfile();
  return <ConsentSheet visible={p.open} profile={profile} onAccept={p.accept} onLater={p.later} />;
}
