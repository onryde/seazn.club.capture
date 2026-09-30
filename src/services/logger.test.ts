import { describe, expect, it } from 'vitest';
import { createLogger } from '@/services/logger';
import { SCRUBBED } from '@/services/scrub';
import { createRingRecord } from '@/services/sessionRecord';

const parsed = (lines: readonly string[]) => lines.map((line) => JSON.parse(line));

describe('the logger', () => {
  it('writes each level to the record, stamped with the clock', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => Date.parse('2026-10-03T13:00:00Z') });
    logger.warn('kv.timeout', { op: 'set' });
    expect(parsed(record.lines())).toEqual([
      { at: '2026-10-03T13:00:00.000Z', level: 'warn', event: 'kv.timeout', fields: { op: 'set' } },
    ]);
  });

  it('scrubs before anything reaches the record', () => {
    const record = createRingRecord();
    createLogger({ record, now: () => 0 }).error('descriptor.error', { tok: 'secret-token' });
    expect(record.lines().join('')).not.toContain('secret-token');
    expect(parsed(record.lines())[0].fields).toEqual({ tok: SCRUBBED });
  });

  it('drops entries below its floor', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0, minLevel: 'info' });
    logger.debug('noise');
    logger.info('kept');
    expect(parsed(record.lines()).map((line) => line.event)).toEqual(['kept']);
  });
});
