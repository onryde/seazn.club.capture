import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tile } from '@/ui/components/Tile';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('Tile', () => {
  it('names the mode, says what it does and which code opens it', () => {
    const onPress = vi.fn();
    renderWithPorts(<Tile mode="stream" available onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: /Live Stream/ }));
    expect(onPress).toHaveBeenCalledWith('stream');
    expect(screen.getByText('Film a match to YouTube.')).toBeTruthy();
    expect(screen.getByText('Scan the stream code from the match page')).toBeTruthy();
  });

  it('says coming soon and cannot be tapped when the mode is not built', () => {
    const onPress = vi.fn();
    renderWithPorts(<Tile mode="dashboard" available={false} onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: /Dashboard/ }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });
});
