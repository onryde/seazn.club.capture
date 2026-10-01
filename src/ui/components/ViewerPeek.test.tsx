import { act, render, renderHook, screen } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEEK_WARM_MS, usePeek } from '@/hooks/usePeek';
import { StageVideo } from '@/ui/components/StageVideo';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { OrientationGate } from '@/ui/components/OrientationGate';
import { colour } from '@/ui/theme/tokens';
import { createFakePorts } from '../../../test/fakePorts';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

const PLAYBACK = 'https://video.example/fake/manifest/video.m3u8';

function PeekHarness({ available, control = true }: { available: boolean; control?: boolean }) {
  const peek = usePeek(available);
  return (
    <>
      {control ? (
        <ViewerPeek
          disabled={false}
          reason={null}
          onPressIn={peek.pressIn}
          onPressOut={peek.pressOut}
        />
      ) : null}
      {peek.mounted ? <StageVideo url={PLAYBACK} showing={peek.showing} /> : null}
    </>
  );
}

const peekButton = () => screen.getByRole('button', { name: 'What viewers see' });
const video = () => screen.queryByTestId('viewer-video');
/** The stage layer StageVideo draws around the player. */
const layer = () => video()?.parentElement as HTMLElement;

/** Which token a border was painted with; the colour on screen is a device check. */
const TOKEN = StyleSheet.create({
  ink: { borderColor: colour.ink, borderWidth: 1 },
  ink3: { borderColor: colour.ink3, borderWidth: 1 },
});

function borderOf(style: ViewStyle): string {
  const reference = render(<View testID="border-reference" style={style} />);
  const painted = getComputedStyle(reference.getByTestId('border-reference')).borderTopColor;
  reference.unmount();
  return painted;
}

describe('What viewers see (spec §4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the moment the finger lands, with no delay', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    expect(video()?.dataset.url).toBe(`${PLAYBACK}?clientBandwidthHint=1.0`);
  });

  it('draws the picture over the stage without taking its touches', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    const style = getComputedStyle(layer());
    expect(style.position).toBe('absolute');
    expect(style.pointerEvents).toBe('none');
    expect(style.opacity).not.toBe('0');
    expect(layer().getAttribute('aria-hidden')).toBeNull();
  });

  it('stops on release but stays warm for 30 s, then lets go', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    expect(video()?.dataset.playing).toBe('false');
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 1));
    expect(video()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(video()).toBeNull();
  });

  it('hides the warm player from sight and from a screen reader', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    expect(getComputedStyle(layer()).opacity).toBe('0');
    expect(layer().getAttribute('aria-hidden')).toBe('true');
  });

  it('reuses the warm player when pressed again within 30 s', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(10_000));
    const warm = video();
    pressIn(peekButton());
    expect(video()).toBe(warm);
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS));
    expect(video()?.dataset.playing).toBe('true');
  });

  it('counts the 30 s from the last release, not the first', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(10_000));
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 1));
    expect(video()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(video()).toBeNull();
  });

  it('shows nothing off air', () => {
    renderWithPorts(<PeekHarness available={false} />);
    pressIn(peekButton());
    expect(video()).toBeNull();
  });

  it('lets go of the player at once when the broadcast ends mid-peek', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    view.rerender(<PeekHarness available={false} />);
    expect(video()).toBeNull();
    pressOut(peekButton());
    view.rerender(<PeekHarness available />);
    expect(video()).toBeNull();
  });

  it('plays again on a fresh press once back on air', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    view.rerender(<PeekHarness available={false} />);
    view.rerender(<PeekHarness available />);
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS));
    expect(video()?.dataset.playing).toBe('true');
  });

  // Review M4: RN resets a Pressable that unmounts mid-press and sends no
  // onPressOut (usePressability.js, Pressability.reset), so the control lets
  // go itself; a billed preview must never run on with no finger on it.
  it('stops the picture when its control goes mid-press', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    view.rerender(<PeekHarness available control={false} />);
    expect(video()?.dataset.playing).toBe('false');
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS));
    expect(video()).toBeNull();
  });

  // N3: React tears the owner down before its children (ReactFabric-dev.js,
  // deletion effects parent first), so the control's own let-go reaches a peek
  // already gone. It must not start a new 30 s there.
  it('leaves no timer behind when the owner and its control go together mid-press', () => {
    const view = renderWithPorts(<PeekHarness available />);
    const before = vi.getTimerCount();
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    view.unmount();
    expect(vi.getTimerCount()).toBe(before);
  });

  // Ruling N4: the turn card covers the stage and the controls, so nothing
  // under it plays on. The finger may still be down; the picture goes anyway.
  it('drops the picture and the player when the turn card covers them mid-peek', () => {
    const view = renderWithPorts(
      <OrientationGate card="none">
        <PeekHarness available />
      </OrientationGate>,
    );
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    view.rerender(
      <OrientationGate card="turnSideways">
        <PeekHarness available />
      </OrientationGate>,
    );
    expect(video()).toBeNull();
    view.rerender(
      <OrientationGate card="none">
        <PeekHarness available />
      </OrientationGate>,
    );
    expect(video()).toBeNull();
    // Once the card lifts, a fresh press plays as usual.
    pressOut(peekButton());
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
  });

  it('lets a control that is not held go quietly', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(10_000));
    view.rerender(<PeekHarness available control={false} />);
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 10_000));
    expect(video()).toBeNull();
  });

  // Ruling M5: a call, the lock or Home stops the peek and lets the player go;
  // on the return nothing is left frozen over the camera.
  it('drops the picture and the player when the app leaves mid-peek', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    act(() => view.foreground.leave());
    expect(video()).toBeNull();
    act(() => view.foreground.fire());
    expect(video()).toBeNull();
    pressOut(peekButton());
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
  });

  it('drops a warm player when the app leaves', () => {
    const view = renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => view.foreground.leave());
    expect(video()).toBeNull();
  });

  it('warms and lets go the same when effects run twice (StrictMode)', () => {
    const fakes = createFakePorts();
    render(<PeekHarness available />, { wrapper: wrapperFor(fakes), reactStrictMode: true });
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 1));
    expect(video()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(video()).toBeNull();
  });

  it('marks the held control with the bright rule, and drops it on release', () => {
    renderWithPorts(<PeekHarness available />);
    expect(getComputedStyle(peekButton()).borderTopColor).toBe(borderOf(TOKEN.ink3));
    pressIn(peekButton());
    expect(getComputedStyle(peekButton()).borderTopColor).toBe(borderOf(TOKEN.ink));
    pressOut(peekButton());
    expect(getComputedStyle(peekButton()).borderTopColor).toBe(borderOf(TOKEN.ink3));
  });

  it('names itself in the operator’s language', () => {
    renderWithPorts(<PeekHarness available />, { deviceLanguages: ['es'] });
    expect(screen.getByRole('button', { name: 'Lo que ve el público' })).toBeTruthy();
    expect(screen.getByText('Lo que ve el público')).toBeTruthy();
  });
});

/** Carry 13: with nothing to play the control is off, says why, and a press lights nothing. */
describe('ViewerPeek off', () => {
  const off = (handlers: { pressIn: () => void; pressOut: () => void }) =>
    renderWithPorts(
      <ViewerPeek
        disabled
        reason="No viewer picture"
        onPressIn={handlers.pressIn}
        onPressOut={handlers.pressOut}
      />,
    );

  it('never answers a press, and keeps its quiet rule', () => {
    const handlers = { pressIn: vi.fn(), pressOut: vi.fn() };
    off(handlers);
    const quiet = getComputedStyle(peekButton()).borderTopColor;
    pressIn(peekButton());
    expect(handlers.pressIn).not.toHaveBeenCalled();
    expect(getComputedStyle(peekButton()).borderTopColor).toBe(quiet);
    expect(quiet).not.toBe(borderOf(TOKEN.ink));
  });

  it('says it is off, and why, at the control', () => {
    off({ pressIn: vi.fn(), pressOut: vi.fn() });
    expect(peekButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No viewer picture')).toBeTruthy();
  });
});

describe('ViewerPeek alone', () => {
  it('lets go through the latest handler on unmount, and never on a re-render', () => {
    const first = { pressIn: vi.fn(), pressOut: vi.fn() };
    const view = renderWithPorts(
      <ViewerPeek
        disabled={false}
        reason={null}
        onPressIn={first.pressIn}
        onPressOut={first.pressOut}
      />,
    );
    pressIn(peekButton());
    const next = { pressIn: vi.fn(), pressOut: vi.fn() };
    view.rerender(
      <ViewerPeek
        disabled={false}
        reason={null}
        onPressIn={next.pressIn}
        onPressOut={next.pressOut}
      />,
    );
    expect(first.pressOut).not.toHaveBeenCalled();
    view.unmount();
    expect(next.pressOut).toHaveBeenCalledTimes(1);
    expect(first.pressOut).not.toHaveBeenCalled();
  });
});

describe('usePeek, under the control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const wrapper = () => wrapperFor(createFakePorts());

  it('stays warm for 30 s, the spec’s figure (§4)', () => {
    expect(PEEK_WARM_MS).toBe(30_000);
  });

  it('drops the picture and the player when the broadcast ends while held', () => {
    const { result, rerender } = renderHook(({ available }) => usePeek(available), {
      initialProps: { available: true },
      wrapper: wrapper(),
    });
    act(() => result.current.pressIn());
    rerender({ available: false });
    expect(result.current.showing).toBe(false);
    expect(result.current.mounted).toBe(false);
  });

  it('ignores a press off air, even if the control let it through', () => {
    const { result } = renderHook(() => usePeek(false), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    expect(result.current.showing).toBe(false);
    expect(result.current.mounted).toBe(false);
  });

  it('keeps one player for a second press landing while held', () => {
    const { result } = renderHook(() => usePeek(true), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    act(() => result.current.pressIn());
    expect(result.current.showing).toBe(true);
    act(() => result.current.pressOut());
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS));
    expect(result.current.mounted).toBe(false);
  });

  // A release arriving twice (a lost press-in on a phone) restarts the 30 s
  // rather than leaving the first timer to cut it short.
  it('counts from the latest release when two arrive', () => {
    const { result } = renderHook(() => usePeek(true), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    act(() => vi.advanceTimersByTime(10_000));
    act(() => result.current.pressOut());
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 1));
    expect(result.current.mounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.mounted).toBe(false);
  });

  it('leaves no timer behind when the broadcast ends while it cools', () => {
    const { result, rerender } = renderHook(({ available }) => usePeek(available), {
      initialProps: { available: true },
      wrapper: wrapper(),
    });
    const others = vi.getTimerCount();
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    expect(vi.getTimerCount()).toBe(others + 1);
    rerender({ available: false });
    expect(result.current.mounted).toBe(false);
    expect(vi.getTimerCount()).toBe(others);
  });

  it('drops everything, timer included, when the app leaves while it cools', () => {
    const fakes = createFakePorts();
    const { result } = renderHook(() => usePeek(true), { wrapper: wrapperFor(fakes) });
    const others = vi.getTimerCount();
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    act(() => fakes.foreground.leave());
    expect(result.current.showing).toBe(false);
    expect(result.current.mounted).toBe(false);
    expect(vi.getTimerCount()).toBe(others);
  });

  it('stops listening for the app leaving once unmounted', () => {
    const fakes = createFakePorts();
    const { unmount } = renderHook(() => usePeek(true), { wrapper: wrapperFor(fakes) });
    expect(fakes.foreground.leaveListeners()).toBe(1);
    unmount();
    expect(fakes.foreground.leaveListeners()).toBe(0);
  });

  it('leaves no timer behind when it unmounts while it cools', () => {
    const { result, unmount } = renderHook(() => usePeek(true), { wrapper: wrapper() });
    const others = vi.getTimerCount();
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    expect(vi.getTimerCount()).toBe(others + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(others);
  });
});
