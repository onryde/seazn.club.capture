import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The app's icons and splash image are Seazn's (owner, 2026-10-30: "fix icons"), drawn by
 * `scripts/app-icons.mjs` from the masters in `assets/brand/`. Until then the phone showed Expo's
 * template chevron and a grey grid on the splash; these hashes are those template files, so a copy
 * of the template coming back fails here rather than on a launcher.
 */
const TEMPLATE = new Set([
  '119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f',
  '9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391',
  'fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d',
  '6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83',
  '5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8',
]);

const file = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));

/** Width, height and colour type from a PNG's IHDR chunk: 2 is RGB, 6 is RGB with alpha. */
const header = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
  colourType: png[25],
});

type AppJson = {
  readonly expo: {
    readonly icon: string;
    readonly android: {
      readonly adaptiveIcon: Readonly<
        Record<'foregroundImage' | 'backgroundImage' | 'monochromeImage', string>
      >;
    };
    readonly plugins: readonly unknown[];
  };
};
const expo = (JSON.parse(file('app.json').toString('utf8')) as AppJson).expo;
const splash = expo.plugins.find(
  (p): p is [string, { image: string }] => Array.isArray(p) && p[0] === 'expo-splash-screen',
);

const assets = [
  { name: 'icon', path: expo.icon, colourType: 2 },
  { name: 'adaptive foreground', path: expo.android.adaptiveIcon.foregroundImage, colourType: 6 },
  { name: 'adaptive background', path: expo.android.adaptiveIcon.backgroundImage, colourType: 2 },
  { name: 'adaptive monochrome', path: expo.android.adaptiveIcon.monochromeImage, colourType: 6 },
  { name: 'splash', path: splash?.[1].image ?? 'no splash image', colourType: 6 },
];

describe('the app icons and splash (app.json)', () => {
  it.each(assets)('$name is a 1024 px square and not Expo’s template', ({ path }) => {
    const png = file(path);
    expect(header(png)).toMatchObject({ width: 1024, height: 1024 });
    expect(TEMPLATE.has(createHash('sha256').update(png).digest('hex'))).toBe(false);
  });

  it.each(assets)(
    '$name is opaque or transparent as its layer needs (iOS refuses an icon with alpha)',
    ({ path, colourType }) => {
      expect(header(file(path)).colourType).toBe(colourType);
    },
  );

  it('ships the Play store icon at 512 px, from the same master', () => {
    expect(header(file('assets/store/play-icon-512.png'))).toMatchObject({
      width: 512,
      height: 512,
    });
  });
});
