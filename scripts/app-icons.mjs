// Renders the app's icons and splash image from their SVG masters in
// assets/brand/ (the web's app tile, logo-square.png, redrawn: night, the lime
// pitch line and the red ball). Run it after changing a master, then rebuild:
// icons are native files, so a phone shows a change only after a prebuild.
// It draws with headless Chrome, which reads SVG as a browser does; CHROME
// names the binary where it is not at macOS's usual path.
//
//   node scripts/app-icons.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = fileURLToPath(new URL('..', import.meta.url));

/** Each master, where its PNG goes and its size in pixels. */
const renders = [
  ['icon', 'assets/icon.png', 1024],
  ['android-icon-foreground', 'assets/android-icon-foreground.png', 1024],
  ['android-icon-background', 'assets/android-icon-background.png', 1024],
  ['android-icon-monochrome', 'assets/android-icon-monochrome.png', 1024],
  ['splash-icon', 'assets/splash-icon.png', 1024],
  // Play Console's store icon, uploaded by hand (docs/release.md).
  ['icon', 'assets/store/play-icon-512.png', 512],
];

const scratch = mkdtempSync(join(tmpdir(), 'app-icons-'));
try {
  for (const [master, out, size] of renders) {
    const shot = join(scratch, 'shot.png');
    const scale = size / 1024;
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        `--force-device-scale-factor=${scale}`,
        '--window-size=1024,1024',
        `--screenshot=${shot}`,
        `file://${join(root, 'assets/brand', `${master}.svg`)}`,
      ],
      { stdio: 'ignore' },
    );
    renameSync(shot, join(root, out));
    console.log(`${out} ← assets/brand/${master}.svg (${size} px)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
