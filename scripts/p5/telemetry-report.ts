/**
 * Prints a run's criteria figures from its telemetry CSV, as one JSON document.
 *
 *   node scripts/p5/telemetry-report.ts .p5/device/p5-<epochMs>.csv
 *
 * `delivery` answers F-P5-4 over publishing samples: per wall-clock minute, video fps
 * and audio frames/s from counter deltas over real elapsed time, SRT write drops,
 * retransmits and losses, and RTT p50/max — then the run's floor, median and totals.
 * On a CSV written before the delivery columns existed every figure there is null.
 *
 * Separate from `telemetry.ts` so that module stays pure and importable: a CLI
 * in the same file would run on every test import.
 */
import { readFileSync } from 'node:fs';
import { summarise } from './telemetry.ts';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: telemetry-report.ts <csvPath>');
  process.exit(1);
}

const summary = summarise(readFileSync(path, 'utf8'));
console.log(JSON.stringify(summary, null, 2));
