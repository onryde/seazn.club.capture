import { resultStands } from '@/domain/scoring/queue';
import { isDecided } from '@/domain/scoring/scoringMatchReads';
import { deadOf, foldRead, type MatchState } from '@/domain/scoring/scoringMatchState';
import { carriedForwardBy } from '@/domain/scoring/wire';

/**
 * A match that is over, as Home's card says it (owner ruling 41, 2026-11-02: "if match is decided then can we say
 * continue or close?"). `score` is the sport's line of the games over ("21–15, 21–18"), empty when none is.
 */
export type Finish = { readonly score: string };

/**
 * Whether the match is over, by the pad's own notions and no other: the sport says it is decided (`isDecided`, the
 * rule that paces the bootstrap read), or the server finalized it (the bootstrap's status, or the queue file's word,
 * which a finalize leaves), or the web carried its result forward (the queue file's word, which the 403 leaves, or the
 * bootstrap's View-only reason: only a settled match can have been). A cancelled match is none of these: nothing was
 * decided and there is no score. A match with no bootstrap held, or one that names another sport, is not known to be
 * anything: null.
 *
 * Pure: what it says of a match opened from the phone's files with no signal is what the pad draws first. Taps still
 * queued are folded as the pad folds them, so the caller (Home) asks only when nothing is unsent. The exception is a
 * result that stands (finalized, or carried forward): its score is the server's ledger alone (`foldRead`), whatever
 * taps the queue still holds, and Home asks then too (controller, 2026-11-04).
 */
export function finishOf(state: MatchState): Finish | null {
  const { bootstrap, sport } = state;
  if (bootstrap === null || bootstrap.sportKey !== sport.key) return null;
  const closed = resultStands(deadOf(state));
  const locked = bootstrap.status === 'finalized' || carriedForwardBy(bootstrap);
  if (!closed && !locked && !isDecided(state)) return null;
  const fold = foldRead(state);
  return { score: fold?.kind === 'folded' ? sport.resultLine(fold.display) : '' };
}
