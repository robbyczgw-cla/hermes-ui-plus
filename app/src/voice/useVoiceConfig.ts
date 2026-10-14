/** `GET /bridge/voice/config` as a hook (cached 5 min per bridge origin). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedVoiceConfig, fetchVoiceConfig } from './bridge';
import { bridgeOrigin } from './bridgeCore';
import { isVoiceError, VoiceError } from './types';
import type { VoiceConfig, VoiceConn } from './types';

export type VoiceConfigState = { config: VoiceConfig | null; loading: boolean; error: VoiceError | null; reload(): void };

export function useVoiceConfig(conn: VoiceConn | null): VoiceConfigState {
  const key = conn ? `${bridgeOrigin(conn.baseUrl)}|${conn.apiKey}` : '';
  const [state, setState] = useState<{ key: string; config: VoiceConfig | null; loading: boolean; error: VoiceError | null }>(() => ({
    key,
    config: cachedVoiceConfig(conn),
    loading: !!conn,
    error: null,
  }));
  const connRef = useRef(conn);
  useEffect(() => {
    connRef.current = conn;
  });
  const seq = useRef(0);

  const load = useCallback(
    (force: boolean) => {
      const c = connRef.current;
      const my = ++seq.current;
      if (!c) {
        setState({ key, config: null, loading: false, error: null });
        return;
      }
      setState((s) => ({ key, config: s.key === key ? s.config : cachedVoiceConfig(c), loading: true, error: null }));
      fetchVoiceConfig(c, { force })
        .then((config) => {
          if (my === seq.current) setState({ key, config, loading: false, error: null });
        })
        .catch((e: unknown) => {
          if (my === seq.current) {
            setState((s) => ({ ...s, key, loading: false, error: isVoiceError(e) ? e : new VoiceError('unknown', 'voice.errors.configLoadFailed') }));
          }
        });
    },
    [key]
  );

  useEffect(() => {
    load(false);
    const counter = seq;
    return () => {
      counter.current++;
    };
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  const fresh = state.key === key;
  return { config: fresh ? state.config : cachedVoiceConfig(conn), loading: fresh ? state.loading : !!conn, error: fresh ? state.error : null, reload };
}
