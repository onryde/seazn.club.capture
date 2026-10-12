import type { EngineIntent } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine, type FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import type { UploadCredential } from '@/domain/credentials/uploadCredential';
import type { Gravity, Target } from '@/domain/orientation/orientation';
import type { Ports } from '@/hooks/usePorts';
import { createFakeCodeScanner, type FakeCodeScanner } from '@/scanner/fakeCodeScanner';
import type {
  BackPort,
  ForegroundPort,
  MotionPort,
  NavigationPort,
  OrientationLockPort,
  PowerMode,
  PowerPort,
  Route,
  ScreenPort,
  SharePort,
  SplashPort,
} from '@/services/devicePorts';
import { createEndedNotice } from '@/services/endedNotice';
import { createFakeCodePort, type FakeCodePort } from '@/services/fakeCodePort';
import { createMemoryKeyValueStore, type MemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createModeStore } from '@/services/modeStore';
import { createProbeFlight } from '@/services/probeFlight';
import { createRecordSendFlight } from '@/services/recordSendFlight';
import type { RecordSendOutcome, RecordUploadPort } from '@/services/recordUploadPort';
import { createScanFlight } from '@/services/scanFlight';
import { createRingRecord, parseRecordLine, type SessionRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore } from '@/services/streamSettingsStore';
import type { UploadCredentialStore } from '@/services/uploadCredentialStore';
import { createFakePhotoPort, type FakePhotoPort } from './fakePhotoPort';
import { createFakeScoringLinkPort, type FakeScoringLinkPort } from './fakeScoringLinkPort';
import { createFakeSurfaces, type FakeSurfaces } from './fakeSurfaces';

export const TEST_NOW = new Date('2026-10-03T13:00:00Z');

/**
 * A `clock` port that moves with vitest's fake timers, which fake `Date` too (vitest 5). For a hook that waits
 * `until - clock()`: on the frozen `TEST_NOW` clock that wait never shrinks, so a 3 s phase that follows a 5 s one
 * would last 8 (ledger P7). Pass it as `clock`, after `vi.useFakeTimers()` and `vi.setSystemTime(TEST_NOW)`.
 */
export const timerClock = (): Date => new Date(Date.now());

export type FakeMotion = MotionPort & { emit(g: Gravity, atMs: number): void; available: boolean };

/** The fake engine, plus every intent it was sent, whole: tests only (M5). */
export type TestEngine = FakeCaptureEngine & { readonly intents: readonly EngineIntent[] };

export type FakePorts = {
  readonly ports: Ports;
  readonly engine: TestEngine;
  readonly scanner: FakeCodeScanner;
  readonly code: FakeCodePort;
  readonly kv: MemoryKeyValueStore;
  readonly motion: FakeMotion;
  readonly orientationLock: OrientationLockPort & { readonly locks: readonly Target[] };
  readonly back: BackPort & { press(): boolean };
  /**
   * `leave()` is the app going to the background; `fire()` is its return.
   * `isForeground()` reports the last of them (the foreground at first), so a
   * `leave()` before a mount mounts it in the background.
   * `leaveListeners()` counts who would hear a `leave()`.
   */
  readonly foreground: FakeForeground;
  /** `calls` lists every dim and restore, in order; `dimmed` is the window now. */
  readonly screen: FakeScreen;
  readonly navigation: NavigationPort & { readonly history: readonly Route[] };
  readonly splash: SplashPort & { readonly hides: number };
  readonly surfaces: FakeSurfaces;
  /** The session record the ports' logger writes to; read it with `readRecord`. */
  readonly record: SessionRecord;
  /** What Share record sent, in order; `refuse()` makes every later share fail to open (M18). */
  readonly share: SharePort & { readonly shared: string[]; refuse(): void };
  /** `hold()`/`release()` pend a take; `calls` counts. */
  readonly photo: FakePhotoPort;
  /** `hold()`/`release()` pend a request; `calls` counts. */
  readonly scoringLink: FakeScoringLinkPort;
  /** The battery mode (R5): Unrestricted until `set`; `opened` counts App info's opens. */
  readonly power: FakePower;
  /** R4: no credential until `give`; the real store's own tests are `uploadCredentialStore.test.ts`. */
  readonly uploadCredential: FakeUploadCredential;
  /** R3: answers `sent` with ref R-TEST until `answer`; `sent` lists each call's lines and credential. */
  readonly recordUpload: FakeRecordUpload;
  setNow(at: Date): void;
};

const created: FakeCaptureEngine[] = [];

export function createFakePorts(
  overrides: Partial<Ports> & { kvSeed?: Record<string, string> } = {},
): FakePorts {
  const { kvSeed, ...portOverrides } = overrides;
  let now = TEST_NOW;
  const engine = recordingIntents(createFakeCaptureEngine(() => now.getTime()));
  created.push(engine);
  const kv = createMemoryKeyValueStore(kvSeed);
  // The real logger over the ring record: both are pure, so no double is needed (D34).
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => now.getTime() });
  const fakes = {
    engine,
    scanner: createFakeCodeScanner(),
    code: createFakeCodePort(),
    kv,
    motion: fakeMotion(),
    orientationLock: fakeLock(),
    back: fakeBack(),
    foreground: fakeForeground(),
    screen: fakeScreen(),
    navigation: fakeNavigation(),
    splash: fakeSplash(),
    surfaces: createFakeSurfaces(),
    record,
    share: fakeShare(),
    photo: createFakePhotoPort(),
    scoringLink: createFakeScoringLinkPort(),
    power: createFakePower(),
    uploadCredential: createFakeUploadCredential(),
    recordUpload: createFakeRecordUpload(),
  };
  const wired: Omit<Ports, 'recordSendFlight'> = {
    ...fakes,
    devEngine: engine,
    nativeEngine: null,
    modeStore: createModeStore(kv),
    scanFlight: createScanFlight(),
    probeFlight: createProbeFlight(),
    endedNotice: createEndedNotice(),
    streamSettings: createStreamSettingsStore(kv, logger),
    clock: () => now,
    hosts: ['stg.seazn.club'],
    environment: 'staging',
    deviceLanguages: ['en'],
    phoneZone: 'Europe/London',
    appVersion: '0.0.0-test',
    devTools: true,
    logger,
    ...portOverrides,
  };
  // Over the ports as overridden, so a test's own credential or upload is the one the flight uses.
  const ports: Ports = {
    recordSendFlight: createRecordSendFlight({
      credentials: wired.uploadCredential,
      upload: wired.recordUpload,
      record: wired.record,
    }),
    ...wired,
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

/**
 * The record's lines, parsed, for assertions: `{ level, event, fields }`, with
 * `fields.kind` restored from the line's `field_kind` (CD7).
 */
export function readRecord(record: SessionRecord): RecordedEntry[] {
  return record.lines().map((line) => {
    const { level, event, fields } = parseRecordLine(line);
    return { level, event, fields };
  });
}

/**
 * Records each intent whole as it reaches the engine. Wraps `send` on the same
 * object, so the ports and `holdIntents` see one engine; a held intent is
 * recorded when it is released, as native would only then have it.
 */
function recordingIntents(engine: FakeCaptureEngine): TestEngine {
  const intents: EngineIntent[] = [];
  const deliver = engine.send;
  engine.send = (intent) => {
    intents.push(intent);
    deliver(intent);
  };
  return Object.assign(engine, { intents });
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
  let foreground = true;
  const add = (listeners: Set<() => void>, listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    subscribe: (onForeground) => add(returns, onForeground),
    subscribeBackground: (onBackground) => add(leaves, onBackground),
    isForeground: () => foreground,
    fire: () => {
      foreground = true;
      for (const listener of returns) listener();
    },
    leave: () => {
      foreground = false;
      for (const listener of leaves) listener();
    },
    leaveListeners: () => leaves.size,
    returnListeners: () => returns.size,
  };
}

export type FakeScreen = ScreenPort & {
  /** Every call, in order. */
  readonly calls: readonly ('dim' | 'restore')[];
  readonly dimmed: boolean;
};

function fakeScreen(): FakeScreen {
  const calls: ('dim' | 'restore')[] = [];
  let dimmed = false;
  return {
    calls,
    dim: () => {
      calls.push('dim');
      dimmed = true;
    },
    restore: () => {
      calls.push('restore');
      dimmed = false;
    },
    get dimmed() {
      return dimmed;
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
    restart: () => {
      current = 'home';
    },
  };
}

export type FakePower = PowerPort & {
  /** What the next read answers: a mode, or null (unknown, as on iOS). */
  set(value: PowerMode | null): void;
  readonly opened: number;
};

/**
 * R5: the battery mode, settable, and App info's opens counted. Pass one as the `power` override to start a render
 * in another mode or unknown, and keep it to change the answer before a return to the foreground.
 */
export function createFakePower(initial: PowerMode | null = 'unrestricted'): FakePower {
  let value = initial;
  let opened = 0;
  return {
    mode: () => value,
    openAppSettings: () => {
      opened += 1;
    },
    set: (next) => {
      value = next;
    },
    get opened() {
      return opened;
    },
  };
}

export type FakeUploadCredential = UploadCredentialStore & {
  /** What every later `current()` answers. */
  give(credential: UploadCredential | null): void;
};

/** R4: the credential Send record may use, settable. Made-up values only in a test that gives one. */
export function createFakeUploadCredential(
  initial: UploadCredential | null = null,
): FakeUploadCredential {
  let credential = initial;
  return {
    current: async () => credential,
    give: (next) => {
      credential = next;
    },
  };
}

export type FakeRecordUpload = RecordUploadPort & {
  /** What every later `send` answers. */
  answer(outcome: RecordSendOutcome): void;
  /** `hold()` pends every later send until `release()`. */
  hold(): void;
  release(): void;
  readonly calls: number;
  readonly sent: readonly { readonly lines: readonly string[]; readonly token: string }[];
};

const SENT: RecordSendOutcome = { result: 'sent', ref: 'R-TEST', status: 201, bytes: 10 };

/** R3: the record upload, answering a settable outcome, counting calls and keeping what each was handed. */
export function createFakeRecordUpload(): FakeRecordUpload {
  let outcome = SENT;
  let gate: Promise<void> | null = null;
  let open = () => undefined as void;
  const sent: { lines: readonly string[]; token: string }[] = [];
  return {
    send: async (lines, credential) => {
      sent.push({ lines, token: credential.token });
      if (gate !== null) await gate;
      return outcome;
    },
    answer: (next) => {
      outcome = next;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => {
      gate = null;
      open();
    },
    get calls() {
      return sent.length;
    },
    sent,
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
