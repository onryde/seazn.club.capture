import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { Tile } from '@/ui/components/Tile';
import { declaredStyle } from '../../../test/declaredStyle';
import { linesAllowed } from '../../../test/linesAllowed';
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

  // M2 of the Batch 5 review: the whole tile above the link is still its button. The frame wears the edge, the ground
  // and the bottom padding; the button wears the top and side padding, so a tap on the rim starts a scan as a plain
  // tile's does; the link's row is padded the same and is the only part outside the button.
  it.each(['portrait', 'landscape'] as const)(
    'with a link, the %s button reaches the tile’s rim, and only the link’s row is outside it',
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
      const body = screen.getByRole('button', { name: /Live Stream/ });
      const link = screen.getByRole('button', { name: 'Stream settings' });
      const pad = layout === 'portrait' ? '16px' : '12px';
      const frameStyle = getComputedStyle(frame);
      expect(frameStyle.borderLeftWidth).toBe('4px');
      expect([frameStyle.paddingTop, frameStyle.paddingLeft, frameStyle.paddingRight]).toEqual([
        '0px',
        '0px',
        '0px',
      ]);
      expect(frameStyle.paddingBottom).toBe(pad);
      const bodyStyle = getComputedStyle(body);
      expect([bodyStyle.paddingTop, bodyStyle.paddingLeft, bodyStyle.paddingRight]).toEqual([
        pad,
        pad,
        pad,
      ]);
      const linkRow = link.parentElement as HTMLElement;
      expect([...frame.children]).toEqual([body, linkRow]);
      expect([
        getComputedStyle(linkRow).paddingLeft,
        getComputedStyle(linkRow).paddingRight,
      ]).toEqual([pad, pad]);
    },
  );

  // N31 (item A2 of the D3 findings design, §10): the title gives way to the icon beside it and wraps to at most two
  // lines, then an ellipsis. jsdom has no text layout, so this reads the style react-native-web rendered from the props;
  // that a French title stays inside its tile is homeFit.test.ts's measurement and the phone's (Batch 9). Both bodies
  // (a plain tile, and the button inside a framed one) in both layouts.
  it.each([
    ['scoring', false, 'portrait', false],
    ['dashboard', false, 'landscape', false],
    ['stream', true, 'portrait', true],
    ['stream', true, 'landscape', true],
  ] as const)(
    'the %s title (available: %s, %s, link: %s) may shrink and wraps to at most two lines (N31)',
    (mode, available, layout, withLink) => {
      renderWithPorts(
        <Tile
          mode={mode}
          available={available}
          layout={layout}
          onPress={vi.fn()}
          link={withLink ? { label: 'Stream settings', onPress: vi.fn() } : undefined}
        />,
      );
      const title = screen.getByText(en[`mode.${mode}`]);
      // Declared, not computed: jsdom computes CSS's initial flex-shrink, 1, for a Text with no style at all.
      expect(declaredStyle(title, 'flex-shrink')).toBe('1');
      expect(linesAllowed(title)).toBe(2);
    },
  );

  it('a tile with no link is unchanged: one button, which is the tile', () => {
    renderWithPorts(<Tile mode="scoring" available={false} onPress={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId('tile-scoring')).toBeNull();
    expect(getComputedStyle(screen.getByRole('button')).borderLeftWidth).toBe('4px');
  });
});
