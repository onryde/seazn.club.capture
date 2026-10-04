import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import {
  createRingRecord,
  createRoutedRecord,
  parseRecordLine,
  recordGoesNative,
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

describe('the routed record (CD7, M16)', () => {
  it('CD7 sends entries to native while a pairing exists, to the ring otherwise; reads the ring', () => {
    const ring = createRingRecord();
    const forwarded: LogEntry[] = [];
    let active = false;
    const record = createRoutedRecord(ring, {
      active: () => active,
      forward: (entry) => forwarded.push(entry),
    });
    record.append(entry('before'));
    active = true;
    record.append(entry('during'));
    ring.appendLine('{"at":"1970-01-01T00:00:00.000Z","kind":"during"}');
    active = false;
    record.append(entry('after'));
    expect(forwarded.map((e) => e.event)).toEqual(['during']);
    expect(record.lines().map((line) => parseRecordLine(line).event)).toEqual([
      'before',
      'during',
      'after',
    ]);
  });

  it("tells the routed record's subscribers about native's lines too, and hands out the ring's array", () => {
    const ring = createRingRecord();
    const record = createRoutedRecord(ring, { active: () => true, forward: () => undefined });
    const listener = vi.fn();
    const unsubscribe = record.subscribe(listener);
    ring.appendLine('{"at":"1970-01-01T00:00:00.000Z","kind":"native"}');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(record.lines()).toBe(ring.lines());
    unsubscribe();
    ring.appendLine('{"at":"1970-01-01T00:00:00.000Z","kind":"later"}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps native's lines under the ring's capacity, as its own", () => {
    const ring = createRingRecord(2);
    ring.append(entry('a'));
    for (const kind of ['b', 'c'])
      ring.appendLine(`{"at":"1970-01-01T00:00:00.000Z","kind":"${kind}"}`);
    expect(ring.lines().map((line) => parseRecordLine(line).event)).toEqual(['b', 'c']);
  });

  /**
   * Native keeps one record per pairing, from `pair` to Idle (amendment, The engine port), so every
   * kind but idle files a JS line under it, Ended included until the reset. Every kind, both ways.
   */
  const KINDS: Readonly<Record<SessionState['kind'], boolean>> = {
    idle: false,
    pairing: true,
    paired: true,
    arming: true,
    armed: true,
    connecting: true,
    publishing: true,
    degraded: true,
    reconnecting: true,
    ended: true,
  };
  const rows = Object.entries(KINDS).flatMap(([kind, native]) => [
    [true, kind as SessionState['kind'], native] as const,
    [false, kind as SessionState['kind'], false] as const,
  ]);

  // The table's size, so a kind dropped from it reds here (PV12).
  it('M16 sweeps all 10 kinds, wired and not', () => {
    expect(rows).toHaveLength(20);
  });

  it.each(rows)(
    'M16 native wired %s, engine %s: JS lines go to native %s',
    (wired, kind, native) => {
      expect(recordGoesNative(wired, kind)).toBe(native);
    },
  );
});
