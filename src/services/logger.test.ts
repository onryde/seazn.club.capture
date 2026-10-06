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
