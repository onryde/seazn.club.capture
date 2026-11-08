import type { MatchDay } from '@/domain/matchday/matchDay';
import { sameCode, savedCodeName, type CodeName } from '@/domain/mode/codeName';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';

export type ContinueCopy =
  | { readonly kind: 'pairing' }
  | { readonly kind: 'paired'; readonly label: string }
  | { readonly kind: 'saved'; readonly slot: number | null; readonly validTill: string | null }
  /** S4 design §4: the Match Day card. `scope` is null for a whole-competition code, whose scope is the competition. */
  | { readonly kind: 'matchday'; readonly competition: string; readonly scope: string | null };

export type MatchDayCopy = Extract<ContinueCopy, { kind: 'matchday' }>;

/**
 * Amendment §2's Home: a paired code says so and what it waits for; any other
 * saved code says its slot, and its expiry when it has one (CD39: `exp` is
 * optional, A1). The card is shown only for a saved, unexpired code (useHome).
 * A held broadcast never reaches Home (AGENTS §6, Task 24's route rule), so
 * there is no live row.
 */
export function continueCard(input: {
  /** The engine is still Pairing: `engine` reads it as paired, as the reopen rules need. */
  pairing: boolean;
  saved: SavedCode;
  engine: EngineStatus;
  held: CodeName;
  heldLabel: string | null;
  validTill: string | null;
}): ContinueCopy {
  const { saved, engine, held } = input;
  if (engine === 'paired' && sameCode(held, savedCodeName(saved))) {
    // Review C5 I-4: never "Paired" before native has paired; a pair can still fail.
    if (input.pairing) return { kind: 'pairing' };
    // A pairing that names no label of its own: the saved waiting fields name it.
    return { kind: 'paired', label: input.heldLabel || saved.stream?.waiting.label || '' };
  }
  return { kind: 'saved', slot: saved.slot, validTill: input.validTill };
}

/**
 * S4 design §4: the Match Day card, "Match Day · SAFE Open · Hall A", named from the day's last good copy (the cache,
 * which belongs to the saved code). None before there is a copy (a code saved before its day opened knows no names),
 * and none from the day's end, when the code answers MD_ENDED: the tile says "Match Day ended" and forgets it. A
 * whole-competition code's label is the competition's own name (the day contract), so the card says it once.
 */
export function matchDayCard(
  cached: { readonly day: MatchDay } | null,
  now: Date,
): MatchDayCopy | null {
  if (cached === null || dayHasEnded(cached.day, now)) return null;
  const { competition, scope } = cached.day;
  const named = scope.kind === 'competition' ? null : scope.label;
  return { kind: 'matchday', competition: competition.name, scope: named };
}

/** S4 design §3: a day code ends at its day's end, `expiresAt`, the instant the server answers MD_ENDED from. */
export function dayHasEnded(day: { readonly expiresAt: Date }, now: Date): boolean {
  return day.expiresAt.getTime() <= now.getTime();
}
