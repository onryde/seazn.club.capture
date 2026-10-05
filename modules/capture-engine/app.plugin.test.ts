import { describe, expect, it } from 'vitest';
import appJson from '../../app.json';
import {
  buildPropertiesOf,
  pinKotlinGradlePlugin,
  withSuppressedCompileSdk,
  type GradleProperty,
} from './app.plugin';

/**
 * C7u (owner, 2026-10-05): StreamPack 3.2.1 and its graph carry Kotlin metadata 2.4.0, which a Kotlin
 * compiler reads only from 2.3.0 on (a compiler reads one metadata version ahead of its own). Expo 57's
 * `android.kotlinVersion` sets Expo's own `kotlinVersion` and never the compiler: the root build.gradle
 * names the Kotlin Gradle plugin with no version, so React Native's Gradle plugin brings 2.1.20 (C7u
 * report, `buildEnvironment`). This plugin gives that classpath the version app.json asks for.
 */
const UNVERSIONED = "    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n";
const TEMPLATE = [
  'buildscript {',
  '  dependencies {',
  "    classpath('com.android.tools.build:gradle')",
  "    classpath('com.facebook.react:react-native-gradle-plugin')",
  UNVERSIONED.trimEnd(),
  '  }',
  '}',
  '',
].join('\n');

const versioned = (version: string) =>
  `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${version}')`;

describe('pinKotlinGradlePlugin', () => {
  it('versions the one unversioned Kotlin Gradle plugin, and nothing else', () => {
    const pinned = pinKotlinGradlePlugin(TEMPLATE, '2.3.0');
    expect(pinned).toBe(TEMPLATE.replace(UNVERSIONED.trim(), versioned('2.3.0')));
    expect(pinned.split('kotlin-gradle-plugin').length - 1).toBe(1);
  });

  it('leaves its own output as it is: a second prebuild over the same file', () => {
    const once = pinKotlinGradlePlugin(TEMPLATE, '2.3.0');
    expect(pinKotlinGradlePlugin(once, '2.3.0')).toBe(once);
  });

  it('moves the version a previous prebuild wrote: a second prebuild after app.json changed', () => {
    const once = pinKotlinGradlePlugin(TEMPLATE, '2.3.0');
    expect(pinKotlinGradlePlugin(once, '2.3.21')).toBe(pinKotlinGradlePlugin(TEMPLATE, '2.3.21'));
  });

  it('refuses a template that names the plugin nowhere, or twice: the Expo template changed', () => {
    expect(() => pinKotlinGradlePlugin('buildscript {}\n', '2.3.0')).toThrow(/0 times/);
    expect(() => pinKotlinGradlePlugin(TEMPLATE + UNVERSIONED, '2.3.0')).toThrow(/2 times/);
    expect(() => pinKotlinGradlePlugin('', '2.3.0')).toThrow(/0 times/);
  });

  // From the rule, not the code: metadata 2.4.0 needs a compiler of 2.3.0 or newer.
  it.each(['2.3.0', '2.3.21', '2.4.10', '3.0.0'])(
    'takes %s, which reads metadata 2.4',
    (version) => {
      expect(pinKotlinGradlePlugin(TEMPLATE, version)).toContain(versioned(version));
    },
  );

  it.each(['2.1.20', '2.2.21', '1.9.24', '', 'latest', '2.3', '2.3.0; rm'])(
    'refuses %j, which reads no metadata 2.4 or is no version',
    (version) => {
      expect(() => pinKotlinGradlePlugin(TEMPLATE, version)).toThrow(/Kotlin 2\.3\.0 or newer/);
    },
  );
});

describe('buildPropertiesOf', () => {
  const props = { android: { minSdkVersion: 31, compileSdkVersion: 37, kotlinVersion: '2.3.0' } };

  it("reads expo-build-properties' kotlinVersion and compileSdkVersion", () => {
    expect(buildPropertiesOf(['expo-router', ['expo-build-properties', props]])).toEqual({
      kotlinVersion: '2.3.0',
      compileSdk: 37,
    });
  });

  it('refuses a config with no expo-build-properties, or one without either value', () => {
    expect(() => buildPropertiesOf(undefined)).toThrow(/expo-build-properties/);
    expect(() => buildPropertiesOf([])).toThrow(/expo-build-properties/);
    expect(() => buildPropertiesOf(['expo-build-properties'])).toThrow(/expo-build-properties/);
    expect(() =>
      buildPropertiesOf([['expo-build-properties', { android: { compileSdkVersion: 37 } }]]),
    ).toThrow(/kotlinVersion/);
    expect(() =>
      buildPropertiesOf([['expo-build-properties', { android: { kotlinVersion: '2.3.0' } }]]),
    ).toThrow(/compileSdkVersion/);
  });
});

describe('withSuppressedCompileSdk', () => {
  const base: GradleProperty[] = [
    { type: 'comment', value: 'Project-wide Gradle settings.' },
    { type: 'property', key: 'android.useAndroidX', value: 'true' },
  ];
  const suppressed = (items: GradleProperty[]) =>
    items.filter(
      (item) => item.type === 'property' && item.key === 'android.suppressUnsupportedCompileSdk',
    );

  it("adds AGP's own suppression for the compile SDK, as AGP 8.12 spells it for 37", () => {
    const items = withSuppressedCompileSdk(base, 37);
    expect(suppressed(items)).toEqual([
      { type: 'property', key: 'android.suppressUnsupportedCompileSdk', value: '37.0' },
    ]);
    expect(items.slice(0, base.length)).toEqual(base);
  });

  it('holds one entry after a second prebuild, and moves it with the compile SDK', () => {
    const twice = withSuppressedCompileSdk(withSuppressedCompileSdk(base, 37), 37);
    expect(suppressed(twice)).toHaveLength(1);
    expect(suppressed(withSuppressedCompileSdk(twice, 38))).toEqual([
      { type: 'property', key: 'android.suppressUnsupportedCompileSdk', value: '38.0' },
    ]);
  });

  it('adds it to an empty file too', () => {
    expect(suppressed(withSuppressedCompileSdk([], 37))).toHaveLength(1);
  });
});

// The inert-seam guard: a plugin app.json does not name never runs at prebuild.
describe('app.json', () => {
  const plugins = appJson.expo.plugins as unknown[];

  it('runs the capture engine plugin, after expo-build-properties, whose values it reads', () => {
    const names = plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
    const engine = names.indexOf('./modules/capture-engine/app.plugin.ts');
    expect(names.indexOf('expo-build-properties')).toBeGreaterThanOrEqual(0);
    expect(engine).toBeGreaterThan(names.indexOf('expo-build-properties'));
  });

  it('names a plugin that registers both of its Android mods, read with what app.json holds', async () => {
    const reference = './modules/capture-engine/app.plugin.ts';
    const plugin = (await import(`../../${reference.slice(2)}`)).default as (config: object) => {
      mods?: { android?: Record<string, unknown> };
    };
    const config = plugin({ name: 'capture', slug: 'capture', plugins });
    expect(Object.keys(config.mods?.android ?? {}).sort()).toEqual([
      'gradleProperties',
      'projectBuildGradle',
    ]);
  });

  it('asks for the lowest Kotlin that reads metadata 2.4, and compile SDK 37 (ruling C7u-toolchain)', () => {
    expect(buildPropertiesOf(plugins)).toEqual({ kotlinVersion: '2.3.0', compileSdk: 37 });
  });
});
