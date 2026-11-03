import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { Tile } from '@/ui/components/Tile';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { pressIn, pressOut } from '../../../test/press';
import { layoutOf, paintOf, pressTwice, unmountWhileHeld } from '../../../test/pressState';
import { layOut } from '../../../test/layOut';
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

  // The owner moved Settings to the gear in Home's corner (2026-11-02): no tile carries one, so each is one button, which
  // is the tile, padded all round and with its head row on the tile's whole width.
  it.each([
    ['scoring', false, 'portrait', '16px'],
    ['dashboard', false, 'portrait', '16px'],
    ['stream', true, 'portrait', '16px'],
    ['stream', true, 'landscape', '12px'],
  ] as const)(
    'the %s tile (%s, %s) is one button that is the tile, padded %s, with no gear',
    (mode, available, layout, padding) => {
      renderWithPorts(<Tile mode={mode} available={available} layout={layout} onPress={vi.fn()} />);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByTestId(`tile-${mode}`)).toBeNull();
      const tile = getComputedStyle(screen.getByRole('button'));
      expect([tile.borderLeftWidth, tile.paddingTop, tile.paddingRight]).toEqual([
        '4px',
        padding,
        padding,
      ]);
      const head = screen.getByText(en[`mode.${mode}`]).parentElement as HTMLElement;
      expect(getComputedStyle(head).marginRight).toBe('0px');
    },
  );

  // N31 (item A2 of the D3 findings design, §10): the title gives way to the icon beside it and wraps to at most two
  // lines, then an ellipsis. jsdom has no text layout, so this reads the style react-native-web rendered from the props;
  // that a French title stays inside its tile is homeFit.test.ts's measurement and the phone's (Batch 9).
  it.each([
    ['scoring', false, 'portrait'],
    ['dashboard', false, 'landscape'],
    ['stream', true, 'portrait'],
    ['stream', true, 'landscape'],
  ] as const)(
    'the %s title (available: %s, %s) may shrink and wraps to at most two lines (N31)',
    (mode, available, layout) => {
      renderWithPorts(<Tile mode={mode} available={available} layout={layout} onPress={vi.fn()} />);
      const title = screen.getByText(en[`mode.${mode}`]);
      // Declared, not computed: jsdom computes CSS's initial flex-shrink, 1, for a Text with no style at all.
      expect(declaredStyle(title, 'flex-shrink')).toBe('1');
      expect(linesAllowed(title)).toBe(2);
    },
  );

  // N31, fix round 1 (the controller's ruling, 2026-10-12): the title's row reports its width, and where the room is
  // narrower than the widest word the title steps down to `action` (`tileTitleRole`; homeFit.test.ts measures why).
  // jsdom lays nothing out, so `layOut` delivers the row's width as the phone would. Rows: 153.33 is a tile on a 592 dp
  // Home sideways, 169.33 on a 640 one.
  it.each(['portrait', 'landscape'] as const)(
    'the %s title is at full size until its row is measured, steps down where the row is narrow and back where it is wide (N31)',
    (layout) => {
      renderWithPorts(<Tile mode="stream" available layout={layout} onPress={vi.fn()} />);
      const title = screen.getByText(en['mode.stream']);
      const row = title.parentElement as HTMLElement;
      const size = () => title.style.fontSize;
      expect(size()).toBe(`${typeScale.title.fontSize}px`);
      layOut(row, { width: 153.33, height: 58 });
      expect(size()).toBe(`${typeScale.action.fontSize}px`);
      expect(title.style.lineHeight).toBe(`${typeScale.action.lineHeight}px`);
      // The step keeps the shrink and the clamp.
      expect(declaredStyle(title, 'flex-shrink')).toBe('1');
      expect(linesAllowed(title)).toBe(2);
      layOut(row, { width: 169.33, height: 29 });
      expect(size()).toBe(`${typeScale.title.fontSize}px`);
    },
  );
});

// The controller's ruling (Batch 17; the owner has not ruled), after the owner held a Home control and saw nothing
// change until it opened on lift: a pressed control is never a 15% dim. The tile dims to 0.7, as the lime Button does,
// and neither its paint nor its box otherwise moves. Whether it reads outdoors is the owner's device check; jsdom sees
// no colour and no press feedback (AGENTS §10).
describe('Tile pressed (the controller’s ruling, Batch 17)', () => {
  const tile = () => screen.getByRole('button', { name: /Live Stream/ });
  const opacityOf = (element: HTMLElement) => getComputedStyle(element).opacity;

  it.each(['portrait', 'landscape'] as const)(
    '%s: the tile dims to 0.7 while held, keeps its paint and box, and comes back on release',
    (layout) => {
      renderWithPorts(<Tile mode="stream" available layout={layout} onPress={vi.fn()} />);
      const resting = { paint: paintOf(tile()), box: layoutOf(tile()) };
      expect(resting.paint.opacity).toBe('1');
      expect(resting.box['padding-left']).not.toBe(''); // anti-vacuity: the box is read
      pressIn(tile());
      expect({ paint: paintOf(tile()), box: layoutOf(tile()) }).toEqual({
        paint: { ...resting.paint, opacity: '0.7' },
        box: resting.box,
      });
      pressOut(tile());
      expect({ paint: paintOf(tile()), box: layoutOf(tile()) }).toEqual(resting);
    },
  );

  it('a mode that is not built never shows pressed', () => {
    renderWithPorts(<Tile mode="dashboard" available={false} onPress={vi.fn()} />);
    const dashboard = screen.getByRole('button', { name: /Dashboard/ });
    const resting = paintOf(dashboard);
    pressIn(dashboard);
    expect(paintOf(dashboard)).toEqual(resting);
    expect(resting.opacity).toBe('1');
    pressOut(dashboard);
  });

  it('a second press, and a press while held, find nothing stuck', () => {
    renderWithPorts(<Tile mode="stream" available onPress={vi.fn()} />);
    expect(pressTwice(tile, () => opacityOf(tile()))).toEqual(['1', '0.7', '1', '0.7', '1']);
  });

  it('the tile held and unmounted: no timer is left and nothing fires', () => {
    const tap = vi.fn();
    const view = renderWithPorts(<Tile mode="stream" available onPress={tap} />);
    expect(unmountWhileHeld(tile, view.unmount)).toEqual({ held: 1, left: 0 });
    expect(tap.mock.calls.length).toBe(0);
  });
});
