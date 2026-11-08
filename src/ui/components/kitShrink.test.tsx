import { screen } from '@testing-library/react';
import type { TextProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import type { ClockBarView } from '@/domain/scoring/clockBarView';
import type { MessageKey } from '@/i18n/messages';
import { ClockBar } from '@/ui/components/ClockBar';
import { TeamColumn, type TeamColumnView } from '@/ui/components/TeamColumn';
import { layout } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

// What the kit's football parts hand React Native's Text to shrink with (the controller's fix-round rulings a, d and f).
// react-native-web drops `adjustsFontSizeToFit` and `minimumFontScale`, so this stands in for the Text and writes what it
// was given where a test can read it (as NameText.test.tsx). Whether a phone then shrinks the text is a device check.
vi.mock('@/ui/components/Text', () => ({
  Text: (props: TextProps & { variant: string }) => (
    <span
      data-testid={props.testID ?? 'text'}
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

const shrinkOf = (element: HTMLElement) => ({
  variant: element.dataset.variant,
  lines: element.dataset.lines,
  fit: element.dataset.fit,
  floor: element.dataset.floor,
  ellipsis: element.dataset.ellipsis,
});

const COLUMN: TeamColumnView = {
  label: 'Wolverhampton Wanderers',
  bar: 'lit',
  value: '10 (4)',
  lead: true,
  cards: { yellow: 0, red: 0 },
  said: [],
  tags: [],
  actions: [{ id: 'goal.first', label: 'Goal', primary: true, enabled: true, note: null }],
};

describe('the kit’s shrink to fit', () => {
  it('a team’s score shrinks to fit its one line, down to the score floor, and is never given an ellipsis', () => {
    renderWithPorts(<TeamColumn view={COLUMN} onAction={vi.fn()} />);
    expect(shrinkOf(screen.getByTestId('column-value'))).toEqual({
      variant: 'scoreCompact',
      lines: '1',
      fit: 'true',
      floor: String(layout.scoreFloor),
      ellipsis: 'undefined',
    });
    expect(layout.scoreFloor).toBe(0.6);
  });

  it('a team’s name with gaps shrinks to fit its two lines, down to the team name floor, then an ellipsis', () => {
    renderWithPorts(<TeamColumn view={COLUMN} onAction={vi.fn()} />);
    const name = screen.getByText('Wolverhampton Wanderers');
    expect(shrinkOf(name)).toEqual({
      variant: 'matchName',
      lines: String(layout.padNameLines),
      fit: 'true',
      floor: String(layout.teamNameFloor),
      ellipsis: 'tail',
    });
    expect(layout.teamNameFloor).toBe(0.75);
  });

  it('the clock’s time shrinks to fit its one line, down to the clock floor; the period does not shrink', () => {
    const view: ClockBarView<MessageKey> = {
      time: '120+15:00',
      period: { key: 'scoring.football.period.ET_H2' },
      said: { key: 'scoring.football.clock.said', vars: { time: '120+15:00' } },
      action: { kind: 'pause', label: { key: 'scoring.football.clock.pause' } },
    };
    renderWithPorts(<ClockBar view={view} onAction={vi.fn()} onCorrect={null} />);
    expect(shrinkOf(screen.getByText('120+15:00'))).toEqual({
      variant: 'tally',
      lines: '1',
      fit: 'true',
      floor: String(layout.clockFloor),
      ellipsis: 'undefined',
    });
    expect(layout.clockFloor).toBe(0.85);
    const shrunk = screen
      .getAllByTestId('text')
      .filter((text) => text.dataset.fit === 'true')
      .map((text) => text.textContent);
    expect(shrunk).toEqual(['120+15:00']);
  });
});
