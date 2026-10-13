import { describe, expect, it, vi } from 'vitest';
import type { PowerMode } from '@/services/devicePorts';
import { createLogger } from '@/services/logger';
import { createNativePower, type PowerNative } from '@/services/native/nativePower';
import { createRingRecord } from '@/services/sessionRecord';

const quiet = () => createLogger({ record: createRingRecord(), now: () => 0 });
type Native = PowerNative | null;

describe('the battery mode (R5; M5 of the Batch 5 review)', () => {
  // The three words native sends, as Android's App battery usage page names them.
  const MODES: readonly PowerMode[] = ['unrestricted', 'optimized', 'restricted'];
  it.each(MODES)('reads %s from native on Android', (word) => {
    const power = createNativePower({
      native: { powerMode: () => word },
      os: 'android',
      openSettings: vi.fn(),
      logger: quiet(),
    });
    expect(power.mode()).toBe(word);
  });

  // A second call: the operator may change it in App info, so every read asks native afresh.
  it('reads native afresh at every call, optimized then unrestricted', () => {
    let answer = 'optimized';
    const power = createNativePower({
      native: { powerMode: () => answer },
      os: 'android',
      openSettings: vi.fn(),
      logger: quiet(),
    });
    expect(power.mode()).toBe('optimized');
    answer = 'unrestricted';
    expect(power.mode()).toBe('unrestricted');
  });

  const UNKNOWN: readonly (readonly [string, Native, string])[] = [
    ['iOS', { powerMode: () => 'unrestricted' }, 'ios'],
    ['no native module', null, 'android'],
    [
      'a stale build whose call throws',
      {
        powerMode: () => {
          throw new Error('no such function');
        },
      },
      'android',
    ],
    ['the old boolean answer', { powerMode: () => true }, 'android'],
    ['a word it does not know', { powerMode: () => 'allowed' }, 'android'],
    ['native unable to read it', { powerMode: () => null }, 'android'],
  ];
  it.each(UNKNOWN)('is unknown (null) with %s', (_why, native, os) => {
    expect(
      createNativePower({ native, os, openSettings: vi.fn(), logger: quiet() }).mode(),
    ).toBeNull();
  });

  it('opens the app’s App info page, and a refused open is recorded, never thrown', async () => {
    const record = createRingRecord();
    const openSettings = vi.fn().mockRejectedValue(new Error('no activity'));
    const power = createNativePower({
      native: null,
      os: 'android',
      openSettings,
      logger: createLogger({ record, now: () => 0 }),
    });
    power.openAppSettings();
    await Promise.resolve();
    await Promise.resolve();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(record.lines().some((line) => line.includes('"kind":"power.settings-failed"'))).toBe(
      true,
    );
  });

  it('an open that throws at once is recorded too, never thrown to the button', () => {
    const record = createRingRecord();
    const power = createNativePower({
      native: null,
      os: 'android',
      openSettings: () => {
        throw new Error('no activity');
      },
      logger: createLogger({ record, now: () => 0 }),
    });
    expect(() => power.openAppSettings()).not.toThrow();
    expect(record.lines().some((line) => line.includes('"kind":"power.settings-failed"'))).toBe(
      true,
    );
  });

  it('an open that goes through records nothing', async () => {
    const record = createRingRecord();
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const power = createNativePower({
      native: null,
      os: 'android',
      openSettings,
      logger: createLogger({ record, now: () => 0 }),
    });
    power.openAppSettings();
    power.openAppSettings();
    await Promise.resolve();
    await Promise.resolve();
    expect(openSettings).toHaveBeenCalledTimes(2);
    expect(record.lines()).toEqual([]);
  });
});
