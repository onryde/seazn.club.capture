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
 * and the commit are copied below BY HAND from apps/web/src/server/api-v1/__tests__/capture-contract.test.ts:51-64,
 * so a re-vendor cannot quietly move both sides at once. WEB_COMMIT is the commit actually vendored (plan D1, D-10).
 *
 * The commit is 1e8dc1deb, web main's merge of PR #1212, which added the candidate's `called` to
 * capture-matchday-call.v1. Before it, web PR #1207 (merged as 3ec69fc71) added the day
 * read's `round_tag`, `home_slot`, `away_slot`, the approval's `waiting` and the code's `can_call`, and the call
 * contract (capture-matchday-call.v1: candidates, preview, call, Undo). Before it, 81c0446cc (web main, MD-1
 * merged as #1140; Task 6 added the approval review and approve, capture-matchday-approval.v1, with its fixtures,
 * reworded the day read's and the open's descriptions, and made the row summary the desk's short score, "1–1 · 14–9");
 * the six before them are as web #1037 left them.
 *
 * relay-job.v1 sits beside them and is not the phone's: the script takes only the capture contracts.
 */
const WEB_COMMIT = '1e8dc1deb3ad8b3c43a1f62495070b18aacd2469';
const WEB_PINS: Readonly<Record<string, string>> = {
  'capture-qr.v2.json': '3292e33f84b693e5def6048012f6653ca7e31e1573fda3901da4fe67a62c5d43',
  'capture-descriptor.v1.json': '5c9b09c422b092671ad3a842b02e5c18902c92fc290cbc562c91033555955b8b',
  'capture-beat.v1.json': 'e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736',
  'capture-start.v1.json': '012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae',
  'capture-scoring-link.v1.json':
    'f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f',
  'capture-record.v1.json': '213f766043b7682f198cc98da13e93995b6602e46533ecf60c78bf562aebd6f8',
  'capture-matchday-day.v1.json':
    '44b5fd9ae752df510a1c3a1eb464d05678ed726a6f9b84cce5b0a4a1aa166c4e',
  'capture-matchday-open.v1.json':
    '760028bf99e5cf74ee033f5613fa43477677cef318ecdf739c0b62e2fc21c0c0',
  'capture-matchday-approval.v1.json':
    '279ff1488a1108b3667f9e2f11f559579382f83b238d91da65440c810189f69c',
  'capture-matchday-call.v1.json':
    '208749ecae47072ea17fbfa8fb4c4b84de49aa2831bc817aa0a9af79d2dc003b',
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
  it('pins 278 files: the ten schemas and 268 fixtures (moves only with a re-vendor)', () => {
    const pinned = Object.keys(vendored.files);
    expect(pinned).toHaveLength(278);
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
