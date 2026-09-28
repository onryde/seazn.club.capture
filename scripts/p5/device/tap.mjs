// Tap the centre of the first on-screen node whose text or content-desc matches.
//   node tap.mjs <regex> [serial]
import { execFileSync } from 'node:child_process';

const pattern = new RegExp(process.argv[2], 'i');
const serial = process.argv[3] ?? '12be753e';
const adb = (...args) =>
  execFileSync('adb', ['-s', serial, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function dump() {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    adb('shell', 'rm', '-f', '/sdcard/tap.xml');
    let out = '';
    try {
      out = adb('shell', 'uiautomator', 'dump', '/sdcard/tap.xml');
    } catch (e) {
      out = String(e.stdout ?? '');
    }
    if (/dumped to/.test(out)) return adb('shell', 'cat', '/sdcard/tap.xml');
  }
  throw new Error('no fresh uiautomator dump');
}

const nodes = [...dump().matchAll(/<node ([^>]*?)\/?>/g)].map((m) => {
  const attr = (name) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
  const [l, t, r, b] = attr('bounds').match(/\d+/g).map(Number);
  return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), l, t, r, b };
});
// "class:Switch" targets a widget class instead of a label.
const byClass = process.argv[2].startsWith('class:')
  ? new RegExp(process.argv[2].slice(6), 'i')
  : null;
const hits = nodes.filter((n) =>
  byClass ? byClass.test(n.cls) : pattern.test(n.text) || pattern.test(n.desc),
);
const hit = hits[Number(process.argv[4] ?? 0)];
if (!hit) {
  console.error(
    `no node matches ${pattern}; texts: ${nodes
      .map((n) => n.text)
      .filter(Boolean)
      .join(' | ')}`,
  );
  process.exit(1);
}
const x = Math.round((hit.l + hit.r) / 2);
const y = Math.round((hit.t + hit.b) / 2);
adb('shell', 'input', 'tap', String(x), String(y));
console.log(`tapped "${hit.text || hit.desc}" at ${x},${y}`);
