// Root-level consent sheet for requests that do not come from the chat composer (remote voice, store.ts
// requestAiConsent). The chat shows its own sheet before the first message.
import { ConsentSheet } from './Consent';
import { useConsentPrompt } from './store';

export function ConsentHost() {
  const p = useConsentPrompt();
  return <ConsentSheet visible={p.open} onAccept={p.accept} onLater={p.later} />;
}
