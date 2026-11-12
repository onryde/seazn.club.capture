import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { dayLink } from '../../test/fixtures/dayCode';
import { useScoringFixture } from '@/hooks/useScoringFixture';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

/** The day code that makes Match Day a mode that can be active (the store keeps `active` only for a saved code). */
const DAY_CODE: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: new Date('2026-11-12T09:00:00Z'),
  expiresAt: null,
  stream: null,
  scoring: null,
};
const inMatchDay = {
  [STORE_KEYS.active]: 'matchday',
  [STORE_KEYS.code('matchday')]: encodeSavedCode(DAY_CODE),
};

const match = (fixtureId: string): SavedCode => ({
  mode: 'scoring',
  raw: '',
  slot: null,
  savedAt: new Date('2026-11-02T09:00:00Z'),
  expiresAt: null,
  stream: null,
  scoring: { fixtureId, label: `Label of ${fixtureId}` },
});

/** The store forgets the code object it holds, not a look-alike (identity, as the app's own forgets are). */
async function forgetSaved(store: Awaited<ReturnType<typeof mounted>>['ports']['modeStore']) {
  const snapshot = store.getSnapshot();
  const held = snapshot.status === 'ready' ? snapshot.saved.codes.scoring : undefined;
  if (held === undefined) throw new Error('nothing saved to forget');
  await store.forget(held);
}

async function mounted(seed: Record<string, string> = {}) {
  const fakes = createFakePorts({ kvSeed: seed });
  await fakes.ports.modeStore.load();
  const hook = renderHook(() => useScoringFixture(), { wrapper: wrapperFor(fakes) });
  return { ...fakes, hook };
}

/**
 * The match the Remote Scoring route is showing (plan S2-1 Task 10): the saved code's, held once seen, so a link that
 * dies with nothing queued (the code is forgotten under the pad) leaves the pad on its bad-link card instead of
 * redirecting Home before the card has been read.
 */
describe('useScoringFixture', () => {
  it('is the saved match', async () => {
    const { hook } = await mounted({
      [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-4')),
    });
    expect(hook.result.current).toBe('fx-4');
  });

  it('is nothing when no match is saved, or the saved code is Live Stream’s', async () => {
    expect((await mounted()).hook.result.current).toBeNull();
    const { hook } = await mounted({
      [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
    });
    expect(hook.result.current).toBeNull();
  });

  it('keeps the match it has seen after the code is forgotten under it', async () => {
    const home = await mounted({ [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-4')) });
    await act(() => forgetSaved(home.ports.modeStore));
    expect(home.hook.result.current).toBe('fx-4');
  });

  it('follows a new match saved over it', async () => {
    const home = await mounted({ [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-4')) });
    await act(async () => {
      await home.ports.modeStore.open(match('fx-9'));
    });
    expect(home.hook.result.current).toBe('fx-9');
  });

  it('a screen mounted after the forget finds nothing: only a seen match is held', async () => {
    const home = await mounted({ [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-4')) });
    await act(() => forgetSaved(home.ports.modeStore));
    const later = renderHook(() => useScoringFixture(), { wrapper: wrapperFor(home) });
    expect(later.result.current).toBeNull();
  });
});

describe('useScoringFixture, a match replaced while the screen lives', () => {
  it('follows the new match, and holds that one, not the first, after its code is forgotten', async () => {
    const { hook, ports } = await mounted({
      [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-4')),
    });
    expect(hook.result.current).toBe('fx-4');
    await act(() => ports.modeStore.open(match('fx-5')));
    expect(hook.result.current).toBe('fx-5');
    await act(() => forgetSaved(ports.modeStore));
    expect(hook.result.current).toBe('fx-5');
  });

  it('under Match Day it is the match Match Day opened, never a scoring code saved before it', async () => {
    const { hook, ports } = await mounted({
      ...inMatchDay,
      [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-scanned')),
    });
    expect(hook.result.current).toBeNull();
    await act(() => ports.matchDayStore.setOpen({ fixtureId: 'fx-day', courtName: 'Court 1' }));
    expect(hook.result.current).toBe('fx-day');
  });

  it('with another mode active a match Match Day left open is not the pad’s', async () => {
    const { hook, ports } = await mounted({
      [STORE_KEYS.active]: 'scoring',
      [STORE_KEYS.code('scoring')]: encodeSavedCode(match('fx-scanned')),
    });
    await act(() => ports.matchDayStore.setOpen({ fixtureId: 'fx-day', courtName: 'Court 1' }));
    expect(hook.result.current).toBe('fx-scanned');
  });

  it('keeps the Match Day match it has seen after the list clears it (Back)', async () => {
    const { hook, ports } = await mounted(inMatchDay);
    await act(() => ports.matchDayStore.setOpen({ fixtureId: 'fx-day', courtName: 'Court 1' }));
    await act(() => ports.matchDayStore.clearOpen());
    expect(hook.result.current).toBe('fx-day');
  });
});
