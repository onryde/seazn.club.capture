// Tap a control only once a finger could actually reach it.
//   node tap-visible.mjs <regex> <serial> [minVisiblePx]
//
// uiautomator LISTS the off-screen children of a ScrollView and reports their
// bounds clipped to the viewport, so a row scrolled almost out of view comes back
// as a 36 px sliver, and its label as an inverted rectangle. H-P5-1 cell 1 tapped
// the centre of exactly that and hit the gap under the scroll view: the node's
// presence in the dump proved nothing about whether a tap could land on it.
//
// So: find the CLICKABLE node, require a visible height worth tapping, scroll its
// container to reveal it when it is clipped, and only then tap its centre.
import { execFileSync } from 'node:child_process';

const pattern = new RegExp(process.argv[2], 'i');
const serial = process.argv[3];
const minVisible = Number(process.argv[4] ?? 100);
if (serial === undefined) {
  console.error('usage: tap-visible.mjs <regex> <serial> [minVisiblePx]');
  process.exit(1);
}
const adb = (...args) =>
  execFileSync('adb', ['-s', serial, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dump() {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    adb('shell', 'rm', '-f', '/sdcard/tv.xml');
    let out = '';
    try {
      out = adb('shell', 'uiautomator', 'dump', '/sdcard/tv.xml');
    } catch (error) {
      out = String(error.stdout ?? '');
    }
    if (/dumped to/.test(out)) return adb('shell', 'cat', '/sdcard/tv.xml');
  }
  throw new Error('no fresh uiautomator dump');
}

function nodes() {
  return [...dump().matchAll(/<node ([^>]*?)\/?>/g)].map((match) => {
    const attr = (name) => match[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const [l, t, r, b] = (attr('bounds').match(/\d+/g) ?? ['0', '0', '0', '0']).map(Number);
    return {
      text: attr('text'),
      desc: attr('content-desc'),
      clickable: attr('clickable') === 'true',
      scrollable: attr('scrollable') === 'true',
      l,
      t,
      r,
      b,
    };
  });
}

for (let attempt = 1; attempt <= 5; attempt += 1) {
  const all = nodes();
  const target = all.find(
    (node) => node.clickable && (pattern.test(node.desc) || pattern.test(node.text)),
  );
  if (target === undefined) {
    console.error(`attempt ${attempt}: no clickable node matches ${pattern}`);
    process.exit(1);
  }
  const label = target.desc || target.text;
  const visible = target.b - target.t;
  if (visible >= minVisible) {
    const x = Math.round((target.l + target.r) / 2);
    const y = Math.round((target.t + target.b) / 2);
    // --dry reveals and reports without tapping, so the reveal logic can be
    // proven on the real layout without starting a publish.
    if (process.argv.includes('--dry')) {
      console.log(
        `DRY: would tap "${label}" at ${x},${y} (visible ${visible}px, attempt ${attempt})`,
      );
      process.exit(0);
    }
    adb('shell', 'input', 'tap', String(x), String(y));
    console.log(`tapped "${label}" at ${x},${y} (visible ${visible}px, attempt ${attempt})`);
    process.exit(0);
  }
  const container = all.find(
    (node) =>
      node.scrollable &&
      node.l <= target.l &&
      node.r >= target.r &&
      node.t <= target.t &&
      node.b >= target.b - 1,
  );
  if (container === undefined) {
    console.error(
      `attempt ${attempt}: "${label}" visible ${visible}px and no scroll container can reveal it`,
    );
    process.exit(1);
  }
  // Clipped at the container's bottom edge means the row lies below: drag the
  // content up. Otherwise it lies above: drag it down.
  const below = target.b >= container.b - 2;
  const x = Math.round((container.l + container.r) / 2);
  const [from, to] = below
    ? [container.b - 30, container.t + 30]
    : [container.t + 30, container.b - 30];
  adb('shell', 'input', 'swipe', String(x), String(from), String(x), String(to), '400');
  console.log(
    `attempt ${attempt}: "${label}" visible ${visible}px; scrolled ${below ? 'to reveal below' : 'to reveal above'}`,
  );
  await sleep(800);
}
console.error(`could not reveal ${pattern} after 5 attempts`);
process.exit(1);
