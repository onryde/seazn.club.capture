import type { Bootstrap } from '@/domain/scoring/wire';

/**
 * What Home calls a match (design §6.3, "4 taps from Match 4 not sent yet"; plan S2-1 Task 10): the organiser's own
 * number for it ("Match 4"), else the two sides as the Live Stream label puts them ("A. Sharma v L. Chen"), else the
 * competition. Empty when the organiser typed none of them; the card then says "another match". Never an id.
 */
export function matchLabelOf(from: Pick<Bootstrap, 'context' | 'sides'>): string {
  const { context, sides } = from;
  const match = (context.match ?? '').trim();
  if (match !== '') return match;
  const home = sides.home?.name.trim() ?? '';
  const away = sides.away?.name.trim() ?? '';
  if (home !== '' && away !== '') return `${home} v ${away}`;
  return context.competition.trim();
}
