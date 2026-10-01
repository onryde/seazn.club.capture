import { describe, expect, it, vi } from 'vitest';
import {
  createRingRecord,
  parseRecordLine,
  toRecordLine,
  type LogEntry,
} from '@/services/sessionRecord';

const entry = (event: string, atMs = 0): LogEntry => ({ atMs, level: 'info', event, fields: {} });

describe('the session record', () => {
  it('writes one NDJSON line per entry, in order', () => {
    const record = createRingRecord();
    record.append(entry('first', Date.parse('2026-10-03T13:00:00Z')));
    record.append(entry('second'));
    expect(record.lines()).toHaveLength(2);
    // CD7: native's flat shape; an info line writes no level.
    expect(JSON.parse(record.lines()[0] ?? '')).toEqual({
      at: '2026-10-03T13:00:00.000Z',
      kind: 'first',
    });
  });

  it('keeps only the newest lines at capacity', () => {
    const record = createRingRecord(3);
    for (const name of ['a', 'b', 'c', 'd']) record.append(entry(name));
    expect(record.lines().map((line) => parseRecordLine(line).event)).toEqual(['b', 'c', 'd']);
  });

  it('hands out the same array until something is appended (useSyncExternalStore)', () => {
    const record = createRingRecord();
    const before = record.lines();
    expect(record.lines()).toBe(before);
    record.append(entry('x'));
    expect(record.lines()).not.toBe(before);
  });

  it('tells subscribers, and stops telling them once unsubscribed', () => {
    const record = createRingRecord();
    const listener = vi.fn();
    const unsubscribe = record.subscribe(listener);
    record.append(entry('x'));
    unsubscribe();
    record.append(entry('y'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('formats a line without the caller reshaping it', () => {
    expect(toRecordLine({ atMs: 0, level: 'warn', event: 'e', fields: { kind: 'k' } })).toBe(
      '{"at":"1970-01-01T00:00:00.000Z","kind":"e","level":"warn","field_kind":"k"}',
    );
  });

  it('CD7 writes the flat line native writes, renaming a field that reuses a line key', () => {
    const line = toRecordLine({
      atMs: 0,
      level: 'warn',
      event: 'probe',
      fields: { kind: 'x', ms: 3 },
    });
    expect(JSON.parse(line)).toEqual({
      at: '1970-01-01T00:00:00.000Z',
      kind: 'probe',
      level: 'warn',
      field_kind: 'x',
      ms: 3,
    });
    expect(parseRecordLine(line)).toEqual({
      atMs: 0,
      level: 'warn',
      event: 'probe',
      fields: { kind: 'x', ms: 3 },
    });
  });

  it('CD7 writes no level for info, as native does, and reads a missing level back as info', () => {
    const line = toRecordLine({ atMs: 0, level: 'info', event: 'probe', fields: {} });
    expect(line).toBe('{"at":"1970-01-01T00:00:00.000Z","kind":"probe"}');
    expect(parseRecordLine(line).level).toBe('info');
  });
});
