import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every permission the store build declares is one Play asks about, in the install dialog and in the Data safety
 * form. Dependencies and Expo's app template add five the app never uses, so app.json blocks them:
 *
 * - READ/WRITE_EXTERNAL_STORAGE (Expo's template, capped at Android 12): minSdk is 31, Take photo writes through
 *   MediaStore (`GalleryPhoto.kt`), the record lives in `filesDir`, and Share record sends text.
 * - SYSTEM_ALERT_WINDOW (Expo's template): nothing draws over other apps.
 * - ACTIVITY_RECOGNITION (expo-sensors, for its pedometer): the app reads the accelerometer only.
 * - USE_BIOMETRIC, USE_FINGERPRINT (androidx.biometric, through expo-secure-store): no store read asks for
 *   authentication.
 *
 * WRITE_SETTINGS is blocked for the idle dim, which sets the window's brightness only (AGENTS §11).
 */
type AppJson = {
  readonly expo: { readonly android: { readonly blockedPermissions?: readonly string[] } };
};

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const blocked = (JSON.parse(read('../app.json')) as AppJson).expo.android.blockedPermissions ?? [];

describe('the Android permissions app.json blocks', () => {
  it.each([
    'android.permission.WRITE_SETTINGS',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.ACTIVITY_RECOGNITION',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
  ])('blocks %s, which nothing in the app uses', (permission) => {
    expect(blocked).toContain(permission);
  });

  it('blocks none of the permissions the capture engine declares', () => {
    const declared = [
      ...read('../modules/capture-engine/android/src/main/AndroidManifest.xml').matchAll(
        /uses-permission android:name="([^"]+)"/g,
      ),
    ].map((match) => match[1]);
    expect(declared).toEqual(
      expect.arrayContaining(['android.permission.CAMERA', 'android.permission.RECORD_AUDIO']),
    );
    expect(blocked.filter((permission) => declared.includes(permission))).toEqual([]);
  });
});
