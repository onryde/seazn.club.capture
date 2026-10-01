import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { StreamSession } from '@/domain/credentials/StreamSession';
import type { SessionState, ShedStep } from '@/domain/session/SessionState';

/**
 * The seam between JavaScript and the native session (AGENTS.md §2).
 *
 * Three implementations: HaishinKit.swift (iOS), StreamPack (Android), and a
 * fake. Build the fake first — every screen, state and failure mode must be
 * developable on a laptop with no device.
 */

/** Where native posts the heartbeat from its foreground service (spec decisions 5 and 6). */
export type HeartbeatTarget = { readonly url: string; readonly token: string };

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
  | { readonly kind: 'arm'; readonly session: StreamSession; readonly heartbeat: HeartbeatTarget }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  /**
   * Clear a finished session so the next fixture can be scanned. Ended only:
   * native ignores it in any other state (plan B's SessionMachine.kt), so an
   * armed session is stopped first (fix round 3, N1).
   */
  | { readonly kind: 'reset' }
  | { readonly kind: 'switchCamera' };

/**
 * Whose camera is on air: plan B's `CameraState.wire` (its Phase.kt). `taken`
 * is another app's; `reopening` is ours after it let go, the slate still up;
 * `resuming` is ours reopened with no frame yet; `switching` is the operator's
 * switch waiting for the new camera's first frame. Plan B holds LIVE through
 * all four while there is no outage.
 */
export type CameraState = 'own' | 'taken' | 'reopening' | 'resuming' | 'switching';

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
   * What the session was armed with, secrets left behind (D8): the UI needs
   * the overlay and playback URLs, the label and the warming deadline, and
   * never the token, passphrase or stream key. Null before an arm.
   */
  readonly descriptor: SessionDescriptor | null;
  /**
   * The slot the session was armed with: which camera position of the match,
   * and so which credential, this phone publishes. Null before an arm and
   * after a reset. Together with `descriptor.sid` it names the session a
   * returning code may adopt (C7: another slot is another camera). Plan B's
   * native snapshot carries neither; plan C's bridge must report both.
   */
  readonly slot: number | null;
  /**
   * N2: `tokenTag` of the armed session's token, never the token (D8). With
   * `descriptor.sid` and `slot` it names the code native holds, so a re-issued
   * code (same match and slot, new token) is told from the first. Null before
   * an arm and after a reset. Plan C: the bridge computes it at the arm with
   * the same `tokenTag` and native echoes it (C8).
   */
  readonly tokenTag: string | null;
  /** Null with no session: idle, and once ended (plan B's `Snapshot.camera`). */
  readonly camera: CameraState | null;
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

/** What the delivered playlist says (F-P5-13): moving, not moving, or no evidence either way. */
export type Delivery = 'ok' | 'stalled' | 'unknown';

/** Android's PowerManager thermal status names. */
export type ThermalStatus =
  'none' | 'light' | 'moderate' | 'severe' | 'critical' | 'emergency' | 'shutdown';

/** SRT's own counters, cumulative since the attempt connected: plan B's `SrtTelemetry`. */
export type SrtStats = {
  readonly sent: number;
  readonly retransmitted: number;
  readonly dropped: number;
  readonly rttMs: number | null;
};

/** Plan B's `HeartbeatResult.wire`. */
export type HeartbeatResult = 'ok' | 'failed' | 'session-over';

/** Counted and dropped, never blocking (ruling 5). Diagnostics shows it; nothing else reads it. */
export type HeartbeatStatus = {
  readonly lastSentAtEpochMs: number | null;
  /** `session-over` is the server saying the organiser ended it; native turns that into `ended`. */
  readonly lastResult: HeartbeatResult | null;
  readonly consecutiveFailures: number;
  readonly failures: number;
};

/**
 * Names match plan B's `Snapshot` where the core reports the value (D40):
 * `bitrateKbps`, `targetBitrateKbps`, `encodedVideoFps`, `audioPacketsPerSecond`,
 * `srt`, `delivery`, `deliveredLagMs`, `dataUsedBytes`, `charging`,
 * `heartbeat`, `shed`. The device fields are plan B's `DeviceSample`
 * flattened, with the thermal int named. `audioLevel`, `cameraReady`,
 * `networkReachable`, `deliveryCheckedAtMs` and `captureTimestampMs` are
 * platform facts plan C's bridge adds.
 *
 * **Null is "no reading", never zero and never healthy.** Native reports null
 * off air, while the camera is taken (the stall watchdog holds, so the
 * encoded rates are null), and for the delivered lag whenever `delivery` is
 * `unknown`. A reader shows a dash, not a 0.
 */
export type Telemetry = {
  /** Measured egress: what actually left the phone. Null off air. */
  readonly bitrateKbps: number | null;
  /** The regulator's video target. */
  readonly targetBitrateKbps: number | null;
  /** Peak audio level, 0-1. Nothing downstream normalises, so this is load-bearing. */
  readonly audioLevel: number;
  /** Pre-flight (spec §1): the camera is producing frames. */
  readonly cameraReady: boolean;
  /** Pre-flight: a validated network, not merely a connected one. */
  readonly networkReachable: boolean;
  /** F-P5-4: encoded video frames and audio packets per second. Null off air and while the camera is taken. */
  readonly encodedVideoFps: number | null;
  readonly audioPacketsPerSecond: number | null;
  /** Null while on RTMPS or before connecting. */
  readonly srt: SrtStats | null;
  readonly delivery: Delivery;
  /** Null whenever `delivery` is `unknown`. */
  readonly deliveredLagMs: number | null;
  /**
   * When the delivery watch last checked, in **epoch ms on the phone's wall
   * clock**: the base of `reportedAtMs`, `heartbeat.lastSentAtEpochMs` and the
   * app's `clock()`. Diagnostics shows "Checked … s ago" as `clock()` minus
   * this, so plan C's bridge must never map a monotonic or boot-relative
   * time here (batch 9 review M5). Null before the first check.
   */
  readonly deliveryCheckedAtMs: number | null;
  readonly dataUsedBytes: number;
  readonly charging: boolean | null;
  readonly batteryPercent: number | null;
  /** From the charge counter: P5 found the percentage unreliable for drain. */
  readonly drainPctPerHour: number | null;
  readonly thermalStatus: ThermalStatus | null;
  /** Android API 30+; null below it or when unknown (plan B passes null where Android reads −1). */
  readonly thermalHeadroom: number | null;
  /** M2: NTP-synced, reported even single-camera. */
  readonly captureTimestampMs: number | null;
  /** How far down the degradation ladder the device is (AGENTS §8). A device condition, not a state. */
  readonly shed: ShedStep | null;
  readonly heartbeat: HeartbeatStatus;
};

/**
 * Shaped for `useSyncExternalStore` — subscribe/getSnapshot with selectors, so
 * a 1 Hz tick over three hours does not re-render the tree.
 */
export interface CaptureEnginePort {
  send(intent: EngineIntent): void;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): EngineSnapshot;
}
