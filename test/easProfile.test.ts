import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seaznEnvironment, seaznHosts, seaznOrigin } from '@/services/seaznHosts';

/**
 * The production release: a `v<version>` tag builds on EAS with eas.json's `production` profile (owner, 2026-10-28)
 * and submits to Play's internal track (the controller's choice; .github/workflows/release.yml, docs/release.md). A host word the app does not
 * know reads as staging, safely for a test build and wrongly for a store one, so the word is checked against the
 * app's own reading of it.
 */
type EasJson = {
  readonly cli: { readonly appVersionSource: string };
  readonly build: {
    readonly production: {
      readonly autoIncrement?: unknown;
      readonly env?: Readonly<Record<string, string>>;
      readonly android?: { readonly buildType?: string };
    };
  };
  readonly submit: {
    readonly production: {
      readonly android?: { readonly track?: string; readonly releaseStatus?: string };
    };
  };
};

const eas = JSON.parse(
  readFileSync(fileURLToPath(new URL('../eas.json', import.meta.url)), 'utf8'),
) as EasJson;
const production = eas.build.production;

describe('the production profile (eas.json)', () => {
  it('builds the app for seazn.club, not staging', () => {
    const env = production.env?.EXPO_PUBLIC_SEAZN_ENV;
    expect(seaznHosts(env)).toEqual(['seazn.club']);
    expect(seaznOrigin(env)).toBe('https://seazn.club');
    expect(seaznEnvironment(env)).toBe('production');
  });

  it('takes the build number from the app config, never from EAS’s own counter', () => {
    expect(eas.cli.appVersionSource).toBe('local');
    expect(production.autoIncrement).toBeUndefined();
  });

  it('makes an app bundle, which Play takes, and submits it to the internal track only', () => {
    expect(production.android?.buildType).toBe('app-bundle');
    expect(eas.submit.production.android).toEqual({
      track: 'internal',
      releaseStatus: 'completed',
    });
  });
});

/**
 * EAS's image does not ship the Android platform the app compiles against, and AGP's own download mid-build is not
 * found in the same run (v1.0.0, EAS build 39c9d2f7: "Failed to find target with hash string 'android-37'"). The
 * pre-install hook installs it first, as android-compile.yml does on CI.
 */
describe('the Android platform on an EAS worker (package.json eas-build-pre-install)', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const app = JSON.parse(read('app.json')) as { expo: { plugins: readonly unknown[] } };
  const buildProperties = app.expo.plugins.find(
    (p): p is [string, { android: { compileSdkVersion: number } }] =>
      Array.isArray(p) && p[0] === 'expo-build-properties',
  );

  it('runs the hook, which installs the platform app.json compiles against', () => {
    expect(pkg.scripts['eas-build-pre-install']).toBe('bash scripts/eas-build-pre-install.sh');
    const compileSdk = buildProperties?.[1].android.compileSdkVersion;
    expect(compileSdk).toBe(37);
    expect(read('scripts/eas-build-pre-install.sh')).toContain(
      `'platforms;android-${compileSdk}.0'`,
    );
  });
});
