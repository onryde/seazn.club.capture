import { describe, expect, it, vi } from 'vitest';
import { holdScreenOn, type KeepAwakeModule } from '@/hooks/keepAwake';
import type { Logger } from '@/services/logger';

const quietLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  protect: vi.fn(),
  protectLink: vi.fn(),
  release: vi.fn(),
});

/** The module, loaded only when the test says: a phone slow to load it, or a screen left at once. */
function slowModule() {
  const module: KeepAwakeModule = {
    activateKeepAwakeAsync: vi.fn(async () => undefined),
    deactivateKeepAwake: vi.fn(async () => undefined),
  };
  let loaded: (value: KeepAwakeModule) => void = () => undefined;
  const ready = new Promise<KeepAwakeModule>((resolve) => {
    loaded = resolve;
  });
  return { module, load: () => ready, loaded: () => loaded(module) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('holdScreenOn', () => {
  it('never takes a hold let go before the module loaded: a screen left at once is left to dim', async () => {
    const slow = slowModule();
    const release = holdScreenOn('seazn-capture-pad', 'scoring', quietLogger(), slow.load);
    release();
    slow.loaded();
    await flush();
    expect(slow.module.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(slow.module.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith('seazn-capture-pad');
  });

  it('takes the hold once the module loads, and lets it go on release', async () => {
    const slow = slowModule();
    const release = holdScreenOn('seazn-capture-session', 'stream', quietLogger(), slow.load);
    slow.loaded();
    await flush();
    expect(slow.module.activateKeepAwakeAsync).toHaveBeenCalledExactlyOnceWith(
      'seazn-capture-session',
    );
    release();
    await flush();
    expect(slow.module.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith(
      'seazn-capture-session',
    );
  });

  it('warns once, naming the hold, when the module cannot load', async () => {
    const logger = quietLogger();
    holdScreenOn('seazn-capture-pad', 'scoring', logger, () => Promise.reject(new Error('none')));
    await flush();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('keep-awake.refused', {
      action: 'hold',
      mode: 'scoring',
    });
  });
});
