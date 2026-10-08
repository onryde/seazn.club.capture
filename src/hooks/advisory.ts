import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Advisory = 'keepOpen' | 'shed' | 'overlayFailed' | 'scoreAhead' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  keepOpen: 'stream.advisory.keepOpen',
  shed: 'stream.advisory.shed',
  overlayFailed: 'stream.advisory.overlayFailed',
  scoreAhead: 'stream.advisory.scoreAhead',
  notCharging: 'stream.advisory.notCharging',
};

/**
 * The status strip's one caption (D17). Device conditions go here, never in the
 * status line: heat sheds the overlay while the broadcast is fine (AGENTS §8).
 * A device advisory — heat, not charging — outranks the score-ahead note,
 * which shows while paired only when nothing else is up (ruling M6, over
 * D17/D18): framing a shot, before any broadcast, is when plugging in
 * disturbs nothing. Keep the app open outranks them all (CD18): leaving the
 * app is what would end the capture.
 */
export function topAdvisory(input: {
  shed: boolean;
  overlayFailed: boolean;
  /** Framing a shot, before any broadcast. */
  paired: boolean;
  overlayOn: boolean;
  charging: boolean | null;
  /** CD18: a held pairing on a phone that would not survive the background (`selectKeepOpen`). */
  keepOpen: boolean;
}): Advisory | null {
  if (input.keepOpen) return 'keepOpen';
  if (input.shed) return 'shed';
  if (input.overlayOn && input.overlayFailed) return 'overlayFailed';
  if (input.charging === false) return 'notCharging';
  if (input.overlayOn && input.paired) return 'scoreAhead';
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
