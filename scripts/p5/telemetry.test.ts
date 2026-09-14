import { describe, expect, it } from 'vitest';
import {
  batteryFloorWhileCharging,
  deliveryMinutes,
  markAt,
  outages,
  parseRows,
  percentile,
  publishingShare,
  rollingMeans,
  summarise,
  thermalPeak,
} from './telemetry.ts';

const HEADER =
  'epochMs,kind,thermalStatus,thermalHeadroom,batteryPercent,batteryTempC,charging,currentMicroAmps,network,screenOn,streaming,transport,videoBitrate,detail,videoFrames,audioFrames,srtPacketsWritten,srtPacketsRetransmitted,srtPacketsWriteLost,srtPacketsWriteDropped,srtRttMs,srtSndBufMs,srtFlightSizePkts,srtBandwidthMbps,videoTargetBitrate';

type Cell = number | string;

/** The delivery columns, blank unless a test sets them: a missing counter is not a zero. */
type Delivery = {
  videoFrames?: Cell;
  audioFrames?: Cell;
  srtWritten?: Cell;
  srtRetransmitted?: Cell;
  srtLost?: Cell;
  srtDropped?: Cell;
  rttMs?: Cell;
  sndBufMs?: Cell;
  flight?: Cell;
  bandwidth?: Cell;
  /** Column 25: the regulator's video target (F-P5-5). */
  target?: Cell;
};

/** A sample row in the real column order, so a reordering breaks the tests. */
const sample = (
  atMs: number,
  options: {
    thermal?: number | string;
    battery?: number | string;
    charging?: boolean;
    network?: string;
    streaming?: boolean;
    bitrate?: number | string;
  } & Delivery = {},
) =>
  [
    atMs,
    'sample',
    options.thermal ?? 0,
    0.5,
    options.battery ?? 80,
    33.0,
    options.charging ?? true,
    100,
    options.network ?? 'cellular',
    true,
    options.streaming ?? true,
    options.streaming === false ? '' : 'srt',
    options.bitrate ?? 3_200_000,
    '',
    options.videoFrames ?? '',
    options.audioFrames ?? '',
    options.srtWritten ?? '',
    options.srtRetransmitted ?? '',
    options.srtLost ?? '',
    options.srtDropped ?? '',
    options.rttMs ?? '',
    options.sndBufMs ?? '',
    options.flight ?? '',
    options.bandwidth ?? '',
    options.target ?? '',
  ].join(',');

const event = (atMs: number, name: string, detail = '') =>
  [atMs, name, '', '', '', '', '', '', '', '', '', '', '', detail, '', '', '', '', '', '', '', '', '', '', ''].join(',');

/** A minute boundary on the wall clock, so bucketing is exact. */
const MINUTE_0 = 1_789_200_000_000;

/** `count` streaming samples at 1 Hz, so a window test runs at the real cadence. */
const hz = (count: number, bitrate: (index: number) => number, fromMs = 0) =>
  Array.from({ length: count }, (_, index) =>
    sample(fromMs + index * 1000, { bitrate: bitrate(index) }),
  );

describe('parseRows', () => {
  it('reads samples and events, and skips the header', () => {
    const rows = parseRows([HEADER, event(1, 'publishing', 'transport=srt'), sample(2)].join('\n'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'event', name: 'publishing' });
    expect(rows[1]).toMatchObject({ kind: 'sample', atMs: 2 });
  });

  it('reads an empty cell as missing, never as zero', () => {
    const rows = parseRows([HEADER, sample(1, { bitrate: '', battery: '' })].join('\n'));
    const row = rows[0];
    expect(row?.kind === 'sample' && row.sample.videoBitrate).toBeNull();
    expect(row?.kind === 'sample' && row.sample.batteryPercent).toBeNull();
  });

  it('reads a NaN headroom as missing rather than throwing', () => {
    const rows = parseRows([HEADER, [2, 'sample', 0, 'NaN', 80, 33, true, 1, 'cellular', true, true, 'srt', 1, ''].join(',')].join('\n'));
    const row = rows[0];
    expect(row?.kind === 'sample' && row.sample.thermalHeadroom).toBeNull();
  });
});

describe('parseRows — delivery columns (F-P5-4)', () => {
  it('reads the frame and SRT columns that follow detail', () => {
    const row = parseRows(
      [
        HEADER,
        sample(1, {
          videoFrames: 900,
          audioFrames: 1406,
          srtWritten: 5000,
          srtRetransmitted: 12,
          srtLost: 3,
          srtDropped: 1,
          rttMs: 48.5,
          sndBufMs: 120,
          flight: 40,
          bandwidth: 18.96,
        }),
      ].join('\n'),
    )[0];
    expect(row?.kind === 'sample' && row.sample).toMatchObject({
      videoFrames: 900,
      audioFrames: 1406,
      srtPacketsWritten: 5000,
      srtPacketsRetransmitted: 12,
      srtPacketsWriteLost: 3,
      srtPacketsWriteDropped: 1,
      srtRttMs: 48.5,
      srtSndBufMs: 120,
      srtFlightSizePkts: 40,
      srtBandwidthMbps: 18.96,
      // The old columns keep their positions.
      videoBitrate: 3_200_000,
      transport: 'srt',
    });
  });

  it('reads a row written before the delivery columns existed as missing, not zero', () => {
    const old = [2, 'sample', 0, 0.5, 80, 33, true, 1, 'cellular', true, true, 'srt', 1, ''].join(',');
    const row = parseRows([HEADER, old].join('\n'))[0];
    expect(row?.kind === 'sample' && row.sample.videoFrames).toBeNull();
    expect(row?.kind === 'sample' && row.sample.srtPacketsWriteDropped).toBeNull();
    expect(row?.kind === 'sample' && row.sample.srtRttMs).toBeNull();
  });

  it('keeps an event detail in its own column when delivery columns follow it', () => {
    const row = parseRows([HEADER, event(3, 'previous-exit', 'reason=signaled description=a;b')].join('\n'))[0];
    expect(row).toMatchObject({ kind: 'event', name: 'previous-exit', detail: 'reason=signaled description=a;b' });
  });
});

describe('deliveryMinutes — frames and SRT counters per minute (F-P5-4)', () => {
  it('computes frame rates from counter deltas over real elapsed time, not over sample count', () => {
    // Uneven ticks: 1.0 s then 1.5 s. Assuming one second per sample would say 37.5 fps.
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { videoFrames: 0, audioFrames: 0 }),
        sample(MINUTE_0 + 1000, { videoFrames: 30, audioFrames: 47 }),
        sample(MINUTE_0 + 2500, { videoFrames: 75, audioFrames: 118 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)).toEqual([
      expect.objectContaining({
        fromMs: MINUTE_0,
        from: new Date(MINUTE_0).toISOString(),
        videoFps: 30,
        audioFramesPerSecond: 47.2,
      }),
    ]);
  });

  it('skips an interval whose counter went backwards, rather than reading a reset as starvation', () => {
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { videoFrames: 0 }),
        sample(MINUTE_0 + 1000, { videoFrames: 30 }),
        sample(MINUTE_0 + 2000, { videoFrames: 5 }),
        sample(MINUTE_0 + 3000, { videoFrames: 35 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]?.videoFps).toBe(30);
  });

  it('never bridges a gap: an interval touching a not-publishing sample is skipped', () => {
    // Bridging 1 s → 4 s would add 10 frames over 3 s and drag the minute down to 14 fps.
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { videoFrames: 0 }),
        sample(MINUTE_0 + 1000, { videoFrames: 30 }),
        sample(MINUTE_0 + 2000, { videoFrames: 30, streaming: false }),
        sample(MINUTE_0 + 3000, { videoFrames: 30, streaming: false }),
        sample(MINUTE_0 + 4000, { videoFrames: 40 }),
        sample(MINUTE_0 + 5000, { videoFrames: 70 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]?.videoFps).toBe(30);
  });

  it('sums SRT drops, retransmits and losses from counter deltas', () => {
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { srtDropped: 0, srtRetransmitted: 10, srtLost: 1 }),
        sample(MINUTE_0 + 1000, { srtDropped: 2, srtRetransmitted: 14, srtLost: 1 }),
        sample(MINUTE_0 + 2000, { srtDropped: 5, srtRetransmitted: 20, srtLost: 3 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]).toMatchObject({ srtWriteDropped: 5, srtRetransmitted: 10, srtWriteLost: 2 });
  });

  it('leaves SRT figures missing, never zero, when no SRT counter was published', () => {
    // An RTMPS minute: frames are counted, SRT has nothing to say.
    const rows = parseRows(
      [HEADER, sample(MINUTE_0, { videoFrames: 0 }), sample(MINUTE_0 + 1000, { videoFrames: 30 })].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]).toMatchObject({
      videoFps: 30,
      audioFramesPerSecond: null,
      srtWriteDropped: null,
      srtRetransmitted: null,
      srtWriteLost: null,
      rttMsP50: null,
      rttMsMax: null,
    });
  });

  it('reports RTT p50 and max over the publishing samples of each minute', () => {
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { rttMs: 40 }),
        sample(MINUTE_0 + 1000, { rttMs: 60 }),
        sample(MINUTE_0 + 2000, { rttMs: 999, streaming: false }),
        sample(MINUTE_0 + 3000, { rttMs: 50 }),
        sample(MINUTE_0 + 4000, { rttMs: 300 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]).toMatchObject({ rttMsP50: 50, rttMsMax: 300 });
  });

  it('buckets by wall-clock minute, giving an interval to the minute of its later sample', () => {
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0 + 58_000, { videoFrames: 0 }),
        sample(MINUTE_0 + 59_000, { videoFrames: 30 }),
        sample(MINUTE_0 + 60_000, { videoFrames: 90 }),
        sample(MINUTE_0 + 61_000, { videoFrames: 120 }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows).map((minute) => [minute.fromMs, minute.videoFps])).toEqual([
      [MINUTE_0, 30],
      [MINUTE_0 + 60_000, 45],
    ]);
  });
});

describe('marks and outages', () => {
  it('finds a mark by label', () => {
    const rows = parseRows([HEADER, event(50, 'mark', 'label=mark-4')].join('\n'));
    expect(markAt(rows, 'mark-4')).toBe(50);
    expect(markAt(rows, 'mark-5')).toBeNull();
  });

  it('yields no window when a mark has no pair — an open window would excuse every later sample', () => {
    const rows = parseRows([HEADER, event(50, 'mark', 'label=mark-4')].join('\n'));
    expect(outages(rows)).toEqual([]);
  });

  it('pairs both deliberate outages', () => {
    const rows = parseRows(
      [
        HEADER,
        event(10, 'mark', 'label=mark-4'),
        event(20, 'mark', 'label=mark-5'),
        event(30, 'mark', 'label=mark-8'),
        event(40, 'mark', 'label=mark-9'),
      ].join('\n'),
    );
    expect(outages(rows)).toEqual([
      { from: 10, to: 20 },
      { from: 30, to: 40 },
    ]);
  });
});

describe('publishingShare — criterion 1', () => {
  it('ignores the baseline before the first publishing event', () => {
    const rows = parseRows(
      [HEADER, sample(1, { streaming: false }), event(2, 'publishing'), sample(3)].join('\n'),
    );
    expect(publishingShare(rows)).toEqual({ publishing: 1, counted: 1, share: 1 });
  });

  it('excludes samples inside a deliberate outage', () => {
    const rows = parseRows(
      [
        HEADER,
        event(1, 'publishing'),
        sample(2),
        event(3, 'mark', 'label=mark-4'),
        sample(4, { streaming: false }),
        event(5, 'mark', 'label=mark-5'),
        sample(6),
      ].join('\n'),
    );
    expect(publishingShare(rows)).toEqual({ publishing: 2, counted: 2, share: 1 });
  });

  it('counts a not-publishing sample outside any outage against the run', () => {
    const rows = parseRows(
      [HEADER, event(1, 'publishing'), sample(2), sample(3, { streaming: false })].join('\n'),
    );
    expect(publishingShare(rows).share).toBe(0.5);
  });

  it('counts a network=none row as publishing when streaming is true', () => {
    // The column reads `none` whenever ConnectivityManager answers null; reading
    // it as an outage log would fail a healthy run.
    const rows = parseRows(
      [HEADER, event(1, 'publishing'), sample(2, { network: 'none', streaming: true })].join('\n'),
    );
    expect(publishingShare(rows).share).toBe(1);
  });
});

describe('rollingMeans and percentile — criterion 3', () => {
  it('reports nothing until the window holds enough readings', () => {
    expect(rollingMeans(parseRows([HEADER, ...hz(29, () => 4_000_000)].join('\n')))).toEqual([]);
  });

  it('reports one mean per sample once the window is established', () => {
    const means = rollingMeans(parseRows([HEADER, ...hz(90, () => 4_000_000)].join('\n')));
    expect(means).toHaveLength(61);
    expect(new Set(means)).toEqual(new Set([4_000_000]));
  });

  it('drops a reading that has left the window', () => {
    // The first 60 samples are slow; by the last sample they are all outside it.
    const slowThenFast = (index: number) => (index < 60 ? 2_000_000 : 4_000_000);
    const means = rollingMeans(parseRows([HEADER, ...hz(120, slowThenFast)].join('\n')));
    expect(means.at(-1)).toBe(4_000_000);
  });

  it('smooths a zeroed reading rather than reporting it as a sag', () => {
    const lastIsZero = (index: number) => (index === 59 ? 0 : 4_000_000);
    const last = rollingMeans(parseRows([HEADER, ...hz(60, lastIsZero)].join('\n'))).at(-1) ?? 0;
    expect(last).toBeGreaterThan(3_900_000);
    expect(last).toBeLessThan(4_000_000);
  });

  /**
   * Run A's own first streaming sample reads 0, because the endpoint counter is
   * still being established. Reported as the run's minimum it fails criterion 3
   * on a perfectly healthy run, which is what the first version of this file did
   * against the real CSV — min 0 beside a median of 4179 kbps.
   */
  it('does not let the startup zero become the reported minimum', () => {
    const firstIsZero = (index: number) => (index === 0 ? 0 : 4_000_000);
    const means = rollingMeans(parseRows([HEADER, ...hz(90, firstIsZero)].join('\n')));
    expect(percentile(means, 0)).toBeGreaterThan(3_500_000);
  });

  it('reports a percentile that was actually measured', () => {
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('thermalPeak — criterion 2', () => {
  it('reports the peak and when pressure first reached 3', () => {
    const rows = parseRows(
      [HEADER, sample(1, { thermal: 1 }), sample(2, { thermal: 3 }), sample(3, { thermal: 2 })].join('\n'),
    );
    expect(thermalPeak(rows)).toEqual({ peak: 3, firstAt3Ms: 2 });
  });

  it('reports no minute when it never reached 3', () => {
    const rows = parseRows([HEADER, sample(1, { thermal: 2 })].join('\n'));
    expect(thermalPeak(rows)).toEqual({ peak: 2, firstAt3Ms: null });
  });
});

describe('batteryFloorWhileCharging — criterion 9', () => {
  it('ignores the simulated-unplug rows, which say nothing about drain', () => {
    const rows = parseRows(
      [HEADER, sample(1, { battery: 60 }), sample(2, { battery: 20, charging: false })].join('\n'),
    );
    expect(batteryFloorWhileCharging(rows)).toBe(60);
  });
});

describe('summarise', () => {
  it('returns every criterion figure from one pass', () => {
    const csv = [HEADER, event(0, 'publishing'), ...hz(40, () => 3_200_000, 1000)].join('\n');
    expect(summarise(csv)).toMatchObject({
      samples: 40,
      criterion1: { publishing: 40, counted: 40, share: 1 },
      bitrateKbps: { min: 3200, median: 3200, p5: 3200 },
      thermal: { peak: 0, firstAt3Ms: null },
      batteryFloorCharging: 80,
    });
  });

  it('reports delivery across minutes: frame-rate floor and median, SRT totals, RTT', () => {
    // Minute 0 at 30 fps, minute 1 starved to 6 fps — the F-P5-4 shape. Samples are
    // contiguous at 1 Hz, so the 59 s → 60 s interval belongs to minute 1.
    const csv = [
      HEADER,
      sample(MINUTE_0 + 58_000, { videoFrames: 0, audioFrames: 0, srtDropped: 0, srtRetransmitted: 0, srtLost: 0, rttMs: 40 }),
      sample(MINUTE_0 + 59_000, { videoFrames: 30, audioFrames: 47, srtDropped: 1, srtRetransmitted: 4, srtLost: 1, rttMs: 60 }),
      sample(MINUTE_0 + 60_000, { videoFrames: 36, audioFrames: 54, srtDropped: 5, srtRetransmitted: 20, srtLost: 4, rttMs: 500 }),
      sample(MINUTE_0 + 61_000, { videoFrames: 42, audioFrames: 61, srtDropped: 9, srtRetransmitted: 40, srtLost: 7, rttMs: 700 }),
    ].join('\n');
    expect(summarise(csv).delivery).toMatchObject({
      videoFps: { min: 6, median: 6 },
      audioFramesPerSecond: { min: 7, median: 7 },
      srtWriteDropped: 9,
      srtRetransmitted: 40,
      srtWriteLost: 7,
      rttMs: { p50: 60, max: 700 },
    });
    expect(summarise(csv).delivery.minutes).toHaveLength(2);
  });
});

describe('the regulator target — column 25 (F-P5-5)', () => {
  it('reads the target that follows the delivery columns, and a blank as no regulator', () => {
    const rows = parseRows([HEADER, sample(1, { target: 1_500_000 }), sample(2)].join('\n'));
    expect(rows[0]?.kind === 'sample' && rows[0].sample.videoTargetBitrate).toBe(1_500_000);
    expect(rows[1]?.kind === 'sample' && rows[1].sample.videoTargetBitrate).toBeNull();
  });

  it('reads a row written before the regulator existed as no target, not zero', () => {
    const before = sample(1, { videoFrames: 900 }).split(',').slice(0, 24).join(',');
    const row = parseRows([HEADER, before].join('\n'))[0];
    expect(row?.kind === 'sample' && row.sample.videoTargetBitrate).toBeNull();
    expect(row?.kind === 'sample' && row.sample.videoFrames).toBe(900);
  });

  it('puts the target min and median beside median egress, per minute, over publishing samples', () => {
    const rows = parseRows(
      [
        HEADER,
        sample(MINUTE_0, { bitrate: 4_400_000, target: 3_000_000 }),
        sample(MINUTE_0 + 1000, { bitrate: 4_500_000, target: 1_500_000 }),
        sample(MINUTE_0 + 2000, { bitrate: 1_600_000, target: 750_000 }),
        sample(MINUTE_0 + 3000, { bitrate: 0, target: 1, streaming: false }),
      ].join('\n'),
    );
    expect(deliveryMinutes(rows)[0]).toMatchObject({
      egressBpsMedian: 4_400_000,
      videoTargetBpsMin: 750_000,
      videoTargetBpsMedian: 1_500_000,
    });
  });

  it('leaves the target missing, never zero, in a minute no regulator was in force', () => {
    const rows = parseRows([HEADER, sample(MINUTE_0), sample(MINUTE_0 + 1000)].join('\n'));
    expect(deliveryMinutes(rows)[0]).toMatchObject({
      egressBpsMedian: 3_200_000,
      videoTargetBpsMin: null,
      videoTargetBpsMedian: null,
    });
  });

  it('reports the target floor and median across the run', () => {
    const csv = [
      HEADER,
      sample(MINUTE_0, { target: 3_000_000 }),
      sample(MINUTE_0 + 60_000, { target: 500_000 }),
      sample(MINUTE_0 + 61_000, { target: 750_000 }),
    ].join('\n');
    expect(summarise(csv).delivery.videoTargetBps).toEqual({ min: 500_000, median: 750_000 });
  });
});
