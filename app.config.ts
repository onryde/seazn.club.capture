import { execFileSync } from 'node:child_process';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAppBuildGradle } from 'expo/config-plugins';

/**
 * The build's number: the commit count of the checkout it is built from, so every build a phone installs names its
 * commit on main (owner, 2026-10-26; before it every build was versionCode 1, and a record could not say which build
 * wrote it). `version` stays app.json's. Android reads it as versionCode, iOS as buildNumber, and the engine reports
 * `<version>-<number>` as the app version in the record and on every beat (EngineHost.kt).
 *
 * It throws, rather than fall back to 1, when git cannot answer: a build that cannot name itself should not be made.
 * A shallow clone counts only what it fetched, so a CI build's number names nothing; only local builds are installed
 * (AGENTS §11). Android reads it again when Gradle builds ([countedAtBuild]); iOS's is still written at prebuild, and
 * iOS is not built yet.
 */
export function buildNumber(projectRoot: string): number {
  // git exits non-zero, and execFileSync throws, outside a checkout and before its first commit.
  return Number(
    execFileSync('git', ['-C', projectRoot, 'rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  );
}

/**
 * Android's versionCode as Gradle reads it, the count when it builds (review of #25): a number written at prebuild stays
 * until the next prebuild, and `expo run:android` prebuilds only when `android/` is missing, so a build after new
 * commits would name an older one. `rootDir` is `android/`, so its parent is the checkout; a git that cannot answer fails
 * the build, as buildNumber throws.
 */
export const GRADLE_VERSION_CODE =
  "versionCode Integer.parseInt(providers.exec { commandLine 'git', '-C', rootDir.parentFile.absolutePath, 'rev-list', '--count', 'HEAD' }.standardOutput.asText.get().trim())";

/** The app's build.gradle with its one versionCode line read at build time; again on a file already read so. */
export function countedAtBuild(gradle: string): string {
  const line = /^(\s*)versionCode .+$/gm;
  const found = gradle.match(line)?.length ?? 0;
  if (found !== 1) throw new Error(`app/build.gradle has ${found} versionCode lines; expected 1`);
  return gradle.replace(line, `$1${GRADLE_VERSION_CODE}`);
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const number = buildNumber(projectRoot);
  return withAppBuildGradle(
    {
      ...config,
      name: config.name ?? 'Seazn Capture',
      slug: config.slug ?? 'capture',
      android: { ...config.android, versionCode: number },
      ios: { ...config.ios, buildNumber: String(number) },
    },
    (gradle) => {
      gradle.modResults.contents = countedAtBuild(gradle.modResults.contents);
      return gradle;
    },
  );
};
