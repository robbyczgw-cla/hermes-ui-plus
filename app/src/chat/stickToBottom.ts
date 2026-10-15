/**
 * Stick-to-bottom after the user's own send (inverted chat list, offset 0 = bottom; MessageList.tsx).
 * The send scrolls to the bottom, but the new user bubble, the answer placeholder and (on an instant failure, 68 ms
 * in E2E round 12) the error card land in the next frames: `maintainVisibleContentPosition` keeps the previously
 * visible row still and pushes them below the fold, cutting off the animated scroll. So for STICK_MS after a send
 * every content change re-pins the bottom, and a send error reveals the newest message, unless the user has
 * deliberately scrolled away since (drag, jump to a message, or an offset far from the bottom after the window).
 */
export const STICK_MS = 1500;
/** offset (px) from the bottom that counts as "scrolled away" (= MessageList SHOW_JUMP_AT) */
export const STICK_AWAY_PX = 180;

export type Stick = {
  /** the list was sent to the bottom on purpose (send / jump button) */
  arm(now: number): void;
  /** the user scrolled away on purpose */
  release(): void;
  /** scroll event (offset from the bottom); far away after the follow window = the user scrolled up */
  scrolled(offset: number, now: number): void;
  /** content changed: pin the bottom again? */
  follow(now: number): boolean;
  /** still at the bottom since the last send: a send error may scroll to it */
  pinned(): boolean;
};

export function createStick(windowMs = STICK_MS): Stick {
  let pinned = false;
  let until = 0;
  return {
    arm(now) {
      pinned = true;
      until = now + windowMs;
    },
    release() {
      pinned = false;
      until = 0;
    },
    scrolled(offset, now) {
      if (pinned && now >= until && offset > STICK_AWAY_PX) pinned = false;
    },
    follow: (now) => pinned && now < until,
    pinned: () => pinned,
  };
}
