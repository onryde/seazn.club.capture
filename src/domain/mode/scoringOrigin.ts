import type { Mode } from '@/domain/mode/Mode';

/**
 * Where Remote Scoring's Back goes (S4 design §6): from Match Day it is the list, named "Back to {court}" in place of S2's
 * Back to Home; from a scan of the match's own code it is Home. Match Day's origin needs both the mode active and a
 * match open, so a stale open under another mode is never Match Day's.
 */
export type ScoringOrigin =
  { readonly back: 'home' } | { readonly back: 'matchday'; readonly courtName: string };

export function scoringOrigin(
  active: Mode | null,
  open: { readonly fixtureId: string; readonly courtName: string } | null,
): ScoringOrigin {
  if (active !== 'matchday' || open === null) return { back: 'home' };
  return { back: 'matchday', courtName: open.courtName.trim() };
}
