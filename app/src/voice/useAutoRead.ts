/**
 * Chat-level helpers for the speaker:
 * - useAutoRead(): reads a reply aloud ("Antworten automatisch vorlesen"). An answer we saw from its start is read
 *   while it still streams, from its first stable sentences on (streamRead.ts: interim notes before tool calls are
 *   skipped, held fences / tables are read once complete); short answers and answers joined mid-stream are read
 *   when they finish. Only live transitions count, so opening an old chat never starts reading.
 * - useStopSpeakingOn(key): stops playback when the conversation changes / a new chat starts.
 */
import { useEffect, useRef } from 'react';
import { useLocale, useT } from '../i18n';
import { useVoiceSettings } from './settingsStore';
import { speak, speakLive, stopSpeaking } from './speaker';
import type { LiveSpeech } from './speaker';
import { createLiveReader } from './streamRead';
import type { LiveReader } from './streamRead';
import type { VoiceConn } from './types';
import { answerText } from '../hermes/progressNotes';
import type { ToolEvent } from '../hermes/types';

/** Structural subset of hermes ChatMessage. */
export type SpeakableMessage = { id: string; role: string; text: string; status: string; tools?: ToolEvent[] };

export function useAutoRead(messages: readonly SpeakableMessage[], conn: VoiceConn | null, opts: { enabled?: boolean } = {}): void {
  const [settings] = useVoiceSettings();
  const t = useT();
  const { locale } = useLocale();
  const enabled = opts.enabled ?? settings.autoRead;
  const seen = useRef(new Map<string, string>());
  const connRef = useRef(conn);
  useEffect(() => {
    connRef.current = conn;
  });
  /** the answer being read while it streams */
  const live = useRef<{ id: string; reader: LiveReader; speech: LiveSpeech | null } | null>(null);

  useEffect(() => {
    const prev = seen.current;
    const next = new Map<string, string>();
    let toRead: SpeakableMessage | null = null;
    for (const m of messages) {
      next.set(m.id, m.status);
      if (m.role === 'assistant' && m.status === 'done' && prev.get(m.id) === 'streaming' && m.text.trim()) toRead = m;
    }
    seen.current = next;

    // read-aloud while streaming: only answers whose start we saw (a new turn begins with an empty placeholder)
    const last = messages[messages.length - 1];
    if (enabled && last?.role === 'assistant' && last.status === 'streaming' && live.current?.id !== last.id && !prev.has(last.id) && last.text.length < LIVE_JOIN_MAX) {
      live.current = { id: last.id, reader: createLiveReader(), speech: null };
    }
    const cur = live.current;
    const lm = cur ? messages.find((m) => m.id === cur.id) : undefined;
    if (cur && lm && enabled) {
      // stopped / failed turn: what plays already finishes, the rest is not added
      const pieces = lm.status === 'streaming' || lm.status === 'done' ? cur.reader.push(lm) : [];
      const text = pieces.join('');
      if (text && !cur.speech) cur.speech = speakLive({ id: lm.id, conn: connRef.current, t, locale }, text);
      else if (text) cur.speech?.append(text);
      if (lm.status !== 'streaming') {
        cur.speech?.end();
        live.current = null;
        // already being read: the end-of-turn read below would start it over
        if (cur.reader.started && toRead?.id === lm.id) toRead = null;
      }
    } else if (cur && (!lm || !enabled)) {
      cur.speech?.end();
      live.current = null;
    }
    // the final answer only (interim notes before tool calls are not read aloud)
    const text = toRead?.tools?.length ? answerText({ ...toRead, role: 'assistant', status: 'done', tools: toRead.tools }) : toRead?.text;
    if (enabled && toRead && text?.trim()) void speak({ id: toRead.id, text, conn: connRef.current, t, locale });
  }, [messages, enabled, t, locale]);
}

/** an answer first seen streaming with more text than this was joined mid-stream (chat opened): read at the end */
const LIVE_JOIN_MAX = 400;

/** Stop playback whenever `key` changes (conversation id) and on unmount of the chat screen. */
export function useStopSpeakingOn(key: string | number | null | undefined): void {
  useEffect(() => () => stopSpeaking(), [key]);
}
