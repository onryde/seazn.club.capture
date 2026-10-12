import { act, fireEvent, screen, within } from '@testing-library/react';
import { Dimensions } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import type { EndedCard } from '@/domain/session/endedCard';
import { STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { comesBefore, textsIn } from '../../../test/endedFlow';
import { TEST_NOW } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';

afterEach(restoreWindowSize);

/** Spec §7 and the board: Home, portrait (Main) and landscape (Home-landscape, After-you-stopped-landscape). */
const PORTRAIT = [390, 844] as const;
const LANDSCAPE = [844, 390] as const;

const EXPIRES = new Date(TEST_NOW.getTime() + 2 * 3600_000);
/** A fatal end keeps its code: the worst case, the ended card and Continue together (F15). */
const FATAL: EndedCard = { reason: 'fatal-error', durationMs: 754_000, codeEnded: false };
const savedStream = () =>
  encodeSavedCode(
    savedStreamCode({
      raw: captureRaw({ exp: epochSeconds(EXPIRES), slot: 1 }),
      expiresAt: EXPIRES,
    }),
  );

type Cards = {
  readonly ended?: boolean;
  readonly saved?: boolean;
  /** The ports' dev tools: a release build has none, and the fakes default to a debug one. */
  readonly devTools?: boolean;
};

/** Home with the cards the case names: the ended card through its port, Continue through a saved code. */
async function renderHome({ ended = false, saved = false, devTools = false }: Cards = {}) {
  const home = renderWithPorts(<HomeScreen />, {
    devTools,
    ...(saved ? { kvSeed: { [STORE_KEYS.code('stream')]: savedStream() } } : {}),
  });
  await act(() => home.ports.modeStore.load());
  if (ended) act(() => home.ports.endedNotice.show(FATAL));
  return home;
}

const homeRoot = () => screen.getByTestId('home');
const layoutOf = () => homeRoot().dataset.layout;
const logo = () => screen.getByLabelText('Seazn Club');
const status = () => screen.getByText('Tap a mode, then scan its code.');
const ended = () => screen.getByRole('region', { name: 'Stream ended' });
const continueCard = () => screen.getByTestId('continue-card');
const tiles = () => screen.getByTestId('tiles');
const language = () => screen.getByRole('button', { name: /^Language/ });
const version = () => screen.getByText('Version 0.0.0-test');
const style = (element: Element) => getComputedStyle(element);

/** Every button's first text, in document order: the control set a person reads. */
const controls = () =>
  screen.getAllByRole('button').map((button) => textsIn(button)[0] ?? '(no text)');

/** Whether the elements run in this order in the document, and the order is not vacuous. */
function inOrder(elements: readonly Element[]): boolean {
  expect(elements.length).toBeGreaterThan(1);
  return elements.every(
    (element, at) => at === 0 || comesBefore(elements[at - 1] as Element, element),
  );
}

describe('Home turns with the phone (spec §7)', () => {
  it('the helper really turns the window (positive control, D13, F12)', async () => {
    await renderHome();
    expect(layoutOf()).toBe('portrait');
    setWindowSize(...LANDSCAPE);
    expect(Dimensions.get('window')).toMatchObject({ width: 844, height: 390 });
    expect(layoutOf()).toBe('landscape'); // the same rendered tree
    setWindowSize(...PORTRAIT);
    expect(Dimensions.get('window')).toMatchObject({ width: 390, height: 844 });
    expect(layoutOf()).toBe('portrait');
  });

  it('starts on the jsdom window again after a landscape test (order-dependent, D13)', async () => {
    expect(Dimensions.get('window')).toMatchObject({ width: 0, height: 0 });
    await renderHome();
    expect(layoutOf()).toBe('portrait');
  });

  describe('portrait: the order is unchanged', () => {
    it('is the logo, the status, the ended card, Continue, the tiles, then Language and the version', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome({ ended: true, saved: true });
      expect(layoutOf()).toBe('portrait');
      expect(
        inOrder([logo(), status(), ended(), continueCard(), tiles(), language(), version()]),
      ).toBe(true);
      expect(screen.queryByTestId('home-top')).toBeNull();
      expect(style(tiles()).flexDirection).toBe('column');
      expect(tiles().children).toHaveLength(3);
    });

    it('draws the logo at spec §7’s 200 × 70, its own aspect, named for a screen reader', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome();
      expect([style(logo()).width, style(logo()).height]).toEqual(['200px', '70px']);
      expect(logo().getAttribute('role')).toBe('img');
      // The board hangs the file's own 16 dp of empty left edge outside the column (Main.dc.html).
      expect(style(logo()).marginLeft).toBe('-16px');
      // The title is the logo now: the word is not drawn twice.
      expect(screen.queryByText('Seazn')).toBeNull();
      expect(screen.queryByText('Seazn Club')).toBeNull();
    });

    it('stacks the ended card and Continue as cards, never as rows', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome({ ended: true, saved: true });
      expect(style(ended()).flexDirection).toBe('column');
      expect(style(continueCard()).flexDirection).toBe('column');
    });
  });

  describe('landscape: one top row, the ended card, Continue, the tiles side by side (F15)', () => {
    it('puts the logo, the status, Language and the version in one row, in that order', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      expect(layoutOf()).toBe('landscape');
      const top = screen.getByTestId('home-top');
      expect(style(top).flexDirection).toBe('row');
      for (const part of [logo(), status(), language(), version()]) {
        expect({ text: part.textContent, inTop: top.contains(part) }).toEqual({
          text: part.textContent,
          inTop: true,
        });
      }
      expect(inOrder([logo(), status(), language(), version()])).toBe(true);
      // Language and the version sit together, after the status: the board's right end of the row.
      expect(top.children).toHaveLength(3);
    });

    it('then the ended card as one row, then Continue as one row, then the tiles, and no footer after them', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      const top = screen.getByTestId('home-top');
      expect(inOrder([top, ended(), continueCard(), tiles()])).toBe(true);
      expect(style(ended()).flexDirection).toBe('row');
      expect(style(continueCard()).flexDirection).toBe('row');
      expect(style(tiles()).flexDirection).toBe('row');
      expect(tiles().children).toHaveLength(3);
      // The footer left for the top row: nothing of it follows the tiles.
      expect(comesBefore(tiles(), language())).toBe(false);
      expect(comesBefore(tiles(), version())).toBe(false);
    });

    it('draws the logo at Q2’s 160 × 56', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      expect([style(logo()).width, style(logo()).height]).toEqual(['160px', '56px']);
      expect(style(logo()).marginLeft).toBe('-12px');
    });

    it('keeps each row’s own parts: the ended card’s lines and OK, Continue’s title and its two buttons', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      expect(textsIn(ended())).toEqual([
        'Stream ended',
        'On air 0:12:34',
        'Something failed. Your code is kept.',
        'OK',
      ]);
      const card = within(continueCard());
      expect(card.getByText('Continue Live Stream')).toBeTruthy();
      expect(card.getByRole('button', { name: 'Continue' })).toBeTruthy();
      expect(card.getByRole('button', { name: 'Forget' })).toBeTruthy();
    });

    it('is the same Home without the cards: the top row, then the tiles', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      expect(screen.queryByRole('region', { name: 'Stream ended' })).toBeNull();
      expect(screen.queryByTestId('continue-card')).toBeNull();
      expect(inOrder([screen.getByTestId('home-top'), tiles()])).toBe(true);
      expect(tiles().children).toHaveLength(3);
    });

    it('still presses: OK clears the ended card, Continue is its own button', async () => {
      setWindowSize(...LANDSCAPE);
      const home = await renderHome({ ended: true, saved: true });
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(home.ports.endedNotice.getSnapshot()).toBeNull();
      expect(screen.queryByRole('region', { name: 'Stream ended' })).toBeNull();
      // Positive pair: Home and the rest of its rows are still there.
      expect(continueCard()).toBeTruthy();
      expect(tiles().children).toHaveLength(3);
    });
  });

  // homeFit.test.ts adds the landscape rows up from these numbers; these are the rendered witness that the
  // screen wears them, which a token-sum test cannot see.
  describe('landscape wears the board’s sizes (the numbers homeFit adds up)', () => {
    const edges = (element: Element) => {
      const computed = style(element);
      return [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft,
      ];
    };
    /**
     * A tile's padding as the operator sees it. A tile with the Stream settings link is a frame: its button (the first
     * child) wears the top and sides, and the frame the bottom (M2 of the Batch 5 review).
     */
    const tileEdges = (tile: Element) => {
      if (!(tile as HTMLElement).dataset.testid?.startsWith('tile-')) return edges(tile);
      const [top, right, , left] = edges(tile.firstElementChild as Element);
      return [top, right, edges(tile)[2], left];
    };

    it('pads the screen 12 above, 16 at the sides and 16 below, with 12 between rows', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      const rows = screen.getByTestId('home-top').parentElement as HTMLElement;
      expect(edges(rows)).toEqual(['12px', '16px', '16px', '16px']);
      expect(style(rows).gap).toBe('12px');
      expect(rows.children).toHaveLength(4); // the top row, the ended card, Continue, the tiles
      // The padding is the scroller's content's, once: the screen itself adds none (28 above, not 12).
      expect(edges(homeRoot())).toEqual(['0px', '0px', '0px', '0px']);
      setWindowSize(...PORTRAIT);
      expect(edges(homeRoot())).toEqual(['16px', '16px', '16px', '16px']);
    });

    // P7 (the D3 fixes plan's ruling, the controller's): portrait scrolls the same way, since the Stream settings link
    // makes the Live Stream tile taller than a small portrait phone's share of the column.
    it('scrolls only when its rows outgrow the window: a scroller around them, in both layouts', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      const rows = screen.getByTestId('home-top').parentElement as HTMLElement;
      const scroller = rows.parentElement as HTMLElement;
      expect(['auto', 'scroll']).toContain(style(scroller).overflowY);
      // Down only: a row wider than the window is a layout defect to fix, never a sideways scroll to hide it.
      expect(['auto', 'scroll']).not.toContain(style(scroller).overflowX);
      expect(style(rows).flexGrow).toBe('1'); // short content still fills the window, so the tiles do
      // An auto basis, never `flex: 1`'s zero: that caps a scroller's content at the window, so it never scrolls.
      expect(style(rows).flexBasis).toBe('auto');
      expect(style(tiles()).flexGrow).toBe('1');
      setWindowSize(...PORTRAIT);
      const content = tiles().parentElement as HTMLElement;
      const portraitScroller = content.parentElement as HTMLElement;
      expect(['auto', 'scroll']).toContain(style(portraitScroller).overflowY);
      expect(['auto', 'scroll']).not.toContain(style(portraitScroller).overflowX);
      expect(style(content).flexGrow).toBe('1'); // the tiles still share the window when they fit
      expect(style(content).flexBasis).toBe('auto');
      expect(style(tiles()).flexGrow).toBe('1');
      // M1 of the Batch 5 review: the column of tiles takes an auto basis too, never a zero inside the scroller.
      expect(style(tiles()).flexBasis).toBe('auto');
    });

    it('sets both cards’ rows 10 above and below and 12 at the end, 16 at the start, a hairline round', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      for (const card of [ended(), continueCard()]) {
        expect(edges(card)).toEqual(['10px', '12px', '10px', '16px']);
        expect(style(card).borderTopWidth).toBe('1px');
        expect(style(card).borderBottomWidth).toBe('1px');
      }
    });

    it('lets Continue’s words take what its two buttons leave, and the buttons keep their size', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ saved: true });
      const [words, buttons] = [...continueCard().children];
      expect(within(words as HTMLElement).getByText('Continue Live Stream')).toBeTruthy();
      expect(style(words as HTMLElement).flexGrow).toBe('1');
      expect(within(buttons as HTMLElement).getAllByRole('button')).toHaveLength(2);
      expect(style(buttons as HTMLElement).flexDirection).toBe('row');
      expect(continueCard().children).toHaveLength(2);
    });

    it('keeps the controls’ own heights the fit adds: OK and Forget 48, the Continue plate 56', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome({ ended: true, saved: true });
      const minHeight = (name: string) => style(screen.getByRole('button', { name })).minHeight;
      expect({
        OK: minHeight('OK'),
        Forget: minHeight('Forget'),
        Continue: minHeight('Continue'),
      }).toEqual({
        OK: '48px',
        Forget: '48px',
        Continue: '56px',
      });
      expect(style(language()).minHeight).toBe('48px');
    });

    it('sets the tiles 8 apart, each with its 4 dp edge and 12 dp of padding, and the top row 16 apart', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      expect(style(tiles()).gap).toBe('8px');
      expect(tiles().children).toHaveLength(3);
      for (const tile of tiles().children) {
        expect(style(tile).borderLeftWidth).toBe('4px');
        expect(tileEdges(tile)).toEqual(['12px', '12px', '12px', '12px']);
      }
      expect(style(screen.getByTestId('home-top')).gap).toBe('16px');
    });

    it('keeps portrait’s tiles at 16 dp of padding: the tightening is landscape’s alone (fix round 1)', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome();
      expect(tiles().children).toHaveLength(3);
      for (const tile of tiles().children) {
        expect(style(tile).borderLeftWidth).toBe('4px');
        expect(tileEdges(tile)).toEqual(['16px', '16px', '16px', '16px']);
      }
      // And a turn to landscape and back lands on the same 16 (the tile's style is chosen per render).
      setWindowSize(...LANDSCAPE);
      for (const tile of tiles().children) expect(tileEdges(tile)[0]).toBe('12px');
      setWindowSize(...PORTRAIT);
      for (const tile of tiles().children) expect(tileEdges(tile)[0]).toBe('16px');
    });

    // P7 as built: a portrait tile grows from its own content (auto basis), so the Live Stream tile with its link is
    // never squeezed below its words when the column is short, and the column scrolls instead. An equal third (a zero
    // basis) squeezes it on any window under 748 dp tall (homeFit.test.ts). Landscape keeps equal thirds of the row's
    // width; the row's height is the tallest tile's.
    it('grows portrait tiles from their content, and splits the landscape row in equal widths', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome();
      const frames = () => [...tiles().children].map((tile) => style(tile));
      expect(frames()).toHaveLength(3);
      for (const tile of frames()) expect([tile.flexGrow, tile.flexBasis]).toEqual(['1', 'auto']);
      setWindowSize(...LANDSCAPE);
      for (const tile of frames()) expect([tile.flexGrow, tile.flexBasis]).toEqual(['1', '0%']);
    });

    it('reserves the status three lines of the status role, 57, in both layouts (the height homeFit adds up)', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      expect(style(status()).minHeight).toBe('57px');
      setWindowSize(...PORTRAIT);
      expect(style(status()).minHeight).toBe('57px');
    });
  });

  describe('the top row copes with a wide footer (the open language list)', () => {
    it('lets the status take what the footer leaves, and a footer that cannot fit wrap under', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      const top = screen.getByTestId('home-top');
      expect(style(top).flexWrap).toBe('wrap');
      const statusBox = status().parentElement as HTMLElement;
      expect(statusBox.parentElement).toBe(top);
      expect(style(statusBox).flexGrow).toBe('1');
      // Language and the version never shrink: they wrap to a row of their own before they squeeze.
      const footer = language().parentElement?.parentElement as HTMLElement;
      expect(footer.parentElement).toBe(top);
      expect(style(footer).flexShrink).toBe('0');
      expect(style(footer).flexDirection).toBe('row');
    });

    it('opens the four languages from the top row, and picking one closes the list', async () => {
      setWindowSize(...LANDSCAPE);
      await renderHome();
      fireEvent.click(language());
      const top = screen.getByTestId('home-top');
      for (const name of ['English', 'Español', 'Français', 'Nederlands']) {
        expect(within(top).getByRole('button', { name })).toBeTruthy();
      }
      expect(within(top).getByText('Tap a mode, then scan its code.')).toBeTruthy();
      fireEvent.click(within(top).getByRole('button', { name: 'Español' }));
      expect(screen.queryByRole('button', { name: 'Nederlands' })).toBeNull();
      expect(screen.getByRole('button', { name: /^Idioma · Español/ })).toBeTruthy();
    });
  });

  describe('the same controls in both layouts (a control-set diff)', () => {
    // Spec §7, written out: portrait is layout A's order with the footer last; landscape moves only the
    // footer (Language) up into the top row, ahead of the cards. The version is text, not a control.
    const PORTRAIT_CONTROLS = [
      'OK',
      'Continue',
      'Forget',
      'Live Stream',
      'Remote Scoring',
      'Dashboard',
      'Language · English',
    ];
    const LANDSCAPE_CONTROLS = [
      'Language · English',
      'OK',
      'Continue',
      'Forget',
      'Live Stream',
      'Remote Scoring',
      'Dashboard',
    ];

    it('lists the same seven, apart from the footer moving to the top', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome({ ended: true, saved: true });
      const inPortrait = controls();
      const logoInPortrait = logo().getAttribute('aria-label');
      expect(inPortrait).toEqual(PORTRAIT_CONTROLS);
      expect(version().textContent).toBe('Version 0.0.0-test');

      setWindowSize(...LANDSCAPE); // the same rendered tree turns
      const inLandscape = controls();
      expect(inLandscape).toEqual(LANDSCAPE_CONTROLS);
      expect(logo().getAttribute('aria-label')).toBe(logoInPortrait);
      expect(version().textContent).toBe('Version 0.0.0-test');
      // Membership and repeats: the diff is the footer's position and nothing else.
      expect([...inLandscape].sort()).toEqual([...inPortrait].sort());
      expect(inLandscape.filter((name) => !name.startsWith('Language'))).toEqual(
        inPortrait.filter((name) => !name.startsWith('Language')),
      );
    });
  });

  describe('the development tools keep to the tiles', () => {
    it('sit after the tiles in both layouts, and the footer follows them in portrait only', async () => {
      setWindowSize(...PORTRAIT);
      await renderHome({ devTools: true });
      const paste = () => screen.getByRole('button', { name: 'Use pasted code' });
      expect(inOrder([tiles(), paste(), language()])).toBe(true);
      setWindowSize(...LANDSCAPE); // the rows are laid out afresh: read them again
      expect(inOrder([screen.getByTestId('home-top'), tiles(), paste()])).toBe(true);
      expect(comesBefore(paste(), language())).toBe(false);
    });
  });

  describe('state survives a turn (the same HomeScreen, not a second tree)', () => {
    it('keeps the ended card and Continue through portrait, landscape and back', async () => {
      setWindowSize(...PORTRAIT);
      const home = await renderHome({ ended: true, saved: true });
      for (const [width, height] of [LANDSCAPE, PORTRAIT]) {
        setWindowSize(width, height);
        expect(ended()).toBeTruthy();
        expect(continueCard()).toBeTruthy();
        expect(home.ports.endedNotice.getSnapshot()).toEqual(FATAL);
      }
    });

    it('keeps an open code panel through a turn, and hides the landscape top row behind it too', async () => {
      setWindowSize(...LANDSCAPE);
      const home = await renderHome();
      home.scanner.queue({ outcome: 'scanned', raw: 'https://example.com/menu' });
      fireEvent.click(screen.getByRole('button', { name: /Live Stream/ }));
      await screen.findByText("This isn't a Seazn code.");
      // Behind the panel, from the accessibility tree: the whole of Home, the top row's Language included.
      const behind = home.container.querySelector('[aria-hidden="true"]');
      expect(behind?.textContent).toContain('Film a match to YouTube.');
      expect(behind?.textContent).toContain('Version 0.0.0-test');
      expect(screen.queryByRole('button', { name: /Language/ })).toBeNull();
      setWindowSize(...PORTRAIT);
      expect(screen.getByText("This isn't a Seazn code.")).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Language/ })).toBeNull();
    });
  });
});
