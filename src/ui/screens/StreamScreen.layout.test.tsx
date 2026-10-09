import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEY } from '@/hooks/advisory';
import en from '@/i18n/en.json';
import { colour, layout, space } from '@/ui/theme/tokens';
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

/**
 * The caption of each advisory, and how a test brings it up alone (F17/D4: all three live in the strip; the score
 * preview's two went with it, D2 §4.1). `topAdvisory` shows one at a time, so each case starts from the state where its
 * own is on top.
 *
 * Which can be SEEN is decided by the two tiers (owner, 2026-10-08, and 2026-10-09, option B): a caption beats only a
 * routine status line, and "Waiting for Go live" is routine, so all three can reach the strip before air; on air the
 * live line is routine too, so all three can there as well.
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
  // The fake phone starts uncharged, so the default viewfinder already says it.
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

  it('draws the preview in the box and nowhere else', async () => {
    await renderViewfinder();
    const box = byId('camera-box');
    expect(within(box).getByTestId('preview')).toBeTruthy();
    expect(within(byId('status-strip')).queryByTestId('preview')).toBeNull();
    expect(within(byId('controls-half')).queryByTestId('preview')).toBeNull();
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

  // Owner, 2026-10-08, "one single line all the time": under the label the strip has ONE message line, never both. Two
  // tiers decide which: an URGENT status line (a refusal, trouble, a stopped stream, Back's "hold Stop") always wins; an
  // advisory caption beats a ROUTINE one (Live, Waiting for Go live: owner, 2026-10-09, option B). The phones that read
  // a routine line here are quiet (on the charger, surviving the background; test/quietDevice.ts), so a paired phone
  // before air has no caption up.
  it('carries the match label, then ONE message: the status line when no caption is up', async () => {
    await renderViewfinder({}, { quiet: true });
    const strip = byId('status-strip');
    const label = within(strip).getByTestId('match-label');
    const message = within(strip).getByTestId('strip-message');
    expect(follows(label, message)).toBe(true);
    // The message is the status line and nothing else: no caption beside it.
    expect(message.textContent).toBe(WAITING);
    expect(within(message).getByText(WAITING)).toBeTruthy();
    for (const [name, text] of ADVISORIES) expect(screen.queryByText(text), name).toBeNull();
    // The label is the strip's alone: the old bottom strip's single line is gone.
    expect(screen.getAllByTestId('match-label')).toHaveLength(1);
    expect(within(strip).getAllByTestId('strip-message')).toHaveLength(1);
  });

  // Owner, 2026-10-09, option B: before air a phone warning beats the destination line, which shows when no caption is
  // active. Two phones, each with its own caption up (the fake as it is, unplugged; a charger but a phone that would
  // not survive the background): the caption is the one message and the destination is not on screen. Its other half is the test above: with nothing to warn about, the destination shows.
  it.each([
    ['Not charging', en['stream.advisory.notCharging'], (_view: Viewfinder) => undefined],
    [
      'Keep the app open',
      en['stream.advisory.keepOpen'],
      (view: Viewfinder) => {
        view.engine.patch({ charging: true });
        view.engine.setSurvivesBackground(false);
      },
    ],
  ])('puts %s over the destination line before air', async (_name, caption, bringUp) => {
    const view = await renderViewfinder();
    act(() => bringUp(view));
    const message = within(byId('status-strip')).getByTestId('strip-message');
    expect(message.textContent).toBe(caption);
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(/YouTube/)).toBeNull();
  });

  it('sets the status line in the body role, ONE line, under the label (F20, owner 2026-10-08)', async () => {
    await renderViewfinder({}, { quiet: true });
    const line = within(byId('status-strip')).getByText(WAITING);
    expect(getComputedStyle(line).fontSize).toBe(`${typeScale.body.fontSize}px`);
    expect(linesAllowed(line)).toBe(layout.messageLines);
    expect(linesAllowed(line)).toBe(1);
    // A longer line is cut with an ellipsis and no second line (the owner's rule), not wrapped.
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
  });

  it.each(ADVISORIES)(
    'carries the %s advisory in the strip before air, as the ONE message: not over the shot, not in the controls',
    async (_name, text, bringUp) => {
      const view = await renderViewfinder();
      act(() => bringUp(view));
      const strip = byId('status-strip');
      const caption = within(strip).getByText(text);
      expect(byId('camera-box').contains(caption)).toBe(false);
      expect(byId('controls-half').contains(caption)).toBe(false);
      // The caption IS the strip's message: nothing else is in it, and the status line is not on screen.
      expect(within(strip).getByTestId('strip-message').textContent).toBe(text);
      expect(screen.queryByText(WAITING)).toBeNull();
      // One caption at a time (topAdvisory): the other two are not up.
      for (const [other, otherText] of ADVISORIES) {
        if (otherText !== text) expect(screen.queryByText(otherText), other).toBeNull();
      }
      // The caption is small and grey, in its own role, and ONE line.
      expect(getComputedStyle(caption).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
      expect(linesAllowed(caption)).toBe(layout.messageLines);
      advisoriesRun += 1;
    },
  );

  it.each(ADVISORIES)(
    'carries the %s advisory in the strip on air, as the ONE message: not over the shot, not in the controls',
    async (_name, text, bringUp) => {
      const view = await renderViewfinder();
      act(() => view.engine.scene('live'));
      act(() => bringUp(view));
      const strip = byId('status-strip');
      const caption = within(strip).getByText(text);
      expect(byId('camera-box').contains(caption)).toBe(false);
      expect(byId('controls-half').contains(caption)).toBe(false);
      // The caption IS the strip's message: nothing else is in it, and the live line is not on screen.
      expect(within(strip).getByTestId('strip-message').textContent).toBe(text);
      expect(screen.queryByText(en['stream.status.live'])).toBeNull();
      for (const [other, otherText] of ADVISORIES) {
        if (otherText !== text) expect(screen.queryByText(otherText), other).toBeNull();
      }
      expect(getComputedStyle(caption).fontSize).toBe(`${typeScale.metricUnit.fontSize}px`);
      expect(linesAllowed(caption)).toBe(layout.messageLines);
      advisoriesRun += 1;
    },
  );

  it('ran all three advisories before air and on air: the three the engine declares', () => {
    // Anti-vacuity: the sweeps above ran once per advisory in `ADVISORY_KEY` before air and once on air, and none were
    // skipped.
    expect(ADVISORIES.map(([name]) => name).sort()).toEqual(Object.keys(ADVISORY_KEY).sort());
    expect(advisoriesRun).toBe(6);
  });

  it('draws the strip with no label and no caption before the pairing, and still says the line (empty case)', async () => {
    await renderViewfinder({}, { engine: 'idle' });
    const strip = byId('status-strip');
    expect(within(strip).queryByTestId('match-label')).toBeNull();
    for (const [name, text] of ADVISORIES) expect(within(strip).queryByText(text), name).toBeNull();
    // The one message line is there with its status line (the empty case: no caption, no label, still a message).
    expect(within(strip).getByTestId('strip-message').textContent).toBe(
      en['stream.status.starting'],
    );
    expect(byId('camera-box')).toBeTruthy();
    expect(byId('controls-half')).toBeTruthy();
    expect(byId('tally-plate').textContent).toBe('Starting');
  });
});

/**
 * Spec §2: the round line is the first line of the strip, above the match label, and it is ALWAYS shown (owner,
 * 2026-10-08, option B): its room, a line and a gap, is in the strip's reserve whether or not this match has a stage, so
 * it never asks whether it fits and never moves the picture. Real components, nothing mocked; jsdom lays nothing out,
 * so `layOut` delivers the sizes the phone would. Whether it reads well on a real phone is the device check (item 3).
 */
describe('the round line above the match label (spec §2, option B)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A viewfinder paired with this match label and stage label, the label laid out. */
  async function withStage(
    stageLabel: string | null,
    { label = 44, quiet }: { label?: number; quiet?: boolean } = {},
  ) {
    const view = await renderViewfinder(
      {},
      {
        quiet,
        prepare: (fakes) => fakes.engine.setPairing({ label: 'A v B', stageLabel }),
      },
    );
    layOut(byId('match-label'), { width: 300, height: label });
    return view;
  }
  const stage = () => within(byId('status-strip')).queryByTestId('stage-line');

  it('listens to the label, which says how tall it came out: the picture is sized from it', async () => {
    await renderViewfinder();
    expect(() => layOut(byId('match-label'), { width: 300, height: 44 })).not.toThrow();
  });

  it('is the strip’s first row: the round line, then the match label, then the one message line', async () => {
    await withStage('Open · QF', { quiet: true });
    const round = within(byId('status-strip')).getByTestId('stage-line');
    const label = within(byId('status-strip')).getByTestId('match-label');
    const status = within(byId('status-strip')).getByTestId('strip-message');
    expect(status.textContent).toBe(WAITING);
    expect(round.textContent).toBe('Open · QF');
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
    act(() => view.engine.setPairing({ stageLabel: 'Open · SF' }));
    expect(stage()?.textContent).toBe('Open · SF');
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

  // The old rule hid it for a label of three lines. Nothing hides it now: four label heights, one after another.
  it('does not yield to a label of any height (22, 44, 57, 76 dp): it is there for each', async () => {
    await withStage('Open · QF', { label: 57 });
    expect(stage()?.textContent).toBe('Open · QF');
    let checked = 0;
    for (const height of [22, 44, 57, 76]) {
      layOut(byId('match-label'), { width: 300, height });
      expect(stage()?.textContent, `label ${height}`).toBe('Open · QF');
      checked += 1;
    }
    expect(checked).toBe(4);
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
   * Both runs are on air, where the live line is routine and a caption can have it: a caption up is the fake phone as
   * it is (uncharged, Not charging), no caption is the same phone plugged in. Each is checked to be
   * what it says (anti-vacuity: a "no caption" run that had one proves nothing).
   */
  async function roundLineIn(width: number, height: number, label: number, captionUp: boolean) {
    const view = await withStage('Open · QF', { label: 0 });
    act(() => {
      view.engine.scene('live');
      if (!captionUp) view.engine.patch({ charging: true });
    });
    layOut(byId('camera-half'), { width: cameraHalf(width), height });
    layOut(byId('match-label'), { width: cameraHalf(width) - 32, height: label });
    const strip = height - parseFloat(getComputedStyle(byId('camera-box')).height);
    const captions = ADVISORIES.filter(([, text]) => screen.queryByText(text) !== null);
    expect(captions.length === 1, `${width} × ${height}: ${captions.length} captions up`).toBe(
      captionUp,
    );
    const shown = stage() !== null;
    view.unmount();
    return { shown, strip };
  }

  // Each of the real windows, with a label of one to four lines. Written by hand from the declarations, never from the
  // module under test: where the window limits the box (every one but 640 × 360, and 844 × 390 for a short label) the
  // strip is the label's reserve, 66 + the label, which is exactly what the round line, the label and the message line
  // need; where the half limits the box the strip is what the window leaves, more than it needs. The round line shows in
  // EVERY row, a caption up or not, and the strip is never short of what the round line adds.
  it('shows at each of the real screens, with a caption up and not, in a strip that holds it', async () => {
    // [width, height, label, strip the box leaves]
    const ROWS = [
      [640, 360, 44, 174.375],
      [640, 360, 57, 174.375],
      [640, 360, 76, 174.375],
      [804, 332, 22, 88],
      [804, 332, 44, 110],
      [804, 332, 76, 142],
      [804, 360, 22, 88],
      [804, 360, 44, 110],
      [804, 360, 57, 123],
      [800, 360, 22, 88],
      [800, 360, 76, 142],
      [844, 390, 22, 89.625],
      [844, 390, 44, 110],
      [915, 412, 22, 88],
      [915, 412, 44, 110],
      [915, 412, 76, 142],
    ] as const;
    let checked = 0;
    for (const [width, height, label, strip] of ROWS) {
      for (const captionUp of [false, true]) {
        const run = await roundLineIn(width, height, label, captionUp);
        const where = `${width} × ${height}, label ${label}, ${captionUp ? 'a caption' : 'no caption'}`;
        expect(run.strip, where).toBeCloseTo(strip, 2);
        expect(run.shown, where).toBe(true);
        // What the strip holds: 2 × 8 padding, the round line 16, the label, the message line 22 and two gaps of 6.
        expect(run.strip, where).toBeGreaterThanOrEqual(16 + 16 + label + 22 + 12 - 1e-9);
        checked += 1;
      }
    }
    expect(checked).toBe(ROWS.length * 2);
    // Anti-vacuity: the strip is exactly the content in the height-limited rows and more in the others.
    expect(ROWS.filter(([, , label, strip]) => Math.abs(strip - (66 + label)) < 1e-6).length).toBe(
      12,
    );
    expect(ROWS.filter(([, , label, strip]) => strip > 66 + label + 1e-6).length).toBe(4);
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
    // "Organiser stopped it" is an urgent line: it keeps the strip's one line from Not charging.
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
    // The routine lines (waiting, live) are the ones read here, so the phone is quiet; the call (mic silenced) is
    // urgent either way.
    const view = await renderViewfinder({}, { quiet: true });
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
 * worst case, 142 (the padding, the round line's room, four long label lines, two gaps and ONE message line; the round
 * line is always shown, owner 2026-10-08, option B), as it was before the owner's ruling of 2026-10-08 (option A) sized
 * it from the label (the describe after this one). Nothing here lays the label out, which is what makes these the
 * unmeasured numbers.
 */
describe('the camera box gives way to the strip, before the label is measured (spec §1, fix round 1 I-1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // [width, height, camera half, box width, box height] in dp, worked by hand from spec §1 as amended (the controls
  // half is 310, so the camera half is the window less 310) and the strip's 142 dp reserve (Q4 option A, the round line
  // and one message line). The box is the lesser of what the half holds (9/16 of its width: 185.625 at 640, 277.875 at
  // 804, 340.3125 at 915) and what the strip leaves (height - 142): the whole half at 640 (the half limits it, full
  // width), and the strip's leaving at every other screen here, 190 at the owner's phone as it really is (804 × 332).
  const SCREENS = [
    [640, 360, 330, 330, 185.625],
    [800, 360, 490, 387.5555556, 218],
    [804, 360, 494, 387.5555556, 218],
    [804, 332, 494, 337.7777778, 190],
    [844, 390, 534, 440.8888889, 248],
    [915, 412, 605, 480, 270],
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
      // 16:9, and the box plus the strip's worst case, 142, fits the screen.
      expect(size.width / size.height).toBeCloseTo(16 / 9, 3);
      expect(size.height + 142).toBeLessThanOrEqual(height + 1e-6);
      expect(size.width).toBeLessThanOrEqual(given + 1e-6);
      screensChecked += 1;
    },
  );

  it('measured five screens (anti-vacuity)', () => {
    expect(SCREENS).toHaveLength(6);
    expect(screensChecked).toBe(SCREENS.length);
  });

  // The rule's consequence, written from the declarations: the camera half is wider than half the screen wherever the
  // screen is wider than twice the controls half, and the box is the lesser of what that half and the strip's 142 leave
  // it. At 640 the half (330) is 10 dp wider than half the screen (320) and holds a box 185.625 tall; the strip leaves
  // 218, so the box is the whole half, 330 × 185.625. From 800 wide on a 360 dp screen it is the strip that limits the
  // box: 218 tall however wide the half is (804 × 360: a 494 dp half, a box of 387.6).
  it('the camera half is wider than half the screen, and the box is the lesser of what the half and the strip leave', async () => {
    await renderViewfinder();
    const CONTROLS = parseFloat(getComputedStyle(byId('controls-half')).width);
    const RESERVE = 142; // Q4 option A: 2 × 8 + 16 + 76 + 22 + 2 × 6, the strip at its worst: round line, one message line
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
    expect(wider).toBe(SCREENS.length);
  });

  it('centres the box in its half, on the half’s surface colour', async () => {
    await renderViewfinder();
    layOut(byId('camera-half'), { width: 400, height: 360 });
    expect(getComputedStyle(byId('camera-box')).alignSelf).toBe('center');
    expect(getComputedStyle(byId('camera-half')).backgroundColor).toBe(paintOf(TOKEN.surface));
  });

  it('keeps What viewers see inside the narrower box', async () => {
    const view = await renderViewfinder();
    // A half of 480: the strip's 142 leaves a box 218 tall, 387.6 wide, narrower than the half.
    layOut(byId('camera-half'), { width: 480, height: 360 });
    const box = byId('camera-box');
    act(() => view.engine.scene('live'));
    pressIn(peek());
    expect(box.contains(byId('viewer-video'))).toBe(true);
    expect(boxSize().width).toBeCloseTo(387.5555556, 2);
  });

  it('follows the screen and never remounts: a 480 half at 360, then a 320 half, then a 560 half at 390', async () => {
    await renderViewfinder();
    const box = byId('camera-box');
    const preview = within(box).getByTestId('preview');
    layOut(byId('camera-half'), { width: 480, height: 360 });
    expect(boxSize().width).toBeCloseTo(387.5555556, 2);
    layOut(byId('camera-half'), { width: 320, height: 360 });
    expect(boxSize()).toEqual({ width: 320, height: 180 });
    layOut(byId('camera-half'), { width: 560, height: 390 });
    expect(boxSize().height).toBeCloseTo(248, 2);
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
 * out in the half's width), plus fixed room for the ONE message line ("one single line all the time") and the padding
 * and gap. It is one size for the whole match: it changes when the label's text or the half's width does and for
 * nothing else, and until the label has been measured it is the worst case. jsdom lays nothing out, so `layOut` delivers
 * what the phone would: the half's size, then the label's height. The expected numbers are written out by hand from
 * the token and type declarations (the strip's fixed terms are 16 + 16 + 22 + 2 × 6 = 66, the round line's room being
 * one of them: it is always shown, option B; and a label of 22, 44 or 76), never read from the component.
 */
describe('the picture is sized from this match’s label (owner, 2026-10-08, option A)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const MATCH = 'Ana Ruiz v Bea Lima';
  const LONG_DOUBLES =
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos';
  /** The strip's fixed terms: the padding, the round line, two gaps and the ONE message line, from the declarations. */
  const FIXED =
    2 * layout.stripPadV +
    layout.stageLines * typeScale.metricUnit.lineHeight +
    2 * layout.stripGap +
    layout.messageLines * typeScale.body.lineHeight;
  const half = (width: number) => width - parseFloat(getComputedStyle(byId('controls-half')).width);
  const boxSize = () => {
    const style = getComputedStyle(byId('camera-box'));
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  };
  /** A viewfinder for this match, the half laid out for the window, and the label too when it has a height. */
  async function open(
    width: number,
    height: number,
    label: number | null,
    { text = MATCH, quiet = false }: { text?: string; quiet?: boolean } = {},
  ) {
    const view = await renderViewfinder(
      {},
      {
        quiet,
        prepare: (fakes) => fakes.engine.setPairing({ label: text, stageLabel: 'Open · QF' }),
      },
    );
    layOut(byId('camera-half'), { width: half(width), height });
    if (label !== null)
      layOut(byId('match-label'), { width: half(width) - 2 * layout.stripPadH, height: label });
    return view;
  }

  it('has fixed terms of 66 dp: 2 × 8 + 16 + 2 × 6 + 22', () => {
    expect(FIXED).toBe(66);
  });

  // The initial worst case: the half has laid out and the label has not. The strip is never short: the box leaves it
  // the 142 it always reserved, whatever the match (or, where the half limits the picture, what the half leaves).
  it.each([
    [640, 360, 330, 185.625, 174.375],
    [804, 332, 337.7777778, 190, 142],
    [804, 360, 387.5555556, 218, 142],
    [915, 412, 480, 270, 142],
  ] as const)(
    'before the label is measured the strip has its worst case, 142: %i × %i is %d × %d, a strip of %d',
    async (width, height, boxWidth, boxHeight, strip) => {
      await open(width, height, null);
      expect(boxSize().width).toBeCloseTo(boxWidth, 2);
      expect(boxSize().height).toBeCloseTo(boxHeight, 2);
      expect(height - boxSize().height).toBeCloseTo(strip, 2);
    },
  );

  // [window, height, label lines, label height, box width, box height]: by hand, from the strip's reserve of 66 + the
  // label (88, 110, 142) and a camera half of the window less 310. The same table as cameraBox.test.ts, but rendered:
  // the half lays out, then the label does, and the box that results is read from what the component painted.
  const TABLE = [
    [640, 360, '1 line', 22, 330, 185.625],
    [640, 360, '2 lines', 44, 330, 185.625],
    [640, 360, '4 long lines', 76, 330, 185.625],
    [804, 332, '1 line', 22, 433.7777778, 244],
    [804, 332, '2 lines', 44, 394.6666667, 222],
    [804, 332, '4 long lines', 76, 337.7777778, 190],
    [804, 360, '1 line', 22, 483.5555556, 272],
    [804, 360, '2 lines', 44, 444.4444444, 250],
    [804, 360, '4 long lines', 76, 387.5555556, 218],
    [915, 412, '1 line', 22, 576, 324],
    [915, 412, '2 lines', 44, 536.8888889, 302],
    [915, 412, '4 long lines', 76, 480, 270],
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
        Math.min(((width - layout.controlsHalf) * 9) / 16, height - (FIXED + label)),
        2,
      );
      expect(size.width).toBeLessThanOrEqual(half(width) + 1e-6);
      tabled += 1;
    },
  );

  it('rendered twelve shapes, and a longer label is never a larger box (anti-vacuity)', () => {
    expect(TABLE).toHaveLength(12);
    expect(tabled).toBe(12);
    for (let window = 0; window < 4; window += 1) {
      const [one, two, four] = TABLE.slice(window * 3, window * 3 + 3);
      expect(one?.[5]).toBeGreaterThanOrEqual(two?.[5] ?? Infinity);
      expect(two?.[5]).toBeGreaterThanOrEqual(four?.[5] ?? Infinity);
    }
    // And the owner's phone as it really is (804 × 332) has a different box for each label: it is the strip that limits.
    const phone = TABLE.filter((row) => row[0] === 804 && row[1] === 332).map((row) => row[5]);
    expect(new Set(phone).size).toBe(3);
  });

  // The sequence, the match as the operator lives it. The box is read after every step and must be the same size to
  // the pixel until the label's text changes: a status line that changes (paired, live, holding), a caption that comes
  // up and goes (the caption takes the message line, no room of its own), the round line that comes and goes (its room
  // is reserved either way, option B and ruling R1). Then a new match with a longer label is a smaller box where the
  // strip limits it, with the worst case in between (the new label has not been laid out), and a shorter one is the
  // first box again, exactly. Two windows: the owner's phone (804 × 332), where the picture is as tall as the window
  // allows; and 640 × 360, where the half limits the picture. The round line is up through all of it, in both.
  // [width, height, first box, the box for an unmeasured new label (the box for 76 laid out is the same)]
  const SEQUENCES = [
    [804, 332, { width: 394.6666667, height: 222 }, { width: 337.7777778, height: 190 }],
    [640, 360, { width: 330, height: 185.625 }, { width: 330, height: 185.625 }],
  ] as const;
  let sequences = 0;
  it.each(SEQUENCES)(
    'keeps the same picture for the whole match, and changes it only with the label (%i × %i)',
    async (width, height, firstBox, longBox) => {
      // The fake phone as it is, so the test drives the charger and the background itself.
      const view = await open(width, height, 44);
      const first = boxSize();
      expect(first.width).toBeCloseTo(firstBox.width, 2);
      expect(first.height).toBeCloseTo(firstBox.height, 2);
      const sameBox = (when: string) => expect(boxSize(), when).toEqual(first);
      const roundLine = () => within(byId('status-strip')).queryByTestId('stage-line');
      const message = () => byId('strip-message').textContent;
      const calm = () => {
        act(() => view.engine.patch({ charging: true }));
        act(() => view.engine.setSurvivesBackground(true));
      };
      // The round line is up all the way through (option B), with the stage label the pairing has.
      let stage = 'Open · QF';
      const roundLineIs = (when: string) => expect(roundLine()?.textContent, when).toBe(stage);

      // The status line changes: going live, a call holding the link, back.
      act(() => view.engine.scene('live'));
      calm();
      expect(message()).toBe(en['stream.status.live']);
      sameBox('after going live');
      act(() => view.engine.scene('holding'));
      calm();
      expect(message()).not.toBe(en['stream.status.live']);
      sameBox('after the link is held');
      act(() => view.engine.scene('live'));
      calm();
      expect(message()).toBe(en['stream.status.live']);
      sameBox('after it is back');
      roundLineIs('with no caption');

      // A caption comes up and takes the message line: the picture does not move, and neither does the round line.
      act(() => view.engine.patch({ charging: false }));
      expect(message()).toBe(en['stream.advisory.notCharging']);
      sameBox('with a caption up');
      roundLineIs('with a caption up');
      act(() => view.engine.setSurvivesBackground(false));
      expect(message()).toBe(en['stream.advisory.keepOpen']);
      sameBox('with another caption on top');
      roundLineIs('with another caption on top');
      calm();
      expect(message()).toBe(en['stream.status.live']);
      sameBox('with the captions gone');
      roundLineIs('with the captions gone');

      // The round line itself comes and goes with the stage label: the picture does not move.
      act(() => view.engine.setPairing({ stageLabel: null }));
      expect(roundLine()).toBeNull();
      sameBox('with no round line');
      stage = 'Open · SF';
      act(() => view.engine.setPairing({ stageLabel: 'Open · SF' }));
      roundLineIs('with another round line');
      sameBox('with another round line');

      // The match ends (the organiser stops it) and the next is paired: the label now comes from the pairing, before air.
      act(() => view.engine.scene('paired-after-organiser-stop'));
      sameBox('after the organiser stopped the match');

      // A new match, with a longer label: the label changes text, so the picture is sized again. Not laid out yet it is
      // the worst case (never short), and laid out at four long lines it is that reserve.
      act(() => view.engine.setPairing({ label: LONG_DOUBLES }));
      expect(boxSize().width).toBeCloseTo(longBox.width, 2);
      expect(boxSize().height).toBeCloseTo(longBox.height, 2);
      layOut(byId('match-label'), { width: half(width) - 2 * layout.stripPadH, height: 76 });
      expect(boxSize().width).toBeCloseTo(longBox.width, 2);
      expect(boxSize().height).toBeCloseTo(longBox.height, 2);
      expect(boxSize().height).toBeLessThanOrEqual(first.height);

      // And a shorter one is the first picture again, to the pixel: it depends on the label and the half and nothing else.
      act(() => view.engine.setPairing({ label: MATCH }));
      layOut(byId('match-label'), { width: half(width) - 2 * layout.stripPadH, height: 44 });
      sameBox('with the first label again');
      sequences += 1;
    },
  );

  it('ran both sequences, and the longer label made a smaller box on the phone (anti-vacuity)', () => {
    expect(SEQUENCES).toHaveLength(2);
    expect(sequences).toBe(2);
    const [phone] = SEQUENCES;
    expect(phone[3].height).toBeLessThan(phone[2].height);
  });

  // The half's width is the label's wrapping width, so a new width is a new measurement (the label lays out again in
  // it) and a new box: here a rotation of the half and the same label measured again.
  it('is sized again when the half’s width changes, and the label lays out in the new width', async () => {
    await open(804, 332, 44);
    expect(boxSize().height).toBeCloseTo(222, 2);
    layOut(byId('camera-half'), { width: half(915), height: 412 });
    layOut(byId('match-label'), { width: half(915) - 2 * layout.stripPadH, height: 22 });
    expect(boxSize().height).toBeCloseTo(324, 2);
    expect(boxSize().width).toBeCloseTo(576, 2);
  });

  // The half's HEIGHT alone changes (the status bar comes or goes, a keyboard, a split window): the width, and so the
  // label's wrapping and its height, are the same, and the picture still has to follow, because the box is the lesser of
  // what the half holds and what the window leaves the strip. By hand: 804 × 332 leaves 332 - 110 = 222 and 804 × 360
  // leaves 250, both less than the 494 × 9 / 16 = 277.875 the width holds, so the box is 222 tall and 394.6667 wide, then
  // 250 tall and 444.4444 wide. And back, exactly.
  it('is sized again when only the half’s height changes (804 × 332 to 804 × 360 and back)', async () => {
    await open(804, 332, 44);
    expect(boxSize().width).toBeCloseTo(394.6666667, 2);
    expect(boxSize().height).toBeCloseTo(222, 2);
    layOut(byId('camera-half'), { width: half(804), height: 360 });
    expect(boxSize().width).toBeCloseTo(444.4444444, 2);
    expect(boxSize().height).toBeCloseTo(250, 2);
    layOut(byId('camera-half'), { width: half(804), height: 332 });
    expect(boxSize().width).toBeCloseTo(394.6666667, 2);
    expect(boxSize().height).toBeCloseTo(222, 2);
  });

  // The three captions, each on a viewfinder of its own, at 640 × 360 where the round
  // line has room: the caption takes the strip's ONE message line and nothing else. The picture and the round line are
  // the same with it up as without, and the message is the caption alone.
  let captionsTried = 0;
  it.each(ADVISORIES)(
    'the %s caption takes the message line and moves neither the picture nor the round line (640 × 360)',
    async (_name, text, bringUp) => {
      const view = await open(640, 360, 44);
      // The calm baseline: on air, the phone charging, no caption of any kind.
      act(() => {
        view.engine.scene('live');
        view.engine.patch({ charging: true });
      });
      const calm = boxSize();
      expect(360 - calm.height).toBeCloseTo(174.375, 2);
      const roundLine = () => within(byId('status-strip')).queryByTestId('stage-line');
      expect(ADVISORIES.filter(([, other]) => screen.queryByText(other) !== null)).toHaveLength(0);
      expect(roundLine()?.textContent).toBe('Open · QF');
      expect(byId('strip-message').textContent).toBe(en['stream.status.live']);
      if (text === en['stream.advisory.notCharging']) {
        // The fake phone starts uncharged, so Not charging is the one that needs the phone unplugged again.
        act(() => view.engine.patch({ charging: false }));
      } else {
        act(() => bringUp(view));
      }
      expect(screen.queryByText(text) !== null, `${text} is up`).toBe(true);
      expect(byId('strip-message').textContent).toBe(text);
      expect(roundLine()?.textContent).toBe('Open · QF');
      expect(boxSize()).toEqual(calm);
      captionsTried += 1;
    },
  );

  it('tried all three captions (anti-vacuity)', () => {
    expect(ADVISORIES).toHaveLength(3);
    expect(captionsTried).toBe(3);
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

  // Owner, 2026-10-08: every control on screen at 804 × 332. The half's width is the board's (16 either side, which
  // `controlsHalf` is made of); its column has its own vertical padding and gap, 8 and 8 (the board's 16 and 12 made the
  // worst before-air state 24 dp too tall for the phone).
  it('the controls half: 8 above and below, 16 either side, 8 between its rows', async () => {
    await renderViewfinder();
    const style = getComputedStyle(byId('controls-half'));
    expect([style.paddingTop, style.paddingBottom, style.paddingLeft, style.paddingRight]).toEqual([
      '8px',
      '8px',
      '16px',
      '16px',
    ]);
    expect(style.gap).toBe('8px');
  });

  // The worst before-air state, brought up on the real tree: the AUTO start line under the chips AND a reason under the
  // hold button. Its five rows are the declared heights (the plate 56; the chips 44 and the start line 4 + 16; the photo
  // line's place 16; the icons 48; the hold 72 and its reason 4 + 16), stacked with the padding and gap the half RENDERED:
  // they must fit the owner's phone, 332 dp, which the board's 16 and 12 did not (356).
  it('fits 332 dp in the worst before-air state, with the padding and gap it rendered', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setPairing({ scheduledStart: new Date('2026-10-03T13:30:00Z') }));
    act(() => view.engine.setReady({ held: false }));
    // Both extra lines are really there: the start line under the chips, the reason under the hold button.
    expect(screen.getByText('Starts 14:30')).toBeTruthy();
    expect(screen.getByText(en['stream.blocker.held'])).toBeTruthy();
    const style = getComputedStyle(byId('controls-half'));
    expect(byId('controls-half').children).toHaveLength(5);
    const gap = parseFloat(style.gap);
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const small = typeScale.metricUnit.lineHeight;
    const items = [
      layout.plateHeight,
      layout.chip + space.xs + small,
      small,
      layout.iconButton,
      layout.holdHeight + space.xs + small,
    ];
    const total = items.reduce((sum, item) => sum + item, 0) + 4 * gap + pad;
    expect(items).toEqual([56, 64, 16, 48, 92]);
    expect(total).toBe(324);
    expect(total).toBeLessThanOrEqual(332);
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
