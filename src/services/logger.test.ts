import { describe, expect, it } from 'vitest';
import { createLogger } from '@/services/logger';
import { SCRUBBED } from '@/services/scrub';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

const parsed = (lines: readonly string[]) => lines.map(parseRecordLine);

describe('the logger', () => {
  it('writes each level to the record, stamped with the clock', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => Date.parse('2026-10-03T13:00:00Z') });
    logger.warn('kv.timeout', { op: 'set' });
    expect(parsed(record.lines())).toEqual([
      {
        atMs: Date.parse('2026-10-03T13:00:00Z'),
        level: 'warn',
        event: 'kv.timeout',
        fields: { op: 'set' },
      },
    ]);
  });

  it('scrubs before anything reaches the record', () => {
    const record = createRingRecord();
    createLogger({ record, now: () => 0 }).error('descriptor.error', { tok: 'secret-token' });
    expect(record.lines().join('')).not.toContain('secret-token');
    expect(parsed(record.lines())[0].fields).toEqual({ tok: SCRUBBED });
  });

  // M3 (final review): plan B's SessionRecord.protect, the same promise in JS.
  it('masks a protected value under any key from then on, and only from then on', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.warn('before', { problem: 'fake-token-0001' });
    logger.protect({ secrets: ['fake-token-0001'], streamIds: ['fake-stream-id-0001'] });
    logger.warn('after', { problem: 'fake-token-0001', kind: 'fake-stream-id-0001' });
    expect(parsed(record.lines()).map((line) => line.fields)).toEqual([
      { problem: 'fake-token-0001' },
      { problem: SCRUBBED, kind: SCRUBBED },
    ]);
  });

  it('masks a protected value in the event name too', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protect({ secrets: ['fake-token-0001'], streamIds: [] });
    logger.info('intent.fake-token-0001');
    logger.info('intent.stop');
    expect(parsed(record.lines()).map((line) => line.event)).toEqual([SCRUBBED, 'intent.stop']);
  });

  it('only ever adds: a second session’s protect keeps the first one’s values masked', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protect({ secrets: ['fake-token-000a'], streamIds: ['fake-stream-id-000a'] });
    logger.protect({ secrets: ['fake-token-000b'], streamIds: ['fake-stream-id-000b'] });
    logger.info('probe', {
      problem: 'fake-token-000a',
      kind: 'fake-stream-id-000a',
      reason: 'fake-token-000b',
      state: 'fake-stream-id-000b',
    });
    expect(parsed(record.lines())[0].fields).toEqual({
      problem: SCRUBBED,
      kind: SCRUBBED,
      reason: SCRUBBED,
      state: SCRUBBED,
    });
  });

  // M3, review I2: the code is masked in free text alone, and a later protect keeps an earlier code.
  it('masks a text-only value in free text alone, and keeps it masked after a later protect', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protect({ secrets: ['fake-token-000a'], streamIds: [], textOnly: ['fakecode000a'] });
    logger.protect({ secrets: ['fake-token-000b'], streamIds: [], textOnly: ['fakecode000b'] });
    logger.info('probe', {
      message: 'GET /codes/fakecode000a then /codes/fakecode000b',
      tag: 'fakecode000a',
    });
    expect(parsed(record.lines())[0].fields).toEqual({
      message: `GET /codes/${SCRUBBED} then /codes/${SCRUBBED}`,
      tag: 'fakecode000a',
    });
  });

  // N7: keyed on the session in hand, so a second code in the same process is covered as the first was.
  it('N7 masks free text whole between one session and the next, and keeps the first masked', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    logger.protect({ secrets: ['fake-token-000a'], streamIds: ['fake-stream-id-000a'] });
    logger.warn('first.held', { message: 'Connection refused (errno 111)' });
    logger.release();
    logger.warn('second.scanned', { message: 'GET /c?tok=fake-token-000b failed' });
    logger.protect({ secrets: ['fake-token-000b'], streamIds: ['fake-stream-id-000b'] });
    logger.warn('second.held', { message: 'retry fake-token-000a then fake-token-000b' });
    expect(record.lines().map((line) => parseRecordLine(line).fields.message)).toEqual([
      'Connection refused (errno 111)',
      SCRUBBED,
      `retry ${SCRUBBED} then ${SCRUBBED}`,
    ]);
  });

  it('drops entries below its floor', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0, minLevel: 'info' });
    logger.debug('noise');
    logger.info('kept');
    expect(parsed(record.lines()).map((line) => line.event)).toEqual(['kept']);
  });
});

const link = (n: number) => `dl_${String(n).padStart(2, '0')}${'B'.repeat(41)}`;

describe('the link bucket (F15)', () => {
  function rig() {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    // A session in hand, or free text is masked whole and the "shown before" witness below could never show.
    logger.protect({ secrets: ['tok-test-0000000000000'], streamIds: [] });
    /** Logs [secret] inside a message and returns what the record kept of the message. */
    const wrote = (secret: string) => {
      logger.info('probe', { message: `x ${secret} y` });
      return String(parsed(record.lines()).at(-1)?.fields.message);
    };
    return { record, logger, wrote };
  }

  it('protectLink masks a link’s secret in text and under a public url key, and only from then on', () => {
    const { record, logger, wrote } = rig();
    expect(wrote(link(1))).toBe(`x ${link(1)} y`);
    logger.protectLink(link(1));
    expect(wrote(link(1))).toBe(`x ${SCRUBBED} y`);
    logger.info('probe', { url: `https://stg.seazn.club/score/${link(1)}` });
    expect(parsed(record.lines()).at(-1)?.fields.url).toBe(SCRUBBED);
  });

  it('a repeated link never pushes another out of the bucket, and the 17th distinct one evicts the oldest', () => {
    const { logger, wrote } = rig();
    logger.protectLink(link(0));
    logger.protectLink(link(1));
    for (let i = 0; i < 20; i += 1) logger.protectLink(link(1));
    // Deduplicated by value: twenty repeats of link 1 did not push link 0 out.
    expect(wrote(link(0))).toBe(`x ${SCRUBBED} y`);
    for (let n = 2; n <= 16; n += 1) logger.protectLink(link(n));
    // 17 distinct links have been protected (0 to 16) into a bucket of 16: the oldest is out. D11: a link 16 re-issues old is long revoked.
    expect(wrote(link(0))).toBe(`x ${link(0)} y`);
    for (let n = 1; n <= 16; n += 1) expect(wrote(link(n))).toBe(`x ${SCRUBBED} y`);
  });

  it('a link asked for again is the newest: it outlives the one that was protected after it', () => {
    const { logger, wrote } = rig();
    logger.protectLink(link(0));
    for (let n = 1; n <= 15; n += 1) logger.protectLink(link(n));
    // 16 links held, link 0 the oldest. Heard again, it is the newest; the next new link evicts link 1, not link 0.
    logger.protectLink(link(0));
    logger.protectLink(link(16));
    expect(wrote(link(0))).toBe(`x ${SCRUBBED} y`);
    expect(wrote(link(1))).toBe(`x ${link(1)} y`);
    for (let n = 2; n <= 16; n += 1) expect(wrote(link(n)), `link ${n}`).toBe(`x ${SCRUBBED} y`);
  });

  it('a pairing token is never evicted by links, and a later protect keeps the links', () => {
    const { logger, wrote } = rig();
    for (let n = 0; n <= 30; n += 1) logger.protectLink(link(n));
    expect(wrote('tok-test-0000000000000')).toBe(`x ${SCRUBBED} y`);
    logger.protect({ secrets: ['tok-test-0000000000001'], streamIds: [] });
    expect(wrote(link(30))).toBe(`x ${SCRUBBED} y`);
  });

  it('release forgets nothing: free text is masked whole, and the next protect keeps the links', () => {
    const { logger, wrote } = rig();
    logger.protectLink(link(1));
    logger.release();
    expect(wrote('anything')).toBe(SCRUBBED);
    logger.protect({ secrets: ['tok-test-0000000000002'], streamIds: [] });
    expect(wrote(link(1))).toBe(`x ${SCRUBBED} y`);
  });

  // N7 stays true across a link: the Ended card asks for a link after the viewfinder let its session go, and a
  // link is not a session. Free text stays masked whole until a `protect` puts the next session in hand.
  it('a link does not put a session in hand: after release, a link leaves free text masked whole', () => {
    const { logger, wrote } = rig();
    logger.release();
    logger.protectLink(link(1));
    expect(wrote('anything')).toBe(SCRUBBED);
    // And with no session ever in hand.
    const fresh = createRingRecord();
    const bare = createLogger({ record: fresh, now: () => 0 });
    bare.protectLink(link(2));
    bare.info('probe', { message: 'anything' });
    expect(parsed(fresh.lines()).at(-1)?.fields.message).toBe(SCRUBBED);
  });

  it('a blank link secret is never held: it masks nothing and takes no place in the bucket', () => {
    const { logger, wrote } = rig();
    for (let n = 0; n <= 14; n += 1) logger.protectLink(link(n));
    logger.protectLink('');
    logger.protectLink(link(15));
    // 16 real links and a blank: had the blank taken a place, link 0 would be out of the bucket.
    for (let n = 0; n <= 15; n += 1) expect(wrote(link(n)), `link ${n}`).toBe(`x ${SCRUBBED} y`);
    expect(wrote('plain words')).toBe('x plain words y');
  });
});
