import { Accelerometer } from 'expo-sensors';
import type { MotionPort } from '@/services/devicePorts';

/**
 * Android delivers ~5 Hz without HIGH_SAMPLING_RATE_SENSORS, whatever the
 * interval asked for; the 300 ms settle needs only two samples at that rate.
 * iOS reports the opposite signs to Android — harmless, because
 * `classify` works on magnitudes.
 */
export function createNativeMotion(): MotionPort {
  return {
    isAvailable: () => Accelerometer.isAvailableAsync(),
    subscribe: (onSample) => {
      Accelerometer.setUpdateInterval(100);
      const subscription = Accelerometer.addListener(({ x, y, z }) =>
        onSample({ x, y, z }, Date.now()),
      );
      return () => subscription.remove();
    },
  };
}
