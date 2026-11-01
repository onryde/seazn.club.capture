import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchContext } from '@/domain/scoring/matchContext';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { MatchCard, type MatchCardRow } from '@/ui/components/MatchCard';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { layOut } from '../../../test/layOut';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner, 2026-11-01, option A, on build 715: the Start screen and the Not started card "looks like paste some text, we
// need a proper format also it can change per sport". One card for any sport: a header (where the match sits), the
// versus block (the sides, as the match label draws them, C2), and a rules table of the sport's rows.

type Dictionary = Readonly<Record<string, string>>;
const fill = (text: string, vars: Readonly<Record<string, string>>) =>
  Object.entries(vars).reduce((out, [name, value]) => out.replace(`{${name}}`, value), text);

/** The fake's two samples, as they type them. */
const SINGLES: MatchContext = {
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  sides: ['A. Sharma', 'L. Chen'],
};
const DOUBLES: MatchContext = {
  competition: 'Riverside Badminton Club Championships 2026',
  division: 'Open Mixed Doubles',
  round: 'Quarter-final',
  match: 'BAD0001',
  sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
};

/** Badminton's rows as the screen hands them over: the dictionary's words, filled with the preview's match. */
const badminton = (words: Dictionary): MatchCardRow[] =>
  (
    [
      ['format', 'scoring.badminton.rules.bestOf.other', { count: '3' }],
      ['points', 'scoring.badminton.rules.points.value', { points: '21', winBy: '2' }],
      ['cap', 'scoring.badminton.rules.cap.value', { cap: '30' }],
      ['interval', 'scoring.badminton.rules.interval.value', { point: '11' }],
      ['endsChange', 'scoring.badminton.rules.endsChange.value', { point: '11', game: '3' }],
    ] as const
  ).map(([name, key, vars]) => ({
    label: words[`scoring.badminton.rules.${name}.label`] ?? '',
    value: fill(words[key] ?? '', vars),
  }));

/** A sport the card has never heard of, made up: it carries any sport's rows. */
const CRICKET: MatchCardRow[] = [
  { label: 'Overs', value: '20' },
  { label: 'Powerplay', value: '6 overs' },
];

const renderCard = (
  context: MatchContext = SINGLES,
  rows: readonly MatchCardRow[] = badminton(en),
  language: 'en' | 'es' | 'fr' | 'nl' = 'en',
) => renderWithPorts(<MatchCard context={context} rows={rows} />, { deviceLanguages: [language] });

const byId = (id: string) => screen.getByTestId(id);
const allById = (id: string) => screen.getAllByTestId(id);
const text = (elements: readonly HTMLElement[]) => elements.map((element) => element.textContent);
const style = (element: HTMLElement) => getComputedStyle(element);

describe('MatchCard: the header', () => {
  it('says the competition in display caps in ink2, the division · round under it, and the match on a plate', () => {
    renderCard();
    const competition = byId('match-card-competition');
    expect(competition.textContent).toBe('Spring Open 2026');
    expect(style(competition).textTransform).toBe('uppercase');
    expect(style(competition).color).toBe(edgeOf(colour.ink2));
    expect(byId('match-card-where').textContent).toBe('U15 Boys Singles · Round 1');
    expect(style(byId('match-card-where')).color).toBe(edgeOf(colour.ink));
    const plate = byId('match-card-match');
    expect(plate.textContent).toBe('Match 4');
    expect(style(plate.firstElementChild as HTMLElement).textTransform).toBe('uppercase');
    expect(style(plate.firstElementChild as HTMLElement).color).toBe(edgeOf(colour.ink));
    expect(style(plate).borderTopWidth).toBe(`${layout.iconBorder}px`);
    expect(style(plate).borderTopColor).toBe(edgeOf(colour.ink3));
  });

  it('stands the plate at the right of the competition and the division · round', () => {
    renderCard();
    const header = byId('match-card-header');
    expect(style(header).flexDirection).toBe('row');
    expect(header.lastElementChild).toBe(byId('match-card-match'));
    expect(header.firstElementChild?.contains(byId('match-card-competition'))).toBe(true);
    expect(header.firstElementChild?.contains(byId('match-card-where'))).toBe(true);
  });

  it('reads as one line to a screen reader', () => {
    renderCard();
    expect(screen.getByLabelText('Spring Open 2026, U15 Boys Singles, Round 1, Match 4')).toBe(
      byId('match-card-header'),
    );
  });

  it('skips a piece the organiser left out, or left blank, in what it shows and what it says', () => {
    renderCard({ ...SINGLES, division: null, match: ' ' });
    expect(byId('match-card-where').textContent).toBe('Round 1');
    expect(screen.queryByTestId('match-card-match')).toBeNull();
    expect(byId('match-card-header').getAttribute('aria-label')).toBe('Spring Open 2026, Round 1');
  });

  it('draws no division · round line when both are left out', () => {
    renderCard({ ...SINGLES, division: null, round: null, match: null });
    expect(screen.queryByTestId('match-card-where')).toBeNull();
    expect(screen.queryByTestId('match-card-match')).toBeNull();
    expect(byId('match-card-header').textContent).toBe('Spring Open 2026');
  });
});

describe('MatchCard: the versus block', () => {
  it('stands each side in its own row on a surface2 panel, a bar at its left edge: lime first, lilac second', () => {
    renderCard();
    expect(style(byId('match-card-versus')).backgroundColor).toBe(fillOf(colour.surface2));
    const sides = allById('match-card-side');
    expect(text(sides)).toEqual(['A. Sharma', 'L. Chen']);
    const bars = sides.map((side) => side.firstElementChild as HTMLElement);
    expect(bars.map((bar) => bar.getAttribute('data-testid'))).toEqual([
      'match-card-bar',
      'match-card-bar',
    ]);
    expect(bars.map((bar) => style(bar).backgroundColor)).toEqual([
      fillOf(colour.lime),
      fillOf(colour.ink3),
    ]);
    expect(bars.map((bar) => style(bar).width)).toEqual([
      `${layout.labelBar}px`,
      `${layout.labelBar}px`,
    ]);
  });

  it('sets the names large, in the display face, mixed case as typed, never cut', () => {
    renderCard(DOUBLES);
    const names = allById('match-card-name');
    expect(text(names)).toEqual(['A. Sharma / R. Iyer', 'L. Chen / M. Wong']);
    for (const name of names) {
      expect(style(name).fontSize).toBe(`${typeScale.matchName.fontSize}px`);
      expect(style(name).textTransform).not.toBe('uppercase');
      expect(declaredStyle(name, '-webkit-line-clamp')).toBe('');
      expect(style(name).whiteSpace).not.toBe('nowrap');
    }
    expect(typeScale.matchName.fontSize).toBeGreaterThan(typeScale.label.fontSize);
  });

  it('sets a small v in ink2 between the rows, hidden from a screen reader', () => {
    renderCard();
    const versus = byId('match-card-versus');
    const v = byId('match-card-v');
    expect([...versus.children]).toEqual([
      allById('match-card-side')[0],
      v,
      allById('match-card-side')[1],
    ]);
    expect(v.textContent).toBe('v');
    expect(v.getAttribute('aria-hidden')).toBe('true');
    expect(style(v).color).toBe(edgeOf(colour.ink2));
  });

  it('is heard once: "A. Sharma versus L. Chen"', () => {
    renderCard();
    expect(byId('match-card-versus').getAttribute('aria-label')).toBe('A. Sharma versus L. Chen');
    expect(screen.getByLabelText('A. Sharma versus L. Chen')).toBe(byId('match-card-versus'));
  });
});

describe('MatchCard: the rules table', () => {
  it('follows the header and the versus block, under a RULES subheading in display caps in ink2', () => {
    renderCard();
    expect(
      [...byId('match-card').children].map((part) => part.getAttribute('data-testid')),
    ).toEqual(['match-card-header', 'match-card-versus', 'match-card-rules']);
    const heading = within(byId('match-card-rules')).getByRole('heading');
    expect(heading.textContent).toBe(en['scoring.rules.heading']);
    expect(style(heading).textTransform).toBe('uppercase');
    expect(style(heading).color).toBe(edgeOf(colour.ink2));
  });

  it('says each rule as a row: the label at the left in ink2, the value at the right in ink', () => {
    renderCard();
    expect(text(allById('match-card-label'))).toEqual([
      'Format',
      'Points',
      'Cap',
      'Interval',
      'Ends change',
    ]);
    expect(text(allById('match-card-value'))).toEqual([
      'Best of 3 games',
      '21, win by 2',
      '30',
      'at 11',
      'at 11 in game 3',
    ]);
    for (const row of allById('match-card-row')) expect(style(row).flexDirection).toBe('row');
    for (const label of allById('match-card-label'))
      expect(style(label).color).toBe(edgeOf(colour.ink2));
    for (const value of allById('match-card-value')) {
      expect(style(value).color).toBe(edgeOf(colour.ink));
      // A value wraps under itself, in the room the label column leaves.
      expect(style(value).flexGrow).toBe('1');
      expect(declaredStyle(value, '-webkit-line-clamp')).toBe('');
    }
  });

  it('separates the rows by a hairline, none above the first', () => {
    renderCard();
    const rows = allById('match-card-row');
    expect(rows.map((row) => style(row).borderTopWidth)).toEqual([
      '0px',
      `${layout.cardBorder}px`,
      `${layout.cardBorder}px`,
      `${layout.cardBorder}px`,
      `${layout.cardBorder}px`,
    ]);
    for (const row of rows.slice(1)) expect(style(row).borderTopColor).toBe(edgeOf(colour.rule));
  });

  it('reads each row as one line: "Format: Best of 3 games"', () => {
    renderCard();
    const said = allById('match-card-row').map((row) => row.getAttribute('aria-label'));
    expect(said[0]).toBe('Format: Best of 3 games');
    expect(said).toEqual(
      badminton(en).map((row) =>
        fill(en['scoring.rules.row'], { label: row.label, value: row.value }),
      ),
    );
  });

  it('carries any sport’s rows: a made-up one it has never heard of', () => {
    renderCard(SINGLES, CRICKET);
    expect(text(allById('match-card-label'))).toEqual(['Overs', 'Powerplay']);
    expect(text(allById('match-card-value'))).toEqual(['20', '6 overs']);
    expect(allById('match-card-row').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Overs: 20',
      'Powerplay: 6 overs',
    ]);
    expect(byId('match-card-rules').textContent).not.toContain('Best of');
  });

  it('draws the subheading alone when a sport gives no rows', () => {
    renderCard(SINGLES, []);
    expect(screen.queryByTestId('match-card-row')).toBeNull();
    expect(byId('match-card-rules').textContent).toBe(en['scoring.rules.heading']);
  });
});

/**
 * The label column is as wide as the widest label in the operator's language, at most `padRuleLabelMax`: the labels'
 * widths are known only once the phone lays them out, so every label's cell takes the widest one laid out.
 */
describe('MatchCard: the label column', () => {
  const cells = () => allById('match-card-label-cell');
  const least = () => cells().map((cell) => style(cell).minWidth);

  it('caps every label’s cell at padRuleLabelMax, where a longer label wraps', () => {
    renderCard();
    for (const cell of cells()) {
      expect(style(cell).maxWidth).toBe(`${layout.padRuleLabelMax}px`);
      expect(style(cell).flexShrink).toBe('0');
    }
  });

  it('gives every cell the widest label laid out, rounded up', () => {
    renderCard();
    [50.4, 44.4, 27.7, 53.1, 89.4].forEach((width, at) =>
      layOut(cells()[at] as HTMLElement, { width, height: 22 }),
    );
    expect(least()).toEqual(['90px', '90px', '90px', '90px', '90px']);
  });

  it('never narrows for a later, narrower layout (a cell laid out again at the column’s own width)', () => {
    renderCard();
    layOut(cells()[4] as HTMLElement, { width: 89.4, height: 22 });
    layOut(cells()[0] as HTMLElement, { width: 50.4, height: 22 });
    layOut(cells()[4] as HTMLElement, { width: 60, height: 22 });
    expect(least()).toEqual(['90px', '90px', '90px', '90px', '90px']);
  });

  it('measures afresh when the labels change: another language, or another sport', () => {
    const view = renderCard();
    layOut(cells()[4] as HTMLElement, { width: 89.4, height: 22 });
    view.rerender(<MatchCard context={SINGLES} rows={CRICKET} />);
    expect(least()).toEqual(['0px', '0px']);
    layOut(cells()[1] as HTMLElement, { width: 64, height: 22 });
    expect(least()).toEqual(['64px', '64px']);
  });
});

describe('MatchCard: in four languages', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the subheading, the sides heard once and each row as one line',
    (lang, words: Dictionary) => {
      renderCard(SINGLES, badminton(words), lang);
      expect(within(byId('match-card-rules')).getByRole('heading').textContent).toBe(
        words['scoring.rules.heading'],
      );
      expect(byId('match-card-versus').getAttribute('aria-label')).toBe(
        fill(words['scoring.details.versus'] ?? '', { first: 'A. Sharma', second: 'L. Chen' }),
      );
      expect(allById('match-card-row').map((row) => row.getAttribute('aria-label'))).toEqual(
        badminton(words).map((row) =>
          fill(words['scoring.rules.row'] ?? '', { label: row.label, value: row.value }),
        ),
      );
      // The organiser's words are never translated.
      expect(byId('match-card-header').getAttribute('aria-label')).toBe(
        'Spring Open 2026, U15 Boys Singles, Round 1, Match 4',
      );
    },
  );

  it('fr: a no-break space before the colon a row is heard with', () => {
    renderCard(SINGLES, badminton(fr), 'fr');
    expect(allById('match-card-row')[0]?.getAttribute('aria-label')).toBe(
      `Format${String.fromCodePoint(0x00a0)}: Au meilleur des 3 jeux`,
    );
  });
});

/**
 * Hardening (the owner approved the card on build 716, 2026-11-01): a second call, an empty or long input, and the
 * card's own layout pins that jsdom can read.
 */
describe('MatchCard: the four questions (hardening)', () => {
  const cells = () => allById('match-card-label-cell');
  const least = () => cells().map((cell) => style(cell).minWidth);
  const LONG: MatchContext = {
    competition: 'Northamptonshire County Badminton Association Veterans Championships 2026',
    division: 'Over 45 Mixed Doubles Category A',
    round: 'Second Qualifying Round',
    match: 'NCBA-2026-0417',
    sides: [
      'Christopher Featherstonehaugh / Bartholomew Anstruther-Gough',
      'Maximiliano Fernández-Villaverde / Anneliese Oppenheimer-Weiß',
    ],
  };

  it('keeps the measured column for the same labels again: a re-render with new arrays of the same words', () => {
    const view = renderCard();
    layOut(cells()[4] as HTMLElement, { width: 89.4, height: 22 });
    view.rerender(<MatchCard context={{ ...SINGLES }} rows={badminton(en)} />);
    expect(least()).toEqual(['90px', '90px', '90px', '90px', '90px']);
  });

  it('draws a long doubles match whole: every name and the competition as typed, wrapping, never cut', () => {
    renderCard(LONG);
    expect(text(allById('match-card-name'))).toEqual([...LONG.sides]);
    expect(byId('match-card-competition').textContent).toBe(LONG.competition);
    expect(byId('match-card-where').textContent).toBe(
      'Over 45 Mixed Doubles Category A · Second Qualifying Round',
    );
    expect(byId('match-card-match').textContent).toBe('NCBA-2026-0417');
    for (const id of ['match-card-competition', 'match-card-where']) {
      expect(declaredStyle(byId(id), '-webkit-line-clamp')).toBe('');
      expect(style(byId(id)).whiteSpace).not.toBe('nowrap');
    }
    expect(byId('match-card-versus').getAttribute('aria-label')).toBe(
      'Christopher Featherstonehaugh / Bartholomew Anstruther-Gough versus Maximiliano Fernández-Villaverde / ' +
        'Anneliese Oppenheimer-Weiß',
    );
  });

  // The header's text takes what the plate leaves, and each name what its bar leaves: without the grow, a row's text
  // would be as wide as its words and push the plate off the card.
  it('lets the header’s text and each name take the room beside the plate and the bar', () => {
    renderCard();
    const headerText = byId('match-card-header').firstElementChild as HTMLElement;
    expect(style(headerText).flexGrow).toBe('1');
    for (const name of allById('match-card-name')) expect(style(name).flexGrow).toBe('1');
  });

  it('sets the v under the names’ first letters, past the bar and its gap', () => {
    renderCard();
    expect(style(byId('match-card-v')).marginLeft).toBe(
      `${layout.labelBar + layout.labelBarGap}px`,
    );
  });
});
