import type { ExpoConfig } from 'expo/config';

/**
 * The version the Home footer shows: `<version>-<number>`, as native reports it in the record and on every beat
 * (EngineHost.kt), so what the operator reads names the build the record names (owner, 2026-10-27: "I don't see
 * build number"). The number is the one app.config.ts wrote into the embedded config, the commit count when the
 * bundle was made, in the same build as the native number. A config with no number shows the version alone. Pure,
 * so it is tested apart from `createNativePorts`.
 */
export function appVersionOf(
  config: Pick<ExpoConfig, 'version' | 'android' | 'ios'> | null | undefined,
  os: string,
): string {
  const version = config?.version ?? '0.0.0';
  const number = os === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode;
  return number === undefined ? version : `${version}-${number}`;
}
