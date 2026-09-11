import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a released peek stays mounted so the next one is instant. */
const WARM_MS = 30_000;

export type Peek = {
  /** True only while the operator is holding. Controls visibility. */
  readonly showing: boolean;
  /** True while held OR still warm. Controls whether the view is mounted. */
  readonly mounted: boolean;
  readonly press: () => void;
  readonly release: () => void;
};

/**
 * Press-and-hold to look, with a warm window afterwards.
 *
 * Mount and unmount on every peek would make each one cost a cold page load or
 * an HLS handshake — seconds, which is useless for a glance. Staying mounted
 * for three hours would spend exactly the thermal and delivery budget that
 * made press-and-hold the right shape in the first place (N16).
 *
 * So: mount on first press, hide on release, unmount once nobody has looked
 * for a while. First peek is slow, the rest are instant, and a quiet match
 * runs nothing.
 */
export function usePeek(warmMs: number = WARM_MS): Peek {
  const [showing, setShowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCooldown = useCallback(() => {
    if (cooldown.current !== null) {
      clearTimeout(cooldown.current);
      cooldown.current = null;
    }
  }, []);

  const press = useCallback(() => {
    clearCooldown();
    setMounted(true);
    setShowing(true);
  }, [clearCooldown]);

  const release = useCallback(() => {
    setShowing(false);
    clearCooldown();
    cooldown.current = setTimeout(() => {
      cooldown.current = null;
      setMounted(false);
    }, warmMs);
  }, [clearCooldown, warmMs]);

  useEffect(() => clearCooldown, [clearCooldown]);

  return { showing, mounted, press, release };
}
