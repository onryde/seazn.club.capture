import { execFileSync } from 'node:child_process';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The build's number: the commit count of the checkout it is built from, so every build a phone installs names its
 * commit on main (owner, 2026-10-26; before it every build was versionCode 1, and a record could not say which build
 * wrote it). `version` stays app.json's. Android reads it as versionCode, iOS as buildNumber, and the engine reports
 * `<version>-<number>` as the app version in the record and on every beat (EngineHost.kt).
 *
 * It throws, rather than fall back to 1, when git cannot answer: a build that cannot name itself should not be made.
 * A shallow clone counts only what it fetched, so a CI build's number names nothing; only local builds are installed
 * (AGENTS §11).
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

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const number = buildNumber(projectRoot);
  return {
    ...config,
    name: config.name ?? 'Seazn Capture',
    slug: config.slug ?? 'capture',
    android: { ...config.android, versionCode: number },
    ios: { ...config.ios, buildNumber: String(number) },
  };
};
