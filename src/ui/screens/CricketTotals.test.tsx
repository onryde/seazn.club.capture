import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CricketTotalsEntry, CricketTotalsTied } from '@/domain/scoring/cricketTotals';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { STORE_KEYS } from '@/services/modeStore';
import { CricketTotalsPanel } from '@/ui/screens/CricketTotals';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Over totals (S2-4 plan Task 17): the entry the phone draws while a side's players are not entered. The numbers that may be entered are the domain's (`totalsView`'s `fits`, its own tests
// and the hook's), stood in for here by a rule written out in each test; what these tests pin is what the operator sees
// and which call each button makes. Whether the thumb finds the steppers is the device check's.

const NOTE = { key: 'scoring.cricket.totals.noPlayers' } as const;

const entry = (over: Partial<CricketTotalsEntry> = {}): CricketTotalsEntry => ({
  kind: 'entry',
  note: NOTE,
  over: 3,
  entryKey: 'i1.12',
  start: { runs: 0, wickets: 0, balls: 6 },
  ballsMax: 6,
  fits: () => true,
  ...over,
});

const TIED: CricketTotalsTied = { kind: 'tied', note: { key: 'scoring.cricket.totals.tied' } };

const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const more = (field: string) => press(`${field}: 1 more`);
const less = (field: string) => press(`${field}: 1 fewer`);
const valueOf = (field: string) => screen.getByTestId(`totals-${field}-value`).textContent;
const record = () => press(en['scoring.cricket.totals.record']);

describe('the over totals entry on the pad', () => {
  it('shows the note, the over, and a whole maiden over to start from', () => {
    renderWithPorts(<CricketTotalsPanel totals={entry()} onRecord={vi.fn()} />);
    expect(screen.getByText('Players not entered — ask the organiser')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Over 3 totals' })).toBeTruthy();
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '6']);
  });

  it('the steppers move each field by one, and Record over hands the three numbers on', () => {
    const onRecord = vi.fn();
    renderWithPorts(<CricketTotalsPanel totals={entry()} onRecord={onRecord} />);
    more('Runs');
    more('Runs');
    more('Runs');
    more('Wickets');
    less('Balls');
    less('Balls');
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['3', '1', '4']);
    record();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith({ runs: 3, wickets: 1, balls: 4 });
  });

  it('a stepper stops at its floor: no fewer runs or wickets than none, no fewer balls than one', () => {
    renderWithPorts(
      <CricketTotalsPanel
        totals={entry({ start: { runs: 0, wickets: 0, balls: 1 } })}
        onRecord={vi.fn()}
      />,
    );
    for (const field of ['Runs', 'Wickets', 'Balls']) {
      const button = screen.getByRole('button', { name: `${field}: 1 fewer` });
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
    less('Balls');
    expect(valueOf('balls')).toBe('1');
  });

  it('balls stop at a whole over; a format with more balls to an over lets it go on', () => {
    renderWithPorts(
      <CricketTotalsPanel
        totals={entry({ ballsMax: 8, start: { runs: 0, wickets: 0, balls: 8 } })}
        onRecord={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Balls: 1 more' }).getAttribute('aria-disabled'),
    ).toBe('true');
    less('Balls');
    more('Balls');
    expect(valueOf('balls')).toBe('8');
  });

  it('a stepper greys where the engine would refuse the next figure, and Record over where it refuses the figures', () => {
    // Stand-in rule: a side has two wickets left, and a chase may not pass 30 runs in the over.
    const fits = (over: { runs: number; wickets: number; balls: number }) =>
      over.wickets <= 2 && over.runs <= 30;
    const onRecord = vi.fn();
    renderWithPorts(<CricketTotalsPanel totals={entry({ fits })} onRecord={onRecord} />);
    more('Wickets');
    more('Wickets');
    expect(
      screen.getByRole('button', { name: 'Wickets: 1 more' }).getAttribute('aria-disabled'),
    ).toBe('true');
    less('Wickets');
    expect(
      screen.getByRole('button', { name: 'Wickets: 1 more' }).getAttribute('aria-disabled'),
    ).not.toBe('true');
    record();
    expect(onRecord).toHaveBeenCalledWith({ runs: 0, wickets: 1, balls: 6 });
  });

  it('Record over is greyed and takes no tap while the figures make no over the engine takes', () => {
    const onRecord = vi.fn();
    renderWithPorts(
      <CricketTotalsPanel totals={entry({ fits: () => false })} onRecord={onRecord} />,
    );
    const button = screen.getByRole('button', { name: en['scoring.cricket.totals.record'] });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => fireEvent.click(button));
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('the entry starts again from the next over’s figures when the over moves on', () => {
    const { rerender } = renderWithPorts(
      <CricketTotalsPanel totals={entry()} onRecord={vi.fn()} />,
    );
    more('Runs');
    more('Wickets');
    expect(valueOf('runs')).toBe('1');
    rerender(
      <CricketTotalsPanel
        totals={entry({ over: 4, entryKey: 'i1.18', start: { runs: 0, wickets: 0, balls: 3 } })}
        onRecord={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Over 4 totals' })).toBeTruthy();
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '3']);
  });

  // Review of Batch 5, I1: a part over leaves the over number where it was, and the next innings' first over has the
  // number the last one's had; the figures start again at either, because the entry's key is not the number.
  it('the entry starts again when the entry is a new one under the same over number', () => {
    const { rerender } = renderWithPorts(
      <CricketTotalsPanel totals={entry({ over: 1, entryKey: 'i1.0' })} onRecord={vi.fn()} />,
    );
    more('Runs');
    more('Runs');
    less('Balls');
    expect([valueOf('runs'), valueOf('balls')]).toEqual(['2', '5']);
    rerender(
      <CricketTotalsPanel
        totals={entry({ over: 1, entryKey: 'i1.3', start: { runs: 0, wickets: 0, balls: 3 } })}
        onRecord={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Over 1 totals' })).toBeTruthy();
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '3']);
    more('Runs');
    rerender(
      <CricketTotalsPanel totals={entry({ over: 1, entryKey: 'i2.0' })} onRecord={vi.fn()} />,
    );
    expect([valueOf('runs'), valueOf('wickets'), valueOf('balls')]).toEqual(['0', '0', '6']);
  });

  // A re-render of the same over (the clock ticking, a sync) is not a new over: the scorer's figures stay.
  it('a re-render in the same over keeps what was entered', () => {
    const { rerender } = renderWithPorts(
      <CricketTotalsPanel totals={entry()} onRecord={vi.fn()} />,
    );
    more('Runs');
    rerender(<CricketTotalsPanel totals={entry()} onRecord={vi.fn()} />);
    expect(valueOf('runs')).toBe('1');
  });

  // The four questions, an empty input: a tie nobody can decide has nothing to enter.
  it('a tie in totals shows the organiser’s line and nothing to enter', () => {
    renderWithPorts(<CricketTotalsPanel totals={TIED} onRecord={vi.fn()} />);
    expect(screen.getByText('Tied — the organiser decides the super over')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('totals-runs')).toBeNull();
  });

  // The four questions, another language.
  it('reads in Spanish', async () => {
    renderWithPorts(<CricketTotalsPanel totals={entry()} onRecord={vi.fn()} />, {
      kvSeed: { [STORE_KEYS.lang]: 'es' },
    });
    expect(await screen.findByText(es['scoring.cricket.totals.noPlayers'])).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Carreras: 1 más' })).toBeTruthy();
    expect(screen.getByRole('button', { name: es['scoring.cricket.totals.record'] })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Totales del over 3' })).toBeTruthy();
  });
});
