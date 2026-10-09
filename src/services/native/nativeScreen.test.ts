import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/services/logger';
import { createNativeScreen, DIM_BRIGHTNESS } from '@/services/native/nativeScreen';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The real logger over a ring record (both pure), and the record's events, in order. */
function recorded() {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  const events = () =>
    record.lines().map((line) => {
      const { level, event } = parseRecordLine(line);
      return { level, event };
    });
  return { logger, events };
}

function brightness() {
  return {
    getBrightnessAsync: vi.fn(async () => 0.8),
    setBrightnessAsync: vi.fn(async (_value: number) => undefined),
    restoreSystemBrightnessAsync: vi.fn(async () => undefined),
  };
}

describe('the screen port over expo-brightness (D2 §4.5, R8)', () => {
  it('dims the window to 0.1, never the system setting, and restores the system’s on Android', async () => {
    const module = brightness();
    const { logger } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    expect(DIM_BRIGHTNESS).toBe(0.1);
    screen.dim();
    await flush();
    expect(module.setBrightnessAsync).toHaveBeenCalledExactlyOnceWith(0.1);
    screen.restore();
    await flush();
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  // expo-brightness 57.0.2 BrightnessModule.kt:40-50, :110-129: with no window override, Android's read goes to
  // Settings.System, and under adaptive brightness to the hidden key "screen_auto_brightness_adj". A throw there
  // would reject the dim's first step and the window would never dim. Android's restore needs no value.
  it('never reads the brightness on Android, so a read that fails cannot stop the dim', async () => {
    const module = brightness();
    module.getBrightnessAsync.mockRejectedValue(new Error('SettingNotFoundException'));
    const { logger, events } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.dim();
    await flush();
    expect(module.setBrightnessAsync).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(module.getBrightnessAsync).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });

  it('puts back the brightness it found on iOS, where restoring the system’s does nothing', async () => {
    const module = brightness();
    const { logger } = recorded();
    const screen = createNativeScreen({ logger, os: 'ios', load: async () => module });
    screen.dim();
    await flush();
    screen.restore();
    await flush();
    expect(module.setBrightnessAsync.mock.calls).toEqual([[0.1], [0.8]]);
    expect(module.restoreSystemBrightnessAsync).not.toHaveBeenCalled();
  });

  it('is idempotent: dim twice is one dim, restore twice is one restore, restore first is nothing', async () => {
    const module = brightness();
    const { logger } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.restore();
    screen.dim();
    screen.dim();
    await flush();
    screen.restore();
    screen.restore();
    await flush();
    expect(module.setBrightnessAsync).toHaveBeenCalledTimes(1);
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  it('dims again after a restore: a second wait is a second dim', async () => {
    const module = brightness();
    const { logger } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.dim();
    screen.restore();
    screen.dim();
    await flush();
    expect(module.setBrightnessAsync.mock.calls).toEqual([[0.1], [0.1]]);
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  it('a missing native module is said once and never throws (a guarded port)', async () => {
    const { logger, events } = recorded();
    const screen = createNativeScreen({
      logger,
      os: 'android',
      load: async () => {
        throw new Error("Cannot find native module 'ExpoBrightness'");
      },
    });
    expect(() => {
      screen.dim();
      screen.restore();
      screen.dim();
    }).not.toThrow();
    await flush();
    expect(events()).toEqual([{ level: 'warn', event: 'screen.unavailable' }]);
  });

  it('a failed call does not stop the next one: a restore still runs after a dim that threw', async () => {
    const module = brightness();
    module.setBrightnessAsync.mockRejectedValueOnce(new Error('no activity'));
    const { logger, events } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.dim();
    screen.restore();
    await flush();
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([{ level: 'warn', event: 'screen.unavailable' }]);
  });

  it('runs its calls in order: a restore never lands before the dim it follows', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const module = {
      getBrightnessAsync: async () => 0.8,
      setBrightnessAsync: (value: number) =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push(`set ${value}`);
            resolve();
          };
        }),
      restoreSystemBrightnessAsync: async () => {
        order.push('restore');
      },
    };
    const { logger } = recorded();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.dim();
    screen.restore();
    await flush();
    release();
    await flush();
    expect(order).toEqual(['set 0.1', 'restore']);
  });
});
