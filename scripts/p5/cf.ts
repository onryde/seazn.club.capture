/**
 * P5 Cloudflare CLI. Node strips the types itself; no build step.
 *
 *   node --env-file=.env.local scripts/p5/cf.ts verify
 *   node --env-file=.env.local scripts/p5/cf.ts create <run>
 *   node --env-file=.env.local scripts/p5/cf.ts cleanup <uid>
 *
 * .env.local: CF_ACCOUNT_ID, CF_API_TOKEN, CF_STREAM_CUSTOMER_SUBDOMAIN,
 * P5_OVERLAY_URL, and optionally P5_SRT_URL_OVERRIDE (run C).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildLiveInputRequest,
  echoMismatches,
  hlsManifestUrl,
  readCreatedInput,
  toSessionPayload,
} from './liveInput.ts';

const API = 'https://api.cloudflare.com/client/v4';

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — add it to .env.local`);
  }
  return value;
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}/accounts/${env('CF_ACCOUNT_ID')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('CF_API_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { success?: boolean; errors?: unknown; result?: unknown };
  if (!response.ok || json.success !== true) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

/** Account-scoped on purpose: /user/tokens/verify reports account tokens as invalid. */
async function verify(): Promise<void> {
  console.log(JSON.stringify(await call('GET', '/tokens/verify')));
}

async function create(run: string): Promise<void> {
  const request = buildLiveInputRequest(run);
  const result = await call('POST', '/stream/live_inputs', request);
  const input = readCreatedInput(result);
  const mismatches = echoMismatches(request, result);
  if (mismatches.length > 0) {
    await call('DELETE', `/stream/live_inputs/${input.uid}`);
    throw new Error(`Cloudflare changed settings; input deleted:\n  ${mismatches.join('\n  ')}`);
  }
  const playbackUrl = hlsManifestUrl(env('CF_STREAM_CUSTOMER_SUBDOMAIN'), input.uid);
  const payload = toSessionPayload(input, {
    overlayUrl: env('P5_OVERLAY_URL'),
    playbackUrl,
    srtUrlOverride: process.env.P5_SRT_URL_OVERRIDE,
  });
  mkdirSync('.p5', { recursive: true });
  writeFileSync(`.p5/${run}.input.json`, JSON.stringify(result, null, 2));
  writeFileSync(`.p5/${run}.session.json`, JSON.stringify(payload));
  console.log(`uid       ${input.uid}`);
  console.log(`playback  ${playbackUrl}`);
  console.log(
    `push      adb -s 12be753e push .p5/${run}.session.json /sdcard/Android/data/com.seazn.capture/files/p5-session.json`,
  );
}

async function cleanup(uid: string): Promise<void> {
  const videos = (await call('GET', `/stream/live_inputs/${uid}/videos`)) as readonly {
    uid: string;
  }[];
  for (const video of videos) {
    await call('DELETE', `/stream/${video.uid}`);
    console.log(`deleted recording ${video.uid}`);
  }
  await call('DELETE', `/stream/live_inputs/${uid}`);
  console.log(`deleted input ${uid}`);
  console.log(`storage   ${JSON.stringify(await call('GET', '/stream/storage-usage'))}`);
}

const [command, argument] = process.argv.slice(2);
const run = async (): Promise<void> => {
  if (command === 'verify') return verify();
  if (command === 'create' && argument !== undefined) return create(argument);
  if (command === 'cleanup' && argument !== undefined) return cleanup(argument);
  throw new Error('usage: cf.ts verify | create <run> | cleanup <uid>');
};
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
