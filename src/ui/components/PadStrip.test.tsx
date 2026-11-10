import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { PadStrip } from '@/ui/components/PadStrip';
import { layout } from '@/ui/theme/tokens';
import { linesAllowed } from '../../../test/linesAllowed';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('PadStrip', () => {
  // T20 fix 12 (owner, 2026-11-10, build 1002: "why are we not using this space?"): a sport with no slots has no fact that
  // could come and go, so the row reserves nothing and draws nothing.
  it('draws nothing for a sport with no slots', () => {
    renderWithPorts(<PadStrip items={[]} />);
    expect(screen.queryByTestId('pad-strip')).toBeNull();
  });

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

  // S2-4 plan Task 18 (the controller's carried item): cricket's result names a club by its whole name, which a thirty-
  // character club makes wider than the strip's line. That fact asks for two lines; every other keeps the kit's one.
  it('lets a fact that asks for more lines have them, and no other', () => {
    renderWithPorts(
      <PadStrip
        items={[
          { slot: 'note', text: { key: 'scoring.cricket.result.tie' }, lines: 2 },
          { slot: 'other', text: { key: 'scoring.cricket.result.draw' } },
        ]}
      />,
    );
    expect(linesAllowed(screen.getByText(en['scoring.cricket.result.tie']))).toBe(2);
    expect(linesAllowed(screen.getByText(en['scoring.cricket.result.draw']))).toBe(
      layout.padStripLines,
    );
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
