import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { afterEach, describe, expect, it } from 'vitest';
import appConfig, { buildNumber, countedAtBuild, GRADLE_VERSION_CODE } from '../app.config';

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

  it('refuses a file with no versionCode line, or two', () => {
    expect(() => countedAtBuild(prebuilt.replace('        versionCode 658\n', ''))).toThrow(
      /0 versionCode lines/,
    );
    expect(() => countedAtBuild(`${prebuilt}\n        versionCode 1`)).toThrow(
      /2 versionCode lines/,
    );
  });
});
