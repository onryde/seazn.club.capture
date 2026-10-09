import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

/**
 * Renders of the two owners that matter, counted where each calls its hook: `useStreamSettings` runs once
 * per SettingsScreen render, `useDiagnostics` once per DiagnosticsCard render.
 */
const calls = vi.hoisted(() => ({ settings: 0, diagnostics: 0 }));

vi.mock('@/hooks/useStreamSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useStreamSettings')>();
  return {
    ...actual,
    useStreamSettings: () => {
      calls.settings += 1;
      return actual.useStreamSettings();
    },
  };
});

vi.mock('@/hooks/useDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useDiagnostics')>();
  return {
    ...actual,
    useDiagnostics: () => {
      calls.diagnostics += 1;
      return actual.useDiagnostics();
    },
  };
});

const resetCalls = () => {
  calls.settings = 0;
  calls.diagnostics = 0;
};

const bitrateValue = () =>
  screen
    .getAllByTestId('diag-row')
    .map((row) => [...row.children].map((cell) => cell.textContent))
    .find((cells) => cells[1] === 'Bitrate')?.[2];

/**
 * AGENTS §8 and D32: Diagnostics ticks at 1 Hz and Settings must not. The card owns its own subscription,
 * so a report re-renders the card and never the switches; and the card is memoised, so a switch
 * re-renders Settings and never the card.
 */
describe('Settings re-renders only what changed (spec §6)', () => {
  // The fake engine reports on a real 1 Hz setInterval (FakeCaptureEngine) and the card's clock ticks on another
  // (useClockTick). Either firing between resetCalls and an assertion re-renders the card, which flaked the test that
  // expects it NOT to. Only the intervals are faked (before the render creates them), so nothing ticks unless a test
  // advances it, and waitFor, which runs on setTimeout, still works.
  beforeEach(() => {
    resetCalls();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => vi.useRealTimers());

  it('the 1 Hz tick itself (the engine’s report and the clock) re-renders the card and not Settings', () => {
    renderWithPorts(<SettingsScreen />);
    resetCalls();
    act(() => vi.advanceTimersByTime(1000));
    expect(calls.diagnostics).toBeGreaterThan(0); // the tick is the faked one: it reaches the card
    expect(calls.settings).toBe(0);
  });

  it('a 1 Hz report re-renders the Diagnostics card and not Settings', () => {
    const view = renderWithPorts(<SettingsScreen />);
    act(() => view.engine.scene('live'));
    resetCalls();
    act(() => view.engine.patch({ bitrateKbps: 2950 }));
    expect(bitrateValue()).toBe('2950 kbps');
    expect(calls.diagnostics).toBeGreaterThan(0);
    expect(calls.settings).toBe(0);
  });

  it('a switch re-renders Settings and not the Diagnostics card', async () => {
    renderWithPorts(<SettingsScreen />);
    const automatic = () => screen.getByRole('switch', { name: 'Start and stop automatically' });
    resetCalls();
    fireEvent.click(automatic());
    await waitFor(() => expect(automatic().getAttribute('aria-checked')).toBe('false'));
    // It counts at all: the switch did re-render Settings.
    expect(calls.settings).toBeGreaterThan(0);
    expect(calls.diagnostics).toBe(0);
  });
});
