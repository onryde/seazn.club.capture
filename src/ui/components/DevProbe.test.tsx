import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

const RUN = 'Run engine contract';
const settlesAtOnce = () =>
  ({ settled: vi.fn(() => Promise.resolve()) }) as unknown as NativeCaptureEngine;
const flush = () => act(() => vi.advanceTimersByTimeAsync(10));

/** CD24: Home offers the probe beside the paste field, in a development build with native wired. */
describe('the device probe on Home', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs from Home and reads its result', async () => {
    renderWithPorts(<HomeScreen />, { devEngine: null, nativeEngine: settlesAtOnce() });
    expect(screen.getByText('idle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: RUN }));
    await flush();
    expect(screen.getByText('passed')).toBeTruthy();
  });

  it('keeps a failure until it is pressed away (PV35)', async () => {
    const view = renderWithPorts(<HomeScreen />, {
      devEngine: null,
      nativeEngine: settlesAtOnce(),
    });
    act(() => view.engine.setPermissions('hold'));
    fireEvent.click(screen.getByRole('button', { name: RUN }));
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    act(() => view.engine.send({ kind: 'unpair' }));
    fireEvent.click(screen.getByRole('button', { name: 'failed' }));
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('is not on Home with the fake wired, or in a release build', () => {
    const fake = renderWithPorts(<HomeScreen />, { nativeEngine: settlesAtOnce() });
    expect(screen.queryByRole('button', { name: RUN })).toBeNull();
    fake.unmount();
    renderWithPorts(<HomeScreen />, {
      devEngine: null,
      nativeEngine: settlesAtOnce(),
      devTools: false,
    });
    expect(screen.queryByRole('button', { name: RUN })).toBeNull();
  });

  it('names the probe in the operator’s language', () => {
    renderWithPorts(<HomeScreen />, {
      devEngine: null,
      nativeEngine: settlesAtOnce(),
      deviceLanguages: ['fr'],
    });
    expect(screen.getByRole('button', { name: 'Lancer le contrat du moteur' })).toBeTruthy();
  });
});
