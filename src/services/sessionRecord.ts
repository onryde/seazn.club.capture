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

export function toRecordLine({ atMs, level, event, fields }: LogEntry): string {
  return JSON.stringify({ at: new Date(atMs).toISOString(), level, event, fields });
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
