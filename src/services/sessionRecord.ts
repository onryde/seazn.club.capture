import type { SessionState } from '@/domain/session/SessionState';
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
  // Built, never assigned: an assignment to `__proto__` calls its setter and the field is lost to every reader, the
  // upload's fail-closed check included (fix round 1 of Batch 11, finding 2 of its review).
  const fields = Object.fromEntries(
    Object.entries(written).map(([key, value]) => {
      const original = key.startsWith('field_') ? key.slice('field_'.length) : key;
      return [RESERVED_KEYS.has(original) ? original : key, value];
    }),
  );
  return {
    atMs: Date.parse(String(at)),
    level: typeof level === 'string' ? level : 'info',
    event: String(kind),
    fields,
  };
}

/** The JS ring, which also takes native's lines as written (Task 26): one view of the record. */
export type RingRecord = SessionRecord & { appendLine(line: string): void };

export function createRingRecord(capacity: number = RECORD_CAPACITY): RingRecord {
  let lines: readonly string[] = [];
  const listeners = new Set<() => void>();
  const push = (line: string) => {
    const kept = lines.length < capacity ? lines : lines.slice(lines.length - capacity + 1);
    lines = [...kept, line];
    for (const listener of listeners) listener();
  };
  return {
    append: (entry) => push(toRecordLine(entry)),
    appendLine: push,
    lines: () => lines,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

/**
 * CD7: JS entries go to native's record while `route.active()`, and to the
 * ring otherwise. Native's lines come back through `ring.appendLine`, so the
 * ring stays the one view: `lines` and `subscribe` are the ring's.
 */
export function createRoutedRecord(
  ring: RingRecord,
  route: { active(): boolean; forward(entry: LogEntry): void },
): SessionRecord {
  return {
    append: (entry) => (route.active() ? route.forward(entry) : ring.append(entry)),
    lines: ring.lines,
    subscribe: ring.subscribe,
  };
}

/**
 * M16: JS lines go to native's record only while native holds a pairing. Native
 * keeps one record per pairing, from `pair` to Idle (amendment, The engine
 * port), so every kind but idle files under it, Ended included until the reset.
 */
export function recordGoesNative(nativeWired: boolean, kind: SessionState['kind']): boolean {
  return nativeWired && kind !== 'idle';
}
