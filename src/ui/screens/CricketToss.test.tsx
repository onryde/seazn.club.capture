import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SetupTeam } from '@/domain/scoring/cricketSetup';
import en from '@/i18n/en.json';
import { CricketToss } from '@/ui/screens/CricketToss';
import { colour, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Cricket's toss on the whole screen (owner ruling 83; S2-4 plan Task 10): two halves of equal flex, "Who won the toss?"
// over the team names, then "{team} chose to…" over Bat and Bowl, greyed until a team is picked. The winner is held by the
// hook (`useCricketMatch.test.tsx`); here it is a prop. jsdom lays nothing out: that the halves share the screen equally
// and nothing moves when the first is answered is the phone's (Task 19); the styles each half carries are asserted here.

const TEAMS: readonly [SetupTeam, SetupTeam] = [
  { id: 'first', label: 'Riverside CC' },
  { id: 'second', label: 'Hillcrest CC' },
];

function renderToss(winner: SetupTeam['id'] | null) {
  const onWinner = vi.fn();
  const onElect = vi.fn();
  const view = renderWithPorts(
    <CricketToss teams={TEAMS} winner={winner} onWinner={onWinner} onElect={onElect} />,
  );
  const rerender = (next: SetupTeam['id'] | null) =>
    view.rerender(
      <CricketToss teams={TEAMS} winner={next} onWinner={onWinner} onElect={onElect} />,
    );
  return { onWinner, onElect, rerender };
}

const half = (which: 'won' | 'chose') => screen.getByTestId(`toss-half-${which}`);
const radio = (where: HTMLElement, name: string) => within(where).getByRole('radio', { name });
const chose = (team: string) => en['scoring.cricket.toss.chose'].replace('{team}', team);
/** A half never below its question's kept lines, the gap and a button (tokens, never the component's constant). */
const HALF_MIN = `${layout.padTossAskLines * typeScale.state.lineHeight + space.sm + layout.padTossHeight}px`;

describe('CricketToss (ruling 83)', () => {
  it('the toss fills the screen in two halves: both there before any tap, the bottom one disabled', () => {
    renderToss(null);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    expect(within(half('won')).getByRole('heading').textContent).toBe(
      en['scoring.cricket.toss.ask'],
    );
    for (const name of ['Bat', 'Bowl']) {
      expect(radio(half('chose'), name).getAttribute('aria-disabled')).toBe('true');
    }
    for (const name of ['Riverside CC', 'Hillcrest CC']) {
      expect(radio(half('won'), name).getAttribute('aria-disabled')).not.toBe('true');
    }
  });

  it('the toss asks with team names, and a team tap hands its side back', () => {
    const { onWinner } = renderToss(null);
    expect(
      within(half('won'))
        .getAllByRole('radio')
        .map((one) => one.textContent),
    ).toEqual(['Riverside CC', 'Hillcrest CC']);
    act(() => fireEvent.click(radio(half('won'), 'Hillcrest CC')));
    expect(onWinner).toHaveBeenCalledWith('second');
  });

  it('the second half is greyed and takes no tap until a team is picked', () => {
    const { onElect, rerender } = renderToss(null);
    act(() => fireEvent.click(radio(half('chose'), 'Bat')));
    expect(onElect).not.toHaveBeenCalled();
    // Greyed: the question and the words in the inert ink, and the buttons unfilled, the ground showing through.
    const greyed = () => {
      const bat = radio(half('chose'), 'Bat');
      return [
        getComputedStyle(within(half('chose')).getByRole('heading')).color,
        getComputedStyle(bat.firstElementChild as HTMLElement).color,
        getComputedStyle(bat).backgroundColor === fillOf(colour.surface),
      ];
    };
    expect(greyed()).toEqual([edgeOf(colour.ink3), edgeOf(colour.ink3), false]);
    rerender('first');
    expect(greyed()).toEqual([edgeOf(colour.ink2), edgeOf(colour.ink), true]);
  });

  it('the second half names the picked team, and Bat or Bowl hands the choice back', () => {
    const { onElect, rerender } = renderToss(null);
    expect(within(half('chose')).getByRole('heading').textContent).toBe(
      chose(en['scoring.cricket.toss.team']),
    );
    rerender('first');
    expect(within(half('chose')).getByRole('heading').textContent).toBe(chose('Riverside CC'));
    expect(radio(half('won'), 'Riverside CC').getAttribute('aria-checked')).toBe('true');
    act(() => fireEvent.click(radio(half('chose'), 'Bowl')));
    act(() => fireEvent.click(radio(half('chose'), 'Bat')));
    expect(onElect.mock.calls).toEqual([['bowl'], ['bat']]);
  });

  it('each half keeps its token size when the first half is answered', () => {
    const { rerender } = renderToss(null);
    const sizes = () =>
      (['won', 'chose'] as const).map((which) => {
        const style = getComputedStyle(half(which));
        return [style.flexGrow, style.minHeight];
      });
    const before = sizes();
    expect(before).toEqual([
      ['1', HALF_MIN],
      ['1', HALF_MIN],
    ]);
    rerender('second');
    expect(sizes()).toEqual(before);
    for (const side of screen.getAllByRole('radio')) {
      expect(getComputedStyle(side).minHeight).toBe(`${layout.padTossHeight}px`);
    }
  });

  it('asks in the operator’s language', () => {
    const fakes = renderWithPorts(
      <CricketToss teams={TEAMS} winner={null} onWinner={vi.fn()} onElect={vi.fn()} />,
      { deviceLanguages: ['es'] },
    );
    expect(fakes.getAllByRole('heading').map((one) => one.textContent)).toEqual([
      '¿Quién ganó el sorteo?',
      'Equipo eligió…',
    ]);
    expect(fakes.getAllByRole('radio').map((one) => one.textContent)).toEqual([
      'Riverside CC',
      'Hillcrest CC',
      'Batear',
      'Lanzar',
    ]);
  });
});
