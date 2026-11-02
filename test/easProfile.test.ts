import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seaznEnvironment, seaznHosts, seaznOrigin } from '@/services/seaznHosts';
import { appVariant, STORE_VARIANT } from '../app.config';

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

  it('builds the store app’s package, and no other profile does (option 2, 2026-10-30)', () => {
    const app = JSON.parse(
      readFileSync(fileURLToPath(new URL('../app.json', import.meta.url)), 'utf8'),
    ) as { expo: Parameters<typeof appVariant>[0] };
    expect(production.env?.APP_VARIANT).toBe(STORE_VARIANT);
    expect(appVariant(app.expo, production.env).android?.package).toBe('com.seazn.capture');
    const others = Object.entries(
      eas.build as unknown as Record<string, { env?: Record<string, string> }>,
    ).filter(([name]) => name !== 'production');
    expect(others.map(([name]) => name)).toEqual(['base', 'development', 'soak', 'preview']);
    for (const [, profile] of others) expect(profile.env?.APP_VARIANT).toBeUndefined();
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

/**
 * `@seazn/engine` is on GitHub Packages (plan S2-1 Task 1), and pnpm 10.34.5 ignores an `${NODE_AUTH_TOKEN}` credential
 * in the project's .npmrc. So the hook writes that line, literally, to the user config the worker's pnpm reads, before
 * EAS installs, for every platform; with no `NODE_AUTH_TOKEN` secret it stops the build at once and says why. Run here
 * as a script with a scratch HOME and a made-up token, on the iOS path so it never reaches `sdkmanager`.
 */
describe('the engine registry credential on an EAS worker (eas-build-pre-install)', () => {
  const CREDENTIAL = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}';
  const FAKE_TOKEN = 'not-a-real-token-0123';
  const script = fileURLToPath(new URL('../scripts/eas-build-pre-install.sh', import.meta.url));

  function hook(env: Record<string, string>) {
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', EAS_BUILD_PLATFORM: 'ios', ...env },
    });
  }

  it('writes the credential line, as written, to ~/.npmrc, once however often it runs', () => {
    const home = mkdtempSync(join(tmpdir(), 'eas-hook-'));
    const first = hook({ HOME: home, NODE_AUTH_TOKEN: FAKE_TOKEN });
    const second = hook({ HOME: home, NODE_AUTH_TOKEN: FAKE_TOKEN });
    expect([first.status, second.status]).toEqual([0, 0]);
    const lines = readFileSync(join(home, '.npmrc'), 'utf8').split('\n');
    expect(lines.filter((line) => line === CREDENTIAL)).toHaveLength(1);
    expect(`${first.stdout}${first.stderr}${second.stdout}${second.stderr}`).not.toContain(
      FAKE_TOKEN,
    );
  });

  it('keeps what the user config held and writes to the file NPM_CONFIG_USERCONFIG names', () => {
    const home = mkdtempSync(join(tmpdir(), 'eas-hook-'));
    const config = join(home, 'elsewhere.npmrc');
    writeFileSync(config, 'fund=false');
    expect(
      hook({ HOME: home, NODE_AUTH_TOKEN: FAKE_TOKEN, NPM_CONFIG_USERCONFIG: config }).status,
    ).toBe(0);
    expect(readFileSync(config, 'utf8').split('\n')).toEqual(['fund=false', CREDENTIAL, '']);
    expect(existsSync(join(home, '.npmrc'))).toBe(false);
  });

  it('stops the build, saying why, when the NODE_AUTH_TOKEN secret is missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'eas-hook-'));
    const missing: readonly Record<string, string>[] = [
      { HOME: home },
      { HOME: home, NODE_AUTH_TOKEN: '' },
    ];
    for (const env of missing) {
      const run = hook(env);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('NODE_AUTH_TOKEN');
    }
    expect(existsSync(join(home, '.npmrc'))).toBe(false);
  });
});
