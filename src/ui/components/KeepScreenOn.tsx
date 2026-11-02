import { useScreenAwake } from '@/hooks/useScreenAwake';

/**
 * Holds the screen on for as long as it is mounted, and draws nothing. The scoring screens that mean "the scorer is here
 * to score" mount it: the live pad (and under its not-started and recorded-result cards), and the wait before it (owner
 * ruling 9, 2026-10-31, applied by the controller on 2026-11-02). A state that needs a person to act does not, so the
 * screen may sleep: the full-screen states, and the pad's view-only, bad-link and update-needed cards (`holdsScreen`).
 * Mounting it is the whole switch, which is why a screen mounts it conditionally and a hook (which cannot be called
 * conditionally) is wrapped here.
 */
export function KeepScreenOn(): null {
  useScreenAwake();
  return null;
}
