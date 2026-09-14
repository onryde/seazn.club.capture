# P5 Device Spike (Android) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether StreamPack in our React Native shell can publish 720p30/3000k from a OnePlus 10 Pro for three hours into a real Cloudflare live input, with the overlay WebView on, the screen locked part-way, and the uplink dropped inside and beyond the hold window, and record the thermal, orientation, reconnect and playback numbers that gate the architecture (P5).

**Architecture:** Throwaway code on branch `spike/p5-android`, never merged. One local Expo module (`modules/p5-spike`) owns the native session: StreamPack streamer, reconnect/fallback loop, 1 Hz telemetry to a CSV on the phone, and a camera+microphone foreground service. One spike screen renders the native preview with the Tier A overlay always visible on top (the worst case for heat, N4). Laptop tooling in `scripts/p5/` creates, verifies and cleans up Cloudflare live inputs, and watches the HLS playlist the way the main repo's U1 spike did. Only the results document and `_FINDINGS.md` updates reach `main`.

**Tech Stack:** Expo SDK 57 local module (Kotlin), StreamPack 3.2.0 (`core`, `ui`, `srt`, `rtmp`), React Native 0.86, expo-video, react-native-webview, Node 26 (native TypeScript stripping) for scripts, vitest, EAS Build (cloud) or local Gradle.

**Spec:** `docs/specs/2026-09-10-capture-app-design.md` §11 step 2 (the P5 spike), with `_FINDINGS.md` N4 (overlay on during thermals), N12 (licences, never fork libsrt), N14 (Android first). Cloudflare behaviour: seazn.club `docs/superpowers/specs/2026-09-11-cloudflare-stream-measured.md` (branch `feat/stream-w2-moments` until merged): U1-S2, U1-S4, U1-S6, U1-S7, U1-S9.

## Global Constraints

- Encode ceiling: **1280×720, 30 fps, 3 000 000 bps video**, AAC 128 kbps 48 kHz stereo, **GOP 2 s** (Cloudflare constrains contributor GOP: `ERR_GOP_OUT_OF_RANGE`).
- SRT latency **2000 ms** (design §4).
- Hold window: `recording.timeoutSeconds = 180` (seazn.club ruling 26). Nothing in either repo sets it; the spike sets it on create and **asserts the echo**.
- Recording **on** (`mode: automatic`) and **deleted after every run**. Deleting a live input does not delete its recordings (U1-S9); `deleteRecordingAfterDays` floors at 30 (U1-S4) and is a backstop only.
- **One Cloudflare account, shared, prepaid storage** (1000-minute block). A 3 h run holds ~180 min until cleanup.
- **Staging only:** overlay from `https://stg.seazn.club/overlay/fixtures/<id>`. Football fixture, **in play** for the whole run (only an in-play football fixture runs the overlay's 1 Hz clock — the worst case).
- **Credentials never enter chat, git, or the JS bundle.** `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_STREAM_CUSTOMER_SUBDOMAIN`, `P5_OVERLAY_URL` live in `.env.local` (gitignored). The session payload reaches the phone by `adb push`, never by bundling. `.p5/` is gitignored.
- Verify the token at `/accounts/{id}/tokens/verify`, **not** `/user/tokens/verify` (the user endpoint falsely reports account tokens invalid).
- Anything polling an HLS manifest outside a browser sends a **browser User-Agent** (U1-S6: non-browser UA → `403 error code: 1010`).
- Handset: OnePlus 10 Pro, model `NE2211`, SM8450, Android 16 (API 36), adb serial `12be753e`. Power: **charging from a power bank while streaming** (the realistic ground setup).
- libsrt is a dependency, **never forked** (MPL-2.0, N12). StreamPack is Apache-2.0.
- Spike code still passes `pnpm check` (typecheck, lint, tests). Styles use `@/ui/theme/tokens`, never colour literals.
- **Throwaway:** nothing under `modules/p5-spike`, `scripts/p5`, or the spike screen is ever merged to `main`.

---

## File Structure

All on branch `spike/p5-android` unless marked **main**.

| Path | Responsibility |
|---|---|
| `scripts/p5/liveInput.ts` | Pure: build the live-input request, check the echo, read the create response, map it to the phone's session payload |
| `scripts/p5/liveInput.test.ts` | Tests for the above, including a round trip through the app's own `parseSessionCredentials` |
| `scripts/p5/cf.ts` | CLI: `verify`, `create <run>`, `cleanup <uid>` against the Cloudflare API |
| `scripts/p5/playlist.ts` | Pure: parse master/variant playlists, decide advancing / stalled / ended |
| `scripts/p5/playlist.test.ts` | Tests for the above |
| `scripts/p5/hls-watch.ts` | CLI: poll the manifest with a browser UA, print a CSV line per poll |
| `modules/p5-spike/expo-module.config.json` | Registers the Kotlin module (scaffolded) |
| `modules/p5-spike/android/build.gradle` | StreamPack dependencies |
| `modules/p5-spike/android/src/main/AndroidManifest.xml` | Permissions and the foreground service |
| `modules/p5-spike/android/src/main/java/com/seazn/p5spike/P5SpikeModule.kt` | The JS surface: `arm`, `start`, `stop`, `mark`, `logPath`, events, the preview view |
| `.../SpikeSession.kt` | The streamer, the publish/reconnect/fallback loop, rotation |
| `.../SessionFile.kt` | Reads `p5-session.json` pushed by adb |
| `.../SpikeTelemetry.kt` | 1 Hz sample: thermal, battery, power draw, network, screen, stream |
| `.../SpikeLog.kt` | CSV writer on the phone |
| `.../SpikeForegroundService.kt` | `camera|microphone` foreground service plus a partial wake lock |
| `.../SpikePreviewView.kt` | ExpoView wrapping StreamPack's `PreviewView` |
| `modules/p5-spike/src/P5SpikeModule.ts` | Typed native module |
| `modules/p5-spike/src/P5SpikePreview.tsx` | Typed native view |
| `modules/p5-spike/src/spikeStore.ts` | External store over native events, for `useSyncExternalStore` |
| `modules/p5-spike/src/SpikeScreen.tsx` | Preview, always-on overlay, HUD, controls, output check |
| `App.tsx` | Renders `SpikeScreen` when `EXPO_PUBLIC_SEAZN_SOAK === '1'` |
| `eas.json` | `soak` profile becomes a standalone APK with the JS embedded |
| `docs/specs/2026-09-11-p5-android-results.md` (**main**) | Protocol, pass criteria, results |

---

### Task 0 (optional, decide first): local Android toolchain

EAS's free-tier queue has held a single build for more than 30 minutes. The spike needs about three native builds. Local builds remove the queue. This is an Intel Mac, so Gradle builds are slow (roughly 5–15 min) but they don't queue.

- [ ] **Step 1: Ask the user** whether to install the local toolchain (about 3–4 GB: JDK 17, Android SDK platform 36, build-tools, NDK, CMake). If no, skip to Task 1 and use the EAS commands wherever this plan says "build".

- [ ] **Step 2 (if yes): install**

```bash
brew install --cask temurin@17 android-commandlinetools
export ANDROID_HOME="$HOME/Library/Android/sdk"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

Add `export ANDROID_HOME="$HOME/Library/Android/sdk"` and `export JAVA_HOME="$(/usr/libexec/java_home -v 17)"` to `~/.zshrc`.

- [ ] **Step 3: prove it**

Run: `cd /Users/ashokhein/github/seazn.club.capture && pnpm expo run:android --device 12be753e`
Expected: Gradle builds, the app installs and launches on the OnePlus, the mock viewfinder appears. (`/android` is gitignored; prebuild output is disposable.)

**Build commands used later:** local `pnpm expo run:android --device 12be753e`; EAS `pnpm eas build --profile development --platform android --non-interactive --no-wait`, then install the result with Orbit.

---

### Task 1: Spike branch and Cloudflare live-input tooling

**Files:**
- Create: `scripts/p5/liveInput.ts`, `scripts/p5/liveInput.test.ts`, `scripts/p5/cf.ts`
- Modify: `vitest.config.mts` (include), `tsconfig.json` (`allowImportingTsExtensions`), `.gitignore` (`.p5/`), `package.json` (`@types/node`)

**Interfaces:**
- Produces: `buildLiveInputRequest(run: string): LiveInputRequest`, `echoMismatches(sent, echoed: unknown): readonly string[]`, `readCreatedInput(result: unknown): CreatedInput`, `hlsManifestUrl(subdomain: string, uid: string): string`, `toSessionPayload(input: CreatedInput, opts: SessionOptions): SessionPayload`; files `.p5/<run>.input.json` and `.p5/<run>.session.json`.

- [ ] **Step 1: Branch and wire the tooling**

```bash
cd /Users/ashokhein/github/seazn.club.capture
git switch -c spike/p5-android
pnpm add -D @types/node
printf '\n# P5 spike: Cloudflare responses and session payloads carry credentials\n.p5/\n' >> .gitignore
```

In `vitest.config.mts`, change the include line to:

```ts
    include: ['src/**/*.test.ts', 'modules/**/*.test.ts', 'scripts/**/*.test.ts'],
```

In `tsconfig.json`, add inside `compilerOptions` (Node's type stripping needs explicit `.ts` import extensions, and the base config already sets `noEmit`):

```json
    "allowImportingTsExtensions": true,
```

- [ ] **Step 2: Write the failing tests** — `scripts/p5/liveInput.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseSessionCredentials } from '@/domain/credentials/parseSessionCredentials';
import {
  buildLiveInputRequest,
  echoMismatches,
  hlsManifestUrl,
  readCreatedInput,
  toSessionPayload,
} from './liveInput.ts';

const CREATED = {
  uid: 'abc123',
  srt: { url: 'srt://live.cloudflare.com:778', streamId: 'sid-1', passphrase: 'pass-1' },
  rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'key-1' },
  recording: { mode: 'automatic', timeoutSeconds: 180 },
  deleteRecordingAfterDays: 30,
};

const OPTIONS = {
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/f1',
  playbackUrl: 'https://customer-x.cloudflarestream.com/abc123/manifest/video.m3u8',
};

describe('buildLiveInputRequest', () => {
  it('asks for the ruled hold window with automatic recording and the 30-day backstop', () => {
    expect(buildLiveInputRequest('run-a')).toEqual({
      meta: { name: 'p5-spike-run-a' },
      recording: { mode: 'automatic', timeoutSeconds: 180 },
      deleteRecordingAfterDays: 30,
    });
  });
});

describe('echoMismatches', () => {
  it('is empty when Cloudflare echoes every setting back', () => {
    expect(echoMismatches(buildLiveInputRequest('r'), CREATED)).toEqual([]);
  });

  it('catches timeoutSeconds coming back null — the silent platform-default trap', () => {
    const echoed = { ...CREATED, recording: { mode: 'automatic', timeoutSeconds: null } };
    expect(echoMismatches(buildLiveInputRequest('r'), echoed)).toEqual([
      'recording.timeoutSeconds: sent 180, got null',
    ]);
  });

  it('treats a missing recording object as every recording field changed', () => {
    const { recording: _dropped, ...echoed } = CREATED;
    expect(echoMismatches(buildLiveInputRequest('r'), echoed)).toHaveLength(2);
  });
});

describe('readCreatedInput', () => {
  it('reads the uid and both credential shapes', () => {
    expect(readCreatedInput(CREATED)).toEqual({
      uid: 'abc123',
      srt: { url: 'srt://live.cloudflare.com:778', streamId: 'sid-1', passphrase: 'pass-1' },
      rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey: 'key-1' },
    });
  });

  it('names the missing field rather than failing later on the phone', () => {
    expect(() => readCreatedInput({ ...CREATED, srt: { url: 'srt://x:1' } })).toThrow(
      'srt.streamId',
    );
  });
});

describe('hlsManifestUrl', () => {
  it('builds the live input manifest on the customer subdomain', () => {
    expect(hlsManifestUrl('customer-x.cloudflarestream.com', 'abc123')).toBe(
      'https://customer-x.cloudflarestream.com/abc123/manifest/video.m3u8',
    );
  });
});

describe('toSessionPayload', () => {
  it("parses through the app's own anti-corruption layer with SRT primary", () => {
    const parsed = parseSessionCredentials(toSessionPayload(readCreatedInput(CREATED), OPTIONS));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.primary.transport).toBe('srt');
    expect(parsed.value.fallback.transport).toBe('rtmps');
    expect(parsed.value.holdWindowSeconds).toBe(180);
    expect(parsed.value.overlayUrl).toBe(OPTIONS.overlayUrl);
  });

  it('can break only the SRT address, for the fallback run', () => {
    const payload = toSessionPayload(readCreatedInput(CREATED), {
      ...OPTIONS,
      srtUrlOverride: 'srt://live.cloudflare.com:1',
    });
    expect(payload.srt.url).toBe('srt://live.cloudflare.com:1');
    expect(payload.rtmps.url).toBe('rtmps://live.cloudflare.com:443/live/');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run scripts/p5/liveInput.test.ts`
Expected: FAIL, cannot resolve `./liveInput.ts`.

- [ ] **Step 4: Implement** — `scripts/p5/liveInput.ts`

```ts
/**
 * Pure half of the P5 Cloudflare tooling. `cf.ts` does the I/O; everything
 * that can be wrong *silently* lives here, under test.
 *
 * Measured by the main repo (docs/superpowers/specs/2026-09-11-cloudflare-stream-measured.md):
 *  - U1-S7: `recording.timeoutSeconds` IS the playback hold window. Ruling 26 sets 180.
 *  - `timeoutSeconds: 0` is accepted and echoed as null — the platform default, silently.
 *  - U1-S4: `deleteRecordingAfterDays` floors at 30. Backstop only; cleanup deletes recordings.
 */

export const HOLD_WINDOW_SECONDS = 180;
export const RECORDING_BACKSTOP_DAYS = 30;
/** Design §4: generous, because YouTube's own 15–40 s dominates the budget. */
export const SRT_LATENCY_MS = 2000;

export type LiveInputRequest = {
  readonly meta: { readonly name: string };
  readonly recording: { readonly mode: 'automatic'; readonly timeoutSeconds: number };
  readonly deleteRecordingAfterDays: number;
};

export type CreatedInput = {
  readonly uid: string;
  readonly srt: { readonly url: string; readonly streamId: string; readonly passphrase: string };
  readonly rtmps: { readonly url: string; readonly streamKey: string };
};

export type SessionOptions = {
  readonly overlayUrl: string;
  readonly playbackUrl: string;
  /** Run C only: a deliberately wrong SRT address, to force the fallback. */
  readonly srtUrlOverride?: string;
};

export function buildLiveInputRequest(run: string): LiveInputRequest {
  return {
    meta: { name: `p5-spike-${run}` },
    recording: { mode: 'automatic', timeoutSeconds: HOLD_WINDOW_SECONDS },
    deleteRecordingAfterDays: RECORDING_BACKSTOP_DAYS,
  };
}

/** Cloudflare answers a cheerful 200 for settings it quietly changed. */
export function echoMismatches(sent: LiveInputRequest, echoed: unknown): readonly string[] {
  const input = asRecord(echoed);
  const recording = asRecord(input.recording);
  const checks: readonly (readonly [string, unknown, unknown])[] = [
    ['recording.mode', sent.recording.mode, recording.mode],
    ['recording.timeoutSeconds', sent.recording.timeoutSeconds, recording.timeoutSeconds],
    ['deleteRecordingAfterDays', sent.deleteRecordingAfterDays, input.deleteRecordingAfterDays],
  ];
  return checks
    .filter(([, want, got]) => want !== got)
    .map(([field, want, got]) => `${field}: sent ${String(want)}, got ${String(got)}`);
}

export function readCreatedInput(result: unknown): CreatedInput {
  const input = asRecord(result);
  const srt = asRecord(input.srt);
  const rtmps = asRecord(input.rtmps);
  return {
    uid: requireString(input.uid, 'uid'),
    srt: {
      url: requireString(srt.url, 'srt.url'),
      streamId: requireString(srt.streamId, 'srt.streamId'),
      passphrase: requireString(srt.passphrase, 'srt.passphrase'),
    },
    rtmps: {
      url: requireString(rtmps.url, 'rtmps.url'),
      streamKey: requireString(rtmps.streamKey, 'rtmps.streamKey'),
    },
  };
}

export function hlsManifestUrl(customerSubdomain: string, uid: string): string {
  return `https://${customerSubdomain}/${uid}/manifest/video.m3u8`;
}

/** The flat v1 shape `parseSessionCredentials` reads today (not the §7.6 contract). */
export function toSessionPayload(input: CreatedInput, options: SessionOptions) {
  return {
    v: 1,
    slotId: 'slot-0',
    holdWindowSeconds: HOLD_WINDOW_SECONDS,
    preferred: 'srt',
    overlayUrl: options.overlayUrl,
    playbackUrl: options.playbackUrl,
    scoreUpdates: 'realtime',
    srt: {
      url: options.srtUrlOverride ?? input.srt.url,
      streamId: input.srt.streamId,
      passphrase: input.srt.passphrase,
      latencyMs: SRT_LATENCY_MS,
    },
    rtmps: { url: input.rtmps.url, streamKey: input.rtmps.streamKey },
  } as const;
}

export type SessionPayload = ReturnType<typeof toSessionPayload>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Cloudflare response is missing ${field}`);
  }
  return value;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run scripts/p5/liveInput.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Write the CLI** — `scripts/p5/cf.ts`

```ts
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
```

- [ ] **Step 7: Check the CLI without credentials**

Run: `node scripts/p5/cf.ts verify`
Expected: exits 1 with `CF_ACCOUNT_ID is not set — add it to .env.local`. This proves Node runs the TypeScript directly and fails loudly rather than calling the API with `undefined`.

- [ ] **Step 8: Full check, then commit**

Run: `pnpm check`
Expected: typecheck clean, lint clean, all tests pass (101 existing plus 9 new).

```bash
git add .gitignore vitest.config.mts tsconfig.json package.json pnpm-lock.yaml scripts/p5/liveInput.ts scripts/p5/liveInput.test.ts scripts/p5/cf.ts
git commit -m "spike(p5): Cloudflare live-input tooling with echo assertions"
```

---

### Task 2: HLS playlist watcher

**Files:**
- Create: `scripts/p5/playlist.ts`, `scripts/p5/playlist.test.ts`, `scripts/p5/hls-watch.ts`

**Interfaces:**
- Produces: `variantUris(master: string, masterUrl: string): readonly string[]`, `parseVariant(text: string): VariantState`, `head(state: VariantState): number`, `judge(previous: VariantState | null, next: VariantState, lastAdvanceMs: number, nowMs: number): Judgement`; a CLI printing `iso,masterStatus,variant,head,verdict` per poll.

- [ ] **Step 1: Write the failing tests** — `scripts/p5/playlist.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { head, judge, parseVariant, variantUris } from './playlist.ts';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720',
  'stream_1/video.m3u8',
  '',
].join('\n');

const variant = (sequence: number, segments: number, ended = false) =>
  [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:4',
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    ...Array.from({ length: segments }, (_, i) => `#EXTINF:4.0,\nseg${sequence + i}.ts`),
    ...(ended ? ['#EXT-X-ENDLIST'] : []),
  ].join('\n');

describe('variantUris', () => {
  it('resolves variant paths against the master URL', () => {
    expect(variantUris(MASTER, 'https://c.example/uid/manifest/video.m3u8')).toEqual([
      'https://c.example/uid/manifest/stream_1/video.m3u8',
    ]);
  });
});

describe('parseVariant', () => {
  it('reads sequence, segment count, target duration and ENDLIST', () => {
    expect(parseVariant(variant(10, 3, true))).toEqual({
      mediaSequence: 10,
      segments: 3,
      endList: true,
      targetDuration: 4,
    });
  });
});

describe('judge', () => {
  const at = (sequence: number, segments: number) => parseVariant(variant(sequence, segments));

  it('calls the first poll advancing', () => {
    expect(judge(null, at(10, 3), 0, 1000)).toEqual({ verdict: 'advancing', lastAdvanceMs: 1000 });
  });

  it('calls a sliding window advancing even at a constant segment count', () => {
    expect(head(at(11, 3))).toBeGreaterThan(head(at(10, 3)));
    expect(judge(at(10, 3), at(11, 3), 0, 4000).verdict).toBe('advancing');
  });

  it('does not call a stall inside three target durations', () => {
    expect(judge(at(10, 3), at(10, 3), 0, 11_000).verdict).toBe('advancing');
  });

  it('calls a stall after three target durations — U1-S7 fires no error', () => {
    expect(judge(at(10, 3), at(10, 3), 0, 13_000)).toEqual({ verdict: 'stalled', lastAdvanceMs: 0 });
  });

  it('calls ENDLIST ended, whatever the timing', () => {
    expect(judge(at(10, 3), parseVariant(variant(10, 3, true)), 0, 1).verdict).toBe('ended');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run scripts/p5/playlist.test.ts`
Expected: FAIL, cannot resolve `./playlist.ts`.

- [ ] **Step 3: Implement** — `scripts/p5/playlist.ts`

```ts
/**
 * Playlist reading for the P5 watcher, following the main repo's U1 method.
 *
 * Two traps it paid for: the MASTER carries no media sequence (advancement lives
 * in the VARIANT), and a resumed broadcast can come back as a NEW variant — so
 * the watcher re-resolves the master on every poll instead of pinning one.
 * And U1-S7: inside the hold window playback STALLS, no error fires. Stalls are
 * detected from the playlist not advancing, never from an error.
 */

export type VariantState = {
  readonly mediaSequence: number;
  readonly segments: number;
  readonly endList: boolean;
  readonly targetDuration: number;
};

export type Verdict = 'advancing' | 'stalled' | 'ended';
export type Judgement = { readonly verdict: Verdict; readonly lastAdvanceMs: number };

export function variantUris(master: string, masterUrl: string): readonly string[] {
  return master
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => new URL(line, masterUrl).toString());
}

export function parseVariant(text: string): VariantState {
  const lines = text.split('\n').map((line) => line.trim());
  const tag = (name: string) => lines.find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1);
  return {
    mediaSequence: Number(tag('#EXT-X-MEDIA-SEQUENCE') ?? 0),
    segments: lines.filter((line) => line.startsWith('#EXTINF')).length,
    endList: lines.includes('#EXT-X-ENDLIST'),
    targetDuration: Number(tag('#EXT-X-TARGETDURATION') ?? 0),
  };
}

/** The newest segment's position. Advances even when the window slides. */
export function head(state: VariantState): number {
  return state.mediaSequence + state.segments;
}

export function judge(
  previous: VariantState | null,
  next: VariantState,
  lastAdvanceMs: number,
  nowMs: number,
): Judgement {
  if (next.endList) return { verdict: 'ended', lastAdvanceMs };
  if (previous === null || head(next) > head(previous)) {
    return { verdict: 'advancing', lastAdvanceMs: nowMs };
  }
  const stallAfterMs = Math.max(3 * next.targetDuration, 6) * 1000;
  return { verdict: nowMs - lastAdvanceMs > stallAfterMs ? 'stalled' : 'advancing', lastAdvanceMs };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run scripts/p5/playlist.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the CLI** — `scripts/p5/hls-watch.ts`

```ts
/**
 *   node scripts/p5/hls-watch.ts <manifestUrl> [intervalMs] | tee .p5/<run>.hls.csv
 *
 * One CSV line per poll: iso,masterStatus,variant,head,verdict
 */
import { type VariantState, head, judge, parseVariant, variantUris } from './playlist.ts';

/** U1-S6: a non-browser User-Agent gets `403 error code: 1010` on a healthy manifest. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  return { status: response.status, text: response.status === 200 ? await response.text() : '' };
}

async function watch(masterUrl: string, intervalMs: number): Promise<void> {
  let previous: VariantState | null = null;
  let previousUri: string | null = null;
  let lastAdvanceMs = Date.now();
  console.log('iso,masterStatus,variant,head,verdict');
  for (;;) {
    const master = await get(masterUrl).catch(() => ({ status: 0, text: '' }));
    const uri = variantUris(master.text, masterUrl)[0] ?? null;
    const line = [new Date().toISOString(), master.status, uri ?? '', '', ''];
    if (uri !== null) {
      const next = parseVariant((await get(uri)).text);
      // A new variant after a resume is a new sequence space; never compare across it.
      const judgement = judge(uri === previousUri ? previous : null, next, lastAdvanceMs, Date.now());
      lastAdvanceMs = judgement.lastAdvanceMs;
      line[3] = head(next);
      line[4] = judgement.verdict;
      previous = next;
      previousUri = uri;
    }
    console.log(line.join(','));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const [url, interval] = process.argv.slice(2);
if (url === undefined) {
  console.error('usage: hls-watch.ts <manifestUrl> [intervalMs]');
  process.exit(1);
}
void watch(url, Number(interval ?? 2000));
```

- [ ] **Step 6: Smoke the CLI against a public test stream**

Run: `node scripts/p5/hls-watch.ts https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 1000` and stop it after about 5 lines with Ctrl-C.
Expected: a header line, then lines with `200`, a variant URL, a number, and `ended` (that test stream is VOD and carries `#EXT-X-ENDLIST`).

- [ ] **Step 7: Check and commit**

Run: `pnpm check` (expected: all green).

```bash
git add scripts/p5/playlist.ts scripts/p5/playlist.test.ts scripts/p5/hls-watch.ts
git commit -m "spike(p5): HLS watcher that detects stalls without errors"
```

---

### Task 3: Native module with camera preview and the always-on overlay

Kotlin in a throwaway spike gets no unit tests. Each native task is verified on the handset with explicit expectations instead.

**Files:**
- Create (scaffold): `modules/p5-spike/**`
- Modify: `modules/p5-spike/android/build.gradle`, `.../AndroidManifest.xml`
- Create: `.../SpikeSession.kt`, `.../SessionFile.kt`, `.../SpikeLog.kt`, `.../SpikeTelemetry.kt` (a stub for now), `.../SpikePreviewView.kt`, `.../SpikeForegroundService.kt` (a stub for now)
- Replace: `.../P5SpikeModule.kt`, `modules/p5-spike/src/*`
- Create: `modules/p5-spike/src/spikeStore.ts`, `modules/p5-spike/src/SpikeScreen.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Produces (native to JS): module `P5Spike` with `arm(): void`, `start(transport: 'srt' | 'rtmps'): void`, `stop(): void`, `mark(label: string): void`, `logPath(): string`; events `onSample(SpikeSample)` and `onEvent(SpikeEvent)` where `SpikeEvent.kind` ∈ `armed | error | connecting | publishing | dropped | connect-failed | fell-back | stopped | rotation | mark`; native view `P5Spike`.
- Produces (JS): `useSpike<T>(select: (state: SpikeState) => T): T`; `SpikeScreen` component.

- [ ] **Step 1: Scaffold the local module**

```bash
pnpm dlx create-expo-module@latest --local p5-spike --name P5Spike --package com.seazn.p5spike -p android --features Function Event View --package-manager pnpm
rm modules/p5-spike/src/P5SpikeModule.web.ts modules/p5-spike/src/P5SpikeView.web.tsx modules/p5-spike/src/P5SpikeView.tsx modules/p5-spike/src/P5Spike.types.ts modules/p5-spike/android/src/main/java/com/seazn/p5spike/P5SpikeView.kt
```

Expected: `modules/p5-spike/expo-module.config.json` lists `com.seazn.p5spike.P5SpikeModule`.

- [ ] **Step 2: Dependencies** — replace `modules/p5-spike/android/build.gradle`

```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'com.seazn.p5spike'
version = '0.1.0'

android {
  namespace "com.seazn.p5spike"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
  }
  lintOptions {
    abortOnError false
  }
}

// StreamPack is Apache-2.0; it pulls libsrt (MPL-2.0) as a binary dependency.
// Never fork libsrt — N12.
dependencies {
  implementation 'io.github.thibaultbee.streampack:streampack-core:3.2.0'
  implementation 'io.github.thibaultbee.streampack:streampack-ui:3.2.0'
  implementation 'io.github.thibaultbee.streampack:streampack-srt:3.2.0'
  implementation 'io.github.thibaultbee.streampack:streampack-rtmp:3.2.0'
  implementation 'androidx.core:core-ktx:1.16.0'
  implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2'
}
```

- [ ] **Step 3: Manifest** — replace `modules/p5-spike/android/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <application>
    <service
      android:name="com.seazn.p5spike.SpikeForegroundService"
      android:exported="false"
      android:foregroundServiceType="camera|microphone" />
  </application>
</manifest>
```

- [ ] **Step 4: Session file** — `.../SessionFile.kt`

```kotlin
package com.seazn.p5spike

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.io.File

data class SrtTarget(
  val host: String,
  val port: Int,
  val streamId: String,
  val passphrase: String?,
  val latencyMs: Int,
)

/** The payload `scripts/p5/cf.ts create` writes, pushed by adb. Never bundled. */
data class SessionFile(
  val srt: SrtTarget,
  val rtmpsUrl: String,
  val overlayUrl: String,
  val playbackUrl: String,
) {
  companion object {
    const val NAME = "p5-session.json"

    fun read(context: Context): SessionFile? {
      val file = File(context.getExternalFilesDir(null), NAME)
      if (!file.exists()) return null
      val json = JSONObject(file.readText())
      val srt = json.getJSONObject("srt")
      val rtmps = json.getJSONObject("rtmps")
      val srtUri = Uri.parse(srt.getString("url"))
      return SessionFile(
        srt = SrtTarget(
          host = requireNotNull(srtUri.host) { "srt.url has no host" },
          port = srtUri.port,
          streamId = srt.getString("streamId"),
          passphrase = srt.optString("passphrase").ifEmpty { null },
          latencyMs = srt.getInt("latencyMs"),
        ),
        rtmpsUrl = rtmps.getString("url").trimEnd('/') + "/" + rtmps.getString("streamKey"),
        overlayUrl = json.getString("overlayUrl"),
        playbackUrl = json.getString("playbackUrl"),
      )
    }
  }
}
```

- [ ] **Step 5: CSV log** — `.../SpikeLog.kt`

```kotlin
package com.seazn.p5spike

import android.content.Context
import java.io.File

/** One row per sample or event, flushed on every write so a crash loses nothing. */
class SpikeLog(context: Context) {
  val file: File = File(context.getExternalFilesDir(null), "p5-${System.currentTimeMillis()}.csv")
  private val writer = file.bufferedWriter()

  init {
    write((listOf("epochMs", "kind") + SAMPLE_KEYS + "detail").joinToString(","))
  }

  @Synchronized
  fun sample(values: Map<String, Any?>) {
    write((listOf(System.currentTimeMillis(), "sample") + SAMPLE_KEYS.map { values[it] ?: "" } + "").joinToString(","))
  }

  @Synchronized
  fun event(kind: String, detail: String) {
    write((listOf(System.currentTimeMillis(), kind) + SAMPLE_KEYS.map { "" } + detail.replace(',', ';')).joinToString(","))
  }

  private fun write(line: String) {
    writer.write(line)
    writer.newLine()
    writer.flush()
  }

  companion object {
    val SAMPLE_KEYS = listOf(
      "thermalStatus", "thermalHeadroom", "batteryPercent", "batteryTempC", "charging",
      "currentMicroAmps", "network", "screenOn", "streaming", "transport", "videoBitrate",
    )
  }
}
```

- [ ] **Step 6: Stubs so the module compiles** — `.../SpikeTelemetry.kt` and `.../SpikeForegroundService.kt` (both replaced in Task 5)

```kotlin
package com.seazn.p5spike

import android.content.Context
import kotlinx.coroutines.CoroutineScope

object SpikeTelemetry {
  fun start(context: Context, scope: CoroutineScope, onSample: (Map<String, Any?>) -> Unit) = Unit
}
```

```kotlin
package com.seazn.p5spike

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

class SpikeForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    fun start(context: Context) = Unit
    fun stop(context: Context) = Unit
  }
}
```

- [ ] **Step 7: The session, arm only** — `.../SpikeSession.kt`

```kotlin
package com.seazn.p5spike

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
import android.util.Size
import io.github.thibaultbee.streampack.core.streamers.orientation.DisplayRotationProvider
import io.github.thibaultbee.streampack.core.streamers.orientation.asFlowProvider
import io.github.thibaultbee.streampack.core.streamers.single.AudioConfig
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.core.streamers.single.VideoConfig
import io.github.thibaultbee.streampack.core.streamers.single.cameraSingleStreamer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The native session, as a process singleton. Native owns it (AGENTS.md §2):
 * JS sends intents and receives events; nothing here waits on JavaScript.
 */
object SpikeSession {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private lateinit var appContext: Context
  private var emit: (String, Map<String, Any?>) -> Unit = { _, _ -> }
  private var session: SessionFile? = null
  private var publishJob: Job? = null
  lateinit var log: SpikeLog
    private set

  val streamerFlow = MutableStateFlow<SingleStreamer?>(null)

  @Volatile var wanted: String? = null
    private set
  @Volatile var transport: String? = null
    private set

  /** Survives JS reloads: a second attach only swaps the emitter. */
  fun attach(context: Context, emitter: (String, Map<String, Any?>) -> Unit) {
    emit = emitter
    if (::appContext.isInitialized) return
    appContext = context
    log = SpikeLog(context)
    SpikeTelemetry.start(context, scope) { sample ->
      log.sample(sample)
      emit("onSample", sample)
    }
  }

  @SuppressLint("MissingPermission") // JS requests CAMERA and RECORD_AUDIO before arm().
  fun arm() {
    scope.launch {
      val file = runCatching { SessionFile.read(appContext) }.getOrElse {
        return@launch event("error", "message" to "Bad session file: ${it.message}")
      } ?: return@launch event("error", "message" to "No session file. Run cf.ts create, then adb push.")
      session = file
      if (streamerFlow.value == null) {
        val streamer = withContext(Dispatchers.Main) { cameraSingleStreamer(appContext) }
        streamer.setAudioConfig(
          AudioConfig(
            mimeType = MediaFormat.MIMETYPE_AUDIO_AAC,
            startBitrate = 128_000,
            sampleRate = 48_000,
            channelConfig = AudioFormat.CHANNEL_IN_STEREO,
          ),
        )
        streamer.setVideoConfig(
          VideoConfig(
            mimeType = MediaFormat.MIMETYPE_VIDEO_AVC,
            startBitrate = 3_000_000,
            resolution = Size(1280, 720),
            fps = 30,
            gopDurationInS = 2f,
          ),
        )
        streamerFlow.value = streamer
        watchRotation(streamer)
      }
      event("armed", "overlayUrl" to file.overlayUrl, "playbackUrl" to file.playbackUrl)
    }
  }

  fun start(requested: String) = event("error", "message" to "start() arrives in Task 4 ($requested)")

  fun stop() = event("stopped")

  fun mark(label: String) = event("mark", "label" to label)

  fun logPath(): String = log.file.absolutePath

  /** The app is landscape-locked, so follow the display, not the sensor (P4). */
  private fun watchRotation(streamer: SingleStreamer) {
    scope.launch {
      DisplayRotationProvider(appContext).asFlowProvider().rotationFlow.collect { rotation ->
        streamer.setTargetRotation(rotation)
        event("rotation", "value" to rotation)
      }
    }
  }

  fun event(kind: String, vararg extras: Pair<String, Any?>) {
    log.event(kind, extras.joinToString(" ") { "${it.first}=${it.second}" })
    emit("onEvent", mapOf<String, Any?>("kind" to kind, "atMs" to System.currentTimeMillis()) + extras)
  }
}
```

- [ ] **Step 8: The preview view** — `.../SpikePreviewView.kt`

```kotlin
package com.seazn.p5spike

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/** Frames never touch JS (AGENTS.md §2): the preview is a native view. */
class SpikePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // RN does not lay out plain Android children; a SurfaceView left unmeasured stays black.
  override val shouldUseAndroidLayout = true

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val preview = PreviewView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }

  init {
    addView(preview)
    scope.launch {
      SpikeSession.streamerFlow.filterNotNull().collect { preview.setVideoSourceProvider(it) }
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    scope.cancel()
  }
}
```

- [ ] **Step 9: The module** — replace `.../P5SpikeModule.kt`

```kotlin
package com.seazn.p5spike

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class P5SpikeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("P5Spike")

    Events("onSample", "onEvent")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      SpikeSession.attach(context.applicationContext) { name, body -> sendEvent(name, body) }
    }

    // Intents, not RPC: every function returns immediately (AGENTS.md §2).
    Function("arm") { SpikeSession.arm() }
    Function("start") { transport: String -> SpikeSession.start(transport) }
    Function("stop") { SpikeSession.stop() }
    Function("mark") { label: String -> SpikeSession.mark(label) }
    Function("logPath") { SpikeSession.logPath() }

    View(SpikePreviewView::class) {}
  }
}
```

- [ ] **Step 10: Typed JS surface** — `modules/p5-spike/src/P5SpikeModule.ts`

```ts
import { NativeModule, requireNativeModule } from 'expo';

export type SpikeSample = {
  readonly atMs: number;
  readonly thermalStatus: number;
  readonly thermalHeadroom: number;
  readonly batteryPercent: number;
  readonly batteryTempC: number;
  readonly charging: boolean;
  readonly currentMicroAmps: number;
  readonly network: string;
  readonly screenOn: boolean;
  readonly streaming: boolean;
  readonly transport: string | null;
  readonly videoBitrate: number;
};

export type SpikeEvent = { readonly kind: string; readonly atMs: number } & Readonly<
  Record<string, unknown>
>;

type Events = {
  onSample: (sample: SpikeSample) => void;
  onEvent: (event: SpikeEvent) => void;
};

declare class P5SpikeModule extends NativeModule<Events> {
  arm(): void;
  start(transport: 'srt' | 'rtmps'): void;
  stop(): void;
  mark(label: string): void;
  logPath(): string;
}

export default requireNativeModule<P5SpikeModule>('P5Spike');
```

`modules/p5-spike/src/P5SpikePreview.tsx`

```tsx
import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export const P5SpikePreview: ComponentType<{ style?: StyleProp<ViewStyle> }> =
  requireNativeView('P5Spike');
```

- [ ] **Step 11: External store** — `modules/p5-spike/src/spikeStore.ts`

```ts
import { useSyncExternalStore } from 'react';
import P5Spike, { type SpikeEvent, type SpikeSample } from './P5SpikeModule';

/**
 * Native events into React without re-rendering the tree at 1 Hz (AGENTS.md §8).
 * This matters for the spike's numbers too: a screen that re-renders every
 * second is JS load the shipping app would not carry.
 */
export type SpikeState = {
  readonly sample: SpikeSample | null;
  readonly lastEvent: SpikeEvent | null;
  readonly overlayUrl: string | null;
  readonly playbackUrl: string | null;
};

let state: SpikeState = { sample: null, lastEvent: null, overlayUrl: null, playbackUrl: null };
const listeners = new Set<() => void>();

function set(next: Partial<SpikeState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

P5Spike.addListener('onSample', (sample) => set({ sample }));
P5Spike.addListener('onEvent', (event) =>
  set(
    event.kind === 'armed'
      ? { lastEvent: event, overlayUrl: String(event.overlayUrl), playbackUrl: String(event.playbackUrl) }
      : { lastEvent: event },
  ),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpike<T>(select: (current: SpikeState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
```

- [ ] **Step 12: The screen** — `modules/p5-spike/src/SpikeScreen.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react';
import { type LayoutChangeEvent, PermissionsAndroid, Pressable, StyleSheet, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';
import P5Spike from './P5SpikeModule';
import { P5SpikePreview } from './P5SpikePreview';
import { type SpikeState, useSpike } from './spikeStore';

/** Throwaway P5 screen. Never merged — see docs/superpowers/plans/2026-09-11-p5-android-spike.md. */
export function SpikeScreen() {
  // The operator keeps the screen on at a ground; lock is tested deliberately, mid-run.
  useKeepAwake();
  const denied = useArmOnPermission();
  return (
    <View style={styles.screen}>
      <Stage />
      <View style={styles.column}>
        {denied ? <Text variant="body">Camera or microphone permission denied.</Text> : <Hud />}
        <Controls />
      </View>
    </View>
  );
}

function useArmOnPermission(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const { CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS } = PermissionsAndroid.PERMISSIONS;
    void PermissionsAndroid.requestMultiple([CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS]).then((result) => {
      const granted = result[CAMERA] === 'granted' && result[RECORD_AUDIO] === 'granted';
      if (granted) P5Spike.arm();
      else setDenied(true);
    });
  }, []);
  return denied;
}

function useFittedFrame() {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const fitted = Math.min(width, height * layout.previewAspect);
    setFrame({ width: fitted, height: fitted / layout.previewAspect });
  }, []);
  return { frame, onLayout };
}

const selectOverlayUrl = (current: SpikeState) => current.overlayUrl;

/** Preview and overlay share one fitted 16:9 frame, so the overlay covers exactly the picture. */
function Stage() {
  const overlayUrl = useSpike(selectOverlayUrl);
  const { frame, onLayout } = useFittedFrame();
  return (
    <View style={styles.stage} onLayout={onLayout}>
      {frame === null ? null : (
        <View style={frame}>
          <P5SpikePreview style={StyleSheet.absoluteFill} />
          {overlayUrl === null ? null : <AlwaysOnOverlay url={overlayUrl} />}
        </View>
      )}
    </View>
  );
}

/** Visible for the whole run: the worst case for heat (N4), not the shipping peek. */
function AlwaysOnOverlay({ url }: { url: string }) {
  return (
    <ErrorBoundary label="Overlay crashed">
      <OverlayPreview url={url} visible caption="P5: overlay always on" />
    </ErrorBoundary>
  );
}

const selectSample = (current: SpikeState) => current.sample;
const selectLastEvent = (current: SpikeState) => current.lastEvent;

function Hud() {
  const sample = useSpike(selectSample);
  const event = useSpike(selectLastEvent);
  if (sample === null) return <Text variant="metricUnit">{`Waiting… ${event?.kind ?? ''}`}</Text>;
  const live = sample.streaming ? `LIVE ${sample.transport ?? ''}` : 'not publishing';
  return (
    <View style={styles.hud}>
      <Text variant="metricUnit">{live}</Text>
      <Text variant="metricUnit">{`${Math.round(sample.videoBitrate / 1000)} kbps`}</Text>
      <Text variant="metricUnit">{`thermal ${sample.thermalStatus} · ${headroom(sample.thermalHeadroom)}`}</Text>
      <Text variant="metricUnit">{`${sample.batteryPercent}% · ${sample.batteryTempC.toFixed(1)}°C${sample.charging ? ' · charging' : ''}`}</Text>
      <Text variant="metricUnit">{`${sample.network}${sample.screenOn ? '' : ' · screen off'}`}</Text>
      <Text variant="metricUnit">{`last: ${event?.kind ?? '—'}`}</Text>
    </View>
  );
}

/** NaN from the platform can cross the bridge as null; never let the HUD throw on it. */
function headroom(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

let markCount = 0;
const startSrt = () => P5Spike.start('srt');
const startRtmps = () => P5Spike.start('rtmps');
const stop = () => P5Spike.stop();
const mark = () => P5Spike.mark(`mark-${(markCount += 1)}`);

function Controls() {
  return (
    <View style={styles.controls}>
      <Action label="Start SRT" onPress={startSrt} />
      <Action label="Start RTMPS" onPress={startRtmps} />
      <Action label="Stop" onPress={stop} />
      <Action label="Mark" onPress={mark} />
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.action}>
      <Text variant="control">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: colour.ground },
  stage: { flex: 1, backgroundColor: colour.stage, alignItems: 'center', justifyContent: 'center' },
  column: { width: layout.columnWidth, padding: space.sm, gap: space.sm },
  hud: { gap: space.xs },
  controls: { marginTop: 'auto', gap: space.xs },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colour.rule,
  },
});
```

- [ ] **Step 13: Route to the spike** — in `App.tsx`, add the import and the switch

```tsx
import { SpikeScreen } from './modules/p5-spike/src/SpikeScreen';

// P5 spike only: EXPO_PUBLIC_ vars are inlined by Metro at bundle time.
const SPIKE = process.env.EXPO_PUBLIC_SEAZN_SOAK === '1';
```

and replace `<Router />` with `{SPIKE ? <SpikeScreen /> : <Router />}`.

- [ ] **Step 14: Check locally**

Run: `pnpm check`
Expected: green. If lint rejects `modules/p5-spike/**` for boundaries, add `{ type: 'spike', pattern: 'modules/p5-spike/**' }` to `boundaries/elements` with an allow-all policy for `spike`, since it's throwaway and must not constrain the architecture rule.

- [ ] **Step 15: Build and install the development client**

Use the local command (Task 0) or: `pnpm eas build --profile development --platform android --non-interactive --no-wait`, then install with Orbit.
Expected: the build succeeds. If Kotlin fails with a metadata-version error for StreamPack (compiled with Kotlin 2.2.21), stop and record the exact error; the fix is raising the app's Kotlin version through `expo-build-properties`, which is a finding in itself.

- [ ] **Step 16: Verify on the handset**

```bash
adb -s 12be753e reverse tcp:8081 tcp:8081
EXPO_PUBLIC_SEAZN_SOAK=1 pnpm start --dev-client
```

Open the app on the phone. Grant camera, microphone and notifications.
Expected:
1. The HUD says `Waiting… error` (there is no session file yet). This proves the event path runs from native to JS.
2. Run `node --env-file=.env.local scripts/p5/cf.ts create smoke`, run the printed `adb push` command, and reload the app (press `r` in Metro).
3. The camera preview fills the 16:9 frame the right way up, and the staging overlay draws over it, with the scorebug inside the picture.
4. Run `adb -s 12be753e logcat -d | grep -i -E "p5spike|streampack" | tail -20` and confirm there are no exceptions.
5. Run `node --env-file=.env.local scripts/p5/cf.ts cleanup <uid>` and confirm it prints `deleted input`.

- [ ] **Step 17: Commit**

```bash
git add modules/p5-spike App.tsx eslint.config.mjs
git commit -m "spike(p5): StreamPack preview module with always-on overlay"
```

---

### Task 4: Publishing, reconnect and SRT→RTMPS fallback

**Files:**
- Modify: `modules/p5-spike/android/src/main/java/com/seazn/p5spike/SpikeSession.kt`

**Interfaces:**
- Consumes: `SessionFile`, `streamerFlow`, `event(...)` from Task 3.
- Produces: `start(transport)` and `stop()` behaviour. Events `connecting{transport}`, `publishing{transport, connectMs}`, `dropped{transport, reason}`, `connect-failed{transport, message}`, `fell-back`, `stopped`.

- [ ] **Step 1: Replace `start` and `stop` and add the loop.** In `SpikeSession.kt`, add these imports:

```kotlin
import android.os.SystemClock
import io.github.thibaultbee.streampack.core.interfaces.startStream
import io.github.thibaultbee.streampack.ext.srt.configuration.mediadescriptor.SrtMediaDescriptor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.isActive
```

and replace the `start` and `stop` stubs with:

```kotlin
  private const val RETRY_MS = 2_000L
  /** C1: SRT failures before falling back. The ordering is R3's to rule; P5 measures it. */
  private const val FALLBACK_AFTER_FAILURES = 3

  fun start(requested: String) {
    wanted = requested
    SpikeForegroundService.start(appContext) // From a JS press, so the app is foreground.
    publishJob?.cancel()
    publishJob = scope.launch { publishLoop(requested) }
  }

  fun stop() {
    wanted = null
    publishJob?.cancel()
    scope.launch {
      streamerFlow.value?.let { runCatching { it.stopStream() }; runCatching { it.close() } }
      transport = null
      SpikeForegroundService.stop(appContext)
      event("stopped")
    }
  }

  /**
   * Native owns reconnect (P2). No promise waits on the network: the loop runs
   * until stop(), and every transition is an event.
   */
  private suspend fun publishLoop(first: String) {
    val file = session ?: return event("error", "message" to "start before arm")
    val streamer = streamerFlow.value ?: return event("error", "message" to "no streamer")
    var current = first
    var srtFailures = 0
    while (currentCoroutineContext().isActive && wanted != null) {
      // throwableFlow is a StateFlow: without this, a stale error from the last
      // attempt would end the next wait instantly.
      val stale = streamer.throwableFlow.value
      try {
        transport = current
        event("connecting", "transport" to current)
        val startedAt = SystemClock.elapsedRealtime()
        if (current == "srt") {
          streamer.startStream(
            SrtMediaDescriptor(
              host = file.srt.host,
              port = file.srt.port,
              streamId = file.srt.streamId,
              passPhrase = file.srt.passphrase,
              latency = file.srt.latencyMs,
            ),
          )
        } else {
          streamer.startStream(file.rtmpsUrl)
        }
        event("publishing", "transport" to current, "connectMs" to SystemClock.elapsedRealtime() - startedAt)
        srtFailures = 0
        val reason = merge(
          streamer.isStreamingFlow.filter { !it }.map { "stopped" },
          streamer.throwableFlow.filterNotNull().filter { it !== stale }.map { it.message ?: it.javaClass.simpleName },
        ).first()
        event("dropped", "transport" to current, "reason" to reason)
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (failure: Throwable) {
        event("connect-failed", "transport" to current, "message" to (failure.message ?: failure.javaClass.simpleName))
        if (current == "srt" && ++srtFailures >= FALLBACK_AFTER_FAILURES) {
          current = "rtmps"
          event("fell-back")
        }
      }
      runCatching { streamer.stopStream() }
      runCatching { streamer.close() }
      delay(RETRY_MS)
    }
  }
```

(`stop()` stays a plain intent, and the old `stop() = event("stopped")` stub is deleted.)

- [ ] **Step 2: Build and install** (native change). Use the local or EAS command from Task 0.

- [ ] **Step 3: Verify SRT publishing**

```bash
node --env-file=.env.local scripts/p5/cf.ts create t4
adb -s 12be753e push .p5/t4.session.json /sdcard/Android/data/com.seazn.capture/files/p5-session.json
node scripts/p5/hls-watch.ts "$(node -p "JSON.parse(require('fs').readFileSync('.p5/t4.session.json')).playbackUrl")" | tee .p5/t4.hls.csv
```

Reload the app and press **Start SRT**.
Expected: HUD `last: publishing`. Within about 30 s the watcher prints `200` and `advancing`, with `head` increasing.

- [ ] **Step 4: Verify the drop inside the hold window**

Toggle airplane mode on for 20 s, then off.
Expected: events `dropped`, then `connect-failed` (zero or more), then `publishing`. The watcher goes `stalled` and back to `advancing`, never `ended`. Afterwards `GET /stream/live_inputs/<uid>/videos` shows **one** recording (U1-S7).

- [ ] **Step 5: Verify the fallback**

Press **Stop**. Run `cleanup` on the t4 uid. Then:

```bash
P5_SRT_URL_OVERRIDE=srt://live.cloudflare.com:1 node --env-file=.env.local scripts/p5/cf.ts create t4c
```

Push that payload, reload, and press **Start SRT**.
Expected: three `connect-failed` for `srt`, then `fell-back`, then `publishing` with `transport=rtmps`, and the watcher advancing. Record how long it took from the first `connecting` to the `rtmps` `publishing`.

- [ ] **Step 6: Clean up and commit**

Run `cleanup` on every uid created in this task.

```bash
git add modules/p5-spike/android
git commit -m "spike(p5): native publish loop with reconnect and SRT→RTMPS fallback"
```

---

### Task 5: Telemetry, foreground service and screen-off publishing

**Files:**
- Replace: `.../SpikeTelemetry.kt`, `.../SpikeForegroundService.kt`

**Interfaces:**
- Consumes: `SpikeSession.streamerFlow`, `SpikeSession.transport`, `SpikeLog.SAMPLE_KEYS`.
- Produces: an `onSample` event every second carrying exactly the `SAMPLE_KEYS` plus `atMs`; a CSV at `SpikeSession.logPath()`.

- [ ] **Step 1: Telemetry** — replace `.../SpikeTelemetry.kt`

```kotlin
package com.seazn.p5spike

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** 1 Hz, whether or not anything changed: the heartbeat contract (CaptureEnginePort). */
object SpikeTelemetry {
  fun start(context: Context, scope: CoroutineScope, onSample: (Map<String, Any?>) -> Unit) {
    scope.launch {
      while (isActive) {
        onSample(sample(context))
        delay(1_000)
      }
    }
  }

  private fun sample(context: Context): Map<String, Any?> {
    val power = context.getSystemService(PowerManager::class.java)
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val streamer = SpikeSession.streamerFlow.value
    return mapOf(
      "atMs" to System.currentTimeMillis(),
      "thermalStatus" to (if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1),
      // NaN when polled faster than the platform allows; logged as-is, never smoothed.
      "thermalHeadroom" to (if (Build.VERSION.SDK_INT >= 30) power.getThermalHeadroom(10).toDouble() else -1.0),
      "batteryPercent" to percent(battery),
      "batteryTempC" to (battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0,
      "charging" to ((battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0),
      "currentMicroAmps" to context.getSystemService(BatteryManager::class.java)
        .getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
      "network" to network(context),
      "screenOn" to power.isInteractive,
      "streaming" to (streamer?.isStreamingFlow?.value ?: false),
      "transport" to SpikeSession.transport,
      "videoBitrate" to (streamer?.videoEncoder?.bitrate ?: 0),
    )
  }

  private fun percent(battery: Intent?): Int {
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    return if (level < 0) -1 else level * 100 / scale
  }

  private fun network(context: Context): String {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return "none"
    return when {
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      else -> "other"
    }
  }
}
```

- [ ] **Step 2: Foreground service** — replace `.../SpikeForegroundService.kt`

```kotlin
package com.seazn.p5spike

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * AGENTS.md §9: camera + microphone foreground service, started from the
 * foreground. The wake lock is part of what P5 measures — record whether
 * publishing survives screen-off with it, and try one lock cycle without it.
 */
class SpikeForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notifications = getSystemService(NotificationManager::class.java)
    notifications.createNotificationChannel(
      NotificationChannel(CHANNEL, "P5 spike", NotificationManager.IMPORTANCE_LOW),
    )
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle("P5 spike")
      .setContentText("Publishing")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .build()
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
    )
    if (wakeLock == null) {
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "p5spike:publish")
        .apply { acquire() }
    }
    SpikeSession.event("service-started")
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.release()
    wakeLock = null
    SpikeSession.event("service-stopped")
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "p5-spike"
    private const val NOTIFICATION_ID = 7105

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, SpikeForegroundService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, SpikeForegroundService::class.java))
    }
  }
}
```

- [ ] **Step 3: Build and install** (native change).

- [ ] **Step 4: Verify telemetry**

Reload the app.
Expected: the HUD updates every second with thermal status, headroom, battery % and °C, charging, network, and last event. Then:

```bash
adb -s 12be753e shell ls /sdcard/Android/data/com.seazn.capture/files/
```

Expected: a `p5-<epoch>.csv`. Pull it (`adb -s 12be753e pull /sdcard/Android/data/com.seazn.capture/files/ .p5/device/`) and confirm one `sample` row per second with the header `epochMs,kind,thermalStatus,…,detail`.

- [ ] **Step 5: Verify screen-off publishing**

Create a new input, push it, and **Start SRT** with the watcher running. Press the power button and leave the phone locked for 5 minutes.
Expected: the notification "P5 spike · Publishing" is visible. The watcher stays `advancing` for the whole lock. The CSV shows `screenOn=false` rows with `streaming=true`. Unlock: the preview resumes. If the watcher stalls while locked, **this is a P1-class finding for Android**: record the exact minute and the CSV rows.

- [ ] **Step 6: Clean up and commit**

Run `cleanup` on the uid.

```bash
git add modules/p5-spike/android
git commit -m "spike(p5): 1 Hz telemetry CSV and camera/microphone foreground service"
```

---

### Task 6: Output check — the User-Agent question (U1-S6)

JS only, so it needs no rebuild while the dev client is installed.

**Files:**
- Modify: `modules/p5-spike/src/SpikeScreen.tsx`

**Interfaces:**
- Consumes: `playbackUrl` from `useSpike`, `P5Spike.mark`.
- Produces: marks `peek-default-<status>[-error]` and `peek-browser-<status>[-error]` in the CSV.

- [ ] **Step 1: Add the check.** In `SpikeScreen.tsx`, add the imports:

```tsx
import { useVideoPlayer, VideoView } from 'expo-video';
```

and add these components:

```tsx
/** A phone UA: what Cloudflare sees from Chrome on this handset. */
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 16; NE2211) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const selectPlaybackUrl = (current: SpikeState) => current.playbackUrl;

/**
 * U1-S6: the manifest 403s a non-browser UA. The shipping OutputPreview plays
 * with the player's default UA, so find out which one this device's player sends
 * and whether an explicit header survives it.
 */
function OutputCheck({ browserUa }: { browserUa: boolean }) {
  const url = useSpike(selectPlaybackUrl);
  if (url === null) return null;
  return <OutputPlayer url={url} browserUa={browserUa} />;
}

function OutputPlayer({ url, browserUa }: { url: string; browserUa: boolean }) {
  const source = browserUa ? { uri: url, headers: { 'User-Agent': BROWSER_UA } } : url;
  const player = useVideoPlayer(source, (instance) => {
    instance.muted = true; // The microphone is live; never play the broadcast out loud.
    instance.play();
  });
  useEffect(() => {
    const tag = browserUa ? 'browser' : 'default';
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      P5Spike.mark(`peek-${tag}-${status}${error ? `-${error.message}` : ''}`);
    });
    return () => subscription.remove();
  }, [player, browserUa]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}
```

Then replace `SpikeScreen`, `Stage` and `Controls` with these versions, which thread the peek state through:

```tsx
type Peek = 'off' | 'default' | 'browser';

export function SpikeScreen() {
  useKeepAwake();
  const denied = useArmOnPermission();
  const [peek, setPeek] = useState<Peek>('off');
  const peekDefault = useCallback(() => setPeek('default'), []);
  const peekBrowser = useCallback(() => setPeek('browser'), []);
  const peekOff = useCallback(() => setPeek('off'), []);
  return (
    <View style={styles.screen}>
      <Stage peek={peek} />
      <View style={styles.column}>
        {denied ? <Text variant="body">Camera or microphone permission denied.</Text> : <Hud />}
        <Controls onPeekDefault={peekDefault} onPeekBrowser={peekBrowser} onPeekOff={peekOff} />
      </View>
    </View>
  );
}

function Stage({ peek }: { peek: Peek }) {
  const overlayUrl = useSpike(selectOverlayUrl);
  const { frame, onLayout } = useFittedFrame();
  return (
    <View style={styles.stage} onLayout={onLayout}>
      {frame === null ? null : (
        <View style={frame}>
          <P5SpikePreview style={StyleSheet.absoluteFill} />
          {overlayUrl === null ? null : <AlwaysOnOverlay url={overlayUrl} />}
          {peek === 'off' ? null : <OutputCheck browserUa={peek === 'browser'} />}
        </View>
      )}
    </View>
  );
}

type ControlsProps = { onPeekDefault: () => void; onPeekBrowser: () => void; onPeekOff: () => void };

function Controls({ onPeekDefault, onPeekBrowser, onPeekOff }: ControlsProps) {
  return (
    <View style={styles.controls}>
      <Action label="Start SRT" onPress={startSrt} />
      <Action label="Start RTMPS" onPress={startRtmps} />
      <Action label="Stop" onPress={stop} />
      <Action label="Mark" onPress={mark} />
      <Action label="Peek default UA" onPress={onPeekDefault} />
      <Action label="Peek browser UA" onPress={onPeekBrowser} />
      <Action label="Peek off" onPress={onPeekOff} />
    </View>
  );
}
```

- [ ] **Step 2: Verify**

With a live input publishing, press **Peek default UA** for 20 s, then **Peek off**, then **Peek browser UA** for 20 s, then **Peek off**.
Expected outcomes to record (both are results, not failures):
- default UA: either `readyToPlay`, or `error` with a 403 / `1010` message.
- browser UA: `readyToPlay` and the composited-free picture about 6+ s behind.

Pull the CSV and copy the `peek-*` marks into the results doc. If the default UA fails and the browser UA plays, the shipping `OutputPreview` needs the header, which becomes a finding.

- [ ] **Step 3: Verify the stall is silent from the phone's side (U1-S7)**

With the browser-UA peek playing, toggle airplane mode for 20 s.
Expected: record whether `statusChange` fires anything at all during the gap. The main repo predicts no error. If nothing fires, the shipping output check needs its own "segments stopped" detection.

- [ ] **Step 4: Check and commit**

Run: `pnpm check`

```bash
git add modules/p5-spike/src/SpikeScreen.tsx
git commit -m "spike(p5): output check comparing default and browser User-Agent"
```

---

### Task 7: Soak build and the results document

**Files:**
- Modify (spike branch): `eas.json`
- Create (**main**): `docs/specs/2026-09-11-p5-android-results.md`

- [ ] **Step 1: Make `soak` a standalone APK.** The current `soak` extends `development`, a dev client that loads JS from Metro. That breaks the moment the phone leaves the laptop's network. In `eas.json` on the spike branch, replace the `soak` profile with:

```json
    "soak": {
      "extends": "base",
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "EXPO_PUBLIC_SEAZN_SOAK": "1"
      }
    },
```

Build with `pnpm eas build --profile soak --platform android --non-interactive --no-wait`. There is no local equivalent that sets the profile env, so if Task 0 was done use `EXPO_PUBLIC_SEAZN_SOAK=1 pnpm expo run:android --variant release --device 12be753e`.
Expected: the app opens straight to the spike screen **with the laptop's Metro stopped**.

```bash
git add eas.json
git commit -m "spike(p5): soak profile as standalone APK with embedded JS"
```

Note for `main`: its `soak` profile has the same dev-client flaw. Record it in the results doc under "Follow-ups".

- [ ] **Step 2: Write the results document on `main`**

```bash
git switch main
```

Create `docs/specs/2026-09-11-p5-android-results.md`:

````markdown
# P5 Device Spike — Android Results

**Status:** protocol ready, runs pending
**Handset:** OnePlus 10 Pro (NE2211), Snapdragon 8 Gen 1 (SM8450), Android 16, build NE2211_16.0.3.530(EX01)
**Engine:** StreamPack 3.2.0 (Apache-2.0) with libsrt (MPL-2.0, unmodified)
**Encode:** 1280×720, 30 fps, 3000 kbps, GOP 2 s, AAC 128 kbps 48 kHz
**Target:** Cloudflare live input, `recording.timeoutSeconds=180`, overlay from stg.seazn.club (football, in play)
**Power:** charging from a power bank throughout
**Code:** branch `spike/p5-android` — throwaway, never merged, deleted after this document is complete

## Baseline

Idle, screen on, charging, before any run (2026-09-11): thermal status **2 (moderate)**, battery 37.7 °C.
Every run starts with a 5-minute baseline, recorded below.

## Pass criteria (proposed — confirm before Run A)

| # | Criterion | Why |
|---|---|---|
| 1 | 3 h completes, publishing in ≥ 99% of samples outside deliberate outages | P5 |
| 2 | Thermal status never reaches 4 (critical) | P3; the ladder's thresholds come from the curve |
| 3 | Video bitrate stays at 3000 kbps (no encode shed) | §8: the encode is last |
| 4 | Drop inside 180 s resumes into ONE recording | C2, U1-S7 |
| 5 | Drop beyond 180 s: ENDLIST, second recording, app reconnects unaided | U1-S7 |
| 6 | Screen locked 10 min: playlist keeps advancing | Android lifecycle, §9 |
| 7 | 180° flip: preview, encoded picture and rotation metadata all correct | P4, three assertions |
| 8 | Audio mean volume above −40 dB in a 20 s sample | T1: a level floor, not stream presence |
| 9 | Battery never below 20% while charging | Power-bank setup is viable |

## Runs

### Run A — SRT, cellular, 3 h

| Minute | Action | Mark |
|---|---|---|
| 0–5 | Baseline, not publishing | — |
| 5 | Start SRT | mark-1 |
| 35 | Lock screen 10 min | mark-2 / mark-3 |
| 65 | Airplane mode 20 s | mark-4 / mark-5 |
| 95 | Rotate phone 180°, 2 min, rotate back | mark-6 / mark-7 |
| 125 | Airplane mode 200 s | mark-8 / mark-9 |
| 185 | Stop | mark-10 |

Results:

| Criterion | Result | Evidence |
|---|---|---|
| 1 | | `.p5/device/*.csv` |
| 2 | | peak status, minute first reached 3 |
| 3 | | |
| 4 | | recordings count after mark-5 |
| 5 | | ENDLIST time, reconnect seconds |
| 6 | | watcher lines mark-2..3 |
| 7 | | screenshot · ffprobe |
| 8 | | ffmpeg volumedetect |
| 9 | | |

Thermal curve (minute → status, headroom, battery °C):

### Run B — RTMPS, wifi, 1 h (T5, N5)

### Run C — forced fallback (bad SRT port)

| Measure | Result |
|---|---|
| First connecting → RTMPS publishing (s) | |

### Output check (U1-S6, U1-S7)

| Peek | Status sequence | Plays? |
|---|---|---|
| Default UA | | |
| Browser UA | | |
| Airplane 20 s during peek — events fired | | |

## Commands

```bash
node --env-file=.env.local scripts/p5/cf.ts create <run>
adb -s 12be753e push .p5/<run>.session.json /sdcard/Android/data/com.seazn.capture/files/p5-session.json
node scripts/p5/hls-watch.ts <playbackUrl> | tee .p5/<run>.hls.csv
# P4 + T1 sample, mid-run:
ffmpeg -user_agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" -i <playbackUrl> -t 20 -c copy .p5/<run>-sample.ts
ffprobe -v error -show_streams -show_entries stream_side_data .p5/<run>-sample.ts
ffmpeg -i .p5/<run>-sample.ts -af volumedetect -f null - 2>&1 | grep mean_volume
# after the run:
adb -s 12be753e pull /sdcard/Android/data/com.seazn.capture/files/ .p5/device/
node --env-file=.env.local scripts/p5/cf.ts cleanup <uid>
```

## Findings raised

## Follow-ups

- `main`'s `eas.json` `soak` profile extends `development` (a dev client that needs Metro); fix before any soak build from `main`.
````

```bash
git add docs/specs/2026-09-11-p5-android-results.md
git commit -m "docs: P5 Android spike protocol and results template"
git switch spike/p5-android
```

---

### Task 8: The runs (human in the loop), then teardown

The operator (the user) handles the phone. The agent runs the laptop side and fills in the document.

- [ ] **Step 1: Preconditions.** Confirm each with the user:
  - Staging football fixture is **public**, its competition has the `streaming.overlay` override, **granted before the first load** (a 404 caches for 300 s), and the fixture is **in play** in the scoring console.
  - `.env.local` has `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_STREAM_CUSTOMER_SUBDOMAIN`, `P5_OVERLAY_URL`.
  - `node --env-file=.env.local scripts/p5/cf.ts verify` prints `"status":"active"`.
  - The soak APK is installed; the phone is on cellular for Run A, and on the power bank.
  - The pass criteria table has been confirmed by the user.

- [ ] **Step 2: Run A** per the table in the results doc. The agent starts `hls-watch` (tee to `.p5/A.hls.csv`), takes the ffmpeg sample at about minute 100 (after the flip back), and at the end pulls the CSV and runs `cleanup`.

- [ ] **Step 3: Run B, then Run C, then the output check**, each with its own input and `cleanup`.

- [ ] **Step 4: Analyse and record.** From the CSVs compute, per run: publishing share, peak thermal status and the minute each status was first reached, headroom trend, min battery, bitrate min/max, reconnect durations. Fill every results cell. Add findings to `_FINDINGS.md` on `main` as N20+ (for example P3 numbers, an Android lock result, the UA answer, the fallback time), each with ID, status, where, and the evidence path.

- [ ] **Step 5: Confirm Cloudflare is clean**

Run: `node --env-file=.env.local scripts/p5/cf.ts verify`, then list inputs with a quick `GET /stream/live_inputs` via a one-off `curl` using the same token from `.env.local`.
Expected: no `p5-spike-*` inputs remain, and storage usage is back to its pre-spike value.

- [ ] **Step 6: Commit the results on `main`**

```bash
git switch main
git add docs/specs/2026-09-11-p5-android-results.md _FINDINGS.md
git commit -m "docs: P5 Android spike results and findings"
```

- [ ] **Step 7: Delete the spike** (per spec §11: throwaway, deleted after). Ask the user first. Deleting a branch is not reversible without the reflog.

```bash
git branch -D spike/p5-android
rm -rf .p5/device
```

Keep `.p5/*.hls.csv` and the device CSVs only if the user wants raw evidence; they are gitignored either way.
