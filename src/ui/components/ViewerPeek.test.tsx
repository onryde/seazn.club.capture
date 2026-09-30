import { act, render, renderHook, screen } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEEK_WARM_MS, usePeek } from '@/hooks/usePeek';
import { StageVideo } from '@/ui/components/StageVideo';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour } from '@/ui/theme/tokens';
import { createFakePorts } from '../../../test/fakePorts';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

const PLAYBACK = 'https://video.example/fake/manifest/video.m3u8';

function PeekHarness({ available }: { available: boolean }) {
  const peek = usePeek(available);
  return (
    <>
      <ViewerPeek onPressIn={peek.pressIn} onPressOut={peek.pressOut} />
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

describe('usePeek, under the control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays warm for 30 s, the spec’s figure (§4)', () => {
    expect(PEEK_WARM_MS).toBe(30_000);
  });

  it('drops the picture and the player when the broadcast ends while held', () => {
    const { result, rerender } = renderHook(({ available }) => usePeek(available), {
      initialProps: { available: true },
    });
    act(() => result.current.pressIn());
    rerender({ available: false });
    expect(result.current.showing).toBe(false);
    expect(result.current.mounted).toBe(false);
  });

  it('ignores a press off air, even if the control let it through', () => {
    const { result } = renderHook(() => usePeek(false));
    act(() => result.current.pressIn());
    expect(result.current.showing).toBe(false);
    expect(result.current.mounted).toBe(false);
  });

  it('keeps one player for a second press landing while held', () => {
    const { result } = renderHook(() => usePeek(true));
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
    const { result } = renderHook(() => usePeek(true));
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
    });
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    expect(vi.getTimerCount()).toBe(1);
    rerender({ available: false });
    expect(result.current.mounted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when it unmounts while it cools', () => {
    const { result, unmount } = renderHook(() => usePeek(true));
    act(() => result.current.pressIn());
    act(() => result.current.pressOut());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
