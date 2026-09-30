import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Advisory = 'shed' | 'overlayFailed' | 'scoreAhead' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  shed: 'stream.advisory.shed',
  overlayFailed: 'stream.advisory.overlayFailed',
  scoreAhead: 'stream.advisory.scoreAhead',
  notCharging: 'stream.advisory.notCharging',
};

/**
 * The top strip's one caption (D17). Device conditions go here, never in the
 * status line: heat sheds the overlay while the broadcast is fine (AGENTS §8).
 */
export function topAdvisory(input: {
  shed: boolean;
  overlayFailed: boolean;
  armed: boolean;
  overlayOn: boolean;
  charging: boolean | null;
}): Advisory | null {
  if (input.shed) return 'shed';
  if (input.overlayOn && input.overlayFailed) return 'overlayFailed';
  if (input.overlayOn && input.armed) return 'scoreAhead';
  if (input.charging === false) return 'notCharging';
  return null;
}

/** Any step down the ladder sheds the overlay first (AGENTS §8). */
export const selectShedding = (snapshot: EngineSnapshot) => snapshot.telemetry.shed !== null;
export const selectCharging = (snapshot: EngineSnapshot) => snapshot.telemetry.charging;
