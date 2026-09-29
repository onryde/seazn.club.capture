import { AppState, type AppStateStatus } from 'react-native';
import type { ForegroundPort } from '@/services/devicePorts';

function onAppState(listener: (state: AppStateStatus) => void): () => void {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
}

/**
 * Fires on every return to the foreground, where the reopen rules run again
 * (spec §4), and on every departure from it, which is how a scan knows the
 * phone's scanner took the app away (R36).
 */
export function createNativeForeground(): ForegroundPort {
  return {
    subscribe: (onForeground) =>
      onAppState((state) => {
        if (state === 'active') onForeground();
      }),
    subscribeBackground: (onBackground) =>
      onAppState((state) => {
        if (state !== 'active') onBackground();
      }),
  };
}
