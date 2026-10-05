import { renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { usePeek } from '@/hooks/usePeek';
import { TurnCardProvider } from '@/hooks/useTurnCard';
import { HoldAction } from '@/ui/components/HoldAction';
import { createFakePorts } from '../../../test/fakePorts';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

/**
 * Found on the phone (2026-10-05): "React has detected a change in the order
 * of Hooks called by HoldAction". useHold read the turn card behind `&&`, so a
 * disabled control skipped that hook; usePeek did the same off air, and
 * `react-hooks/rules-of-hooks` (now on, at error) names both. React warns once
 * per component name in a module's life, so these tests live in a file of their
 * own, one component name each: no earlier render can have spent the warning.
 */
let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

const reorders = () =>
  errors.mock.calls.filter((args) =>
    args.some((arg) => String(arg).includes('change in the order of Hooks')),
  ).length;

it('HoldAction reads the turn card on every render, so its hook order holds as disabled toggles', () => {
  const onHeld = vi.fn();
  const at = (disabled: boolean) => (
    <TurnCardProvider showing={false}>
      <HoldAction label="Go live" tone="go" disabled={disabled} reason={null} onHeld={onHeld} />
    </TurnCardProvider>
  );
  const view = renderWithPorts(at(false));
  const toggles = [true, false, true, false];
  for (const disabled of toggles) view.rerender(at(disabled));
  expect(screen.getAllByRole('button', { name: /Press and hold/ })).toHaveLength(1);
  expect({ toggles: toggles.length, reorders: reorders() }).toEqual({ toggles: 4, reorders: 0 });
});

it('usePeek reads the turn card on every render, so its hook order holds as the air comes and goes', () => {
  const ports = wrapperFor(createFakePorts());
  function Wrapper({ children }: { children: ReactNode }) {
    const Ports = ports;
    return (
      <Ports>
        <TurnCardProvider showing={false}>{children}</TurnCardProvider>
      </Ports>
    );
  }
  const { result, rerender } = renderHook(({ available }) => usePeek(available), {
    initialProps: { available: true },
    wrapper: Wrapper,
  });
  const toggles = [false, true, false, true];
  for (const available of toggles) rerender({ available });
  expect(result.current.showing).toBe(false);
  expect({ toggles: toggles.length, reorders: reorders() }).toEqual({ toggles: 4, reorders: 0 });
});
