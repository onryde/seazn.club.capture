import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module's own enum (expo-screen-orientation/build/ScreenOrientation.types), read from node_modules:
// DEFAULT 0, PORTRAIT_UP 3, LANDSCAPE 5. The mock's numbers are distinct, so a wrong member cannot pass.
const ScreenOrientation = vi.hoisted(() => ({
  lockAsync: vi.fn(),
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3, LANDSCAPE: 5 },
}));
vi.mock('expo-screen-orientation', () => ScreenOrientation);

import type { Target } from '@/domain/orientation/orientation';
import { createNativeOrientationLock } from '@/services/native/nativeOrientationLock';

describe('the native orientation lock port (spec §7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ScreenOrientation.lockAsync.mockResolvedValue(undefined);
  });

  it.each<[Target, number]>([
    // `free` is the platform's own default: the screen follows the phone (Home and Settings).
    ['free', 0],
    ['portrait', 3],
    ['landscape', 5],
  ])('locks %s as the platform lock %i, once', async (target, platformLock) => {
    await createNativeOrientationLock().lock(target);
    expect(ScreenOrientation.lockAsync.mock.calls).toEqual([[platformLock]]);
  });

  it('rejects when the platform refuses, so the gate can retry (D26)', async () => {
    ScreenOrientation.lockAsync.mockRejectedValue(new Error('no activity'));
    await expect(createNativeOrientationLock().lock('free')).rejects.toThrow('no activity');
  });
});
