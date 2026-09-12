import { describe, expect, it } from 'vitest';
import {
  batteryFloorWhileCharging,
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
  'epochMs,kind,thermalStatus,thermalHeadroom,batteryPercent,batteryTempC,charging,currentMicroAmps,network,screenOn,streaming,transport,videoBitrate,detail';

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
  } = {},
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
  ].join(',');

const event = (atMs: number, name: string, detail = '') =>
  [atMs, name, '', '', '', '', '', '', '', '', '', '', '', detail].join(',');

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
});
