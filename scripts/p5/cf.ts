/**
 * P5 Cloudflare CLI. Node strips the types itself; no build step.
 *
 *   node --env-file=.env.local scripts/p5/cf.ts verify
 *   node --env-file=.env.local scripts/p5/cf.ts create <run>
 *   node --env-file=.env.local scripts/p5/cf.ts storage
 *   node --env-file=.env.local scripts/p5/cf.ts videos <uid>
 *   node --env-file=.env.local scripts/p5/cf.ts cleanup <uid>
 *
 * .env.local: CF_ACCOUNT_ID, CF_API_TOKEN, P5_OVERLAY_URL, and optionally
 * P5_SRT_URL_OVERRIDE (run C) and CF_STREAM_CUSTOMER_SUBDOMAIN — the subdomain
 * is read from the create response, so it is an override, not a prerequisite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildLiveInputRequest,
  customerSubdomain,
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

/**
 * Cloudflare storage is prepaid CAPACITY, not a monthly allowance, and
 * exhausting it blocks STARTING a new live stream rather than only an upload.
 * A mid-run recording is a new video, so capacity has to be read BEFORE the
 * moment a run depends on one appearing — otherwise "no second recording" and
 * "the platform does not split past the hold window" look identical.
 *
 * Deletions show up in under 10 s but additions land minutes late, and the
 * figure is not monotonic: treat a reading as a baseline, never a live gauge.
 */
async function storage(): Promise<void> {
  console.log(JSON.stringify(await call('GET', '/stream/storage-usage')));
}

/**
 * What Cloudflare kept for one input. READ ONLY — deleting is `cleanup`'s job
 * and nothing else's. Criteria 4 and 5 are counts of these videos (one recording
 * for a drop inside the hold window, two for a drop past it), so reading them
 * has to be possible without touching them.
 */
async function videos(uid: string): Promise<void> {
  const list = (await call('GET', `/stream/live_inputs/${uid}/videos`)) as readonly {
    uid: string;
    duration?: number;
    created?: string;
    status?: { state?: string };
  }[];
  for (const video of list) {
    const state = video.status?.state ?? 'unknown';
    console.log(`${video.uid} ${state} ${video.duration ?? '?'}s created=${video.created ?? '?'}`);
  }
  console.log(`count ${list.length}`);
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
  // Both reads can fail on a response or an environment we only see now, and both
  // fail after the input exists. P5_OVERLAY_URL in particular is the one variable
  // still missing, so this is the likely path, not the theoretical one.
  const payload = await orphanGuard(input.uid, () =>
    toSessionPayload(input, {
      overlayUrl: env('P5_OVERLAY_URL'),
      playbackUrl: hlsManifestUrl(
        customerSubdomain(result, process.env.CF_STREAM_CUSTOMER_SUBDOMAIN),
        input.uid,
      ),
      srtUrlOverride: process.env.P5_SRT_URL_OVERRIDE,
    }),
  );
  mkdirSync('.p5', { recursive: true });
  writeFileSync(`.p5/${run}.input.json`, JSON.stringify(result, null, 2));
  writeFileSync(`.p5/${run}.session.json`, JSON.stringify(payload));
  console.log(`uid       ${input.uid}`);
  console.log(`playback  ${payload.playbackUrl}`);
  console.log(
    `push      adb -s 12be753e push .p5/${run}.session.json /sdcard/Android/data/com.seazn.capture/files/p5-session.json`,
  );
}

/**
 * An input we created but cannot use is an orphan on the account, and the caller
 * never sees its uid to clean it up by hand. Delete it, then fail with the real
 * reason — the same bargain the echo check above makes. (`readCreatedInput` is
 * the one hole left: the uid it would need is the thing it failed to read.)
 */
async function orphanGuard<T>(uid: string, read: () => T): Promise<T> {
  try {
    return read();
  } catch (failure) {
    await call('DELETE', `/stream/live_inputs/${uid}`);
    throw failure;
  }
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
  if (command === 'storage') return storage();
  if (command === 'videos' && argument !== undefined) return videos(argument);
  if (command === 'create' && argument !== undefined) return create(argument);
  if (command === 'cleanup' && argument !== undefined) return cleanup(argument);
  throw new Error('usage: cf.ts verify | storage | videos <uid> | create <run> | cleanup <uid>');
};
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
