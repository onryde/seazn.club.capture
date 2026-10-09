import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

/**
 * The heat caption has three wordings. `shed` names What viewers see, which the heat closed (D2 §4.2's _rec_), and is
 * said only while the view is built in. With the view hidden (the owner's ruling, 2026-10-09) the caption does not
 * name it: `hotLive` beside a LIVE plate, `hot` everywhere else native sends `shed` (the controller's ruling, 2026-10-09).
 */
export type Advisory = 'keepOpen' | 'shed' | 'hotLive' | 'hot' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  keepOpen: 'stream.advisory.keepOpen',
  shed: 'stream.advisory.shed',
  hotLive: 'stream.advisory.hotLive',
  hot: 'stream.advisory.hot',
  notCharging: 'stream.advisory.notCharging',
};

type AdvisoryInput = {
  readonly shed: boolean;
  readonly charging: boolean | null;
  /** CD18: a held pairing on a phone that would not survive the background (`selectKeepOpen`). */
  readonly keepOpen: boolean;
  /** The plate says LIVE (`selectPublishing`): the only state the heat caption may say "still live" in. */
  readonly live: boolean;
  /** What viewers see is built in (`FEATURES.viewerCheck`, read by the screen): the heat caption may name it. */
  readonly viewerCheck: boolean;
};

/**
 * The status strip's one caption (D17). Device conditions go here, never in the status line (AGENTS §8). Keep the app
 * open outranks them all (CD18): leaving the app is what would end the capture. Heat is next: the broadcast is fine,
 * and the ladder's first rung (D2 §4.2) has closed What viewers see, if it is built in. Not charging is last. The
 * score-ahead and preview-failed captions went with the score preview (D2 §4.1).
 */
export function topAdvisory(input: AdvisoryInput): Advisory | null {
  if (input.keepOpen) return 'keepOpen';
  if (input.shed) return heatCaption(input);
  if (input.charging === false) return 'notCharging';
  return null;
}

/**
 * Native sends `shed` from Armed on (Projection.kt:29), so the caption is true before air too: "still live" only beside
 * a LIVE plate (final review m2). With the view built in the spec's caption is unchanged, and m2 goes back to the owner
 * with it (the controller's ruling, 2026-10-09).
 */
function heatCaption({ live, viewerCheck }: AdvisoryInput): Advisory {
  if (viewerCheck) return 'shed';
  return live ? 'hotLive' : 'hot';
}

/**
 * Any step down the ladder closes What viewers see: the ladder only goes down, so step 2 or 3 means step 1 too
 * (D2 §4.2).
 */
export const selectShedding = (snapshot: EngineSnapshot) => snapshot.telemetry.shed !== null;
export const selectCharging = (snapshot: EngineSnapshot) => snapshot.telemetry.charging;
/**
 * The plate says LIVE (`tallyPlateFor`): the broadcast is going out cleanly. Armed and Connecting are before air;
 * Degraded and a reconnect hold read TROUBLE, and their status lines are urgent, so no caption reaches the strip there.
 */
export const selectPublishing = (snapshot: EngineSnapshot) => snapshot.state.kind === 'publishing';
/**
 * CD18 from Pairing on: native's service runs from the pair (amendment §2), so
 * any held pairing native says would not survive the background asks. Idle and
 * Ended hold nothing to lose.
 */
export const selectKeepOpen = (snapshot: EngineSnapshot) =>
  snapshot.state.kind !== 'idle' && snapshot.state.kind !== 'ended' && !snapshot.survivesBackground;
