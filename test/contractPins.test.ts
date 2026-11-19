import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listFiles, OURS } from '../scripts/vendor-contracts.mjs';

/**
 * The pin (plan D spec §3.1, owner ruling R7: pin only, verified offline, never a fetch of the web repo).
 *
 * contracts/ is a byte copy of the web's capture contracts (docs/contracts, the phone's files only: plan D spec §3.1) at
 * one commit, written by `pnpm contracts:vendor`, which records every file's sha256 in contracts/VENDORED.json. This
 * test holds the folder to that record, file for file.
 *
 * The other side of the pin is the web's own: its capture-contract.test.ts pins the ten schemas. Those ten values
 * and the commit are copied below BY HAND from apps/web/src/server/api-v1/__tests__/capture-contract.test.ts:51-67,
 * so a re-vendor cannot quietly move both sides at once. WEB_COMMIT is the commit actually vendored (plan D1, D-10).
 *
 * The commit is 1cec787a09, web main's merge of PR #1265 (the court device check of 2026-11-19): the beat's
 * `$defs.refusal` with 426 `app_outdated` (a court claim from a build below the server's court minimum), the word on
 * the shared refusal list of the descriptor, start and scoring-link contracts, and the waiting answer's `autoRefusal`
 * word `match_stopped` on the beat and the descriptor; three fixtures. Before it, a74084cdec, web main's merge of PR
 * #1247 (a court's refused automatic start on the phone, E2, 2026-11-17): the waiting answer's optional `autoRefusal`
 * word on the beat and the descriptor, omitted and never null; six fixtures with it. Before it, c0577abb7, web main's merge of PR #1235 (court stream, spec 2026-11-14): the
 * descriptor's optional `court {name}`, the beat answer's optional `next {label, scheduledStart}`, the scoring link's
 * `ok.label`, the `no_match` refusal on scoring-link and start, and a court code's QR `exp`; ten fixtures with them. Before it,
 * a976b266c, web main with PR #1217 merged (a called match is the court's `now`; the candidate's `first_in_queue`).
 * Before it, 1f27d2f77, the tip of PR #1217's branch. Before it, 1e8dc1deb, web main's merge of PR #1212, which added the candidate's `called` to
 * capture-matchday-call.v1. Before it, web PR #1207 (merged as 3ec69fc71) added the day
 * read's `round_tag`, `home_slot`, `away_slot`, the approval's `waiting` and the code's `can_call`, and the call
 * contract (capture-matchday-call.v1: candidates, preview, call, Undo). Before it, 81c0446cc (web main, MD-1
 * merged as #1140; Task 6 added the approval review and approve, capture-matchday-approval.v1, with its fixtures,
 * reworded the day read's and the open's descriptions, and made the row summary the desk's short score, "1–1 · 14–9");
 * the six before them are as web #1037 left them.
 *
 * relay-job.v1 sits beside them and is not the phone's: the script takes only the capture contracts.
 */
const WEB_COMMIT = '1cec787a097da970cff69641919adfa0214e2c4e';
const WEB_PINS: Readonly<Record<string, string>> = {
  'capture-qr.v2.json': '0943072e30489dad04822cf266cc62d4e004e3a2ef46fe20e712a274ae272fbe',
  'capture-descriptor.v1.json': '308d58807d3b3754ccf5b400c18827d09ffb5dd0177aaed7d10b31b307c027f4',
  'capture-beat.v1.json': '2909429a2dba925d18fdddc357c9a8e393d7c5ef25156fb7f13f375e8daa7e87',
  'capture-start.v1.json': '46162c64e4b9e0da3f17a571103c3ba7e3e9e972997367c916bf7f6ea8e08778',
  'capture-scoring-link.v1.json':
    'daa81ed4f907545f0fb1a8265d11011fab3b90a52d880dda8e3839f7651b5032',
  'capture-record.v1.json': '213f766043b7682f198cc98da13e93995b6602e46533ecf60c78bf562aebd6f8',
  'capture-matchday-day.v1.json':
    '283a252050a42618752803baead43e18df6822a9e23588f80e04e5ebecd46332',
  'capture-matchday-open.v1.json':
    '760028bf99e5cf74ee033f5613fa43477677cef318ecdf739c0b62e2fc21c0c0',
  'capture-matchday-approval.v1.json':
    '279ff1488a1108b3667f9e2f11f559579382f83b238d91da65440c810189f69c',
  'capture-matchday-call.v1.json':
    '7399e140267a75443b6576e493ef446c84f89922c20f02e8d4b08854f87df1c8',
};

const root = new URL('../contracts/', import.meta.url);
/** Hashed here with node:crypto, not with the script's helper: the check does not lean on what wrote the record. */
const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(new URL(path, root)))
    .digest('hex');
const vendored = JSON.parse(readFileSync(new URL('VENDORED.json', root), 'utf8')) as {
  readonly web: string;
  readonly files: Readonly<Record<string, string>>;
};
const onDisk = listFiles(fileURLToPath(root)).filter((path) => !OURS.includes(path));

describe('the vendored contracts, pinned (plan D spec §3.1, R7)', () => {
  it('pins 297 files: the ten schemas and 287 fixtures (moves only with a re-vendor)', () => {
    const pinned = Object.keys(vendored.files);
    expect(pinned).toHaveLength(297);
    expect(pinned.filter((path) => !path.includes('/'))).toHaveLength(10);
  });

  it('holds exactly the pinned files: none missing, none extra', () => {
    expect(onDisk).toEqual(Object.keys(vendored.files).sort());
  });

  it.each(Object.entries(vendored.files))('%s is byte for byte its pin', (path, pin) => {
    expect(sha256(path)).toBe(pin);
  });

  it('is the web commit this test names', () => {
    expect(vendored.web).toBe(WEB_COMMIT);
  });

  it.each(Object.entries(WEB_PINS))(
    "%s: the web's own pin, VENDORED.json's and the file agree",
    (file, web) => {
      expect(vendored.files[file]).toBe(web);
      expect(sha256(file)).toBe(web);
    },
  );

  it('holds the same ten schemas the web pins, no more and no fewer', () => {
    expect(onDisk.filter((path) => !path.includes('/'))).toEqual(Object.keys(WEB_PINS).sort());
  });
});
