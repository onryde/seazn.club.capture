import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAppBuildGradle } from 'expo/config-plugins';

/**
 * The file a production release's number is pinned in (owner, 2026-10-28: production releases build on EAS). EAS
 * uploads a shallow clone, where the commit count is 1, so the release workflow counts on its full checkout and writes
 * the count here before `eas build`, which uploads the untracked file with the project. Never committed and never
 * gitignored: EAS leaves a gitignored file out of the upload. Nothing else writes it.
 */
export const PINNED_BUILD_NUMBER = 'build-number.txt';

/**
 * The build's number: the commit count of the checkout it is built from, so every build a phone installs names its
 * commit on main (owner, 2026-10-26; before it every build was versionCode 1, and a record could not say which build
 * wrote it). `version` stays app.json's. Android reads it as versionCode, iOS as buildNumber, and the engine reports
 * `<version>-<number>` as the app version in the record and on every beat (EngineHost.kt).
 *
 * A pinned number ([PINNED_BUILD_NUMBER]) wins. Otherwise it throws, rather than fall back to 1, when git cannot
 * answer, and on an EAS worker with no pin, whose shallow clone would count 1: a build that cannot name itself should
 * not be made. A CI job's shallow checkout still counts what it fetched; its builds are never installed. Android reads
 * the count again when Gradle builds ([countedAtBuild]); iOS's is still written at prebuild, and iOS is not built yet.
 */
export function buildNumber(
  projectRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const pinned = pinnedBuildNumber(projectRoot);
  if (pinned !== null) return pinned;
  if (env.EAS_BUILD === 'true') {
    throw new Error(`An EAS build needs ${PINNED_BUILD_NUMBER}: its shallow clone would count 1`);
  }
  // git exits non-zero, and execFileSync throws, outside a checkout and before its first commit.
  return Number(
    execFileSync('git', ['-C', projectRoot, 'rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  );
}

/** The pinned number, or null with no pin. A pin that is not a whole number above 0 throws. */
export function pinnedBuildNumber(projectRoot: string): number | null {
  const path = join(projectRoot, PINNED_BUILD_NUMBER);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').trim();
  if (!/^[1-9]\d*$/.test(text))
    throw new Error(`${PINNED_BUILD_NUMBER} holds "${text}", not a build number`);
  return Number(text);
}

/**
 * Android's versionCode as Gradle reads it, the count when it builds (review of #25): a number written at prebuild stays
 * until the next prebuild, and `expo run:android` prebuilds only when `android/` is missing, so a build after new
 * commits would name an older one. `rootDir` is `android/`, so its parent is the checkout; a git that cannot answer fails
 * the build, as buildNumber throws.
 */
export const GRADLE_VERSION_CODE =
  "versionCode Integer.parseInt(providers.exec { commandLine 'git', '-C', rootDir.parentFile.absolutePath, 'rev-list', '--count', 'HEAD' }.standardOutput.asText.get().trim())";

/**
 * The app's build.gradle with its one versionCode line read at build time; again on a file already read so. With a
 * pinned number the line is that number: Gradle on an EAS worker would count its shallow clone.
 */
export function countedAtBuild(gradle: string, pinned: number | null = null): string {
  const line = /^(\s*)versionCode .+$/gm;
  const found = gradle.match(line)?.length ?? 0;
  if (found !== 1) throw new Error(`app/build.gradle has ${found} versionCode lines; expected 1`);
  return gradle.replace(
    line,
    `$1${pinned === null ? GRADLE_VERSION_CODE : `versionCode ${pinned}`}`,
  );
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const number = buildNumber(projectRoot);
  const pinned = pinnedBuildNumber(projectRoot);
  return withAppBuildGradle(
    {
      ...config,
      name: config.name ?? 'Seazn Capture',
      slug: config.slug ?? 'capture',
      android: { ...config.android, versionCode: number },
      ios: { ...config.ios, buildNumber: String(number) },
    },
    (gradle) => {
      gradle.modResults.contents = countedAtBuild(gradle.modResults.contents, pinned);
      return gradle;
    },
  );
};
