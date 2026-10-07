import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEY } from '@/hooks/advisory';
import en from '@/i18n/en.json';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
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
/** The names of the buttons in a row, in order. */
const buttonNames = (row: HTMLElement) =>
  within(row)
    .getAllByRole('button')
    .map((button) => button.textContent);

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

  it('is a black 16:9 box as wide as its half, clipping what it holds', async () => {
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

  it('keeps the icon row: Settings, Diagnostics and Home before air', async () => {
    await renderViewfinder();
    expect(getComputedStyle(byId('icon-row')).flexDirection).toBe('row');
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.link.diagnostics'],
      en['stream.home'],
    ]);
  });

  it('on air: What viewers see sits in the icon row after Settings, and Home is not offered', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.peek.label'],
      en['stream.link.diagnostics'],
    ]);
  });

  it('is 72 dp tall at the hold button, Go live and Stop alike (spec §1)', async () => {
    const view = await renderViewfinder();
    expect(getComputedStyle(goLive()).minHeight).toBe('72px');
    expect(layout.holdHeight).toBe(72);
    act(() => view.engine.scene('live'));
    expect(getComputedStyle(stopLive()).minHeight).toBe('72px');
  });

  it('Ended keeps both halves: the summary and Scan another take the hold button’s place', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    act(() => view.engine.scene('stopped'));
    expect([...byId('viewfinder').children]).toHaveLength(2);
    const rows = [...byId('controls-half').children];
    expect(rows[0]).toBe(byId('plate-row'));
    expect(rows).toContain(byId('icon-row'));
    const last = rows.at(-1) as HTMLElement;
    expect(within(last).getByRole('button', { name: en['stream.ended.scanAnother'] })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Press and hold/ })).toBeNull();
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
