import type { LogFields } from '@/services/scrub';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One entry, already scrubbed. Scrubbing happens before an entry exists, never after. */
export type LogEntry = {
  readonly atMs: number;
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
};

/**
 * The session record (spec §5): what happened at the ground, in order, as
 * NDJSON. In Plan A it is a JS ring buffer; phase 4 routes entries into the
 * native record while a session exists (D20). Shaped for useSyncExternalStore:
 * `lines()` returns the same array until something is appended.
 */
export interface SessionRecord {
  append(entry: LogEntry): void;
  lines(): readonly string[];
  subscribe(onChange: () => void): () => void;
}

export const RECORD_CAPACITY = 1000;

/** Fields named like the line's own keys are written as `field_<key>`, as native does. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['at', 'kind', 'level']);

/**
 * One flat NDJSON line, the same shape native writes: `{at, kind, …fields}`,
 * with `level` after `kind` only when it is not `info` (CD7).
 */
export function toRecordLine({ atMs, level, event, fields }: LogEntry): string {
  const line: Record<string, unknown> = { at: new Date(atMs).toISOString(), kind: event };
  if (level !== 'info') line.level = level;
  for (const [key, value] of Object.entries(fields)) {
    line[RESERVED_KEYS.has(key) ? `field_${key}` : key] = value;
  }
  return JSON.stringify(line);
}

export type RecordedEntry = {
  readonly atMs: number;
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/**
 * A line back into its parts, either side's. No `level` means `info`, which
 * neither side writes. A `field_<key>` rename is undone, so a reader sees the
 * fields as they were logged.
 */
export function parseRecordLine(line: string): RecordedEntry {
  const { at, kind, level, ...written } = JSON.parse(line) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(written)) {
    const original = key.startsWith('field_') ? key.slice('field_'.length) : key;
    fields[RESERVED_KEYS.has(original) ? original : key] = value;
  }
  return {
    atMs: Date.parse(String(at)),
    level: typeof level === 'string' ? level : 'info',
    event: String(kind),
    fields,
  };
}

export function createRingRecord(capacity: number = RECORD_CAPACITY): SessionRecord {
  let lines: readonly string[] = [];
  const listeners = new Set<() => void>();
  return {
    append: (entry) => {
      const kept = lines.length < capacity ? lines : lines.slice(lines.length - capacity + 1);
      lines = [...kept, toRecordLine(entry)];
      for (const listener of listeners) listener();
    },
    lines: () => lines,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
