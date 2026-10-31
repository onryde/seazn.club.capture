import { layout, space } from '@/ui/theme/tokens';
import { typeScale, type TypeRole } from '@/ui/theme/type';

/** The sizes a pad half's score is set at: `score`, or `scoreCompact` one step down in the same face. */
export type ScoreRole = Extract<TypeRole, 'score' | 'scoreCompact'>;

/**
 * The height a half needs to hold its content with the score set in `role`: its padding, the names (two lines of
 * `label`, taller than the serving plate beside them), the score's line and the games line (`control`).
 */
export function halfNeeds(role: ScoreRole): number {
  return (
    2 * space.md +
    layout.padNameLines * typeScale.label.lineHeight +
    typeScale[role].lineHeight +
    typeScale.control.lineHeight
  );
}

/**
 * The score's size in a half, from the half's height as laid out (`onLayout`): `score` where it fits, `scoreCompact`
 * where it does not, so a short phone, or a card standing above the halves, never runs the digits into the other half.
 * Not measured yet (null), `score`. padFit.test.ts holds both needs and the phones they fit.
 */
export function scoreRole(halfHeight: number | null): ScoreRole {
  if (halfHeight === null) return 'score';
  return halfHeight >= halfNeeds('score') ? 'score' : 'scoreCompact';
}
