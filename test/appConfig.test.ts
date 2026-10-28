import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import type { ExportedConfig } from 'expo/config-plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';
import appConfig, {
  buildNumber,
  countedAtBuild,
  GRADLE_VERSION_CODE,
  PINNED_BUILD_NUMBER,
  pinnedBuildNumber,
} from '../app.config';

/**
 * The build number (owner, 2026-10-26): the commit count of the checkout. The expected count comes from a git call
 * of the test's own, never from the function under test.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const count = Number(
  execFileSync('git', ['-C', root, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(),
);

const base: ExpoConfig = {
  name: 'Seazn Capture',
  slug: 'capture',
  version: '1.0.0',
  android: { package: 'com.seazn.capture' },
  ios: { bundleIdentifier: 'com.seazn.capture' },
};
const context = (projectRoot: string) =>
  ({ config: base, projectRoot }) as unknown as ConfigContext;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the build number (app.config.ts)', () => {
  it('is the checkout’s commit count, on Android and iOS, and keeps the version and the rest', () => {
    const config = appConfig(context(root));
    expect(config.android?.versionCode).toBe(count);
    expect(config.ios?.buildNumber).toBe(String(count));
    expect(config.version).toBe('1.0.0');
    expect(config.android?.package).toBe('com.seazn.capture');
    expect(config.ios?.bundleIdentifier).toBe('com.seazn.capture');
  });

  it('registers the build.gradle mod that reads the count when Gradle builds (review round 2)', () => {
    const config: ExportedConfig = appConfig(context(root));
    expect(typeof config.mods?.android?.appBuildGradle).toBe('function');
  });

  it('is the same on a second call (the config is read more than once a build)', () => {
    expect(buildNumber(root)).toBe(buildNumber(root));
  });

  it('refuses a folder that is not a git checkout, rather than build as 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-config-'));
    made.push(dir);
    expect(() => buildNumber(dir)).toThrow();
  });

  it('refuses a checkout with no commit yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-config-'));
    made.push(dir);
    execFileSync('git', ['init', '-q', dir]);
    expect(() => buildNumber(dir)).toThrow();
  });
});

/**
 * An EAS worker's checkout (owner, 2026-10-28: production builds on EAS): a clone with one commit, where git counts 1,
 * holding the release workflow's pin when `pin` is given.
 */
const workerClone = (pin?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-config-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', [
    '-C',
    dir,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'one',
  ]);
  if (pin !== undefined) writeFileSync(join(dir, PINNED_BUILD_NUMBER), pin);
  return dir;
};

/** Prebuild's defaultConfig, as `android/app/build.gradle` held it at 658. */
const prebuilt = [
  '    defaultConfig {',
  "        applicationId 'com.seazn.capture'",
  '        versionCode 658',
  '        versionName "1.0.0"',
  '    }',
].join('\n');

/** The app's build.gradle mod run as prebuild runs it, over [prebuilt], in `projectRoot`. */
const gradleAfterMod = async (projectRoot: string) => {
  const mod = (appConfig(context(projectRoot)) as ExportedConfig).mods?.android?.appBuildGradle;
  if (mod === undefined) throw new Error('no appBuildGradle mod');
  const out = await mod({
    ...base,
    modResults: { contents: prebuilt, language: 'groovy', path: 'app/build.gradle' },
    modRequest: {
      platform: 'android',
      modName: 'appBuildGradle',
      projectRoot,
      platformProjectRoot: join(projectRoot, 'android'),
      introspect: false,
    },
  } as never);
  return (out as { modResults: { contents: string } }).modResults.contents;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the pinned build number of an EAS release (app.config.ts)', () => {
  it('wins over the count of a clone with one commit, on Android and iOS', () => {
    const dir = workerClone('681\n');
    expect(buildNumber(dir)).toBe(681);
    const config = appConfig(context(dir));
    expect(config.android?.versionCode).toBe(681);
    expect(config.ios?.buildNumber).toBe('681');
  });

  it('is the versionCode build.gradle gets, so Gradle on the worker never counts its clone (review of #31)', async () => {
    expect(await gradleAfterMod(workerClone('681'))).toBe(
      prebuilt.replace('versionCode 658', 'versionCode 681'),
    );
  });

  it('leaves build.gradle counting at build time when there is no pin', async () => {
    expect(await gradleAfterMod(root)).toBe(
      prebuilt.replace('versionCode 658', GRADLE_VERSION_CODE),
    );
  });

  it('is the number on an EAS worker', () => {
    expect(buildNumber(workerClone('681'), { EAS_BUILD: 'true' })).toBe(681);
  });

  it('is required on an EAS worker, whose clone would count 1', () => {
    expect(() => buildNumber(workerClone(), { EAS_BUILD: 'true' })).toThrow(/build-number\.txt/);
    expect(() => buildNumber(root, { EAS_BUILD: 'true' })).toThrow(/build-number\.txt/);
    expect(buildNumber(workerClone(), { EAS_BUILD: 'false' })).toBe(1);
  });

  it('reads the worker from the process environment by default (review of #31)', () => {
    vi.stubEnv('EAS_BUILD', 'true');
    expect(() => appConfig(context(workerClone()))).toThrow(/build-number\.txt/);
  });

  it('is absent in this checkout: the release workflow writes it, never a commit', () => {
    expect(pinnedBuildNumber(root)).toBeNull();
    expect(
      execFileSync('git', ['-C', root, 'ls-files', PINNED_BUILD_NUMBER], { encoding: 'utf8' }),
    ).toBe('');
  });

  it('is not gitignored, since EAS leaves an ignored file out of its upload', () => {
    // check-ignore exits 1, and execFileSync throws, when no rule ignores the path.
    expect(() =>
      execFileSync('git', ['-C', root, 'check-ignore', '-q', PINNED_BUILD_NUMBER], {
        stdio: 'ignore',
      }),
    ).toThrow();
  });

  it('refuses a pin that is not a whole number above 0', () => {
    for (const text of ['', '0', '-3', '12a', '1.5', '068']) {
      expect(() => pinnedBuildNumber(workerClone(text)), JSON.stringify(text)).toThrow(
        /not a build number/,
      );
    }
  });
});

describe('the versionCode Gradle reads when it builds (app.config.ts)', () => {
  it('replaces the frozen number with the git count, in place, keeping the rest', () => {
    expect(countedAtBuild(prebuilt)).toBe(
      [
        '    defaultConfig {',
        "        applicationId 'com.seazn.capture'",
        "        versionCode Integer.parseInt(providers.exec { commandLine 'git', '-C', rootDir.parentFile.absolutePath, 'rev-list', '--count', 'HEAD' }.standardOutput.asText.get().trim())",
        '        versionName "1.0.0"',
        '    }',
      ].join('\n'),
    );
  });

  it('leaves a file already read so as it is (a second prebuild over android/)', () => {
    const once = countedAtBuild(prebuilt);
    expect(countedAtBuild(once)).toBe(once);
    expect(once.split(GRADLE_VERSION_CODE)).toHaveLength(2);
  });

  it('writes a pinned number as it is, since Gradle on an EAS worker would count a shallow clone', () => {
    expect(countedAtBuild(prebuilt, 681)).toBe(
      prebuilt.replace('versionCode 658', 'versionCode 681'),
    );
    expect(countedAtBuild(countedAtBuild(prebuilt), 681)).toBe(
      prebuilt.replace('versionCode 658', 'versionCode 681'),
    );
  });

  it('refuses a file with no versionCode line, or two', () => {
    expect(() => countedAtBuild(prebuilt.replace('        versionCode 658\n', ''))).toThrow(
      /0 versionCode lines/,
    );
    expect(() => countedAtBuild(`${prebuilt}\n        versionCode 1`)).toThrow(
      /2 versionCode lines/,
    );
  });
});
