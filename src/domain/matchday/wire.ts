import { isRecord, type WireError } from '@/domain/credentials/wire';
import { err, ok, type Result } from '@/domain/Result';

/**
 * The readers every Match Day parser shares (AGENTS §4: one parser per wire shape, and the shape stops in this
 * folder). The web's md_ routes answer in its v1 envelope, `{ok: true, data, requestId}`; each contract describes the
 * `data`. An error names a field by its path (`courts[0].now.status`) and a fixed reason, never the value: a scoring
 * link rides one of these answers. A field the contract does not name is ignored, so the web can add one.
 */
export type Read<T> = Result<T, WireError>;
export type Source = Record<string, unknown>;

/** Reads one value found at `at`, a path an error can name. */
export type Item<T> = (raw: unknown, at: string) => Read<T>;
/** Reads `source[key]`, found under `at`. */
export type Reader<T> = (source: Source, key: string, at: string) => Read<T>;

const pathOf = (at: string, key: string) => (at === '' ? key : `${at}.${key}`);

export const invalid = (field: string, reason: string): Read<never> =>
  err({ kind: 'invalid-field', field, reason });

/** The `data` of a v1 success envelope; anything else (a refusal, a bare object, a page) is no answer. */
export function successData(body: unknown): Read<Source> {
  if (!isRecord(body)) return err({ kind: 'not-an-object' });
  if (body.ok !== true) return invalid('ok', 'expected a success envelope');
  return field(objectItem)(body, 'data', '');
}

/** A field the contract requires, read by `item`. Absent is missing; null is the item's to judge. */
export function field<T>(item: Item<T>): Reader<T> {
  return (source, key, at) => {
    const path = pathOf(at, key);
    const value = source[key];
    return value === undefined ? err({ kind: 'missing-field', field: path }) : item(value, path);
  };
}

/** The contract's `anyOf [T, null]`: required, and null when it says so. */
export function nullable<T>(item: Item<T>): Item<T | null> {
  return (raw, at) => (raw === null ? ok(null) : item(raw, at));
}

/** A value `judge` accepts, or the field refused with `reason`. */
export function scalar<T>(judge: (raw: unknown) => T | undefined, reason: string): Item<T> {
  return (raw, at) => {
    const value = judge(raw);
    return value === undefined ? invalid(at, reason) : ok(value);
  };
}

/** An object, read field by field by `read`. */
export function objectOf<T>(read: (source: Source, at: string) => Read<T>): Item<T> {
  return (raw, at) => (isRecord(raw) ? read(raw, at) : invalid(at, 'expected an object'));
}

const objectItem: Item<Source> = objectOf((source) => ok(source));

/** A list, every item read by `item`; one bad item refuses the list. */
export function listOf<T>(item: Item<T>): Item<readonly T[]> {
  return (raw, at) => {
    if (!Array.isArray(raw)) return invalid(at, 'expected a list');
    const items: T[] = [];
    for (const [index, value] of (raw as readonly unknown[]).entries()) {
      const read = item(value, `${at}[${index}]`);
      if (!read.ok) return read;
      items.push(read.value);
    }
    return ok(items);
  };
}

/** Each field read, or the first refusal in the order they are listed. */
export function all<T extends object>(reads: { readonly [K in keyof T]: Read<T[K]> }): Read<T> {
  const value: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(reads) as [string, Read<unknown>][]) {
    if (!read.ok) return read;
    value[key] = read.value;
  }
  return ok(value as T);
}

/** A closed list of the web's words, each mapped to the phone's: a word outside it is refused, never guessed. */
export function oneOf<T>(words: ReadonlyMap<string, T>): Item<T> {
  return scalar(
    (raw) => (typeof raw === 'string' ? words.get(raw) : undefined),
    `expected one of ${[...words.keys()].join(', ')}`,
  );
}

/** Any string: the contract's `type: string` admits an empty one. */
export const text: Item<string> = scalar(
  (raw) => (typeof raw === 'string' ? raw : undefined),
  'expected a string',
);

/** The contract's `minLength: 1`. */
export const word: Item<string> = scalar(
  (raw) => (typeof raw === 'string' && raw !== '' ? raw : undefined),
  'expected a non-empty string',
);

export const flag: Item<boolean> = scalar(
  (raw) => (typeof raw === 'boolean' ? raw : undefined),
  'expected a boolean',
);

/** An id's shape, not its version: a match id is a path segment of the open, so nothing else gets through. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuid: Item<string> = scalar(
  (raw) => (typeof raw === 'string' && UUID.test(raw) ? raw : undefined),
  'expected a uuid',
);

/** The contract's `integer`, `minimum: 1`. */
export const countingNumber: Item<number> = scalar(
  (raw) => (Number.isSafeInteger(raw) && (raw as number) >= 1 ? (raw as number) : undefined),
  'expected an integer of at least 1',
);

/**
 * The contract's date-time: a UTC instant, `Z` and nothing else, its seconds optional and its fraction any length
 * (read to the millisecond). Read by hand rather than `Date.parse`, whose reading of anything past the ISO subset
 * differs between engines, Hermes included.
 */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z$/;
/** The contract's date: YYYY-MM-DD. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The instant `parts` name (year, month, day, hours, minutes, seconds), or undefined when the calendar has none. */
function utc(parts: readonly number[], ms: number): Date | undefined {
  const [year = 0, month = 0, day = 0, hours = 0, minutes = 0, seconds = 0] = parts;
  const at = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  const back = [
    at.getUTCFullYear(),
    at.getUTCMonth() + 1,
    at.getUTCDate(),
    at.getUTCHours(),
    at.getUTCMinutes(),
    at.getUTCSeconds(),
  ];
  return parts.every((part, index) => back[index] === part) ? at : undefined;
}

/** A UTC instant as a Date, or undefined. The refusal reads MD_NOT_OPEN's `opens_at` with it too. */
export function toInstant(raw: unknown): Date | undefined {
  const match = typeof raw === 'string' ? INSTANT.exec(raw) : null;
  if (match === null) return undefined;
  const [, year, month, day, hours, minutes, seconds = '0', fraction = ''] = match;
  const parts = [year, month, day, hours, minutes, seconds].map(Number);
  return utc(parts, Number(fraction.padEnd(3, '0').slice(0, 3)));
}

export const instant: Item<Date> = scalar(toInstant, 'expected a UTC instant');

/** A calendar day, kept as the text it is: it is a day in the code's zone, not an instant. */
export const calendarDay: Item<string> = scalar((raw) => {
  const match = typeof raw === 'string' ? DAY.exec(raw) : null;
  if (match === null) return undefined;
  return utc(match.slice(1).map(Number), 0) === undefined ? undefined : match[0];
}, 'expected a YYYY-MM-DD day');
