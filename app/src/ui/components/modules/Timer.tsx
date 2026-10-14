/**
 * `timer` – replaced by timer v2 (modules/d2/TimerV2.tsx: countdown, until, stopwatch, multi-timer).
 * Kept as a re-export so registryA and older imports keep working; registryD2 takes precedence.
 */
export { Timer } from './d2/TimerV2';
