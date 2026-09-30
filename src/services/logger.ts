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
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(deps: {
  record: SessionRecord;
  now: () => number;
  minLevel?: LogLevel;
}): Logger {
  const floor = RANK[deps.minLevel ?? 'debug'];
  const at =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      if (RANK[level] < floor) return;
      const entry = {
        atMs: deps.now(),
        level,
        event: scrubEvent(event),
        fields: scrubFields(fields),
      };
      deps.record.append(entry);
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
