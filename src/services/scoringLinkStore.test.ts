import { describe, expect, it } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import {
  forgetScoringLink,
  readScoringLink,
  saveScoringLink,
  scoringLinkKey,
} from '@/services/scoringLinkStore';

// A scoring link's token, kept per match in the secure store (design §6.3, plan S2-1 Task 5 and 9). Made-up values.
const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';
const LINK = {
  origin: 'https://stg.seazn.club',
  token: 'dl_made-up-token-for-this-test-only-0001',
};

const failing = (): KeyValueStore => ({
  get: async () => {
    throw new Error('the store is not answering');
  },
  set: async () => {
    throw new Error('the store is not answering');
  },
  delete: async () => {
    throw new Error('the store is not answering');
  },
});

describe('the scoring link store', () => {
  it('keeps a link under scoring.link.{fixtureId} and reads it back whole', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK);
    expect(scoringLinkKey(FIXTURE)).toBe(`scoring.link.${FIXTURE}`);
    expect([...kv.entries.keys()]).toEqual([`scoring.link.${FIXTURE}`]);
    expect(await readScoringLink(kv, FIXTURE)).toEqual({ kind: 'link', link: LINK });
  });

  it('answers none for a match with no link, the empty input', async () => {
    expect(await readScoringLink(createMemoryKeyValueStore(), FIXTURE)).toEqual({ kind: 'none' });
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['a JSON array', '[]'],
    ['no token', JSON.stringify({ origin: LINK.origin })],
    ['an empty token', JSON.stringify({ origin: LINK.origin, token: '' })],
    ['no origin', JSON.stringify({ token: LINK.token })],
    [
      'an origin that is no https origin',
      JSON.stringify({ origin: 'http://stg.seazn.club', token: LINK.token }),
    ],
    ['a token that is no string', JSON.stringify({ origin: LINK.origin, token: 7 })],
  ])('reads %s as no link, never a half link', async (_name, text) => {
    const kv = createMemoryKeyValueStore({ [scoringLinkKey(FIXTURE)]: text });
    expect(await readScoringLink(kv, FIXTURE)).toEqual({ kind: 'none' });
  });

  it('says so when the secure store does not answer, rather than that there is no link', async () => {
    expect(await readScoringLink(failing(), FIXTURE)).toEqual({ kind: 'failed' });
  });

  it.each(['', '../x', 'a b', 'a/b', 'x'.repeat(101)])(
    'reads no link for the id %j, which is no key',
    async (id) => {
      const kv = createMemoryKeyValueStore({ [`scoring.link.${id}`]: JSON.stringify(LINK) });
      expect(await readScoringLink(kv, id)).toEqual({ kind: 'none' });
      await expect(saveScoringLink(kv, id, LINK)).rejects.toThrow();
    },
  );

  it('forgets a link, and only that match’s; forgetting none is nothing', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK);
    await saveScoringLink(kv, 'other-match', LINK);
    await forgetScoringLink(kv, FIXTURE);
    await forgetScoringLink(kv, FIXTURE);
    expect([...kv.entries.keys()]).toEqual(['scoring.link.other-match']);
  });

  it('rejects when the store refuses a save or a forget, so the caller never believes it done', async () => {
    await expect(saveScoringLink(failing(), FIXTURE, LINK)).rejects.toThrow();
    await expect(forgetScoringLink(failing(), FIXTURE)).rejects.toThrow();
  });
});
