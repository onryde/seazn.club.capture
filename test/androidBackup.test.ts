import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What Android's Auto Backup takes off the phone (MD-2 Task 3 fix round 1, the controller's ruling: Match Day's copy
 * of its day, players' names in a cache, stays on the phone). The app writes no backup rules of its own: the manifest
 * points at expo-secure-store's (`configureAndroidBackup` in app.json; the dev twin's prebuilt manifest reads
 * `android:dataExtractionRules="@xml/secure_store_data_extraction_rules"`). Those rules INCLUDE shared preferences
 * and nothing else, and an `<include>` turns the default off: "If you specify an `<include>` element, the system no
 * longer includes any files by default and backs up only the files specified"
 * (developer.android.com/identity/data/autobackup, "Syntax for include and exclude elements"). So the document
 * directory (`getFilesDir()`, the `file` domain: expo-file-system's `Paths.document`), where `matchday/` and the tap
 * queue's `scoring/` live, is never backed up or carried to a new phone. This pins each link of that chain, so a rule
 * that starts including files fails here. What a phone does is a device claim.
 */
const root = join(__dirname, '..');
const secureStore = dirname(
  createRequire(join(root, 'package.json')).resolve('expo-secure-store/package.json'),
);
const rules = (name: string): string =>
  readFileSync(join(secureStore, 'android/src/main/res/xml', name), 'utf8');

/** The `<include>` and `<exclude>` lines of one section of a rules file. */
function section(xml: string, tag: string): { include: string[]; exclude: string[] } {
  const body = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
  if (body === undefined) throw new Error(`no <${tag}> section`);
  const domains = (kind: string) =>
    [...body.matchAll(new RegExp(`<${kind}\\s+domain="([^"]+)"\\s+path="([^"]+)"`, 'g'))].map(
      (match) => `${match[1] ?? ''}:${match[2] ?? ''}`,
    );
  return { include: domains('include'), exclude: domains('exclude') };
}

describe('Android Auto Backup leaves the document directory on the phone', () => {
  it('the app hands its backup rules to expo-secure-store', () => {
    const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
      expo: { plugins: unknown[] };
    };
    const plugin = app.expo.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-secure-store',
    );
    expect(plugin).toEqual([
      'expo-secure-store',
      expect.objectContaining({ configureAndroidBackup: true }),
    ]);
  });

  it('on Android 12 and later, cloud backup and a device transfer include shared preferences alone', () => {
    const xml = rules('secure_store_data_extraction_rules.xml');
    // A section that is missing is a mode fully on (the same page): both must be there.
    for (const tag of ['cloud-backup', 'device-transfer']) {
      expect(section(xml, tag)).toEqual({
        include: ['sharedpref:.'],
        exclude: ['sharedpref:SecureStore'],
      });
    }
  });

  it('on Android 11 and earlier too', () => {
    expect(section(rules('secure_store_backup_rules.xml'), 'full-backup-content')).toEqual({
      include: ['sharedpref:.'],
      exclude: ['sharedpref:SecureStore'],
    });
  });

  it('nothing of ours writes other backup rules over them', () => {
    const plugins = readdirSync(join(root, 'modules')).flatMap((module) => {
      try {
        return [readFileSync(join(root, 'modules', module, 'app.plugin.ts'), 'utf8')];
      } catch {
        return [];
      }
    });
    const ours = [
      readFileSync(join(root, 'app.json'), 'utf8'),
      readFileSync(join(root, 'app.config.ts'), 'utf8'),
      ...plugins,
    ];
    // Anti-vacuity: the app's config, its config file and the engine's plugin are read.
    expect(ours.length).toBeGreaterThanOrEqual(3);
    for (const text of ours) {
      expect(text).not.toMatch(/dataExtractionRules|fullBackupContent|allowBackup|backup_rules/);
    }
  });
});
