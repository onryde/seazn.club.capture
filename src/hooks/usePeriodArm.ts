import { useEffect, useRef, useState } from 'react';

/** How long End of period stays off after its label changes. */
const REARM_MS = 2_000;

/**
 * Whether End of period takes a press: it re-arms 2 s after its label changes (the controller's ruling, final review,
 * 2026-11-08), so a second tap can never move a match from Half-time straight on to Full time. `label` is the drawn
 * label's key, null while the tool is not offered, undefined while the pad is loading. The pad's first drawing is no
 * change, so a pad opened mid-match is armed at once, and so is a pad drawn again after it was gone.
 */
export function usePeriodArm(label: string | null | undefined): boolean {
  const [armed, setArmed] = useState(true);
  const seen = useRef(label);
  useEffect(() => {
    const before = seen.current;
    seen.current = label;
    if (before === label) return;
    if (before === undefined) {
      setArmed(true);
      return;
    }
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), REARM_MS);
    return () => clearTimeout(timer);
  }, [label]);
  return armed;
}
