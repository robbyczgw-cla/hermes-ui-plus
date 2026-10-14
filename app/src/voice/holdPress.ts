// Tap vs. hold state machine of the composer mic button (MicButton gesture callbacks; plain closure, no React).
//
// Recording starts on touch-down (`start('press')`): the recorder is ready while the user is still deciding, so
// nothing said right after pressing is lost. The press resolves later:
//   - finger lifted within `holdDelayMs` → a tap: the same recording continues in tap mode (tap ✓ to stop)
//   - still down after `holdDelayMs`    → hold-to-talk: release stops + transcribes, sliding left cancels
//   - touch cancelled by the system before that (a permission / consent dialog took it) → abort
// Touches while dictation is not idle (or without an engine / hold-to-talk off) stay plain taps on release.

/** The part of a Dictation the controller drives (see useDictation). */
export type PressDictation = {
  phase: 'idle' | 'starting' | 'recording' | 'transcribing';
  available: boolean;
  start(mode?: 'tap' | 'hold' | 'press'): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  releaseHold(): void;
  setHoldDragX(dx: number): void;
  resolvePress(as: 'tap' | 'hold' | 'abort'): void;
};

export type HoldOpts = { dictation: PressDictation; disabled?: boolean; holdToTalk: boolean; holdDelayMs: number; cancelDistance: number };

export type HoldController = {
  update(next: HoldOpts): void;
  /** touch down; false when a touch is already being tracked (second finger) */
  begin(x: number): boolean;
  move(x: number): void;
  /** finger lifted (success) or tracking cancelled by the system; runs once per touch */
  end(success: boolean): void;
  dispose(): void;
};

type Timers = { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function createHoldController(setPressed: (v: boolean) => void, onCancelFeedback: () => void = () => {}, timers: Timers = realTimers): HoldController {
  let o: HoldOpts | null = null;
  let holdTimer: unknown = null;
  let holding = false;
  let canceled = false;
  let down = false;
  let startX = 0;

  const tap = () => {
    const d = o?.dictation;
    if (!d) return;
    if (d.phase === 'idle') void d.start('tap');
    else if (d.phase === 'recording') void d.stop();
    else if (d.phase === 'starting') d.cancel();
    // transcribing: cancel via the RecordingBar ×
  };
  const clearHold = () => {
    if (holdTimer !== null) timers.clear(holdTimer);
    holdTimer = null;
  };

  return {
    update(next) {
      o = next;
    },
    begin(x) {
      if (down) return false;
      down = true;
      startX = x;
      setPressed(true);
      canceled = false;
      holding = false;
      if (o && o.holdToTalk && o.dictation.phase === 'idle' && o.dictation.available) {
        void o.dictation.start('press'); // on touch-down: tap or hold is decided while the recorder starts
        holdTimer = timers.set(() => {
          holdTimer = null;
          holding = true;
          o?.dictation.resolvePress('hold');
        }, o.holdDelayMs);
      }
      return true;
    },
    move(x) {
      const dx = x - startX;
      if (!holding || canceled || !o) return;
      o.dictation.setHoldDragX(dx);
      if (dx < -o.cancelDistance) {
        canceled = true;
        onCancelFeedback();
        o.dictation.cancel();
      }
    },
    end(success) {
      if (!down) return;
      down = false;
      setPressed(false);
      if (holdTimer !== null) {
        // a press that never became a hold: the recording that started on touch-down goes on as a tap
        clearHold();
        o?.dictation.resolvePress(success ? 'tap' : 'abort');
        return;
      }
      if (holding) {
        holding = false;
        if (canceled) o?.dictation.setHoldDragX(0);
        else o?.dictation.releaseHold();
        return;
      }
      if (success) tap();
    },
    dispose() {
      clearHold();
    },
  };
}
