/**
 * Prints a run's criteria figures from its telemetry CSV.
 *
 *   node scripts/p5/telemetry-report.ts .p5/device/p5-<epochMs>.csv
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
