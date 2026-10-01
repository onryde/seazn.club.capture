import type {
  CameraState,
  EngineSnapshot,
  HeartbeatResult,
  Telemetry,
  ThermalStatus,
} from '@/engine/CaptureEnginePort';
import { formatNumber } from '@/i18n/formatNumber';
import type { MessageKey } from '@/i18n/messages';
import type { Translator } from '@/i18n/translate';

export type DiagnosticsRow = { readonly label: string; readonly value: string };
export type DiagnosticsSection = {
  readonly title: string;
  readonly rows: readonly DiagnosticsRow[];
};

/** How many session-record lines the screen shows; Share sends them all. */
export const RECORD_TAIL = 20;

/** The copy and the numbers, both in the operator's language. */
type Say = { readonly t: Translator['t']; readonly num: (value: number) => string };
type Pair = readonly [MessageKey, string];

/**
 * Spec §4's Diagnostics, as label and value text. Unknown is "—", never a
 * zero: a value the phone has not measured must not read as a measurement.
 * Numbers carry the language's decimal separator and are never grouped
 * (`formatNumber`).
 */
export function diagnosticsSections(
  snapshot: EngineSnapshot,
  nowMs: number,
  translator: Translator,
): DiagnosticsSection[] {
  const { t, lang } = translator;
  const say: Say = { t, num: (value) => formatNumber(value, lang) };
  const tel = snapshot.telemetry;
  const section = (title: MessageKey, pairs: readonly Pair[]): DiagnosticsSection => ({
    title: t(title),
    rows: pairs.map(([label, value]) => ({ label: t(label), value })),
  });
  return [
    section('diag.section.link', linkRows(snapshot, say)),
    section('diag.section.delivery', deliveryRows(tel, nowMs, say)),
    section('diag.section.device', deviceRows(snapshot, say)),
    section('diag.section.heartbeat', heartbeatRows(tel, nowMs, say)),
  ];
}

const unit = ({ t, num }: Say, key: MessageKey, value: number | null): string =>
  value === null ? t('diag.none') : t(key, { value: num(value) });
/** `atMs` is epoch ms, as `nowMs` is (the port's `deliveryCheckedAtMs`, `lastSentAtEpochMs`). */
const secondsAgo = (say: Say, nowMs: number, atMs: number | null): string =>
  unit(say, 'diag.unit.ago', atMs === null ? null : (nowMs - atMs) / 1000);

/**
 * The uplink. "Sending audio" is the encoded audio packet rate: audio leaving
 * the phone, not the mic's health (carry 12; the meter is that). Native has
 * no rate before air, so armed reads a dash, which is true.
 */
function linkRows(snapshot: EngineSnapshot, say: Say): Pair[] {
  const { t, num } = say;
  const { state, telemetry: tel } = snapshot;
  const transport = 'transport' in state ? state.transport.toUpperCase() : t('diag.none');
  const { srt } = tel;
  return [
    ['diag.transport', transport],
    ['diag.bitrate', unit(say, 'diag.unit.kbps', tel.bitrateKbps)],
    ['diag.target', unit(say, 'diag.unit.kbps', tel.targetBitrateKbps)],
    ['diag.fps', unit(say, 'diag.unit.fps', tel.encodedVideoFps)],
    ['diag.audio', unit(say, 'diag.unit.pps', tel.audioPacketsPerSecond)],
    ['diag.rtt', unit(say, 'diag.unit.ms', srt?.rttMs ?? null)],
    [
      'diag.resent',
      srt === null
        ? t('diag.none')
        : t('diag.unit.ofSent', { value: num(srt.retransmitted), total: num(srt.sent) }),
    ],
    ['diag.dropped', srt === null ? t('diag.none') : num(srt.dropped)],
  ];
}

const DELIVERY: Readonly<Record<Telemetry['delivery'], MessageKey>> = {
  ok: 'diag.delivery.ok',
  stalled: 'diag.delivery.stalled',
  unknown: 'diag.delivery.unknown',
};

function deliveryRows(tel: Telemetry, nowMs: number, say: Say): Pair[] {
  const lag = tel.deliveredLagMs === null ? null : tel.deliveredLagMs / 1000;
  return [
    ['diag.delivery', say.t(DELIVERY[tel.delivery])],
    ['diag.lag', unit(say, 'diag.unit.seconds', lag)],
    ['diag.checked', secondsAgo(say, nowMs, tel.deliveryCheckedAtMs)],
    ['diag.data', unit(say, 'diag.unit.mb', Math.round(tel.dataUsedBytes / 1_000_000))],
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

function deviceRows({ camera, telemetry: tel }: EngineSnapshot, say: Say): Pair[] {
  const { t } = say;
  const named = <K extends string>(table: Readonly<Record<K, MessageKey>>, key: K | null) =>
    key === null ? t('diag.none') : t(table[key]);
  const charging =
    tel.charging === null ? t('diag.none') : t(tel.charging ? 'diag.yes' : 'diag.no');
  return [
    ['diag.camera', named(CAMERA, camera)],
    ['diag.battery', unit(say, 'diag.unit.percent', tel.batteryPercent)],
    ['diag.drain', unit(say, 'diag.unit.perHour', tel.drainPctPerHour)],
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
function heartbeatRows(tel: Telemetry, nowMs: number, say: Say): Pair[] {
  const { t, num } = say;
  const { lastSentAtEpochMs, lastResult, failures } = tel.heartbeat;
  const result = lastResult === null ? t('diag.none') : t(HEARTBEAT[lastResult]);
  return [
    ['diag.hbSent', secondsAgo(say, nowMs, lastSentAtEpochMs)],
    ['diag.hbResult', result],
    ['diag.hbFailures', num(failures)],
  ];
}
