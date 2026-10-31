import { layout, space } from '@/ui/theme/tokens';
import { typeScale, type TypeRole } from '@/ui/theme/type';

/** The sizes a pad half's score is set at: `scoreLarge`, `score`, or `scoreCompact`, a step down each, in one face. */
export type ScoreRole = Extract<TypeRole, 'scoreLarge' | 'score' | 'scoreCompact'>;

/**
 * The height a half needs to hold its content with the score set in `role`: its padding, the names (two lines of
 * `label`, taller than the serving plate beside them), the score's line and the bottom row, where the games line
 * (`control`) and the hint (`metricUnit`; owner ruling 14) share one line, as tall as the taller of the two.
 */
export function halfNeeds(role: ScoreRole): number {
  return (
    2 * space.md +
    layout.padNameLines * typeScale.label.lineHeight +
    typeScale[role].lineHeight +
    Math.max(typeScale.control.lineHeight, typeScale.metricUnit.lineHeight)
  );
}

/**
 * The score's size in a half, from the half's height as laid out (`onLayout`): the largest that fits, so a short
 * phone, or a card standing above the halves, never runs the digits into the other half. Not measured yet (null),
 * `score`. padFit.test.ts holds the three needs and the phones they fit.
 */
export function scoreRole(halfHeight: number | null): ScoreRole {
  if (halfHeight === null) return 'score';
  if (halfHeight >= halfNeeds('scoreLarge')) return 'scoreLarge';
  return halfHeight >= halfNeeds('score') ? 'score' : 'scoreCompact';
}
