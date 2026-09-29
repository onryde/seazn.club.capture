import type { NativeIntent } from 'expo-router';

/**
 * Ruling R22: no system link picks the screen. The reopen gate alone decides
 * where the app lands (spec §4), so the navigation port's `current()` is never
 * wrong about where the operator is.
 *
 * - Cold start (`initial`): whatever the link, start at Home's path; the gate
 *   then moves on from there.
 * - Warm (`!initial`): stay put. Returning `'/'` here would make Expo Router
 *   navigate to Home — off a live broadcast, behind the port's back. A null
 *   return is Expo Router's "no redirection" (expo-router 57.0.24,
 *   build/link/linking.js `subscribe`: `if (href) listener(href)`).
 */
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ initial }) =>
  initial ? '/' : null;
