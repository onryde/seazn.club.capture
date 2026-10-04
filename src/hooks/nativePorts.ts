import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { loadCaptureEngineNative } from '@/engine/nativeModule';
import { chooseEngine, routedRecordFor } from '@/hooks/engineWiring';
import type { Ports } from '@/hooks/usePorts';
import { createNativeCodeScanner } from '@/scanner/nativeCodeScanner';
import type { CodePort } from '@/services/codePort';
import { createFakeCodePort } from '@/services/fakeCodePort';
import { createFetchCodePort } from '@/services/fetchCodePort';
import { withTimeout } from '@/services/kvTimeout';
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
import { seaznEnvironment, seaznHosts, seaznOrigin } from '@/services/seaznHosts';
import { createRingRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore } from '@/services/streamSettingsStore';

/**
 * The composition root's parts (AGENTS §3). The engine is chosen by
 * `chooseEngine` (CD24): native in every release build that has the module.
 *
 * C4c carry (c): until Task 33 builds the native module, an Android build
 * wires the absent engine, which ends every pair fatal-error. No device build
 * between Task 32 and Task 33 without `EXPO_PUBLIC_FAKE_ENGINE=1`.
 */
export function createNativePorts(): Ports {
  const ring = createRingRecord();
  const wired = chooseEngine({
    dev: __DEV__,
    fakeFlag: process.env.EXPO_PUBLIC_FAKE_ENGINE,
    native: loadCaptureEngineNative(),
    now: Date.now,
    onRecordLine: ring.appendLine,
  });
  // M16: the rule is pure and tested in Task 26; its wiring in `routedRecordFor`.
  const record = routedRecordFor(ring, wired);
  const logger = createLogger({ record, now: Date.now, minLevel: __DEV__ ? 'debug' : 'info' });
  const kv = withTimeout(createSecureKeyValueStore(), { logger });
  const scanner = createNativeCodeScanner();
  scanner.prepare();
  const clock = () => new Date();
  const env = process.env.EXPO_PUBLIC_SEAZN_ENV;
  const hosts = seaznHosts(env);
  const code = createCodePort({ env, logger });
  return {
    engine: wired.engine,
    devEngine: wired.devEngine,
    nativeEngine: wired.native,
    scanner,
    code,
    environment: seaznEnvironment(env),
    kv,
    modeStore: createModeStore(kv),
    scanFlight: createScanFlight(),
    homeIntent: createHomeIntent(),
    streamSettings: createStreamSettingsStore(kv, logger),
    motion: createNativeMotion(),
    orientationLock: createNativeOrientationLock(),
    back: createNativeBack(),
    foreground: createNativeForeground(),
    navigation: createExpoRouterNavigation(router),
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
 * D25: the web endpoint may not exist yet, so a development build can opt into
 * the fake with `EXPO_PUBLIC_FAKE_CODE=1`. A release never can.
 */
function createCodePort(deps: { env: string | undefined; logger: Logger }): CodePort {
  if (__DEV__ && process.env.EXPO_PUBLIC_FAKE_CODE === '1') {
    return createFakeCodePort(seaznOrigin(deps.env));
  }
  return createFetchCodePort({
    origin: seaznOrigin(deps.env),
    fetch: (url, init) => fetch(url, init),
    logger: deps.logger,
  });
}
