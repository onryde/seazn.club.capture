import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('HomeScreen (stub)', () => {
  it('renders through the ports with no native module', () => {
    renderWithPorts(<HomeScreen />);
    expect(screen.getByText('Seazn')).toBeTruthy();
    expect(screen.getByText('Tap a mode, then scan its code.')).toBeTruthy();
  });
});
