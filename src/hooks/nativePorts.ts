import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import type { Ports } from '@/hooks/usePorts';
import { createNativeCodeScanner } from '@/scanner/nativeCodeScanner';
import { createModeStore } from '@/services/modeStore';
import { createExpoRouterNavigation } from '@/services/native/expoRouterNavigation';
import { createNativeBack } from '@/services/native/nativeBack';
import { createNativeForeground } from '@/services/native/nativeForeground';
import { createNativeMotion } from '@/services/native/nativeMotion';
import { createNativeOrientationLock } from '@/services/native/nativeOrientationLock';
import { createNativeSplash } from '@/services/native/nativeSplash';
import { createSecureKeyValueStore } from '@/services/native/secureKeyValueStore';
import { seaznHosts } from '@/services/seaznHosts';

/**
 * The composition root's parts. The engine is the fake in S0 — main has no
 * native engine yet; S1 brings StreamPack from spike/p5-android and changes
 * this one line (spec §8).
 */
export function createNativePorts(): Ports {
  const engine = createFakeCaptureEngine();
  const kv = createSecureKeyValueStore();
  const scanner = createNativeCodeScanner();
  scanner.prepare();
  return {
    engine,
    devEngine: __DEV__ ? engine : null,
    scanner,
    kv,
    modeStore: createModeStore(kv),
    motion: createNativeMotion(),
    orientationLock: createNativeOrientationLock(),
    back: createNativeBack(),
    foreground: createNativeForeground(),
    navigation: createExpoRouterNavigation(),
    splash: createNativeSplash(),
    clock: () => new Date(),
    hosts: seaznHosts(process.env.EXPO_PUBLIC_SEAZN_ENV),
    deviceLanguages: getLocales().map((locale) => locale.languageCode),
    phoneZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    devTools: __DEV__,
  };
}
