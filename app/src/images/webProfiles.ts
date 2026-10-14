import type { BridgeConn } from './webCore.ts';

/** Bridge connection from the stored profiles: the active one if it is a Hermes bridge, else the first bridge profile. */
export function bridgeConnFromProfiles(
  profiles: readonly { id: string; kind: string; bridge?: boolean; baseUrl: string; apiKey: string }[],
  activeId?: string,
): BridgeConn | null {
  const ok = (p: (typeof profiles)[number]) => p.kind === 'hermes' && !!p.bridge && /^https?:\/\//i.test(p.baseUrl) && !!p.apiKey;
  const p = profiles.find((x) => x.id === activeId && ok(x)) ?? profiles.find(ok);
  return p ? { baseUrl: p.baseUrl, apiKey: p.apiKey } : null;
}
