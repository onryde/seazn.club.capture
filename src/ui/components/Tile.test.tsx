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

  // R2: the Stream settings link inside the Live Stream tile.
  it('the link is a sibling of the tile’s button, not inside it, and each press is its own', () => {
    const tap = vi.fn();
    const open = vi.fn();
    renderWithPorts(
      <Tile
        mode="stream"
        available
        onPress={tap}
        link={{ label: 'Stream settings', onPress: open }}
      />,
    );
    const tile = screen.getByRole('button', { name: /Live Stream/ });
    const link = screen.getByRole('button', { name: 'Stream settings' });
    expect(tile.contains(link)).toBe(false);
    fireEvent.click(link);
    expect([open.mock.calls.length, tap.mock.calls.length]).toEqual([1, 0]);
    fireEvent.click(tile);
    expect([open.mock.calls.length, tap.mock.calls.length]).toEqual([1, 1]);
    fireEvent.click(link);
    expect([open.mock.calls.length, tap.mock.calls.length]).toEqual([2, 1]);
  });

  it('the link is a 48 dp target', () => {
    renderWithPorts(
      <Tile
        mode="stream"
        available
        onPress={vi.fn()}
        link={{ label: 'Stream settings', onPress: vi.fn() }}
      />,
    );
    expect(
      getComputedStyle(screen.getByRole('button', { name: 'Stream settings' })).minHeight,
    ).toBe('48px');
  });

  // The frame carries what the tile's button carried, so Home's per-tile checks read the same edge and padding.
  it.each(['portrait', 'landscape'] as const)(
    'with a link, the %s frame wears the tile’s edge and padding, and holds the button then the link',
    (layout) => {
      renderWithPorts(
        <Tile
          mode="stream"
          available
          layout={layout}
          onPress={vi.fn()}
          link={{ label: 'Stream settings', onPress: vi.fn() }}
        />,
      );
      const frame = screen.getByTestId('tile-stream');
      const pad = layout === 'portrait' ? '16px' : '12px';
      expect(getComputedStyle(frame).borderLeftWidth).toBe('4px');
      expect(getComputedStyle(frame).paddingTop).toBe(pad);
      expect([...frame.children]).toEqual([
        screen.getByRole('button', { name: /Live Stream/ }),
        screen.getByRole('button', { name: 'Stream settings' }),
      ]);
      expect(getComputedStyle(screen.getByRole('button', { name: /Live Stream/ })).paddingTop).toBe(
        '0px',
      );
    },
  );

  it('a tile with no link is unchanged: one button, which is the tile', () => {
    renderWithPorts(<Tile mode="scoring" available={false} onPress={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId('tile-scoring')).toBeNull();
    expect(getComputedStyle(screen.getByRole('button')).borderLeftWidth).toBe('4px');
  });
});
