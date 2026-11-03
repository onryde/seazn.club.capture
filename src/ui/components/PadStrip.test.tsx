import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { PadStrip } from '@/ui/components/PadStrip';
import { layout } from '@/ui/theme/tokens';
import { linesAllowed } from '../../../test/linesAllowed';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('PadStrip', () => {
  it('draws every slot in order, with its fact in the operator’s words', () => {
    renderWithPorts(
      <PadStrip
        items={[
          { slot: 'game', text: { key: 'scoring.badminton.gameOf', vars: { game: 2, bestOf: 3 } } },
          { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
        ]}
      />,
    );
    const slots = screen.getByTestId('pad-strip').children;
    expect([...slots].map((slot) => slot.getAttribute('data-testid'))).toEqual([
      'strip-game',
      'strip-interval',
    ]);
    expect(screen.getByTestId('strip-game').textContent).toBe(
      en['scoring.badminton.gameOf'].replace('{game}', '2').replace('{bestOf}', '3'),
    );
    expect(screen.getByTestId('strip-interval').textContent).toBe(
      en['scoring.badminton.intervalAt'].replace('{point}', '11'),
    );
  });

  // Owner, 2026-11-01: "move interval at 11 to far right". The first fact reads from the left, the last ends at the right.
  it('ends the last fact at the right edge; the first reads from the left', () => {
    renderWithPorts(
      <PadStrip
        items={[
          { slot: 'game', text: { key: 'scoring.badminton.gameOf', vars: { game: 2, bestOf: 3 } } },
          { slot: 'interval', text: { key: 'scoring.badminton.intervalAt', vars: { point: 11 } } },
        ]}
      />,
    );
    const align = (slot: string) => {
      const words = screen.getByTestId(`strip-${slot}`).firstElementChild;
      if (words === null) throw new Error(`no words in ${slot}`);
      return getComputedStyle(words).textAlign;
    };
    expect(align('interval')).toBe('right');
    expect(align('game')).not.toBe('right');
  });

  it('keeps a lone fact at the left', () => {
    renderWithPorts(
      <PadStrip items={[{ slot: 'interval', text: { key: 'scoring.badminton.intervalNow' } }]} />,
    );
    expect(
      getComputedStyle(screen.getByText(en['scoring.badminton.intervalNow'])).textAlign,
    ).not.toBe('right');
  });

  it('keeps an unknown fact’s slot, empty: no dash', () => {
    renderWithPorts(
      <PadStrip
        items={[
          { slot: 'game', text: { key: 'scoring.badminton.intervalNow' } },
          { slot: 'interval', text: null },
        ]}
      />,
    );
    expect(screen.getByTestId('strip-interval').textContent).toBe('');
    expect(screen.getByTestId('pad-strip').textContent).not.toMatch(/[—–-]/);
  });

  it('lets a fact take its reserved lines, then cut', () => {
    renderWithPorts(
      <PadStrip items={[{ slot: 'interval', text: { key: 'scoring.badminton.intervalNow' } }]} />,
    );
    expect(linesAllowed(screen.getByText(en['scoring.badminton.intervalNow']))).toBe(
      layout.padStripLines,
    );
  });
});
