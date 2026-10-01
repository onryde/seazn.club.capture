import type {
  CameraState,
  EngineSnapshot,
  HeartbeatResult,
  Telemetry,
  ThermalStatus,
} from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';
import type { Translator } from '@/i18n/translate';

export type DiagnosticsRow = { readonly label: string; readonly value: string };
export type DiagnosticsSection = {
  readonly title: string;
  readonly rows: readonly DiagnosticsRow[];
};

/** How many session-record lines the screen shows; Share sends them all. */
export const RECORD_TAIL = 20;

type T = Translator['t'];
type Pair = readonly [MessageKey, string];

/**
 * Spec §4's Diagnostics, as label and value text. Unknown is "—", never a
 * zero: a value the phone has not measured must not read as a measurement.
 * Numbers are ungrouped (`120000`), so no locale decides a separator.
 */
export function diagnosticsSections(
  snapshot: EngineSnapshot,
  nowMs: number,
  t: T,
): DiagnosticsSection[] {
  const tel = snapshot.telemetry;
  const section = (title: MessageKey, pairs: readonly Pair[]): DiagnosticsSection => ({
    title: t(title),
    rows: pairs.map(([label, value]) => ({ label: t(label), value })),
  });
  return [
    section('diag.section.link', linkRows(snapshot, t)),
    section('diag.section.delivery', deliveryRows(tel, nowMs, t)),
    section('diag.section.device', deviceRows(snapshot, t)),
    section('diag.section.heartbeat', heartbeatRows(tel, nowMs, t)),
  ];
}

const unit = (t: T, key: MessageKey, value: number | null): string =>
  value === null ? t('diag.none') : t(key, { value });
const secondsAgo = (t: T, nowMs: number, atMs: number | null): string =>
  atMs === null ? t('diag.none') : t('diag.unit.ago', { value: roundTenth((nowMs - atMs) / 1000) });
const roundTenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The uplink. "Sending audio" is the encoded audio packet rate: audio leaving
 * the phone, not the mic's health (carry 12; the meter is that). Native has
 * no rate before air, so armed reads a dash, which is true.
 */
function linkRows(snapshot: EngineSnapshot, t: T): Pair[] {
  const { state, telemetry: tel } = snapshot;
  const transport = 'transport' in state ? state.transport.toUpperCase() : t('diag.none');
  const { srt } = tel;
  return [
    ['diag.transport', transport],
    ['diag.bitrate', unit(t, 'diag.unit.kbps', tel.bitrateKbps)],
    ['diag.target', unit(t, 'diag.unit.kbps', tel.targetBitrateKbps)],
    ['diag.fps', unit(t, 'diag.unit.fps', tel.encodedVideoFps)],
    ['diag.audio', unit(t, 'diag.unit.pps', tel.audioPacketsPerSecond)],
    ['diag.rtt', unit(t, 'diag.unit.ms', srt?.rttMs ?? null)],
    [
      'diag.resent',
      srt === null
        ? t('diag.none')
        : t('diag.unit.ofSent', { value: srt.retransmitted, total: srt.sent }),
    ],
    ['diag.dropped', srt === null ? t('diag.none') : String(srt.dropped)],
  ];
}

const DELIVERY: Readonly<Record<Telemetry['delivery'], MessageKey>> = {
  ok: 'diag.delivery.ok',
  stalled: 'diag.delivery.stalled',
  unknown: 'diag.delivery.unknown',
};

function deliveryRows(tel: Telemetry, nowMs: number, t: T): Pair[] {
  const lag = tel.deliveredLagMs === null ? null : roundTenth(tel.deliveredLagMs / 1000);
  return [
    ['diag.delivery', t(DELIVERY[tel.delivery])],
    ['diag.lag', unit(t, 'diag.unit.seconds', lag)],
    ['diag.checked', secondsAgo(t, nowMs, tel.deliveryCheckedAtMs)],
    ['diag.data', t('diag.unit.mb', { value: Math.round(tel.dataUsedBytes / 1_000_000) })],
  ];
}

/** Carry 13: whose camera it is, plan B's `Snapshot.camera`; null with no session. */
const CAMERA: Readonly<Record<CameraState, MessageKey>> = {
  own: 'diag.camera.own',
  taken: 'diag.camera.taken',
  reopening: 'diag.camera.reopening',
  resuming: 'diag.camera.resuming',
  switching: 'diag.camera.switching',
};

/** Heat is a device condition here, never a broadcast state (AGENTS §8). */
const THERMAL: Readonly<Record<ThermalStatus, MessageKey>> = {
  none: 'diag.thermal.none',
  light: 'diag.thermal.light',
  moderate: 'diag.thermal.moderate',
  severe: 'diag.thermal.severe',
  critical: 'diag.thermal.critical',
  emergency: 'diag.thermal.emergency',
  shutdown: 'diag.thermal.shutdown',
};

function deviceRows({ camera, telemetry: tel }: EngineSnapshot, t: T): Pair[] {
  const named = <K extends string>(table: Readonly<Record<K, MessageKey>>, key: K | null) =>
    key === null ? t('diag.none') : t(table[key]);
  const charging =
    tel.charging === null ? t('diag.none') : t(tel.charging ? 'diag.yes' : 'diag.no');
  return [
    ['diag.camera', named(CAMERA, camera)],
    ['diag.battery', unit(t, 'diag.unit.percent', tel.batteryPercent)],
    ['diag.drain', unit(t, 'diag.unit.perHour', tel.drainPctPerHour)],
    ['diag.charging', charging],
    ['diag.thermal', named(THERMAL, tel.thermalStatus)],
  ];
}

const HEARTBEAT: Readonly<Record<HeartbeatResult, MessageKey>> = {
  ok: 'diag.hb.ok',
  failed: 'diag.hb.failed',
  'session-over': 'diag.hb.sessionOver',
};

/** Counted, never blocking (ruling 5): Diagnostics is the only place it shows. */
function heartbeatRows(tel: Telemetry, nowMs: number, t: T): Pair[] {
  const { lastSentAtEpochMs, lastResult, failures } = tel.heartbeat;
  const result = lastResult === null ? t('diag.none') : t(HEARTBEAT[lastResult]);
  return [
    ['diag.hbSent', secondsAgo(t, nowMs, lastSentAtEpochMs)],
    ['diag.hbResult', result],
    ['diag.hbFailures', String(failures)],
  ];
}
