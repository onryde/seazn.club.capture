import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamPlaceholderScreen } from '@/ui/screens/StreamPlaceholderScreen';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The leave rules are useStreamLeave's, and their tests are in its hook test.

const code: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 2,
  savedAt: TEST_NOW,
  expiresAt: new Date(TEST_NOW.getTime() + 3600_000),
  venueTz: null,
};
const inStream = {
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(code),
};

async function renderStream(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<StreamPlaceholderScreen />, { kvSeed: inStream, ...options });
  await act(() => view.ports.modeStore.load());
  view.navigation.go('stream');
  return view;
}

describe('Live Stream placeholder', () => {
  it('shows the slot from the scanned code', async () => {
    await renderStream();
    expect(screen.getByText('Slot 2. The camera arrives in the next build.')).toBeTruthy();
  });

  it('drives the fake engine from the development controls', async () => {
    await renderStream();
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.getByText('Engine: live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Engine: stopped')).toBeTruthy();
  });

  it('has no engine controls outside development builds', async () => {
    await renderStream({ devTools: false, devEngine: null });
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });
});

describe('Live Stream placeholder: the four questions', () => {
  it('says there is no slot when the engine holds a session with nothing saved', async () => {
    // Reachable: the reopen gate sends an armed or live engine here whatever is saved.
    await renderStream({ kvSeed: {} });
    expect(screen.getByText('Slot –. The camera arrives in the next build.')).toBeTruthy();
  });

  it('speaks the operator’s language', async () => {
    await renderStream({ deviceLanguages: ['fr'] });
    expect(
      screen.getByText('Emplacement 2. La caméra arrive dans la prochaine version.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accueil' })).toBeTruthy();
  });

  // Production sets both from __DEV__; each guard is pinned alone so neither hides the other.
  it.each([
    ['development tools are off', { devTools: false }],
    ['there is no fake engine', { devEngine: null }],
  ])('has no engine controls when %s', async (_, options) => {
    await renderStream(options);
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });
});
