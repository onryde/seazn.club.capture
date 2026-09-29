// Why does the phone's player get 404 on a playlist the laptop reads fine? (output check, 2026-09-29)
//
//   node peek-probe.mjs <playbackUrl>
//
// Fetches the master and its first variant as hls-watch does, then the variant again with each LL-HLS
// delivery directive a player may add (_HLS_msn, _HLS_part, _HLS_skip), with a browser UA and with the
// player's own. Prints one line per request: status, UA, directives, and the variant's server-control tags.
const [url] = process.argv.slice(2);
if (!url) {
  console.error('usage: node peek-probe.mjs <playbackUrl>');
  process.exit(2);
}
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 16; NE2211) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const PLAYER_UA = 'ExoPlayerLib/1.8.0'; // media3's default shape; the exact version does not change the path

async function get(target, ua) {
  const response = await fetch(target, { headers: { 'User-Agent': ua } });
  return { status: response.status, body: await response.text() };
}
const strip = (u) => u.replace(/[a-f0-9]{32}/g, '<id>').replace(/([?&](?:lps|rcu|llhlsHBs)=)[^&]*/g, '$1…');

const master = await get(url, BROWSER_UA);
console.log(`master browser ${master.status}`);
const variantLine = master.body.split('\n').find((line) => line && !line.startsWith('#'));
if (!variantLine) {
  console.log('no variant in master');
  process.exit(1);
}
const variant = new URL(variantLine.trim(), url).toString();
const plain = await get(variant, BROWSER_UA);
const control = plain.body.split('\n').filter((l) => /SERVER-CONTROL|PART-INF|TARGETDURATION|MEDIA-SEQUENCE/.test(l));
const segments = plain.body.split('\n').filter((l) => l && !l.startsWith('#')).length;
const sequence = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(plain.body)?.[1] ?? 0);
const next = sequence + segments;
console.log(`variant ${strip(variant)}`);
console.log(`variant browser plain ${plain.status}; tags: ${control.join(' | ') || 'none'}; segments=${segments} nextMsn=${next}`);
const join = (base, extra) => base + (base.includes('?') ? '&' : '?') + extra;
const cases = [
  ['plain', ''],
  ['msn', `_HLS_msn=${next}`],
  ['msn+part', `_HLS_msn=${next}&_HLS_part=0`],
  ['skip', '_HLS_skip=YES'],
  ['msn+skip', `_HLS_msn=${next}&_HLS_skip=YES`],
];
for (const ua of [['browser', BROWSER_UA], ['player', PLAYER_UA]]) {
  for (const [name, extra] of cases) {
    const target = extra ? join(variant, extra) : variant;
    const started = Date.now();
    const result = await get(target, ua[1]);
    console.log(`${ua[0].padEnd(7)} ${name.padEnd(9)} ${result.status} in ${Date.now() - started} ms${result.status >= 400 ? ` body=${result.body.slice(0, 80).replace(/\s+/g, ' ')}` : ''}`);
  }
}
const masterPlayer = await get(url, PLAYER_UA);
console.log(`master player ${masterPlayer.status}${masterPlayer.status >= 400 ? ` body=${masterPlayer.body.slice(0, 80)}` : ''}`);
