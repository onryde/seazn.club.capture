import { act, render, type RenderResult } from '@testing-library/react';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { savedStreamCode } from './fixtures/savedStream';
import { pairCode } from './pairCode';
import { quietDevice } from './quietDevice';
import { wrapperFor } from './renderWithPorts';

type Options = Parameters<typeof createFakePorts>[0];
type Setup = {
  readonly saved?: SavedCode;
  /**
   * The engine as the visit finds it: paired with the saved code by the scan
   * that led here (the default), or idle. A visit never pairs, so a test of the
   * paired viewfinder says so.
   */
  readonly engine?: 'paired' | 'idle';
  /** Runs before the first render: an engine already live, an overlay set to crash. */
  readonly prepare?: (fakes: FakePorts) => void;
  /** RTL's StrictMode at the root, so each effect runs twice on mount. */
  readonly strict?: boolean;
  /**
   * The phone has nothing to warn about: on the charger, and one that survives the background, so no caption can take
   * the strip's one message line from a ROUTINE status line (Live, Waiting for Go live). Left out, it is the fake's own
   * phone (uncharged), which is what a caption test and every URGENT status line, which beats any caption, want
   * (see `quietDevice.ts`).
   */
  readonly quiet?: boolean;
};

/** The viewfinder as the operator reaches it: a saved stream code, the store loaded, on /stream. */
export async function renderViewfinder(
  options: Options = {},
  {
    saved = savedStreamCode(),
    engine = 'paired',
    prepare,
    strict = false,
    quiet = false,
  }: Setup = {},
): Promise<RenderResult & FakePorts> {
  const kvSeed = {
    [STORE_KEYS.active]: 'stream',
    [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
    ...options.kvSeed,
  };
  const fakes = createFakePorts({ ...options, kvSeed });
  if (engine === 'paired') pairCode(fakes.engine, saved);
  if (quiet) quietDevice(fakes.engine);
  prepare?.(fakes);
  const rendered: RenderResult = render(<StreamScreen />, {
    wrapper: wrapperFor(fakes),
    reactStrictMode: strict,
  });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  return { ...rendered, ...fakes };
}
