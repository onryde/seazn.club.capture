import * as ScreenOrientation from 'expo-screen-orientation';
import type { Target } from '@/domain/orientation/orientation';
import type { OrientationLockPort } from '@/services/devicePorts';

/**
 * Every target has a platform lock, so a new target is a type error here rather than a silent landscape.
 * `free` is the platform's own default: the screen follows the phone (spec §7, Home and Settings). Landscape
 * means either side: the engine keeps the picture upright (P4).
 */
const PLATFORM_LOCK: Readonly<Record<Target, ScreenOrientation.OrientationLock>> = {
  free: ScreenOrientation.OrientationLock.DEFAULT,
  portrait: ScreenOrientation.OrientationLock.PORTRAIT_UP,
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
};

export function createNativeOrientationLock(): OrientationLockPort {
  return {
    lock: (target) => ScreenOrientation.lockAsync(PLATFORM_LOCK[target]),
  };
}
