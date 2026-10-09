import type { Cause, NotReady, Transport } from '@/domain/session/Pairing';

/**
 * A *projection* of native state, not an authority (AGENTS.md §2).
 *
 * The aggregate lives in native code — it owns connect, publish, reconnect and
 * fallback. These types describe what native reports upward at ~1 Hz. Building
 * a second state machine here produces two authorities that disagree at 3-1 in
 * the 40th over.
 *
 * Illegal states are unrepresentable on purpose: no
 * `isLive && !isReconnecting && hasFallenBack` booleans.
 *
 * The Kotlin `SessionMachine` (plan B) is the authority, and this is its
 * report: every `kind` and every reason below equals one of its `.wire`
 * strings (D40). Nothing in TypeScript moves a session from one state to
 * another; the fake engine plays scripted snapshots instead (spec §2).
 */
export type SessionState =
  | { readonly kind: 'idle' }
  /** `pair` accepted; the permission dialog may be up (amendment §2, Pairing). */
  | { readonly kind: 'pairing' }
  /** Waiting for a Go live, with the camera open while the viewfinder shows (CD37). */
  | { readonly kind: 'paired' }
  /** A start accepted; native is fetching the session (`retrying` when the fetch failed). */
  | { readonly kind: 'arming'; readonly cause: Cause; readonly retrying: boolean }
  /** The session in hand; native connects on its own once ready (A11). */
  | { readonly kind: 'armed'; readonly cause: Cause; readonly notReady: NotReady | null }
  | { readonly kind: 'connecting'; readonly transport: Transport }
  | { readonly kind: 'publishing'; readonly transport: Transport; readonly sinceEpochMs: number }
  /** Still publishing, but something is wrong the operator should see. */
  | {
      readonly kind: 'degraded';
      readonly transport: Transport;
      readonly reason: DegradeReason;
      readonly sinceEpochMs: number;
    }
  /** Uplink gone. The front door is holding the input for the rest of the window. */
  | {
      readonly kind: 'reconnecting';
      /** Which of plan B's three triggers is being ridden out; the status line names it (D38). */
      readonly cause: ReconnectCause;
      readonly holdRemainingSeconds: number;
      readonly holdWindowSeconds: number;
      readonly sinceEpochMs: number;
    }
  /** `durationMs` is time on air, or null when the session never went live. */
  | { readonly kind: 'ended'; readonly reason: EndReason; readonly durationMs: number | null };

/**
 * `sinceEpochMs` deliberately survives a drop. The broadcast is continuous
 * across the hold window — that is the whole point of the front door — so the
 * HUD's elapsed time must not reset when the operator walks behind a sightscreen.
 */

/**
 * Why a live session is reconnecting, as plan B's `ReconnectCause.wire`:
 * the uplink dropped, the video stopped advancing (F-P5-6), or viewers stopped
 * receiving and native is forcing a new session (F-P5-13).
 */
export type ReconnectCause = 'uplink-lost' | 'video-stalled' | 'not-delivered';

/**
 * Reasons the *broadcast* is impaired. Note what is absent: thermal pressure.
 * A device getting hot is a condition of the handset, not of the stream, and
 * per the degradation ladder (AGENTS.md §8) it closes What viewers see long
 * before it touches the encode. It is carried in telemetry
 * instead, so a hot phone that is still publishing cleanly does not get
 * reported as a damaged broadcast.
 *
 * Native sends one reason, the most important of plan B's ordered list (D39).
 */
export type DegradeReason =
  | 'fell-back-to-rtmps'
  | 'poor-uplink'
  /** DeliveryWatch: viewers are not receiving, and native is forcing a new session (F-P5-13). */
  | 'not-delivered'
  /** Another app holds the camera; a phone-made slate is on air (spec decision 7). */
  | 'camera-taken'
  /** A call silenced the microphone (F-P5-8). */
  | 'mic-silenced';

/**
 * Ended is only the operator's Stop and a permanent failure (amendment, What
 * this changes in S1): every other end returns to Paired with a `lastEnd`.
 * Owner decision 1 (2026-10-05): the operator's Stop ends the pairing only
 * once the broadcast went live; one before the first frame returns to Paired
 * with the last end `stopped`.
 */
export type EndReason = 'operator-stopped' | 'fatal-error';

/**
 * The degradation ladder, in order, never reordered (AGENTS §8). Step 1
 * closes and disables What viewers see (D2 §4.2); steps 2 and 3 are reported
 * only (_FINDINGS N26). The operator's convenience is the cheapest thing on
 * the device.
 */
export type ShedStep = 'viewer-feed' | 'preview-framerate' | 'encode';

export const SHED_ORDER: readonly ShedStep[] = ['viewer-feed', 'preview-framerate', 'encode'];
