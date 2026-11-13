import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBackLabel, useScoringOrigin } from '@/hooks/useScoringOrigin';
import { useBackToHome } from '@/hooks/useStreamLinks';
import en from '@/i18n/en.json';
import { STORE_KEYS } from '@/services/modeStore';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { createFakePorts, TEST_NOW } from '../../test/fakePorts';
import { dayLink } from '../../test/fixtures/dayCode';
import { wrapperFor } from '../../test/renderWithPorts';

// MD-2 Task 5: where Remote Scoring's Back goes and what it is called (S4 design §6), from the stores as they are now.

const OPEN = { fixtureId: 'fx-day', courtName: 'Court 1' };

const code = (mode: 'matchday' | 'scoring'): SavedCode => ({
  mode,
  raw: mode === 'matchday' ? dayLink() : '',
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: mode === 'scoring' ? { fixtureId: 'fx-scanned', label: '' } : null,
});

/** `active` is kept by the store only for a mode whose code is saved, so each mode comes with its code. */
async function mounted(active: 'matchday' | 'scoring') {
  const fakes = createFakePorts({
    kvSeed: {
      [STORE_KEYS.active]: active,
      [STORE_KEYS.code(active)]: encodeSavedCode(code(active)),
    },
  });
  await fakes.ports.modeStore.load();
  const hook = renderHook(
    () => ({ origin: useScoringOrigin(), label: useBackLabel(), back: useBackToHome() }),
    { wrapper: wrapperFor(fakes) },
  );
  return { ...fakes, hook };
}

describe('the pad’s Back', () => {
  it('is Home, named Home, with nothing open', async () => {
    const m = await mounted('matchday');
    expect(m.hook.result.current.origin).toEqual({ back: 'home' });
    expect(m.hook.result.current.label).toBe(en['stream.home']);
  });

  it('follows the store: open from Match Day, it is "Back to Court 1" and goes to the list; cleared, Home again', async () => {
    const m = await mounted('matchday');
    m.navigation.go('scoring');
    await act(() => m.ports.matchDayStore.setOpen(OPEN));
    expect(m.hook.result.current.label).toBe('Back to Court 1');
    act(() => m.hook.result.current.back());
    expect(m.navigation.current()).toBe('matchday');
    await act(() => m.ports.matchDayStore.clearOpen());
    expect(m.hook.result.current.label).toBe(en['stream.home']);
  });

  it('an unnamed court is named by the mode: "Back to Match Day"', async () => {
    const m = await mounted('matchday');
    await act(() => m.ports.matchDayStore.setOpen({ ...OPEN, courtName: '  ' }));
    expect(m.hook.result.current.label).toBe('Back to Match Day');
  });

  it('under another mode a match left open is not Match Day’s: Home', async () => {
    const m = await mounted('scoring');
    m.navigation.go('scoring');
    await act(() => m.ports.matchDayStore.setOpen(OPEN));
    expect(m.hook.result.current.label).toBe(en['stream.home']);
    act(() => m.hook.result.current.back());
    expect(m.navigation.current()).toBe('home');
  });

  it('with a match open under Match Day, Back from another screen is still Home (Settings and the list share the hook)', async () => {
    const m = await mounted('matchday');
    await act(() => m.ports.matchDayStore.setOpen(OPEN));
    m.navigation.go('settings');
    act(() => m.hook.result.current.back());
    expect(m.navigation.current()).toBe('home');
    m.navigation.go('matchday');
    act(() => m.hook.result.current.back());
    expect(m.navigation.current()).toBe('home');
  });

  it('Android Back, while the pad is the route, goes to the list; on Home it is not taken', async () => {
    const m = await mounted('matchday');
    m.navigation.go('scoring');
    await act(() => m.ports.matchDayStore.setOpen(OPEN));
    let handled = false;
    act(() => {
      handled = m.back.press();
    });
    expect(handled).toBe(true);
    expect(m.navigation.current()).toBe('matchday');
    m.navigation.go('home');
    act(() => {
      handled = m.back.press();
    });
    expect(handled).toBe(false);
  });
});
