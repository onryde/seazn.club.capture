import type { Gravity, Target } from '@/domain/orientation/orientation';

/**
 * Every device capability the shell uses, as a port (spec §9). Native
 * implementations live in `services/native/` and are wired only by
 * `hooks/nativePorts.ts`; tests use the fakes in `test/fakePorts.ts`. That is
 * what lets screens render on react-native-web with no native module.
 */
export interface MotionPort {
  isAvailable(): Promise<boolean>;
  /** Gravity in g. Sign conventions differ by platform; consumers use magnitudes. */
  subscribe(onSample: (g: Gravity, atMs: number) => void): () => void;
}

export interface OrientationLockPort {
  lock(target: Target): Promise<void>;
}

/** `onBack` returns true when it handled the press, as BackHandler expects. */
export interface BackPort {
  subscribe(onBack: () => boolean): () => void;
}

/** The app coming back to the foreground, and leaving it. */
export interface ForegroundPort {
  subscribe(onForeground: () => void): () => void;
  /** Fires when the app leaves the foreground: another app's screen, Home, the lock. */
  subscribeBackground(onBackground: () => void): () => void;
}

export type Route = 'home' | 'stream';

/**
 * The only navigator. Every move goes through here (swipe-back is off and
 * Back is handled), so `current()` is the truth and a repeated `go` is free.
 */
export interface NavigationPort {
  go(route: Route): void;
  current(): Route;
}

export interface SplashPort {
  hide(): void;
}
