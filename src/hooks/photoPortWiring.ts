import type { CaptureEngineNative } from '@/engine/nativeModule';
import { createPhotoPort, type PhotoPort } from '@/services/photoPort';

/**
 * Spec §8: the production photo port over the native module `createNativePorts` loaded once. No module (iOS in
 * S1, web) is a port that says failed. The call is a closure over the module, so native's `this` stays bound,
 * and a stale build whose module has no `takePhoto` throws inside the port, which says failed. Pure, so the
 * wiring is tested, like `chooseEngine` and `chooseCodePort`.
 */
export function photoPortFor(native: Pick<CaptureEngineNative, 'takePhoto'> | null): PhotoPort {
  return createPhotoPort(native === null ? null : () => native.takePhoto());
}
