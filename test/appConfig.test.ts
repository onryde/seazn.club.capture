import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import type { ExportedConfig } from 'expo/config-plugins';
import { afterEach, describe, expect, it } from 'vitest';
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

/** A folder with no git at all, holding the release workflow's pin (owner, 2026-10-28: production builds on EAS). */
const pinnedAt = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-config-'));
  made.push(dir);
  writeFileSync(join(dir, PINNED_BUILD_NUMBER), text);
  return dir;
};

describe('the pinned build number of an EAS release (app.config.ts)', () => {
  it('wins over git, so a folder with no checkout still names its build, on Android and iOS', () => {
    const dir = pinnedAt('681\n');
    expect(buildNumber(dir)).toBe(681);
    const config = appConfig(context(dir));
    expect(config.android?.versionCode).toBe(681);
    expect(config.ios?.buildNumber).toBe('681');
  });

  it('is the number on an EAS worker', () => {
    expect(buildNumber(pinnedAt('681'), { EAS_BUILD: 'true' })).toBe(681);
  });

  it('is required on an EAS worker, whose shallow clone would count 1', () => {
    expect(() => buildNumber(root, { EAS_BUILD: 'true' })).toThrow(/build-number\.txt/);
    expect(buildNumber(root, { EAS_BUILD: 'false' })).toBe(count);
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
      expect(() => pinnedBuildNumber(pinnedAt(text)), JSON.stringify(text)).toThrow(
        /not a build number/,
      );
    }
  });
});

/** Prebuild's defaultConfig, as `android/app/build.gradle` held it at 658. */
const prebuilt = [
  '    defaultConfig {',
  "        applicationId 'com.seazn.capture'",
  '        versionCode 658',
  '        versionName "1.0.0"',
  '    }',
].join('\n');

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
