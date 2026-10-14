/**
 * Chat-level host of "✨ Bearbeiten": provides ImageEditContext to every image view of the chat and
 * renders the sheet. Sending goes through the chat's normal send path (text + attachment), so every
 * backend gets an
 * ordinary user message with the image attached.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { Attachment } from '../attachments/types';
import type { ConnectionProfile } from '../settings/profiles';
import { ImageEditContext, type ImageEditApi } from './context';
import { editGate, type EditSource } from './core';
import { ImageEditSheet } from './ImageEditSheet';

type Props = {
  profile: ConnectionProfile;
  backendName: string;
  history?: readonly Attachment[];
  /** the chat's send (false = refused, e.g. a turn is running) */
  send(text: string, attachments: Attachment[]): boolean;
  onSent?: () => void;
  children: ReactNode;
};

export function ImageEditProvider({ profile, backendName, history, send, onSent, children }: Props) {
  const [source, setSource] = useState<EditSource | null>(null);
  const gate = editGate(profile, null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo<ImageEditApi>(
    () => ({
      open(src) {
        if (timer.current) clearTimeout(timer.current);
        // opened from a fullscreen viewer: let its Modal finish closing first (iOS can't stack them mid-animation)
        timer.current = setTimeout(() => setSource(src), Platform.OS === 'ios' ? 450 : 60);
      },
    }),
    [],
  );

  const onClose = useCallback(
    (sent: boolean) => {
      setSource(null);
      if (sent) onSent?.();
    },
    [onSent],
  );

  return (
    <ImageEditContext.Provider value={api}>
      {children}
      <ImageEditSheet
        source={source}
        gate={gate}
        backendName={backendName}
        history={gate.ok && gate.target.kind === 'claude' ? history : undefined}
        onSend={send}
        onClose={onClose}
      />
    </ImageEditContext.Provider>
  );
}
