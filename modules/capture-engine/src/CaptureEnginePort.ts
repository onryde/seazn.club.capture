import type { SessionCredentials } from '@/domain/credentials/StreamCredentials';
import type { SessionState, ShedStep } from '@/domain/session/SessionState';

/**
 * The seam between JavaScript and the native session (AGENTS.md §2).
 *
 * Three implementations: HaishinKit.swift (iOS), StreamPack (Android), and a
 * fake. Build the fake first — every screen, state and failure mode must be
 * developable on a laptop with no device.
 */

/**
 * Intents, not RPC. Every command returns void and is reconciled against
 * native state. A promise that must resolve mid-reconnect is a deadlock
 * waiting for a bad cell.
 *
 * Note what is absent: lifecycle sends no intents. Native receives
 * `applicationDidBecomeActive` / `onResume` itself and owns the decision to
 * reconnect. A `start` sent from JS on return could open a *new* broadcast on
 * a live input the compositor already considers finished.
 */
export type EngineIntent =
  | { readonly kind: 'arm'; readonly credentials: SessionCredentials }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  /** Clear a finished session so the next fixture can be scanned. */
  | { readonly kind: 'reset' }
  | { readonly kind: 'switchCamera' };

/**
 * Reported upward at ~1 Hz. Never put this in React state — see AGENTS.md §8.
 *
 * **Heartbeat contract:** native emits a snapshot at least once a second even
 * when nothing has changed. That is what lets JS distinguish "quiet" from
 * "gone" — without it `reportedAtMs` is meaningless and the app cannot tell a
 * suspended process from a working one.
 */
export type EngineSnapshot = {
  readonly state: SessionState;
  readonly telemetry: Telemetry;
  /**
   * What the session was armed with, or null before a scan. Native holds the
   * session, so it holds the descriptor too — the UI needs `overlayUrl` and
   * `playbackUrl` from it to peek (§7, N16).
   */
  readonly credentials: SessionCredentials | null;
  /**
   * The phone clock when native emitted this. The app compares it against now
   * to decide whether it still trusts what it is holding: a projection that
   * knows it is stale must refuse to make claims rather than keep showing LIVE
   * for a broadcast that may have ended minutes ago.
   */
  readonly reportedAtMs: number;
  /**
   * Whether capture continues when the app leaves the foreground.
   *
   * Reported by native, deliberately NOT derived from `Platform.OS`. Android
   * answers true only once its foreground service is actually running — and
   * false if the service failed to start, which Android 14's
   * FOREGROUND_SERVICE_CAMERA permission makes a real possibility. iOS always
   * answers false. The UI must never assert a capability native has not
   * confirmed.
   */
  readonly survivesBackground: boolean;
};

export type Telemetry = {
  readonly bitrateKbps: number;
  readonly droppedFrames: number;
  readonly rttMs: number | null;
  /** Peak audio level, 0-1. Nothing downstream normalises, so this is load-bearing. */
  readonly audioLevel: number;
  readonly thermalHeadroom: number | null;
  readonly batteryLevel: number | null;
  /** M2: NTP-synced, reported even single-camera. Cheap now, a fleet migration later. */
  readonly captureTimestampMs: number | null;
  /**
   * How far down the degradation ladder the device has been pushed, or null if
   * nothing has been shed. A device condition rather than a broadcast state —
   * `overlay-preview` costs the operator a convenience, `encode` costs viewers
   * picture, and the UI should say so differently.
   */
  readonly shed: ShedStep | null;
  /**
   * Why capture is currently impaired by something outside the app, or null.
   *
   * Carried in telemetry rather than as a SessionState member, for the same
   * reason as `shed`: a phone call is a condition of the *device*, not a
   * damaged broadcast. On iOS a call keeps the app in the foreground while
   * killing the microphone, and this field is the only way the status line can
   * say so.
   */
  readonly interruption: Interruption | null;
};

export type Interruption = 'background' | 'call' | 'camera-in-use' | 'system';

/**
 * Shaped for `useSyncExternalStore` — subscribe/getSnapshot with selectors, so
 * a 1 Hz tick over three hours does not re-render the tree.
 */
export interface CaptureEnginePort {
  send(intent: EngineIntent): void;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): EngineSnapshot;
}
