import type { EngineSnapshot, Telemetry } from './CaptureEnginePort';

/**
 * Telemetry at rest: no reading anywhere, every counter 0. Native's own at-rest
 * telemetry (`wire/snapshot-vectors.json`'s `telemetryBase`) says the same, and
 * `unreported.test.ts` holds it to that. Here, not in the fake, so production
 * code never imports the fake (PV27).
 */
export const IDLE_TELEMETRY: Telemetry = {
  bitrateKbps: null,
  targetBitrateKbps: null,
  audioLevel: 0,
  encodedVideoFps: null,
  audioPacketsPerSecond: null,
  srt: null,
  delivery: 'unknown',
  deliveredLagMs: null,
  deliveryCheckedAtMs: null,
  dataUsedBytes: 0,
  charging: null,
  batteryPercent: null,
  drainPctPerHour: null,
  thermalStatus: null,
  thermalHeadroom: null,
  captureTimestampMs: null,
  shed: null,
  heartbeat: { lastSentAtEpochMs: null, lastResult: null, consecutiveFailures: 0, failures: 0 },
  recordSinkFailures: 0,
  recordReentrantDropped: 0,
  taskFailures: 0,
  reporterFailures: 0,
  snapshotFailures: 0,
  commandFailures: 0,
  stickyFailure: false,
};

/**
 * What an engine reports before native has said anything it can read: idle,
 * every field at rest, and `reportedAtMs` 0, so nothing reads it as a recent
 * report. The native engine starts here when `current()` is null or malformed.
 */
export const UNREPORTED: EngineSnapshot = {
  state: { kind: 'idle' },
  telemetry: IDLE_TELEMETRY,
  pairing: null,
  broadcast: null,
  ready: { camera: false, sound: false, network: false, held: false },
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
  camera: null,
  reportedAtMs: 0,
  survivesBackground: false,
};
