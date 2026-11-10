import { screen, within } from '@testing-library/react';
import type { TextProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { layout } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The batting team's name over the score, and a result's two rows (T19 fix 5; owner, 2026-11-10). react-native-web drops
// `adjustsFontSizeToFit` and `minimumFontScale`, so this stands in for Text and writes the props it was given where a
// test can read them. That a phone then shrinks a long name to 0.7 of its size, and ends it in an ellipsis beyond, is the
// device check's; jsdom cannot measure it.
vi.mock('@/ui/components/Text', () => ({
  Text: (props: TextProps & { variant: string }) => (
    <span
      data-testid={props.testID}
      data-variant={props.variant}
      data-lines={String(props.numberOfLines)}
      data-fit={String(props.adjustsFontSizeToFit)}
      data-floor={String(props.minimumFontScale)}
      data-ellipsis={String(props.ellipsizeMode)}
    >
      {props.children}
    </span>
  ),
}));

const BOARD: CricketBoardView = {
  score: {
    team: 'South',
    runs: 6,
    wickets: 0,
    overs: '0.1',
    innings: { key: 'scoring.cricket.board.superOver', vars: { number: 2 } },
    chase: null,
  },
  result: null,
  crease: null,
  bowler: null,
  over: { number: 1, chips: [] },
  status: null,
};

describe('the batting team’s name over the score', () => {
  it('heads the score, which is followed by the innings without the team', () => {
    renderWithPorts(<CricketBoard view={BOARD} />);
    const team = screen.getByTestId('board-team');
    const runs = screen.getByTestId('board-runs');
    const innings = screen.getByTestId('board-innings');
    expect(team.textContent).toBe('South');
    expect(innings.textContent).toBe('Super over 2');
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(team.compareDocumentPosition(runs) & follows).toBe(follows);
    expect(runs.compareDocumentPosition(innings) & follows).toBe(follows);
  });

  it('is one line that shrinks to fit down to the floor and ends in an ellipsis', () => {
    renderWithPorts(<CricketBoard view={BOARD} />);
    const team = screen.getByTestId('board-team');
    expect(team.dataset.lines).toBe('1');
    expect(team.dataset.fit).toBe('true');
    expect(team.dataset.floor).toBe('0.7');
    expect(layout.boardTeamMinScale).toBe(0.7);
    expect(team.dataset.ellipsis).toBe('tail');
    expect(team.dataset.variant).toBe('label');
  });

  it('changes with the side batting at the innings break', () => {
    const { rerender } = renderWithPorts(<CricketBoard view={BOARD} />);
    expect(screen.getByTestId('board-team').textContent).toBe('South');
    rerender(
      <CricketBoard
        view={{
          ...BOARD,
          score: {
            ...BOARD.score!,
            team: 'North',
            innings: { key: 'scoring.cricket.board.innings', vars: { number: 1 } },
          },
        }}
      />,
    );
    expect(screen.getByTestId('board-team').textContent).toBe('North');
    expect(screen.getByTestId('board-innings').textContent).toBe('Innings 1');
  });
});

describe('a result’s two rows', () => {
  const RESULT: CricketBoardView = {
    ...BOARD,
    result: [
      { team: 'North', figures: '2/0', overs: '1' },
      { team: 'South', figures: '6/0', overs: '0.1' },
    ],
  };

  it('show both sides with their figures in place of the one innings’ score', () => {
    renderWithPorts(<CricketBoard view={RESULT} />);
    const first = screen.getByTestId('board-result-first');
    const second = screen.getByTestId('board-result-second');
    expect(within(first).getByTestId('board-result-team').textContent).toBe('North');
    expect(within(first).getByTestId('board-result-figures').textContent).toBe('2/0 (1 ov)');
    expect(within(second).getByTestId('board-result-team').textContent).toBe('South');
    expect(within(second).getByTestId('board-result-figures').textContent).toBe('6/0 (0.1 ov)');
    expect(screen.queryByTestId('board-runs')).toBeNull();
    expect(screen.queryByTestId('board-team')).toBeNull();
  });

  it('keep the same shrink-to-fit team style, and a longer match’s figures with no overs', () => {
    renderWithPorts(
      <CricketBoard
        view={{
          ...RESULT,
          result: [{ team: 'North', figures: '320/9 & 150/4', overs: null }, RESULT.result![1]],
        }}
      />,
    );
    const team = screen.getAllByTestId('board-result-team')[0]!;
    expect([team.dataset.lines, team.dataset.fit, team.dataset.floor]).toEqual([
      '1',
      'true',
      '0.7',
    ]);
    expect(screen.getAllByTestId('board-result-figures')[0]!.textContent).toBe('320/9 & 150/4');
  });
});
