import { act, render, type RenderResult } from '@testing-library/react';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { savedStreamCode } from './fixtures/savedStream';
import { wrapperFor } from './renderWithPorts';

type Options = Parameters<typeof createFakePorts>[0];
type Setup = {
  readonly saved?: SavedCode;
  /** Runs before the first render: an engine already live, an overlay set to crash. */
  readonly prepare?: (fakes: FakePorts) => void;
};

/** The viewfinder as the operator reaches it: a saved stream code, the store loaded, on /stream. */
export async function renderViewfinder(
  options: Options = {},
  { saved = savedStreamCode(), prepare }: Setup = {},
): Promise<RenderResult & FakePorts> {
  const kvSeed = {
    [STORE_KEYS.active]: 'stream',
    [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
    ...options.kvSeed,
  };
  const fakes = createFakePorts({ ...options, kvSeed });
  prepare?.(fakes);
  const rendered: RenderResult = render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  return { ...rendered, ...fakes };
}
