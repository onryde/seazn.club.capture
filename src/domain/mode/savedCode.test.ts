import { describe, expect, it } from 'vitest';
import {
  decodeMode,
  decodeSavedCode,
  encodeSavedCode,
  isExpired,
  savedCodeFrom,
  venueZone,
  type SavedCode,
} from '@/domain/mode/savedCode';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { descriptorWire, FIXTURE_NOW } from '../../../test/fixtures/wire';

const LATER = new Date('2026-10-03T15:00:00Z');

/** A stored record written by hand, with one field changed. `undefined` drops the field. */
function record(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    v: 2,
    mode: 'stream',
    raw: 'r',
    slot: 0,
    savedAt: 1,
    expiresAt: null,
    descriptor: descriptorWire(),
    ...overrides,
  });
}

describe('saved codes, v2 (D28)', () => {
  it('round-trips a stream code with its descriptor', () => {
    const code = savedStreamCode();
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  it('round-trips a scoring code, which has no descriptor', () => {
    const code: SavedCode = {
      mode: 'scoring',
      raw: 'https://stg.seazn.club/score/abc',
      slot: null,
      savedAt: FIXTURE_NOW,
      expiresAt: null,
      descriptor: null,
    };
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  it('reads a record written by hand, not only its own round trip', () => {
    expect(decodeSavedCode(record({}))).toMatchObject({
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: new Date(1),
      expiresAt: null,
      descriptor: { label: 'Seazn XI v Fake CC', venueTimezone: 'Europe/London' },
    });
  });

  it('drops a v1 record: clean slate, never migrated', () => {
    const v1 = JSON.stringify({
      v: 1,
      mode: 'stream',
      raw: 'r',
      slot: 1,
      savedAt: 1,
      expiresAt: 2,
      venueTz: null,
    });
    expect(decodeSavedCode(v1)).toBeNull();
  });

  it('drops a stream record with no descriptor', () => {
    expect(decodeSavedCode(encodeSavedCode(savedStreamCode({ descriptor: null })))).toBeNull();
    expect(decodeSavedCode(record({ descriptor: undefined }))).toBeNull();
  });

  it('drops a record whose descriptor no longer parses', () => {
    const text = encodeSavedCode(savedStreamCode()).replace('"state":"warming"', '"state":"odd"');
    expect(decodeSavedCode(text)).toBeNull();
  });

  it('keeps the descriptor handed over at save', () => {
    const descriptor = sampleDescriptor(FIXTURE_NOW);
    const code = savedCodeFrom(
      { mode: 'stream', raw: 'r', sid: 's', slot: 0, token: 't', expiresAt: FIXTURE_NOW },
      FIXTURE_NOW,
      descriptor,
    );
    expect(code.descriptor).toBe(descriptor);
  });

  it('never stores the token, which lives only in raw', () => {
    const code = savedCodeFrom(
      { mode: 'stream', raw: 'r', sid: 's', slot: 0, token: 'fake-tok-x', expiresAt: LATER },
      FIXTURE_NOW,
      sampleDescriptor(FIXTURE_NOW),
    );
    expect(encodeSavedCode(code)).not.toContain('fake-tok-x');
  });

  it('builds a saved code from a recognised one', () => {
    expect(
      savedCodeFrom(
        { mode: 'stream', raw: 'r', sid: 's', slot: 0, token: 't', expiresAt: LATER },
        FIXTURE_NOW,
        null,
      ),
    ).toEqual({
      mode: 'stream',
      raw: 'r',
      slot: 0,
      savedAt: FIXTURE_NOW,
      expiresAt: LATER,
      descriptor: null,
    });
    const fromScoring = savedCodeFrom({ mode: 'scoring', raw: 'u', token: 't' }, FIXTURE_NOW, null);
    expect(fromScoring.expiresAt).toBeNull();
    expect(fromScoring.slot).toBeNull();
  });

  it('reads the venue zone from the descriptor, else none', () => {
    expect(venueZone(savedStreamCode())).toBe('Europe/London');
    expect(venueZone(savedStreamCode({ descriptor: null }))).toBeNull();
  });

  it.each([
    ['not JSON', 'nope'],
    ['a future version', record({ v: 3 })],
    // The version alone drops it: this one carries a descriptor that would parse.
    ['a v1 record carrying a descriptor', record({ v: 1 })],
    ['an unknown mode', record({ mode: 'chat' })],
    ['a missing raw', record({ raw: undefined })],
    ['a string time', record({ savedAt: 'yesterday' })],
    ['a fractional slot', record({ slot: 1.5 })],
    ['a negative slot', record({ slot: -1 })],
    ['a descriptor that is not an object', record({ descriptor: 'warming' })],
  ])('refuses %s', (_label, text) => {
    expect(decodeSavedCode(text)).toBeNull();
  });

  it('decodes only known modes', () => {
    expect(decodeMode('stream')).toBe('stream');
    expect(decodeMode('chat')).toBeNull();
    expect(decodeMode(null)).toBeNull();
  });

  it('expires at the exact instant, and never without an expiry', () => {
    const saved = savedStreamCode({ savedAt: FIXTURE_NOW, expiresAt: LATER });
    expect(isExpired(saved, LATER)).toBe(true);
    expect(isExpired(saved, FIXTURE_NOW)).toBe(false);
    expect(isExpired({ ...saved, expiresAt: null }, LATER)).toBe(false);
  });
});
