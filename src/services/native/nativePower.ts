import type { PowerPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/**
 * The one member of the capture engine's native module this port reads (`CaptureEngineNative.powerUnrestricted`),
 * written here because services may not import the engine (eslint boundaries); the module satisfies it structurally.
 */
export type PowerNative = { powerUnrestricted(): unknown };

type Deps = {
  readonly native: PowerNative | null;
  readonly os: string;
  /**
   * React Native's `Linking.openSettings()`: on Android, `ACTION_APPLICATION_DETAILS_SETTINGS` for this package, which
   * rejects when there is no activity to start it from (react-native 0.86.3 `IntentModule.kt:169-185`; P9).
   */
  readonly openSettings: () => Promise<void>;
  readonly logger: Logger;
};

/** R5 (P9): the battery state from native, the page by React Native's own call. Never throws. */
export function createNativePower({ native, os, openSettings, logger }: Deps): PowerPort {
  const refused = () => logger.warn('power.settings-failed');
  return {
    isUnrestricted: () => {
      if (os !== 'android') return null;
      try {
        // No module answers undefined, which is not a boolean: unknown, as a stale build's throw is.
        const answer = native?.powerUnrestricted();
        return typeof answer === 'boolean' ? answer : null;
      } catch {
        return null;
      }
    },
    openBatterySettings: () => {
      try {
        openSettings().catch(refused);
      } catch {
        refused();
      }
    },
  };
}
