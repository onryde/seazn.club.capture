import { act, fireEvent, screen } from '@testing-library/react';
import { Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchWake } from '@/ui/components/TouchWake';
import { pairCode } from '../../../test/pairCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** A press as react-native-web's responder system sees one: down, up, then the click. */
function press(target: HTMLElement) {
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}

function renderPairedWake() {
  const onPress = vi.fn();
  const onPressIn = vi.fn();
  const view = renderWithPorts(
    <TouchWake>
      <Pressable onPress={onPress} onPressIn={onPressIn} testID="child">
        <Text>child</Text>
      </Pressable>
    </TouchWake>,
  );
  act(() => {
    pairCode(view.engine, savedStreamCode());
    view.engine.scene('paired-ready');
  });
  return { ...view, onPress, onPressIn };
}

describe('TouchWake (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a touch anywhere inside wakes a dimmed screen, and the control under it still gets the touch', () => {
    const view = renderPairedWake();
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.screen.dimmed).toBe(true);
    press(screen.getByTestId('child'));
    expect(view.screen.dimmed).toBe(false);
    // The capture phase answers false: the control is granted the touch (press-in) and gets its press.
    expect(view.onPressIn).toHaveBeenCalledTimes(1);
    expect(view.onPress).toHaveBeenCalledTimes(1);
  });

  it('a touch on a bright screen starts the 30 s again', () => {
    const view = renderPairedWake();
    act(() => vi.advanceTimersByTime(20_000));
    press(screen.getByTestId('child'));
    act(() => vi.advanceTimersByTime(29_999));
    expect(view.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.screen.dimmed).toBe(true);
  });
});
