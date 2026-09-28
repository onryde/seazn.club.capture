// Cable-free soak, part 2 of 3: watch the run from the laptop and exit the moment it
// needs a person, so whoever launched this is woken up rather than polling.
//
//   node soak-alarm.mjs <outPrefix> <endEpochMs> [sinceEpochMs]
//
// Reads <outPrefix>.hls.csv (hls-watch.ts) and <outPrefix>.cfstatus.csv
// (cf-status-watch.mjs), both written by samplers that outlive this process.
// `sinceEpochMs` ignores older rows, so a relaunch after an alarm that was handled
// does not fire again on the same evidence.
//
// Exit codes: 0 end time reached · 10 no playlist advance for STALL_ALARM_MS ·
// 11 Cloudflare reports the input not connected · 12 a sampler stopped writing.
// A short stall is not an alarm: a cellular run can freeze for 10 s and recover
// (reconnect cell, 2026-09-14), and those episodes are counted, not escalated.
import { readFileSync, statSync } from 'node:fs';

const [prefix, endArg, sinceArg] = process.argv.slice(2);
if (prefix === undefined || endArg === undefined) {
  console.error('usage: soak-alarm.mjs <outPrefix> <endEpochMs> [sinceEpochMs]');
  process.exit(2);
}
const END_MS = Number(endArg);
const SINCE_MS = Number(sinceArg ?? 0);
const STALL_ALARM_MS = 60_000;
const SILENT_SAMPLER_MS = 60_000;
const CHECK_MS = 10_000;

const rows = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^\d/.test(line))
    .map((line) => line.split(','));

function check(now) {
  for (const file of [`${prefix}.hls.csv`, `${prefix}.cfstatus.csv`]) {
    const age = now - statSync(file).mtimeMs;
    if (age > SILENT_SAMPLER_MS)
      return [12, `${file} has not been written for ${Math.round(age / 1000)} s`];
  }
  const polls = rows(`${prefix}.hls.csv`).filter((r) => Date.parse(r[0]) >= SINCE_MS);
  const advances = polls.filter((r) => r[6] === 'advancing');
  const lastAdvance = advances.length ? Date.parse(advances.at(-1)[0]) : SINCE_MS;
  if (advances.length && now - lastAdvance > STALL_ALARM_MS) {
    const last = polls.at(-1);
    return [
      10,
      `no advance since ${new Date(lastAdvance).toISOString()}; last poll ${last.join(',').slice(0, 160)}`,
    ];
  }
  const status = rows(`${prefix}.cfstatus.csv`)
    .filter((r) => Number(r[0]) >= SINCE_MS)
    .at(-1);
  if (status && status[1] === '200' && status[2] !== '' && status[2] !== 'connected') {
    return [11, `Cloudflare status ${status[2]} (${status[3]}) since ${status[4]}`];
  }
  return null;
}

function summary() {
  const polls = rows(`${prefix}.hls.csv`).filter((r) => Date.parse(r[0]) >= SINCE_MS);
  let episodes = 0;
  let inStall = false;
  for (const r of polls) {
    if (r[6] === 'stalled' && !inStall) episodes += 1;
    inStall = r[6] === 'stalled';
  }
  return `polls ${polls.length}, stalled episodes ${episodes}`;
}

for (;;) {
  const now = Date.now();
  let alarm = null;
  try {
    alarm = check(now);
  } catch (error) {
    alarm = [12, `could not read sampler output: ${error.message}`];
  }
  if (alarm !== null) {
    console.log(`${new Date(now).toISOString()} ALARM ${alarm[0]}: ${alarm[1]} (${summary()})`);
    process.exit(alarm[0]);
  }
  if (now >= END_MS) {
    console.log(`${new Date(now).toISOString()} END reached (${summary()})`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, CHECK_MS));
}
