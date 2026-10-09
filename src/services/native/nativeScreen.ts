import type { ScreenPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/** R8 (spec §4.5, _rec_): the window's brightness while dimmed. */
export const DIM_BRIGHTNESS = 0.1;

/** The three calls this port makes. */
type Brightness = {
  getBrightnessAsync(): Promise<number>;
  setBrightnessAsync(value: number): Promise<void>;
  restoreSystemBrightnessAsync(): Promise<void>;
};

/**
 * expo-brightness, loaded on first use: a binary without its native half throws on import, and a static import would
 * take the app down at boot instead of only leaving the screen bright (as `useKeepAwake` does). Calls run one at a
 * time, in order, so a restore never lands before the dim it follows; a call that fails is said once and never stops
 * the next. On Android, restore hands the window back to the system's brightness and needs no value, so the port never
 * reads one there: with no window override the module's read goes to the system settings (expo-brightness 57.0.2
 * `BrightnessModule.kt:40-50, :110-129`), and a throw there would stop the dim. On iOS that restore does nothing, so
 * the brightness found before dimming is put back.
 */
export function createNativeScreen(deps: {
  readonly logger: Logger;
  readonly os: string;
  readonly load?: () => Promise<Brightness>;
}): ScreenPort {
  const load = deps.load ?? (() => import('expo-brightness'));
  const android = deps.os === 'android';
  let dimmed = false;
  let found: number | null = null;
  let warned = false;
  let queue: Promise<void> = Promise.resolve();
  const run = (step: (module: Brightness) => Promise<void>) => {
    queue = queue
      .then(load)
      .then(step)
      .catch(() => {
        if (warned) return;
        warned = true;
        deps.logger.warn('screen.unavailable');
      });
  };
  return {
    dim: () => {
      if (dimmed) return;
      dimmed = true;
      run(async (module) => {
        if (!android) found = await module.getBrightnessAsync();
        await module.setBrightnessAsync(DIM_BRIGHTNESS);
      });
    },
    restore: () => {
      if (!dimmed) return;
      dimmed = false;
      run((module) =>
        android ? module.restoreSystemBrightnessAsync() : module.setBrightnessAsync(found ?? 1),
      );
    },
  };
}
