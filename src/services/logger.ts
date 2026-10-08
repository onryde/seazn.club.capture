import { scrubEvent, scrubFields, type HeldSecrets, type LogFields } from '@/services/scrub';
import type { LogLevel, SessionRecord } from '@/services/sessionRecord';

/**
 * The one levelled logger (AGENTS §11). There is no console anywhere: every
 * entry lands in the session record, scrubbed by the allow-list first.
 */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /**
   * M3: from now on these values never reach the record (plan B's
   * `SessionRecord.protect`), and `textOnly` (the code) never reaches free
   * text. It only ever adds: a value that was a secret in this process stays
   * masked.
   */
  protect(held: HeldSecrets): void;
  /**
   * F15: a scoring link's secret (`dl_...`) reached JS. From now on it never reaches the record. A bucket of its own
   * (the newest `LINK_SECRETS`, deduplicated by value), so a link never evicts the pairing token `protect` holds, and
   * it does NOT put a session in hand: free text stays masked as `release` left it (N7).
   */
  protectLink(secret: string): void;
  /**
   * N7: the viewfinder has let its session go. What was protected stays
   * masked; free text is masked whole until the next `protect` (CD6).
   */
  release(): void;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

/** F15: how many scoring links the record remembers to mask. Each is one `dl_` secret of 46 characters. */
export const LINK_SECRETS = 16;

const unique = (values: readonly string[]): string[] => [...new Set(values)];

export function createLogger(deps: {
  record: SessionRecord;
  now: () => number;
  minLevel?: LogLevel;
}): Logger {
  const floor = RANK[deps.minLevel ?? 'debug'];
  // Two buckets, composed into `held`: the session's own (never evicted) and the scoring links' (capped, F15).
  let base: Required<HeldSecrets> = { secrets: [], streamIds: [], textOnly: [] };
  let links: string[] = [];
  let held: Required<HeldSecrets> = base;
  const compose = (): void => {
    held = { ...base, secrets: unique([...base.secrets, ...links]) };
  };
  // N7: keyed on the session in hand, not on "anything was ever protected", so a
  // second code in the same process is covered as the first was.
  let inHand = false;
  const protect = (more: HeldSecrets): void => {
    base = {
      secrets: unique([...base.secrets, ...more.secrets]),
      streamIds: unique([...base.streamIds, ...more.streamIds]),
      textOnly: unique([...base.textOnly, ...(more.textOnly ?? [])]),
    };
    compose();
    inHand = true;
  };
  const protectLink = (secret: string): void => {
    if (secret === '') return;
    links = [...links.filter((existing) => existing !== secret), secret].slice(-LINK_SECRETS);
    compose();
  };
  const release = (): void => {
    inHand = false;
  };
  const at =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      if (RANK[level] < floor) return;
      const entry = {
        atMs: deps.now(),
        level,
        event: scrubEvent(event, held),
        fields: scrubFields(fields, held, inHand),
      };
      deps.record.append(entry);
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    protect,
    protectLink,
    release,
  };
}
