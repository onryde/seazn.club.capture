import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts } from '../../../test/fakePorts';
import { savedCourtCode, savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw } from '../../../test/fixtures/wire';
import { pairCode } from '../../../test/pairCode';
import { wrapperFor } from '../../../test/renderWithPorts';

// Court stream (spec 2026-11-14 §6.5, RP4, O5, O12): Home's Continue card names the court, and a phone that holds the
// court has no Forget on its card: the only way off a court is Exit on the waiting screen, which asks first.
async function homeWith(saved: SavedCode, pairWith?: SavedCode) {
  const fakes = createFakePorts({
    kvSeed: { [STORE_KEYS.code('stream')]: encodeSavedCode(saved) },
  });
  if (pairWith !== undefined) pairCode(fakes.engine, pairWith);
  render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  return fakes;
}
const forget = () => screen.queryByRole('button', { name: 'Forget' });
const OTHER_COURT = (() => {
  const base = savedCourtCode('Court 5');
  return {
    ...base,
    slot: 2,
    raw: captureRaw({ slot: 2, tok: 'tok-other-000000000000' }),
  } satisfies SavedCode;
})();

describe('Home’s Continue card on a court code', () => {
  it('names the court and offers no Forget while the phone is paired to it', async () => {
    const saved = savedCourtCode();
    await homeWith(saved, saved);
    expect(screen.getByText('Court 2 · Live Stream')).toBeTruthy();
    expect(screen.getByText('Waiting for Go live')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(forget()).toBeNull();
  });

  // The engine's own court wins over the saved fields when it holds this code: native's is the pairing's.
  it('names the court the engine holds, when it differs from the saved one', async () => {
    const saved = savedCourtCode('Court 2');
    const fakes = await homeWith(saved, saved);
    act(() => fakes.engine.setPairing({ court: 'Court 3' }));
    expect(screen.getByText('Court 3 · Live Stream')).toBeTruthy();
    expect(screen.queryByText('Court 2 · Live Stream')).toBeNull();
  });

  it('keeps Forget on a fixture code paired the same way (the twin)', async () => {
    const saved = savedStreamCode();
    await homeWith(saved, saved);
    expect(screen.getByText(/^Paired ·/)).toBeTruthy();
    expect(forget()).not.toBeNull();
  });

  // After an interruption: a cold start, the engine Idle, the saved waiting fields name the court.
  it('names the court from the saved code after a cold start, and keeps Forget on a code nothing holds', async () => {
    await homeWith(savedCourtCode());
    expect(screen.getByText('Court 2 · Live Stream')).toBeTruthy();
    expect(screen.getByText(/^Slot 1/)).toBeTruthy();
    expect(forget()).not.toBeNull();
  });

  it('never titles a fixture code’s card with another code’s court', async () => {
    await homeWith(savedStreamCode(), OTHER_COURT);
    expect(screen.getByText('Continue Live Stream')).toBeTruthy();
    expect(screen.queryByText(/Court 5/)).toBeNull();
    expect(forget()).not.toBeNull();
  });
});
