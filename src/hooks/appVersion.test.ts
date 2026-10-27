import { describe, expect, it } from 'vitest';
import { appVersionOf } from '@/hooks/appVersion';

/** The embedded config as build 661 carried it (app.config.ts). */
const built = { version: '1.0.0', android: { versionCode: 661 }, ios: { buildNumber: '661' } };

describe('the version the Home footer shows', () => {
  it('is the version and the build number, as the record names the build', () => {
    expect(appVersionOf(built, 'android')).toBe('1.0.0-661');
    expect(appVersionOf({ ...built, ios: { buildNumber: '662' } }, 'ios')).toBe('1.0.0-662');
  });

  it('reads each platform’s own number, never the other’s', () => {
    expect(appVersionOf({ version: '1.0.0', ios: { buildNumber: '7' } }, 'android')).toBe('1.0.0');
    expect(appVersionOf({ version: '1.0.0', android: { versionCode: 7 } }, 'ios')).toBe('1.0.0');
  });

  it('is the version alone when the config has no number, and 0.0.0 with no config', () => {
    expect(appVersionOf({ version: '1.0.0' }, 'android')).toBe('1.0.0');
    expect(appVersionOf(null, 'android')).toBe('0.0.0');
    expect(appVersionOf(undefined, 'web')).toBe('0.0.0');
  });
});
