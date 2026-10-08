import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import vectors from '@/engine/wire/scoring-link-vectors.json';
import { seaznHosts } from '@/services/seaznHosts';
import {
  SCORING_DEADLINE_MS,
  SCORING_WORDS,
  createScoringLinkPort,
  readAnswer,
  scoringSecret,
  type ScoringLinkOutcome,
  type ScoringWord,
} from '@/services/scoringLinkPort';

/** Made up: the contract's shape (`dl_` and 43 base64url characters). Never a real link. */
const SECRET = 'dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const HOST = 'stg.seazn.club';
const URL_OK = `https://${HOST}/score/${SECRET}`;
const UNAVAILABLE: ScoringLinkOutcome = { kind: 'refused', word: 'unavailable', retryAfterS: null };
const refused = (word: ScoringWord, retryAfterS: number | null): ScoringLinkOutcome => ({
  kind: 'refused',
  word,
  retryAfterS,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('readAnswer, the pure reading of what native resolved', () => {
  const ROWS: readonly (readonly [string, unknown, ScoringLinkOutcome])[] = [
    ['a link', { outcome: 'ok', url: URL_OK }, { kind: 'ok', url: URL_OK }],
    ['a refusal', { outcome: 'replaced' }, refused('replaced', null)],
    [
      'a rate limit with its Retry-After',
      { outcome: 'rate_limited', retryAfterS: 30 },
      refused('rate_limited', 30),
    ],
    [
      'a rate limit with a zero Retry-After',
      { outcome: 'rate_limited', retryAfterS: 0 },
      refused('rate_limited', 0),
    ],
    ['a rate limit with none', { outcome: 'rate_limited' }, refused('rate_limited', null)],
    [
      'a negative Retry-After',
      { outcome: 'rate_limited', retryAfterS: -1 },
      refused('rate_limited', null),
    ],
    [
      'a Retry-After that is a string',
      { outcome: 'rate_limited', retryAfterS: '30' },
      refused('rate_limited', null),
    ],
    [
      'a Retry-After that is NaN',
      { outcome: 'rate_limited', retryAfterS: Number.NaN },
      refused('rate_limited', null),
    ],
    [
      'a Retry-After that is infinite',
      { outcome: 'rate_limited', retryAfterS: Number.POSITIVE_INFINITY },
      refused('rate_limited', null),
    ],
    [
      'a Retry-After on a word that has none',
      { outcome: 'replaced', retryAfterS: 30 },
      refused('replaced', null),
    ],
    ['a word that is not one of native’s', { outcome: 'teapot' }, UNAVAILABLE],
    ['ok with no url', { outcome: 'ok' }, UNAVAILABLE],
    ['ok with a url that is not a string', { outcome: 'ok', url: 7 }, UNAVAILABLE],
    [
      'ok with a url off the build’s host',
      { outcome: 'ok', url: `https://seazn.club/score/${SECRET}` },
      UNAVAILABLE,
    ],
    ['ok with http', { outcome: 'ok', url: `http://${HOST}/score/${SECRET}` }, UNAVAILABLE],
    [
      'ok with a short secret',
      { outcome: 'ok', url: `https://${HOST}/score/dl_short` },
      UNAVAILABLE,
    ],
    [
      'ok with userinfo naming another host',
      { outcome: 'ok', url: `https://${HOST}@evil.example/score/${SECRET}` },
      UNAVAILABLE,
    ],
    [
      'ok with an upper-case host, which is the build’s host',
      { outcome: 'ok', url: `https://STG.seazn.club/score/${SECRET}` },
      { kind: 'ok', url: `https://STG.seazn.club/score/${SECRET}` },
    ],
    [
      'a refusal that carries a url (ignored)',
      { outcome: 'replaced', url: URL_OK },
      refused('replaced', null),
    ],
    ['null', null, UNAVAILABLE],
    ['undefined', undefined, UNAVAILABLE],
    ['the string ok', 'ok', UNAVAILABLE],
    ['a number', 3, UNAVAILABLE],
    ['an array', [], UNAVAILABLE],
  ];

  it.each(ROWS)('%s', (_why, said, read) => {
    expect(readAnswer(said, HOST)).toEqual(read);
  });

  it('sweeps all 24 rows (anti-vacuity)', () => {
    expect(ROWS).toHaveLength(24);
  });

  it('a build that trusts no host (an empty host) reads every link as unavailable', () => {
    expect(readAnswer({ outcome: 'ok', url: URL_OK }, '')).toEqual(UNAVAILABLE);
  });

  it('the closed set of words is the words the shared vectors expect, besides ok', () => {
    const expected = new Set(vectors.cases.map((row) => row.expected));
    expect(expected.delete('ok')).toBe(true);
    expect([...expected].sort()).toEqual([...SCORING_WORDS].sort());
    expect(SCORING_WORDS).toHaveLength(6);
    // Each word, said alone, is read as itself: a word dropped from the set would read as unavailable.
    for (const word of SCORING_WORDS)
      expect(readAnswer({ outcome: word }, HOST), word).toEqual(refused(word, null));
  });
});

/**
 * F14. The JS reader held to the rows Kotlin's `Bodies.scoringLink` is held to: a hostile native that says
 * `ok` for every 2xx row that carries a url is believed exactly when Kotlin calls the row ok.
 */
describe('the JS gate and the Kotlin gate, over the shared vectors (Review Focus 5)', () => {
  const withUrl = vectors.cases.filter(
    (row) => row.status >= 200 && row.status < 300 && 'body' in row && 'url' in (row.body ?? {}),
  );

  it('sweeps the 7 rows that carry a url, 3 ok and 4 refused', () => {
    expect(withUrl).toHaveLength(7);
    expect(withUrl.filter((row) => row.expected === 'ok')).toHaveLength(3);
    expect(withUrl.filter((row) => row.expected !== 'ok')).toHaveLength(4);
  });

  it.each(withUrl.map((row) => [row.why, row] as const))('%s', (_why, row) => {
    const url = (row.body as { url: string }).url;
    const read = readAnswer(
      { outcome: 'ok', url },
      seaznHosts(row.env === 'production' ? 'production' : 'staging')[0]!,
    );
    expect(read.kind === 'ok').toBe(row.expected === 'ok');
  });
});

describe('the scoring-link port (spec §10, R-F3)', () => {
  const portOver = (
    module: FakeNativeModule,
    protect: (secret: string) => void = () => undefined,
  ) => createScoringLinkPort(() => module.scoringLink(), { protect, host: HOST });

  it('asks the module each time and resolves its answer, clearing its timer when it comes', async () => {
    const module = new FakeNativeModule();
    module.scoringAnswer = { outcome: 'ok', url: URL_OK };
    const port = portOver(module);
    await expect(port.request()).resolves.toEqual({ kind: 'ok', url: URL_OK });
    expect(module.scoringCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(port.request()).resolves.toEqual({ kind: 'ok', url: URL_OK });
    expect(module.scoringCalls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('protects the link’s secret before the caller has the answer, and hands protect the bare secret', async () => {
    const order: string[] = [];
    const module = new FakeNativeModule();
    module.scoringAnswer = { outcome: 'ok', url: URL_OK };
    const protectedSecrets: string[] = [];
    const port = portOver(module, (secret) => {
      protectedSecrets.push(secret);
      order.push('protect');
    });
    await port.request().then(() => order.push('resolved'));
    expect(order).toEqual(['protect', 'resolved']);
    expect(protectedSecrets).toEqual([scoringSecret(URL_OK)]);
    expect(scoringSecret(URL_OK)).toBe(SECRET);
    expect(SECRET).toHaveLength(46); // anti-vacuity: the made-up value is the contract's shape, `dl_` and 43
  });

  it('a link whose secret could not be protected is never handed out: unavailable, not ok', async () => {
    const module = new FakeNativeModule();
    module.scoringAnswer = { outcome: 'ok', url: URL_OK };
    const protect = vi.fn(() => {
      throw new Error('the record is gone');
    });
    const outcome = await portOver(module, protect).request();
    expect(protect).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual(UNAVAILABLE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refusal, a bad answer and an unavailable never reach protect', async () => {
    const saids: unknown[] = [
      { outcome: 'replaced' },
      { outcome: 'rate_limited', retryAfterS: 30 },
      { outcome: 'ok' },
      { outcome: 'ok', url: `https://seazn.club/score/${SECRET}` },
      { outcome: 'unavailable' },
      'ok',
    ];
    const protect = vi.fn();
    for (const said of saids) {
      const module = new FakeNativeModule();
      module.scoringAnswer = said;
      await portOver(module, protect).request();
    }
    expect(protect).not.toHaveBeenCalled();
    expect(saids).toHaveLength(6);
  });

  it('no call at all is unavailable', async () => {
    const protect = vi.fn();
    await expect(createScoringLinkPort(null, { protect, host: HOST }).request()).resolves.toEqual(
      UNAVAILABLE,
    );
    expect(protect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a rejection and a synchronous throw are both unavailable, never an exception', async () => {
    const deps = { protect: vi.fn(), host: HOST };
    await expect(
      createScoringLinkPort(() => Promise.reject(new Error('x')), deps).request(),
    ).resolves.toEqual(UNAVAILABLE);
    await expect(
      createScoringLinkPort(() => {
        throw new Error('not linked');
      }, deps).request(),
    ).resolves.toEqual(UNAVAILABLE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('M-deadline gives up at the deadline exactly', async () => {
    const port = createScoringLinkPort(() => new Promise(() => undefined), {
      protect: vi.fn(),
      host: HOST,
    });
    let outcome: ScoringLinkOutcome | null = null;
    void port.request().then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(SCORING_DEADLINE_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual(UNAVAILABLE);
  });

  it('the deadline is 12 s, under native’s 16 s backstop, so JS always gives up first (the controller’s number, written out)', () => {
    expect(SCORING_DEADLINE_MS).toBe(12_000);
  });

  it('a deadline given in the deps is the one used', async () => {
    const port = createScoringLinkPort(() => new Promise(() => undefined), {
      protect: vi.fn(),
      host: HOST,
      deadlineMs: 50,
    });
    let outcome: ScoringLinkOutcome | null = null;
    void port.request().then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(49);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual(UNAVAILABLE);
  });

  it('a late answer is dropped, and its secret is still protected', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const protect = vi.fn();
    const port = createScoringLinkPort(() => new Promise((resolve) => (answer = resolve)), {
      protect,
      host: HOST,
    });
    const request = port.request();
    let seen: ScoringLinkOutcome | null = null;
    void request.then((value) => (seen = value));
    await vi.advanceTimersByTimeAsync(SCORING_DEADLINE_MS);
    expect(seen).toEqual(UNAVAILABLE);
    expect(protect).not.toHaveBeenCalled();
    answer({ outcome: 'ok', url: URL_OK });
    await vi.advanceTimersByTimeAsync(0);
    // The caller's outcome did not change: it was settled at the deadline.
    expect(seen).toEqual(UNAVAILABLE);
    await expect(request).resolves.toEqual(UNAVAILABLE);
    // The secret reached JS memory all the same, so the record masks it from here on.
    expect(protect).toHaveBeenCalledTimes(1);
    expect(protect).toHaveBeenCalledWith(SECRET);
  });

  it('a rate limit, then a success, then a second success on the same link: three asks, in order', async () => {
    const module = new FakeNativeModule();
    const protect = vi.fn();
    const port = portOver(module, protect);
    module.scoringAnswer = { outcome: 'rate_limited', retryAfterS: 30 };
    const first = await port.request();
    module.scoringAnswer = { outcome: 'ok', url: URL_OK };
    const second = await port.request();
    const third = await port.request();
    expect([first, second, third]).toEqual([
      refused('rate_limited', 30),
      { kind: 'ok', url: URL_OK },
      { kind: 'ok', url: URL_OK },
    ]);
    expect(module.scoringCalls).toBe(3);
    expect(protect.mock.calls).toEqual([[SECRET], [SECRET]]);
  });

  it('two requests in flight at once each resolve their own answer', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const port = createScoringLinkPort(() => new Promise((resolve) => pending.push(resolve)), {
      protect: vi.fn(),
      host: HOST,
    });
    const first = port.request();
    const second = port.request();
    expect(pending).toHaveLength(2);
    pending[1]!({ outcome: 'replaced' });
    pending[0]!({ outcome: 'ok', url: URL_OK });
    await expect(second).resolves.toEqual(refused('replaced', null));
    await expect(first).resolves.toEqual({ kind: 'ok', url: URL_OK });
    expect(vi.getTimerCount()).toBe(0);
  });
});
