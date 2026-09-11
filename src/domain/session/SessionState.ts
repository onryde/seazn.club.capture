import type { Transport } from '@/domain/credentials/StreamCredentials';

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
 */
export type SessionState =
  | { readonly kind: 'idle' }
  /** Credentials parsed, camera running, audio above the floor, network reachable. */
  | { readonly kind: 'armed' }
  | { readonly kind: 'connecting'; readonly transport: Transport }
  | { readonly kind: 'publishing'; readonly transport: Transport; readonly sinceEpochMs: number }
  /** Still publishing, but something is wrong the operator should see. */
  | {
      readonly kind: 'degraded';
      readonly transport: Transport;
      readonly reason: DegradeReason;
      readonly sinceEpochMs: number;
    }
  /** Uplink gone. Cloudflare is holding the input for `holdRemainingSeconds`. */
  | {
      readonly kind: 'reconnecting';
      readonly holdRemainingSeconds: number;
      readonly sinceEpochMs: number;
    }
  | { readonly kind: 'ended'; readonly reason: EndReason };

/**
 * `sinceEpochMs` deliberately survives a drop. The broadcast is continuous
 * across the hold window — that is the whole point of the front door — so the
 * HUD's elapsed time must not reset when the operator walks behind a sightscreen.
 */

/**
 * Reasons the *broadcast* is impaired. Note what is absent: thermal pressure.
 * A device getting hot is a condition of the handset, not of the stream, and
 * per the degradation ladder (AGENTS.md §8) it sheds the operator's overlay
 * preview long before it touches the encode. It is carried in telemetry
 * instead, so a hot phone that is still publishing cleanly does not get
 * reported as a damaged broadcast.
 */
export type DegradeReason = 'fell-back-to-rtmps' | 'poor-uplink' | 'audio-below-floor';

export type EndReason = 'operator-stopped' | 'hold-window-expired' | 'fatal-error';

/**
 * Emitted by native, projected into the read model above. Also the vocabulary
 * the post-match session record is written in — a three-hour outdoor stream
 * fails by degrading, not crashing, so the record matters more than a crash
 * report (AGENTS.md §11).
 */
export type SessionEvent =
  | { readonly kind: 'SessionArmed' }
  | { readonly kind: 'PublishStarted'; readonly transport: Transport }
  | { readonly kind: 'TransportDegraded'; readonly reason: DegradeReason }
  | { readonly kind: 'FellBackToRtmps' }
  /** Carries the window because only native knows it, from C2's contract field. */
  | { readonly kind: 'UplinkLost'; readonly holdWindowSeconds: number }
  | { readonly kind: 'HoldTicked'; readonly holdRemainingSeconds: number }
  | { readonly kind: 'PublishResumed'; readonly transport: Transport }
  /** A device condition. Does not move the session state machine. */
  | { readonly kind: 'ThermalCeilingHit'; readonly shed: ShedStep }
  | { readonly kind: 'SessionEnded'; readonly reason: EndReason }
  /** Back to idle so the phone can be handed on and a new fixture scanned. */
  | { readonly kind: 'SessionReset' };

/**
 * The degradation ladder, in order, never reordered (AGENTS.md §8).
 * The operator's convenience is the cheapest thing on the device.
 */
export type ShedStep = 'overlay-preview' | 'preview-framerate' | 'encode';

export const SHED_ORDER: readonly ShedStep[] = ['overlay-preview', 'preview-framerate', 'encode'];
