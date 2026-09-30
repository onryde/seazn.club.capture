import { act, render, screen } from '@testing-library/react';
import { StyleSheet, Text as RNText, View, type TextStyle, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TallyPlate as Plate } from '@/hooks/preflight';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { EdgeStrip } from '@/ui/components/EdgeStrip';
import { Elapsed } from '@/ui/components/Elapsed';
import { LivePlate } from '@/ui/components/LivePlate';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { colour, plate as plateColour, plateInk } from '@/ui/theme/tokens';
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

describe('LivePlate (beside Back on Settings and Diagnostics)', () => {
  it('is absent off air', () => {
    renderWithPorts(<LivePlate />);
    expect(screen.queryByTestId('tally-plate')).toBeNull();
  });

  it.each([['armed-ready'], ['stopped'], ['fatal']] as const)(
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
 * Levels from the fake's scenes: armed 0.42, not ready 0.01, mic silenced 0.
 * A segment lights when the level reaches into it, so any sound shows; below
 * AUDIO_FLOOR (0.05) that segment is orange (spec §4).
 */
describe('AudioMeter', () => {
  const firstSegment = (meter: HTMLElement) => meter.children[0] as Element;

  it('lights segments with the level, in lime at or above the floor', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('armed-ready'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 3 of 6' });
    expect(meter.getAttribute('aria-valuenow')).toBe('3');
    expect(meter.children).toHaveLength(6);
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.lime));
    expect(backgroundOf(meter.children[3] as Element)).toBe(paintOf(TOKEN.unlit));
  });

  it('shows a faint mic as one orange segment: quiet reaches YouTube quiet', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('armed-not-ready'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 1 of 6' });
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.caution));
    expect(backgroundOf(meter.children[1] as Element)).toBe(paintOf(TOKEN.unlit));
  });

  it('lights nothing for silence', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('mic-silenced'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 0 of 6' });
    expect(backgroundOf(firstSegment(meter))).toBe(paintOf(TOKEN.unlit));
  });

  it('follows the level as it moves', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('armed-ready'));
    act(() => view.engine.patch({ audioLevel: 1 }));
    expect(screen.getByRole('progressbar', { name: 'Sound level 6 of 6' })).toBeTruthy();
  });

  it('names the level in the operator’s language', () => {
    const view = renderWithPorts(<AudioMeter />, { deviceLanguages: ['nl'] });
    act(() => view.engine.scene('armed-ready'));
    expect(screen.getByRole('progressbar', { name: 'Geluidsniveau 3 van 6' })).toBeTruthy();
  });
});

describe('EdgeStrip (AGENTS §6: the only thing drawn over the preview)', () => {
  it.each([['top'], ['bottom']] as const)('sits solid on the %s edge of the stage', (edge) => {
    render(
      <EdgeStrip edge={edge}>
        <RNText>caption</RNText>
      </EdgeStrip>,
    );
    const strip = screen.getByText('caption').parentElement as HTMLElement;
    const style = getComputedStyle(strip);
    expect(style.position).toBe('absolute');
    expect(style[edge]).toBe('0px');
    expect(style[edge === 'top' ? 'bottom' : 'top']).not.toBe('0px');
    expect(style.backgroundColor).toBe(paintOf(TOKEN.surface));
  });
});
