import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClockBarView } from '@/domain/scoring/clockBarView';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import nl from '@/i18n/nl.json';
import { ClockBar } from '@/ui/components/ClockBar';
import { colour, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The kit's clock bar (S2-5 design §6.1; plan P Task 10; owner ruling 130, "Clock hero"): it draws what a sport fills in
// and decides nothing. The words here are any dictionary words: the bar names no sport.

const PERIOD = { key: 'scoring.football.period.H1' } as const;
const PAUSED = { key: 'scoring.football.clock.paused' } as const;

type Action = 'start' | 'pause' | 'resume' | null;

function viewOf(
  action: Action,
  time = '34:12',
  period: ClockBarView<MessageKey>['period'] = PERIOD,
): ClockBarView<MessageKey> {
  return {
    time,
    period,
    said: { key: 'scoring.football.clock.said', vars: { time } },
    paused: action === 'resume' ? PAUSED : null,
    action:
      action === null ? null : { kind: action, label: { key: `scoring.football.clock.${action}` } },
  };
}

function renderBar(view: ClockBarView<MessageKey>, language: 'en' | 'nl' = 'en', compact = false) {
  const onAction = vi.fn();
  const rendered = renderWithPorts(<ClockBar view={view} onAction={onAction} compact={compact} />, {
    deviceLanguages: [language],
  });
  return { onAction, rendered };
}

const said = (time: string) => en['scoring.football.clock.said'].replace('{time}', time);
const H1 = en['scoring.football.period.H1'];
const plate = (word: 'start' | 'pause' | 'resume') =>
  screen.getByRole('button', { name: en[`scoring.football.clock.${word}`] });

describe('ClockBar', () => {
  it('has one plate: Start before the period starts, Pause while it runs, Resume while it is stopped', () => {
    const { onAction, rendered } = renderBar(viewOf('start'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    act(() => fireEvent.click(plate('start')));
    expect(onAction).toHaveBeenCalledTimes(1);
    for (const [next, other] of [
      ['pause', 'resume'],
      ['resume', 'start'],
    ] as const) {
      rendered.rerender(<ClockBar view={viewOf(next)} onAction={onAction} />);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(
        screen.queryByRole('button', { name: en[`scoring.football.clock.${other}`] }),
      ).toBeNull();
      act(() => fireEvent.click(plate(next)));
    }
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it('draws no plate where the clock takes none, and still shows the time and the period', () => {
    renderBar(viewOf(null, '90:00', { key: 'scoring.football.break.fullTime' }));
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('90:00')).toBeTruthy();
    expect(screen.getByText(en['scoring.football.break.fullTime'])).toBeTruthy();
  });

  // The controller's ruling 134: the face is no button; a stray touch near the top edge opened Correct (device-run-1 F3).
  it('the clock face has no press: it is no button and a click on it starts nothing', () => {
    const { onAction } = renderBar(viewOf('pause'));
    const face = screen.getByLabelText(`${said('34:12')}, ${H1}`);
    expect(face.getAttribute('role')).not.toBe('button');
    act(() => fireEvent.click(screen.getByText('34:12')));
    act(() => fireEvent.click(face));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sets the time in lime tabular figures at the hero size, and the period in lilac caps', () => {
    renderBar(viewOf('start'));
    const time = getComputedStyle(screen.getByText('34:12'));
    expect(time.color).toBe(edgeOf(colour.lime));
    expect(time.fontVariant).toContain('tabular-nums');
    expect(time.fontSize).toBe(`${typeScale.clockHero.fontSize}px`);
    const period = getComputedStyle(screen.getByText(H1));
    expect(period.color).toBe(edgeOf(colour.ink3));
    expect(period.textTransform).toBe('uppercase');
  });

  it('while stopped the digits dim to ink3 and an orange PAUSED tag sits beside the period, never red', () => {
    renderBar(viewOf('resume'));
    expect(getComputedStyle(screen.getByText('34:12')).color).toBe(edgeOf(colour.ink3));
    const tag = screen.getByTestId('clock-paused');
    const word = within(tag).getByText(en['scoring.football.clock.paused']);
    expect(getComputedStyle(word).color).toBe(edgeOf(colour.caution));
    expect(getComputedStyle(word).color).not.toBe(edgeOf(colour.live));
    expect(getComputedStyle(tag).borderColor).toBe(edgeOf(colour.caution));
    expect(screen.getByText(H1)).toBeTruthy();
  });

  it('while running there is no PAUSED tag and the digits are lime', () => {
    renderBar(viewOf('pause'));
    expect(screen.queryByTestId('clock-paused')).toBeNull();
    expect(getComputedStyle(screen.getByText('34:12')).color).toBe(edgeOf(colour.lime));
  });

  it('the face says the time, the period and Paused as one', () => {
    renderBar(viewOf('resume'));
    expect(
      screen.getByLabelText(`${said('34:12')}, ${H1}, ${en['scoring.football.clock.paused']}`),
    ).toBeTruthy();
  });

  it('draws the plate lime with night ink, full width, a touch target, and a glyph for Pause and Resume only', () => {
    const { rendered } = renderBar(viewOf('start'));
    const start = plate('start');
    expect(getComputedStyle(start).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(screen.getByText(en['scoring.football.clock.start'])).color).toBe(
      edgeOf(colour.ground),
    );
    expect(declaredStyle(start, 'min-height')).toBe(`${layout.touch}px`);
    expect(within(start).queryByTestId('glyph-pause')).toBeNull();
    rendered.rerender(<ClockBar view={viewOf('pause')} onAction={vi.fn()} />);
    expect(within(plate('pause')).getByTestId('glyph-pause')).toBeTruthy();
    rendered.rerender(<ClockBar view={viewOf('resume')} onAction={vi.fn()} />);
    expect(within(plate('resume')).getByTestId('glyph-resume')).toBeTruthy();
  });

  it('draws the period only when there is one to name', () => {
    renderBar(viewOf('start', '0:00', null));
    expect(screen.queryByText(H1)).toBeNull();
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('says the plate, the period and Paused in the operator’s language', () => {
    renderBar(viewOf('resume'), 'nl');
    expect(screen.getByRole('button', { name: nl['scoring.football.clock.resume'] })).toBeTruthy();
    expect(screen.getByText(nl['scoring.football.period.H1'])).toBeTruthy();
    expect(screen.getByText(nl['scoring.football.clock.paused'])).toBeTruthy();
    expect(nl['scoring.football.clock.resume']).not.toBe(en['scoring.football.clock.resume']);
  });
});

// Owner rulings 147 and 150: the panel's lime hairline, and the digits grown into a tall phone's spare height.
describe('ClockBar, the panel and the grown digits', () => {
  it('has a thin lime hairline on the panel’s bottom edge', () => {
    renderBar(viewOf('pause'));
    const face = screen.getByTestId('clock-face');
    expect(getComputedStyle(face).borderBottomColor).toBe(edgeOf(colour.lime));
    expect(declaredStyle(face, 'border-bottom-width')).toBe(`${layout.iconBorder}px`);
  });

  it('sets the digits at the size it is given, with its line, and keeps clockHero’s with none', () => {
    const grown = renderBar(viewOf('pause'));
    expect(getComputedStyle(screen.getByText('34:12')).fontSize).toBe(
      `${typeScale.clockHero.fontSize}px`,
    );
    grown.rendered.unmount();
    const onAction = vi.fn();
    renderWithPorts(<ClockBar view={viewOf('pause')} onAction={onAction} heroSize={106} />);
    expect(getComputedStyle(screen.getByText('34:12')).fontSize).toBe('106px');
    expect(getComputedStyle(screen.getByText('34:12')).lineHeight).toBe('108px');
  });

  it('a compact bar ignores a size: it keeps the step down', () => {
    renderWithPorts(<ClockBar view={viewOf('pause')} onAction={vi.fn()} compact heroSize={106} />);
    expect(getComputedStyle(screen.getByText('34:12')).fontSize).toBe(
      `${typeScale.tallyCompact.fontSize}px`,
    );
  });
});

// The compact board's bar (fix-round 2 ruling R1): the time a step down (`tallyCompact`), the period's one line under it,
// the plate under both.
describe('ClockBar, compact', () => {
  it('sets the time a step down, the period under it on one line cut with an ellipsis, in a 48 dp face with 4 dp of padding a side, a 57 dp panel with its hairline', () => {
    renderBar(viewOf('pause'), 'en', true);
    const face = screen.getByLabelText(`${said('34:12')}, ${H1}`);
    expect(within(face).getByText(H1)).toBeTruthy();
    expect(getComputedStyle(within(face).getByText('34:12')).fontSize).toBe(
      `${typeScale.tallyCompact.fontSize}px`,
    );
    expect(declaredStyle(face, 'min-height')).toBe(
      `${layout.touch + 2 * space.xs + layout.iconBorder}px`,
    );
    const style = getComputedStyle(screen.getByText(H1));
    expect([style.whiteSpace, style.textOverflow]).toEqual(['nowrap', 'ellipsis']);
  });

  it('keeps the one plate, a touch target, and the PAUSED tag, with no press on the face', () => {
    renderBar(viewOf('resume'), 'en', true);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(declaredStyle(plate('resume'), 'min-height')).toBe(`${layout.touch}px`);
    expect(screen.getByTestId('clock-paused')).toBeTruthy();
  });

  it('with no period the face says the time alone', () => {
    renderBar(viewOf('start', '0:00', null), 'en', true);
    expect(screen.getByLabelText(said('0:00'))).toBeTruthy();
  });
});
