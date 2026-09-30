import { descriptorToWire, parseDescriptor } from '@/domain/credentials/parseDescriptor';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { Mode, ModeCode } from '@/domain/mode/Mode';

/**
 * A code kept so the app can reopen into its mode (S0 spec §4). Scores,
 * approvals and engine state are never saved — native owns the engine.
 *
 * `expiresAt` is stored rather than re-derived from `raw`, so a reopen can
 * name the expiry ("expired at 18:40") without parsing a code it no longer
 * trusts. A stream code keeps the descriptor the server gave at scan, "cached
 * with the session" (S1 spec §2), so the venue's zone and the session's URLs
 * survive a restart.
 */
export type SavedCode = {
  readonly mode: Mode;
  readonly raw: string;
  /** Stream codes only: shown on the Continue card and the stream screen. */
  readonly slot: number | null;
  readonly savedAt: Date;
  /** The QR's `exp` (D31). */
  readonly expiresAt: Date | null;
  /** Stream codes only, and required for them: a stream record without one is dropped. */
  readonly descriptor: SessionDescriptor | null;
};

const VERSION = 2;
const MODES: readonly Mode[] = ['stream', 'scoring', 'dashboard'];

export function savedCodeFrom(
  code: ModeCode,
  now: Date,
  descriptor: SessionDescriptor | null,
): SavedCode {
  const stream = code.mode === 'stream';
  return {
    mode: code.mode,
    raw: code.raw,
    slot: stream ? code.slot : null,
    savedAt: now,
    expiresAt: stream ? code.expiresAt : null,
    descriptor,
  };
}

/** Every time the operator reads for this code is in the venue's zone (spec §2). */
export function venueZone(code: SavedCode): string | null {
  return code.descriptor?.venueTimezone ?? null;
}

export function encodeSavedCode(code: SavedCode): string {
  return JSON.stringify({
    v: VERSION,
    mode: code.mode,
    raw: code.raw,
    slot: code.slot,
    savedAt: code.savedAt.getTime(),
    expiresAt: code.expiresAt?.getTime() ?? null,
    descriptor: code.descriptor === null ? null : descriptorToWire(code.descriptor),
  });
}

/**
 * Clean slate (S0 decision 12): an unknown or unreadable record is not
 * migrated, and neither is v1 or a stream record with no descriptor (D28).
 * The caller deletes it.
 */
export function decodeSavedCode(text: string): SavedCode | null {
  const data = parse(text);
  if (data === null || data.v !== VERSION) return null;
  const mode = decodeMode(typeof data.mode === 'string' ? data.mode : null);
  if (mode === null || typeof data.raw !== 'string' || typeof data.savedAt !== 'number')
    return null;
  if (!isTimeOrNull(data.expiresAt) || !isSlotOrNull(data.slot)) return null;
  const descriptor = decodeDescriptor(data.descriptor);
  if (descriptor === false || (mode === 'stream' && descriptor === null)) return null;
  return {
    mode,
    raw: data.raw,
    slot: data.slot,
    savedAt: new Date(data.savedAt),
    expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt),
    descriptor,
  };
}

/** `false` is present but unreadable, which drops the whole record. */
function decodeDescriptor(value: unknown): SessionDescriptor | null | false {
  if (value === null || value === undefined) return null;
  const parsed = parseDescriptor(value);
  return parsed.ok ? parsed.value : false;
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
