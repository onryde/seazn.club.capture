import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import type { Ports } from '@/hooks/usePorts';
import { createNativeCodeScanner } from '@/scanner/nativeCodeScanner';
import { createFakeDescriptorPort } from '@/services/fakeDescriptorPort';
import { createFetchDescriptorPort } from '@/services/fetchDescriptorPort';
import { withTimeout } from '@/services/kvTimeout';
import type { DescriptorPort } from '@/services/descriptorPort';
import { createLogger, type Logger } from '@/services/logger';
import { createModeStore } from '@/services/modeStore';
import { createHomeIntent } from '@/services/homeIntent';
import { createScanFlight } from '@/services/scanFlight';
import { createExpoRouterNavigation } from '@/services/native/expoRouterNavigation';
import { createNativeBack } from '@/services/native/nativeBack';
import { createNativeForeground } from '@/services/native/nativeForeground';
import { createNativeMotion } from '@/services/native/nativeMotion';
import { createNativeOrientationLock } from '@/services/native/nativeOrientationLock';
import { createNativeShare } from '@/services/native/nativeShare';
import { createNativeSplash } from '@/services/native/nativeSplash';
import { createNativeSurfaces } from '@/services/native/nativeSurfaces';
import { createSecureKeyValueStore } from '@/services/native/secureKeyValueStore';
import { descriptorOrigin, seaznHosts } from '@/services/seaznHosts';
import { createRingRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore } from '@/services/streamSettingsStore';

/**
 * The composition root's parts. The engine is the fake in S0 — main has no
 * native engine yet; S1 brings StreamPack from spike/p5-android and changes
 * this one line (spec §8).
 */
export function createNativePorts(): Ports {
  const record = createRingRecord();
  const logger = createLogger({ record, now: Date.now, minLevel: __DEV__ ? 'debug' : 'info' });
  const engine = createFakeCaptureEngine();
  const kv = withTimeout(createSecureKeyValueStore(), { logger });
  const scanner = createNativeCodeScanner();
  scanner.prepare();
  const clock = () => new Date();
  const env = process.env.EXPO_PUBLIC_SEAZN_ENV;
  const hosts = seaznHosts(env);
  const descriptor = createDescriptorPort({ env, clock, logger });
  return {
    engine,
    devEngine: __DEV__ ? engine : null,
    scanner,
    descriptor,
    kv,
    modeStore: createModeStore(kv),
    scanFlight: createScanFlight(),
    homeIntent: createHomeIntent(),
    streamSettings: createStreamSettingsStore(kv, logger),
    motion: createNativeMotion(),
    orientationLock: createNativeOrientationLock(),
    back: createNativeBack(),
    foreground: createNativeForeground(),
    navigation: createExpoRouterNavigation(),
    splash: createNativeSplash(),
    surfaces: createNativeSurfaces({ logger }),
    logger,
    record,
    share: createNativeShare(),
    clock,
    hosts,
    deviceLanguages: getLocales().map((locale) => locale.languageCode),
    phoneZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    devTools: __DEV__,
  };
}

/**
 * D25: the web endpoint does not exist yet, so a development build can opt
 * into the fake with `EXPO_PUBLIC_FAKE_DESCRIPTOR=1`. A release never can.
 */
function createDescriptorPort(deps: {
  env: string | undefined;
  clock: () => Date;
  logger: Logger;
}): DescriptorPort {
  if (__DEV__ && process.env.EXPO_PUBLIC_FAKE_DESCRIPTOR === '1') {
    return createFakeDescriptorPort(deps.clock);
  }
  return createFetchDescriptorPort({
    origin: descriptorOrigin(deps.env),
    fetch: (url, init) => fetch(url, init),
    logger: deps.logger,
  });
}
