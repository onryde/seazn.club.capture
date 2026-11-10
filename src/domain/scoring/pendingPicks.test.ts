import { describe, expect, it } from 'vitest';
import { NO_PICKS, readPicks, samePicks } from '@/domain/scoring/pendingPicks';

// Pending picks (S2-4 plan Task 3, spec §6): the scorer's choices the server records only when a later tap carries
// them (cricket's batting order, openers, the next bowler). Kept with the queue, read back by this one reader: a key is
// a lowercase letter then letters, digits and dots, at most 64 characters; at most 32 keys, at most 64 ids a key, each
// id 1 to 64 characters. Anything else is garbled.

const id = (length: number): string => 'p'.repeat(length);
const keys = (count: number): Record<string, string[]> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, ['p-1']]));

describe('readPicks', () => {
  it('reads keys to lists of person ids', () => {
    const raw = { 'order.first': ['p-3', 'p-1'], 'bowler.i1.2': ['p-9'], 'openers.s1': [] };
    expect(readPicks(raw)).toStrictEqual(raw);
  });

  it('reads no picks as none', () => {
    expect(readPicks({})).toStrictEqual(NO_PICKS);
  });

  it('takes the limits themselves: 32 keys, 64 ids, an id and a key of 64 characters', () => {
    expect(readPicks(keys(32))).toStrictEqual(keys(32));
    const long = { ['k' + 'a'.repeat(63)]: Array.from({ length: 64 }, () => id(64)) };
    expect(readPicks(long)).toStrictEqual(long);
  });

  it.each([
    ['a key that starts with a digit', { '1x': ['p-1'] }],
    ['a key that starts with a capital', { Order: ['p-1'] }],
    ['an empty key', { '': ['p-1'] }],
    ['a key with a space', { 'order first': ['p-1'] }],
    ['a key of 65 characters', { ['k' + 'a'.repeat(64)]: ['p-1'] }],
    ['33 keys', keys(33)],
    ['65 ids under one key', { order: Array.from({ length: 65 }, () => 'p-1') }],
    ['an empty id', { order: [''] }],
    ['an id of 65 characters', { order: [id(65)] }],
    ['an id that is no text', { order: [7] }],
    ['a value that is no list', { order: 'p-1' }],
    ['a list, not a map', [['order', ['p-1']]]],
    ['null', null],
    ['text', 'order'],
  ])('refuses %s', (_name, raw) => {
    expect(readPicks(raw)).toBeUndefined();
  });
});

describe('samePicks', () => {
  it('is true of the same picks in new objects, the keys in any order', () => {
    const a = { order: ['p-1', 'p-2'], bowler: ['p-9'] };
    expect(samePicks(a, { bowler: ['p-9'], order: ['p-1', 'p-2'] })).toBe(true);
    expect(samePicks(NO_PICKS, {})).toBe(true);
  });

  it.each([
    ['another order', { order: ['p-2', 'p-1'] }],
    ['one id more', { order: ['p-1', 'p-2', 'p-3'] }],
    ['another key', { openers: ['p-1', 'p-2'] }],
    ['a key more', { order: ['p-1', 'p-2'], bowler: ['p-9'] }],
    ['none', {}],
  ])('is false against %s', (_name, other) => {
    expect(samePicks({ order: ['p-1', 'p-2'] }, other)).toBe(false);
    expect(samePicks(other, { order: ['p-1', 'p-2'] })).toBe(false);
  });

  // A key is any word the pattern takes, an Object method's name included: the other map must hold it as its own.
  it('is false against a key the other map does not hold, named as an object’s own method', () => {
    expect(samePicks({ toString: [] }, { order: [] })).toBe(false);
  });
});
