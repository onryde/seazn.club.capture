import type {
  BroadcastInfo,
  Environment,
  LastEnd,
  PairingInfo,
  Readiness,
  Refusal,
  Unpaired,
} from '@/domain/session/Pairing';
import type { SessionState, ShedStep } from '@/domain/session/SessionState';

/**
 * The seam between JavaScript and the native session (AGENTS.md §2).
 *
 * Three implementations: HaishinKit.swift (iOS), StreamPack (Android), and a
 * fake. Build the fake first — every screen, state and failure mode must be
 * developable on a laptop with no device.
 */

/** A9: `new` from a scan or Continue, `resume` from the cold-start re-pair only. */
export type Claim = 'new' | 'resume';

/**
 * Everything native needs to pair (amendment, The engine port). `token` is
 * the code's Bearer: a secret, never logged; the bridge protects it on arrival.
 * `language` is the notification's (P3), a two-letter code. `venueTimezone` is
 * the saved waiting fields' (carry T23), so a cold-start re-pair names the
 * venue's zone before the first beat answers.
 */
export type PairIntent = {
  readonly kind: 'pair';
  readonly code: string;
  readonly slot: number;
  readonly token: string;
  readonly codeUrl: string;
  readonly heartbeatUrl: string;
  readonly startUrl: string;
  readonly venueTimezone: string;
  readonly language: string;
  readonly automatic: boolean;
  readonly claim: Claim;
  readonly environment: Environment;
};

/**
 * Intents, not RPC (AGENTS §2): each returns void, is reconciled against
 * native state, and native ignores one that does not fit. A promise that must
 * resolve mid-reconnect is a deadlock waiting for a bad cell.
 *
 * Note what is absent: lifecycle sends no intents, and nothing arms. Native
 * receives `onResume` itself and owns reconnecting, and it arms itself on a
 * start (amendment, The engine port: "`arm` goes").
 */
export type EngineIntent =
  | PairIntent
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'unpair' }
  /** Clear an ended session so the next code can pair. Ended only: native ignores it elsewhere. */
  | { readonly kind: 'reset' }
  | { readonly kind: 'setAutomatic'; readonly on: boolean }
  | { readonly kind: 'setLanguage'; readonly language: string }
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
  /** From `pair` until `reset` or Idle; Ended keeps it, so JS can forget the code it names. */
  readonly pairing: PairingInfo | null;
  /** While a broadcast is held. Ended carries none (CD40). */
  readonly broadcast: BroadcastInfo | null;
  /** Native's readiness verdict (A11), the one authority behind the chips and Go live. */
  readonly ready: Readiness;
  readonly refusal: Refusal | null;
  readonly lastEnd: LastEnd | null;
  /** In Idle after an unpair the operator did not ask for, until the next `pair`. */
  readonly unpaired: Unpaired | null;
  /** A 401 seen while a broadcast is held: "Code ended" follows the broadcast's end. */
  readonly codeEndedPending: boolean;
  /** Null with no session: idle, pairing, and once ended (plan B's `Snapshot.camera`). */
  readonly camera: CameraState | null;
  /**
   * The phone clock when native emitted this, in epoch ms. What the app shows
   * when native stops reporting (a stale snapshot) is plan C's decision, made
   * with the bridge (final review M1); until then the app makes no staleness claim.
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
 * flattened, with the thermal int named. `audioLevel`, `deliveryCheckedAtMs`
 * and `captureTimestampMs` are platform facts plan C's bridge adds; the
 * counters after `heartbeat` are the bridge's own (C4a). Camera and network
 * readiness are not telemetry: native's `ready` is their one authority (A11).
 * The keys are `wire/snapshot-vectors.json`'s `telemetryKeys`, exactly.
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
  /** Record lines the native sink refused, and lines dropped by its re-entrancy guard (Diagnostics). */
  readonly recordSinkFailures: number;
  readonly recordReentrantDropped: number;
  /**
   * Native's `RecordCounters` (review 13 I3, review C4a I-2 and m-8): failures
   * that reached the scheduler's task boundary; reporters that failed to report
   * one; snapshots the projection or the bridge threw on, or sent over the last
   * good facts; commands the platform threw on; and `stickyFailure` while a
   * platform failure is held, each attempt refused until the next pair (carry
   * 18). No UI row reads them, and nothing in JS does: the spec names no
   * Diagnostics row for them (review C5 I-2). They travel only on the snapshot,
   * as telemetry; the shared record carries native's own lines (a
   * `command-failed` line per command the platform threw on), not these counts.
   */
  readonly taskFailures: number;
  readonly reporterFailures: number;
  readonly snapshotFailures: number;
  readonly commandFailures: number;
  readonly stickyFailure: boolean;
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
