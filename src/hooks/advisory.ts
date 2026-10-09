import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Advisory = 'keepOpen' | 'shed' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  keepOpen: 'stream.advisory.keepOpen',
  shed: 'stream.advisory.shed',
  notCharging: 'stream.advisory.notCharging',
};

/**
 * The status strip's one caption (D17). Device conditions go here, never in the status line (AGENTS §8). Keep the app
 * open outranks them all (CD18): leaving the app is what would end the capture. Heat is next, then not charging. The
 * score-ahead and preview-failed captions went with the score preview (D2 §4.1).
 */
export function topAdvisory(input: {
  shed: boolean;
  charging: boolean | null;
  /** CD18: a held pairing on a phone that would not survive the background (`selectKeepOpen`). */
  keepOpen: boolean;
}): Advisory | null {
  if (input.keepOpen) return 'keepOpen';
  if (input.shed) return 'shed';
  if (input.charging === false) return 'notCharging';
  return null;
}

/** Any step down the ladder sheds the overlay first (AGENTS §8). */
export const selectShedding = (snapshot: EngineSnapshot) => snapshot.telemetry.shed !== null;
export const selectCharging = (snapshot: EngineSnapshot) => snapshot.telemetry.charging;
/**
 * CD18 from Pairing on: native's service runs from the pair (amendment §2), so
 * any held pairing native says would not survive the background asks. Idle and
 * Ended hold nothing to lose.
 */
export const selectKeepOpen = (snapshot: EngineSnapshot) =>
  snapshot.state.kind !== 'idle' && snapshot.state.kind !== 'ended' && !snapshot.survivesBackground;
