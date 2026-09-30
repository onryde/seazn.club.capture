import { describe, expect, it } from 'vitest';
import { SCRUBBED, scrubEvent, scrubFields, type LogFields } from '@/services/scrub';

describe('scrubFields (allow-list, spec §3)', () => {
  it('keeps allow-listed keys holding plain words, numbers, booleans and null', () => {
    const fields = {
      kind: 'offline',
      status: 503,
      attempt: 2,
      op: 'set',
      key: 'code.stream',
      lock: false,
      endReason: null,
    };
    expect(scrubFields(fields)).toEqual(fields);
  });

  it('keeps a slot number: it names a camera position, not a secret (controller ruling M14)', () => {
    expect(scrubFields({ slot: 3 })).toEqual({ slot: 3 });
  });

  it('keeps a bare host, the only thing a refused overlay navigation logs (I1)', () => {
    expect(scrubFields({ host: 'evil.example' })).toEqual({ host: 'evil.example' });
    expect(scrubFields({ host: null })).toEqual({ host: null });
    expect(scrubFields({ host: 'evil.example/p?token=abc' })).toEqual({ host: SCRUBBED });
  });

  it('scrubs a secret under a key nobody expected', () => {
    const fields = { tok: 'abc', passphrase: 'p', streamKey: 'k', token: 't', raw: '{"v":2}' };
    expect(scrubFields(fields)).toEqual({
      tok: SCRUBBED,
      passphrase: SCRUBBED,
      streamKey: SCRUBBED,
      token: SCRUBBED,
      raw: SCRUBBED,
    });
  });

  it('scrubs a sentence or a URL under an allow-listed key', () => {
    expect(scrubFields({ reason: 'srt://h:778?passphrase=abc' })).toEqual({ reason: SCRUBBED });
    expect(scrubFields({ reason: 'bad token abc' })).toEqual({ reason: SCRUBBED });
  });

  it.each([
    ['https://stg.seazn.club/overlay/fixtures/f1', true],
    ['https://video.example:8443/a/b.m3u8', true],
    ['https://video.example/a.m3u8?token=abc', false],
    ['https://video.example/a#frag', false],
    ['https://user:pass@video.example/a', false],
    ['rtmps://live.example/live/key', false],
    ['http://video.example/a', false],
  ])('passes %s as a url only when it is public: %s', (url, passes) => {
    expect(scrubFields({ url })).toEqual({ url: passes ? url : SCRUBBED });
  });

  // The types say LogValue, but a caller can launder anything past them (a
  // parsed native payload, an `as`). The scrub is the boundary: it ends closed.
  it.each([
    ['an object', { tok: 'secret-token' }],
    ['an array', ['secret-token']],
    ['a bigint', BigInt(1)],
  ])('scrubs %s under an allow-listed key', (_, value) => {
    const fields = { reason: value } as unknown as LogFields;
    expect(scrubFields(fields)).toEqual({ reason: SCRUBBED });
  });

  it('scrubs a number that is not finite', () => {
    expect(scrubFields({ ms: Number.NaN })).toEqual({ ms: SCRUBBED });
  });

  it('returns nothing for nothing', () => {
    expect(scrubFields({})).toEqual({});
  });
});

describe('scrubEvent', () => {
  it('keeps a dotted event name and scrubs anything else', () => {
    expect(scrubEvent('kv.timeout')).toBe('kv.timeout');
    expect(scrubEvent('tok=abc')).toBe(SCRUBBED);
    expect(scrubEvent('')).toBe(SCRUBBED);
  });
});
