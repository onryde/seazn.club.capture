import { describe, expect, it } from 'vitest';
import type {
  Cause,
  LastEnd,
  NotReady,
  Refusal,
  ScoreUpdates,
  UnpairReason,
} from '@/domain/session/Pairing';
import type { EndReason } from '@/domain/session/SessionState';
import type { HeartbeatStatus, SrtStats, Telemetry } from './CaptureEnginePort';
import vectors from './wire/snapshot-vectors.json';

/**
 * The TS port names what native's SnapshotWire sends (`wire/snapshot-vectors.json`,
 * "change only with both"). Each table below is a `Record` over a TS union or
 * type's keys, so the compiler refuses a missing or extra member, and the test
 * holds it to the file. Telemetry keys are handed through unchanged (carry T23).
 */
const TELEMETRY: Readonly<Record<keyof Telemetry, true>> = {
  bitrateKbps: true,
  targetBitrateKbps: true,
  audioLevel: true,
  encodedVideoFps: true,
  audioPacketsPerSecond: true,
  srt: true,
  delivery: true,
  deliveredLagMs: true,
  deliveryCheckedAtMs: true,
  dataUsedBytes: true,
  charging: true,
  batteryPercent: true,
  drainPctPerHour: true,
  thermalStatus: true,
  thermalHeadroom: true,
  captureTimestampMs: true,
  shed: true,
  heartbeat: true,
  recordSinkFailures: true,
  recordReentrantDropped: true,
  taskFailures: true,
  reporterFailures: true,
  snapshotFailures: true,
  commandFailures: true,
  stickyFailure: true,
};
const SRT: Readonly<Record<keyof SrtStats, true>> = {
  sent: true,
  retransmitted: true,
  dropped: true,
  rttMs: true,
};
const HEARTBEAT: Readonly<Record<keyof HeartbeatStatus, true>> = {
  lastSentAtEpochMs: true,
  lastResult: true,
  consecutiveFailures: true,
  failures: true,
};

const CAUSE: Readonly<Record<Cause, true>> = {
  organiser: true,
  automatic: true,
  operator: true,
  rejoin: true,
};
const NOT_READY: Readonly<Record<NotReady, true>> = {
  camera: true,
  sound: true,
  network: true,
  held: true,
};
const REFUSAL: Readonly<Record<Refusal, true>> = {
  no_destination: true,
  no_credit: true,
  not_entitled: true,
  unknown: true,
  'start-failed': true,
};
const LAST_END: Readonly<Record<LastEnd, true>> = {
  'stopped-by-organiser': true,
  'stopped-automatically': true,
  'no-signal': true,
  'destination-refused': true,
  'max-duration': true,
  'phone-lost': true,
  'ended-by-seazn': true,
  'hold-window-expired': true,
  stopped: true,
};
const UNPAIR: Readonly<Record<UnpairReason, true>> = {
  'code-ended': true,
  replaced: true,
  taken: true,
  permissions: true,
  forgotten: true,
};
const END: Readonly<Record<EndReason, true>> = { 'operator-stopped': true, 'fatal-error': true };
const SCORE_UPDATES: Readonly<Record<ScoreUpdates, true>> = { realtime: true, polled: true };

const sorted = (keys: readonly string[]) => [...keys].sort();

describe("the port names exactly what native's snapshot sends", () => {
  it.each([
    ['telemetry', TELEMETRY, vectors.telemetryKeys.telemetry, 25],
    ['srt', SRT, vectors.telemetryKeys.srt, 4],
    ['heartbeat', HEARTBEAT, vectors.telemetryKeys.heartbeat, 4],
  ] as const)('%s keys', (_name, table, keys, count) => {
    expect(keys).toHaveLength(count);
    expect(sorted(Object.keys(table))).toEqual(sorted(keys));
  });

  it.each([
    ['cause', CAUSE, vectors.vocabulary.cause, 4],
    ['notReady', NOT_READY, vectors.vocabulary.notReady, 4],
    ['refusal', REFUSAL, vectors.vocabulary.refusal, 5],
    ['lastEnd', LAST_END, vectors.vocabulary.lastEnd, 9],
    ['unpairReason', UNPAIR, vectors.vocabulary.unpairReason, 5],
    ['endReason', END, vectors.vocabulary.endReason, 2],
    ['scoreUpdates', SCORE_UPDATES, vectors.vocabulary.scoreUpdates, 2],
  ] as const)('%s words', (_name, table, words, count) => {
    expect(words).toHaveLength(count);
    expect(sorted(Object.keys(table))).toEqual(sorted(words));
  });
});
