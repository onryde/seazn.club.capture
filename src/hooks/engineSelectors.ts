import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';

/**
 * Pure readers over the engine snapshot. They live here rather than in
 * `domain/` because `EngineSnapshot` belongs to the engine module, and the
 * layering forbids domain depending on it.
 *
 * Every one returns a primitive, because `useEngineSelector` compares by
 * identity and a fresh object would re-render on every 1 Hz tick.
 */

/**
 * The engine as the shell's reopen and leave rules see it. Module scope and
 * primitive-returning, like every selector here, so a 1 Hz tick re-renders
 * nothing unless the status itself changes. The `default` is safe because
 * `ended` and the resting kinds are named: a new broadcast kind is `live` by
 * construction, which is the amendment's rule.
 */
export function selectEngineStatus(snapshot: EngineSnapshot): EngineStatus {
  const { state } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'idle';
    case 'pairing':
    case 'paired':
      return 'paired';
    case 'ended':
      return state.reason === 'operator-stopped' ? 'stopped' : 'failed';
    default:
      return 'live';
  }
}

/**
 * Whether the orientation gate must hold its lock (ruling R24): paired or
 * live. The camera is open while paired (CD37), so the lock holds from Paired
 * on, as it did from Armed; this asks "is the camera committed", not "is
 * something going out".
 */
export function selectHoldsOrientation(snapshot: EngineSnapshot): boolean {
  const status = selectEngineStatus(snapshot);
  return status === 'paired' || status === 'live';
}

/**
 * Whether a broadcast is held (Q3, spec §7): armed or live, from Arming on. Home and Settings follow the phone
 * unless this is true. Narrower than `selectHoldsOrientation` on purpose: a Pairing or Paired engine holds no
 * broadcast, and Home and Settings cover the viewfinder, so native closes the capture (F16, read: opaque push,
 * detach, `viewfinder(false)`, BridgeCore `wanted`) and nothing is left to turn under the operator's hands.
 */
export const selectBroadcastHeld = (snapshot: EngineSnapshot): boolean =>
  selectEngineStatus(snapshot) === 'live';

/**
 * Declared at module scope so their identity is stable across renders.
 * An inline `(s) => s.telemetry.bitrateKbps` is a new function every render,
 * which defeats the memoisation this hook exists for.
 */
export const selectStateKind = (snapshot: EngineSnapshot) => snapshot.state.kind;
export const selectBitrateKbps = (snapshot: EngineSnapshot) => snapshot.telemetry.bitrateKbps;
export const selectAudioLevel = (snapshot: EngineSnapshot) => snapshot.telemetry.audioLevel;
export const selectShed = (snapshot: EngineSnapshot) => snapshot.telemetry.shed;
/** The broadcast's overlay, else the pairing's; null when the server sent no usable one. */
export const selectOverlayUrl = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.overlayUrl ?? snapshot.pairing?.overlayUrl ?? null;
/**
 * Final review I-2: whether the overlay URL is the server's word yet. The pair
 * intent carries none, so a pairing's waiting fields, its overlay among them,
 * come with its first 2xx answer, and its label is empty until then (the
 * contract's label is never empty). A broadcast's descriptor carries its own.
 */
export const selectOverlayKnown = (snapshot: EngineSnapshot) =>
  snapshot.broadcast !== null || (snapshot.pairing !== null && snapshot.pairing.label !== '');
export const selectPlaybackUrl = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.playbackUrl ?? null;
/** Pairing's label is empty until the claim is answered: read as none. */
export const selectLabel = (snapshot: EngineSnapshot) =>
  snapshot.broadcast?.label || snapshot.pairing?.label || null;
/** The venue's zone from the pairing: every time the operator reads is in it (spec §2). */
export const selectVenueZone = (snapshot: EngineSnapshot) =>
  snapshot.pairing?.venueTimezone || null;
/** When the match is scheduled to start, as epoch ms (a primitive); null with none. */
export const selectScheduledStartMs = (snapshot: EngineSnapshot) =>
  snapshot.pairing?.scheduledStart?.getTime() ?? null;
/** AUTO shows only when automatic mode is on at both ends (A4): the organiser's and the phone's. */
export const selectAutomaticOn = (snapshot: EngineSnapshot) =>
  snapshot.pairing !== null && snapshot.pairing.autoAllowed && snapshot.pairing.automatic;
/**
 * The pre-picked destination's name; none when the organiser picked none. The
 * wire never sends an empty one (minLength 1), so an empty one reads as none,
 * as `selectLabel` reads an empty label.
 */
export const selectDestination = (snapshot: EngineSnapshot) =>
  snapshot.pairing?.destinationName || null;
/** How the session ended, once it has (Ended's own two reasons); null before. */
export const selectEndReason = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'ended' ? snapshot.state.reason : null;
/** Time on air when it ended (plan B's `durationMs`); null for a session that never went live. */
export const selectEndedDurationMs = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'ended' ? snapshot.state.durationMs : null;
/**
 * A 401 heard while a broadcast was held, deferred to the Stop (CaptureEnginePort.ts:96): the code has ended. Ended keeps
 * it set (Projection.kt:38), so it is also the card's word that the code is dead (spec §5, F14 a).
 */
export const selectCodeEndedPending = (snapshot: EngineSnapshot) => snapshot.codeEndedPending;
/** Whether native holds a pairing; before that there is no overlay to try. */
export const selectHasPairing = (snapshot: EngineSnapshot) => snapshot.pairing !== null;
/** What names native's pairing (amendment, Identity rules): read apart, so each is a stable scalar. */
export const selectHeldCode = (snapshot: EngineSnapshot) => snapshot.pairing?.code ?? null;
export const selectHeldSlot = (snapshot: EngineSnapshot) => snapshot.pairing?.slot ?? null;
export const selectHeldTokenTag = (snapshot: EngineSnapshot) => snapshot.pairing?.tokenTag ?? null;

/** For one-off reads (usePairing), never for useEngineSelector: a new object each call. */
export function selectHeldName(snapshot: EngineSnapshot): CodeName {
  const { pairing } = snapshot;
  return pairing === null
    ? NO_NAME
    : { code: pairing.code, slot: pairing.slot, tokenTag: pairing.tokenTag };
}

/** The pairing native left without being asked, by name; null when none (one-off reads only). */
export function selectUnpairedName(snapshot: EngineSnapshot): CodeName | null {
  const { unpaired } = snapshot;
  return unpaired === null
    ? null
    : { code: unpaired.code, slot: unpaired.slot, tokenTag: unpaired.tokenTag };
}

/**
 * The unpair native names, as one primitive, so `useEngineSelector` compares it
 * with Object.is: one change per unpair, not per snapshot. Null with none.
 */
export const selectUnpairedKey = (snapshot: EngineSnapshot): string | null => {
  const { unpaired } = snapshot;
  return unpaired === null
    ? null
    : `${unpaired.reason}|${unpaired.code}|${unpaired.slot}|${unpaired.tokenTag}`;
};
/** Why native left the pairing, a primitive beside the key; null with no unpair. */
export const selectUnpairedReason = (snapshot: EngineSnapshot) => snapshot.unpaired?.reason ?? null;

/**
 * When the current broadcast began, or null when nothing is running.
 *
 * Deliberately returns the start instant rather than an elapsed duration: a
 * selector taking `now` could not be declared at module scope, and an inline
 * one is a fresh function on every render — the exact thing `useEngineSelector`
 * warns against. Subtract in render instead.
 *
 * Survives a drop by design — the front door holds the input, so the broadcast
 * is continuous even while the uplink is not.
 */
export function selectSinceEpochMs(snapshot: EngineSnapshot): number | null {
  const { state } = snapshot;
  return 'sinceEpochMs' in state ? state.sinceEpochMs : null;
}

export const METER_SEGMENTS = 6;

/**
 * Whole segments lit, not the level: a primitive that changes only when a
 * segment does. A segment lights once the level reaches into its sixth, so any
 * sound shows: a faint mic is one segment, never an empty meter. Its colour is
 * the mic's availability, not the level (spec §4). A level off the wire outside
 * 0..1, or not a number, is clamped rather than drawn.
 */
export function selectMeterSegments(snapshot: EngineSnapshot): number {
  const lit = Math.ceil(snapshot.telemetry.audioLevel * METER_SEGMENTS);
  return Number.isFinite(lit) ? Math.min(METER_SEGMENTS, Math.max(0, lit)) : 0;
}
