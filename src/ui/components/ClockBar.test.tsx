import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClockBarView } from '@/domain/scoring/clockBarView';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import nl from '@/i18n/nl.json';
import { ClockBar } from '@/ui/components/ClockBar';
import { colour } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The kit's clock bar (S2-5 design §6.1; plan P Task 10): it draws what a sport fills in and decides nothing. The words
// here are any dictionary words: the bar names no sport.

const PERIOD = { key: 'scoring.football.period.H1' } as const;

function viewOf(
  action: 'start' | 'pause' | null,
  time = '34:12',
  period: ClockBarView<MessageKey>['period'] = PERIOD,
): ClockBarView<MessageKey> {
  return {
    time,
    period,
    said: { key: 'scoring.football.clock.said', vars: { time } },
    action:
      action === null ? null : { kind: action, label: { key: `scoring.football.clock.${action}` } },
  };
}

function renderBar(view: ClockBarView<MessageKey>, correct: boolean, language: 'en' | 'nl' = 'en') {
  const onAction = vi.fn();
  const onCorrect = correct ? vi.fn() : null;
  const rendered = renderWithPorts(
    <ClockBar view={view} onAction={onAction} onCorrect={onCorrect} />,
    { deviceLanguages: [language] },
  );
  return { onAction, onCorrect, rendered };
}

const said = (time: string) => en['scoring.football.clock.said'].replace('{time}', time);

describe('ClockBar', () => {
  it('ClockBar shows Start while stopped and Pause while running', () => {
    const { onAction, rendered } = renderBar(viewOf('start'), false);
    const start = screen.getByRole('button', { name: en['scoring.football.clock.start'] });
    expect(screen.queryByRole('button', { name: en['scoring.football.clock.pause'] })).toBeNull();
    act(() => fireEvent.click(start));
    expect(onAction).toHaveBeenCalledTimes(1);
    rendered.rerender(<ClockBar view={viewOf('pause')} onAction={onAction} onCorrect={null} />);
    expect(screen.queryByRole('button', { name: en['scoring.football.clock.start'] })).toBeNull();
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.football.clock.pause'] })),
    );
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('draws no button where the clock takes neither, and still shows the time', () => {
    renderBar(viewOf(null, '90:00', { key: 'scoring.football.break.fullTime' }), false);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('90:00')).toBeTruthy();
    expect(screen.getByText(en['scoring.football.break.fullTime'])).toBeTruthy();
  });

  it('a tap on the time opens Correct only when offered', () => {
    const offered = renderBar(viewOf('pause'), true);
    const face = screen.getByRole('button', { name: said('34:12') });
    act(() => fireEvent.click(face));
    expect(offered.onCorrect).toHaveBeenCalledTimes(1);
    expect(offered.onAction).not.toHaveBeenCalled();
    offered.rendered.unmount();

    renderBar(viewOf('pause'), false);
    expect(screen.queryByRole('button', { name: said('34:12') })).toBeNull();
    expect(screen.getByLabelText(said('34:12'))).toBeTruthy();
    expect(screen.getByText('34:12')).toBeTruthy();
  });

  it('sets the time in lime tabular figures, and the period in lilac caps', () => {
    renderBar(viewOf('start'), true);
    const time = getComputedStyle(screen.getByText('34:12'));
    expect(time.color).toBe(edgeOf(colour.lime));
    expect(time.fontVariant).toContain('tabular-nums');
    const period = getComputedStyle(screen.getByText(en['scoring.football.period.H1']));
    expect(period.color).toBe(edgeOf(colour.ink3));
    expect(period.textTransform).toBe('uppercase');
  });

  it('draws Start and Pause as the lime plate with night ink', () => {
    renderBar(viewOf('start'), false);
    const start = screen.getByRole('button', { name: en['scoring.football.clock.start'] });
    expect(getComputedStyle(start).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(screen.getByText(en['scoring.football.clock.start'])).color).toBe(
      edgeOf(colour.ground),
    );
  });

  it('draws the period only when there is one to name', () => {
    renderBar(viewOf('start', '0:00', null), false);
    expect(screen.queryByText(en['scoring.football.period.H1'])).toBeNull();
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('says the button and the period in the operator’s language', () => {
    renderBar(viewOf('start'), true, 'nl');
    expect(screen.getByRole('button', { name: nl['scoring.football.clock.start'] })).toBeTruthy();
    expect(screen.getByText(nl['scoring.football.period.H1'])).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: nl['scoring.football.clock.said'].replace('{time}', '34:12'),
      }),
    ).toBeTruthy();
    expect(nl['scoring.football.clock.start']).not.toBe(en['scoring.football.clock.start']);
  });
});
