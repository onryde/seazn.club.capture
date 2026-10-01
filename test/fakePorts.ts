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
  SharePort,
  SplashPort,
} from '@/services/devicePorts';
import { createFakeDescriptorPort, type FakeDescriptorPort } from '@/services/fakeDescriptorPort';
import { createMemoryKeyValueStore, type MemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createModeStore } from '@/services/modeStore';
import { createHomeIntent } from '@/services/homeIntent';
import { createScanFlight } from '@/services/scanFlight';
import { createRingRecord, type SessionRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore } from '@/services/streamSettingsStore';
import { createFakeSurfaces, type FakeSurfaces } from './fakeSurfaces';

export const TEST_NOW = new Date('2026-10-03T13:00:00Z');

export type FakeMotion = MotionPort & { emit(g: Gravity, atMs: number): void; available: boolean };

export type FakePorts = {
  readonly ports: Ports;
  readonly engine: FakeCaptureEngine;
  readonly scanner: FakeCodeScanner;
  readonly descriptor: FakeDescriptorPort;
  readonly kv: MemoryKeyValueStore;
  readonly motion: FakeMotion;
  readonly orientationLock: OrientationLockPort & { readonly locks: readonly Target[] };
  readonly back: BackPort & { press(): boolean };
  /**
   * `leave()` is the app going to the background; `fire()` is its return.
   * `leaveListeners()` counts who would hear a `leave()`.
   */
  readonly foreground: FakeForeground;
  readonly navigation: NavigationPort & { readonly history: readonly Route[] };
  readonly splash: SplashPort & { readonly hides: number };
  readonly surfaces: FakeSurfaces;
  /** The session record the ports' logger writes to; read it with `readRecord`. */
  readonly record: SessionRecord;
  /** What Share record sent, in order; `refuse()` makes every later share fail to open (M18). */
  readonly share: SharePort & { readonly shared: string[]; refuse(): void };
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
  // The real logger over the ring record: both are pure, so no double is needed (D34).
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => now.getTime() });
  const fakes = {
    engine,
    scanner: createFakeCodeScanner(),
    descriptor: createFakeDescriptorPort(() => now),
    kv,
    motion: fakeMotion(),
    orientationLock: fakeLock(),
    back: fakeBack(),
    foreground: fakeForeground(),
    navigation: fakeNavigation(),
    splash: fakeSplash(),
    surfaces: createFakeSurfaces(),
    record,
    share: fakeShare(),
  };
  const ports: Ports = {
    ...fakes,
    devEngine: engine,
    modeStore: createModeStore(kv),
    scanFlight: createScanFlight(),
    homeIntent: createHomeIntent(),
    streamSettings: createStreamSettingsStore(kv, logger),
    clock: () => now,
    hosts: ['stg.seazn.club'],
    deviceLanguages: ['en'],
    phoneZone: 'Europe/London',
    appVersion: '0.0.0-test',
    devTools: true,
    logger,
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

export type RecordedEntry = {
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** The record's lines, parsed, for assertions. */
export function readRecord(record: SessionRecord): RecordedEntry[] {
  return record.lines().map((line) => JSON.parse(line) as RecordedEntry);
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
      return () => {
        // A second unsubscribe must not splice(-1) away someone else's handler.
        const at = handlers.indexOf(onBack);
        if (at !== -1) handlers.splice(at, 1);
      };
    },
    press: () => handlers.some((handler) => handler()),
  };
}

type FakeForeground = ForegroundPort & {
  fire(): void;
  leave(): void;
  leaveListeners(): number;
  returnListeners(): number;
};

function fakeForeground(): FakeForeground {
  const returns = new Set<() => void>();
  const leaves = new Set<() => void>();
  const add = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    subscribe: (onForeground) => add(returns, onForeground),
    subscribeBackground: (onBackground) => add(leaves, onBackground),
    fire: () => {
      for (const listener of returns) listener();
    },
    leave: () => {
      for (const listener of leaves) listener();
    },
    leaveListeners: () => leaves.size,
    returnListeners: () => returns.size,
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

function fakeShare(): SharePort & { readonly shared: string[]; refuse(): void } {
  const shared: string[] = [];
  let refusing = false;
  return {
    shared,
    refuse: () => {
      refusing = true;
    },
    share: async (text) => {
      if (refusing) throw new Error('share sheet refused');
      shared.push(text);
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
