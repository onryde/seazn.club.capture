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

/** The app coming back to the foreground, and leaving it, and whether it is there now. */
export interface ForegroundPort {
  subscribe(onForeground: () => void): () => void;
  /** Fires when the app leaves the foreground: another app's screen, Home, the lock. */
  subscribeBackground(onBackground: () => void): () => void;
  /**
   * Whether the app is in the foreground now, read at the call. For a hook that can mount while the app is in the
   * background (a remote Go live routes a locked phone to Live Stream) and must not start as if it were seen.
   */
  isForeground(): boolean;
}

/**
 * Settings (with Diagnostics inside it, spec §6) sits inside Live Stream (AGENTS §6): on air, only leaving the mode is
 * blocked. `homeSettings` is the same screen opened from Home's Live Stream tile, outside any mode (R2, P8).
 */
export type Route = 'home' | 'stream' | 'streamSettings' | 'homeSettings';

/**
 * Live Stream's sub-screens, pushed over the mounted viewfinder (D19). Named
 * one by one: Back is given away only on a route this names (M21), so a
 * route nobody expected never hands Back to Android on air.
 */
export function isStreamSubRoute(route: Route): boolean {
  return route === 'streamSettings';
}

/** R2, P8: the one screen outside a mode that is not Home itself. The reopen gate treats it as Home. */
export function isHomeSubRoute(route: Route): boolean {
  return route === 'homeSettings';
}

/**
 * The only navigator. Every move goes through here (swipe-back is off and
 * Back is handled), so `current()` is the truth and a repeated `go` is free —
 * until the root navigator remounts, which only `restart` reports.
 */
export interface NavigationPort {
  go(route: Route): void;
  current(): Route;
  /**
   * The root navigator is mounting afresh (Try again after a crash): it starts
   * again at its first route, so the port forgets the route it believed in.
   * Final fix round 2, I-A: a cached `stream` made the reopen gate's
   * `go('stream')` a no-op over a Stack back at Home, with no Stop on air.
   */
  restart(): void;
}

export interface SplashPort {
  hide(): void;
}

/** The system share sheet (D21). Rejects when it could not open. */
export interface SharePort {
  share(text: string): Promise<void>;
}

/**
 * The app window's own brightness (D2 §4.5, R8), never the system setting. `dim` and `restore` are intents: each
 * returns at once, does nothing when already in that state, and never throws, so a phone without the module only
 * stays bright.
 */
export interface ScreenPort {
  dim(): void;
  restore(): void;
}
