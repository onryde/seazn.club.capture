import { AppState } from 'react-native';
import type { ForegroundPort } from '@/services/devicePorts';

/** Fires on every return to the foreground, where the reopen rules run again (spec §4). */
export function createNativeForeground(): ForegroundPort {
  return {
    subscribe: (onForeground) => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') onForeground();
      });
      return () => subscription.remove();
    },
  };
}
