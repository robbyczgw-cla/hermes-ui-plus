import AsyncStorage from '@react-native-async-storage/async-storage';
import { Component, Fragment, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { ChatErrorScreen } from './ChatErrorScreen';
import { clearCrashMarker, makeCrashMarker, writeCrashMarker, type CrashStorage } from './crashMarker';

export const crashStorage: CrashStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

/** Persist "this chat crashed" (read on the next start by ChatScreen). Never throws. */
export function recordChatCrash(conversationId: string | undefined, profileId: string | undefined, error: unknown): void {
  if (!conversationId) return;
  void writeCrashMarker(crashStorage, makeCrashMarker(conversationId, profileId, error));
}

/** After this long without a crash the chat counts as healthy again and the marker is removed. */
const STABLE_MS = 4000;

function ClearMarkerWhenStable({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    const h = setTimeout(() => void clearCrashMarker(crashStorage, conversationId), STABLE_MS);
    return () => clearTimeout(h);
  }, [conversationId]);
  return null;
}

type Props = {
  conversationId: string;
  profileId?: string;
  onNewChat(): void;
  /** clear the persisted node state of this conversation (the boundary remounts afterwards) */
  onResetChat(): Promise<void> | void;
  onSwitchConnection(): void;
  children: ReactNode;
};

type State = { failed: boolean; error: unknown; attempt: number };

/**
 * Chat-level error boundary (inside the route, around one conversation's session). Mount it with
 * `key={conversationId + profileId}` so switching chat/profile always starts clean. "Erneut versuchen"
 * really remounts the session subtree (new `attempt` key → hooks re-read stored data).
 * (Deliberate class component: React has no hook equivalent for error boundaries.)
 */
export class ChatBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    recordChatCrash(this.props.conversationId, this.props.profileId, error);
    console.error('[chat] render crash in conversation', this.props.conversationId, error, info?.componentStack ?? '');
  }

  componentDidUpdate(prev: Props) {
    // defensive: the parent keys us by conversation + profile, but never keep an error across a switch
    if (this.state.failed && (prev.conversationId !== this.props.conversationId || prev.profileId !== this.props.profileId)) {
      this.setState((s) => ({ failed: false, error: null, attempt: s.attempt + 1 }));
    }
  }

  retry = () => {
    this.setState((s) => ({ failed: false, error: null, attempt: s.attempt + 1 }));
  };

  newChat = () => {
    this.props.onNewChat();
    // usually the key changes (new conversation id); when the crashed chat was an empty draft that
    // create() re-uses, remount anyway
    this.retry();
  };

  resetChat = async () => {
    try {
      await this.props.onResetChat();
    } catch {
      /* still remount */
    }
    this.retry();
  };

  render() {
    if (this.state.failed) {
      return (
        <ChatErrorScreen
          error={this.state.error}
          onRetry={this.retry}
          onNewChat={this.newChat}
          onResetChat={this.resetChat}
          onSwitchConnection={this.props.onSwitchConnection}
        />
      );
    }
    return (
      <Fragment key={this.state.attempt}>
        {this.props.children}
        <ClearMarkerWhenStable conversationId={this.props.conversationId} />
      </Fragment>
    );
  }
}
