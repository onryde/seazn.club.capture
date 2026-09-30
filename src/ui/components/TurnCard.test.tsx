import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TurnCardKind } from '@/domain/orientation/orientation';
import { TurnCard } from '@/ui/components/TurnCard';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('TurnCard', () => {
  it.each<TurnCardKind>(['turnSideways', 'turnUpright'])(
    '%s shows the turning glyph and no words (R28)',
    (card) => {
      const { container } = renderWithPorts(<TurnCard card={card} />);
      expect(screen.getByTestId('turn-glyph').getAttribute('data-card')).toBe(card);
      expect(container.textContent).toBe('');
    },
  );
});
