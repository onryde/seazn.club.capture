import {
  parseWaitingFields,
  waitingToWire,
  type WaitingFields,
} from '@/domain/credentials/waitingFields';
import { httpsHost, isRecord } from '@/domain/credentials/wire';
import type { Mode, ModeCode } from '@/domain/mode/Mode';

/**
 * What a stream code keeps beside the QR (amendment §3): the waiting fields
 * and the three URLs (`codeUrl` here, the beat and start URLs in `waiting`),
 * so a cold start can re-pair with no fetch. Never `cred`. `tapToPair` marks
 * a code whose pairing failed permanently: only Continue re-pairs it (Task 24).
 */
export type SavedStream = {
  readonly waiting: WaitingFields;
  readonly codeUrl: string;
  readonly tapToPair: boolean;
};

/**
 * What a scoring code keeps beside the mode (plan S2-1 Task 10): the match it opened, which is the key of its link in
 * the secure store (`scoring.link.{fixtureId}`) and of its queue file, and what Home calls the match. The link's token
 * is not here: the secure store holds it once, under the link's own key, so a new link for the same match is one write.
 */
export type SavedScoring = {
  readonly fixtureId: string;
  /** The organiser's own words for the match ("Match 4"), as of the last bootstrap; may be empty. */
  readonly label: string;
};

/**
 * A code kept so the app can reopen into its mode (S0 spec §4). Scores,
 * approvals and engine state are never saved — native owns the engine.
 *
 * `expiresAt` is stored rather than re-derived from `raw`, so a reopen can
 * name the expiry ("expired at 18:40") without parsing a code it no longer
 * trusts.
 */
export type SavedCode = {
  readonly mode: Mode;
  /** The QR whole. A stream code's holds `tok`: never log it. */
  readonly raw: string;
  /** Stream codes only: shown on the Continue card and the stream screen. */
  readonly slot: number | null;
  readonly savedAt: Date;
  /** The QR's `exp`, or null when it has none (A1) and for other modes. */
  readonly expiresAt: Date | null;
  /** Stream codes only, and required for them: a stream record without one is dropped. */
  readonly stream: SavedStream | null;
  /** Scoring codes only, and required for them: a scoring record without one is dropped. */
  readonly scoring: SavedScoring | null;
};

const VERSION = 3;
const MODES: readonly Mode[] = ['stream', 'scoring', 'dashboard'];

export function savedCodeFrom(
  code: ModeCode,
  now: Date,
  stream: SavedStream | null,
  scoring: SavedScoring | null = null,
): SavedCode {
  const isStream = code.mode === 'stream';
  const isScoring = code.mode === 'scoring';
  return {
    mode: code.mode,
    // A scoring link's token is the secure store's, under its own key: never a second copy here.
    raw: isScoring ? '' : code.raw,
    slot: isStream ? code.slot : null,
    savedAt: now,
    expiresAt: isStream ? code.expiresAt : null,
    stream: isStream ? stream : null,
    scoring: isScoring ? scoring : null,
  };
}

/** Every time the operator reads for this code is in the venue's zone (spec §2). */
export function venueZone(code: SavedCode): string | null {
  return code.stream?.waiting.venueTimezone || null;
}

export function encodeSavedCode(code: SavedCode): string {
  return JSON.stringify({
    v: VERSION,
    mode: code.mode,
    raw: code.raw,
    slot: code.slot,
    savedAt: code.savedAt.getTime(),
    expiresAt: code.expiresAt?.getTime() ?? null,
    stream:
      code.stream === null
        ? null
        : {
            waiting: waitingToWire(code.stream.waiting),
            codeUrl: code.stream.codeUrl,
            tapToPair: code.stream.tapToPair,
          },
    scoring: code.scoring === null ? null : { ...code.scoring },
  });
}

/**
 * Clean slate (S0 decision 12): an unknown or unreadable record is not
 * migrated, and neither is v1 (D28) nor v2, which held the session's
 * credentials, nor a stream record with no `stream` part. The caller deletes it.
 */
export function decodeSavedCode(text: string): SavedCode | null {
  const data = parse(text);
  if (data === null || data.v !== VERSION) return null;
  const mode = decodeMode(typeof data.mode === 'string' ? data.mode : null);
  if (mode === null || typeof data.raw !== 'string' || typeof data.savedAt !== 'number')
    return null;
  if (!isTimeOrNull(data.expiresAt) || !isSlotOrNull(data.slot)) return null;
  const stream = decodeStream(data.stream);
  if (stream === false || (mode === 'stream' && stream === null)) return null;
  const scoring = mode === 'scoring' ? decodeScoring(data.scoring) : null;
  if (mode === 'scoring' && scoring === null) return null;
  return {
    mode,
    raw: data.raw,
    slot: data.slot,
    savedAt: new Date(data.savedAt),
    expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt),
    stream,
    scoring,
  };
}

/** A scoring part that does not read (no match named) is no part: the record is dropped. */
function decodeScoring(value: unknown): SavedScoring | null {
  if (!isRecord(value) || typeof value.fixtureId !== 'string' || value.fixtureId === '')
    return null;
  return typeof value.label === 'string'
    ? { fixtureId: value.fixtureId, label: value.label }
    : null;
}

/**
 * `false` is present but unreadable, which drops the whole record. The waiting
 * fields are read again by the one parser the scan used: the code's URL was
 * built from the build's origin at the scan, so its host is the one the beat
 * and start URLs are held to, and a foreign one drops the record.
 */
function decodeStream(value: unknown): SavedStream | null | false {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.codeUrl !== 'string' || typeof value.tapToPair !== 'boolean')
    return false;
  const waiting = parseWaitingFields(value.waiting, httpsHost(value.codeUrl) ?? '');
  return waiting === null ? false : { waiting, codeUrl: value.codeUrl, tapToPair: value.tapToPair };
}

export function decodeMode(text: string | null): Mode | null {
  return MODES.find((mode) => mode === text) ?? null;
}

export function isExpired(code: SavedCode, now: Date): boolean {
  return code.expiresAt !== null && code.expiresAt.getTime() <= now.getTime();
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isTimeOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isSlotOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}
