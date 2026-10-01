import type { SessionSecrets } from '@/domain/credentials/StreamSession';
import { scrubEvent, scrubFields, type LogFields } from '@/services/scrub';
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
   * `SessionRecord.protect`). It only ever adds: a value that was a secret in
   * this process stays masked.
   */
  protect(held: SessionSecrets): void;
  /**
   * N7: the viewfinder has let its session go. What was protected stays
   * masked; free text is masked whole until the next `protect` (CD6).
   */
  release(): void;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(deps: {
  record: SessionRecord;
  now: () => number;
  minLevel?: LogLevel;
}): Logger {
  const floor = RANK[deps.minLevel ?? 'debug'];
  let held: SessionSecrets = { secrets: [], streamIds: [] };
  // N7: keyed on the session in hand, not on "anything was ever protected", so a
  // second code in the same process is covered as the first was.
  let inHand = false;
  const protect = (more: SessionSecrets): void => {
    held = {
      secrets: [...held.secrets, ...more.secrets],
      streamIds: [...held.streamIds, ...more.streamIds],
    };
    inHand = true;
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
    release,
  };
}
