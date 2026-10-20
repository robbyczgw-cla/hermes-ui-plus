/**
 * Which connection profile an open conversation runs on. A chat only ever runs on a profile of its
 * own kind: its history, attachments and the profile's key must never go to another backend
 * (bugs review 2026-10-11 P0-3). When the chat's profile was deleted, the user picks another profile
 * of the same kind explicitly (`chosenId`) or starts a new chat – there is no silent fallback.
 */
import type { ConnectionProfile, ProfileKind } from '../settings/profiles';

export type ChatProfileResolution =
  | { status: 'ok'; profile: ConnectionProfile }
  | {
      status: 'missing';
      kind: ProfileKind;
      /** profiles of the chat's kind the user may continue with */
      candidates: ConnectionProfile[];
    };

export function resolveChatProfile(
  conv: { profileId: string; profileKind: ProfileKind } | undefined,
  profiles: readonly ConnectionProfile[],
  active: ConnectionProfile,
  /** profile the user picked on the "Verbindung fehlt" screen for this chat */
  chosenId?: string,
): ChatProfileResolution {
  if (!conv) return { status: 'ok', profile: active };
  const own = profiles.find((p) => p.id === conv.profileId);
  if (own && own.kind === conv.profileKind) return { status: 'ok', profile: own };
  const chosen = chosenId ? profiles.find((p) => p.id === chosenId) : undefined;
  if (chosen && chosen.kind === conv.profileKind) return { status: 'ok', profile: chosen };
  return { status: 'missing', kind: conv.profileKind, candidates: profiles.filter((p) => p.kind === conv.profileKind) };
}

/**
 * Empty chats follow the active profile (web test 2, N1): a fresh install opens its first chat on the Demo
 * profile; after pairing (or adding / switching a connection) that still-empty chat must run on the new
 * profile instead of answering from the demo. An empty chat has no history and no key has been used for it,
 * so moving it – even to another kind – leaks nothing (the P0-3 rule above protects chats WITH history).
 * Returns the profile to rebind to, or null to keep the binding.
 */
export function emptyChatRebindTarget(
  conv:
    | { profileId: string; profileKind: ProfileKind; messageCount: number; preview: string; origin?: 'remote'; branchSeed?: number; botChat?: true }
    | undefined,
  active: { id: string; kind: ProfileKind },
  /** a turn of this chat is running (first message just sent, not saved yet) */
  running = false,
): { id: string; kind: ProfileKind } | null {
  if (!conv || running) return null;
  // non-empty, synced from Hermes (transcript may still load) or branched (copied context): keep
  // a bot's "Bot Chat" stays on its server (bots/core.ts)
  if (conv.messageCount > 0 || conv.preview !== '' || conv.origin === 'remote' || conv.branchSeed || conv.botChat) return null;
  if (conv.profileId === active.id && conv.profileKind === active.kind) return null;
  return { id: active.id, kind: active.kind };
}
