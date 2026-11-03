import type { Logger } from '@/services/logger';

/** The two calls the hold makes on `expo-keep-awake`. */
export type KeepAwakeModule = {
  activateKeepAwakeAsync(tag: string): Promise<void>;
  deactivateKeepAwake(tag: string): Promise<void>;
};

const loadKeepAwake = (): Promise<KeepAwakeModule> => import('expo-keep-awake');

/**
 * Holds the screen on under `tag` until the returned release runs: Live Stream's session (`useKeepAwake`) and the
 * scoring pad (`useScreenAwake`), each under its own tag so neither lets go of the other's hold. It defeats the idle
 * timer only, never the brightness.
 *
 * The module is loaded dynamically, so a missing native module degrades to "the screen may dim" rather than taking the
 * app down at import; a hold or a release the phone refuses is a warning in the record (`mode` says whose), never
 * silent (AGENTS §13, recurring failure 3). A release that runs before the module has loaded cancels the hold. `load`
 * is the import, passed in by `keepAwake.test.ts` only: vitest hands a second import() of a mocked module made while
 * the first is in flight the real module, so that order cannot be tested through the mock.
 */
export function holdScreenOn(
  tag: string,
  mode: 'stream' | 'scoring',
  logger: Logger,
  load: () => Promise<KeepAwakeModule> = loadKeepAwake,
): () => void {
  let released = false;
  void load()
    .then((module) => (released ? undefined : module.activateKeepAwakeAsync(tag)))
    .catch(() => logger.warn('keep-awake.refused', { action: 'hold', mode }));
  return () => {
    released = true;
    void load()
      .then((module) => module.deactivateKeepAwake(tag))
      .catch(() => logger.warn('keep-awake.refused', { action: 'release', mode }));
  };
}
