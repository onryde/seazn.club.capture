import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';
import { loadCaptureEngineNative } from '@/engine/nativeModule';
import { chooseCodePort } from '@/hooks/codePortWiring';
import { chooseEngine, routedRecordFor } from '@/hooks/engineWiring';
import { photoPortFor } from '@/hooks/photoPortWiring';
import { scoringLinkPortFor } from '@/hooks/scoringLinkPortWiring';
import type { Ports } from '@/hooks/usePorts';
import { createNativeCodeScanner } from '@/scanner/nativeCodeScanner';
import { createEndedNotice } from '@/services/endedNotice';
import { withTimeout } from '@/services/kvTimeout';
import { createLogger } from '@/services/logger';
import { createModeStore } from '@/services/modeStore';
import { createProbeFlight } from '@/services/probeFlight';
import { createScanFlight } from '@/services/scanFlight';
import { createExpoRouterNavigation } from '@/services/native/expoRouterNavigation';
import { createNativeBack } from '@/services/native/nativeBack';
import { createNativeForeground } from '@/services/native/nativeForeground';
import { createNativeMotion } from '@/services/native/nativeMotion';
import { createNativeOrientationLock } from '@/services/native/nativeOrientationLock';
import { createNativePower } from '@/services/native/nativePower';
import { createNativeScreen } from '@/services/native/nativeScreen';
import { createNativeShare } from '@/services/native/nativeShare';
import { createNativeSplash } from '@/services/native/nativeSplash';
import { createNativeSurfaces } from '@/services/native/nativeSurfaces';
import { createSecureKeyValueStore } from '@/services/native/secureKeyValueStore';
import { seaznEnvironment, seaznHosts, seaznOrigin } from '@/services/seaznHosts';
import { createRecordSendFlight } from '@/services/recordSendFlight';
import { createRecordUploadPort } from '@/services/recordUploadPort';
import { createRingRecord } from '@/services/sessionRecord';
import { createStreamSettingsStore } from '@/services/streamSettingsStore';
import { createUploadCredentialStore } from '@/services/uploadCredentialStore';

/**
 * The composition root's parts (AGENTS §3). The engine is chosen by
 * `chooseEngine` (CD24): native in every release build that has the module.
 *
 * C4c carry (c): until Task 33 builds the native module, an Android build
 * wires the absent engine, which ends every pair fatal-error. No device build
 * between Task 32 and Task 33 without `EXPO_PUBLIC_FAKE_ENGINE=1`.
 *
 * `options.recordSend` is `FEATURES.recordSend`, passed in by the root layout (the D3 fixes plan's ruling P10:
 * `src/hooks` may not import `src/ui`). Off, the upload credential is never stored.
 */
export function createNativePorts(
  options: { readonly recordSend: boolean } = { recordSend: false },
): Ports {
  const ring = createRingRecord();
  const native = loadCaptureEngineNative();
  const wired = chooseEngine({
    dev: __DEV__,
    fakeFlag: process.env.EXPO_PUBLIC_FAKE_ENGINE,
    native,
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
  // One mode store: the app's, which the reopen gate loads, and the one the upload credential follows (R4).
  const modeStore = createModeStore(kv);
  const env = process.env.EXPO_PUBLIC_SEAZN_ENV;
  const hosts = seaznHosts(env);
  const uploadCredential = createUploadCredentialStore({
    kv,
    modeStore,
    clock,
    logger,
    enabled: options.recordSend,
  });
  // R3: plain fetch (AGENTS §8), to the build's host only. Called only from Send record to Seazn's tap
  // (`RecordSendFlight`).
  const recordUpload = createRecordUploadPort({
    fetch: (url, init) => fetch(url, init),
    logger,
    host: hosts[0] ?? '',
  });
  const code = chooseCodePort({
    dev: __DEV__,
    fakeFlag: process.env.EXPO_PUBLIC_FAKE_CODE,
    origin: seaznOrigin(env),
    fetch: (url, init) => fetch(url, init),
    logger,
  });
  return {
    engine: wired.engine,
    devEngine: wired.devEngine,
    nativeEngine: wired.native,
    scanner,
    code,
    environment: seaznEnvironment(env),
    kv,
    modeStore,
    scanFlight: createScanFlight(),
    probeFlight: createProbeFlight(),
    endedNotice: createEndedNotice(),
    streamSettings: createStreamSettingsStore(kv, logger),
    motion: createNativeMotion(),
    orientationLock: createNativeOrientationLock(),
    back: createNativeBack(),
    foreground: createNativeForeground(),
    screen: createNativeScreen({ logger, os: Platform.OS }),
    navigation: createExpoRouterNavigation(router),
    splash: createNativeSplash(),
    surfaces: createNativeSurfaces({ logger }),
    logger,
    record,
    share: createNativeShare(),
    // A development build with the fake engine and a native module still calls the real `takePhoto`, which
    // fails with no camera open: the line says so, truthfully. There is no second gate to keep.
    photo: photoPortFor(native),
    scoringLink: scoringLinkPortFor(native, { logger, hosts }),
    power: createNativePower({
      native,
      os: Platform.OS,
      openSettings: () => Linking.openSettings(),
      logger,
    }),
    uploadCredential,
    recordUpload,
    recordSendFlight: createRecordSendFlight({
      credentials: uploadCredential,
      upload: recordUpload,
      record,
    }),
    clock,
    hosts,
    deviceLanguages: getLocales().map((locale) => locale.languageCode),
    phoneZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    devTools: __DEV__,
  };
}
