import type { Bootstrap } from '@/domain/scoring/wire';

/**
 * What Home calls a match (design §6.3; plan S2-1 Task 10): the two sides as the Live Stream label puts them, then the
 * organiser's own number for it ("A. Sharma v L. Chen · Match 4"; owner, 2026-11-12, when Home showed only "F·1"). The
 * sides alone with no number, the number alone while a seat has no side, else the competition. Empty when the organiser
 * typed none of them; the card then says "another match". Never an id.
 */
export function matchLabelOf(from: Pick<Bootstrap, 'context' | 'sides'>): string {
  const { context, sides } = from;
  const match = (context.match ?? '').trim();
  const home = sides.home?.name.trim() ?? '';
  const away = sides.away?.name.trim() ?? '';
  const both = home !== '' && away !== '' ? `${home} v ${away}` : '';
  if (both !== '') return match === '' ? both : `${both} · ${match}`;
  if (match !== '') return match;
  return context.competition.trim();
}
