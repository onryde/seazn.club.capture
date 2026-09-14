/**
 * Reading the P5 telemetry CSV, so a run's criteria are computed rather than
 * eyeballed by whoever opens the file. Pure text in, numbers out.
 *
 * The parser honours the quirks the results doc records, because each one has
 * already misled a reader: an empty cell is a MISSING reading and never a zero;
 * `thermalHeadroom` is -1 where the platform cannot report it and NaN when
 * polled faster than it allows; and the `network` column reads `none` whenever
 * ConnectivityManager momentarily answers null, so it is not an outage log and
 * plays no part in deciding whether a sample was publishing.
 *
 * Columns 1–14 never move: shell one-liners read them positionally. The delivery
 * columns F-P5-4 asked for (frames, SRT counters) sit after `detail`, which is safe
 * only because SpikeLog strips commas from every cell it writes.
 *
 * Pure on purpose — `telemetry-report.ts` is the CLI. A CLI in this file would
 * run on every test import.
 */

export type Sample = {
  readonly thermalStatus: number | null;
  readonly thermalHeadroom: number | null;
  readonly batteryPercent: number | null;
  readonly batteryTempC: number | null;
  readonly charging: boolean;
  readonly screenOn: boolean;
  readonly streaming: boolean;
  readonly transport: string | null;
  /**
   * Measured egress in bits per second — never the encoder's configured target. It is
   * bytes handed to the transport, retransmissions included, so it kept reading
   * 3.5–4.5 Mbps through nine seconds with no network at all (2026-09-14 reconnect cell).
   */
  readonly videoBitrate: number | null;
  /**
   * F-P5-4's missing witnesses, in the columns after `detail`. Frame counts are
   * cumulative encoded frames handed to the endpoint over its life, which spans
   * reconnects; the SRT counters are cumulative per socket, so they restart on every
   * reconnect. Every one is null on rows written before the columns existed, and the
   * SRT ones whenever the transport is not a connected SRT socket.
   */
  readonly videoFrames: number | null;
  readonly audioFrames: number | null;
  /** Data packets sent, retransmissions included. */
  readonly srtPacketsWritten: number | null;
  readonly srtPacketsRetransmitted: number | null;
  /** Packets the receiver reported lost (NAKed). */
  readonly srtPacketsWriteLost: number | null;
  /** SRT's too-late send drops: packets it gave up on, which the platform never received. */
  readonly srtPacketsWriteDropped: number | null;
  /** Instantaneous readings, not counters. */
  readonly srtRttMs: number | null;
  readonly srtSndBufMs: number | null;
  readonly srtFlightSizePkts: number | null;
  readonly srtBandwidthMbps: number | null;
};

export type Row =
  | { readonly kind: 'sample'; readonly atMs: number; readonly sample: Sample }
  | { readonly kind: 'event'; readonly atMs: number; readonly name: string; readonly detail: string };

/** The outage pairs the protocol opens on purpose; criterion 1 is read outside them. */
export const OUTAGE_MARKS: readonly (readonly [string, string])[] = [
  ['mark-4', 'mark-5'],
  ['mark-8', 'mark-9'],
];

/**
 * How many readings a window needs before its mean is reported. The CSV records
 * `videoBitrate` as 0 on the first streaming sample and for one sample after a
 * reconnect, because the endpoint's cumulative counter is still being
 * established. A "60 second mean" computed from one such sample is 0, and
 * reported as a run's minimum it fails criterion 3 on every healthy run — the
 * first version of this file did exactly that against real Run A data. Thirty
 * readings at 1 Hz is half a window: enough that one zero moves a 4000 kbps
 * mean by about 130 kbps, which is the smoothing the criterion asks for.
 */
const MIN_WINDOW_SAMPLES = 30;

/** Missing is null, never 0 — the distinction criterion 3 turns on. */
function figure(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  const value = Number(cell);
  return Number.isFinite(value) ? value : null;
}

function text(cell: string | undefined): string | null {
  return cell === undefined || cell.trim() === '' ? null : cell.trim();
}

export function parseRows(csv: string): readonly Row[] {
  return csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('epochMs'))
    .flatMap((line) => {
      const cell = line.split(',');
      const atMs = figure(cell[0]);
      const kind = cell[1] ?? '';
      if (atMs === null || kind === '') return [];
      return [kind === 'sample' ? sampleRow(atMs, cell) : eventRow(atMs, kind, cell)];
    });
}

function sampleRow(atMs: number, cell: readonly string[]): Row {
  return {
    kind: 'sample',
    atMs,
    sample: {
      thermalStatus: figure(cell[2]),
      thermalHeadroom: figure(cell[3]),
      batteryPercent: figure(cell[4]),
      batteryTempC: figure(cell[5]),
      charging: cell[6] === 'true',
      screenOn: cell[9] === 'true',
      streaming: cell[10] === 'true',
      transport: text(cell[11]),
      videoBitrate: figure(cell[12]),
      // cell[13] is detail. The delivery columns were appended after it rather than
      // inserted before it, so every positional reader of columns 1–14 kept working.
      videoFrames: figure(cell[14]),
      audioFrames: figure(cell[15]),
      srtPacketsWritten: figure(cell[16]),
      srtPacketsRetransmitted: figure(cell[17]),
      srtPacketsWriteLost: figure(cell[18]),
      srtPacketsWriteDropped: figure(cell[19]),
      srtRttMs: figure(cell[20]),
      srtSndBufMs: figure(cell[21]),
      srtFlightSizePkts: figure(cell[22]),
      srtBandwidthMbps: figure(cell[23]),
    },
  };
}

function eventRow(atMs: number, name: string, cell: readonly string[]): Row {
  return { kind: 'event', atMs, name, detail: cell[13] ?? '' };
}

/** When a pushed or tapped mark with this label landed. */
export function markAt(rows: readonly Row[], label: string): number | null {
  const hit = rows.find(
    (row) => row.kind === 'event' && row.name === 'mark' && row.detail.includes(`label=${label}`),
  );
  return hit?.atMs ?? null;
}

export function firstEventAt(rows: readonly Row[], name: string): number | null {
  return rows.find((row) => row.kind === 'event' && row.name === name)?.atMs ?? null;
}

/**
 * The windows the uplink was broken deliberately. A mark whose pair never landed
 * yields no window rather than an open-ended one: guessing an end would silently
 * excuse every later sample from criterion 1.
 */
export function outages(rows: readonly Row[]): readonly { readonly from: number; readonly to: number }[] {
  return OUTAGE_MARKS.flatMap(([open, close]) => {
    const from = markAt(rows, open);
    const to = markAt(rows, close);
    return from !== null && to !== null ? [{ from, to }] : [];
  });
}

const samplesOf = (rows: readonly Row[]) => rows.filter((row) => row.kind === 'sample');

/**
 * Criterion 1. Counted from the first `publishing` event, because the 5-minute
 * baseline is deliberately not publishing, and excluding the deliberate outages.
 * The reconnect AFTER an outage is inside the count on purpose — recovering
 * quickly is the behaviour being claimed.
 */
export function publishingShare(rows: readonly Row[]): {
  readonly publishing: number;
  readonly counted: number;
  readonly share: number | null;
} {
  const from = firstEventAt(rows, 'publishing');
  const windows = outages(rows);
  const counted = samplesOf(rows).filter(
    (row) =>
      from !== null &&
      row.atMs >= from &&
      !windows.some((window) => row.atMs >= window.from && row.atMs <= window.to),
  );
  const publishing = counted.filter((row) => row.kind === 'sample' && row.sample.streaming).length;
  return {
    publishing,
    counted: counted.length,
    share: counted.length === 0 ? null : publishing / counted.length,
  };
}

/**
 * Criterion 3, as the doc insists it be read: a rolling mean over measured
 * egress, so one zeroed sample after a reconnect is noise rather than a failure.
 * Zeros inside a window are kept — they are real readings of what was sent.
 */
export function rollingMeans(rows: readonly Row[], windowMs = 60_000): readonly number[] {
  const points = samplesOf(rows).flatMap((row) =>
    row.kind === 'sample' && row.sample.streaming && row.sample.videoBitrate !== null
      ? [{ atMs: row.atMs, bits: row.sample.videoBitrate }]
      : [],
  );
  // A sliding sum, not a window rebuilt per sample: three hours at 1 Hz is about
  // 10,800 streaming samples, and the quadratic version allocated a slice for
  // every one of them.
  const means: number[] = [];
  let start = 0;
  let sum = 0;
  let index = 0;
  for (const point of points) {
    sum += point.bits;
    while (start < index) {
      const oldest = points[start];
      if (oldest === undefined || oldest.atMs > point.atMs - windowMs) break;
      sum -= oldest.bits;
      start += 1;
    }
    if (index - start + 1 >= MIN_WINDOW_SAMPLES) means.push(sum / (index - start + 1));
    index += 1;
  }
  return means;
}

/** Nearest-rank, so a reported figure is always one that was actually measured. */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))] ?? null;
}

/** Criterion 2: the peak, and when pressure first became serious. */
export function thermalPeak(rows: readonly Row[]): {
  readonly peak: number | null;
  readonly firstAt3Ms: number | null;
} {
  const samples = samplesOf(rows).flatMap((row) =>
    row.kind === 'sample' && row.sample.thermalStatus !== null
      ? [{ atMs: row.atMs, status: row.sample.thermalStatus }]
      : [],
  );
  const peak = samples.reduce<number | null>(
    (highest, row) => (highest === null || row.status > highest ? row.status : highest),
    null,
  );
  return { peak, firstAt3Ms: samples.find((row) => row.status >= 3)?.atMs ?? null };
}

/**
 * Criterion 9, over the CHARGING rows only. The screen-off window reports
 * discharging because the driver simulates an unplug, and the handset is really
 * still powered there, so those rows say nothing about drain either way.
 */
export function batteryFloorWhileCharging(rows: readonly Row[]): number | null {
  return samplesOf(rows)
    .flatMap((row) =>
      row.kind === 'sample' && row.sample.charging && row.sample.batteryPercent !== null
        ? [row.sample.batteryPercent]
        : [],
    )
    .reduce<number | null>((lowest, value) => (lowest === null || value < lowest ? value : lowest), null);
}

/**
 * F-P5-4: a recording fell to 3–9 fps with a seventh of its audio while the app said
 * `streaming=true` at 3–4 Mbps and Cloudflare said connected. Delivery has to be read
 * in frames and packets, so these figures come from counter deltas and nothing else.
 * Frames low with SRT quiet points at capture or encode; frames steady with drops and
 * retransmits climbing points at transport.
 */
export type DeliveryMinute = {
  /** The wall-clock minute, so a row lines up with Cloudflare's and ffprobe's timelines. */
  readonly fromMs: number;
  readonly from: string;
  /** Encoded video frames handed to the endpoint, per second of real elapsed time. */
  readonly videoFps: number | null;
  readonly audioFramesPerSecond: number | null;
  readonly srtWriteDropped: number | null;
  readonly srtRetransmitted: number | null;
  readonly srtWriteLost: number | null;
  readonly rttMsP50: number | null;
  readonly rttMsMax: number | null;
};

type Counter =
  | 'videoFrames'
  | 'audioFrames'
  | 'srtPacketsWriteDropped'
  | 'srtPacketsRetransmitted'
  | 'srtPacketsWriteLost';

type SampleRow = { readonly atMs: number; readonly sample: Sample };

type Interval = {
  /** The later sample's time, which decides the minute the interval counts in. */
  readonly atMs: number;
  readonly elapsedMs: number;
  readonly before: Sample;
  readonly after: Sample;
};

const MINUTE_MS = 60_000;
const minuteOf = (atMs: number) => Math.floor(atMs / MINUTE_MS) * MINUTE_MS;
const round2 = (value: number) => Math.round(value * 100) / 100;

const sampleRows = (rows: readonly Row[]): readonly SampleRow[] =>
  rows.flatMap((row) => (row.kind === 'sample' ? [{ atMs: row.atMs, sample: row.sample }] : []));

/**
 * Two adjacent sample rows, both publishing, with time between them. A pair touching
 * a not-publishing sample is never an interval: bridging a reconnect would charge its
 * dead seconds to the frame rate, and on SRT it would subtract one socket's counters
 * from another's. Elapsed time is the rows' own clock, never one second per row — a
 * sample that failed to write leaves a two-second interval, not a missing half.
 */
function intervals(rows: readonly Row[]): readonly Interval[] {
  const samples = sampleRows(rows);
  return samples.flatMap((after, index) => {
    const before = samples[index - 1];
    if (before === undefined || !before.sample.streaming || !after.sample.streaming) return [];
    const elapsedMs = after.atMs - before.atMs;
    return elapsedMs > 0 ? [{ atMs: after.atMs, elapsedMs, before: before.sample, after: after.sample }] : [];
  });
}

/**
 * How far a cumulative counter advanced across an interval, or null when that cannot
 * be said. As with `Throughput` in SpikeTelemetry.kt, a counter that went backwards
 * was reset and never yields a negative. Unlike `Throughput`'s zero, the interval is
 * skipped: a zero here would read as starvation, which is the very thing measured.
 */
function advance(interval: Interval, counter: Counter): number | null {
  const before = interval.before[counter];
  const after = interval.after[counter];
  return before === null || after === null || after < before ? null : after - before;
}

/** Per second over only the intervals where the counter could be read. */
function rate(spans: readonly Interval[], counter: Counter): number | null {
  let count = 0;
  let elapsedMs = 0;
  for (const span of spans) {
    const advanced = advance(span, counter);
    if (advanced === null) continue;
    count += advanced;
    elapsedMs += span.elapsedMs;
  }
  return elapsedMs === 0 ? null : round2((count * 1000) / elapsedMs);
}

const sum = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0);

const present = <T>(values: readonly (T | null)[]): readonly T[] =>
  values.flatMap((value) => (value === null ? [] : [value]));

function total(spans: readonly Interval[], counter: Counter): number | null {
  return sum(present(spans.map((span) => advance(span, counter))));
}

function groupByMinute<T extends { readonly atMs: number }>(items: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const minute = minuteOf(item.atMs);
    groups.set(minute, [...(groups.get(minute) ?? []), item]);
  }
  return groups;
}

const publishingRows = (rows: readonly Row[]) => sampleRows(rows).filter((row) => row.sample.streaming);

/** One row per wall-clock minute that holds a publishing sample. */
export function deliveryMinutes(rows: readonly Row[]): readonly DeliveryMinute[] {
  const spans = groupByMinute(intervals(rows));
  const samples = groupByMinute(publishingRows(rows));
  return [...samples.keys()]
    .sort((left, right) => left - right)
    .map((fromMs) => {
      const inMinute = spans.get(fromMs) ?? [];
      const rtts = present((samples.get(fromMs) ?? []).map((row) => row.sample.srtRttMs));
      return {
        fromMs,
        from: new Date(fromMs).toISOString(),
        videoFps: rate(inMinute, 'videoFrames'),
        audioFramesPerSecond: rate(inMinute, 'audioFrames'),
        srtWriteDropped: total(inMinute, 'srtPacketsWriteDropped'),
        srtRetransmitted: total(inMinute, 'srtPacketsRetransmitted'),
        srtWriteLost: total(inMinute, 'srtPacketsWriteLost'),
        rttMsP50: percentile(rtts, 0.5),
        rttMsMax: percentile(rtts, 1),
      };
    });
}

export type Delivery = {
  readonly minutes: readonly DeliveryMinute[];
  /** Over minutes, so one slow minute is visible as the floor rather than averaged away. */
  readonly videoFps: { readonly min: number | null; readonly median: number | null };
  readonly audioFramesPerSecond: { readonly min: number | null; readonly median: number | null };
  readonly srtWriteDropped: number | null;
  readonly srtRetransmitted: number | null;
  readonly srtWriteLost: number | null;
  /** Over every publishing sample with a reading. */
  readonly rttMs: { readonly p50: number | null; readonly max: number | null };
};

export function delivery(rows: readonly Row[]): Delivery {
  const minutes = deliveryMinutes(rows);
  const across = (pick: (minute: DeliveryMinute) => number | null) => present(minutes.map(pick));
  const spread = (values: readonly number[]) => ({ min: percentile(values, 0), median: percentile(values, 0.5) });
  const rtts = present(publishingRows(rows).map((row) => row.sample.srtRttMs));
  return {
    minutes,
    videoFps: spread(across((minute) => minute.videoFps)),
    audioFramesPerSecond: spread(across((minute) => minute.audioFramesPerSecond)),
    srtWriteDropped: sum(across((minute) => minute.srtWriteDropped)),
    srtRetransmitted: sum(across((minute) => minute.srtRetransmitted)),
    srtWriteLost: sum(across((minute) => minute.srtWriteLost)),
    rttMs: { p50: percentile(rtts, 0.5), max: percentile(rtts, 1) },
  };
}

export type Summary = {
  readonly samples: number;
  readonly criterion1: ReturnType<typeof publishingShare>;
  readonly bitrateKbps: {
    readonly min: number | null;
    readonly median: number | null;
    readonly p5: number | null;
  };
  readonly thermal: ReturnType<typeof thermalPeak>;
  readonly batteryFloorCharging: number | null;
  readonly delivery: Delivery;
};

export function summarise(csv: string): Summary {
  const rows = parseRows(csv);
  const means = rollingMeans(rows).map((bits) => bits / 1000);
  return {
    samples: samplesOf(rows).length,
    criterion1: publishingShare(rows),
    bitrateKbps: {
      min: percentile(means, 0),
      median: percentile(means, 0.5),
      p5: percentile(means, 0.05),
    },
    thermal: thermalPeak(rows),
    batteryFloorCharging: batteryFloorWhileCharging(rows),
    delivery: delivery(rows),
  };
}
