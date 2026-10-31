import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const top: PadHalf<MessageKey> = {
  side: 'first',
  label: 'A. Sharma',
  value: '11',
  sub: { key: 'scoring.badminton.games', vars: { count: 1 } },
  serving: true,
  hint: { key: 'scoring.badminton.hint' },
  tappable: true,
};

const games = (count: number) => en['scoring.badminton.games'].replace('{count}', String(count));

describe('ScoreHalf', () => {
  it('shows the names, the big value, the games line and the serving plate', () => {
    renderWithPorts(<ScoreHalf half={top} onTap={vi.fn()} />);
    expect(screen.getByText('A. Sharma')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText(games(1))).toBeTruthy();
    expect(screen.getByTestId('serving').textContent).toBe(en['scoring.pad.serving']);
  });

  it('is one button a screen reader names by side, value, games and serving', () => {
    renderWithPorts(<ScoreHalf half={top} onTap={vi.fn()} />);
    const name = ['A. Sharma', '11', games(1), en['scoring.pad.serving']].join(', ');
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('gives its side the tap', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, side: 'second' }} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-second')));
    expect(onTap).toHaveBeenCalledExactlyOnceWith('second');
  });

  it('takes no tap when it is not tappable', () => {
    const onTap = vi.fn();
    renderWithPorts(<ScoreHalf half={{ ...top, tappable: false }} onTap={onTap} />);
    act(() => fireEvent.click(screen.getByTestId('half-first')));
    expect(onTap).not.toHaveBeenCalled();
    expect(screen.getByTestId('half-first').getAttribute('aria-disabled')).toBe('true');
  });

  it('draws no plate for the receiving side, and no line when there is none', () => {
    renderWithPorts(<ScoreHalf half={{ ...top, serving: false, sub: null }} onTap={vi.fn()} />);
    expect(screen.queryByTestId('serving')).toBeNull();
    expect(screen.queryByText(games(1))).toBeNull();
    expect(screen.getByRole('button', { name: 'A. Sharma, 11' })).toBeTruthy();
  });

  it('marks the first side lime and the second lilac at its left edge', () => {
    renderWithPorts(
      <>
        <ScoreHalf half={top} onTap={vi.fn()} />
        <ScoreHalf half={{ ...top, side: 'second' }} onTap={vi.fn()} />
      </>,
    );
    const left = (testID: string) => getComputedStyle(screen.getByTestId(testID)).borderLeftColor;
    expect(left('half-first')).toBe(edgeOf(colour.lime));
    expect(left('half-second')).toBe(edgeOf(colour.ink3));
  });

  it('sets the value in the score role: tabular, so 9 to 10 does not jump', () => {
    renderWithPorts(<ScoreHalf half={top} onTap={vi.fn()} />);
    expect(getComputedStyle(screen.getByText('11')).fontVariant).toContain('tabular-nums');
  });

  it('says it in French', () => {
    renderWithPorts(<ScoreHalf half={top} onTap={vi.fn()} />, { deviceLanguages: ['fr'] });
    expect(screen.getByText(fr['scoring.badminton.games'].replace('{count}', '1'))).toBeTruthy();
    expect(screen.getByTestId('serving').textContent).toBe(fr['scoring.pad.serving']);
  });
});
