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

const HOST = 'stg.seazn.club';
/** The sport a link is kept with (2026-11-02): the scan's bootstrap names it, and every runner reads it from here. */
const SPORT = 'tabletennis';

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
  it('keeps a link under scoring.link.{fixtureId} with its match’s sport, and reads both back whole', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK, HOST, SPORT);
    expect(scoringLinkKey(FIXTURE)).toBe(`scoring.link.${FIXTURE}`);
    expect([...kv.entries.keys()]).toEqual([`scoring.link.${FIXTURE}`]);
    expect(await readScoringLink(kv, FIXTURE, HOST)).toEqual({
      kind: 'link',
      link: LINK,
      sportKey: 'tabletennis',
    });
  });

  it('keeps chess under the engine’s key for it, boardgame: the record carries the bootstrap’s word, never "chess"', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK, HOST, 'boardgame');
    expect(await readScoringLink(kv, FIXTURE, HOST)).toEqual({
      kind: 'link',
      link: LINK,
      sportKey: 'boardgame',
    });
  });

  it('a second save of the match keeps the sport of the last, as a fresh scan does', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK, HOST, 'badminton');
    await saveScoringLink(kv, FIXTURE, LINK, HOST, SPORT);
    expect(await readScoringLink(kv, FIXTURE, HOST)).toEqual({
      kind: 'link',
      link: LINK,
      sportKey: 'tabletennis',
    });
  });

  it('refuses to keep a link with no sport, as a read would never hand one back', async () => {
    const kv = createMemoryKeyValueStore();
    await expect(saveScoringLink(kv, FIXTURE, LINK, HOST, '')).rejects.toThrow();
    expect([...kv.entries.keys()]).toEqual([]);
  });

  it('answers none for a match with no link, the empty input', async () => {
    expect(await readScoringLink(createMemoryKeyValueStore(), FIXTURE, HOST)).toEqual({
      kind: 'none',
    });
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
    // A link with no sport was only ever written by builds of the Remote Scoring branch before 2026-11-02 (never merged,
    // never released): it is not guessed to be badminton's, it is read as no link and scanned again.
    ['no sport at all', JSON.stringify(LINK)],
    ['a sport that is no string', JSON.stringify({ ...LINK, sportKey: 7 })],
    ['a sport that is null', JSON.stringify({ ...LINK, sportKey: null })],
    ['an empty sport', JSON.stringify({ ...LINK, sportKey: '' })],
  ])('reads %s as no link, never a half link', async (_name, text) => {
    const kv = createMemoryKeyValueStore({ [scoringLinkKey(FIXTURE)]: text });
    expect(await readScoringLink(kv, FIXTURE, HOST)).toEqual({ kind: 'none' });
  });

  it('says so when the secure store does not answer, rather than that there is no link', async () => {
    expect(await readScoringLink(failing(), FIXTURE, HOST)).toEqual({ kind: 'failed' });
  });

  it.each(['', '../x', 'a b', 'a/b', 'x'.repeat(101)])(
    'reads no link for the id %j, which is no key',
    async (id) => {
      const kv = createMemoryKeyValueStore({ [`scoring.link.${id}`]: JSON.stringify(LINK) });
      expect(await readScoringLink(kv, id, HOST)).toEqual({ kind: 'none' });
      await expect(saveScoringLink(kv, id, LINK, HOST, SPORT)).rejects.toThrow();
    },
  );

  it('forgets a link, and only that match’s; forgetting none is nothing', async () => {
    const kv = createMemoryKeyValueStore();
    await saveScoringLink(kv, FIXTURE, LINK, HOST, SPORT);
    await saveScoringLink(kv, 'other-match', LINK, HOST, SPORT);
    await forgetScoringLink(kv, FIXTURE);
    await forgetScoringLink(kv, FIXTURE);
    expect([...kv.entries.keys()]).toEqual(['scoring.link.other-match']);
  });

  it('rejects when the store refuses a save or a forget, so the caller never believes it done', async () => {
    await expect(saveScoringLink(failing(), FIXTURE, LINK, HOST, SPORT)).rejects.toThrow();
    await expect(forgetScoringLink(failing(), FIXTURE)).rejects.toThrow();
  });

  it.each([
    ['another host', 'https://evil.example'],
    ['a subdomain of the build’s host', 'https://a.stg.seazn.club'],
    ['a suffix of it', 'https://stg.seazn.club.evil.example'],
    ['another port', 'https://stg.seazn.club:8443'],
    ['a path', 'https://stg.seazn.club/x'],
    ['user information', 'https://stg.seazn.club@evil.example'],
    ['the production host in a staging build', 'https://seazn.club'],
  ])(
    'reads a link kept for %s as no link: the token goes only to the build’s own host',
    async (_name, origin) => {
      const kv = createMemoryKeyValueStore({
        [scoringLinkKey(FIXTURE)]: JSON.stringify({ origin, token: LINK.token, sportKey: SPORT }),
      });
      expect(await readScoringLink(kv, FIXTURE, HOST)).toEqual({ kind: 'none' });
    },
  );

  it('refuses to keep a link for another host, and keeps nothing', async () => {
    const kv = createMemoryKeyValueStore();
    await expect(
      saveScoringLink(
        kv,
        FIXTURE,
        { origin: 'https://evil.example', token: LINK.token },
        HOST,
        SPORT,
      ),
    ).rejects.toThrow();
    expect([...kv.entries.keys()]).toEqual([]);
  });

  it('refuses to keep a link with no token, as a read would never hand one back', async () => {
    const kv = createMemoryKeyValueStore();
    await expect(
      saveScoringLink(kv, FIXTURE, { origin: LINK.origin, token: '' }, HOST, SPORT),
    ).rejects.toThrow();
    expect([...kv.entries.keys()]).toEqual([]);
  });

  it('trusts no host when the build has none', async () => {
    const kv = createMemoryKeyValueStore();
    await expect(saveScoringLink(kv, FIXTURE, LINK, '', SPORT)).rejects.toThrow();
    const stored = createMemoryKeyValueStore({
      [scoringLinkKey(FIXTURE)]: JSON.stringify({ ...LINK, sportKey: SPORT }),
    });
    expect(await readScoringLink(stored, FIXTURE, '')).toEqual({ kind: 'none' });
  });
});
