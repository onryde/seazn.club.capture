import * as ScreenOrientation from 'expo-screen-orientation';
import type { OrientationLockPort } from '@/services/devicePorts';

/** Landscape means either side: the engine keeps the picture upright (P4). */
export function createNativeOrientationLock(): OrientationLockPort {
  return {
    lock: (target) =>
      ScreenOrientation.lockAsync(
        target === 'portrait'
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE,
      ),
  };
}
