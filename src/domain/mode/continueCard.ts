import { sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';

/**
 * What the card says. Each copy carries the court of a court code (court stream spec 2026-11-14 §6.5), or null on a
 * fixture's code: a court code is named by its court, not its match.
 */
export type ContinueCopy =
  | { readonly kind: 'pairing'; readonly court: string | null }
  | { readonly kind: 'paired'; readonly label: string; readonly court: string | null }
  | {
      readonly kind: 'saved';
      readonly slot: number | null;
      readonly validTill: string | null;
      readonly court: string | null;
    };

/**
 * Amendment §2's Home: a paired code says so and what it waits for; any other
 * saved code says its slot, and its expiry when it has one (CD39: `exp` is
 * optional, A1). The card is shown only for a saved, unexpired code (useHome).
 * A held broadcast never reaches Home (AGENTS §6, Task 24's route rule), so
 * there is no live row. A court code's card names the court: the engine's own when it holds THIS saved code (the same
 * `sameCode` test as the paired card), else the saved waiting fields' (a cold start, the engine Idle).
 */
export function continueCard(input: {
  /** The engine is still Pairing: `engine` reads it as paired, as the reopen rules need. */
  pairing: boolean;
  saved: SavedCode;
  engine: EngineStatus;
  held: CodeName;
  heldLabel: string | null;
  /** The court the engine's pairing holds (`selectCourt`), or null. Counts only for the saved code it holds. */
  heldCourt: string | null;
  validTill: string | null;
}): ContinueCopy {
  const { saved, engine, held } = input;
  const holds = engine === 'paired' && sameCode(held, savedCodeName(saved));
  const court = (holds ? input.heldCourt : null) ?? saved.stream?.waiting.court ?? null;
  if (holds) {
    // Review C5 I-4: never "Paired" before native has paired; a pair can still fail.
    if (input.pairing) return { kind: 'pairing', court };
    // A pairing that names no label of its own: the saved waiting fields name it.
    return { kind: 'paired', label: input.heldLabel || saved.stream?.waiting.label || '', court };
  }
  return { kind: 'saved', slot: saved.slot, validTill: input.validTill, court };
}

/** S4 design §3: a day code ends at its day's end, `expiresAt`, the instant the server answers MD_ENDED from. */
export function dayHasEnded(day: { readonly expiresAt: Date }, now: Date): boolean {
  return day.expiresAt.getTime() <= now.getTime();
}
