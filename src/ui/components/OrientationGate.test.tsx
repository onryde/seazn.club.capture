import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrientationGate } from '@/ui/components/OrientationGate';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('OrientationGate', () => {
  it('covers the app with the turn card until the phone is sideways', async () => {
    const view = renderWithPorts(<OrientationGate target="landscape" />);
    await act(async () => undefined);
    act(() => {
      for (let t = 0; t <= 400; t += 100) view.motion.emit({ x: 0, y: 1, z: 0 }, t);
    });
    expect(screen.getByText('Turn your phone sideways')).toBeTruthy();
    act(() => {
      for (let t = 1000; t <= 1400; t += 100) view.motion.emit({ x: 1, y: 0, z: 0 }, t);
    });
    expect(screen.queryByText('Turn your phone sideways')).toBeNull();
  });
});
