import { act, render, screen } from '@testing-library/react';
import { StyleSheet, Text as RNText, View, type TextStyle, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEY } from '@/hooks/advisory';
import type { TallyPlate as Plate } from '@/hooks/preflight';
import en from '@/i18n/en.json';
import nl from '@/i18n/nl.json';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { LivePlate } from '@/ui/components/LivePlate';
import { StatusLine } from '@/ui/components/StatusLine';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { colour, layout, plate as plateColour, plateInk } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

/**
 * Which token a component painted, read through jsdom's cascade of
 * react-native-web's classes. It proves the choice of token, not what a phone
 * draws: colour on screen is a device check (AGENTS §10).
 */
const TOKEN = StyleSheet.create({
  live: { backgroundColor: plateColour.live },
  healthy: { backgroundColor: plateColour.healthy },
  degraded: { backgroundColor: plateColour.degraded },
  inert: { backgroundColor: plateColour.inert },
  lime: { backgroundColor: colour.lime },
  caution: { backgroundColor: colour.caution },
  unlit: { backgroundColor: colour.surface2 },
  surface: { backgroundColor: colour.surface },
});

function paintOf(style: ViewStyle): string {
  const reference = render(<View testID="paint-reference" style={style} />);
  const painted = getComputedStyle(reference.getByTestId('paint-reference')).backgroundColor;
  reference.unmount();
  return painted;
}

const backgroundOf = (element: Element) => getComputedStyle(element).backgroundColor;

/** The ink a plate's word takes: night on a solid plate, cream on the inert one. */
const INK = StyleSheet.create({
  onPlate: { color: plateInk },
  onInert: { color: colour.ink },
});

function inkOf(style: TextStyle): string {
  const reference = render(
    <RNText testID="ink-reference" style={style}>
      ink
    </RNText>,
  );
  const painted = getComputedStyle(reference.getByTestId('ink-reference')).color;
  reference.unmount();
  return painted;
}

describe('TallyPlate', () => {
  it.each<[Plate, string]>([
    ['starting', 'Starting'],
    ['notReady', 'Not ready'],
    ['ready', 'Ready'],
    ['connecting', 'Connecting'],
    ['live', 'Live'],
    ['trouble', 'Trouble'],
    ['ended', 'Ended'],
  ])('%s reads %s', (plate, word) => {
    renderWithPorts(<TallyPlate plate={plate} />);
    expect(screen.getByTestId('tally-plate').textContent).toBe(word);
  });

  // D14's table. Red is LIVE and nothing else: connecting is inert (AGENTS §5).
  it.each<[Plate, ViewStyle]>([
    ['starting', TOKEN.inert],
    ['notReady', TOKEN.inert],
    ['ready', TOKEN.healthy],
    ['connecting', TOKEN.inert],
    ['live', TOKEN.live],
    ['trouble', TOKEN.degraded],
    ['ended', TOKEN.inert],
  ])('%s is painted with its D14 plate token', (plate, token) => {
    renderWithPorts(<TallyPlate plate={plate} />);
    expect(backgroundOf(screen.getByTestId('tally-plate'))).toBe(paintOf(token));
  });

  // Fabric's default text is black, which vanishes on the inert night plate
  // (the ContinueCard lesson, AGENTS §13): every plate names its ink.
  it.each<[Plate, string, TextStyle]>([
    ['starting', 'Starting', INK.onInert],
    ['notReady', 'Not ready', INK.onInert],
    ['ready', 'Ready', INK.onPlate],
    ['connecting', 'Connecting', INK.onInert],
    ['live', 'Live', INK.onPlate],
    ['trouble', 'Trouble', INK.onPlate],
    ['ended', 'Ended', INK.onInert],
  ])('%s sets its word in its plate’s ink', (plate, word, ink) => {
    renderWithPorts(<TallyPlate plate={plate} />);
    expect(getComputedStyle(screen.getByText(word)).color).toBe(inkOf(ink));
  });

  // The fit arithmetic (viewfinderFit.test.ts) reserves `layout.plateHeight` for the plate; this is the plate keeping to it.
  it.each<[Plate]>([['ready'], ['live'], ['trouble'], ['connecting']])(
    '%s is as tall as the viewfinder’s fit reserves for it (56 dp, spec §4)',
    (plate) => {
      renderWithPorts(<TallyPlate plate={plate} />);
      expect(layout.plateHeight).toBe(56);
      expect(getComputedStyle(screen.getByTestId('tally-plate')).minHeight).toBe('56px');
    },
  );

  it('announces a change of state politely to a screen reader', () => {
    renderWithPorts(<TallyPlate plate="trouble" />);
    // react-native-web renders accessibilityLiveRegion as aria-live; whether
    // TalkBack speaks LIVE → TROUBLE is a device check.
    expect(screen.getByTestId('tally-plate').getAttribute('aria-live')).toBe('polite');
  });

  it('speaks the operator’s language', () => {
    renderWithPorts(<TallyPlate plate="live" />, { deviceLanguages: ['fr'] });
    expect(screen.getByTestId('tally-plate').textContent).toBe('En direct');
  });
});

describe('LivePlate (beside Back on Settings)', () => {
  it('is absent off air', () => {
    renderWithPorts(<LivePlate />);
    expect(screen.queryByTestId('tally-plate')).toBeNull();
  });

  it.each([['paired-ready'], ['stopped'], ['fatal']] as const)(
    'is absent when %s: nothing is going out',
    (scene) => {
      const view = renderWithPorts(<LivePlate />);
      act(() => view.engine.scene(scene));
      expect(screen.queryByTestId('tally-plate')).toBeNull();
    },
  );

  it.each([
    ['live', 'Live'],
    ['connecting', 'Connecting'],
    ['holding', 'Trouble'],
    ['fell-back', 'Trouble'],
  ] as const)('reads the viewfinder’s own plate on air: %s → %s', (scene, word) => {
    const view = renderWithPorts(<LivePlate />);
    act(() => view.engine.scene(scene));
    expect(screen.getByTestId('tally-plate').textContent).toBe(word);
  });

  it('never paints connecting red: LIVE waits for frames (F-P5-6)', () => {
    const view = renderWithPorts(<LivePlate />);
    act(() => view.engine.scene('connecting'));
    expect(backgroundOf(screen.getByTestId('tally-plate'))).toBe(paintOf(TOKEN.inert));
  });
});

describe('Elapsed', () => {
  let now = TEST_NOW.getTime();
  const clock = vi.fn(() => new Date(now));

  beforeEach(() => {
    vi.useFakeTimers();
    now = TEST_NOW.getTime();
    clock.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  /** The fake engine and the Elapsed clock read the same phone time. */
  function renderElapsed() {
    const view = renderWithPorts(<Elapsed />, { clock });
    const moveTo = (atMs: number) => {
      now = atMs;
      view.setNow(new Date(atMs));
    };
    return { ...view, moveTo };
  }

  it('shows time on air as H:MM:SS, and ticks', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('live'));
    expect(screen.getByText('0:12:34')).toBeTruthy();
    act(() => {
      view.moveTo(TEST_NOW.getTime() + 1000);
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:12:35')).toBeTruthy();
  });

  it('says it in words to a screen reader', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('live'));
    expect(screen.getByLabelText('On air for 0:12:34')).toBeTruthy();
  });

  it('is absent before the broadcast starts', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('connecting'));
    expect(screen.queryByText(/\d:\d\d:\d\d/)).toBeNull();
  });

  it('does not tick off air (AGENTS §8: nothing ticks for nothing)', () => {
    renderElapsed();
    clock.mockClear();
    act(() => vi.advanceTimersByTime(5000));
    expect(clock).not.toHaveBeenCalled();
  });

  it('reads the phone clock the moment it goes on air, not the time it mounted', () => {
    const view = renderElapsed();
    act(() => view.moveTo(TEST_NOW.getTime() + 60_000));
    act(() => view.engine.scene('live'));
    expect(screen.getByText('0:12:34')).toBeTruthy();
  });

  it('keeps counting through a drop: the hold keeps the broadcast continuous', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('live'));
    act(() => view.engine.scene('holding'));
    expect(screen.getByText('0:12:34')).toBeTruthy();
  });

  it('goes, and stops reading the clock, when the broadcast ends', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('live'));
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByText(/\d:\d\d:\d\d/)).toBeNull();
    clock.mockClear();
    act(() => vi.advanceTimersByTime(5000));
    expect(clock).not.toHaveBeenCalled();
  });

  it('counts a second broadcast from its own start', () => {
    const view = renderElapsed();
    act(() => view.engine.scene('live'));
    act(() => view.engine.scene('stopped'));
    act(() => view.moveTo(TEST_NOW.getTime() + 600_000));
    act(() => view.engine.scene('live'));
    expect(screen.getByText('0:12:34')).toBeTruthy();
    act(() => {
      view.moveTo(TEST_NOW.getTime() + 601_000);
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:12:35')).toBeTruthy();
  });
});

/**
 * Levels from the fake's scenes: paired 0.42, not ready 0, mic silenced 0.
 * A segment lights when the level reaches into it, so any sound shows; the lit
 * segments are lime while the mic is available, and orange when the mic is not
 * available (spec §4): the level never decides the colour.
 */
describe('AudioMeter', () => {
  const firstSegment = (meter: HTMLElement) => meter.children[0] as Element;

  it('lights segments with the level, in lime while the mic is available', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('paired-ready'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 3 of 6' });
    expect(meter.getAttribute('aria-valuenow')).toBe('3');
    expect(meter.children).toHaveLength(6);
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.lime));
    expect(backgroundOf(meter.children[3] as Element)).toBe(paintOf(TOKEN.unlit));
  });

  it('shows a faint level as one orange segment while the mic is not available', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('paired-not-ready'));
    act(() => view.engine.patch({ audioLevel: 0.01 }));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 1 of 6' });
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.caution));
    expect(backgroundOf(meter.children[1] as Element)).toBe(paintOf(TOKEN.unlit));
  });

  // Spec §4: "lime whenever sound is ready". A quiet room is a working mic, so its one segment is lime.
  it('shows a quiet room as one lime segment: quiet reaches YouTube quiet, and the mic is available', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('paired-ready'));
    act(() => view.engine.patch({ audioLevel: 0.01 }));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 1 of 6' });
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.lime));
    expect(backgroundOf(meter.children[1] as Element)).toBe(paintOf(TOKEN.unlit));
  });

  // The fit arithmetic reserves `layout.meterHeight` for the bar; this is the bar keeping to it.
  it('is as tall as the viewfinder’s fit reserves for it (12 dp)', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('paired-ready'));
    expect(layout.meterHeight).toBe(12);
    expect(getComputedStyle(screen.getByRole('progressbar')).height).toBe('12px');
  });

  it('lights nothing for silence', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('mic-silenced'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 0 of 6' });
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.unlit));
  });

  it('follows the level as it moves', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('paired-ready'));
    act(() => view.engine.patch({ audioLevel: 1 }));
    expect(screen.getByRole('progressbar', { name: 'Sound level 6 of 6' })).toBeTruthy();
  });

  it('names the level in the operator’s language', () => {
    const view = renderWithPorts(<AudioMeter />, { deviceLanguages: ['nl'] });
    act(() => view.engine.scene('paired-ready'));
    expect(screen.getByRole('progressbar', { name: 'Geluidsniveau 3 van 6' })).toBeTruthy();
  });
});

/**
 * The status strip under the camera box (spec §1). It replaces the two edge strips,
 * which sat over the shot: this one is in the flow below it. Where it sits in the
 * screen is the layout test's; this is the strip on its own.
 */
describe('StatusStrip', () => {
  const messageOf = () => screen.getByTestId('strip-message');
  const oneLine = (element: Element) => {
    const style = getComputedStyle(element);
    return style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis';
  };

  it('says the line alone, with no caption, when there is no advisory', () => {
    renderWithPorts(
      <StatusStrip line="Live. Sound and picture going out." lineTier="routine" advisory={null} />,
    );
    const strip = screen.getByTestId('status-strip');
    // No pairing yet, so no label either: the strip's only child is the message, and the line is its only child.
    expect([...strip.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'strip-message',
    ]);
    expect([...messageOf().children].map((child) => child.textContent)).toEqual([
      'Live. Sound and picture going out.',
    ]);
  });

  // Owner, 2026-10-08: one single line all the time. The caption is the warning, so it wins the line; the status line
  // is what it says when there is none. Never both.
  it('says the label, then ONE message, in the operator’s language: the caption when one is up, not the line', () => {
    const view = renderWithPorts(
      <StatusStrip line="Wachten op Go live" lineTier="routine" advisory="shed" />,
      {
        deviceLanguages: ['nl'],
      },
    );
    act(() => view.engine.scene('paired-ready'));
    const strip = screen.getByTestId('status-strip');
    expect(
      [...strip.children].map((child) => child.getAttribute('data-testid') ?? child.textContent),
    ).toEqual(['match-label', 'strip-message']);
    expect([...messageOf().children].map((child) => child.textContent)).toEqual([
      nl['stream.advisory.shed'],
    ]);
    expect(screen.queryByText('Wachten op Go live')).toBeNull();
    // The positive pair: the caption gone, the same line is back, alone.
    view.rerender(<StatusStrip line="Wachten op Go live" lineTier="routine" advisory={null} />);
    expect([...messageOf().children].map((child) => child.textContent)).toEqual([
      'Wachten op Go live',
    ]);
    expect(screen.queryByText(nl['stream.advisory.shed'])).toBeNull();
  });

  it.each(['keepOpen', 'shed', 'notCharging'] as const)(
    'the %s caption takes the line over from a routine status line, and gives it back',
    (advisory) => {
      const view = renderWithPorts(
        <StatusStrip line="Live." lineTier="routine" advisory={advisory} />,
      );
      expect(screen.queryByText('Live.')).toBeNull();
      expect(messageOf().children).toHaveLength(1);
      view.rerender(<StatusStrip line="Live." lineTier="routine" advisory={null} />);
      expect(screen.getByText('Live.')).toBeTruthy();
      expect(messageOf().children).toHaveLength(1);
    },
  );

  // Owner ruling, 2026-10-08 (two tiers): a status line that needs action or reports a failure is URGENT and always
  // wins the one line, whichever caption is up; only a ROUTINE line gives way to a caption.
  it.each(['keepOpen', 'shed', 'notCharging'] as const)(
    'an urgent status line beats the %s caption: the line is the one message, the caption is not shown',
    (advisory) => {
      const view = renderWithPorts(
        <StatusStrip line="No streaming credit" lineTier="urgent" advisory={advisory} />,
      );
      expect([...messageOf().children].map((child) => child.textContent)).toEqual([
        'No streaming credit',
      ]);
      expect(screen.queryByText(en[ADVISORY_KEY[advisory]])).toBeNull();
      // The positive pair: the same caption over a routine line is the one message, and the line is not shown.
      view.rerender(<StatusStrip line="Live." lineTier="routine" advisory={advisory} />);
      expect([...messageOf().children].map((child) => child.textContent)).toEqual([
        en[ADVISORY_KEY[advisory]],
      ]);
      expect(screen.queryByText('Live.')).toBeNull();
    },
  );

  // Owner, 2026-10-08: exactly one line, status or caption: numberOfLines 1 (an ellipsis past the strip's text), and
  // one body line of height (22) reserved either way so the strip is the same height whichever it says.
  it('is one line with an ellipsis, and 22 dp high, whether it says the line or a caption', () => {
    const view = renderWithPorts(<StatusStrip line="Live." lineTier="routine" advisory={null} />);
    expect(oneLine(screen.getByText('Live.'))).toBe(true);
    expect(getComputedStyle(messageOf()).minHeight).toBe(`${layout.messageLines * 22}px`);
    expect(getComputedStyle(messageOf()).minHeight).toBe('22px');
    view.rerender(<StatusStrip line="Live." lineTier="routine" advisory="notCharging" />);
    const caption = screen.getByText(en['stream.advisory.notCharging']);
    expect(oneLine(caption)).toBe(true);
    expect(getComputedStyle(messageOf()).minHeight).toBe('22px');
  });

  // The caption is a line of metricUnit (12 on 16) and the status line one of body (15 on 22), both in the same 22 dp
  // slot. The slot centres its child, so a caption sits 3 dp from the top and 3 from the bottom of it and is not pinned
  // to the top edge, where it would read as sitting on the match label above it. jsdom lays nothing out, so this pins
  // the style that does the centring, and the arithmetic of what it centres.
  it('centres a caption in the message line’s 22 dp slot: a column that centres its child, 3 dp spare a side', () => {
    const view = renderWithPorts(
      <StatusStrip line="Live." lineTier="routine" advisory="notCharging" />,
    );
    const slot = getComputedStyle(messageOf());
    expect(slot.flexDirection).toBe('column');
    expect(slot.justifyContent).toBe('center');
    const caption = getComputedStyle(screen.getByText(en['stream.advisory.notCharging']));
    expect(caption.lineHeight).toBe(`${typeScale.metricUnit.lineHeight}px`);
    expect(caption.lineHeight).toBe('16px');
    expect((22 - typeScale.metricUnit.lineHeight) / 2).toBe(3);
    // The same slot centres the status line, which fills it (22 on 22): nothing to move, the same style either way.
    view.rerender(<StatusStrip line="Live." lineTier="routine" advisory={null} />);
    expect(getComputedStyle(messageOf()).justifyContent).toBe('center');
    expect(getComputedStyle(screen.getByText('Live.')).lineHeight).toBe('22px');
  });

  it('is the surface colour, in the flow: not drawn over the shot', () => {
    renderWithPorts(<StatusStrip line="Live." lineTier="routine" advisory={null} />);
    const style = getComputedStyle(screen.getByTestId('status-strip'));
    expect(style.backgroundColor).toBe(paintOf(TOKEN.surface));
    expect(style.position).not.toBe('absolute');
  });
});

/**
 * Home's status line, which the strip's variant must leave as it was: the `status` role (13.5 sp), up
 * to three lines, and the height of three of them reserved (3 × 19 = 57) so the controls below do not move.
 */
describe('StatusLine', () => {
  it('is the status role at three lines with 57 dp reserved, unless told otherwise (Home)', () => {
    render(<StatusLine>One sentence.</StatusLine>);
    const style = getComputedStyle(screen.getByText('One sentence.'));
    expect(style.fontSize).toBe('13.5px');
    expect(style.minHeight).toBe('57px');
    expect(style.getPropertyValue('-webkit-line-clamp')).toBe('3');
  });

  it('takes the body role and the strip’s one line: 22 dp reserved, an ellipsis past the width', () => {
    render(
      <StatusLine variant="body" numberOfLines={layout.messageLines}>
        One sentence.
      </StatusLine>,
    );
    const style = getComputedStyle(screen.getByText('One sentence.'));
    expect(layout.messageLines).toBe(1);
    expect(style.fontSize).toBe('15px');
    expect(style.minHeight).toBe('22px');
    expect([style.whiteSpace, style.textOverflow]).toEqual(['nowrap', 'ellipsis']);
  });
});
