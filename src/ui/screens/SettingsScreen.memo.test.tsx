import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(resetCalls);

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
    const overlay = () => screen.getByRole('switch', { name: 'Score preview' });
    resetCalls();
    fireEvent.click(overlay());
    await waitFor(() => expect(overlay().getAttribute('aria-checked')).toBe('false'));
    // It counts at all: the switch did re-render Settings.
    expect(calls.settings).toBeGreaterThan(0);
    expect(calls.diagnostics).toBe(0);
  });
});
