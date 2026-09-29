import type { Mode, ModeCode } from '@/domain/mode/Mode';

/**
 * A code kept so the app can reopen into its mode (spec §4). Scores,
 * approvals and engine state are never saved — native owns the engine.
 *
 * `expiresAt` is stored rather than re-derived from `raw`, so a reopen can
 * name the expiry ("expired at 18:40") without parsing a code it no longer
 * trusts. `venueTz` stays null until S1's descriptor supplies it.
 */
export type SavedCode = {
  readonly mode: Mode;
  readonly raw: string;
  /** Stream codes only: shown on the Continue card and the stream screen. */
  readonly slot: number | null;
  readonly savedAt: Date;
  readonly expiresAt: Date | null;
  readonly venueTz: string | null;
};

const VERSION = 1;
const MODES: readonly Mode[] = ['stream', 'scoring', 'dashboard'];

export function savedCodeFrom(code: ModeCode, now: Date): SavedCode {
  const stream = code.mode === 'stream';
  return {
    mode: code.mode,
    raw: code.raw,
    slot: stream ? code.slot : null,
    savedAt: now,
    expiresAt: stream ? code.expiresAt : null,
    venueTz: null,
  };
}

export function encodeSavedCode(code: SavedCode): string {
  return JSON.stringify({
    v: VERSION,
    mode: code.mode,
    raw: code.raw,
    slot: code.slot,
    savedAt: code.savedAt.getTime(),
    expiresAt: code.expiresAt?.getTime() ?? null,
    venueTz: code.venueTz,
  });
}

/**
 * Clean slate (spec decision 12): an unknown or unreadable record is not
 * migrated. The caller deletes it.
 */
export function decodeSavedCode(text: string): SavedCode | null {
  const data = parse(text);
  if (data === null || data.v !== VERSION) return null;
  const mode = decodeMode(typeof data.mode === 'string' ? data.mode : null);
  if (mode === null || typeof data.raw !== 'string' || typeof data.savedAt !== 'number')
    return null;
  if (!isTimeOrNull(data.expiresAt) || !isStringOrNull(data.venueTz)) return null;
  if (!isSlotOrNull(data.slot)) return null;
  return {
    mode,
    raw: data.raw,
    slot: data.slot,
    savedAt: new Date(data.savedAt),
    expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt),
    venueTz: data.venueTz,
  };
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

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSlotOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}
