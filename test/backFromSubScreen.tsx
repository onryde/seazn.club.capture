import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts } from './fakePorts';
import { savedStreamCode } from './fixtures/savedStream';
import { wrapperFor } from './renderWithPorts';

const LEAVE_ON_AIR = 'Stop the broadcast first — hold Stop.';

/** The stream stack as Expo Router keeps it: the viewfinder stays mounted under a pushed sub-screen. */
async function renderStack(subScreen: ReactElement, link: string) {
  const fakes = createFakePorts({
    kvSeed: {
      [STORE_KEYS.active]: 'stream',
      [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
    },
  });
  const Stack = ({ open }: { open: boolean }) => (
    <>
      <StreamScreen />
      {open ? subScreen : null}
    </>
  );
  const rendered = render(<Stack open={false} />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  const openSubScreen = () => {
    fireEvent.click(screen.getByRole('button', { name: link }));
    rendered.rerender(<Stack open />);
  };
  return { ...rendered, ...fakes, openSubScreen };
}

/**
 * M21, carry 9 and review M9: Back belongs to whichever screen is showing. The
 * viewfinder re-subscribes its Back on every state change, so it is often asked
 * first, even under a sub-screen; it answers only off a named sub-route. Run
 * by each sub-screen's own suite, so each one's Back is proven on its own.
 */
export function describeBackFromSubScreen(
  link: 'Settings' | 'Diagnostics',
  subScreen: ReactElement,
) {
  describe(`Back between the viewfinder and ${link} (M21)`, () => {
    it('a state change underneath, then Back, returns to the camera without leaving', async () => {
      const view = await renderStack(subScreen, link);
      view.openSubScreen();
      const setActive = vi.spyOn(view.ports.modeStore, 'setActive');
      act(() => view.engine.scene('live'));
      let handled = false;
      act(() => {
        handled = view.back.press();
      });
      expect(handled).toBe(true);
      expect(view.navigation.current()).toBe('stream');
      expect(screen.queryByText(LEAVE_ON_AIR)).toBeNull();
      expect(setActive).not.toHaveBeenCalled();
    });

    it('Back on the camera after a round trip on air still says how to stop', async () => {
      const view = await renderStack(subScreen, link);
      act(() => view.engine.scene('live'));
      view.openSubScreen();
      act(() => void view.back.press());
      expect(view.navigation.current()).toBe('stream');
      // The sub-screen has not gone yet: the press is still the viewfinder's.
      let handled = false;
      act(() => {
        handled = view.back.press();
      });
      expect(handled).toBe(true);
      expect(view.navigation.current()).toBe('stream');
      expect(screen.getByText(LEAVE_ON_AIR)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    });

    it('Back on the camera after a round trip off air leaves for Home', async () => {
      const view = await renderStack(subScreen, link);
      view.openSubScreen();
      act(() => void view.back.press());
      act(() => void view.back.press());
      await waitFor(() => expect(view.navigation.current()).toBe('home'));
    });
  });
}
