/**
 * Inline review comments in the coding views. Long-press a diff line (or its accessibility action) → a small composer
 * under the line; comments collect per diff / review sheet; "Request changes" sends them as ONE message.
 *
 * Where they go: `CodeReviewContext.onSubmitComments` when an app shell provides it (the Pi app sends a steer into the
 * running turn), else the hui `send` action (a normal chat message, through the chat's send gate).
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { TextInput } from '../../../primitives/Text';
import { useTheme } from '../../../theme';
import { HText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { useHui } from '../../../primitives/context';
import { useT } from '../../../../i18n';
import { reviewMessage, upsertComment, type ReviewComment } from './reviewModel.ts';
import { useCaptureMode } from '../../../lib/capture';

export type { ReviewComment } from './reviewModel.ts';

export type CodeReviewOptions = {
  /**
   * All comments of one diff / review as one message. Return false when it could not be sent (the comments stay).
   * Not provided: the comments go out as a chat message (`send` action).
   */
  onSubmitComments?: (comments: ReviewComment[], message: string) => boolean | void;
  /** false: no inline comments (read-only views, exports) */
  enabled?: boolean;
};

export const CodeReviewContext = createContext<CodeReviewOptions>({});

/** where a composer is open: row key + what the comment will point at */
export type CommentTarget = Omit<ReviewComment, 'text'>;

export type ReviewApi = {
  enabled: boolean;
  comments: ReviewComment[];
  /** row key → its comments (rendered under the row) */
  byRow: ReadonlyMap<string, ReviewComment[]>;
  editing: CommentTarget | null;
  startComment: (target: CommentTarget) => void;
  cancel: () => void;
  save: (text: string) => void;
  remove: (id: string) => void;
  submit: () => void;
};

/** Comment state of one diff / review sheet. Row keys are `<fileKey>|<rowKey>`. */
export function useReviewComments(): ReviewApi {
  const ctx = useContext(CodeReviewContext);
  const { onAction, streaming } = useHui();
  const tr = useT();
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [editing, setEditing] = useState<CommentTarget | null>(null);
  const enabled = ctx.enabled !== false && !streaming;
  const byRow = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of comments) m.set(c.id, [...(m.get(c.id) ?? []), c]);
    return m;
  }, [comments]);
  const startComment = useCallback((target: CommentTarget) => setEditing(target), []);
  const cancel = useCallback(() => setEditing(null), []);
  const save = useCallback(
    (text: string) => {
      if (editing) setComments((list) => upsertComment(list, { ...editing, text }));
      setEditing(null);
    },
    [editing],
  );
  const remove = useCallback((id: string) => setComments((list) => list.filter((c) => c.id !== id)), []);
  const submit = useCallback(() => {
    if (!comments.length) return;
    const message = reviewMessage(comments, { intro: tr('ui.diff.reviewIntro'), at: (path, line) => tr('ui.diff.commentAt', { path, line }) });
    const ok = ctx.onSubmitComments
      ? ctx.onSubmitComments(comments, message)
      : onAction({ type: 'send', text: message }, undefined, { label: tr('ui.diff.requestChanges'), composed: true });
    if (ok !== false) {
      setComments([]);
      setEditing(null);
    }
  }, [comments, ctx, onAction, tr]);
  return { enabled, comments, byRow, editing, startComment, cancel, save, remove, submit };
}

/** The open composer under a line. */
export function CommentComposer({ api, initial }: { api: ReviewApi; initial?: string }) {
  const t = useTheme();
  const tr = useT();
  const [text, setText] = useState(initial ?? '');
  return (
    <View style={{ margin: 6, padding: 8, gap: 6, borderRadius: t.radii.m, borderWidth: 1, borderColor: t.colors.accent, backgroundColor: t.colors.surface }}>
      <TextInput
        autoFocus
        multiline
        value={text}
        onChangeText={setText}
        placeholder={tr('ui.diff.commentPlaceholder')}
        placeholderTextColor={t.colors.subtle}
        accessibilityLabel={tr('ui.diff.comment')}
        style={[
          { minHeight: 44, maxHeight: 160, color: t.colors.text, fontSize: t.typography.callout.fontSize, lineHeight: t.typography.callout.lineHeight, padding: 0, textAlignVertical: 'top' },
          // the composer's accent border is the focus cue (no browser focus ring, like the chat composer)
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        ]}
        onKeyPress={(e) => {
          // web / desktop: Esc cancels, ⌘/Ctrl+Enter adds
          const ev = e.nativeEvent as unknown as { key: string; metaKey?: boolean; ctrlKey?: boolean };
          if (ev.key === 'Escape') api.cancel();
          else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) api.save(text);
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <PressableScale haptic="selection" onPress={api.cancel} style={{ paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: t.radii.pill }}>
          <HText variant="caption" color="muted" weight="600">
            {tr('actions.cancel')}
          </HText>
        </PressableScale>
        <PressableScale
          haptic="light"
          disabled={!text.trim()}
          onPress={() => api.save(text)}
          style={{ paddingHorizontal: 14, height: 32, justifyContent: 'center', borderRadius: t.radii.pill, backgroundColor: t.colors.accent }}
        >
          <HText variant="caption" weight="600" style={{ color: t.colors.onAccent }}>
            {tr('ui.diff.addComment')}
          </HText>
        </PressableScale>
      </View>
    </View>
  );
}

/** A saved comment under its line. */
export function CommentBubble({ c, api }: { c: ReviewComment; api: ReviewApi }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={{ marginHorizontal: 6, marginVertical: 4, paddingVertical: 6, paddingLeft: 10, paddingRight: 4, gap: 6, flexDirection: 'row', alignItems: 'flex-start', borderRadius: t.radii.m, backgroundColor: t.colors.accentSoft }}>
      <HText variant="callout" style={{ flex: 1 }} selectable>
        {c.text}
      </HText>
      <PressableScale haptic="selection" onPress={() => api.remove(c.id)} hitSlop={8} accessibilityLabel={tr('ui.diff.removeComment')} style={{ padding: 4 }}>
        <Icon name="x" size={14} color={t.colors.muted} />
      </PressableScale>
    </View>
  );
}

/** "2 comments · Request changes" under the diff once there are comments. */
function ReviewBarInner({ api }: { api: ReviewApi }) {
  const t = useTheme();
  const tr = useT();
  const n = api.comments.length;
  if (!n) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingTop: t.spacing.xs }}>
      <HText variant="caption" color="muted" style={{ flex: 1 }}>
        {tr('ui.diff.comments', { count: n })}
      </HText>
      <PressableScale
        haptic="light"
        onPress={api.submit}
        accessibilityLabel={tr('ui.diff.requestChangesA11y', { count: n })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: t.radii.pill, backgroundColor: t.colors.accent }}
      >
        <Icon name="send" size={14} color={t.colors.onAccent} />
        <HText variant="callout" weight="600" style={{ color: t.colors.onAccent }}>
          {tr('ui.diff.requestChanges')}
        </HText>
      </PressableScale>
    </View>
  );
}

/** share-as-image (capture mode): an app-only control, not part of the picture */
export function ReviewBar(props: Parameters<typeof ReviewBarInner>[0]) {
  return useCaptureMode() ? null : <ReviewBarInner {...props} />;
}
