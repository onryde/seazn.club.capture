import { createFakeCaptureEngine, type FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import type { Gravity, Target } from '@/domain/orientation/orientation';
import type { Ports } from '@/hooks/usePorts';
import { createFakeCodeScanner, type FakeCodeScanner } from '@/scanner/fakeCodeScanner';
import type {
  BackPort,
  ForegroundPort,
  MotionPort,
  NavigationPort,
  OrientationLockPort,
  Route,
  SplashPort,
} from '@/services/devicePorts';
import { createMemoryKeyValueStore, type MemoryKeyValueStore } from '@/services/KeyValueStore';
import { createModeStore } from '@/services/modeStore';

export const TEST_NOW = new Date('2026-10-03T13:00:00Z');

export type FakeMotion = MotionPort & { emit(g: Gravity, atMs: number): void; available: boolean };

export type FakePorts = {
  readonly ports: Ports;
  readonly engine: FakeCaptureEngine;
  readonly scanner: FakeCodeScanner;
  readonly kv: MemoryKeyValueStore;
  readonly motion: FakeMotion;
  readonly orientationLock: OrientationLockPort & { readonly locks: readonly Target[] };
  readonly back: BackPort & { press(): boolean };
  readonly foreground: ForegroundPort & { fire(): void };
  readonly navigation: NavigationPort & { readonly history: readonly Route[] };
  readonly splash: SplashPort & { readonly hides: number };
  setNow(at: Date): void;
};

const created: FakeCaptureEngine[] = [];

export function createFakePorts(
  overrides: Partial<Ports> & { kvSeed?: Record<string, string> } = {},
): FakePorts {
  const { kvSeed, ...portOverrides } = overrides;
  let now = TEST_NOW;
  const engine = createFakeCaptureEngine(() => now.getTime());
  created.push(engine);
  const kv = createMemoryKeyValueStore(kvSeed);
  const fakes = {
    engine,
    scanner: createFakeCodeScanner(),
    kv,
    motion: fakeMotion(),
    orientationLock: fakeLock(),
    back: fakeBack(),
    foreground: fakeForeground(),
    navigation: fakeNavigation(),
    splash: fakeSplash(),
  };
  const ports: Ports = {
    ...fakes,
    devEngine: engine,
    modeStore: createModeStore(kv),
    clock: () => now,
    hosts: ['stg.seazn.club'],
    deviceLanguages: ['en'],
    phoneZone: 'Europe/London',
    appVersion: '0.0.0-test',
    devTools: true,
    ...portOverrides,
  };
  return {
    ...fakes,
    ports,
    setNow: (at) => {
      now = at;
    },
  };
}

/** Stops every fake engine's heartbeat. Called after each UI test (test/setup-ui.ts). */
export function disposeFakePorts(): void {
  for (const engine of created.splice(0)) engine.dispose();
}

function fakeMotion(): FakeMotion {
  const listeners = new Set<(g: Gravity, atMs: number) => void>();
  const motion: FakeMotion = {
    available: true,
    isAvailable: async () => motion.available,
    subscribe: (onSample) => {
      listeners.add(onSample);
      return () => listeners.delete(onSample);
    },
    emit: (g, atMs) => {
      for (const listener of listeners) listener(g, atMs);
    },
  };
  return motion;
}

function fakeLock(): OrientationLockPort & { readonly locks: Target[] } {
  const locks: Target[] = [];
  return {
    locks,
    lock: async (target) => {
      locks.push(target);
    },
  };
}

/** Newest subscriber first, as BackHandler does. */
function fakeBack(): BackPort & { press(): boolean } {
  const handlers: (() => boolean)[] = [];
  return {
    subscribe: (onBack) => {
      handlers.unshift(onBack);
      return () => handlers.splice(handlers.indexOf(onBack), 1);
    },
    press: () => handlers.some((handler) => handler()),
  };
}

function fakeForeground(): ForegroundPort & { fire(): void } {
  const listeners = new Set<() => void>();
  return {
    subscribe: (onForeground) => {
      listeners.add(onForeground);
      return () => listeners.delete(onForeground);
    },
    fire: () => {
      for (const listener of listeners) listener();
    },
  };
}

function fakeNavigation(): NavigationPort & { readonly history: Route[] } {
  const history: Route[] = [];
  let current: Route = 'home';
  return {
    history,
    current: () => current,
    go: (route) => {
      if (route === current) return;
      current = route;
      history.push(route);
    },
  };
}

function fakeSplash(): SplashPort & { readonly hides: number } {
  let hides = 0;
  return {
    hide: () => {
      hides += 1;
    },
    get hides() {
      return hides;
    },
  };
}
