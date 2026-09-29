import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnCard } from '@/ui/components/TurnCard';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('TurnCard', () => {
  it('asks for sideways on the way into Live Stream', () => {
    renderWithPorts(<TurnCard card="turnSideways" />);
    expect(screen.getByText('Turn your phone sideways')).toBeTruthy();
    expect(
      screen.getByText('Live Stream films in landscape. Either way round works.'),
    ).toBeTruthy();
  });

  it('asks for upright on the way out', () => {
    renderWithPorts(<TurnCard card="turnUpright" />);
    expect(screen.getByText('Turn your phone upright')).toBeTruthy();
  });
});
