import { describe, expect, it } from 'vitest';
import {
  decodeMode,
  decodeSavedCode,
  encodeSavedCode,
  isExpired,
  savedCodeFrom,
  type SavedCode,
} from '@/domain/mode/savedCode';

const NOW = new Date('2026-10-03T13:00:00Z');
const LATER = new Date('2026-10-03T15:00:00Z');

const saved: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 3,
  savedAt: NOW,
  expiresAt: LATER,
  venueTz: null,
};

/** A stored record with one field changed. `undefined` drops the field. */
function record(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    mode: 'stream',
    raw: 'r',
    slot: 0,
    savedAt: 1,
    expiresAt: null,
    venueTz: null,
    ...overrides,
  });
}

describe('saved codes', () => {
  it('round-trips through its stored form', () => {
    expect(decodeSavedCode(encodeSavedCode(saved))).toEqual(saved);
  });

  it('keeps a scoring code with no expiry', () => {
    const scoring: SavedCode = {
      ...saved,
      mode: 'scoring',
      slot: null,
      expiresAt: null,
      venueTz: 'Europe/Madrid',
    };
    expect(decodeSavedCode(encodeSavedCode(scoring))).toEqual(scoring);
  });

  it('builds a saved code from a recognised one', () => {
    expect(
      savedCodeFrom(
        {
          mode: 'stream',
          raw: 'r',
          sid: 'fake-sid',
          slot: 0,
          token: 'fake-token',
          expiresAt: LATER,
        },
        NOW,
      ),
    ).toEqual({
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: NOW,
      expiresAt: LATER,
      venueTz: null,
    });
    const fromScoring = savedCodeFrom({ mode: 'scoring', raw: 'u', token: 't' }, NOW);
    expect(fromScoring.expiresAt).toBeNull();
    expect(fromScoring.slot).toBeNull();
  });

  it.each([
    ['not JSON', 'nope'],
    ['a future version', record({ v: 2 })],
    ['an unknown mode', record({ mode: 'chat' })],
    ['a missing raw', record({ raw: undefined })],
    ['a string time', record({ savedAt: 'yesterday' })],
    ['a fractional slot', record({ slot: 1.5 })],
    ['a negative slot', record({ slot: -1 })],
  ])('refuses %s', (_label, text) => {
    expect(decodeSavedCode(text)).toBeNull();
  });

  it('decodes only known modes', () => {
    expect(decodeMode('stream')).toBe('stream');
    expect(decodeMode('chat')).toBeNull();
    expect(decodeMode(null)).toBeNull();
  });

  it('expires at the exact instant, and never without an expiry', () => {
    expect(isExpired(saved, LATER)).toBe(true);
    expect(isExpired(saved, NOW)).toBe(false);
    expect(isExpired({ ...saved, expiresAt: null }, LATER)).toBe(false);
  });
});
