import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/services/logger';
import { createNativePower, type PowerNative } from '@/services/native/nativePower';
import { createRingRecord } from '@/services/sessionRecord';

const quiet = () => createLogger({ record: createRingRecord(), now: () => 0 });
type Native = PowerNative | null;

describe('the battery state (R5)', () => {
  it('reads Unrestricted from native on Android', () => {
    const power = createNativePower({
      native: { powerUnrestricted: () => true },
      os: 'android',
      openSettings: vi.fn(),
      logger: quiet(),
    });
    expect(power.isUnrestricted()).toBe(true);
  });

  // A second call: the operator may change it on the battery page, so every read asks native afresh.
  it('reads native afresh at every call, restricted then allowed', () => {
    let answer = false;
    const power = createNativePower({
      native: { powerUnrestricted: () => answer },
      os: 'android',
      openSettings: vi.fn(),
      logger: quiet(),
    });
    expect(power.isUnrestricted()).toBe(false);
    answer = true;
    expect(power.isUnrestricted()).toBe(true);
  });

  const UNKNOWN: readonly (readonly [string, Native, string])[] = [
    ['iOS', { powerUnrestricted: () => true }, 'ios'],
    ['no native module', null, 'android'],
    [
      'a stale build whose call throws',
      {
        powerUnrestricted: () => {
          throw new Error('no such function');
        },
      },
      'android',
    ],
    ['an answer that is not a boolean', { powerUnrestricted: () => 'yes' }, 'android'],
    ['native unable to read it', { powerUnrestricted: () => null }, 'android'],
  ];
  it.each(UNKNOWN)('is unknown (null) with %s', (_why, native, os) => {
    expect(
      createNativePower({ native, os, openSettings: vi.fn(), logger: quiet() }).isUnrestricted(),
    ).toBeNull();
  });

  it('opens the app’s settings page, and a refused open is recorded, never thrown', async () => {
    const record = createRingRecord();
    const openSettings = vi.fn().mockRejectedValue(new Error('no activity'));
    const power = createNativePower({
      native: null,
      os: 'android',
      openSettings,
      logger: createLogger({ record, now: () => 0 }),
    });
    power.openBatterySettings();
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
    expect(() => power.openBatterySettings()).not.toThrow();
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
    power.openBatterySettings();
    power.openBatterySettings();
    await Promise.resolve();
    await Promise.resolve();
    expect(openSettings).toHaveBeenCalledTimes(2);
    expect(record.lines()).toEqual([]);
  });
});
