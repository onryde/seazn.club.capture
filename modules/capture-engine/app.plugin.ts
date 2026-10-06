/**
 * The capture engine's config plugin: the app's Kotlin toolchain for StreamPack 3.2.1 (C7u, owner
 * 2026-10-05), as pure functions [withCaptureEngine] applies at prebuild. One file, since Expo loads a
 * TypeScript plugin by itself and resolves no `.ts` import from it.
 *
 * StreamPack 3.2.1 and its graph carry Kotlin metadata 2.4.0, which a Kotlin compiler reads only from
 * 2.3.0 on (one metadata version ahead of its own). Expo 57's `android.kotlinVersion`
 * (expo-build-properties) sets Expo's own `kotlinVersion` and never the compiler: the root build.gradle
 * names the Kotlin Gradle plugin with no version, so React Native 0.86's Gradle plugin brings its own
 * 2.1.20. [pinKotlinGradlePlugin] gives that classpath the version app.json asks for, so the one knob
 * reaches the compiler. Remove it when Expo or React Native ship Kotlin 2.3 or newer.
 */

import {
  type ConfigPlugin,
  withGradleProperties,
  withProjectBuildGradle,
} from 'expo/config-plugins';

export type GradleProperty =
  | { type: 'property'; key: string; value: string }
  | { type: 'comment'; value: string }
  | { type: 'empty' };

/** Any classpath line for the Kotlin Gradle plugin, with or without a version. */
const KOTLIN_GRADLE_PLUGIN =
  /classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^']*)?'\)/g;

/** The oldest compiler that reads metadata 2.4.0: one metadata version ahead of its own. */
const READS_METADATA_2_4 = (version: string): boolean => {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) return false;
  const [major, minor] = [Number(parts[1]), Number(parts[2])];
  return major > 2 || (major === 2 && minor >= 3);
};

/**
 * The root build.gradle with its one Kotlin Gradle plugin classpath at [version]. A template that names
 * the plugin other than once has changed under us, and is refused rather than left at React Native's
 * Kotlin: that build would fail far from here, on StreamPack's metadata.
 */
export function pinKotlinGradlePlugin(buildGradle: string, version: string): string {
  if (!READS_METADATA_2_4(version)) {
    throw new Error(
      `capture-engine: android.kotlinVersion ${JSON.stringify(version)} must be Kotlin 2.3.0 or newer, which reads StreamPack 3.2.1's metadata 2.4 (C7u)`,
    );
  }
  const found = buildGradle.match(KOTLIN_GRADLE_PLUGIN)?.length ?? 0;
  if (found !== 1) {
    throw new Error(
      `capture-engine: the root build.gradle names the Kotlin Gradle plugin ${found} times, expected once: the Expo template changed (C7u)`,
    );
  }
  return buildGradle.replace(
    KOTLIN_GRADLE_PLUGIN,
    `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${version}')`,
  );
}

/** expo-build-properties' `android.kotlinVersion` and `android.compileSdkVersion`: app.json holds each once. */
export function buildPropertiesOf(plugins: readonly unknown[] | undefined): {
  kotlinVersion: string;
  compileSdk: number;
} {
  const entry = (plugins ?? []).find(
    (plugin): plugin is [string, { android?: Record<string, unknown> }] =>
      Array.isArray(plugin) &&
      plugin[0] === 'expo-build-properties' &&
      typeof plugin[1] === 'object',
  );
  if (!entry)
    throw new Error(
      'capture-engine: app.json configures no expo-build-properties android values (C7u)',
    );
  const android = entry[1].android ?? {};
  const kotlinVersion = android.kotlinVersion;
  const compileSdk = android.compileSdkVersion;
  if (typeof kotlinVersion !== 'string')
    throw new Error('capture-engine: expo-build-properties sets no android.kotlinVersion (C7u)');
  if (typeof compileSdk !== 'number')
    throw new Error(
      'capture-engine: expo-build-properties sets no android.compileSdkVersion (C7u)',
    );
  return { kotlinVersion, compileSdk };
}

const SUPPRESS_KEY = 'android.suppressUnsupportedCompileSdk';

/**
 * AGP 8.12 was tested up to compile SDK 36 and warns at 37, naming this property and the value it takes
 * (`37.0`, its own spelling). One entry, whatever ran before.
 */
export function withSuppressedCompileSdk(
  items: GradleProperty[],
  compileSdk: number,
): GradleProperty[] {
  const others = items.filter((item) => !(item.type === 'property' && item.key === SUPPRESS_KEY));
  return [...others, { type: 'property', key: SUPPRESS_KEY, value: `${compileSdk}.0` }];
}

/**
 * The capture engine's prebuild (C7u): the Kotlin compiler app.json's expo-build-properties names, and
 * AGP's own suppression for the compile SDK it names. app.json runs this after expo-build-properties.
 */
const withCaptureEngine: ConfigPlugin = (config) => {
  const { kotlinVersion, compileSdk } = buildPropertiesOf(config.plugins);
  const pinned = withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = pinKotlinGradlePlugin(mod.modResults.contents, kotlinVersion);
    return mod;
  });
  return withGradleProperties(pinned, (mod) => {
    mod.modResults = withSuppressedCompileSdk(mod.modResults as GradleProperty[], compileSdk);
    return mod;
  });
};

export default withCaptureEngine;
