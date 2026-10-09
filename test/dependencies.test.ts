import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** D2 §4.1: the score preview was the WebView's only user, so the native dependency went with it. */
describe('native dependencies', () => {
  it('carries no WebView', () => {
    expect(Object.keys(pkg.dependencies)).not.toContain('react-native-webview');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('react-native-webview');
    // Anti-vacuity: this is the app's own manifest, which carries the viewers' video player.
    expect(Object.keys(pkg.dependencies)).toContain('expo-video');
  });
});
