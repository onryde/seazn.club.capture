import { describe, expect, it } from 'vitest';
import type { SessionSecrets } from '@/domain/credentials/StreamSession';
import { SCRUBBED, scrubEvent, scrubFields, type LogFields } from '@/services/scrub';

const TOKEN = 'fake-token-0001';
const PASSPHRASE = 'fake-pass-0001';
const STREAM_KEY = 'fake-key-0001';
const STREAM_ID = 'fake-stream-id-0001';
/** Characters an encoder escapes, so only a decode can find it in a URL. */
const ODD_PASSPHRASE = 'p@ss/w0rd!';
/** Every byte of `text`'s UTF-8 as `%XX`, so the whole of it sits in one escape run. */
const escapedBytes = (text: string) =>
  Array.from(
    new TextEncoder().encode(text),
    (byte) => `%${byte.toString(16).padStart(2, '0')}`,
  ).join('');

const HELD: SessionSecrets = {
  secrets: [
    TOKEN,
    PASSPHRASE,
    STREAM_KEY,
    ODD_PASSPHRASE,
    'fake pass 0001',
    'odd%41pass',
    'plus+pass+0001',
    'fake pass+0002',
    'fake-pæss-0003',
    'fake+pæss-0005',
  ],
  streamIds: [STREAM_ID],
};

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
    // n2: a userinfo token passed off as a host never reaches the record.
    expect(scrubFields({ host: 'user@evil.example' })).toEqual({ host: SCRUBBED });
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

  it('scrubs an event name that carries a held secret (M3)', () => {
    expect(scrubEvent('intent.stop', HELD)).toBe('intent.stop');
    expect(scrubEvent(`intent.${TOKEN}`, HELD)).toBe(SCRUBBED);
    expect(scrubEvent(`intent.${STREAM_ID}`, HELD)).toBe(SCRUBBED);
  });
});

/**
 * M3 (final review): parity with plan B's SessionRecord. Once a session is
 * held, its token, passphrases and stream keys never reach the record under
 * any key, and its stream id only inside a public URL: Cloudflare puts it in
 * the playback path, which every viewer holds. Made-up values.
 */
describe('scrubFields: the held session’s secrets, by value (M3)', () => {
  it.each([
    ['the token', TOKEN],
    ['the passphrase', PASSPHRASE],
    ['the stream key', STREAM_KEY],
    ['the stream id', STREAM_ID],
  ])('scrubs %s under an allow-listed key, alone or inside a word', (_, secret) => {
    expect(scrubFields({ problem: secret }, HELD)).toEqual({ problem: SCRUBBED });
    expect(scrubFields({ kind: `bad-${secret}-x` }, HELD)).toEqual({ kind: SCRUBBED });
  });

  it('keeps words that carry none of them', () => {
    const fields = { kind: 'offline', problem: 'port-threw', action: 'stop', slot: 2 };
    expect(scrubFields(fields, HELD)).toEqual(fields);
  });

  it('lets a public URL carry the stream id, as the playback path does', () => {
    const url = `https://video.example/${STREAM_ID}/manifest/video.m3u8`;
    expect(scrubFields({ url }, HELD)).toEqual({ url });
  });

  it.each([
    ['the token', `https://video.example/a/${TOKEN}`],
    ['the stream key', `https://video.example/live/${STREAM_KEY}`],
    ['a passphrase percent-encoded', `https://video.example/${encodeURIComponent(ODD_PASSPHRASE)}`],
    ['a passphrase form-encoded, space as +', 'https://video.example/fake+pass+0001'],
    // A + in the secret itself: only the decoded text, + kept, shows it.
    ['a passphrase holding a +, percent-encoded', 'https://video.example/plus%2Bpass%2B0001'],
    // Final fix round 2, M-a: URLEncoder's form, space as + and + as %2B. Only
    // reading + as a space BEFORE decoding shows it.
    [
      'a passphrase holding a space and a +, form-encoded',
      'https://video.example/fake+pass%2B0002',
    ],
    // A form-encoded value escaped again for a path: decoded, THEN + as a space.
    ['a form-encoded passphrase escaped again', 'https://video.example/fake%2Bpass%2B0001'],
    // encodeURI leaves + raw beside its escapes: only the plain decoding shows it.
    [
      'a passphrase with a raw + beside escapes',
      `https://video.example/${encodeURI('fake+pæss-0005')}`,
    ],
    // M-b: one escape that is not UTF-8 never hides the rest of its run.
    ['the token after an invalid escape', `https://video.example/a/%FF${escapedBytes(TOKEN)}`],
    ['the token after a cut-short escape', `https://video.example/a/%E0%A4${escapedBytes(TOKEN)}`],
    ['the token between two invalid escapes', `https://video.example/%C3${escapedBytes(TOKEN)}%FF`],
    [
      'a non-ASCII passphrase after an invalid escape',
      `https://video.example/%FF${escapedBytes('fake-pæss-0003')}`,
    ],
    ['a passphrase that holds an escape, raw', 'https://video.example/a/odd%41pass'],
  ])('scrubs a public URL that carries %s', (_, url) => {
    expect(scrubFields({ url }, HELD)).toEqual({ url: SCRUBBED });
  });

  it('survives a malformed escape and keeps the URL when it holds no secret', () => {
    const url = 'https://video.example/a%E0%A4b/c%zz';
    expect(scrubFields({ url }, HELD)).toEqual({ url });
  });

  it('never masks with a blank value', () => {
    const blank: SessionSecrets = { secrets: ['', '  '], streamIds: [''] };
    expect(scrubFields({ kind: 'offline' }, blank)).toEqual({ kind: 'offline' });
    expect(scrubEvent('kv.timeout', blank)).toBe('kv.timeout');
    const url = 'https://video.example/a';
    expect(scrubFields({ url }, blank)).toEqual({ url });
  });
});
