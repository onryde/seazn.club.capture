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
          {
            slot: 'context',
            text: { key: 'scoring.badminton.context', vars: { bestOf: 3, game: 2 } },
          },
          { slot: 'court', text: { key: 'scoring.badminton.court.right' } },
        ]}
      />,
    );
    const slots = screen.getByTestId('pad-strip').children;
    expect([...slots].map((slot) => slot.getAttribute('data-testid'))).toEqual([
      'strip-context',
      'strip-court',
    ]);
    expect(screen.getByTestId('strip-context').textContent).toBe(
      en['scoring.badminton.context'].replace('{bestOf}', '3').replace('{game}', '2'),
    );
    expect(screen.getByTestId('strip-court').textContent).toBe(en['scoring.badminton.court.right']);
  });

  it('keeps an unknown fact’s slot, empty: no dash', () => {
    renderWithPorts(
      <PadStrip
        items={[
          { slot: 'court', text: { key: 'scoring.badminton.court.left' } },
          { slot: 'interval', text: null },
        ]}
      />,
    );
    expect(screen.getByTestId('strip-interval').textContent).toBe('');
    expect(screen.getByTestId('pad-strip').textContent).not.toMatch(/[—–-]/);
  });

  it('lets a fact take its reserved lines, then cut', () => {
    renderWithPorts(
      <PadStrip items={[{ slot: 'court', text: { key: 'scoring.badminton.court.left' } }]} />,
    );
    expect(linesAllowed(screen.getByText(en['scoring.badminton.court.left']))).toBe(
      layout.padStripLines,
    );
  });
});
