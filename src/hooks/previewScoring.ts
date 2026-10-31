import type { ExpoConfig } from 'expo/config';

/**
 * The word app.config.ts writes into `extra.appVariant` for every build that is not the store's (`APP_VARIANT` is not
 * `production`): the dev twin, a local release build included.
 */
export const DEV_VARIANT = 'dev';

/**
 * Whether Home's Remote scoring tile opens the S2 pad preview (the controller's brief, 2026-10-31): in the dev twin
 * only, never in the Play build, which keeps "Coming soon". Read from the embedded config, not `__DEV__`, so a local
 * release build of the dev twin shows it too. A config that does not say `dev` hides it: a build that cannot place
 * itself is treated as the store's. Pure, so it is tested apart from `createNativePorts`.
 */
export function previewScoringOf(config: Pick<ExpoConfig, 'extra'> | null | undefined): boolean {
  return config?.extra?.appVariant === DEV_VARIANT;
}
