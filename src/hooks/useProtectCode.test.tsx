import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { useProtectCode } from '@/hooks/useProtectCode';
import { STORE_KEYS } from '@/services/modeStore';
import { SCRUBBED } from '@/services/scrub';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { FIXTURE_TOKEN } from '../../test/fixtures/wire';
import { wrapperFor } from '../../test/renderWithPorts';

const FREE_TEXT = 'Connection refused (errno 111)';

async function withSavedCode(saved = true): Promise<FakePorts> {
  const kvSeed: Record<string, string> = saved
    ? {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(savedStreamCode()),
      }
    : {};
  const fakes = createFakePorts({ kvSeed });
  renderHook(() => useProtectCode(), { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  return fakes;
}

const said = (fakes: FakePorts, event: string) =>
  readRecord(fakes.record)
    .filter((entry) => entry.event === event)
    .map((entry) => entry.fields);

/**
 * CD6 as the amendment rewrites it: the token is in hand from the scan to the
 * unpair, not only while the viewfinder shows. N7 (Task 10, moved here): free
 * text is kept, minus the token, while a code is held, and masked whole once
 * it is forgotten.
 */
describe('useProtectCode (CD6, N7)', () => {
  it('masks the saved code’s token wherever a line names it', async () => {
    const fakes = await withSavedCode();
    fakes.ports.logger.warn('probe', { problem: FIXTURE_TOKEN });
    fakes.ports.logger.warn('probe', { message: `${FREE_TEXT} for ${FIXTURE_TOKEN}` });
    expect(said(fakes, 'probe')).toEqual([
      { problem: SCRUBBED },
      { message: `${FREE_TEXT} for ${SCRUBBED}` },
    ]);
  });

  it('keeps free text while the code is saved, and masks it whole once it is forgotten', async () => {
    const fakes = await withSavedCode();
    fakes.ports.logger.warn('held', { message: FREE_TEXT });
    const store = fakes.ports.modeStore.getSnapshot();
    const saved = store.status === 'ready' ? store.saved.codes.stream : undefined;
    if (saved === undefined) throw new Error('the seeded code did not load');
    await act(() => fakes.ports.modeStore.forget(saved));
    fakes.ports.logger.warn('forgotten', { message: FREE_TEXT });
    fakes.ports.logger.warn('forgotten', { problem: FIXTURE_TOKEN });
    expect(said(fakes, 'held')).toEqual([{ message: FREE_TEXT }]);
    // Released, yet the token stays masked: protection only ever adds.
    expect(said(fakes, 'forgotten')).toEqual([{ message: SCRUBBED }, { problem: SCRUBBED }]);
  });

  it('holds nothing with no code saved: free text is masked whole', async () => {
    const fakes = await withSavedCode(false);
    fakes.ports.logger.warn('nothing', { message: FREE_TEXT });
    expect(said(fakes, 'nothing')).toEqual([{ message: SCRUBBED }]);
  });
});
