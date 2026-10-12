import type { PowerMode, PowerPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/**
 * The one member of the capture engine's native module this port reads (`CaptureEngineNative.powerMode`), written
 * here because services may not import the engine (eslint boundaries); the module satisfies it structurally.
 */
export type PowerNative = { powerMode(): unknown };

/** The words native sends (`PowerMode.kt`); anything else, the old boolean included, reads as unknown. */
const MODES: readonly PowerMode[] = ['unrestricted', 'optimized', 'restricted'];

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

/** R5 (P9): the battery mode from native, App info by React Native's own call. Never throws. */
export function createNativePower({ native, os, openSettings, logger }: Deps): PowerPort {
  const refused = () => logger.warn('power.settings-failed');
  return {
    mode: () => {
      if (os !== 'android') return null;
      try {
        // No module answers undefined, which is no mode: unknown, as a stale build's throw is.
        const answer = native?.powerMode();
        return MODES.find((mode) => mode === answer) ?? null;
      } catch {
        return null;
      }
    },
    openAppSettings: () => {
      try {
        openSettings().catch(refused);
      } catch {
        refused();
      }
    },
  };
}
