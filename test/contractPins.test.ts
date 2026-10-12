import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listFiles, OURS } from '../scripts/vendor-contracts.mjs';

/**
 * The pin (plan D spec §3.1, owner ruling R7: pin only, verified offline, never a fetch of the web repo).
 *
 * contracts/ is a byte copy of the web's docs/contracts at one commit, written by `pnpm contracts:vendor`, which
 * records every file's sha256 in contracts/VENDORED.json. This test holds the folder to that record, file for file.
 *
 * The other side of the pin is the web's own: its capture-contract.test.ts pins the six schemas. Those six values
 * and the commit are copied below BY HAND from apps/web/src/server/api-v1/__tests__/capture-contract.test.ts:51-56
 * at 53f28ebfc (web #941, merged 2026-10-12, which added the record contract; the script never writes them), so a
 * re-vendor cannot quietly move both sides at once. WEB_COMMIT is the commit actually vendored (plan D1, D-10).
 */
const WEB_COMMIT = '53f28ebfcaaece1409499be799156f6ed825851c';
const WEB_PINS: Readonly<Record<string, string>> = {
  'capture-qr.v2.json': '3292e33f84b693e5def6048012f6653ca7e31e1573fda3901da4fe67a62c5d43',
  'capture-descriptor.v1.json': '5c9b09c422b092671ad3a842b02e5c18902c92fc290cbc562c91033555955b8b',
  'capture-beat.v1.json': 'e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736',
  'capture-start.v1.json': '012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae',
  'capture-scoring-link.v1.json':
    'f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f',
  'capture-record.v1.json': '09582e858547dde50c43c9e5e2fff0d77d547716a5117787848b4dbe967a4745',
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
  it('pins 197 files: the six schemas and 191 fixtures (moves only with a re-vendor)', () => {
    const pinned = Object.keys(vendored.files);
    expect(pinned).toHaveLength(197);
    expect(pinned.filter((path) => !path.includes('/'))).toHaveLength(6);
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

  it('holds the same six schemas the web pins, no more and no fewer', () => {
    expect(onDisk.filter((path) => !path.includes('/'))).toEqual(Object.keys(WEB_PINS).sort());
  });
});
