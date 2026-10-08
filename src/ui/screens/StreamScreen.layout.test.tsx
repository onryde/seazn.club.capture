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
 * Spec §1, canvas option A: the screen is two equal halves. The camera half is a
 * 16:9 box with the status strip under it; the controls half holds the rest. This
 * proves the structure and the order of what is drawn, read from jsdom's cascade of
 * react-native-web's classes. That it fits a phone is the fit arithmetic's
 * (`viewfinderFit.test.ts`) and the phone's (Task 9).
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

describe('the viewfinder is two halves (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a root of exactly two halves, the camera half and the controls half, each growing equally', async () => {
    await renderViewfinder();
    const root = byId('viewfinder');
    expect([...root.children].map((half) => half.getAttribute('data-testid'))).toEqual([
      'camera-half',
      'controls-half',
    ]);
    // Spec §1: two equal halves. Equal flex-grow from a zero basis is what makes them equal.
    for (const half of [byId('camera-half'), byId('controls-half')]) {
      const style = getComputedStyle(half);
      expect(style.flexGrow).toBe('1');
      expect(style.flexBasis).toBe('0%');
    }
  });

  it('puts the controls on the right, mirrors the halves for Left, and back for Right (controlsSide)', async () => {
    const view = await renderViewfinder();
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row');
    await act(() => view.ports.streamSettings.set({ side: 'left' }));
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row-reverse');
    // Mirrored, the halves are still the same two, in the same DOM order.
    expect(
      [...byId('viewfinder').children].map((half) => half.getAttribute('data-testid')),
    ).toEqual(['camera-half', 'controls-half']);
    await act(() => view.ports.streamSettings.set({ side: 'right' }));
    expect(getComputedStyle(byId('viewfinder')).flexDirection).toBe('row');
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

  it('keeps the icon row: Settings, Home, then Take photo before air, 48 dp square, and no Diagnostics (spec §3, §8)', async () => {
    await renderViewfinder();
    expect(getComputedStyle(byId('icon-row')).flexDirection).toBe('row');
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.home'],
      en['stream.photo.label'],
    ]);
    // M-2: the row does not wrap, so it cannot grow a second line the fit arithmetic never counted.
    expect(getComputedStyle(byId('icon-row')).flexWrap).not.toBe('wrap');
    for (const name of [en['stream.link.settings'], en['stream.home'], en['stream.photo.label']]) {
      const style = getComputedStyle(within(byId('icon-row')).getByRole('button', { name }));
      expect([style.width, style.height]).toEqual([
        `${layout.iconButton}px`,
        `${layout.iconButton}px`,
      ]);
    }
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
  });

  it('on air: Take photo, then What viewers see, sit in the icon row after Settings, Home is not offered, and no Diagnostics', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.photo.label'],
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

  it('follows the broadcast through the icon row: Settings, Home and Take photo, then Settings, Take photo and the peek, then Settings and Home again when it ends', async () => {
    const view = await renderViewfinder();
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.home'],
      en['stream.photo.label'],
    ]);
    act(() => view.engine.scene('live'));
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.photo.label'],
      en['stream.peek.label'],
    ]);
    act(() => view.engine.scene('stopped'));
    // Ended: not on air, so leaving is allowed again and Home is back; the peek goes with the broadcast.
    // Ended: the camera picture is gone, so the shutter goes with it
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
 * The half reports its size (`onLayout`); the box is min(half width × 9/16, height - 180), centred in
 * the half, on the half's surface colour. jsdom lays nothing out, so `layOut` delivers the size the
 * phone would, and the box is read from the style it was given.
 */
describe('the camera box gives way to the strip (spec §1, fix round 1 I-1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // [width, height, box width, box height] in dp, worked by hand from spec §1 and the strip's 180 dp
  // reserve (Q4 option A): 640 × 360 is the whole half; the wider screens' boxes are what the strip leaves.
  const SCREENS = [
    [640, 360, 320, 180],
    [800, 360, 320, 180],
    [844, 390, 373.3333333, 210],
    [915, 412, 412.4444444, 232],
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
    '%i × %i: the box is %d × %d and the strip is not squeezed',
    async (width, height, boxWidth, boxHeight) => {
      await renderViewfinder();
      layOut(byId('camera-half'), { width: width / 2, height });
      const size = boxSize();
      expect(size.width).toBeCloseTo(boxWidth, 2);
      expect(size.height).toBeCloseTo(boxHeight, 2);
      // 16:9, and the box plus the strip's 180 fits the screen.
      expect(size.width / size.height).toBeCloseTo(16 / 9, 3);
      expect(size.height + 180).toBeLessThanOrEqual(height + 1e-6);
      expect(size.width).toBeLessThanOrEqual(width / 2 + 1e-6);
      screensChecked += 1;
    },
  );

  it('measured four screens (anti-vacuity)', () => {
    expect(SCREENS).toHaveLength(4);
    expect(screensChecked).toBe(SCREENS.length);
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
