import { act, render, renderHook, screen } from '@testing-library/react';
import { Pressable, StyleSheet, Text, type TextStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, useHold } from '@/hooks/useHold';
import { HoldAction } from '@/ui/components/HoldAction';
import { colour } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';
import { createFakePorts } from '../../../test/fakePorts';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

describe('the press path in jsdom (probe)', () => {
  it('reaches onPressIn on press and onPressOut on release', () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    render(
      <Pressable accessibilityRole="button" onPressIn={onPressIn} onPressOut={onPressOut}>
        <Text>probe</Text>
      </Pressable>,
    );
    pressIn(screen.getByRole('button'));
    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(onPressOut).not.toHaveBeenCalled();
    // A second press while one is active never reaches onPressIn here.
    pressIn(screen.getByRole('button'));
    expect(onPressIn).toHaveBeenCalledTimes(1);
    pressOut(screen.getByRole('button'));
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });
});

type Props = Parameters<typeof HoldAction>[0];

/** Which token a label was set in; the colour on screen is a device check. */
const LABEL = StyleSheet.create({
  enabled: { color: colour.ink },
  disabled: { color: colour.ink3 },
});

function inkOf(style: TextStyle): string {
  const reference = render(
    <Text testID="ink-reference" style={style}>
      ink
    </Text>,
  );
  const painted = getComputedStyle(reference.getByTestId('ink-reference')).color;
  reference.unmount();
  return painted;
}

function renderHold(props: Partial<Props> = {}, options?: Parameters<typeof renderWithPorts>[1]) {
  const onHeld = vi.fn();
  const all: Props = {
    label: 'Go live',
    tone: 'go',
    disabled: false,
    reason: null,
    onHeld,
    ...props,
  };
  const view = renderWithPorts(<HoldAction {...all} />, options);
  const button = () =>
    screen.getByRole('button', { name: /Press and hold for 3 seconds|Maintenez/ });
  return { ...view, onHeld, button, all };
}

describe('HoldAction (AGENTS §6: a 3 s hold, both ways)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is three seconds, the owner’s length for both holds (2026-09-12)', () => {
    expect(HOLD_MS).toBe(3000);
  });

  it('acts once after a full 3 s hold, not a moment before', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(hold.onHeld).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('does nothing when let go early: a mis-tap is not a decision', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(2000));
    pressOut(hold.button());
    act(() => vi.advanceTimersByTime(5000));
    expect(hold.onHeld).not.toHaveBeenCalled();
  });

  it('acts once for a second press landing mid-hold', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1000));
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(6000));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('asks for the full hold again after it acted', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    pressOut(hold.button());
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(hold.onHeld).toHaveBeenCalledTimes(2);
  });

  it('never acts while disabled, and shows the reason', () => {
    const hold = renderHold({ disabled: true, reason: 'No sound' });
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).not.toHaveBeenCalled();
    expect(screen.getByText('No sound')).toBeTruthy();
  });

  it('tells a screen reader it is disabled, and says no reason when there is none', () => {
    const hold = renderHold({ disabled: true, reason: null });
    expect(hold.button().getAttribute('aria-disabled')).toBe('true');
    hold.rerender(<HoldAction {...hold.all} disabled={false} />);
    expect(hold.button().getAttribute('aria-disabled')).not.toBe('true');
    // One line of text, the label: no empty reason line taking a row of the column.
    expect(hold.container.textContent).toBe('Go live');
    expect(hold.container.querySelectorAll('[dir="auto"]')).toHaveLength(1);
  });

  it('sets a disabled label in the inert ink, and an enabled one in cream', () => {
    const hold = renderHold({ disabled: true, reason: 'No sound' });
    expect(getComputedStyle(screen.getByText('Go live')).color).toBe(inkOf(LABEL.disabled));
    hold.rerender(<HoldAction {...hold.all} disabled={false} />);
    expect(getComputedStyle(screen.getByText('Go live')).color).toBe(inkOf(LABEL.enabled));
  });

  it('abandons a hold when it becomes disabled mid-way', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1500));
    hold.rerender(<HoldAction {...hold.all} disabled />);
    act(() => vi.advanceTimersByTime(3000));
    expect(hold.onHeld).not.toHaveBeenCalled();
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
  });

  it('takes a fresh full hold once enabled again after an abandoned one', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1500));
    hold.rerender(<HoldAction {...hold.all} disabled />);
    hold.rerender(<HoldAction {...hold.all} disabled={false} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(hold.onHeld).not.toHaveBeenCalled();
    // The finger lifts before it can land again.
    pressOut(hold.button());
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  // The hold does what was pressed (useHold): a parent re-rendering mid-hold,
  // with a fresh onHeld or a new reason, neither restarts it nor acts twice.
  it('keeps its clock and its action through a re-render mid-hold', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1500));
    const later = vi.fn();
    hold.rerender(<HoldAction {...hold.all} onHeld={later} reason="Uplink weak" />);
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('true');
    act(() => vi.advanceTimersByTime(1499));
    expect(hold.onHeld).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  // Ruling M5: a call, the lock or Home mid-hold abandons it, so Go live or
  // Stop can never act on the return with no finger on the glass. Android
  // keeps JS timers paused while away; on return a pending one would fire.
  it.each([
    ['go', 'Go live'],
    ['stop', 'Stop'],
  ] as const)('never completes a %s hold across leaving the app', (tone, label) => {
    const hold = renderHold({ tone, label });
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(2000));
    act(() => hold.foreground.leave());
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
    act(() => hold.foreground.fire());
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(hold.onHeld).not.toHaveBeenCalled();
    // A fresh full hold after the return acts as usual.
    pressOut(hold.button());
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('abandons a hold when unmounted mid-way', () => {
    const hold = renderHold();
    pressIn(hold.button());
    hold.unmount();
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).not.toHaveBeenCalled();
  });

  it('shows the fill while held and clears it on release', () => {
    const hold = renderHold({ tone: 'stop', label: 'Stop' });
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
    pressIn(hold.button());
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('true');
    expect(screen.getByTestId('hold-fill').dataset.tone).toBe('stop');
    pressOut(hold.button());
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
  });

  it('clears the fill when the hold completes, before the finger lifts', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
    expect(screen.getByTestId('hold-fill').dataset.tone).toBe('go');
  });

  it('says how to use it, in the operator’s language', () => {
    renderHold({ label: 'Passer en direct' }, { deviceLanguages: ['fr'] });
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});

describe('useHold, under the control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const wrapper = () => wrapperFor(createFakePorts());

  it('ignores a press while not enabled, even if the control let it through', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, false), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    expect(result.current.holding).toBe(false);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHeld).not.toHaveBeenCalled();
  });

  // react-native-web drops a second keyDown while a press is active, so the
  // control-level test above cannot reach this guard; a second pointer or an
  // accessibility action on a phone could.
  it('keeps the first press’s clock when a second press lands mid-hold', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, true), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1000));
    expect(onHeld).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  it('acts once, as first pressed, when a re-render and a second press land mid-hold', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onHeld }) => useHold(onHeld, true), {
      initialProps: { onHeld: first },
      wrapper: wrapper(),
    });
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(1000));
    rerender({ onHeld: second });
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('leaves nothing running once it acted: the next press is a fresh full hold', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, true), { wrapper: wrapper() });
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    act(() => result.current.pressIn());
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHeld).toHaveBeenCalledTimes(2);
  });

  it('stops listening for the app leaving once unmounted', () => {
    const fakes = createFakePorts();
    const { result, unmount } = renderHook(() => useHold(vi.fn(), true), {
      wrapper: wrapperFor(fakes),
    });
    expect(fakes.foreground.leaveListeners()).toBe(1);
    act(() => result.current.pressIn());
    unmount();
    expect(fakes.foreground.leaveListeners()).toBe(0);
  });

  it('lets a release with no hold running pass quietly', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, true), { wrapper: wrapper() });
    act(() => result.current.pressOut());
    expect(result.current.holding).toBe(false);
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHeld).toHaveBeenCalledTimes(1);
  });
});
