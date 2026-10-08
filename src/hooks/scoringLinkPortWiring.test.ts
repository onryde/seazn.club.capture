import { describe, expect, it, vi } from 'vitest';
import type { CaptureEngineNative } from '@/engine/nativeModule';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import { scoringLinkPortFor } from '@/hooks/scoringLinkPortWiring';
import { createLogger } from '@/services/logger';
import { SCRUBBED } from '@/services/scrub';
import { seaznHosts } from '@/services/seaznHosts';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from '../../test/fakeScoringLinkPort';

type Native = Pick<CaptureEngineNative, 'scoringLink'>;

/** The made-up link on production's host (FAKE_SCORING_URL is staging's). */
const PRODUCTION_URL = FAKE_SCORING_URL.replace('stg.seazn.club', 'seazn.club');
const UNAVAILABLE = { kind: 'refused', word: 'unavailable', retryAfterS: null } as const;

/** A logger that only records which secret it was asked to protect, in [order]. */
const recording = (order: string[]) => ({
  protectLink: vi.fn((secret: string) => {
    order.push(`protect:${secret}`);
  }),
});
const parsed = (lines: readonly string[]) => lines.map(parseRecordLine);

describe('which scoring-link port the composition root wires (spec §10, RP3)', () => {
  const ANSWERS = [
    ['a link', { outcome: 'ok', url: FAKE_SCORING_URL }, { kind: 'ok', url: FAKE_SCORING_URL }],
    [
      'a refusal',
      { outcome: 'replaced' },
      { kind: 'refused', word: 'replaced', retryAfterS: null },
    ],
    [
      'a rate limit',
      { outcome: 'rate_limited', retryAfterS: 30 },
      { kind: 'refused', word: 'rate_limited', retryAfterS: 30 },
    ],
  ] as const;
  let answered = 0;

  it.each(ANSWERS)(
    'a request asks the module exactly once and reads its answer: %s',
    async (_why, said, read) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = said;
      const port = scoringLinkPortFor(module, {
        logger: recording([]),
        hosts: seaznHosts('staging'),
      });
      await expect(port.request()).resolves.toEqual(read);
      expect(module.scoringCalls).toBe(1);
      answered += 1;
    },
  );

  it('answered all 3 kinds of answer (anti-vacuity)', () => {
    expect(ANSWERS).toHaveLength(3);
    expect(answered).toBe(3);
  });

  it('no module (iOS in S1, web) is unavailable, and protects nothing', async () => {
    const order: string[] = [];
    const port = scoringLinkPortFor(null, {
      logger: recording(order),
      hosts: seaznHosts('staging'),
    });
    await expect(port.request()).resolves.toEqual(UNAVAILABLE);
    expect(order).toEqual([]);
  });

  it('a stale module without scoringLink is unavailable, not an exception', async () => {
    const stale = {} as unknown as Native;
    const port = scoringLinkPortFor(stale, { logger: recording([]), hosts: seaznHosts('staging') });
    await expect(port.request()).resolves.toEqual(UNAVAILABLE);
  });

  it('calls scoringLink on the module, so its this stays bound', async () => {
    const seen: unknown[] = [];
    const native = {
      scoringLink() {
        seen.push(this);
        return Promise.resolve({ outcome: 'unavailable' });
      },
    };
    await scoringLinkPortFor(native, {
      logger: recording([]),
      hosts: seaznHosts('staging'),
    }).request();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(native);
  });

  it('protects the link’s secret through the logger BEFORE the caller has the answer, and only for a link', async () => {
    const order: string[] = [];
    const ask = (said: unknown) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = said;
      return scoringLinkPortFor(module, { logger: recording(order), hosts: seaznHosts('staging') })
        .request()
        .then((outcome) => {
          order.push('resolved');
          return outcome;
        });
    };
    await ask({ outcome: 'ok', url: FAKE_SCORING_URL });
    expect(FAKE_SCORING_SECRET).toHaveLength(46); // anti-vacuity: the contract's shape, `dl_` and 43
    expect(order).toEqual([`protect:${FAKE_SCORING_SECRET}`, 'resolved']);
    // Not a link: nothing to protect, so protect is never called.
    order.length = 0;
    await ask({ outcome: 'replaced' });
    await ask({ outcome: 'ok' });
    await ask({ outcome: 'ok', url: PRODUCTION_URL }); // off the staging build's host
    expect(order).toEqual(['resolved', 'resolved', 'resolved']);
  });

  it('trusts exactly hosts[0]: the build’s own Seazn host and no other', async () => {
    const kindOf = async (hosts: readonly string[], url: string) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = { outcome: 'ok', url };
      const port = scoringLinkPortFor(module, { logger: recording([]), hosts });
      return (await port.request()).kind;
    };
    const rows = [
      [seaznHosts('staging'), FAKE_SCORING_URL, 'ok'],
      [seaznHosts('staging'), PRODUCTION_URL, 'refused'],
      [seaznHosts('production'), PRODUCTION_URL, 'ok'],
      [seaznHosts('production'), FAKE_SCORING_URL, 'refused'],
      // The first of two, not the last and not any of them.
      [['seazn.club', 'stg.seazn.club'], PRODUCTION_URL, 'ok'],
      [['seazn.club', 'stg.seazn.club'], FAKE_SCORING_URL, 'refused'],
      // A build that names no host trusts none: neither build's link, so no fallback host is hiding behind `?? ''`.
      [[], FAKE_SCORING_URL, 'refused'],
      [[], PRODUCTION_URL, 'refused'],
    ] as const;
    for (const [hosts, url, kind] of rows) {
      expect(await kindOf(hosts, url), `${hosts.join(',')} ${url}`).toBe(kind);
    }
    expect(rows).toHaveLength(8);
  });

  it('the real logger behind the real wiring masks the secret in a message and under url once the answer is heard, and not before (the JS twin of the native leak test)', async () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0, minLevel: 'debug' });
    // A session in hand, or free text is masked whole and the witness below could never show.
    logger.protect({ secrets: ['tok-test-0000000000000'], streamIds: [] });
    logger.info('probe', { message: `x ${FAKE_SCORING_SECRET} y` });
    expect(parsed(record.lines()).at(-1)?.fields.message).toBe(`x ${FAKE_SCORING_SECRET} y`); // the witness: not masked before it is known
    const module = new FakeNativeModule();
    module.scoringAnswer = { outcome: 'ok', url: FAKE_SCORING_URL };
    await scoringLinkPortFor(module, { logger, hosts: seaznHosts('staging') }).request();
    logger.info('probe', { url: FAKE_SCORING_URL, message: `x ${FAKE_SCORING_SECRET} y` });
    const after = parsed(record.lines()).at(-1);
    expect(after?.fields.message).toBe(`x ${SCRUBBED} y`);
    expect(after?.fields.url).toBe(SCRUBBED);
    expect(record.lines().slice(1).join('')).not.toContain(FAKE_SCORING_SECRET);
  });
});
