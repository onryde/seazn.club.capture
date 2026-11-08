import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { KickRow } from '@/ui/components/KickRow';
import { colour } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A team's kicks in a shootout (S2-5 design §6.5; plan P Task 10): ● for a kick scored, ○ for one missed, in the order
// taken; a screen reader hears the count. Generic words: the row names no sport.

const saidIn = (dictionary: Record<string, string>, scored: number, taken: number) =>
  (dictionary['scoring.pad.kicks.said'] ?? '')
    .replace('{scored}', String(scored))
    .replace('{taken}', String(taken));

describe('KickRow', () => {
  it('KickRow says 3 scored of 4', () => {
    renderWithPorts(<KickRow kicks={[true, true, false, true]} />);
    const row = screen.getByLabelText(saidIn(en, 3, 4));
    expect(saidIn(en, 3, 4)).toBe('3 scored of 4');
    const marks = within(row).getAllByTestId(/^kick-/);
    expect(marks.map((mark) => mark.getAttribute('data-testid'))).toEqual([
      'kick-scored',
      'kick-scored',
      'kick-missed',
      'kick-scored',
    ]);
  });

  it('fills a scored kick in lime and rings a missed one in lilac', () => {
    renderWithPorts(<KickRow kicks={[true, false]} />);
    const scored = screen.getByTestId('kick-scored');
    const missed = screen.getByTestId('kick-missed');
    expect(getComputedStyle(scored).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(missed).borderTopColor).toBe(edgeOf(colour.ink3));
    expect(getComputedStyle(missed).backgroundColor).not.toBe(fillOf(colour.lime));
  });

  it('says none of none before the team’s first kick, with no marks', () => {
    renderWithPorts(<KickRow kicks={[]} />);
    const row = screen.getByLabelText(saidIn(en, 0, 0));
    expect(within(row).queryAllByTestId(/^kick-/)).toEqual([]);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('says the count in %s, from the dictionary', (language, dictionary) => {
    renderWithPorts(<KickRow kicks={[true, false, true]} />, { deviceLanguages: [language] });
    expect(dictionary['scoring.pad.kicks.said']).toBeTruthy();
    expect(screen.getByLabelText(saidIn(dictionary, 2, 3))).toBeTruthy();
  });
});
