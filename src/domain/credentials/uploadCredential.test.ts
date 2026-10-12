import { describe, expect, it } from 'vitest';
import {
  decodeCredential,
  encodeCredential,
  KEEP_AFTER_DROP_MS,
  nextCredential,
  UNREADABLE,
  usableCredential,
  type UploadCredential,
} from '@/domain/credentials/uploadCredential';

// Made-up values (AGENTS §13): a code URL and a token of the QR's shape, belonging to nothing.
const saved = {
  codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/abcdefghjkmn',
  token: 'AAAAAAAAAAAAAAAAAAAAAA',
};
const kept: UploadCredential = { ...saved, expiresAtMs: null };
const NOW = 1_790_000_000_000;

describe('the upload credential (R4)', () => {
  it('is written from the saved code, with no expiry while the code is saved', () => {
    expect(nextCredential(null, saved, NOW)).toEqual({ kind: 'write', credential: kept });
  });

  it('is left alone when it already matches (a second call)', () => {
    expect(nextCredential(kept, saved, NOW)).toEqual({ kind: 'keep' });
  });

  it('is renewed by a new code', () => {
    const next = { ...saved, token: 'BBBBBBBBBBBBBBBBBBBBBB' };
    expect(nextCredential(kept, next, NOW)).toEqual({
      kind: 'write',
      credential: { ...next, expiresAtMs: null },
    });
  });

  it('is renewed by a code at another URL with the same token', () => {
    const next = { ...saved, codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/zzzzzzzzzzzz' };
    expect(nextCredential(kept, next, NOW)).toEqual({
      kind: 'write',
      credential: { ...next, expiresAtMs: null },
    });
  });

  it('loses its expiry when the same code is saved again inside the 24 h', () => {
    const dropped = { ...kept, expiresAtMs: NOW + 1000 };
    expect(nextCredential(dropped, saved, NOW)).toEqual({ kind: 'write', credential: kept });
  });

  it('keeps 24 h from the moment its code is dropped', () => {
    expect(KEEP_AFTER_DROP_MS).toBe(24 * 60 * 60 * 1000);
    expect(nextCredential(kept, null, NOW)).toEqual({
      kind: 'write',
      credential: { ...kept, expiresAtMs: NOW + KEEP_AFTER_DROP_MS },
    });
  });

  it('is kept as it is while its 24 h run (the clock is not restarted)', () => {
    const dropped = { ...kept, expiresAtMs: NOW + 1 };
    expect(nextCredential(dropped, null, NOW)).toEqual({ kind: 'keep' });
    expect(usableCredential(dropped, NOW)).toEqual(dropped);
  });

  it('is deleted once the 24 h are over, and is not usable from that moment', () => {
    const dropped = { ...kept, expiresAtMs: NOW };
    expect(nextCredential(dropped, null, NOW)).toEqual({ kind: 'delete' });
    expect(usableCredential(dropped, NOW)).toBeNull();
    expect(usableCredential(dropped, NOW - 1)).toEqual(dropped);
  });

  // Minor 4 of the Batch 6 review: a clock set back after the drop must not stretch the 24 h.
  it('is deleted, and not usable, when its expiry is further off than 24 h (a clock set back)', () => {
    const stretched = { ...kept, expiresAtMs: NOW + KEEP_AFTER_DROP_MS + 1 };
    expect(nextCredential(stretched, null, NOW)).toEqual({ kind: 'delete' });
    expect(usableCredential(stretched, NOW)).toBeNull();
    const full = { ...kept, expiresAtMs: NOW + KEEP_AFTER_DROP_MS };
    expect(nextCredential(full, null, NOW)).toEqual({ kind: 'keep' });
    expect(usableCredential(full, NOW)).toEqual(full);
  });

  // Minor 6 of the Batch 6 review: text that is no credential may still hold a token, in a foreign or future shape.
  it('deletes a stored value it cannot read when no code is saved, and overwrites it when one is', () => {
    expect(nextCredential(UNREADABLE, null, NOW)).toEqual({ kind: 'delete' });
    expect(nextCredential(UNREADABLE, saved, NOW)).toEqual({ kind: 'write', credential: kept });
  });

  it('is usable with no expiry, whatever the clock says', () => {
    expect(usableCredential(kept, Number.MAX_SAFE_INTEGER)).toEqual(kept);
  });

  it('is nothing when nothing was ever saved (an empty input)', () => {
    expect(nextCredential(null, null, NOW)).toEqual({ kind: 'keep' });
    expect(usableCredential(null, NOW)).toBeNull();
  });

  it('round-trips, kept and dropped', () => {
    expect(decodeCredential(encodeCredential(kept))).toEqual(kept);
    const dropped = { ...kept, expiresAtMs: NOW + KEEP_AFTER_DROP_MS };
    expect(decodeCredential(encodeCredential(dropped))).toEqual(dropped);
  });

  it.each([
    ['empty', ''],
    ['not JSON', '{'],
    ['not an object', '42'],
    ['null', 'null'],
    ['another version', JSON.stringify({ ...kept, v: 2 })],
    ['no version', JSON.stringify(kept)],
    ['a URL that is not text', JSON.stringify({ v: 1, ...kept, codeUrl: 3 })],
    ['a token that is not text', JSON.stringify({ v: 1, ...kept, token: 3 })],
    ['an expiry that is not a number', JSON.stringify({ v: 1, ...kept, expiresAtMs: 'soon' })],
    ['no expiry field', JSON.stringify({ v: 1, codeUrl: saved.codeUrl, token: saved.token })],
  ])('decodes %s to nothing', (_why, text) => {
    expect(decodeCredential(text)).toBeNull();
  });
});
