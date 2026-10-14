// Host-side gate for actions coming out of a sandboxed widget. Pure (node --test).
//
// The sandbox can't be trusted to only call window.hermes.* from a click handler (any script can post raw
// messages), so the host additionally requires a *real tap* on the widget, observed outside the WebView, and
// rate-limits actions. Security review M2: the old gate accepted any touch start (the first finger that scrolled
// the chat across a hostile widget) and, on web, mere hover. Now:
//  - native: a tap = touch down + up within TAP_MAX_MOVE_PX and TAP_MAX_MS, no move beyond the slop in between
//    (a scroll or a drag is never a tap);
//  - web: hover and focus never count (GPT security M1 / Astra F15: model code can move focus, and a press that
//    became a drag or long press also moves it). The only source is the shell inside the iframe: it classifies
//    trusted pointer events (<= TAP_MAX_MOVE_PX, <= TAP_MAX_MS, no pointercancel) and trusted keyboard activation
//    (Enter, Space on a button) and reports a tap over a private MessagePort the model code can't reach
//    (shell.ts, HtmlFrame.web.tsx): one action within tapWindowMs. A port tap that arrives right after an accepted
//    action (the port and the window message channel are not ordered against each other) doesn't re-arm;
//  - every tap allows ONE action within tapWindowMs (consumed on use), plus min spacing and a per-minute cap;
//  - an action that arrives while the finger is still down waits for the touch end (`pending`), so the normal
//    "click fires before our touchend event" race doesn't drop legitimate taps.

import type { HtmlBlockAction } from './messages';

export const TAP_MAX_MOVE_PX = 10;
export const TAP_MAX_MS = 1_000;

export type ActionGateOptions = {
  /** An action must arrive within this many ms after the tap that allows it. */
  tapWindowMs?: number;
  /** Minimum spacing between two accepted actions. */
  minIntervalMs?: number;
  /** Hard cap of accepted actions per rolling minute. */
  maxPerMinute?: number;
  maxMovePx?: number;
  maxTapMs?: number;
  /** Web: a frame tap this soon after an accepted action is the same press (cross-channel reordering). */
  frameTapDedupeMs?: number;
};

export type GateVerdict = { ok: true } | { ok: false; reason: 'no_gesture' | 'pending' | 'too_fast' | 'rate_limited' };

export type ActionGate = {
  /** Native touch tracking on the view that wraps the WebView (page coordinates). */
  touchStart(x: number, y: number, now: number): void;
  touchMove(x: number, y: number): void;
  /** Returns true when this touch counted as a tap. */
  touchEnd(x: number, y: number, now: number): boolean;
  touchCancel(): void;
  /** Web: a real tap classified by the shell and reported over the private MessagePort. */
  noteFrameTap(now: number): void;
  /** A finger is down right now (an action may be waiting for its touch end). */
  touchActive(): boolean;
  /** Decides and, if accepted, records the action (consumes the tap). */
  check(action: HtmlBlockAction, now: number): GateVerdict;
};

export function createActionGate(opts: ActionGateOptions = {}): ActionGate {
  const tapWindowMs = opts.tapWindowMs ?? 1_500;
  const minIntervalMs = opts.minIntervalMs ?? 700;
  const maxPerMinute = opts.maxPerMinute ?? 12;
  const maxMove = opts.maxMovePx ?? TAP_MAX_MOVE_PX;
  const maxTapMs = opts.maxTapMs ?? TAP_MAX_MS;
  const frameTapDedupeMs = opts.frameTapDedupeMs ?? 400;
  let touch: { x: number; y: number; t: number; moved: boolean } | null = null;
  let tapAt = -Infinity; // unconsumed tap
  let accepted: number[] = [];
  const far = (x: number, y: number) => !!touch && Math.hypot(x - touch.x, y - touch.y) > maxMove;

  return {
    touchStart(x, y, now) {
      touch = { x, y, t: now, moved: false };
    },
    touchMove(x, y) {
      if (touch && far(x, y)) touch.moved = true;
    },
    touchEnd(x, y, now) {
      const t = touch;
      touch = null;
      if (!t || t.moved || now - t.t > maxTapMs || Math.hypot(x - t.x, y - t.y) > maxMove) return false;
      tapAt = now;
      return true;
    },
    touchCancel() {
      touch = null;
    },
    noteFrameTap(now) {
      const last = accepted.length ? accepted[accepted.length - 1]! : -Infinity;
      if (now - last >= 0 && now - last < frameTapDedupeMs) return;
      tapAt = now;
    },
    touchActive() {
      return touch !== null;
    },
    check(_action, now) {
      if (now - tapAt > tapWindowMs) return { ok: false, reason: touch ? 'pending' : 'no_gesture' };
      const last = accepted.length ? accepted[accepted.length - 1]! : -Infinity;
      if (now - last < minIntervalMs) return { ok: false, reason: 'too_fast' };
      accepted = accepted.filter((t) => now - t < 60_000);
      if (accepted.length >= maxPerMinute) return { ok: false, reason: 'rate_limited' };
      accepted.push(now);
      tapAt = -Infinity; // one action per tap
      return { ok: true };
    },
  };
}
