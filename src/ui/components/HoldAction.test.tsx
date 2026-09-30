import { act, render, renderHook, screen } from '@testing-library/react';
import { Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, useHold } from '@/hooks/useHold';
import { HoldAction } from '@/ui/components/HoldAction';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

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

  it('ignores a press while not enabled, even if the control let it through', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, false));
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
    const { result } = renderHook(() => useHold(onHeld, true));
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1000));
    expect(onHeld).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing running once it acted: the next press is a fresh full hold', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, true));
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    act(() => result.current.pressIn());
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHeld).toHaveBeenCalledTimes(2);
  });

  it('lets a release with no hold running pass quietly', () => {
    const onHeld = vi.fn();
    const { result } = renderHook(() => useHold(onHeld, true));
    act(() => result.current.pressOut());
    expect(result.current.holding).toBe(false);
    act(() => result.current.pressIn());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHeld).toHaveBeenCalledTimes(1);
  });
});
