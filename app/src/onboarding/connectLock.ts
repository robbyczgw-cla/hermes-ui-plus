// While a one-time pair code is redeemed and the resulting connection saved, nothing may navigate away from the
// connection screen (E2E round 4, B1/B2: Android Back ~100 ms after "Verbinden" burned the code on the bridge while the
// app dropped the token and showed Welcome / the idle button). The pipeline in pairConnect.ts holds this lock from the
// tap until the save finished; the flows, the onboarding host (Back, ✕) and the screens (header back) ask it before
// navigating. Pure → tested in pairConnect.test.ts; the React side lives in useConnectLock.ts.

export type ConnectLock = {
  /** take the lock (`code`: the one-time code being redeemed, if any); the returned release is idempotent */
  hold(code?: string): () => void;
  busy(): boolean;
  /** the one-time codes of the runs holding the lock now */
  codes(): string[];
  subscribe(fn: () => void): () => void;
};

export function createConnectLock(): ConnectLock {
  let held = 0;
  const running: string[] = [];
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of [...subs]) fn();
  };
  return {
    hold(code) {
      held++;
      if (code) running.push(code);
      notify();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        held--;
        if (code) running.splice(running.indexOf(code), 1);
        notify();
      };
    },
    busy: () => held > 0,
    codes: () => [...running],
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/**
 * A pair link arrives (onboarding host). Review: links delivered during a running connect remounted the connect screen
 * (another spelling of the same link → a second redeem request) or switched to the scanner (an invalid one), and the
 * running connection's result met a different screen. So while the lock is held a link waits (`defer`, the host keeps
 * the latest and handles it after the run); a link carrying a code that is being redeemed right now is the same link
 * (`drop`). Once the flow saved a connection it is on its post-connect steps and would ignore a new link: it waits
 * until the flow finished.
 */
export type LinkArrival = 'show' | 'defer' | 'drop';

export function pairLinkArrival(s: { code: string | undefined; busy: boolean; running: readonly string[]; flowSaved: boolean }): LinkArrival {
  if (s.code && s.running.includes(s.code)) return 'drop';
  return s.busy || s.flowSaved ? 'defer' : 'show';
}

/** the app-wide lock (one onboarding overlay at a time) */
export const pairConnectLock = createConnectLock();
export const pairConnectBusy = (): boolean => pairConnectLock.busy();
