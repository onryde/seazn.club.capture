import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEY } from '@/hooks/advisory';
import en from '@/i18n/en.json';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { layOut } from '../../../test/layOut';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

type Viewfinder = Awaited<ReturnType<typeof renderViewfinder>>;

/**
 * Spec §1, canvas option A, as amended by the owner on 2026-10-08: the screen is two halves, and the controls half
 * takes the width its content needs (`layout.controlsHalf`, derived and proved by `controlsFit.test.ts`) while the
 * camera half takes the rest. The camera half is a 16:9 box with the status strip under it. This proves the structure
 * and the order of what is drawn, read from jsdom's cascade of react-native-web's classes. That it fits a phone is the
 * fit arithmetic's (`viewfinderFit.test.ts`) and the phone's (Task 9).
 */

/** Which token a component painted: the `paintOf` of Hud.test.tsx, so a colour is compared as jsdom resolves it. */
const TOKEN = StyleSheet.create({
  surface: { backgroundColor: colour.surface },
  stage: { backgroundColor: colour.stage },
  ground: { backgroundColor: colour.ground },
});

function paintOf(style: ViewStyle): string {
  const reference = render(<View testID="paint-reference" style={style} />);
  const painted = getComputedStyle(reference.getByTestId('paint-reference')).backgroundColor;
  reference.unmount();
  return painted;
}

/**
 * How many lines react-native-web lets a Text show, read from what it rendered
 * (the MatchLabel test's reading): `numberOfLines={2}` is `-webkit-line-clamp: 2`.
 */
function linesAllowed(element: Element): number {
  const style = getComputedStyle(element);
  const clamp = style.getPropertyValue('-webkit-line-clamp');
  if (clamp !== '') return Number(clamp);
  if (style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis') return 1;
  return Infinity;
}

const byId = (id: string) => screen.getByTestId(id);
/** `after` comes later in the document than `before`. */
const follows = (before: Element, after: Element) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
/** The accessible names of the buttons in a row, in order: an icon button has no text, only its label. */
const buttonNames = (row: HTMLElement) =>
  within(row)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const stopLive = () => screen.getByRole('button', { name: 'Hold to stop and unpair' });
const peek = () => screen.getByRole('button', { name: 'What viewers see' });
/** en['stream.status.waitingGoLive'] with FAKE_PAIRING's destination, written out. */
const WAITING = 'Waiting for Go live · YouTube · Fake CC';
const SCORE_AHEAD = en['stream.advisory.scoreAhead'];

/**
 * The caption of each advisory, and how a test brings it up alone (F17/D4: all five live in the strip).
 * `topAdvisory` shows one at a time, so each case starts from the state where its own is on top.
 */
const ADVISORIES: readonly (readonly [
  keyof typeof ADVISORY_KEY,
  string,
  (view: Viewfinder) => void,
])[] = [
  [
    'keepOpen',
    en['stream.advisory.keepOpen'],
    (view) => {
      view.engine.patch({ charging: true });
      view.engine.setSurvivesBackground(false);
    },
  ],
  ['shed', en['stream.advisory.shed'], (view) => view.engine.scene('shed')],
  ['overlayFailed', en['stream.advisory.overlayFailed'], (view) => view.surfaces.failOverlay()],
  ['scoreAhead', SCORE_AHEAD, (view) => view.engine.patch({ charging: true })],
  // The fake phone starts uncharged, so the default paired viewfinder already says it.
  ['notCharging', en['stream.advisory.notCharging'], () => undefined],
];
let advisoriesRun = 0;

/** The two halves as the cascade gives them: what each grows, shrinks and starts from, and the controls half's width. */
function halvesOf() {
  const camera = getComputedStyle(byId('camera-half'));
  const controls = getComputedStyle(byId('controls-half'));
  return {
    camera: { grow: camera.flexGrow, shrink: camera.flexShrink, basis: camera.flexBasis },
    controls: {
      grow: controls.flexGrow,
      shrink: controls.flexShrink,
      width: controls.width,
    },
  };
}

describe('the viewfinder is two halves (spec §1, amended 2026-10-08)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a root of exactly two halves, the camera half and the controls half', async () => {
    await renderViewfinder();
    const root = byId('viewfinder');
    expect([...root.children].map((half) => half.getAttribute('data-testid'))).toEqual([
      'camera-half',
      'controls-half',
    ]);
  });

  // Owner, 2026-10-08: the controls half has the width its content needs and no more; the camera half has everything
  // else. So the controls half is a fixed 310 that neither grows nor shrinks, and the camera half grows from nothing.
  it('gives the controls half a fixed width that neither grows nor shrinks, and the camera half the rest', async () => {
    await renderViewfinder();
    expect(halvesOf()).toEqual({
      camera: { grow: '1', shrink: '1', basis: '0%' },
      controls: { grow: '0', shrink: '0', width: `${layout.controlsHalf}px` },
    });
    expect(layout.controlsHalf).toBe(310);
  });

  it('puts the controls on the right, mirrors the halves for Left, and back for Right (controlsSide)', async () => {
    const view = await renderViewfinder();
    const RIGHT = halvesOf();
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row');
    await act(() => view.ports.streamSettings.set({ side: 'left' }));
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row-reverse');
    // Mirrored, the halves are still the same two, in the same DOM order, and the controls half is the same width:
    // only the side moves, never the rule (the camera half is still the one that flexes).
    expect(
      [...byId('viewfinder').children].map((half) => half.getAttribute('data-testid')),
    ).toEqual(['camera-half', 'controls-half']);
    expect(halvesOf()).toEqual(RIGHT);
    await act(() => view.ports.streamSettings.set({ side: 'right' }));
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row');
    expect(halvesOf()).toEqual(RIGHT);
  });
});

describe('the camera half (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is the camera box, then the status strip, in that order', async () => {
    await renderViewfinder();
    const half = byId('camera-half');
    expect([...half.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'camera-box',
      'status-strip',
    ]);
  });

  it('draws the preview and, with the overlay on and a URL, the overlay, over the box and nowhere else', async () => {
    await renderViewfinder();
    const box = byId('camera-box');
    expect(within(box).getByTestId('preview')).toBeTruthy();
    expect(within(box).getByTestId('overlay')).toBeTruthy();
    expect(within(byId('status-strip')).queryByTestId('preview')).toBeNull();
    expect(within(byId('status-strip')).queryByTestId('overlay')).toBeNull();
    expect(within(byId('controls-half')).queryByTestId('preview')).toBeNull();
    expect(within(byId('controls-half')).queryByTestId('overlay')).toBeNull();
  });

  it('draws no overlay with the score preview turned off, and the box is still there', async () => {
    const view = await renderViewfinder();
    await act(() => view.ports.streamSettings.set({ overlay: false }));
    expect(within(byId('camera-box')).queryByTestId('overlay')).toBeNull();
    expect(within(byId('camera-box')).getByTestId('preview')).toBeTruthy();
  });

  it('is a black 16:9 box as wide as its half until the half is measured, clipping what it holds', async () => {
    await renderViewfinder();
    const style = getComputedStyle(byId('camera-box'));
    expect(style.width).toBe('100%');
    // react-native-web writes `overflow: hidden` as its two axes.
    expect([style.overflowX, style.overflowY]).toEqual(['hidden', 'hidden']);
    expect(style.backgroundColor).toBe(paintOf(TOKEN.stage));
    // Spec §1: 16:9. react-native-web writes the ratio as "1.7777… / 1"; compared as a number.
    const [across, down] = style.getPropertyValue('aspect-ratio').split('/').map(Number);
    expect((across ?? NaN) / (down ?? NaN)).toBeCloseTo(16 / 9, 5);
  });

  it('plays What viewers see over the camera box, not the whole half', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    pressIn(peek());
    const video = byId('viewer-video');
    expect(byId('camera-box').contains(video)).toBe(true);
    expect(byId('status-strip').contains(video)).toBe(false);
    expect(byId('controls-half').contains(video)).toBe(false);
  });

  it('is drawn the same with the controls mirrored to the left', async () => {
    const view = await renderViewfinder();
    await act(() => view.ports.streamSettings.set({ side: 'left' }));
    const half = byId('camera-half');
    expect([...half.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'camera-box',
      'status-strip',
    ]);
    expect(within(byId('camera-box')).getByTestId('preview')).toBeTruthy();
  });
});

describe('the status strip (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is solid surface colour, laid out in the flow below the box, never drawn over the shot', async () => {
    await renderViewfinder();
    const strip = byId('status-strip');
    const style = getComputedStyle(strip);
    expect(style.backgroundColor).toBe(paintOf(TOKEN.surface));
    expect(style.position).not.toBe('absolute');
    expect(byId('camera-box').contains(strip)).toBe(false);
    expect(follows(byId('camera-box'), strip)).toBe(true);
  });

  it('carries the match label, then the status line, then before air with the overlay on the score-ahead note', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.patch({ charging: true }));
    const strip = byId('status-strip');
    const label = within(strip).getByTestId('match-label');
    const line = within(strip).getByText(WAITING);
    const note = within(strip).getByText(SCORE_AHEAD);
    expect(follows(label, line)).toBe(true);
    expect(follows(line, note)).toBe(true);
    // The label is the strip's alone: the old bottom strip's single line is gone.
    expect(screen.getAllByTestId('match-label')).toHaveLength(1);
  });

  it('says the score-ahead note before air only: on air the note is gone', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.patch({ charging: true }));
    expect(within(byId('status-strip')).getByText(SCORE_AHEAD)).toBeTruthy();
    act(() => view.engine.scene('live'));
    expect(screen.queryByText(SCORE_AHEAD)).toBeNull();
  });

  it('sets the status line in the body role, at most 2 lines, under the label (F20, Q4)', async () => {
    await renderViewfinder();
    const line = within(byId('status-strip')).getByText(WAITING);
    expect(getComputedStyle(line).fontSize).toBe(`${typeScale.body.fontSize}px`);
    expect(linesAllowed(line)).toBe(2);
  });

  it.each(ADVISORIES)(
    'carries the %s advisory in the strip, alone: not over the shot, not in the controls',
    async (_name, text, bringUp) => {
      const view = await renderViewfinder();
      act(() => bringUp(view));
      const caption = within(byId('status-strip')).getByText(text);
      expect(byId('camera-box').contains(caption)).toBe(false);
      expect(byId('controls-half').contains(caption)).toBe(false);
      // One caption at a time (topAdvisory): the other four are not up.
      for (const [other, otherText] of ADVISORIES) {
        if (otherText !== text) expect(screen.queryByText(otherText), other).toBeNull();
      }
      // The caption is small, grey and clamped to 2 lines (Q4).
      expect(getComputedStyle(caption).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
      expect(linesAllowed(caption)).toBe(2);
      advisoriesRun += 1;
    },
  );

  it('ran all five advisories, the five the engine declares', () => {
    // Anti-vacuity: the sweep above ran once per advisory in `ADVISORY_KEY`, and none were skipped.
    expect(ADVISORIES.map(([name]) => name).sort()).toEqual(Object.keys(ADVISORY_KEY).sort());
    expect(advisoriesRun).toBe(5);
  });

  it('draws the strip with no label and no caption before the pairing, and still says the line (empty case)', async () => {
    await renderViewfinder({}, { engine: 'idle' });
    const strip = byId('status-strip');
    expect(within(strip).queryByTestId('match-label')).toBeNull();
    expect(within(strip).queryByText(SCORE_AHEAD)).toBeNull();
    expect(byId('camera-box')).toBeTruthy();
    expect(byId('controls-half')).toBeTruthy();
    expect(byId('tally-plate').textContent).toBe('Starting');
  });
});

/**
 * Spec §2, R-F5: the round line is the first line of the strip, above the match label, and it yields: no
 * reserve was added, so it shows only when the strip has room beside the label (stageFit.ts). Real
 * components, nothing mocked; jsdom lays nothing out, so `layOut` delivers the sizes the phone would.
 * Whether the line fits on a real phone is Task 11's device check (item 3); this is the wiring.
 */
describe('the round line above the match label (spec §2, R-F5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A viewfinder paired with this match label and stage label, the strip and the label laid out. */
  async function withStage(
    stageLabel: string | null,
    { strip = 180, label = 44 }: { strip?: number; label?: number } = {},
  ) {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ label: 'A v B', stageLabel }) },
    );
    layOut(byId('status-strip'), { width: 320, height: strip });
    layOut(byId('match-label'), { width: 300, height: label });
    return view;
  }
  const stage = () => within(byId('status-strip')).queryByTestId('stage-line');

  it('listens: the strip takes a layout, so it can say how much room it has', async () => {
    await renderViewfinder();
    expect(() => layOut(byId('status-strip'), { width: 320, height: 180 })).not.toThrow();
    expect(() => layOut(byId('match-label'), { width: 300, height: 44 })).not.toThrow();
  });

  it('is the strip’s first row: the round line, then the match label, then the status line', async () => {
    await withStage('QF');
    const round = within(byId('status-strip')).getByTestId('stage-line');
    const label = within(byId('status-strip')).getByTestId('match-label');
    const status = within(byId('status-strip')).getByText(WAITING);
    expect(round.textContent).toBe('QF');
    expect(follows(round, label)).toBe(true);
    expect(follows(label, status)).toBe(true);
    // The first child of the strip, not tucked in beside the label.
    expect(byId('status-strip').firstElementChild).toBe(round);
    expect(screen.getAllByTestId('stage-line')).toHaveLength(1);
  });

  it('shows what the engine gives it, and goes with it (null: absent, the label stays)', async () => {
    const view = await withStage(null);
    expect(stage()).toBeNull();
    expect(within(byId('status-strip')).getByTestId('match-label')).toBeTruthy();
    act(() => view.engine.setPairing({ stageLabel: 'SF' }));
    expect(stage()?.textContent).toBe('SF');
    expect(within(byId('status-strip')).getByTestId('match-label')).toBeTruthy();
    act(() => view.engine.setPairing({ stageLabel: null }));
    expect(stage()).toBeNull();
    expect(within(byId('status-strip')).getByTestId('match-label')).toBeTruthy();
  });

  it('holds the contract’s 40 characters again: 41 is never shown, never cut', async () => {
    const view = await withStage('x'.repeat(40));
    expect(stage()?.textContent).toBe('x'.repeat(40));
    act(() => view.engine.setPairing({ stageLabel: 'x'.repeat(41) }));
    expect(stage()).toBeNull();
  });

  it('yields to a label of three lines (57 dp) and is back when the label is two (44 dp)', async () => {
    await withStage('QF', { label: 57 });
    expect(stage()).toBeNull();
    layOut(byId('match-label'), { width: 300, height: 44 });
    expect(stage()?.textContent).toBe('QF');
  });

  // The camera half is what the controls half leaves: the window less the controls half's width (owner, 2026-10-08),
  // read here from what the controls half RENDERED, so the halves the test lays out are the producer's. The picture
  // is sized from this match's label (owner, 2026-10-08, option A): the half lays out, the label lays out at its
  // height, the box takes its size from both, and the strip is the rest. So the chain below is the producer's, not a
  // typed strip.
  const cameraHalf = (width: number) =>
    width - parseFloat(getComputedStyle(byId('controls-half')).width);

  /**
   * One window, one label height, a caption up or not: the strip the box leaves and whether the round line shows.
   * A caption up is the viewfinder as it opens (the fake phone is uncharged, so Not charging is on top); no caption is
   * on air with the phone charging. Each is checked to be what it says (anti-vacuity: a "no caption" run that had one
   * proves nothing).
   */
  async function roundLineIn(width: number, height: number, label: number, captionUp: boolean) {
    const view = await withStage('QF', { strip: 0, label: 0 });
    if (!captionUp) {
      act(() => {
        view.engine.scene('live');
        view.engine.patch({ charging: true });
      });
    }
    layOut(byId('camera-half'), { width: cameraHalf(width), height });
    layOut(byId('match-label'), { width: cameraHalf(width) - 32, height: label });
    const strip = height - parseFloat(getComputedStyle(byId('camera-box')).height);
    layOut(byId('status-strip'), { width: cameraHalf(width), height: strip });
    const captions = ADVISORIES.filter(([, text]) => screen.queryByText(text) !== null);
    expect(captions.length === 1, `${width} × ${height}: ${captions.length} captions up`).toBe(
      captionUp,
    );
    const shown = stage() !== null;
    view.unmount();
    return { shown, strip };
  }

  it('at 640 × 360 the half limits the picture for a label up to 70 dp, so a caption and a two-line label (44) leave room for the round line, and three long lines (57) do not', async () => {
    expect(await roundLineIn(640, 360, 44, true), 'two lines, a caption up').toEqual({
      shown: true,
      strip: expect.closeTo(174.375, 6),
    });
    expect(await roundLineIn(640, 360, 57, true), 'three long lines, a caption up').toEqual({
      shown: false,
      strip: expect.closeTo(174.375, 6),
    });
    // Four long lines are the worst case the reserve is made for: the strip is the 180 it always was.
    expect(await roundLineIn(640, 360, 76, true), 'four long lines').toEqual({
      shown: false,
      strip: expect.closeTo(180, 6),
    });
  });

  // Each of the five real windows, with a label of two lines and a long one. Written by hand, never from stageFits:
  // height-limited (every window but 640 × 360), the strip is the label's reserve, 104 + the label; the round line
  // needs 88 + the label with no caption (it fits with 16 to spare) and 126 + the label with one (22 over).
  it('yields at each of the five real screens, with a caption up and not, in the half the layout gives the camera', async () => {
    // [width, height, label, strip, shows with no caption, shows with a caption]
    const ROWS = [
      [640, 360, 44, 174.375, true, true],
      [640, 360, 57, 174.375, true, false],
      [640, 360, 76, 180, true, false],
      [800, 360, 44, 148, true, false],
      [800, 360, 76, 180, true, false],
      [804, 360, 44, 148, true, false],
      [804, 360, 57, 161, true, false],
      [844, 390, 44, 148, true, false],
      [915, 412, 22, 126, true, false],
      [915, 412, 44, 148, true, false],
      [915, 412, 76, 180, true, false],
    ] as const;
    let checked = 0;
    for (const [width, height, label, strip, none, up] of ROWS) {
      const bare = await roundLineIn(width, height, label, false);
      expect(bare.strip, `${width} × ${height}, label ${label}`).toBeCloseTo(strip, 6);
      expect(bare.shown, `${width} × ${height}, label ${label}, no caption`).toBe(none);
      const captioned = await roundLineIn(width, height, label, true);
      expect(captioned.strip, `${width} × ${height}, label ${label}, strip`).toBeCloseTo(strip, 6);
      expect(captioned.shown, `${width} × ${height}, label ${label}, a caption`).toBe(up);
      checked += 2;
    }
    expect(checked).toBe(ROWS.length * 2);
    expect(ROWS.filter((row) => row[4] && !row[5]).length).toBeGreaterThan(0);
  });
});

describe('the controls half (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is the ground colour, a column of equal growth with the gap between its rows flexible', async () => {
    await renderViewfinder();
    expect(getComputedStyle(byId('controls-half')).backgroundColor).toBe(paintOf(TOKEN.ground));
    // The gap is the one thing that grows, so the icons and the hold button sit at the bottom.
    expect(getComputedStyle(byId('controls-gap')).flexGrow).toBe('1');
  });

  it('before air: the plate and the meter in one row, the chips, a flexible gap, the icon row, then the hold button', async () => {
    await renderViewfinder();
    const rows = [...byId('controls-half').children];
    expect(rows).toHaveLength(5);
    const [plateRow, chips, gap, icons, hold] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(plateRow).toBe(byId('plate-row'));
    expect(getComputedStyle(plateRow).flexDirection).toBe('row');
    // Each takes half the row, so the meter, which has no width of its own, has one.
    expect([...plateRow.children].map((cell) => getComputedStyle(cell).flexGrow)).toEqual([
      '1',
      '1',
    ]);
    expect(within(plateRow).getByTestId('tally-plate')).toBeTruthy();
    const meter = within(plateRow).getByRole('progressbar');
    expect(follows(within(plateRow).getByTestId('tally-plate'), meter)).toBe(true);
    // Before air the timer is not there: it is the meter that sits beside the plate.
    expect(within(plateRow).queryByLabelText(/^On air for/)).toBeNull();
    expect(chips.contains(byId('chip-row'))).toBe(true);
    expect(gap).toBe(byId('controls-gap'));
    expect(icons).toBe(byId('icon-row'));
    expect(hold.contains(goLive())).toBe(true);
    // One meter on the screen: before air it is beside the plate, not also under it.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('puts the AUTO start line after the chips when AUTO is on and a start is scheduled (D14)', async () => {
    const view = await renderViewfinder();
    const chipRow = byId('chip-row');
    expect(within(chipRow).getByText(en['stream.chip.auto'])).toBeTruthy();
    expect(screen.queryByText(/^Starts/)).toBeNull();
    act(() => view.engine.setPairing({ scheduledStart: new Date('2026-10-03T13:30:00Z') }));
    // Europe/London in October is BST: 13:30Z reads 14:30.
    const start = screen.getByText('Starts 14:30');
    expect(follows(chipRow, start)).toBe(true);
    // The line sits in the chips' block, between the chips and the flexible gap.
    expect(byId('controls-half').children[1]?.contains(start)).toBe(true);
    expect(follows(start, byId('controls-gap'))).toBe(true);
    expect(chipRow.contains(start)).toBe(false);
  });

  it('on air: the plate with the timer in one row, the meter, a flexible gap, the icon row, then the hold button', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    const rows = [...byId('controls-half').children];
    expect(rows).toHaveLength(5);
    const [plateRow, meter, gap, icons, hold] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(plateRow).toBe(byId('plate-row'));
    expect(getComputedStyle(plateRow).flexDirection).toBe('row');
    expect([...plateRow.children]).toHaveLength(2);
    const timer = within(plateRow).getByLabelText(/^On air for \d:\d\d:\d\d$/);
    expect(follows(within(plateRow).getByTestId('tally-plate'), timer)).toBe(true);
    expect(meter.getAttribute('role')).toBe('progressbar');
    expect(gap).toBe(byId('controls-gap'));
    expect(icons).toBe(byId('icon-row'));
    expect(hold.contains(stopLive())).toBe(true);
    // No chips on air, and one meter, under the plate row.
    expect(screen.queryByTestId('chip-row')).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('keeps the icon row: Settings, Home, then Take photo, then Remote scoring before air, 48 dp square, and no Diagnostics (spec §3, §8, §10)', async () => {
    await renderViewfinder();
    expect(getComputedStyle(byId('icon-row')).flexDirection).toBe('row');
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.home'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
    ]);
    // M-2: the row does not wrap, so it cannot grow a second line the fit arithmetic never counted.
    expect(getComputedStyle(byId('icon-row')).flexWrap).not.toBe('wrap');
    for (const name of [
      en['stream.link.settings'],
      en['stream.home'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
    ]) {
      const style = getComputedStyle(within(byId('icon-row')).getByRole('button', { name }));
      expect([style.width, style.height]).toEqual([
        `${layout.iconButton}px`,
        `${layout.iconButton}px`,
      ]);
    }
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
  });

  it('on air: Take photo and Remote scoring, then What viewers see, sit in the icon row after Settings, Home is not offered, and no Diagnostics', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
      en['stream.peek.label'],
    ]);
    // The peek keeps its text and takes the row's remaining width (spec §3: "text, as today").
    expect(peek().textContent).toBe(en['stream.peek.label']);
    expect(getComputedStyle(peek().closest('[data-testid="peek-cell"]') as Element).flexGrow).toBe(
      '1',
    );
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
    expect(screen.queryByRole('button', { name: en['stream.home'] })).toBeNull();
  });

  it('follows the broadcast through the icon row: Settings, Home, Take photo and Remote scoring, then Settings, Take photo, Remote scoring and the peek, then Settings and Home again when it ends', async () => {
    const view = await renderViewfinder();
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.home'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
    ]);
    act(() => view.engine.scene('live'));
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
      en['stream.peek.label'],
    ]);
    act(() => view.engine.scene('stopped'));
    // Ended: not on air, so leaving is allowed again and Home is back; the peek goes with the broadcast.
    // Ended: the camera picture is gone, so the shutter goes with it, and the pairing is gone, so Remote scoring does
    // (the absence witness: a stopped broadcast leaves no pairing to score for).
    expect(buttonNames(byId('icon-row'))).toEqual([en['stream.link.settings'], en['stream.home']]);
  });

  it('is 72 dp tall at the hold button, Go live and Stop alike (spec §1)', async () => {
    const view = await renderViewfinder();
    expect(getComputedStyle(goLive()).minHeight).toBe('72px');
    expect(layout.holdHeight).toBe(72);
    act(() => view.engine.scene('live'));
    expect(getComputedStyle(stopLive()).minHeight).toBe('72px');
  });

  // Spec §5: an Ended is one frame before the viewfinder leaves for Home with the card (the leave is a later
  // microtask, so a synchronous read still sees it). The frame keeps both halves and offers nothing to press.
  it('Ended keeps both halves for its one frame, and the hold button goes with nothing in its place', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    expect(stopLive()).toBeTruthy();
    act(() => view.engine.scene('stopped'));
    expect([...byId('viewfinder').children]).toHaveLength(2);
    const rows = [...byId('controls-half').children];
    expect(rows[0]).toBe(byId('plate-row'));
    expect(rows.at(-1)).toBe(byId('icon-row'));
    expect(screen.queryByRole('button', { name: /Press and hold|Hold to stop/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Scan another/ })).toBeNull();
  });
});

describe('organiser-stopped stays on the viewfinder (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders both halves, the box, the strip with its line, and Go live again', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('paired-after-organiser-stop'));
    expect(
      [...byId('viewfinder').children].map((half) => half.getAttribute('data-testid')),
    ).toEqual(['camera-half', 'controls-half']);
    expect(within(byId('camera-box')).getByTestId('preview')).toBeTruthy();
    expect(
      within(byId('status-strip')).getByText(en['stream.status.stoppedOrganiser']),
    ).toBeTruthy();
    expect(within(byId('controls-half')).getByTestId('tally-plate').textContent).toBe('Ready');
    expect(byId('controls-half').contains(goLive())).toBe(true);
  });
});

describe('the halves are one screen through a sequence (spec §1, §4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const line = () => within(byId('status-strip'));

  it('follows paired, live, a call starting and the call ending, and never remounts the camera box', async () => {
    const view = await renderViewfinder();
    const box = byId('camera-box');
    const half = byId('camera-half');
    const controls = byId('controls-half');
    const preview = within(box).getByTestId('preview');
    expect(line().getByText(WAITING)).toBeTruthy();

    act(() => view.engine.scene('live'));
    expect(line().getByText(en['stream.status.live'])).toBeTruthy();
    expect(line().queryByText(WAITING)).toBeNull();
    expect(byId('camera-box')).toBe(box);

    // A call takes the mic (scene mic-silenced): the line says so, on the same halves.
    act(() => view.engine.scene('mic-silenced'));
    expect(line().getByText(en['stream.status.micSilenced'])).toBeTruthy();
    expect(line().queryByText(en['stream.status.live'])).toBeNull();
    expect(byId('camera-box')).toBe(box);

    // The call ends: the live line is back, and nothing was torn down on the way.
    act(() => view.engine.scene('live'));
    expect(line().getByText(en['stream.status.live'])).toBeTruthy();
    expect(line().queryByText(en['stream.status.micSilenced'])).toBeNull();
    expect(byId('camera-box')).toBe(box);
    expect(byId('camera-half')).toBe(half);
    expect(byId('controls-half')).toBe(controls);
    // The preview inside the box is the same element too: a status change does not reopen the camera.
    expect(within(byId('camera-box')).getByTestId('preview')).toBe(preview);
  });
});

/**
 * Fix round 1, I-1 (owner ruling): the strip keeps its content height and the camera box gives way.
 * The half reports its size (`onLayout`); the box is min(half width × 9/16, height - the strip's reserve), centred in
 * the half, on the half's surface colour. jsdom lays nothing out, so `layOut` delivers the size the
 * phone would, and the box is read from the style it was given.
 *
 * This describe is the INITIAL WORST CASE: no match label has been laid out, so the box is sized against the strip's
 * worst case, 180, as it was before the owner's ruling of 2026-10-08 (option A) sized it from the label (the describe
 * after this one). Nothing here lays the label out, which is what makes these the unmeasured numbers.
 */
describe('the camera box gives way to the strip, before the label is measured (spec §1, fix round 1 I-1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // [width, height, camera half, box width, box height] in dp, worked by hand from spec §1 as amended (the controls
  // half is 310, so the camera half is the window less 310) and the strip's 180 dp reserve (Q4 option A). Every box
  // here is what the strip leaves: height - 180 tall and 16:9. The camera half would hold a box 9/16 as tall as it is
  // wide (186 at 640, 277 at 804, 340 at 915), which is more than the strip leaves on every one of these screens.
  const SCREENS = [
    [640, 360, 330, 320, 180],
    [800, 360, 490, 320, 180],
    [804, 360, 494, 320, 180],
    [844, 390, 534, 373.3333333, 210],
    [915, 412, 605, 412.4444444, 232],
  ] as const;
  let screensChecked = 0;

  const boxSize = () => {
    const style = getComputedStyle(byId('camera-box'));
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  };

  it('listens: the half takes a layout, and an element that listens to none refuses one', async () => {
    await renderViewfinder();
    expect(() => layOut(byId('camera-half'), { width: 320, height: 360 })).not.toThrow();
    // The probe of test/layOut.ts's reach into react-native-web: a View with no onLayout has no handler.
    expect(() => layOut(byId('camera-box'), { width: 320, height: 180 })).toThrow(/no onLayout/);
  });

  it.each(SCREENS)(
    '%i × %i: the camera half is %d, the box is %d × %d and the strip is not squeezed',
    async (width, height, half, boxWidth, boxHeight) => {
      await renderViewfinder();
      // The half the layout gives the camera is the window less what the controls half rendered.
      const given = width - parseFloat(getComputedStyle(byId('controls-half')).width);
      expect(given).toBe(half);
      layOut(byId('camera-half'), { width: given, height });
      const size = boxSize();
      expect(size.width).toBeCloseTo(boxWidth, 2);
      expect(size.height).toBeCloseTo(boxHeight, 2);
      // 16:9, and the box plus the strip's 180 fits the screen.
      expect(size.width / size.height).toBeCloseTo(16 / 9, 3);
      expect(size.height + 180).toBeLessThanOrEqual(height + 1e-6);
      expect(size.width).toBeLessThanOrEqual(given + 1e-6);
      screensChecked += 1;
    },
  );

  it('measured five screens (anti-vacuity)', () => {
    expect(SCREENS).toHaveLength(5);
    expect(screensChecked).toBe(SCREENS.length);
  });

  // The rule's consequence, written from the declarations: the camera half is wider than half the screen wherever the
  // screen is wider than twice the controls half, and the box is the lesser of what that half and the strip's 180 leave
  // it. At 640 the half (330) is 10 dp wider than half the screen (320) and holds a box 186 tall; the strip leaves 180,
  // so the box is 320 × 180. From 630 wide up it is the strip that limits the box: 320 × 180 on a 360 dp screen
  // however wide the half is (804 × 360: a 494 dp half, a box of 320).
  it('the camera half is wider than half the screen, and the box is the lesser of what the half and the strip leave', async () => {
    await renderViewfinder();
    const CONTROLS = parseFloat(getComputedStyle(byId('controls-half')).width);
    const RESERVE = 180; // Q4 option A: 2 × 8 + 76 + 44 + 32 + 2 × 6, the strip at its worst
    let wider = 0;
    for (const [width, height] of SCREENS) {
      layOut(byId('camera-half'), { width: width - CONTROLS, height });
      const size = boxSize();
      expect(size.height, `${width} × ${height}`).toBeCloseTo(
        Math.min((width - CONTROLS) / layout.previewAspect, height - RESERVE),
        6,
      );
      // Wider than half the screen wherever the screen is wider than twice the controls half.
      if (width > 2 * CONTROLS) {
        expect(width - CONTROLS, `${width} × ${height}`).toBeGreaterThan(width / 2);
        wider += 1;
      }
    }
    expect(wider).toBe(5);
  });

  it('centres the box in its half, on the half’s surface colour', async () => {
    await renderViewfinder();
    layOut(byId('camera-half'), { width: 400, height: 360 });
    expect(getComputedStyle(byId('camera-box')).alignSelf).toBe('center');
    expect(getComputedStyle(byId('camera-half')).backgroundColor).toBe(paintOf(TOKEN.surface));
  });

  it('keeps the overlay and What viewers see inside the narrower box', async () => {
    const view = await renderViewfinder();
    layOut(byId('camera-half'), { width: 400, height: 360 });
    const box = byId('camera-box');
    expect(box.contains(byId('overlay'))).toBe(true);
    act(() => view.engine.scene('live'));
    pressIn(peek());
    expect(box.contains(byId('viewer-video'))).toBe(true);
    expect(box.contains(byId('overlay'))).toBe(true);
    expect(boxSize().width).toBeCloseTo(320, 2);
  });

  it('follows the screen and never remounts: 800 × 360, then 640 × 360, then 844 × 390', async () => {
    await renderViewfinder();
    const box = byId('camera-box');
    const preview = within(box).getByTestId('preview');
    layOut(byId('camera-half'), { width: 400, height: 360 });
    expect(boxSize().width).toBeCloseTo(320, 2);
    layOut(byId('camera-half'), { width: 320, height: 360 });
    expect(boxSize()).toEqual({ width: 320, height: 180 });
    layOut(byId('camera-half'), { width: 422, height: 390 });
    expect(boxSize().height).toBeCloseTo(210, 2);
    expect(byId('camera-box')).toBe(box);
    expect(within(byId('camera-box')).getByTestId('preview')).toBe(preview);
  });

  it('keeps the unmeasured box for a layout of nothing', async () => {
    await renderViewfinder();
    layOut(byId('camera-half'), { width: 0, height: 0 });
    const style = getComputedStyle(byId('camera-box'));
    expect(style.width).toBe('100%');
  });
});

/**
 * Owner, 2026-10-08, option A: the picture is sized from what THIS match's label needs (its measured height, as laid
 * out in the half's width), plus fixed room for the status line, the caption and the padding and gaps. It is one size for
 * the whole match: it changes when the label's text or the half's width does and for nothing else, and until the label
 * has been measured it is the worst case. jsdom lays nothing out, so `layOut` delivers what the phone would: the half's
 * size, then the label's height. The expected numbers are written out by hand from the token and type declarations
 * (the strip's fixed terms are 16 + 44 + 32 + 12 = 104, and a label of 22, 44 or 76), never read from the component.
 */
describe('the picture is sized from this match’s label (owner, 2026-10-08, option A)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const MATCH = 'Ana Ruiz v Bea Lima';
  const LONG_DOUBLES =
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos';
  const half = (width: number) => width - parseFloat(getComputedStyle(byId('controls-half')).width);
  const boxSize = () => {
    const style = getComputedStyle(byId('camera-box'));
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  };
  /** A viewfinder for this match, the half laid out for the window, and the label too when it has a height. */
  async function open(width: number, height: number, label: number | null, text = MATCH) {
    const view = await renderViewfinder(
      {},
      { prepare: (fakes) => fakes.engine.setPairing({ label: text, stageLabel: 'QF' }) },
    );
    layOut(byId('camera-half'), { width: half(width), height });
    if (label !== null)
      layOut(byId('match-label'), { width: half(width) - 2 * layout.stripPadH, height: label });
    return view;
  }

  // The initial worst case: the half has laid out and the label has not. The strip is never short: the box leaves it
  // the 180 it always reserved, whatever the match.
  it.each([
    [640, 360, 320, 180],
    [804, 360, 320, 180],
    [915, 412, 412.4444444, 232],
  ] as const)(
    'before the label is measured the strip has its worst case, 180: %i × %i is %d × %d',
    async (width, height, boxWidth, boxHeight) => {
      await open(width, height, null);
      expect(boxSize().width).toBeCloseTo(boxWidth, 2);
      expect(boxSize().height).toBeCloseTo(boxHeight, 2);
      expect(height - boxSize().height).toBeCloseTo(180, 6);
    },
  );

  // [window, height, label lines, label height, box width, box height]: by hand, from the strip's reserve of 104 + the
  // label (126, 148, 180) and a camera half of the window less 310. The same table as cameraBox.test.ts, but rendered:
  // the half lays out, then the label does, and the box that results is read from what the component painted.
  const TABLE = [
    [640, 360, '1 line', 22, 330, 185.625],
    [640, 360, '2 lines', 44, 330, 185.625],
    [640, 360, '4 long lines', 76, 320, 180],
    [804, 360, '1 line', 22, 416, 234],
    [804, 360, '2 lines', 44, 376.8888889, 212],
    [804, 360, '4 long lines', 76, 320, 180],
    [915, 412, '1 line', 22, 508.4444444, 286],
    [915, 412, '2 lines', 44, 469.3333333, 264],
    [915, 412, '4 long lines', 76, 412.4444444, 232],
  ] as const;
  let tabled = 0;

  it.each(TABLE)(
    '%i × %i, a label of %s (%d dp): the box is %d × %d',
    async (width, height, _lines, label, boxWidth, boxHeight) => {
      await open(width, height, label);
      const size = boxSize();
      expect(size.width).toBeCloseTo(boxWidth, 2);
      expect(size.height).toBeCloseTo(boxHeight, 2);
      expect(size.width / size.height).toBeCloseTo(16 / 9, 3);
      // Derived from the declarations: the lesser of what the half holds and what the window leaves the strip.
      expect(size.height).toBeCloseTo(
        Math.min(((width - layout.controlsHalf) * 9) / 16, height - (104 + label)),
        6,
      );
      expect(size.width).toBeLessThanOrEqual(half(width) + 1e-6);
      tabled += 1;
    },
  );

  it('rendered nine shapes, and a longer label is never a larger box (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(9);
    expect(tabled).toBe(9);
    for (let window = 0; window < 3; window += 1) {
      const [one, two, four] = TABLE.slice(window * 3, window * 3 + 3);
      expect(one?.[5]).toBeGreaterThanOrEqual(two?.[5] ?? Infinity);
      expect(two?.[5]).toBeGreaterThanOrEqual(four?.[5] ?? Infinity);
    }
  });

  // The sequence, on the owner's phone (804 × 360), the match as the operator lives it. The box is read after every
  // step and must be the same size to the pixel until the label's text changes: a status line that changes (paired,
  // live, holding), a caption that comes up and goes, the round line that comes and goes. Then a new match with a
  // longer label is a smaller box, with the worst case in between (the new label has not been laid out), and a
  // shorter one is a larger box again, the first one's, exactly.
  it('keeps the same picture for the whole match, and changes it only with the label (804 × 360)', async () => {
    const view = await open(804, 360, 44);
    const first = boxSize();
    expect(first.width).toBeCloseTo(376.8888889, 2);
    expect(first.height).toBeCloseTo(212, 6);
    const stripOf = () => 804 > 0 && 360 - boxSize().height;
    layOut(byId('status-strip'), { width: half(804), height: 148 });
    const sameBox = (when: string) => expect(boxSize(), when).toEqual(first);
    const roundLine = () => within(byId('status-strip')).queryByTestId('stage-line');

    // The status line changes: going live, a call holding the link, back, waiting for Go live after an organiser stop.
    const status = byId('status-strip').textContent;
    act(() => view.engine.scene('live'));
    expect(byId('status-strip').textContent).not.toBe(status);
    sameBox('after going live');
    act(() => view.engine.patch({ charging: true }));
    sameBox('after the phone is charging');
    const live = byId('status-strip').textContent;
    act(() => view.engine.scene('holding'));
    expect(byId('status-strip').textContent).not.toBe(live);
    sameBox('after the link is held');
    act(() => view.engine.scene('live'));
    act(() => view.engine.patch({ charging: true }));
    sameBox('after it is back');

    // No caption now, so the round line has the room: 132 of the 148 the strip is.
    expect(roundLine()?.textContent).toBe('QF');
    sameBox('with the round line up');

    // A caption comes up: the round line goes (170 > 148), the picture does not move.
    act(() => view.engine.patch({ charging: false }));
    expect(within(byId('status-strip')).getByText(en['stream.advisory.notCharging'])).toBeTruthy();
    expect(roundLine()).toBeNull();
    sameBox('with a caption up');
    act(() => view.engine.setSurvivesBackground(false));
    sameBox('with another caption on top');
    act(() => view.engine.patch({ charging: true }));
    act(() => view.engine.setSurvivesBackground(true));
    sameBox('with the captions gone');
    expect(roundLine()?.textContent).toBe('QF');

    // The round line itself comes and goes with the stage label: the picture does not move.
    act(() => view.engine.setPairing({ stageLabel: null }));
    expect(roundLine()).toBeNull();
    sameBox('with no round line');
    act(() => view.engine.setPairing({ stageLabel: 'SF' }));
    expect(roundLine()?.textContent).toBe('SF');
    sameBox('with another round line');
    expect(stripOf()).toBeCloseTo(148, 6);

    // The match ends (the organiser stops it) and the next is paired: the label now comes from the pairing, before air.
    act(() => view.engine.scene('paired-after-organiser-stop'));
    sameBox('after the organiser stopped the match');

    // A new match, with a longer label: the label changes text, so the picture is sized again. Not laid out yet it is
    // the worst case (320 × 180, never short), and laid out at four long lines it is that reserve: smaller than the first.
    act(() => view.engine.setPairing({ label: LONG_DOUBLES }));
    expect(boxSize().height).toBeCloseTo(180, 6);
    layOut(byId('match-label'), { width: half(804) - 2 * layout.stripPadH, height: 76 });
    expect(boxSize().width).toBeCloseTo(320, 6);
    expect(boxSize().height).toBeCloseTo(180, 6);
    expect(boxSize().height).toBeLessThan(first.height);

    // And a shorter one is the first picture again, to the pixel: it depends on the label and the half and nothing else.
    act(() => view.engine.setPairing({ label: MATCH }));
    layOut(byId('match-label'), { width: half(804) - 2 * layout.stripPadH, height: 44 });
    sameBox('with the first label again');
  });

  // The half's width is the label's wrapping width, so a new width is a new measurement (the label lays out again in
  // it) and a new box: here a rotation of the half and the same label measured again.
  it('is sized again when the half’s width changes, and the label lays out in the new width', async () => {
    await open(804, 360, 44);
    expect(boxSize().height).toBeCloseTo(212, 6);
    layOut(byId('camera-half'), { width: half(915), height: 412 });
    layOut(byId('match-label'), { width: half(915) - 2 * layout.stripPadH, height: 22 });
    expect(boxSize().height).toBeCloseTo(286, 6);
    expect(boxSize().width).toBeCloseTo(508.4444444, 2);
  });

  // The strip's room for the round line, on the owner's phone: the reserve is 148 with a two-line label, and the round
  // line fits it (132) while no caption is up and does not (170) while one is. The picture is the same either way. Each
  // of the five captions in turn, each on a viewfinder of its own (a failed overlay stays failed).
  let captionsTried = 0;
  it.each(ADVISORIES)(
    'shows the round line at 804 × 360 with no caption and hides it while the %s caption is up, the picture still',
    async (_name, text, bringUp) => {
      const view = await open(804, 360, 44);
      // The calm baseline: on air, the phone charging, no caption of any kind.
      act(() => {
        view.engine.scene('live');
        view.engine.patch({ charging: true });
      });
      const calm = boxSize();
      layOut(byId('status-strip'), { width: half(804), height: 360 - calm.height });
      expect(360 - calm.height).toBeCloseTo(148, 6);
      const roundLine = () => within(byId('status-strip')).queryByTestId('stage-line');
      expect(ADVISORIES.filter(([, other]) => screen.queryByText(other) !== null)).toHaveLength(0);
      expect(roundLine()?.textContent).toBe('QF');
      // The score-ahead note is before air only, so its own state is the paired one; the rest are on air.
      if (text === SCORE_AHEAD) {
        act(() => {
          view.engine.scene('paired-ready');
          view.engine.patch({ charging: true });
        });
      } else if (text === en['stream.advisory.notCharging']) {
        // The fake phone starts uncharged, so Not charging is the one that needs the phone unplugged again.
        act(() => view.engine.patch({ charging: false }));
      } else {
        act(() => bringUp(view));
      }
      expect(screen.queryByText(text) !== null, `${text} is up`).toBe(true);
      expect(roundLine()).toBeNull();
      expect(boxSize()).toEqual(calm);
      captionsTried += 1;
    },
  );

  it('tried all five captions (anti-vacuity)', () => {
    expect(ADVISORIES).toHaveLength(5);
    expect(captionsTried).toBe(5);
  });
});

/**
 * Fix round 1, I-2: the fit arithmetic reads tokens; these bind the rendered components to the same
 * numbers, as literals from the brief (Board "Before"), so a changed padding or gap reds here.
 */
describe('the strip and the controls half are padded and spaced as the fit reserves (fix round 1 I-2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the status strip: 8 above and below, 16 either side, 6 between its rows', async () => {
    await renderViewfinder();
    const style = getComputedStyle(byId('status-strip'));
    expect([style.paddingTop, style.paddingBottom, style.paddingLeft, style.paddingRight]).toEqual([
      '8px',
      '8px',
      '16px',
      '16px',
    ]);
    expect(style.gap).toBe('6px');
  });

  it('the controls half: 16 all round, 12 between its rows', async () => {
    await renderViewfinder();
    const style = getComputedStyle(byId('controls-half'));
    expect([style.paddingTop, style.paddingBottom, style.paddingLeft, style.paddingRight]).toEqual([
      '16px',
      '16px',
      '16px',
      '16px',
    ]);
    expect(style.gap).toBe('12px');
  });
});

/**
 * Fix round 1, I-2: the strip reserves at most 4 lines for the label (Q4 option A, `labelLinesMax`).
 * Every label the family holds is rendered in the strip and its lines counted: what each line may take
 * (`numberOfLines`) summed, bounded at 4; and a regular label is one line a side, 2 in all (F9).
 */
describe('the match label stays inside its reserved lines (fix round 1 I-2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const seen = { all: 0, regular: 0, long: 0 };

  it.each(CASES)('%s: at most 4 lines in all', async (_name, label, _shape, size) => {
    await renderViewfinder({}, { prepare: (fakes) => fakes.engine.setPairing({ label }) });
    const root = within(byId('status-strip')).getByTestId('match-label');
    const lines = [...root.querySelectorAll('[data-testid="match-label-line"]')];
    const allowed = lines.reduce((sum, line) => sum + linesAllowed(line), 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(4);
    expect(root.dataset.size).toBe(size);
    if (size === 'regular') {
      // F9, made a guard: one line a side, each no longer than 26 characters (code points).
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines)
        expect([...(line.textContent ?? '')].length).toBeLessThanOrEqual(26);
      seen.regular += 1;
    } else {
      // At the long size a line is 19 dp, and 4 of them are the 76 the strip reserves.
      expect(
        allowed * parseFloat(getComputedStyle(lines[0] as Element).lineHeight),
      ).toBeLessThanOrEqual(76);
      seen.long += 1;
    }
    seen.all += 1;
  });

  it('swept all twelve labels, both sizes (anti-vacuity)', () => {
    expect(CASES).toHaveLength(12);
    expect(seen.all).toBe(CASES.length);
    expect(seen.regular).toBeGreaterThan(0);
    expect(seen.long).toBeGreaterThan(0);
    expect(seen.regular + seen.long).toBe(seen.all);
  });
});
