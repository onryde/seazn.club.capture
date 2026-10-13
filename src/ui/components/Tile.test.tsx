import { fireEvent, screen, within } from '@testing-library/react';
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

  // R2 of the D3 findings design (owner, 2026-10-11), as the owner presented it on 2026-10-12 ("Instead of text, can we
  // have icon in right top corner?", the gear mockup): Stream settings is a gear in the Live Stream tile's top-right
  // corner, named "Stream settings" for a screen reader. It is the tile's sibling, never inside its button.
  const settings = (onPress: () => void = vi.fn()) => ({ label: 'Stream settings', onPress });

  it('the gear is a sibling of the tile’s button, not inside it, and each press is its own, a second tap too', () => {
    const tap = vi.fn();
    const open = vi.fn();
    renderWithPorts(<Tile mode="stream" available onPress={tap} settings={settings(open)} />);
    const tile = screen.getByRole('button', { name: /Live Stream/ });
    const gear = screen.getByRole('button', { name: 'Stream settings' });
    expect(tile.contains(gear)).toBe(false);
    expect(screen.getByTestId('tile-stream').contains(gear)).toBe(true);
    fireEvent.click(gear);
    fireEvent.click(gear);
    // The tile passes each tap on; the navigation port opens Settings once (HomeScreen.test.tsx).
    expect([open.mock.calls.length, tap.mock.calls.length]).toEqual([2, 0]);
    fireEvent.click(tile);
    expect([open.mock.calls.length, tap.mock.calls.length]).toEqual([2, 1]);
  });

  it('the gear is a 48 dp target in the tile’s top-right corner that draws the Settings glyph and no word', () => {
    renderWithPorts(<Tile mode="stream" available onPress={vi.fn()} settings={settings()} />);
    const gear = screen.getByRole('button', { name: 'Stream settings' });
    const box = getComputedStyle(gear);
    expect([box.position, box.top, box.right]).toEqual(['absolute', '0px', '0px']);
    expect([box.width, box.height]).toEqual(['48px', '48px']);
    // The on-air icon row's Settings glyph, in its ink2, at its 22 dp (IconButton.test.tsx).
    expect({ ...within(gear).getByTestId('glyph').dataset }).toEqual({
      testid: 'glyph',
      name: 'settings',
      slashed: 'false',
      tone: 'ink2',
      size: 'default',
    });
    expect(gear.textContent).toBe('');
  });

  // M2 of the Batch 5 review, kept: all of the tile but the gear is still its button. The frame wears only the edge
  // and the ground; the button wears every side's padding, so a tap on the rim starts a scan as a plain tile's does.
  it.each(['portrait', 'landscape'] as const)(
    'with the gear, the %s button reaches the tile’s rim on every side, and only the gear is outside it',
    (layout) => {
      renderWithPorts(
        <Tile mode="stream" available layout={layout} onPress={vi.fn()} settings={settings()} />,
      );
      const frame = screen.getByTestId('tile-stream');
      const body = screen.getByRole('button', { name: /Live Stream/ });
      const gear = screen.getByRole('button', { name: 'Stream settings' });
      const frameStyle = getComputedStyle(frame);
      expect(frameStyle.borderLeftWidth).toBe('4px');
      const sides = (style: CSSStyleDeclaration) => [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ];
      expect(sides(frameStyle)).toEqual(['0px', '0px', '0px', '0px']);
      // Upright the button is padded 16 all round. Sideways its top is the gear's 48 (a band the head sits under, so
      // a title never runs beneath the gear: homeFit.test.ts), and the rest is the landscape tile's 12.
      expect(sides(getComputedStyle(body))).toEqual(
        layout === 'portrait' ? ['16px', '16px', '16px', '16px'] : ['48px', '12px', '12px', '12px'],
      );
      expect([...frame.children]).toEqual([body, gear]);
    },
  );

  // Upright the tile is the column's width, so the head row keeps clear of the gear instead: it ends 32 dp short of the
  // button's padding, where the 48 dp gear begins (48 less the 16 of padding). Sideways the band does it, and the head
  // keeps the full width. The head's own width (`onLayout`) is the title's room, so `tileTitleRole` reads it as laid
  // out beside the gear.
  it.each([
    ['portrait', '32px'],
    ['landscape', '0px'],
  ] as const)('the %s head row ends %s short of the padding beside the gear', (layout, margin) => {
    renderWithPorts(
      <Tile mode="stream" available layout={layout} onPress={vi.fn()} settings={settings()} />,
    );
    const head = screen.getByText(en['mode.stream']).parentElement as HTMLElement;
    expect(getComputedStyle(head).marginRight).toBe(margin);
  });

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
    'the %s title (available: %s, %s, gear: %s) may shrink and wraps to at most two lines (N31)',
    (mode, available, layout, withGear) => {
      renderWithPorts(
        <Tile
          mode={mode}
          available={available}
          layout={layout}
          onPress={vi.fn()}
          settings={withGear ? settings() : undefined}
        />,
      );
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
  it.each([
    ['portrait', false],
    ['landscape', true],
  ] as const)(
    'the %s title (gear: %s) is at full size until its row is measured, steps down where the row is narrow and back where it is wide (N31)',
    (layout, withGear) => {
      renderWithPorts(
        <Tile
          mode="stream"
          available
          layout={layout}
          onPress={vi.fn()}
          settings={withGear ? settings() : undefined}
        />,
      );
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

  // The tile without the gear: Remote Scoring and Dashboard have none, and Live Stream with a card above the tiles (P6).
  it.each([
    ['scoring', false],
    ['dashboard', false],
    ['stream', true],
  ] as const)(
    'a %s tile with no gear is unchanged: one button, which is the tile',
    (mode, available) => {
      renderWithPorts(<Tile mode={mode} available={available} onPress={vi.fn()} />);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByTestId(`tile-${mode}`)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Stream settings' })).toBeNull();
      const tile = getComputedStyle(screen.getByRole('button'));
      expect([tile.borderLeftWidth, tile.paddingTop, tile.paddingRight]).toEqual([
        '4px',
        '16px',
        '16px',
      ]);
      // With no gear, the head keeps the tile's whole width.
      const head = screen.getByText(en[`mode.${mode}`]).parentElement as HTMLElement;
      expect(getComputedStyle(head).marginRight).toBe('0px');
    },
  );
});

// The controller's ruling (Batch 17; the owner has not ruled), after the owner held the sliders glyph and saw nothing
// change until it opened on lift: a pressed control is never a 15% dim. Where the palette has no pressed colour to step
// to, the control dims to 0.7: a Home tile and its gear. Neither box moves. Whether it reads outdoors is the owner's
// device check; jsdom sees no colour and no press feedback (AGENTS §10).
describe('Tile pressed (the controller’s ruling, Batch 17)', () => {
  const tile = () => screen.getByRole('button', { name: /Live Stream/ });
  const gear = () => screen.getByRole('button', { name: 'Stream settings' });
  const opacityOf = (element: HTMLElement) => getComputedStyle(element).opacity;
  const settings = { label: 'Stream settings', onPress: vi.fn() };
  const FORMS = [
    ['portrait', false],
    ['landscape', false],
    ['portrait', true],
    ['landscape', true],
  ] as const;

  it.each(FORMS)(
    '%s, gear %s: the tile dims to 0.7 while held, keeps its paint and box, and comes back on release',
    (layout, withGear) => {
      renderWithPorts(
        <Tile
          mode="stream"
          available
          layout={layout}
          onPress={vi.fn()}
          settings={withGear ? settings : undefined}
        />,
      );
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

  it.each(['portrait', 'landscape'] as const)(
    '%s: the gear dims to 0.7 while held, its 48 dp corner box unmoved, and the tile beside it does not dim',
    (layout) => {
      renderWithPorts(
        <Tile mode="stream" available layout={layout} onPress={vi.fn()} settings={settings} />,
      );
      const resting = layoutOf(gear());
      expect([resting.width, resting.height]).toEqual(['48px', '48px']); // anti-vacuity: the box is read
      pressIn(gear());
      expect([opacityOf(gear()), opacityOf(tile())]).toEqual(['0.7', '1']);
      expect(layoutOf(gear())).toEqual(resting);
      pressOut(gear());
      expect(opacityOf(gear())).toBe('1');
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

  it('a second press, and a press while held, find nothing stuck: the tile and the gear', () => {
    renderWithPorts(<Tile mode="stream" available onPress={vi.fn()} settings={settings} />);
    const cycle = ['1', '0.7', '1', '0.7', '1'];
    expect(pressTwice(tile, () => opacityOf(tile()))).toEqual(cycle);
    expect(pressTwice(gear, () => opacityOf(gear()))).toEqual(cycle);
  });

  it.each([
    ['tile', tile],
    ['gear', gear],
  ] as const)('the %s held and unmounted: no timer is left and nothing fires', (_name, held) => {
    const tap = vi.fn();
    const open = vi.fn();
    const view = renderWithPorts(
      <Tile
        mode="stream"
        available
        onPress={tap}
        settings={{ label: 'Stream settings', onPress: open }}
      />,
    );
    expect(unmountWhileHeld(held, view.unmount)).toEqual({ held: 1, left: 0 });
    expect([tap.mock.calls.length, open.mock.calls.length]).toEqual([0, 0]);
  });
});
