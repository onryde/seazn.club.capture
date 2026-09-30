# S1 Plan A — JS domain, ports and screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are dispatched in the batches listed under **Dispatch batches**, one implementer per batch.

**Goal:** Make Live Stream real on the JavaScript side, against fakes. That covers the capture-qr.v2 and descriptor anti-corruption layer, a `DescriptorPort` that Home checks every stream code with, and the logger and session record. It also reshapes the engine port to the S1 snapshot and replaces the fake engine with scripted scenes. On screen, it builds the landscape viewfinder (Arm, Live and Ended on one screen), Settings and Diagnostics. The result is that every state in spec §6 can be rendered and tested on a laptop. Spec §7 phases 1 and 2 only.

**Architecture:** The wire shapes stop in `src/domain/credentials/` (`parseCaptureQr`, `parseDescriptor`), which build `StreamSession`. Home fetches the descriptor through a port before it saves a stream code, and the saved record carries the descriptor. The engine port takes `arm({session, heartbeat})` and reports a richer snapshot; the fake plays named scenes and holds no state machine of its own. Screens read primitives through `useSyncExternalStore` selectors. The status line is an i18n key chosen by a pure selector, and everything native (WebView, video, share sheet, fetch) reaches React through a port in `Ports`.

**Tech Stack:** Expo SDK 57, React Native 0.86.3, React 19.2, TypeScript 6 strict, Expo Router, react-native-reanimated 4.5.1, react-native-webview 13.16.1 and expo-video ~57.0.3 (both new, Task 15), vitest 5 (a `domain` project on node and a `ui` project on jsdom with react-native-web), pnpm 10.34.5.

**Spec:** `docs/specs/2026-09-30-s1-live-stream-design.md` (approved; binding; do not edit). Parents: `docs/specs/2026-09-29-s0-app-shell-design.md` and `AGENTS.md`. Plan B (Kotlin `core/`, phases 3–4) is a separate document.

## Global Constraints

- **Worktree.** Execute in `/Users/ashokhein/github/seazn.club.capture/.claude/worktrees/s1-plan-a` on branch `feat/s1-plan-a`, created from `docs/s1-live-stream-spec`. Run `pnpm install --frozen-lockfile` once first. Prefix every command you judge with `cd <that path> &&`, because the shell cwd resets to the main checkout between calls.
- **No EAS**, ever. Nothing in this plan needs a device build.
- **Out of scope:** Kotlin and native code, CI jobs, contract vendoring, and a real descriptor from the web. The fetch port is exercised only by unit tests with a stubbed `fetch`.
- **Layering** is `eslint-plugin-boundaries` (AGENTS §3):
  - `domain/` and `i18n/` are pure TypeScript, with no react, react-native, expo or services;
  - `ui/` never imports `expo-*`, `@/services/*` values, `@/scanner/*` or `@/hooks/nativePorts`;
  - services never import ui (so `src/services/native/nativeSurfaces.tsx` cannot use theme tokens; see D33);
  - UI tests may import pure services, never `@/services/native/*`.
- `type` in `domain/`, `interface` only for ports. No `any`, no barrels, no `utils/`, no `types/`.
- **Theme and text.** Colours only from `src/ui/theme/tokens.ts`. Text only through `<Text variant>`, apart from `ErrorBoundary` and `BootFailure`. `StyleSheet.create`; style arrays are built at module scope, never inline objects. **Red (`colour.live`) means ON AIR only**; trouble and failure are `colour.caution`.
- **Copy.** Every operator-visible string goes through `t()` in all four dictionaries (`en`, `es`, `fr`, `nl`), dev-only controls included. The non-English files keep `"_review": "pending native speaker"`. `src/i18n/dictionaries.test.ts` fails on any key or placeholder mismatch.
- **Secrets.** Never log, print, snapshot or screenshot a code's `raw`, `tok`, SRT passphrase or RTMPS stream key. Test fixtures use made-up values only. Log fields pass the allow-list scrub (Task 1).
- **Banned outright:** `console.*`, snapshot tests, React Query and `expo-camera`.
- **Shape.** Functions are 10–25 lines, with transition and scene tables exempt. JSX nests at most 3 levels. HUD components are `React.memo` with no anonymous functions in render.
- **The four questions** (AGENTS §10) are answered in each task's tests, or the task says why one does not apply.
- **Expected values** come from the dictionary or the spec's tables, never from the function under test.
- **Guard mutations.** Every guard named in a task is mutated once and a test must fail. Restore it from a `cp` backup, never with `git checkout` or `git stash`.
- **Counts.** When a count matters, run `pnpm vitest run --reporter=json --outputFile=/private/tmp/claude-501/s1a/r.json` and read `numTotalTests` / `numFailedTests`. Capture exit codes with `cmd > out 2>&1; echo "EXIT=$?"`.
- **Checks.** `pnpm check` is typecheck, lint, Prettier on `src app modules test`, and vitest. Also run `pnpm prettier --check` on any other file you touch (`package.json`, `app.json`, docs).
- **Commits.** Use `git commit -F -` with a heredoc and stage files by explicit path. Messages are conventional and end with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Plan decisions

The spec was silent or disagreed with the code on each of these points. The option chosen here is the one most consistent with the spec and AGENTS.md.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Descriptor `warmingDeadline` and `exp` are integer Unix **seconds**, like the QR's `exp`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D2  | Provisional descriptor URL: `GET {origin}/api/capture/sessions/{sid}/descriptor`. The origin is `https://seazn.club` for production and `https://stg.seazn.club` otherwise (`descriptorOrigin`, beside `seaznHosts`). Headers are `Authorization: Bearer <tok>`, `Cache-Control: no-store` and `Accept: application/json`. The web side owns the path (spec _Ask_); phase 5 reconciles it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3  | Status mapping. 200 with a parseable body and the scanned `sid` → ok. 200 with a malformed body or a different `sid` → `invalid`; **the only sid guard lives in the fetch port**. 200 with `state` `completed` or `failed` → `ended`. 401 → `invalid`; 404 → `not-found`; 410 → `ended{endReason}`; 429 → `rate-limited`. Any other status, a network error, or no answer within 8 s → `offline`. The spec's `DescriptorError` has no member for 5xx or a malformed 200, so these are the nearest honest ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D4  | Wire `endReason` values become domain values: `stopped`, `no-inbound-timeout`, `target-rejected`, `max-duration`, and `unknown` for a missing or unrecognised one. `no-inbound-timeout` and `max-duration` show the timed-out message; everything else shows "ended by the organiser".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D5  | `Retry-After` accepts integer seconds or an HTTP-date, clamped to 1–120 s; missing or garbage means 5 s. Home retries automatically once per 429 answer. `{n}` is the figure the server gave, not a ticking countdown, because Home is not worth a 1 Hz render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D6  | `recognise` treats v1 and any `v < 2` as `foreign` (spec §1: no v1 path) and `v > 2` as `newerVersion`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D7  | v2 validation: the SRT `passphrase` is required and non-empty, and `SrtCredentials.passphrase` stops being optional. A query string on `srt.url` is stripped, because the separate fields are canonical. `srt://` and `rtmps://` schemes are required. Every descriptor URL must be `https://`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D8  | The snapshot carries `descriptor: SessionDescriptor \| null` in place of `credentials`, so no ingest secret travels back up the bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D9  | New telemetry fields, named as plan B's `Snapshot` where the core reports them (D40): `bitrateKbps` and `targetBitrateKbps` (both `number \| null`), `encodedVideoFps`, `audioPacketsPerSecond`, `srt{sent, retransmitted, dropped, rttMs}\|null`, `delivery`, `deliveredLagMs`, `dataUsedBytes`, `charging`, `heartbeat{lastSentAtEpochMs, lastResult ('ok' \| 'failed' \| 'session-over'), consecutiveFailures, failures}`, `shed`. Flattened from plan B's `DeviceSample`: `batteryPercent`, `drainPctPerHour`, `thermalStatus` (named), `thermalHeadroom`. Platform facts plan C's bridge adds: `audioLevel`, `cameraReady`, `networkReachable`, `deliveryCheckedAtMs`, `captureTimestampMs`. Removed: `interruption` (it becomes the new `DegradeReason`s), `droppedFrames`, top-level `rttMs` and `batteryLevel`. `reconnecting` gains `holdWindowSeconds` and `cause` (D38); `ended` gains `durationMs`. `SessionEvent` and `projectEvent` are removed. |
| D10 | An organiser stop maps to EngineStatus `stopped`, so leaving forgets the code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D11 | Leaving from `failed` resets the engine after the write, keeping the code. Continue then re-arms instead of landing on Ended. A `stopped` engine is reset only if the rule was `freeAndForget`, as in S0 I1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D12 | **T14 M2.** Once the leave write settles, `leaveRule` is read again. If the broadcast is now on air, the app stays on `/stream`, logs `leave.cancelled-on-air`, and shows the leave-on-air line. Nothing is written back, because the engine wins at reopen (spec §1). S0's I1 row "went live again → Home" becomes "stays".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D13 | The Arm timeout sentence in spec §5 is 54 characters, over the 48-character status budget. The column says "Code timed out — ask the organiser for a new one" (48); Home's 410 panel keeps the full sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D14 | Tally plates: `starting` (idle), `notReady` (armed with a chip off), `ready` (lime), `connecting` (inert, never red), `live` (red), `trouble` (orange, for degraded and reconnecting), `ended` (inert). `tallyTone()` is the one place a plate becomes a colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D15 | The Go live hold fills lime. The Stop hold fills cream (`colour.ink`), so a fill is never red.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D16 | A `surfaces` port carries the three native views as components: `{Preview, Overlay, Video}`. The native versions are WebView and expo-video; Preview is an empty stage until phase 4 brings the engine's view. The fakes in `test/fakeSurfaces.ts` render plain `div`s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D17 | Spec §4 says "caption" over the stage. AGENTS §6 allows only edge strips over the preview. The top edge strip therefore carries every caption, one at a time, by priority: shed ("Phone is hot. Preview paused — still live"), then overlay failed, then the score-ahead note (Arm only), then not charging. The bottom strip carries the descriptor `label` and the Settings, Diagnostics and Home links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D18 | "Told once that they see the score slightly ahead" is the score-ahead note in the top strip while armed with the overlay on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D19 | `Route` gains `streamSettings` and `streamDiagnostics`. The Expo Router adapter **pushes** from `stream` to a sub-route and goes **back** from a sub-route to `stream`; everything else replaces. The viewfinder stays mounted under Settings, so the camera is never remounted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D20 | In Plan A the session record is a JS ring buffer of 1000 NDJSON lines. Moving JS entries into the native record (spec §5) needs a bridge intent the spec does not define, so it is phase 4's to add. Heartbeat failures are logged natively; Plan A only displays them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D21 | Share record uses a `SharePort` built on React Native's `Share.share({message})`. No new dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D22 | The licences are listed inline in Settings, behind an expander: libsrt MPL-2.0 (with its source URL), StreamPack Apache-2.0, react-native-webview MIT, expo-video MIT, React Native MIT and Expo MIT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D23 | Stream settings are stored under the key-value key `settings.stream` as `{v:1, overlay, side}`. Defaults: overlay on, controls on the right. A refused write is logged, and the choice holds for the session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D24 | "Scan another" calls `homeIntent.requestScan()` and then leaves. Home takes the request once its store is ready and scans from the Live Stream tile. This keeps S0's rule that only Home calls `scan()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D25 | `EXPO_PUBLIC_FAKE_DESCRIPTOR=1` in a `__DEV__` build swaps in the fake descriptor, because the web endpoint does not exist yet. The fake engine stays wired in `createNativePorts` until phase 4. `DevEngineControls` becomes dev-only scene buttons in Diagnostics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D26 | A refused orientation lock is retried once after 500 ms, and each refusal is logged. After a second refusal the lock is forgotten, as in S0's R26.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D27 | Each descriptor error panel has a short new title, with the spec's sentence as its body. Offline adds **Try again**. "Checking code…" has no buttons, and neither the dim area nor Back closes it; the fetch's 8 s timeout bounds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D28 | The saved-code record goes to v2 and v1 records are dropped (S0's clean-slate rule). `SavedCode.venueTz` is replaced by `descriptor: SessionDescriptor \| null`, and the zone is read with `venueZone(code)`. A stream record without a descriptor is dropped. `ExpiryNotice` and the reopen notice gain `venueTz`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D29 | The descriptor's `label` is shown in the bottom edge strip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D30 | The overlay's `delayMs = 0` is passed as a `delayMs=0` query parameter on `overlayUrl`, using the same URL-safe helper as D35. The web route's parameter name is **unverified**, and phase 5 reconciles it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D31 | `SavedCode.expiresAt` stays the QR's `exp`. The descriptor's own `exp` is kept inside the descriptor and not yet enforced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D32 | Diagnostics re-renders at 1 Hz on purpose, because it shows ticking values, and it is not the HUD. It subscribes the snapshot through `useEngineSelector`, never through Context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D33 | `nativeSurfaces.tsx` sits in `services/` and cannot import theme tokens, so it uses `'transparent'` (the absence of colour, not a colour) for the WebView background, with a comment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D34 | The logger's test double is the real logger over the ring record, since both are pure. Tests read `fakes.record.lines()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D35 | **ViewerPeek plays at a capped rendition.** The peek URL is the descriptor's `playbackUrl` with `clientBandwidthHint=1.0` added (Mbps; Cloudflare restricts the master to the rendition closest to it), so a peek on cellular costs little. Existing query parameters are kept, one of the same name is replaced, and composition is URL-safe. `peekPlaybackUrl` is a pure domain function (Task 20). Coordinator instruction, 2026-09-30, from Cloudflare's "use your own player" doc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D36 | **No `protocol=llhls` in S1.** It works only on inputs created with low latency enabled, which is unconfirmed. This is pending lane D's answer; a test pins its absence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D37 | **Manifests are never cached.** The player (expo-video, i.e. ExoPlayer on Android) fetches them live with `useCaching: false`, and nothing in JS fetches or stores a manifest. The only JS fetch is the descriptor, sent with `Cache-Control: no-store`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D38 | **`reconnecting` carries `cause`** (`uplink-lost`, `video-stalled`, `not-delivered`), as plan B's `ReconnectCause`. Each cause has its own status line with the hold's countdown: `holding` "Uplink lost — holding, 38 s of 183", `holdingStalled` "Video stalled — restarting, …", `holdingNotDelivered` "Viewers not receiving — restarting, …". The fake gains the `stalled` and `restarting` scenes; Tasks 12 and 22 test each cause. Coordinator instruction, from plan B's decision 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D39 | **`degraded` keeps a single `reason`.** The bridge sends `reasons.first()`, which plan B orders most important first. The HUD has one status line, so there is no UI need for the list; Diagnostics could show it, but that is not worth widening the type in S1. `audio-below-floor` stays in the TypeScript union but is never on the wire: "live with no sound" is a display rule, the level under `AUDIO_FLOOR` while publishing (Task 12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D40 | **Wire strings equal plan B's `.wire` values**: the seven state kinds, the four `EndReason`s, the five native `DegradeReason`s, `Delivery`, `ShedStep`, `Transport`, `ReconnectCause`, and the heartbeat results. The field names follow plan B's `Snapshot` (D9). `thermalStatus` stays a named union; plan C maps Android's int onto it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D41 | **`.prettierignore` is not touched by plan A.** Plan B's batch B1 adds its one line there, and no plan A task edits the file, so there is no ordering constraint between the plans on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Spec and code contradictions found

1. Spec §5's Arm timeout sentence is 54 characters, but `STATUS_LINE_BUDGET` is 48 (resolved by D13).
2. S0's I1 test expects a leave to go Home when the engine went live during the write, which contradicts T14 M2 (D12).
3. `DescriptorError` has no member for 5xx or a malformed 200 (D3).
4. Diagnostics needs snapshot fields the spec's §2 list omits (D9).
5. Spec §5 sends JS log entries into the native record, but no bridge intent exists for that (D20).
6. The Ended screen's "Scan another" collides with S0's rule that the stream route never calls `scan()` (D24).
7. A failed leave kept the engine ended in S0, so Continue would land on Ended (D11).
8. Spec §4 puts captions over the stage, but AGENTS §6 allows only edge strips (D17).
9. The v1 `parseSessionCredentials` reads `slotId`, `overlayUrl` and so on at top level. That does not match the v1 QR `recognise` accepts, and it is dead code, removed in Task 6.

### Not verified here (settle in the named task or on a device)

- react-native-web's keyboard path to `onPressIn` / `onPressOut` in jsdom (`keyDown` / `keyUp` with Enter) was read from RNW 0.21 source, not run. Task 18 Step 1 proves it before anything else leans on it.
- The exact versions `pnpm expo install` resolves, and the autolinking diff (Task 15).
- `AbortController` and `fetch` behaviour on Hermes. Only a stubbed fetch is tested.
- The overlay route's `delayMs` parameter (D30).
- Translation quality: every non-English string is a draft pending a native speaker (`_review`).
- Everything jsdom cannot see (AGENTS §10): plate colours, the Reanimated fill, WebView and expo-video rendering, TalkBack. These are listed in Task 26 for the device pass.

## Review Focus

Inputs and conditions the spec implies that ordinary happy-path tests would miss, most likely first. Each has a test in the task named.

1. **The descriptor fetch never answers**, as behind a captive portal at a club's Wi-Fi. Expect `offline` within 8 s, the scan flight released, and a second tap working. Pinned in Task 8 (the timeout races `fetch` and `json()`) and Task 10 (the flight ends after a held fetch times out).
2. **`Retry-After` arrives as an HTTP-date, or missing, garbage, negative or huge.** Expect a clamped 1–120 s and one automatic retry. Pinned in Task 8 (`parseRetryAfter` table) and Task 10.
3. **The descriptor answers for a different `sid` than the code scanned.** Expect `invalid`, never a saved session bound to the wrong match. Pinned in Task 8, with a guard mutation.
4. **The clock passes the warming deadline while nothing else changes.** No telemetry tick arrives and the engine stays `armed`. Expect Go live to disable itself and the status line to say the code timed out. Pinned in Task 13 (`warmingGate`) and Task 21 (a single timer at the deadline, with a mutation).
5. **A secret under an unexpected key, or inside a URL's query string**, reaches the logger. Expect `[scrubbed]` in the record. Pinned in Task 1 (the allow-list scrub, with a mutation).

## Dispatch batches

Each batch goes to **one implementer** as a single brief. Every task commits on its own. A batch ends with `pnpm check` green, the JSON counts reported, and every task's commit present. The reviewer then reviews the batch diff before the next batch starts.

| Batch | Tasks | Unit                                                                                                                                   | Files it owns (beyond its new files)                                                                                                                                                           | Runs                                                       |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | 1–2   | Logger, session record, scrub; the key-value timeout; refused Home writes logged                                                       | `usePorts.tsx`, `nativePorts.ts`, `test/fakePorts.ts`, `useHome.ts`, `useReopenGate.ts`, `modeStore.test.ts`, `HomeScreen.test.tsx`                                                            | first                                                      |
| 2     | 3–4   | Orientation lock logged and retried; leave logged, M2, failed reset; leave tests move to a hook test                                   | `useOrientationGate.ts(+test)`, `useStreamLeave.ts`, `StreamPlaceholderScreen.test.tsx`                                                                                                        | after 1                                                    |
| 3     | 5–6   | Descriptor parser, capture-qr.v2 parser, `StreamSession`; `parseSessionCredentials` and `transportPolicy` removed                      | `src/domain/credentials/**`, `src/domain/policy/transportPolicy*`, `test/fixtures/wire.ts`                                                                                                     | **parallel with 1 and 2**, in its own worktree (see below) |
| 4     | 7–10  | `recognise` v2; `DescriptorPort` (fetch and fake); saved code v2 with the descriptor; Home's checking and error panels                 | `Mode.ts`, `recognise.ts(+test)`, `savedCode.ts(+test)`, `reopen.ts(+test)`, `modeStore.ts(+test)`, `seaznHosts.ts`, `useHome.ts`, `CodePanel.tsx`, `HomeScreen.tsx(+test)`, Ports files, i18n | after 1, 2 and 3                                           |
| 5     | 11–14 | Engine port reshape and scripted fake; status keys in 4 languages; warming, preflight and tally; **phase 1 gate**                      | `modules/capture-engine/src/**`, `src/domain/session/**`, `engineSelectors.ts(+test)`, `DevEngineControls.tsx`, every test that forces an `ended` state, i18n                                  | after 4                                                    |
| 6     | 15–16 | New dependencies with the autolink check; the surfaces port; the stream settings store                                                 | `package.json`, `pnpm-lock.yaml`, `test/setup-ui.ts`, Ports files                                                                                                                              | after 5                                                    |
| 7     | 17–20 | HUD components: TallyPlate, LivePlate, Elapsed, AudioMeter, EdgeStrip, HoldAction, PreflightChips, OverlayPreview, ViewerPeek          | `src/ui/components/*` (new), `ErrorBoundary.tsx`, `test/setup-ui.ts`, i18n                                                                                                                     | after 6                                                    |
| 8     | 21–23 | The viewfinder: Arm, on-air states, Ended; Scan another; kill-while-live reopen; placeholder removed                                   | `app/stream/index.tsx`, `StreamScreen.tsx(+tests)`, `useViewfinder.ts`, `useStreamArm.ts`, `homeIntent.ts`, `useHome.ts`, i18n                                                                 | after 7                                                    |
| 9     | 24–26 | Navigation to Settings and Diagnostics; both screens; Share record; dev scenes; locale sweep; **phase 2 gate** and the mutation record | `devicePorts.ts`, `expoRouterNavigation.ts`, `app/stream/settings.tsx`, `app/stream/diagnostics.tsx`, the new screens, i18n                                                                    | after 8                                                    |

**Sequencing.** Batches 1, 2 and 4–9 must run in order, in one worktree. Each one edits files the next depends on: the `Ports` type, `nativePorts.ts`, `test/fakePorts.ts`, the four i18n JSON files, and `HomeScreen.test.tsx`.

**The one parallel lane.** Batch 3 may run beside Batches 1–2 in a second worktree (`.claude/worktrees/s1-plan-a-domain`, branch `feat/s1-plan-a-domain`). Its file set is provably disjoint. It creates or edits only `src/domain/credentials/**`, deletes only `src/domain/policy/transportPolicy.ts` and its test, and adds `test/fixtures/wire.ts`. It imports nothing that Batches 1–2 change. Before starting, confirm the claim with `rg -l "parseSessionCredentials|transportPolicy" src app modules test`, which should list only the files Batch 3 deletes. Merge Batch 3 into `feat/s1-plan-a` (a fast-forward or a clean merge) before Batch 4 starts. If that check lists any other file, run Batch 3 sequentially after Batch 2.

**Nothing else may run in parallel.** In particular, Batch 5's engine reshape edits `useOrientationGate.test.tsx` and `HomeScreen.test.tsx`, both of which Batches 2 and 4 own.

## File structure

| Path                                                                                                                                                                                         | Responsibility                                                                    | Task   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `src/services/scrub.ts`                                                                                                                                                                      | Allow-list scrub of log fields                                                    | 1      |
| `src/services/sessionRecord.ts`                                                                                                                                                              | NDJSON ring buffer, the JS session record                                         | 1      |
| `src/services/logger.ts`                                                                                                                                                                     | The levelled logger port, writing scrubbed entries to the record                  | 1      |
| `src/services/kvTimeout.ts`                                                                                                                                                                  | Wraps a `KeyValueStore` so no call outlives 5 s                                   | 2      |
| `src/domain/credentials/wire.ts`                                                                                                                                                             | `WireError` and the shared readers of untrusted JSON                              | 5      |
| `src/domain/credentials/SessionDescriptor.ts`                                                                                                                                                | The descriptor value, `DescriptorError`, organiser end reasons                    | 5      |
| `src/domain/credentials/parseDescriptor.ts`                                                                                                                                                  | Wire → `SessionDescriptor`, and back for storage                                  | 5      |
| `src/domain/credentials/parseCaptureQr.ts`                                                                                                                                                   | capture-qr.v2 → `CaptureCode`                                                     | 6      |
| `src/domain/credentials/StreamSession.ts`                                                                                                                                                    | `StreamSession`, and building one from a code and a descriptor                    | 6      |
| `src/domain/mode/savedSession.ts`                                                                                                                                                            | A saved stream code → `StreamSession`, or why not                                 | 9      |
| `src/services/descriptorPort.ts`                                                                                                                                                             | `DescriptorPort`                                                                  | 8      |
| `src/services/fetchDescriptorPort.ts`                                                                                                                                                        | The real port over `fetch`, with a timeout, Retry-After and the sid guard         | 8      |
| `src/services/fakeDescriptorPort.ts`                                                                                                                                                         | `sampleDescriptor` and the scriptable fake                                        | 8      |
| `src/hooks/statusKey.ts`                                                                                                                                                                     | Snapshot → status-line key; the Arm overrides                                     | 12     |
| `src/domain/session/warming.ts`                                                                                                                                                              | The warming-deadline gate                                                         | 13     |
| `src/hooks/preflight.ts`                                                                                                                                                                     | Chips, the Go live blocker, tally plate and tone                                  | 13     |
| `src/services/surfaces.ts`, `src/services/native/nativeSurfaces.tsx`, `test/fakeSurfaces.ts`                                                                                                 | The native views as a port                                                        | 15     |
| `src/services/streamSettingsStore.ts`, `src/hooks/useStreamSettings.ts`                                                                                                                      | Score preview on/off, and the controls side                                       | 16     |
| `src/i18n/formatElapsed.ts`                                                                                                                                                                  | H:MM:SS                                                                           | 17     |
| `src/ui/components/{TallyPlate,LivePlate,Elapsed,AudioMeter,EdgeStrip}.tsx`                                                                                                                  | HUD atoms                                                                         | 17     |
| `src/hooks/useHold.ts`, `src/ui/components/{HoldAction,HoldFill}.tsx`                                                                                                                        | The 3 s hold                                                                      | 18     |
| `src/ui/components/{PreflightChips,OverlayPreview}.tsx`, `src/hooks/advisory.ts`, `src/domain/session/previewUrls.ts`                                                                        | Arm chips, the overlay (`delayMs=0`) and the top strip; Task 20 adds the peek URL | 19, 20 |
| `src/hooks/usePeek.ts`, `src/ui/components/{ViewerPeek,StageVideo}.tsx`                                                                                                                      | "What viewers see"                                                                | 20     |
| `src/hooks/{useStreamArm,useViewfinder,useDeadlinePassed}.ts`, `src/ui/components/{StreamStage,StreamColumn,EndedBlock}.tsx`, `src/ui/screens/StreamScreen.tsx`, `test/renderViewfinder.tsx` | The viewfinder                                                                    | 21–23  |
| `src/services/homeIntent.ts`                                                                                                                                                                 | The "scan another" hand-off to Home                                               | 23     |
| `src/ui/screens/SettingsScreen.tsx`, `app/stream/settings.tsx`                                                                                                                               | Settings                                                                          | 24     |
| `src/ui/screens/DiagnosticsScreen.tsx`, `app/stream/diagnostics.tsx`, `src/hooks/diagnostics.ts`, `src/ui/components/DevScenes.tsx`, `src/services/native/nativeShare.ts`                    | Diagnostics, Share, dev scenes                                                    | 25     |
| `test/fixtures/wire.ts`, `test/fixtures/savedStream.ts`                                                                                                                                      | Made-up v2 codes and descriptors                                                  | 5, 9   |

Removed: `src/domain/credentials/parseSessionCredentials.ts(+test)` and `src/domain/policy/transportPolicy.ts(+test)` in Task 6. `src/domain/session/projectEvent.ts(+test)` in Task 11. `src/ui/screens/StreamPlaceholderScreen.tsx(+test)` and `src/hooks/useSavedStreamSlot.ts` in Task 21. `src/ui/components/DevEngineControls.tsx` in Task 25.

---

## Phase 1 — Domain and ports

### Task 1: Logger, session record and the allow-list scrub

AGENTS §11 asks for one levelled logger that feeds the session record, and spec §3 asks for an allow-list scrub. S0 has neither, so every "Gap: S0 has no logger" comment in the code is waiting on this task.

**Files:**

- Create: `src/services/scrub.ts`, `src/services/scrub.test.ts`
- Create: `src/services/sessionRecord.ts`, `src/services/sessionRecord.test.ts`
- Create: `src/services/logger.ts`, `src/services/logger.test.ts`
- Modify: `src/hooks/usePorts.tsx` (the `Ports` type)
- Modify: `src/hooks/nativePorts.ts`
- Modify: `test/fakePorts.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `LogValue`, `LogFields`, `SCRUBBED`, `scrubFields(fields)`, `scrubEvent(event)`;
  - `LogLevel`, `LogEntry`, `interface SessionRecord {append; lines; subscribe}`, `RECORD_CAPACITY = 1000`, `toRecordLine`, `createRingRecord(capacity?)`;
  - `interface Logger {debug; info; warn; error}` (each `(event: string, fields?: LogFields) => void`), `createLogger({record, now, minLevel?})`;
  - `Ports.logger` and `Ports.record`;
  - in `test/fakePorts.ts`: `FakePorts.record` and `readRecord(record): RecordedEntry[]`.

- [ ] **Step 1: Write the failing scrub tests**

`src/services/scrub.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SCRUBBED, scrubEvent, scrubFields } from '@/services/scrub';

describe('scrubFields (allow-list, spec §3)', () => {
  it('keeps allow-listed keys holding plain words, numbers and booleans', () => {
    const fields = { kind: 'offline', status: 503, attempt: 2, op: 'set', key: 'code.stream' };
    expect(scrubFields(fields)).toEqual(fields);
  });

  it('scrubs a secret under a key nobody expected', () => {
    const fields = { tok: 'abc', passphrase: 'p', streamKey: 'k', token: 't', raw: '{"v":2}' };
    expect(scrubFields(fields)).toEqual({
      tok: SCRUBBED,
      passphrase: SCRUBBED,
      streamKey: SCRUBBED,
      token: SCRUBBED,
      raw: SCRUBBED,
    });
  });

  it('scrubs a sentence or a URL under an allow-listed key', () => {
    expect(scrubFields({ reason: 'srt://h:778?passphrase=abc' })).toEqual({ reason: SCRUBBED });
    expect(scrubFields({ reason: 'bad token abc' })).toEqual({ reason: SCRUBBED });
  });

  it.each([
    ['https://stg.seazn.club/overlay/fixtures/f1', true],
    ['https://video.example:8443/a/b.m3u8', true],
    ['https://video.example/a.m3u8?token=abc', false],
    ['https://video.example/a#frag', false],
    ['https://user:pass@video.example/a', false],
    ['rtmps://live.example/live/key', false],
    ['http://video.example/a', false],
  ])('passes %s as a url only when it is public: %s', (url, passes) => {
    expect(scrubFields({ url })).toEqual({ url: passes ? url : SCRUBBED });
  });

  it('scrubs a number that is not finite', () => {
    expect(scrubFields({ ms: Number.NaN })).toEqual({ ms: SCRUBBED });
  });

  it('returns nothing for nothing', () => {
    expect(scrubFields({})).toEqual({});
  });
});

describe('scrubEvent', () => {
  it('keeps a dotted event name and scrubs anything else', () => {
    expect(scrubEvent('kv.timeout')).toBe('kv.timeout');
    expect(scrubEvent('tok=abc')).toBe(SCRUBBED);
    expect(scrubEvent('')).toBe(SCRUBBED);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/services/scrub.test.ts`
Expected: FAIL, "Cannot find module '@/services/scrub'".

- [ ] **Step 3: Implement the scrub**

`src/services/scrub.ts`:

```ts
/**
 * The allow-list scrub (spec §3 SessionRecord, AGENTS §11). A field survives
 * only when its key is on the list and its value is a short plain word, a
 * number or a boolean — or when it is `url` holding a public https URL with
 * no query, fragment or userinfo. Everything else becomes `[scrubbed]`: a
 * secret under a key nobody expected is exactly what a deny-list misses.
 */
export type LogValue = string | number | boolean | null;
export type LogFields = Readonly<Record<string, LogValue>>;

export const SCRUBBED = '[scrubbed]';

const PLAIN_KEYS: ReadonlySet<string> = new Set([
  'action',
  'attempt',
  'count',
  'endReason',
  'key',
  'kind',
  'lock',
  'mode',
  'ms',
  'op',
  'problem',
  'reason',
  'retryAfterS',
  'route',
  'scene',
  'state',
  'status',
  'transport',
]);

/** A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or message fits. */
const PLAIN_WORD = /^[\w.:-]{1,64}$/;
const PUBLIC_URL = /^https:\/\/[^/?#@\s:]+(:\d+)?(\/[^?#\s]*)?$/i;

export function scrubFields(fields: LogFields): LogFields {
  const clean: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) clean[key] = scrubValue(key, value);
  return clean;
}

export function scrubEvent(event: string): string {
  return PLAIN_WORD.test(event) ? event : SCRUBBED;
}

function scrubValue(key: string, value: LogValue): LogValue {
  if (key === 'url') return typeof value === 'string' && PUBLIC_URL.test(value) ? value : SCRUBBED;
  if (!PLAIN_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'string') return PLAIN_WORD.test(value) ? value : SCRUBBED;
  return typeof value === 'number' && !Number.isFinite(value) ? SCRUBBED : value;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/services/scrub.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Write the failing record and logger tests**

`src/services/sessionRecord.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRingRecord, toRecordLine, type LogEntry } from '@/services/sessionRecord';

const entry = (event: string, atMs = 0): LogEntry => ({ atMs, level: 'info', event, fields: {} });

describe('the session record', () => {
  it('writes one NDJSON line per entry, in order', () => {
    const record = createRingRecord();
    record.append(entry('first', Date.parse('2026-10-03T13:00:00Z')));
    record.append(entry('second'));
    expect(record.lines()).toHaveLength(2);
    expect(JSON.parse(record.lines()[0] ?? '')).toEqual({
      at: '2026-10-03T13:00:00.000Z',
      level: 'info',
      event: 'first',
      fields: {},
    });
  });

  it('keeps only the newest lines at capacity', () => {
    const record = createRingRecord(3);
    for (const name of ['a', 'b', 'c', 'd']) record.append(entry(name));
    expect(record.lines().map((line) => JSON.parse(line).event)).toEqual(['b', 'c', 'd']);
  });

  it('hands out the same array until something is appended (useSyncExternalStore)', () => {
    const record = createRingRecord();
    const before = record.lines();
    expect(record.lines()).toBe(before);
    record.append(entry('x'));
    expect(record.lines()).not.toBe(before);
  });

  it('tells subscribers, and stops telling them once unsubscribed', () => {
    const record = createRingRecord();
    const listener = vi.fn();
    const unsubscribe = record.subscribe(listener);
    record.append(entry('x'));
    unsubscribe();
    record.append(entry('y'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('formats a line without the caller reshaping it', () => {
    expect(toRecordLine({ atMs: 0, level: 'warn', event: 'e', fields: { kind: 'k' } })).toBe(
      '{"at":"1970-01-01T00:00:00.000Z","level":"warn","event":"e","fields":{"kind":"k"}}',
    );
  });
});
```

`src/services/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLogger } from '@/services/logger';
import { SCRUBBED } from '@/services/scrub';
import { createRingRecord } from '@/services/sessionRecord';

const parsed = (lines: readonly string[]) => lines.map((line) => JSON.parse(line));

describe('the logger', () => {
  it('writes each level to the record, stamped with the clock', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => Date.parse('2026-10-03T13:00:00Z') });
    logger.warn('kv.timeout', { op: 'set' });
    expect(parsed(record.lines())).toEqual([
      { at: '2026-10-03T13:00:00.000Z', level: 'warn', event: 'kv.timeout', fields: { op: 'set' } },
    ]);
  });

  it('scrubs before anything reaches the record', () => {
    const record = createRingRecord();
    createLogger({ record, now: () => 0 }).error('descriptor.error', { tok: 'secret-token' });
    expect(record.lines().join('')).not.toContain('secret-token');
    expect(parsed(record.lines())[0].fields).toEqual({ tok: SCRUBBED });
  });

  it('drops entries below its floor', () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0, minLevel: 'info' });
    logger.debug('noise');
    logger.info('kept');
    expect(parsed(record.lines()).map((line) => line.event)).toEqual(['kept']);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm vitest run src/services/sessionRecord.test.ts src/services/logger.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 7: Implement the record and the logger**

`src/services/sessionRecord.ts`:

```ts
import type { LogFields } from '@/services/scrub';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One entry, already scrubbed. Scrubbing happens before an entry exists, never after. */
export type LogEntry = {
  readonly atMs: number;
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
};

/**
 * The session record (spec §5): what happened at the ground, in order, as
 * NDJSON. In Plan A it is a JS ring buffer; phase 4 routes entries into the
 * native record while a session exists (D20). Shaped for useSyncExternalStore:
 * `lines()` returns the same array until something is appended.
 */
export interface SessionRecord {
  append(entry: LogEntry): void;
  lines(): readonly string[];
  subscribe(onChange: () => void): () => void;
}

export const RECORD_CAPACITY = 1000;

export function toRecordLine({ atMs, level, event, fields }: LogEntry): string {
  return JSON.stringify({ at: new Date(atMs).toISOString(), level, event, fields });
}

export function createRingRecord(capacity: number = RECORD_CAPACITY): SessionRecord {
  let lines: readonly string[] = [];
  const listeners = new Set<() => void>();
  return {
    append: (entry) => {
      const kept = lines.length < capacity ? lines : lines.slice(lines.length - capacity + 1);
      lines = [...kept, toRecordLine(entry)];
      for (const listener of listeners) listener();
    },
    lines: () => lines,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
```

`src/services/logger.ts`:

```ts
import { scrubEvent, scrubFields, type LogFields } from '@/services/scrub';
import type { LogLevel, SessionRecord } from '@/services/sessionRecord';

/**
 * The one levelled logger (AGENTS §11). There is no console anywhere: every
 * entry lands in the session record, scrubbed by the allow-list first.
 */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(deps: {
  record: SessionRecord;
  now: () => number;
  minLevel?: LogLevel;
}): Logger {
  const floor = RANK[deps.minLevel ?? 'debug'];
  const at =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      if (RANK[level] < floor) return;
      const entry = {
        atMs: deps.now(),
        level,
        event: scrubEvent(event),
        fields: scrubFields(fields),
      };
      deps.record.append(entry);
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm vitest run src/services`
Expected: PASS.

- [ ] **Step 9: Put the logger and record in the ports**

In `src/hooks/usePorts.tsx`, add imports and two fields after `splash`:

```ts
import type { Logger } from '@/services/logger';
import type { SessionRecord } from '@/services/sessionRecord';
```

```ts
  /** The one levelled logger (AGENTS §11); its entries land in `record`, scrubbed. */
  readonly logger: Logger;
  /** The session record Diagnostics shows and shares (spec §4). */
  readonly record: SessionRecord;
```

In `src/hooks/nativePorts.ts`, import `createLogger` and `createRingRecord`. Build them first in `createNativePorts()`:

```ts
const record = createRingRecord();
const logger = createLogger({ record, now: Date.now, minLevel: __DEV__ ? 'debug' : 'info' });
```

Then add `logger, record,` to the returned object.

In `test/fakePorts.ts`:

- import `createLogger`, `createRingRecord` and `type SessionRecord`;
- add `readonly record: SessionRecord;` to `FakePorts`;
- in `createFakePorts`, build `const record = createRingRecord();` and `const logger = createLogger({ record, now: () => now.getTime() });`;
- add `record` to `fakes` and `logger` to `ports` (before `...portOverrides`);
- export the reader tests use:

```ts
export type RecordedEntry = {
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** The record's lines, parsed, for assertions. */
export function readRecord(record: SessionRecord): RecordedEntry[] {
  return record.lines().map((line) => JSON.parse(line) as RecordedEntry);
}
```

- [ ] **Step 10: Verify, including the composition root (failure class 1)**

Run: `pnpm typecheck && pnpm vitest run`
Expected: typecheck exit 0 and every test PASS. Then `rg -n "logger|record" src/hooks/nativePorts.ts` must show both in the returned object, not only in the fake.

- [ ] **Step 11: Mutate the scrub once**

`cp src/services/scrub.ts /private/tmp/claude-501/s1a/scrub.bak`. Change `if (!PLAIN_KEYS.has(key)) return SCRUBBED;` to `if (false) return SCRUBBED;`.
Run: `pnpm vitest run src/services/scrub.test.ts`. Expected: FAIL ("scrubs a secret under a key nobody expected"). Restore with `cp /private/tmp/claude-501/s1a/scrub.bak src/services/scrub.ts` and re-run: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/services/scrub.ts src/services/scrub.test.ts src/services/sessionRecord.ts src/services/sessionRecord.test.ts src/services/logger.ts src/services/logger.test.ts src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts
git commit -F - <<'EOF'
feat(services): levelled logger, session record and allow-list scrub

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) the record's array identity is stable between appends; (2) empty fields and an empty event name are tested; (3) not applicable, as this is pure and synchronous; (4) not applicable, as nothing here is copy.

---

### Task 2: The key-value port's 5 s timeout, and refused Home writes logged

Spec §5: "The key-value port gets a 5 s timeout". In S0 one write that never settles held the mode store's serial queue, and with it Home's scan flight, forever. S0 also swallowed a refused expiry delete with no record of it.

**Files:**

- Create: `src/services/kvTimeout.ts`, `src/services/kvTimeout.test.ts`
- Modify: `src/services/modeStore.test.ts` (one new test)
- Modify: `src/hooks/nativePorts.ts` (wrap the SecureStore adapter)
- Modify: `src/hooks/useHome.ts` (`useSaveFailed`, `useOpenCode`, `useContinue`, `useForget`)
- Modify: `src/hooks/useReopenGate.ts` (`ignoreRefusedDelete`)
- Modify: `src/ui/screens/HomeScreen.test.tsx` (log assertions, plus the stuck-write test)

**Interfaces:**

- Consumes: `Logger` (Task 1).
- Produces: `KV_TIMEOUT_MS = 5000`, `withTimeout(kv, {logger, ms?}): KeyValueStore` and `isKvTimeout(error)`. The events logged are `kv.timeout {op, key, ms}` and `store.write-refused {action}`, where `action` is `open`, `continue`, `forget` or `expire`.

- [ ] **Step 1: Write the failing timeout tests**

`src/services/kvTimeout.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { isKvTimeout, KV_TIMEOUT_MS, withTimeout } from '@/services/kvTimeout';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';

const never = <T>() => new Promise<T>(() => undefined);

function wrap(kv: KeyValueStore) {
  const record = createRingRecord();
  const store = withTimeout(kv, { logger: createLogger({ record, now: () => 0 }) });
  return { store, events: () => record.lines().map((line) => JSON.parse(line)) };
}

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes answers straight through', async () => {
    const { store } = wrap(createMemoryKeyValueStore({ a: '1' }));
    await expect(store.get('a')).resolves.toBe('1');
  });

  it('rejects a call that never settles after 5 s, and logs it', async () => {
    const hanging: KeyValueStore = { get: never, set: never, delete: never };
    const { store, events } = wrap(hanging);
    const write = store.set('code.stream', 'x');
    const settled = expect(write).rejects.toSatisfy(isKvTimeout);
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS - 1);
    expect(events()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(events()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'kv.timeout',
        fields: { op: 'set', key: 'code.stream', ms: KV_TIMEOUT_MS },
      }),
    ]);
  });

  it('passes a refusal through unchanged and logs nothing', async () => {
    const refusing: KeyValueStore = {
      get: () => Promise.reject(new Error('keystore locked')),
      set: never,
      delete: never,
    };
    const { store, events } = wrap(refusing);
    await expect(store.get('a')).rejects.toThrow('keystore locked');
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    expect(events()).toEqual([]);
  });

  it('turns a synchronous throw into a rejection', async () => {
    const throwing: KeyValueStore = {
      get: () => {
        throw new Error('native module missing');
      },
      set: never,
      delete: never,
    };
    const { store } = wrap(throwing);
    await expect(store.get('a')).rejects.toThrow('native module missing');
  });
});
```

Add to `src/services/modeStore.test.ts` (with imports of `vi`, `withTimeout`, `KV_TIMEOUT_MS`, `createLogger` and `createRingRecord`):

```ts
describe('mode store behind the 5 s timeout (spec §5)', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the next write run once a stuck one times out', async () => {
    vi.useFakeTimers();
    const memory = createMemoryKeyValueStore();
    let stuck = true;
    const hanging: KeyValueStore = {
      get: memory.get,
      set: (key, value) => (stuck ? new Promise(() => undefined) : memory.set(key, value)),
      delete: memory.delete,
    };
    const logger = createLogger({ record: createRingRecord(), now: () => 0 });
    const store = createModeStore(withTimeout(hanging, { logger }));
    await store.load();
    const first = expect(store.setActive('stream')).rejects.toThrow('did not settle');
    stuck = false;
    const second = store.forget('stream');
    await vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS);
    await first;
    await expect(second).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/services/kvTimeout.test.ts src/services/modeStore.test.ts`
Expected: FAIL, module `@/services/kvTimeout` not found.

- [ ] **Step 3: Implement the timeout**

`src/services/kvTimeout.ts`:

```ts
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';

/**
 * S0's gap (spec §5): one SecureStore call that never settled held the mode
 * store's serial queue, so every later write — and Home's scan flight behind
 * it — waited forever. No call outlives this; a late answer is ignored.
 */
export const KV_TIMEOUT_MS = 5000;

type Op = 'get' | 'set' | 'delete';

export function withTimeout(
  kv: KeyValueStore,
  deps: { logger: Logger; ms?: number },
): KeyValueStore {
  const guard = timeoutGuard(deps.logger, deps.ms ?? KV_TIMEOUT_MS);
  return {
    get: (key) => guard('get', key, () => kv.get(key)),
    set: (key, value) => guard('set', key, () => kv.set(key, value)),
    delete: (key) => guard('delete', key, () => kv.delete(key)),
  };
}

export function isKvTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'KvTimeoutError';
}

function timeoutGuard(logger: Logger, ms: number) {
  return <T>(op: Op, key: string, run: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.warn('kv.timeout', { op, key, ms });
        reject(timeoutError(op));
      }, ms);
      // `then(run)`, not `run()`: a synchronous throw becomes a rejection.
      Promise.resolve()
        .then(run)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
}

function timeoutError(op: Op): Error {
  const error = new Error(`key-value ${op} did not settle`);
  error.name = 'KvTimeoutError';
  return error;
}
```

In `src/hooks/nativePorts.ts`, replace `const kv = createSecureKeyValueStore();` with the line below, placed after the logger is built:

```ts
const kv = withTimeout(createSecureKeyValueStore(), { logger });
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/services`
Expected: PASS.

- [ ] **Step 5: Write the failing Home tests for the refusals and the stuck write**

In `src/ui/screens/HomeScreen.test.tsx`, import `readRecord` from `../../../test/fakePorts` and `withTimeout` and `KV_TIMEOUT_MS` from `@/services/kvTimeout`.

In `'says so and stays on Home when a scanned code hits %s refused'`, add after `expect(rejections).toEqual([]);`:

```ts
expect(readRecord(home.record)).toContainEqual(
  expect.objectContaining({ event: 'store.write-refused', fields: { action: 'open' } }),
);
```

In `'says so when %s cannot write, and keeps the card'`, bind the render to `home` if it is not already, and add:

```ts
const action = name === 'Continue' ? 'continue' : 'forget';
expect(readRecord(home.record)).toContainEqual(
  expect.objectContaining({ event: 'store.write-refused', fields: { action } }),
);
```

Add a new describe:

```ts
describe('Home: a store write that never settles (spec §5)', () => {
  afterEach(() => vi.useRealTimers());

  it('says so after 5 s and lets the operator scan again', async () => {
    vi.useFakeTimers();
    const memory = createMemoryKeyValueStore();
    const stuck: KeyValueStore = {
      get: memory.get,
      set: () => new Promise(() => undefined),
      delete: memory.delete,
    };
    const fakes = createFakePorts();
    const modeStore = createModeStore(withTimeout(stuck, { logger: fakes.ports.logger }));
    const home = renderWithPorts(<HomeScreen />, { modeStore });
    await act(() => home.ports.modeStore.load());
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
    await act(() => vi.advanceTimersByTimeAsync(KV_TIMEOUT_MS));
    expect(screen.getByText(SAVE_FAILED)).toBeTruthy();
    fireEvent.click(liveStreamTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
  });
});
```

(`SAVE_FAILED` is the existing constant for `store.saveFailed`'s English text. `streamRaw` is replaced by `captureRaw` in Task 7, so leave it as it is here.)

- [ ] **Step 6: Run to verify the new assertions fail**

Run: `pnpm vitest run src/ui/screens/HomeScreen.test.tsx`
Expected: FAIL on the `store.write-refused` assertions, because nothing is logged yet. The stuck-write test should already PASS through the existing flight code; if it fails, stop and report it, because that is a finding.

- [ ] **Step 7: Log refused writes in Home and the reopen gate**

In `src/hooks/useHome.ts`:

```ts
type SaveAction = 'open' | 'continue' | 'forget';

/**
 * Ruling R19: a write the phone refuses is never silent — on screen, and now
 * in the record too (spec §5).
 */
function useSaveFailed(setStatusKey: SetStatusKey): (action: SaveAction) => void {
  const { modeStore, logger } = usePorts();
  return useCallback(
    (action: SaveAction) => {
      logger.warn('store.write-refused', { action });
      modeStore.dismissNotices();
      setStatusKey('store.saveFailed');
    },
    [modeStore, logger, setStatusKey],
  );
}
```

Change the parameter type `saveFailed: () => void` to `saveFailed: (action: SaveAction) => void` in `useOpenCode`, `useContinue` and `useForget`. Then make three call-site edits:

- `useOpenCode` becomes `} catch { return saveFailed('open'); }`.
- `useContinue` becomes `.then(() => {…}, () => saveFailed('continue'))`. In the same hook, replace `.catch(expiredAnyway)` with `.catch(() => logger.warn('store.write-refused', { action: 'expire' }))`, taking `logger` from `usePorts()`, and delete `expiredAnyway`.
- `useForget` becomes `.then(() => setStatusKey(null), () => saveFailed('forget'))`.

In `src/hooks/useReopenGate.ts`, delete `ignoreRefusedDelete`. Take `logger` from `usePorts()` in `useSettle` and use:

```ts
void modeStore
  .expire(expired, notice)
  .catch(() => logger.warn('store.write-refused', { action: 'expire' }));
```

- [ ] **Step 8: Run to verify everything passes**

Run: `pnpm vitest run src/ui/screens/HomeScreen.test.tsx src/hooks`
Expected: PASS.

- [ ] **Step 9: Mutate the timeout once**

`cp src/services/kvTimeout.ts /private/tmp/claude-501/s1a/kvTimeout.bak`. In `timeoutGuard`, change `}, ms);` to `}, ms * 1000);`.
Run: `pnpm vitest run src/services/kvTimeout.test.ts src/ui/screens/HomeScreen.test.tsx`. Expected: FAIL ("rejects a call that never settles after 5 s", and "says so after 5 s"). Restore from the backup and re-run: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/services/kvTimeout.ts src/services/kvTimeout.test.ts src/services/modeStore.test.ts src/hooks/nativePorts.ts src/hooks/useHome.ts src/hooks/useReopenGate.ts src/ui/screens/HomeScreen.test.tsx
git commit -F - <<'EOF'
feat(services): 5 s timeout on the key-value port; refused writes logged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second write after a stuck one runs (modeStore test), and so does a second tap (Home test); (2) not applicable, as there is no input; (3) a refused write and a write that never settles are both covered; (4) not applicable, since the copy is unchanged.

---

### Task 3: A refused orientation lock is logged and retried once

Spec §4 lists "Orientation lock: a refused lock is retried once the logger exists" among the S0 gaps S1 closes. S0 forgot the refused lock silently (R26), and a failed accelerometer check left no trace either.

**Files:**

- Modify: `src/hooks/useOrientationGate.ts`
- Modify: `src/hooks/useOrientationGate.test.tsx` (the R26 tests)

**Interfaces:**

- Consumes: `Ports.logger`.
- Produces: `LOCK_RETRY_MS = 500`, exported from `useOrientationGate.ts`. The events logged are `orientation.lock-refused {lock, attempt}` and `motion.check-failed`.

- [ ] **Step 1: Rewrite the R26 tests to the new rule**

In `src/hooks/useOrientationGate.test.tsx`:

- import `afterEach` and `vi`, `LOCK_RETRY_MS`, and `readRecord` from `../../test/fakePorts`;
- add `afterEach(() => vi.useRealTimers());` inside `describe('useOrientationGate', …)`;
- replace `'retries a lock the platform refused (R26)'` with the two tests below;
- extend `'treats a failed accelerometer check as no accelerometer (R26)'` with the record assertion shown.

```ts
it('retries a refused lock once, half a second later, and logs it (D26)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  const lock = fakes.orientationLock.lock;
  let refusals = 1;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  await gate('landscape', fakes); // on air, nothing locked: landscape at once (R37), refused
  expect(fakes.orientationLock.locks).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS));
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
  expect(readRecord(fakes.record)).toContainEqual(
    expect.objectContaining({
      event: 'orientation.lock-refused',
      fields: { lock: 'landscape', attempt: 1 },
    }),
  );
});

it('forgets a lock refused twice, so the next differing lock is sent again (R26)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  const lock = fakes.orientationLock.lock;
  let refusals = 2;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  await gate('landscape', fakes);
  await act(() => vi.advanceTimersByTimeAsync(LOCK_RETRY_MS));
  expect(fakes.orientationLock.locks).toEqual([]);
  hold(fakes, UPRIGHT, 1000); // on air: keep
  hold(fakes, SIDEWAYS, 2000); // the same lock again: sent, not deduped
  await act(async () => undefined);
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
  const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
  expect(refused.map((e) => e.fields.attempt)).toEqual([1, 2]);
});
```

Add to the accelerometer test:

```ts
expect(readRecord(fakes.record).map((e) => e.event)).toContain('motion.check-failed');
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/hooks/useOrientationGate.test.tsx`
Expected: FAIL. `LOCK_RETRY_MS` is not exported, and nothing is logged.

- [ ] **Step 3: Implement the retry and the logging**

In `src/hooks/useOrientationGate.ts`, import `type Logger` from `@/services/logger` and `type OrientationLockPort` from `@/services/devicePorts`. Replace the lock effect:

```ts
const { orientationLock, logger } = usePorts();
```

```ts
useEffect(() => {
  if (view.lock === 'keep' || view.lock === locked.current) return;
  const wanted = view.lock;
  locked.current = wanted;
  return lockWithRetry(orientationLock, logger, wanted, () => {
    // R26: forget it, so the next differing lock retries.
    if (locked.current === wanted) locked.current = null;
  });
}, [view.lock, orientationLock, logger]);
```

Add below the hook:

```ts
/** D26: one retry, half a second on, then forget as S0's R26 did. */
export const LOCK_RETRY_MS = 500;

/**
 * Locks; on a refusal logs it and tries once more. Returns the effect's
 * cleanup: a newer lock supersedes a pending retry.
 */
function lockWithRetry(
  port: OrientationLockPort,
  logger: Logger,
  wanted: Target,
  giveUp: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const attempt = (n: number): void => {
    port.lock(wanted).catch(() => {
      logger.warn('orientation.lock-refused', { lock: wanted, attempt: n });
      if (cancelled) return;
      if (n >= 2) return giveUp();
      timer = setTimeout(() => attempt(n + 1), LOCK_RETRY_MS);
    });
  };
  attempt(1);
  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
```

In `usePhysicalOrientation`, take `logger` from `usePorts()` and pass it: `watchPhysical(motion, logger, setPhysical)` with `[motion, logger]` as deps. In `watchPhysical`, add the `logger: Logger` parameter and replace the availability line and its comment:

```ts
// R26: a failed check counts as no accelerometer, and is recorded.
const availability = motion.isAvailable().catch(() => {
  logger.warn('motion.check-failed');
  return false;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/hooks/useOrientationGate.test.tsx`
Expected: PASS (every existing test, plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOrientationGate.ts src/hooks/useOrientationGate.test.tsx
git commit -F - <<'EOF'
feat(orientation): log a refused lock and retry it once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second refusal gives up, and the next differing lock is sent; (2) a failed sensor check is logged; (3) the retry is cancelled when a newer lock supersedes it, by the effect's cleanup; (4) not applicable, as this is orientation only.

---

### Task 4: Leaving: logged, M2 re-check, and a failed session reset

Spec §1 T14 M2: "after a leave's write settles, `leaveRule` is read again before navigating, so a leave can never land Home while on air". Spec §5 adds "a refused leave or save write" to what must be logged. D11 resets a failed engine on leave.

The leave tests move out of the placeholder's test file into a hook test, because the placeholder is deleted in Task 21.

**Files:**

- Modify: `src/hooks/useStreamLeave.ts`
- Create: `src/hooks/useStreamLeave.test.tsx`
- Modify: `src/ui/screens/StreamPlaceholderScreen.test.tsx` (the leave tests leave it)

**Interfaces:**

- Consumes: `Ports.logger`, `leaveRule`, `selectEngineStatus`.
- Produces: the same `useStreamLeave(): {canLeave, blocked, leave}`. After a leave's write settles, the rule is read again: on air means stay, set `blocked`, and log `leave.cancelled-on-air {action}`. The events logged are `store.write-refused {action: 'leave'}` and `leave.cancelled-on-air`.

- [ ] **Step 1: Move the leave tests into a hook test**

Create `src/hooks/useStreamLeave.test.tsx` with the harness below. Then **move** these tests from `StreamPlaceholderScreen.test.tsx`:

- from `describe('Live Stream placeholder', …)`:
  - 'leaves for Home and keeps the code while nothing is live'
  - 'leaves for Home while armed, keeping the code and the armed session'
  - 'cannot be left on air: Home is hidden and Back explains'
  - 'forgets the code when leaving after the broadcast stopped'
  - 'keeps the code when the broadcast failed, so the operator can go straight back'
  - 'clears the on-air message once the broadcast is over'
- all of `describe('Live Stream placeholder: the next code after a stop (I1)', …)`
- all of the R30 describe (`'a refused write still leaves'`)
- all of `describe('Live Stream placeholder: one leave at a time', …)`

Rewrite them mechanically:

- `renderStream(x)` becomes `leaveHook(x)`, and `view` becomes `leaving`;
- `fireEvent.click(screen.getByRole('button', { name: 'Home' }))` becomes `act(() => leaving.hook.result.current.leave())`;
- `screen.getByText('Stop the broadcast first — hold Stop.')` becomes `expect(leaving.hook.result.current.blocked).toBe(true)`, and its `queryByText … toBeNull()` form becomes `.toBe(false)`;
- `screen.queryByRole('button', { name: 'Home' })` null or truthy becomes `leaving.hook.result.current.canLeave` false or true.

Rename the describes from "Live Stream placeholder…" to "useStreamLeave…". The placeholder test file keeps only these: the slot text, the language test, the dev-controls tests, and 'says there is no slot…'.

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { SessionState } from '@/domain/session/SessionState';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, readRecord, TEST_NOW } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

const code: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 2,
  savedAt: TEST_NOW,
  expiresAt: new Date(TEST_NOW.getTime() + 3600_000),
  venueTz: null,
};
const inStream = {
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(code),
};
const LIVE: SessionState = {
  kind: 'publishing',
  transport: 'srt',
  sinceEpochMs: TEST_NOW.getTime(),
};
const STOPPED: SessionState = { kind: 'ended', reason: 'operator-stopped' };
const FAILED: SessionState = { kind: 'ended', reason: 'fatal-error' };

async function leaveHook(options: Parameters<typeof createFakePorts>[0] = {}) {
  const fakes = createFakePorts({ kvSeed: inStream, ...options });
  const hook = renderHook(() => useStreamLeave(), { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  return { ...fakes, hook };
}
```

(The `code` fixture changes shape in Task 9 and `STOPPED`/`FAILED` gain `durationMs` in Task 11. Both tasks list this file.)

- [ ] **Step 2: Change the I1 row that M2 overturns, and add the new tests**

Replace the `it.each` `'clears no session that %s while the stopped leave was saving (I1)'` with:

```tsx
it('clears no armed session that arrived while the stopped leave was saving (I1)', async () => {
  const { modeStore, release } = slowStore();
  const leaving = await leaveHook({ modeStore });
  const send = vi.spyOn(leaving.engine, 'send');
  act(() => leaving.engine.forceState(STOPPED));
  act(() => {
    leaving.back.press();
  });
  act(() => leaving.engine.forceState({ kind: 'armed' }));
  release();
  await waitFor(() => expect(leaving.navigation.current()).toBe('home'));
  expect(send).not.toHaveBeenCalled();
});

it('stays on Live Stream when the broadcast went live while the leave was saving (T14 M2)', async () => {
  const { modeStore, release } = slowStore();
  const leaving = await leaveHook({ modeStore });
  const send = vi.spyOn(leaving.engine, 'send');
  act(() => leaving.engine.forceState(STOPPED));
  act(() => {
    leaving.back.press();
  });
  act(() => leaving.engine.forceState(LIVE));
  release();
  await waitFor(() => expect(leaving.hook.result.current.blocked).toBe(true));
  expect(leaving.navigation.current()).toBe('stream');
  expect(send).not.toHaveBeenCalled();
  expect(readRecord(leaving.record).map((e) => e.event)).toContain('leave.cancelled-on-air');
});
```

Add inside the "one leave at a time" describe, after `slowStore`:

```tsx
it('stays when a free leave finds the engine live once its write settles (T14 M2)', async () => {
  const { modeStore, release } = slowStore();
  const leaving = await leaveHook({ modeStore });
  act(() => leaving.hook.result.current.leave());
  act(() => leaving.engine.forceState(LIVE));
  release();
  await waitFor(() => expect(leaving.hook.result.current.blocked).toBe(true));
  expect(leaving.navigation.current()).toBe('stream');
});
```

Extend the moved `'keeps the code when the broadcast failed…'` test (D11):

```tsx
// D11: the failed session is cleared, so Continue re-arms rather than landing on Ended.
expect(leaving.engine.getSnapshot().state).toEqual({ kind: 'idle' });
```

Extend the moved `'a refused write still goes Home when %s'`:

```tsx
expect(readRecord(leaving.record)).toContainEqual(
  expect.objectContaining({ event: 'store.write-refused', fields: { action: 'leave' } }),
);
```

- [ ] **Step 3: Run to verify the new expectations fail**

Run: `pnpm vitest run src/hooks/useStreamLeave.test.tsx src/ui/screens/StreamPlaceholderScreen.test.tsx`
Expected: FAIL on 'stays on Live Stream…', 'stays when a free leave…', the failed-reset assertion, and the log assertion. Every moved test that is unchanged in meaning must PASS. If one fails, the move was not mechanical: fix the move, not the code.

- [ ] **Step 4: Implement the re-check, the reset and the logging**

Replace `useLeaveOnce`, `stillStopped` and `saveLeave` in `src/hooks/useStreamLeave.ts`:

```ts
/**
 * One leave at a time (S0): set once a leave is allowed, released when its
 * write settles either way, so it can never stick.
 *
 * T14 M2: once the write settles the rule is read again, because native may
 * have moved on while the phone was writing. On air now means stay, with the
 * leave-on-air line; the engine is the authority, so nothing is written back
 * — a reopen goes to the stream whatever is saved (spec §1).
 */
function useLeaveOnce(onBlocked: () => void): (rule: FreeRule) => void {
  const { modeStore, navigation, engine, logger } = usePorts();
  const pending = useRef(false);
  return useCallback(
    (rule: FreeRule) => {
      if (pending.current) return;
      pending.current = true;
      void saveLeave(modeStore, rule, logger).then(() => {
        pending.current = false;
        const status = selectEngineStatus(engine.getSnapshot());
        if (leaveRule('stream', status) === 'blockedOnAir') {
          logger.warn('leave.cancelled-on-air', { action: rule });
          return onBlocked();
        }
        if (clearsSession(rule, status)) engine.send({ kind: 'reset' });
        navigation.go('home');
      });
    },
    [modeStore, navigation, engine, logger, onBlocked],
  );
}

/**
 * I1: a stopped session is cleared only if this leave forgot its code — a
 * session that moved on meanwhile is not ours to clear. D11: a failed one is
 * always cleared; its code is kept, so Continue re-arms instead of landing on
 * Ended.
 */
function clearsSession(rule: FreeRule, status: EngineStatus): boolean {
  return status === 'failed' || (rule === 'freeAndForget' && status === 'stopped');
}

/**
 * The leave's one write, which never rejects (R30). A refused write still
 * leaves — the operator asked to go — and is recorded (spec §5).
 */
async function saveLeave(modeStore: ModeStore, rule: FreeRule, logger: Logger): Promise<void> {
  try {
    await (rule === 'freeAndForget' ? modeStore.forget('stream') : modeStore.setActive(null));
  } catch {
    logger.warn('store.write-refused', { action: 'leave' });
  }
}
```

In `useStreamLeave`:

- create `const block = useCallback(() => setBlocked(true), []);`;
- call `useLeaveOnce(block)`;
- use `block()` in `leave` in place of `setBlocked(true)`;
- import `type EngineStatus` from `@/domain/mode/reopen`, `type Logger` from `@/services/logger`, and drop the `CaptureEnginePort` import.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/hooks src/ui/screens`
Expected: PASS.

- [ ] **Step 6: Mutate the M2 re-check once**

`cp src/hooks/useStreamLeave.ts /private/tmp/claude-501/s1a/leave.bak`. Change `if (leaveRule('stream', status) === 'blockedOnAir') {` to `if (false) {`.
Run: `pnpm vitest run src/hooks/useStreamLeave.test.tsx`. Expected: FAIL (both "T14 M2" tests). Restore and re-run: PASS.

Then mutate the leave rule itself. `cp src/domain/mode/reopen.ts /private/tmp/claude-501/s1a/reopen.bak`, and in `leaveRule` change `case 'live': return 'blockedOnAir';` to `case 'live': return 'free';`. Run the same file. Expected: FAIL ('cannot be left on air…'). Restore and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useStreamLeave.ts src/hooks/useStreamLeave.test.tsx src/ui/screens/StreamPlaceholderScreen.test.tsx
git commit -F - <<'EOF'
feat(stream): re-read the leave rule after the write (T14 M2); log refusals

A failed session is reset on leave so Continue re-arms (D11). The leave
tests move to a hook test ahead of the placeholder's removal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) Back and Home together, and Back while pending, still give one leave; (2) nothing saved is covered by the moved tests; (3) a refused write and the engine moving mid-write (M2) are both covered; (4) not applicable, since the leave copy is unchanged.

---

### Task 5: The descriptor and its parser

Spec §2 and the _Ask_ fix the descriptor's shape; D1, D4 and D7 settle the gaps. The wire readers S0 kept private inside `parseSessionCredentials` move to a shared `wire.ts`. The old parser keeps its own copies until Task 6 deletes it.

**Files:**

- Create: `src/domain/credentials/wire.ts`
- Create: `src/domain/credentials/SessionDescriptor.ts`
- Create: `src/domain/credentials/parseDescriptor.ts`, `src/domain/credentials/parseDescriptor.test.ts`
- Create: `test/fixtures/wire.ts`

**Interfaces:**

- Consumes: `Result`, `ok` and `err` from `src/domain/Result.ts`, plus `Transport` and `ScoreUpdates` from `StreamCredentials.ts`.
- Produces:
  - `WireError`, `isRecord`, `readString`, `readPositiveNumber`, `readInteger`, `readEpochSeconds`, `readSchemeUrl`, `readOneOf`;
  - `DescriptorState`, `OrganiserEndReason`, `SessionDescriptor`, `DescriptorError`;
  - `parseDescriptor(input: unknown): Result<SessionDescriptor, WireError>`, `parseEndReason(value: unknown): OrganiserEndReason`, `descriptorToWire(d): Record<string, unknown>`;
  - fixtures `FIXTURE_NOW`, `FIXTURE_SID`, `epochSeconds`, `captureWire`, `captureRaw` and `descriptorWire`.

- [ ] **Step 1: Write the fixtures**

`test/fixtures/wire.ts`:

```ts
/**
 * Made-up wire payloads (spec Ask). Never paste a real code or descriptor into
 * a test: stream codes carry the SRT passphrase and the RTMPS key.
 */

/** The same instant as TEST_NOW in test/fakePorts.ts, kept here so node tests need no fake ports. */
export const FIXTURE_NOW = new Date('2026-10-03T13:00:00Z');
export const FIXTURE_SID = '5d9c1d0e-0000-4000-8000-000000000001';

export const epochSeconds = (at: Date): number => Math.floor(at.getTime() / 1000);
const minutesFromNow = (minutes: number) => new Date(FIXTURE_NOW.getTime() + minutes * 60_000);

export function captureWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    sid: FIXTURE_SID,
    slot: 1,
    cred: {
      srt: {
        url: 'srt://ingest.example:778',
        streamId: 'fake-stream-id',
        passphrase: 'fake-pass-0000',
        latencyMs: 2000,
      },
      rtmps: { url: 'rtmps://ingest.example:443/live/', streamKey: 'fake-key-0000' },
    },
    preferred: 'srt',
    exp: epochSeconds(minutesFromNow(240)),
    tok: 'fake-token-00000000000000000000',
    ...overrides,
  };
}

export const captureRaw = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(captureWire(overrides));

export function descriptorWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sid: FIXTURE_SID,
    state: 'warming',
    playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
    overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
    holdWindowSeconds: { srt: 183, rtmps: 183 },
    venueTimezone: 'Europe/London',
    label: 'Seazn XI v Fake CC',
    scoreUpdates: 'realtime',
    maxDurationMinutes: 300,
    warmingDeadline: epochSeconds(minutesFromNow(10)),
    exp: epochSeconds(minutesFromNow(240)),
    heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing parser tests**

`src/domain/credentials/parseDescriptor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  descriptorToWire,
  parseDescriptor,
  parseEndReason,
} from '@/domain/credentials/parseDescriptor';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { descriptorWire, FIXTURE_SID } from '../../../test/fixtures/wire';

const EXPECTED: SessionDescriptor = {
  sid: FIXTURE_SID,
  state: 'warming',
  endReason: null,
  playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
  holdWindowSeconds: { srt: 183, rtmps: 183 },
  venueTimezone: 'Europe/London',
  label: 'Seazn XI v Fake CC',
  scoreUpdates: 'realtime',
  maxDurationMinutes: 300,
  warmingDeadline: new Date('2026-10-03T13:10:00Z'),
  expiresAt: new Date('2026-10-03T17:00:00Z'),
  heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
};

describe('parseDescriptor', () => {
  it('reads the descriptor the web serves (spec Ask)', () => {
    expect(parseDescriptor(descriptorWire())).toEqual({ ok: true, value: EXPECTED });
  });

  it.each([null, [], 'descriptor', 42])('refuses %j as not an object', (input) => {
    expect(parseDescriptor(input)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('refuses an empty descriptor, naming the first field', () => {
    expect(parseDescriptor({})).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'sid' },
    });
  });

  it.each([
    'sid',
    'state',
    'playbackUrl',
    'overlayUrl',
    'holdWindowSeconds',
    'venueTimezone',
    'label',
    'scoreUpdates',
    'maxDurationMinutes',
    'warmingDeadline',
    'exp',
    'heartbeatUrl',
  ])('refuses a descriptor missing %s', (field) => {
    expect(parseDescriptor(descriptorWire({ [field]: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field },
    });
  });

  it.each(['playbackUrl', 'overlayUrl', 'heartbeatUrl'])(
    'refuses a %s that is not https',
    (field) => {
      const result = parseDescriptor(descriptorWire({ [field]: 'http://video.example/a' }));
      expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field } });
    },
  );

  it('refuses a state it does not know, rather than guessing', () => {
    const result = parseDescriptor(descriptorWire({ state: 'paused' }));
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-field', field: 'state' } });
  });

  it('names the transport whose hold window is missing', () => {
    const result = parseDescriptor(descriptorWire({ holdWindowSeconds: { srt: 183 } }));
    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'holdWindowSeconds.rtmps' },
    });
  });

  it.each([0, 1.5, -60, 1e20, '1791033000'])('refuses a warming deadline of %j', (value) => {
    const result = parseDescriptor(descriptorWire({ warmingDeadline: value }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'warmingDeadline' },
    });
  });

  it('keeps the organiser end reason when present', () => {
    const result = parseDescriptor(descriptorWire({ state: 'completed', endReason: 'stopped' }));
    expect(result).toMatchObject({ ok: true, value: { state: 'completed', endReason: 'stopped' } });
  });

  it('survives a round trip through storage', () => {
    expect(parseDescriptor(descriptorToWire(EXPECTED))).toEqual({ ok: true, value: EXPECTED });
  });
});

describe('parseEndReason (D4)', () => {
  it.each([
    ['stopped', 'stopped'],
    ['no_inbound_timeout', 'no-inbound-timeout'],
    ['target_rejected', 'target-rejected'],
    ['max_duration', 'max-duration'],
    ['something_new', 'unknown'],
    ['constructor', 'unknown'],
    [undefined, 'unknown'],
    [7, 'unknown'],
  ])('maps %j to %s', (wire, domain) => {
    expect(parseEndReason(wire)).toBe(domain);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/domain/credentials/parseDescriptor.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the wire readers**

`src/domain/credentials/wire.ts`:

```ts
import { type Result, err, ok } from '@/domain/Result';

/**
 * Why untrusted JSON was refused, shared by every parser at the wire
 * (AGENTS §4). The wire shape stops in this folder.
 */
export type WireError =
  | { readonly kind: 'not-an-object' }
  | { readonly kind: 'unsupported-version'; readonly found: unknown }
  | { readonly kind: 'missing-field'; readonly field: string }
  | { readonly kind: 'invalid-field'; readonly field: string; readonly reason: string }
  /** C1: one transport alone leaves no fallback the phone can reach without re-scanning. */
  | { readonly kind: 'missing-fallback' };

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

export function isRecord(value: unknown): value is Source {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const invalid = (field: string, reason: string): Read<never> =>
  err({ kind: 'invalid-field', field, reason });

/**
 * `key` is the property actually read; `label` is what an error names.
 * Keeping them apart means an error can never name a path the code did not walk.
 */
export function readString(source: Source, key: string, label: string = key): Read<string> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'string' || value.length === 0) {
    return invalid(label, 'expected a non-empty string');
  }
  return ok(value);
}

export function readPositiveNumber(source: Source, key: string, label: string = key): Read<number> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return invalid(label, 'expected a positive number');
  }
  return ok(value);
}

export function readInteger(
  source: Source,
  key: string,
  min: number,
  label: string = key,
): Read<number> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    return invalid(label, `expected an integer of at least ${min}`);
  }
  return ok(value);
}

/** Integer Unix seconds (D1). An integer can still overflow Date; never hand on an Invalid Date. */
export function readEpochSeconds(source: Source, key: string, label: string = key): Read<Date> {
  const seconds = readInteger(source, key, 1, label);
  if (!seconds.ok) return seconds;
  const at = new Date(seconds.value * 1000);
  return Number.isNaN(at.getTime()) ? invalid(label, 'out of range') : ok(at);
}

/**
 * A URL with the given scheme, a host with no userinfo, and no whitespace.
 * Regex rather than `URL`: Hermes' URL polyfill has lacked `hostname`.
 */
export function readSchemeUrl(
  source: Source,
  key: string,
  scheme: 'https' | 'srt' | 'rtmps',
  label: string = key,
): Read<string> {
  const text = readString(source, key, label);
  if (!text.ok) return text;
  const shape = new RegExp(`^${scheme}://[^\\s/?#@]+([/?#]\\S*)?$`, 'i');
  return shape.test(text.value) ? text : invalid(label, `expected a ${scheme}:// URL`);
}

/** A closed set: an unrecognised value fails loudly rather than defaulting to the reassuring answer. */
export function readOneOf<T extends string>(
  source: Source,
  key: string,
  allowed: readonly T[],
  label: string = key,
): Read<T> {
  const value = source[key];
  if (value === undefined) return err({ kind: 'missing-field', field: label });
  const match = allowed.find((option) => option === value);
  return match === undefined ? invalid(label, `expected one of ${allowed.join(', ')}`) : ok(match);
}
```

- [ ] **Step 5: Implement the descriptor type and parser**

`src/domain/credentials/SessionDescriptor.ts`:

```ts
import type { ScoreUpdates, Transport } from '@/domain/credentials/StreamCredentials';

export type DescriptorState = 'warming' | 'live' | 'ending' | 'completed' | 'failed';

/** Why the organiser's side ended a session (spec Ask 410), in the domain's words (D4). */
export type OrganiserEndReason =
  'stopped' | 'no-inbound-timeout' | 'target-rejected' | 'max-duration' | 'unknown';

/**
 * What the server says about a session (spec §2). Cached with the saved code
 * for the session's life; native fetches it again on every reconnect.
 */
export type SessionDescriptor = {
  readonly sid: string;
  readonly state: DescriptorState;
  readonly endReason: OrganiserEndReason | null;
  /** Required: the delivery watch depends on it (F-P5-13). */
  readonly playbackUrl: string;
  /** The Tier A `/overlay/fixtures/[id]` route, never `/relay` (AGENTS §7). */
  readonly overlayUrl: string;
  /** C2: whether a resume is the same broadcast, per transport. */
  readonly holdWindowSeconds: Readonly<Record<Transport, number>>;
  /** IANA name. Every time the operator reads is shown in it (spec §2). */
  readonly venueTimezone: string;
  readonly label: string;
  readonly scoreUpdates: ScoreUpdates;
  readonly maxDurationMinutes: number;
  /** The web's 10-minute no-signal timeout: Go live must happen before it. */
  readonly warmingDeadline: Date;
  readonly expiresAt: Date;
  readonly heartbeatUrl: string;
};

/** Spec §2's closed set; D3 maps 5xx and a malformed 200 onto it. */
export type DescriptorError =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'ended'; readonly endReason: OrganiserEndReason }
  | { readonly kind: 'offline' }
  | { readonly kind: 'rate-limited'; readonly retryAfterS: number };
```

`src/domain/credentials/parseDescriptor.ts`:

```ts
import { type Result, err, ok } from '@/domain/Result';
import type {
  DescriptorState,
  OrganiserEndReason,
  SessionDescriptor,
} from '@/domain/credentials/SessionDescriptor';
import type { ScoreUpdates, Transport } from '@/domain/credentials/StreamCredentials';
import {
  isRecord,
  readEpochSeconds,
  readOneOf,
  readPositiveNumber,
  readSchemeUrl,
  readString,
  type WireError,
} from '@/domain/credentials/wire';

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

const STATES: readonly DescriptorState[] = ['warming', 'live', 'ending', 'completed', 'failed'];
const SCORE_UPDATES: readonly ScoreUpdates[] = ['realtime', 'polled'];

/** Wire → domain (D4). A Map, so `constructor` and friends are not reasons. */
const END_REASONS = new Map<string, OrganiserEndReason>([
  ['stopped', 'stopped'],
  ['no_inbound_timeout', 'no-inbound-timeout'],
  ['target_rejected', 'target-rejected'],
  ['max_duration', 'max-duration'],
]);
const WIRE_END_REASON: Readonly<Record<OrganiserEndReason, string>> = {
  stopped: 'stopped',
  'no-inbound-timeout': 'no_inbound_timeout',
  'target-rejected': 'target_rejected',
  'max-duration': 'max_duration',
  unknown: 'unknown',
};

export function parseEndReason(value: unknown): OrganiserEndReason {
  return typeof value === 'string' ? (END_REASONS.get(value) ?? 'unknown') : 'unknown';
}

/** The descriptor response → `SessionDescriptor` (spec §2). The wire shape stops here. */
export function parseDescriptor(input: unknown): Read<SessionDescriptor> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  const facts = readFacts(input);
  if (!facts.ok) return facts;
  const urls = readUrls(input);
  if (!urls.ok) return urls;
  const times = readTimes(input);
  if (!times.ok) return times;
  return ok({ ...facts.value, ...urls.value, ...times.value });
}

type Urls = Pick<SessionDescriptor, 'playbackUrl' | 'overlayUrl' | 'heartbeatUrl'>;
type Times = Pick<SessionDescriptor, 'maxDurationMinutes' | 'warmingDeadline' | 'expiresAt'>;
type Facts = Omit<SessionDescriptor, keyof Urls | keyof Times>;

/** Field order is the error order: `{}` names `sid` first. */
function readFacts(input: Source): Read<Facts> {
  const sid = readString(input, 'sid');
  if (!sid.ok) return sid;
  const state = readOneOf(input, 'state', STATES);
  if (!state.ok) return state;
  const hold = readHoldWindows(input);
  if (!hold.ok) return hold;
  const venueTimezone = readString(input, 'venueTimezone');
  if (!venueTimezone.ok) return venueTimezone;
  const label = readString(input, 'label');
  if (!label.ok) return label;
  const scoreUpdates = readOneOf(input, 'scoreUpdates', SCORE_UPDATES);
  if (!scoreUpdates.ok) return scoreUpdates;
  const absent = input.endReason === undefined || input.endReason === null;
  const endReason = absent ? null : parseEndReason(input.endReason);
  return ok({
    sid: sid.value,
    state: state.value,
    endReason,
    holdWindowSeconds: hold.value,
    venueTimezone: venueTimezone.value,
    label: label.value,
    scoreUpdates: scoreUpdates.value,
  });
}

function readUrls(input: Source): Read<Urls> {
  const playbackUrl = readSchemeUrl(input, 'playbackUrl', 'https');
  if (!playbackUrl.ok) return playbackUrl;
  const overlayUrl = readSchemeUrl(input, 'overlayUrl', 'https');
  if (!overlayUrl.ok) return overlayUrl;
  const heartbeatUrl = readSchemeUrl(input, 'heartbeatUrl', 'https');
  if (!heartbeatUrl.ok) return heartbeatUrl;
  return ok({
    playbackUrl: playbackUrl.value,
    overlayUrl: overlayUrl.value,
    heartbeatUrl: heartbeatUrl.value,
  });
}

function readTimes(input: Source): Read<Times> {
  const maxDurationMinutes = readPositiveNumber(input, 'maxDurationMinutes');
  if (!maxDurationMinutes.ok) return maxDurationMinutes;
  const warmingDeadline = readEpochSeconds(input, 'warmingDeadline');
  if (!warmingDeadline.ok) return warmingDeadline;
  const expiresAt = readEpochSeconds(input, 'exp');
  if (!expiresAt.ok) return expiresAt;
  return ok({
    maxDurationMinutes: maxDurationMinutes.value,
    warmingDeadline: warmingDeadline.value,
    expiresAt: expiresAt.value,
  });
}

function readHoldWindows(input: Source): Read<Readonly<Record<Transport, number>>> {
  const hold = input.holdWindowSeconds;
  if (hold === undefined) return err({ kind: 'missing-field', field: 'holdWindowSeconds' });
  if (!isRecord(hold)) {
    return err({ kind: 'invalid-field', field: 'holdWindowSeconds', reason: 'expected an object' });
  }
  const srt = readPositiveNumber(hold, 'srt', 'holdWindowSeconds.srt');
  if (!srt.ok) return srt;
  const rtmps = readPositiveNumber(hold, 'rtmps', 'holdWindowSeconds.rtmps');
  if (!rtmps.ok) return rtmps;
  return ok({ srt: srt.value, rtmps: rtmps.value });
}

/** The stored form: the wire shape again, so a saved record is read by the same parser (D28). */
export function descriptorToWire(d: SessionDescriptor): Record<string, unknown> {
  return {
    sid: d.sid,
    state: d.state,
    endReason: d.endReason === null ? null : WIRE_END_REASON[d.endReason],
    playbackUrl: d.playbackUrl,
    overlayUrl: d.overlayUrl,
    holdWindowSeconds: { ...d.holdWindowSeconds },
    venueTimezone: d.venueTimezone,
    label: d.label,
    scoreUpdates: d.scoreUpdates,
    maxDurationMinutes: d.maxDurationMinutes,
    warmingDeadline: Math.floor(d.warmingDeadline.getTime() / 1000),
    exp: Math.floor(d.expiresAt.getTime() / 1000),
    heartbeatUrl: d.heartbeatUrl,
  };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/domain/credentials`
Expected: PASS. The existing `parseSessionCredentials` tests are untouched and still pass.

- [ ] **Step 7: Lint the domain purity**

Run: `pnpm lint`
Expected: exit 0. `src/domain/credentials/*` imports only from `@/domain`.

- [ ] **Step 8: Commit**

```bash
git add src/domain/credentials/wire.ts src/domain/credentials/SessionDescriptor.ts src/domain/credentials/parseDescriptor.ts src/domain/credentials/parseDescriptor.test.ts test/fixtures/wire.ts
git commit -F - <<'EOF'
feat(domain): session descriptor and its parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable, as this is pure; (2) the empty descriptor, non-objects and every missing field are tested; (3) the storage round trip is tested; (4) not applicable, as there is no copy.

---

### Task 6: The capture-qr.v2 parser and `StreamSession`

Spec §2: "`parseCaptureQr`: the v2 wire shape → a domain value … Both the bare url and the fixture's embedded query string must parse." It builds `StreamSession = {sid, slot, token, primary, fallback, descriptor}`. `parseSessionCredentials` (v1, dead) and `transportPolicy` (spec §2: native decides the fallback) are removed.

**Files:**

- Create: `src/domain/credentials/parseCaptureQr.ts`, `src/domain/credentials/parseCaptureQr.test.ts`
- Create: `src/domain/credentials/StreamSession.ts`, `src/domain/credentials/StreamSession.test.ts`
- Modify: `src/domain/credentials/StreamCredentials.ts` (`passphrase` required, D7)
- Delete: `src/domain/credentials/parseSessionCredentials.ts`, `src/domain/credentials/parseSessionCredentials.test.ts`
- Delete: `src/domain/policy/transportPolicy.ts`, `src/domain/policy/transportPolicy.test.ts`

**Interfaces:**

- Consumes: the `wire.ts` readers (Task 5), `SessionDescriptor`.
- Produces:
  - `CaptureCode = {sid, slot, token, primary, fallback, expiresAt}`;
  - `parseCaptureQr(input: unknown): Result<CaptureCode, WireError>` and `parseCaptureQrText(text: string): Result<CaptureCode, WireError>`;
  - `StreamSession` and `buildStreamSession(code, descriptor): StreamSession`.
- `SessionCredentials` stays until Task 11 removes it with the engine port reshape.

- [ ] **Step 1: Confirm nothing else imports what is being deleted**

Run: `rg -l "parseSessionCredentials|transportPolicy" src app modules test`
Expected: exactly the four files this task deletes. Anything else is a finding; stop and report it.

- [ ] **Step 2: Write the failing tests**

`src/domain/credentials/parseCaptureQr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCaptureQr, parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { captureRaw, captureWire, FIXTURE_SID } from '../../../test/fixtures/wire';

const SRT = {
  transport: 'srt',
  url: 'srt://ingest.example:778',
  streamId: 'fake-stream-id',
  passphrase: 'fake-pass-0000',
  latencyMs: 2000,
} as const;
const RTMPS = {
  transport: 'rtmps',
  url: 'rtmps://ingest.example:443/live/',
  streamKey: 'fake-key-0000',
} as const;

const cred = captureWire().cred as {
  srt: Record<string, unknown>;
  rtmps: Record<string, unknown>;
};
const withSrt = (srt: Record<string, unknown>) =>
  captureWire({ cred: { srt: { ...cred.srt, ...srt }, rtmps: cred.rtmps } });

describe('parseCaptureQr (spec §2)', () => {
  it('reads a v2 code, primary first by `preferred`', () => {
    expect(parseCaptureQr(captureWire())).toEqual({
      ok: true,
      value: {
        sid: FIXTURE_SID,
        slot: 1,
        token: 'fake-token-00000000000000000000',
        primary: SRT,
        fallback: RTMPS,
        expiresAt: new Date('2026-10-03T17:00:00Z'),
      },
    });
  });

  it('swaps the pair when RTMPS is preferred', () => {
    expect(parseCaptureQr(captureWire({ preferred: 'rtmps' }))).toMatchObject({
      ok: true,
      value: { primary: RTMPS, fallback: SRT },
    });
  });

  it('reads both SRT url forms, keeping the separate fields canonical (lane D)', () => {
    const embedded = withSrt({ url: 'srt://ingest.example:778?streamid=other&passphrase=other' });
    expect(parseCaptureQr(embedded)).toMatchObject({ ok: true, value: { primary: SRT } });
  });

  it('refuses a code with no token', () => {
    expect(parseCaptureQr(captureWire({ tok: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'tok' },
    });
  });

  it('refuses an empty token', () => {
    expect(parseCaptureQr(captureWire({ tok: '' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'tok' },
    });
  });

  it.each([1, 3, undefined])('refuses version %j', (v) => {
    expect(parseCaptureQr(captureWire({ v }))).toEqual({
      ok: false,
      error: { kind: 'unsupported-version', found: v },
    });
  });

  it('refuses garbled text without throwing', () => {
    expect(parseCaptureQrText('{"v":2,')).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it.each([[[]], [42], ['text'], [null]])('refuses foreign JSON %j', (input) => {
    expect(parseCaptureQr(input)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('requires the SRT passphrase (D7)', () => {
    expect(parseCaptureQr(withSrt({ passphrase: undefined }))).toEqual({
      ok: false,
      error: { kind: 'missing-field', field: 'cred.srt.passphrase' },
    });
  });

  it('refuses plain RTMP, which has no TLS', () => {
    const wire = captureWire({
      cred: { srt: cred.srt, rtmps: { url: 'rtmp://ingest.example/live', streamKey: 'k' } },
    });
    expect(parseCaptureQr(wire)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field: 'cred.rtmps.url' },
    });
  });

  it('refuses a code carrying one transport, which leaves no fallback (C1)', () => {
    const wire = captureWire({ cred: { srt: cred.srt } });
    expect(parseCaptureQr(wire)).toEqual({ ok: false, error: { kind: 'missing-fallback' } });
  });

  it.each([
    ['slot', -1],
    ['slot', 1.5],
    ['exp', 0],
    ['exp', 1e20],
  ])('refuses %s of %j', (field, value) => {
    expect(parseCaptureQr(captureWire({ [field]: value }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-field', field },
    });
  });

  it('parses an expired code: expiry is recognise’s call, against the clock', () => {
    expect(parseCaptureQrText(captureRaw({ exp: 1 }))).toMatchObject({ ok: true });
  });
});
```

`src/domain/credentials/StreamSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCaptureQr } from '@/domain/credentials/parseCaptureQr';
import { parseDescriptor } from '@/domain/credentials/parseDescriptor';
import { buildStreamSession } from '@/domain/credentials/StreamSession';
import { captureWire, descriptorWire, FIXTURE_SID } from '../../../test/fixtures/wire';

describe('buildStreamSession', () => {
  it('joins the code and its descriptor', () => {
    const code = parseCaptureQr(captureWire());
    const descriptor = parseDescriptor(descriptorWire());
    if (!code.ok || !descriptor.ok) throw new Error('fixtures must parse');
    const session = buildStreamSession(code.value, descriptor.value);
    expect(session.sid).toBe(FIXTURE_SID);
    expect(session.token).toBe('fake-token-00000000000000000000');
    expect(session.primary.transport).toBe('srt');
    expect(session.descriptor.label).toBe('Seazn XI v Fake CC');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/domain/credentials`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the parser and the session**

`src/domain/credentials/parseCaptureQr.ts`:

```ts
import { type Result, err, ok } from '@/domain/Result';
import type {
  RtmpsCredentials,
  SrtCredentials,
  StreamCredentials,
  Transport,
} from '@/domain/credentials/StreamCredentials';
import {
  isRecord,
  readEpochSeconds,
  readInteger,
  readOneOf,
  readPositiveNumber,
  readSchemeUrl,
  readString,
  type WireError,
} from '@/domain/credentials/wire';

/** A scanned capture-qr.v2 code, in the domain's words. `token` is a secret: never log it. */
export type CaptureCode = {
  readonly sid: string;
  readonly slot: number;
  readonly token: string;
  readonly primary: StreamCredentials;
  readonly fallback: StreamCredentials;
  readonly expiresAt: Date;
};

type Read<T> = Result<T, WireError>;
type Source = Record<string, unknown>;

const VERSION = 2;
const TRANSPORTS: readonly Transport[] = ['srt', 'rtmps'];

/** Text off the scanner. Garbled JSON is an ordinary outcome, never a throw. */
export function parseCaptureQrText(text: string): Read<CaptureCode> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err({ kind: 'not-an-object' });
  }
  return parseCaptureQr(data);
}

/** capture-qr.v2 (spec Ask) → `CaptureCode`. Expiry is judged by the caller, against its clock. */
export function parseCaptureQr(input: unknown): Read<CaptureCode> {
  if (!isRecord(input)) return err({ kind: 'not-an-object' });
  if (input.v !== VERSION) return err({ kind: 'unsupported-version', found: input.v });
  const head = readHead(input);
  if (!head.ok) return head;
  const pair = readPair(input);
  if (!pair.ok) return pair;
  return ok({ ...head.value, ...pair.value });
}

function readHead(input: Source): Read<Pick<CaptureCode, 'sid' | 'slot' | 'token' | 'expiresAt'>> {
  const sid = readString(input, 'sid');
  if (!sid.ok) return sid;
  const slot = readInteger(input, 'slot', 0);
  if (!slot.ok) return slot;
  const expiresAt = readEpochSeconds(input, 'exp');
  if (!expiresAt.ok) return expiresAt;
  const token = readString(input, 'tok');
  if (!token.ok) return token;
  return ok({ sid: sid.value, slot: slot.value, token: token.value, expiresAt: expiresAt.value });
}

/**
 * C1: both shapes in hand at scan time, or none — whichever single transport
 * arrived, the phone has no fallback when UDP is blocked at the ground.
 */
function readPair(input: Source): Read<Pick<CaptureCode, 'primary' | 'fallback'>> {
  const cred = input.cred;
  if (!isRecord(cred)) return err({ kind: 'missing-field', field: 'cred' });
  if (!isRecord(cred.srt) || !isRecord(cred.rtmps)) return err({ kind: 'missing-fallback' });
  const preferred = readOneOf(input, 'preferred', TRANSPORTS);
  if (!preferred.ok) return preferred;
  const srt = parseSrt(cred.srt);
  if (!srt.ok) return srt;
  const rtmps = parseRtmps(cred.rtmps);
  if (!rtmps.ok) return rtmps;
  const srtFirst = preferred.value === 'srt';
  return ok({
    primary: srtFirst ? srt.value : rtmps.value,
    fallback: srtFirst ? rtmps.value : srt.value,
  });
}

/**
 * The separate fields are canonical (lane D); native composes the query
 * string. A query already on the url is dropped, so the fixture's embedded
 * form and production's bare form read the same (D7).
 */
function parseSrt(srt: Source): Read<SrtCredentials> {
  const url = readSchemeUrl(srt, 'url', 'srt', 'cred.srt.url');
  if (!url.ok) return url;
  const streamId = readString(srt, 'streamId', 'cred.srt.streamId');
  if (!streamId.ok) return streamId;
  const passphrase = readString(srt, 'passphrase', 'cred.srt.passphrase');
  if (!passphrase.ok) return passphrase;
  const latencyMs = readPositiveNumber(srt, 'latencyMs', 'cred.srt.latencyMs');
  if (!latencyMs.ok) return latencyMs;
  return ok({
    transport: 'srt',
    url: url.value.split('?')[0] ?? url.value,
    streamId: streamId.value,
    passphrase: passphrase.value,
    latencyMs: latencyMs.value,
  });
}

function parseRtmps(rtmps: Source): Read<RtmpsCredentials> {
  const url = readSchemeUrl(rtmps, 'url', 'rtmps', 'cred.rtmps.url');
  if (!url.ok) return url;
  const streamKey = readString(rtmps, 'streamKey', 'cred.rtmps.streamKey');
  if (!streamKey.ok) return streamKey;
  return ok({ transport: 'rtmps', url: url.value, streamKey: streamKey.value });
}
```

`src/domain/credentials/StreamSession.ts`:

```ts
import type { CaptureCode } from '@/domain/credentials/parseCaptureQr';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { StreamCredentials } from '@/domain/credentials/StreamCredentials';

/**
 * Everything `arm` needs (spec §2): the scanned code's credentials plus the
 * server's descriptor. Replaces S0's `SessionCredentials`. `token` is a
 * secret: it goes to native and nowhere else.
 */
export type StreamSession = {
  readonly sid: string;
  readonly slot: number;
  readonly token: string;
  readonly primary: StreamCredentials;
  readonly fallback: StreamCredentials;
  readonly descriptor: SessionDescriptor;
};

/** Joins the two. The descriptor's sid is checked where it is fetched (D3), not here. */
export function buildStreamSession(
  code: CaptureCode,
  descriptor: SessionDescriptor,
): StreamSession {
  const { sid, slot, token, primary, fallback } = code;
  return { sid, slot, token, primary, fallback, descriptor };
}
```

In `src/domain/credentials/StreamCredentials.ts`, replace the optional passphrase and its comment:

```ts
  /** Required in v2 (D7): Cloudflare's SRT ingest is always encrypted. */
  readonly passphrase: string;
```

Delete the four files:

```bash
git rm src/domain/credentials/parseSessionCredentials.ts src/domain/credentials/parseSessionCredentials.test.ts src/domain/policy/transportPolicy.ts src/domain/policy/transportPolicy.test.ts
```

- [ ] **Step 5: Run to verify everything passes**

Run: `pnpm typecheck && pnpm vitest run src/domain`
Expected: typecheck exit 0; PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/credentials/parseCaptureQr.ts src/domain/credentials/parseCaptureQr.test.ts src/domain/credentials/StreamSession.ts src/domain/credentials/StreamSession.test.ts src/domain/credentials/StreamCredentials.ts
git commit -F - <<'EOF'
feat(domain): capture-qr.v2 parser and StreamSession

parseSessionCredentials (v1) and transportPolicy leave the domain: v1 has
no path (spec §1) and native owns the fallback (spec §2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable, as this is pure; (2) garbled, foreign, a missing `tok` and a single transport are all tested; (3) not applicable; (4) not applicable.

---

### Task 7: `recognise` accepts capture-qr.v2 only

Spec §1: "`recognise` accepts capture-qr.v2 only … there is no v1 path." `ModeCode`'s stream arm gains `sid` and `token`, so Home can fetch the descriptor without parsing `raw` again.

**Files:**

- Modify: `src/domain/mode/Mode.ts`
- Modify: `src/domain/mode/recognise.ts`, `src/domain/mode/recognise.test.ts`
- Modify: `src/domain/mode/scanOutcome.test.ts`, `src/domain/mode/savedCode.test.ts` (their stream `ModeCode` literals)
- Modify: `src/ui/screens/HomeScreen.test.tsx` (`streamRaw` becomes the v2 fixture)

**Interfaces:**

- Consumes: `parseCaptureQr` (Task 6).
- Produces: `ModeCode` stream = `{mode: 'stream', raw, sid, slot, token, expiresAt}`. `recognise(raw, now, hosts)` has the same signature: v2 gives `code` or `expired`, `v > 2` gives `newerVersion`, and anything else with a `sid` gives `foreign`.

- [ ] **Step 1: Rewrite the stream tests for v2**

In `src/domain/mode/recognise.test.ts`:

- replace `streamPayload` with `captureWire`, importing `captureWire` and `FIXTURE_SID` from `../../../test/fixtures/wire`;
- keep `NOW` and `IN_ONE_HOUR`, and pass `exp: IN_ONE_HOUR` as an override;
- replace the first and the version tests with the tests below.

Every other stream test changes only its fixture.

```ts
const stream = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify(captureWire({ exp: IN_ONE_HOUR, ...overrides }));

it('recognises a valid v2 stream code', () => {
  const raw = stream({ slot: 2 });
  expect(recognise(raw, NOW, HOSTS)).toEqual({
    outcome: 'code',
    code: {
      mode: 'stream',
      raw,
      sid: FIXTURE_SID,
      slot: 2,
      token: 'fake-token-00000000000000000000',
      expiresAt: new Date(IN_ONE_HOUR * 1000),
    },
  });
});

it('asks for an update on a newer version that is still ours', () => {
  expect(recognise(stream({ v: 3 }), NOW, HOSTS)).toEqual({
    outcome: 'newerVersion',
    mode: 'stream',
  });
});

it('treats a v1 code as foreign: there is no v1 path (spec §1, D6)', () => {
  expect(recognise(stream({ v: 1 }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
});

it('treats a v2 code with no token as foreign', () => {
  expect(recognise(stream({ tok: undefined }), NOW, HOSTS)).toEqual({ outcome: 'foreign' });
});
```

In `scanOutcome.test.ts` and `savedCode.test.ts`, add `sid: 'fake-sid', token: 'fake-token'` to each stream `ModeCode` literal. The `savedCodeFrom({ mode: 'stream', raw: 'r', slot: 0, expiresAt: LATER }, NOW)` call becomes `savedCodeFrom({ mode: 'stream', raw: 'r', sid: 'fake-sid', slot: 0, token: 'fake-token', expiresAt: LATER }, NOW)`.

In `src/ui/screens/HomeScreen.test.tsx`, replace the body of `streamRaw(exp, slot)` with the v2 fixture, keeping its name and signature so no call site changes:

```ts
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';

/** Made-up credentials, v2. */
function streamRaw(exp: Date, slot = 1): string {
  return captureRaw({ exp: epochSeconds(exp), slot });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/domain/mode src/ui/screens/HomeScreen.test.tsx`
Expected: FAIL. v2 is `newerVersion` today, and the `ModeCode` literals do not typecheck.

- [ ] **Step 3: Implement**

In `src/domain/mode/Mode.ts`, replace the stream arm of `ModeCode`:

```ts
  | {
      readonly mode: 'stream';
      readonly raw: string;
      readonly sid: string;
      readonly slot: number;
      /** The descriptor's Bearer (spec decision 4). A secret: never log it. */
      readonly token: string;
      readonly expiresAt: Date;
    }
```

In `src/domain/mode/recognise.ts`, import `parseCaptureQr` and replace `recogniseStream`. Delete `StreamV1Shape` and `isStreamV1`.

```ts
/**
 * capture-qr.v2 only (spec §1, D6): v1 and anything older are foreign; a
 * higher version that still names a sid asks for an update. The full parse
 * runs here, so a code the parser would refuse is never offered as a code.
 */
function recogniseStream(raw: string, text: string, now: Date): Recognition {
  const data = parseJson(text);
  if (!isRecord(data) || !isNonEmptyString(data.sid)) return FOREIGN;
  if (isInteger(data.v) && data.v > 2) return { outcome: 'newerVersion', mode: 'stream' };
  const parsed = parseCaptureQr(data);
  if (!parsed.ok) return FOREIGN;
  const { sid, slot, token, expiresAt } = parsed.value;
  if (expiresAt.getTime() <= now.getTime()) {
    return { outcome: 'expired', mode: 'stream', at: expiresAt };
  }
  return { outcome: 'code', code: { mode: 'stream', raw, sid, slot, token, expiresAt } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/domain src/ui/screens/HomeScreen.test.tsx`
Expected: PASS. Home still opens a stream code directly until Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/domain/mode/Mode.ts src/domain/mode/recognise.ts src/domain/mode/recognise.test.ts src/domain/mode/scanOutcome.test.ts src/domain/mode/savedCode.test.ts src/ui/screens/HomeScreen.test.tsx
git commit -F - <<'EOF'
feat(mode): recognise capture-qr.v2 only; stream codes carry sid and token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) garbled and foreign input, v1, and a missing token are covered, and the length cap test is unchanged; (3) not applicable; (4) a scoring link is still recognised (its tests are unchanged).

---

### Task 8: `DescriptorPort`, with a fetch implementation and a fake

Spec §2: "`DescriptorPort.fetch(sid, token) → Promise<Result<SessionDescriptor, DescriptorError>>`. Plain `fetch` with a timeout … Built in `createNativePorts()` and faked for tests." D2, D3 and D5 fix the details. Spec §5 requires a descriptor error to be logged.

**Files:**

- Create: `src/services/descriptorPort.ts`
- Create: `src/services/fetchDescriptorPort.ts`, `src/services/fetchDescriptorPort.test.ts`
- Create: `src/services/fakeDescriptorPort.ts`, `src/services/fakeDescriptorPort.test.ts`
- Modify: `src/services/seaznHosts.ts`, `src/services/seaznHosts.test.ts`
- Modify: `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`

**Interfaces:**

- Consumes: `parseDescriptor`, `parseEndReason`, `isRecord` (Task 5), `Logger` (Task 1).
- Produces:
  - `interface DescriptorPort { fetch(sid: string, token: string): Promise<Result<SessionDescriptor, DescriptorError>> }`, which never rejects;
  - `FetchLike`, `FetchResponse`, `DESCRIPTOR_TIMEOUT_MS = 8000`, `descriptorUrl(origin, sid)`, `parseRetryAfter(value, nowMs)`, `createFetchDescriptorPort({origin, fetch, logger, timeoutMs?, now?})`;
  - `SAMPLE_SID`, `sampleDescriptor(now, overrides?)`, `FakeDescriptorPort`, `createFakeDescriptorPort(clock)`;
  - `descriptorOrigin(env)`;
  - `Ports.descriptor`, and `FakePorts.descriptor: FakeDescriptorPort`.
- Logged: `descriptor.error {kind, status, problem?}`. The token is never logged.

- [ ] **Step 1: Write the failing fetch-port tests**

`src/services/fetchDescriptorPort.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFetchDescriptorPort,
  DESCRIPTOR_TIMEOUT_MS,
  parseRetryAfter,
  type FetchLike,
  type FetchResponse,
} from '@/services/fetchDescriptorPort';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import { descriptorWire, FIXTURE_NOW, FIXTURE_SID } from '../../test/fixtures/wire';

const TOKEN = 'fake-token-00000000000000000000';

function respond(
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {},
): FetchResponse {
  return { status, headers: { get: (name) => headers[name] ?? null }, json: async () => body };
}

function portOver(fetch: FetchLike) {
  const record = createRingRecord();
  const calls: Parameters<FetchLike>[] = [];
  const descriptor = createFetchDescriptorPort({
    origin: 'https://stg.seazn.club',
    fetch: (url, init) => {
      calls.push([url, init]);
      return fetch(url, init);
    },
    logger: createLogger({ record, now: () => 0 }),
    now: () => FIXTURE_NOW.getTime(),
  });
  return { ask: () => descriptor.fetch(FIXTURE_SID, TOKEN), calls, lines: () => record.lines() };
}

const answering =
  (response: FetchResponse): FetchLike =>
  async () =>
    response;

describe('the fetch descriptor port', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the provisional endpoint with the token as Bearer, never cached (D2)', async () => {
    const port = portOver(answering(respond(200, descriptorWire())));
    const answer = await port.ask();
    expect(answer).toMatchObject({
      ok: true,
      value: { sid: FIXTURE_SID, label: 'Seazn XI v Fake CC' },
    });
    expect(port.calls[0]?.[0]).toBe(
      `https://stg.seazn.club/api/capture/sessions/${FIXTURE_SID}/descriptor`,
    );
    expect(port.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Cache-Control': 'no-store',
        Accept: 'application/json',
      },
    });
  });

  it.each([
    [401, { kind: 'invalid' }],
    [404, { kind: 'not-found' }],
    [500, { kind: 'offline' }],
    [503, { kind: 'offline' }],
    [302, { kind: 'offline' }],
  ])('maps %i to %j (D3)', async (status, error) => {
    expect(await portOver(answering(respond(status))).ask()).toEqual({ ok: false, error });
  });

  it.each([
    [{ endReason: 'no_inbound_timeout' }, 'no-inbound-timeout'],
    [{ endReason: 'stopped' }, 'stopped'],
    [null, 'unknown'],
  ])('reads a 410 body %j as ended by %s', async (body, endReason) => {
    const answer = await portOver(answering(respond(410, body))).ask();
    expect(answer).toEqual({ ok: false, error: { kind: 'ended', endReason } });
  });

  it('reads Retry-After on a 429', async () => {
    const answer = await portOver(answering(respond(429, null, { 'Retry-After': '30' }))).ask();
    expect(answer).toEqual({ ok: false, error: { kind: 'rate-limited', retryAfterS: 30 } });
  });

  it('refuses a descriptor for a different session (the sid guard, D3)', async () => {
    const other = descriptorWire({ sid: '5d9c1d0e-0000-4000-8000-00000000beef' });
    expect(await portOver(answering(respond(200, other))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('refuses a malformed 200, including a body that is not JSON', async () => {
    const notJson: FetchResponse = {
      ...respond(200),
      json: () => Promise.reject(new SyntaxError('x')),
    };
    expect(await portOver(answering(respond(200, { sid: FIXTURE_SID }))).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
    expect(await portOver(answering(notJson)).ask()).toEqual({
      ok: false,
      error: { kind: 'invalid' },
    });
  });

  it('reads a 200 for a session already over as ended', async () => {
    const over = descriptorWire({ state: 'completed', endReason: 'stopped' });
    expect(await portOver(answering(respond(200, over))).ask()).toEqual({
      ok: false,
      error: { kind: 'ended', endReason: 'stopped' },
    });
  });

  it('calls a network failure offline', async () => {
    const port = portOver(() => Promise.reject(new TypeError('Network request failed')));
    expect(await port.ask()).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('calls a server that never answers offline after 8 s (captive portal)', async () => {
    vi.useFakeTimers();
    const port = portOver(() => new Promise<FetchResponse>(() => undefined));
    const answer = port.ask();
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('calls a body that never finishes offline after 8 s', async () => {
    vi.useFakeTimers();
    const stuckBody: FetchResponse = { ...respond(200), json: () => new Promise(() => undefined) };
    const port = portOver(answering(stuckBody));
    const answer = port.ask();
    await vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS);
    expect(await answer).toEqual({ ok: false, error: { kind: 'offline' } });
  });

  it('records every error and never the token', async () => {
    const port = portOver(answering(respond(401)));
    await port.ask();
    expect(port.lines().join('\n')).toContain('"event":"descriptor.error"');
    expect(port.lines().join('\n')).not.toContain(TOKEN);
  });
});

describe('parseRetryAfter (D5)', () => {
  const now = FIXTURE_NOW.getTime();
  it.each([
    [null, 5],
    ['30', 30],
    [' 30 ', 30],
    ['0', 1],
    ['600', 120],
    ['soon', 5],
    ['-5', 5],
    ['1.5', 5],
    ['Sat, 03 Oct 2026 13:00:42 GMT', 42],
    ['Sat, 03 Oct 2026 12:00:00 GMT', 1],
    ['Sun, 04 Oct 2026 13:00:00 GMT', 120],
  ])('reads %j as %i s', (value, seconds) => {
    expect(parseRetryAfter(value, now)).toBe(seconds);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/services/fetchDescriptorPort.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the port and the fetch implementation**

`src/services/descriptorPort.ts`:

```ts
import type { Result } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';

/**
 * The server's word on a scanned stream code (spec §2). Never rejects: every
 * failure is a `DescriptorError`, so Home always has something true to say.
 */
export interface DescriptorPort {
  fetch(sid: string, token: string): Promise<Result<SessionDescriptor, DescriptorError>>;
}
```

`src/services/fetchDescriptorPort.ts`:

```ts
import { type Result, err, ok } from '@/domain/Result';
import { parseDescriptor, parseEndReason } from '@/domain/credentials/parseDescriptor';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { isRecord } from '@/domain/credentials/wire';
import type { DescriptorPort } from '@/services/descriptorPort';
import type { Logger } from '@/services/logger';

/** The slice of `fetch` this port uses, so tests stub it without a DOM. */
export type FetchResponse = {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Readonly<Record<string, string>>; signal?: AbortSignal },
) => Promise<FetchResponse>;

/** Bounds a captive portal or a dead cell: after this, "no connection" (spec §1). */
export const DESCRIPTOR_TIMEOUT_MS = 8000;

type Answer = Result<SessionDescriptor, DescriptorError>;
type Deps = {
  origin: string;
  fetch: FetchLike;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
};

const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Provisional (D2): the web side owns the path; phase 5 reconciles it. */
export function descriptorUrl(origin: string, sid: string): string {
  return `${origin}/api/capture/sessions/${encodeURIComponent(sid)}/descriptor`;
}

/** Seconds or an HTTP-date, clamped to 1–120; anything else is 5 (D5). */
export function parseRetryAfter(value: string | null, nowMs: number): number {
  const text = value?.trim() ?? '';
  if (/^\d+$/.test(text)) return clamp(Number(text));
  if (HTTP_DATE.test(text)) return clamp(Math.ceil((Date.parse(text) - nowMs) / 1000));
  return 5;
}

const clamp = (seconds: number) => Math.min(120, Math.max(1, seconds));

export function createFetchDescriptorPort(deps: Deps): DescriptorPort {
  const ms = deps.timeoutMs ?? DESCRIPTOR_TIMEOUT_MS;
  return {
    fetch: (sid, token) => withDeadline((signal) => ask(deps, sid, token, signal), ms, deps.logger),
  };
}

/**
 * Races the whole exchange — headers and body — against the clock, so a
 * portal that answers 200 and then trickles nothing is still bounded.
 */
function withDeadline(
  work: (signal?: AbortSignal) => Promise<Answer>,
  ms: number,
  logger: Logger,
): Promise<Answer> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Answer>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(refuse(logger, { kind: 'offline' }, 0, 'timeout'));
    }, ms);
  });
  return Promise.race([work(controller?.signal), late]).finally(() => clearTimeout(timer));
}

async function ask(deps: Deps, sid: string, token: string, signal?: AbortSignal): Promise<Answer> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Cache-Control': 'no-store',
    Accept: 'application/json',
  };
  let response: FetchResponse;
  try {
    response = await deps.fetch(descriptorUrl(deps.origin, sid), {
      method: 'GET',
      headers,
      signal,
    });
  } catch {
    return refuse(deps.logger, { kind: 'offline' }, 0, 'network');
  }
  return read(response, sid, deps);
}

async function read(response: FetchResponse, sid: string, deps: Deps): Promise<Answer> {
  const { status } = response;
  switch (status) {
    case 200:
      return readDescriptor(await body(response), sid, deps.logger);
    case 401:
      return refuse(deps.logger, { kind: 'invalid' }, status);
    case 404:
      return refuse(deps.logger, { kind: 'not-found' }, status);
    case 410: {
      const data = await body(response);
      const endReason = parseEndReason(isRecord(data) ? data.endReason : undefined);
      return refuse(deps.logger, { kind: 'ended', endReason }, status);
    }
    case 429: {
      const now = deps.now?.() ?? Date.now();
      const retryAfterS = parseRetryAfter(response.headers.get('Retry-After'), now);
      return refuse(deps.logger, { kind: 'rate-limited', retryAfterS }, status);
    }
    default:
      return refuse(deps.logger, { kind: 'offline' }, status);
  }
}

/** The only sid guard (D3): a descriptor for another session is never bound to this code. */
function readDescriptor(data: unknown, sid: string, logger: Logger): Answer {
  const parsed = parseDescriptor(data);
  if (!parsed.ok) return refuse(logger, { kind: 'invalid' }, 200, 'unparseable');
  if (parsed.value.sid !== sid) return refuse(logger, { kind: 'invalid' }, 200, 'sid-mismatch');
  const { state, endReason } = parsed.value;
  if (state === 'completed' || state === 'failed') {
    return refuse(logger, { kind: 'ended', endReason: endReason ?? 'unknown' }, 200, 'over');
  }
  return ok(parsed.value);
}

const body = (response: FetchResponse): Promise<unknown> => response.json().catch(() => null);

/** Spec §5: a descriptor error is never silent. The token is never a field. */
function refuse(logger: Logger, error: DescriptorError, status: number, problem?: string): Answer {
  logger.warn('descriptor.error', { kind: error.kind, status, ...(problem ? { problem } : {}) });
  return err(error);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/services/fetchDescriptorPort.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutate the sid guard once**

`cp src/services/fetchDescriptorPort.ts /private/tmp/claude-501/s1a/fetchDescriptor.bak`. Delete the line `if (parsed.value.sid !== sid) return refuse(…);`.
Run the same file. Expected: FAIL ("refuses a descriptor for a different session"). Restore from the backup and re-run: PASS.

- [ ] **Step 6: Write the fake, its test, and the origin**

`src/services/fakeDescriptorPort.ts`:

```ts
import { type Result, ok } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { DescriptorPort } from '@/services/descriptorPort';

type Answer = Result<SessionDescriptor, DescriptorError>;

export const SAMPLE_SID = '5d9c1d0e-0000-4000-8000-000000000001';

/**
 * A made-up descriptor: warming, due to go live within 10 minutes, valid for
 * 4 hours, at a London venue. The same values as test/fixtures/wire.ts.
 */
export function sampleDescriptor(
  now: Date,
  overrides: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  return {
    sid: SAMPLE_SID,
    state: 'warming',
    endReason: null,
    playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
    overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
    holdWindowSeconds: { srt: 183, rtmps: 183 },
    venueTimezone: 'Europe/London',
    label: 'Seazn XI v Fake CC',
    scoreUpdates: 'realtime',
    maxDurationMinutes: 300,
    warmingDeadline: at(10),
    expiresAt: at(240),
    heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    ...overrides,
  };
}

export type FakeDescriptorPort = DescriptorPort & {
  /** Queue answers for the next fetches, in order. Unqueued fetches answer the sample for the sid asked. */
  answer(...results: Answer[]): void;
  /** The next fetch waits until the returned release is called. */
  hold(): () => void;
  readonly calls: readonly { readonly sid: string; readonly token: string }[];
};

/** The development build's descriptor too, behind EXPO_PUBLIC_FAKE_DESCRIPTOR (D25). */
export function createFakeDescriptorPort(clock: () => Date): FakeDescriptorPort {
  const queue: Answer[] = [];
  const calls: { sid: string; token: string }[] = [];
  let gate: Promise<void> | null = null;
  return {
    calls,
    answer: (...results) => {
      queue.push(...results);
    },
    hold: () => {
      let release = () => undefined as void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    fetch: async (sid, token) => {
      calls.push({ sid, token });
      const waiting = gate;
      gate = null;
      if (waiting !== null) await waiting;
      return queue.shift() ?? ok(sampleDescriptor(clock(), { sid }));
    },
  };
}
```

`src/services/fakeDescriptorPort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { err } from '@/domain/Result';
import { createFakeDescriptorPort } from '@/services/fakeDescriptorPort';

const NOW = new Date('2026-10-03T13:00:00Z');

describe('the fake descriptor port', () => {
  it('answers the sample for the sid it was asked about', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    const answer = await port.fetch('other-sid', 't');
    expect(answer).toMatchObject({
      ok: true,
      value: { sid: 'other-sid', venueTimezone: 'Europe/London' },
    });
    expect(port.calls).toEqual([{ sid: 'other-sid', token: 't' }]);
  });

  it('plays queued answers in order, then the sample', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    port.answer(err({ kind: 'offline' }), err({ kind: 'not-found' }));
    expect((await port.fetch('s', 't')).ok).toBe(false);
    expect(await port.fetch('s', 't')).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect((await port.fetch('s', 't')).ok).toBe(true);
  });

  it('holds the next fetch until released', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    const release = port.hold();
    let settled = false;
    const pending = port.fetch('s', 't').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
  });
});
```

In `src/services/seaznHosts.ts` add, and give it one test per environment in `seaznHosts.test.ts`:

```ts
/** Where the descriptor lives (D2): the same production/staging split as the hosts, and the same safe default. */
export function descriptorOrigin(env: string | undefined): string {
  return env === 'production' ? 'https://seazn.club' : 'https://stg.seazn.club';
}
```

```ts
it('asks staging for descriptors unless explicitly production', () => {
  expect(descriptorOrigin(undefined)).toBe('https://stg.seazn.club');
  expect(descriptorOrigin('production')).toBe('https://seazn.club');
});
```

- [ ] **Step 7: Wire the port (and check the composition root, failure class 1)**

`src/hooks/usePorts.tsx`: import `type DescriptorPort` and add:

```ts
  /** The server's word on a scanned stream code (spec §2). */
  readonly descriptor: DescriptorPort;
```

`src/hooks/nativePorts.ts`: import `createFetchDescriptorPort`, `createFakeDescriptorPort` and `descriptorOrigin`. Hoist `const clock = () => new Date();` and use it for `clock` in the returned object too. Build:

```ts
// D25: the web endpoint does not exist yet; a dev build can opt into the fake.
const descriptor =
  __DEV__ && process.env.EXPO_PUBLIC_FAKE_DESCRIPTOR === '1'
    ? createFakeDescriptorPort(clock)
    : createFetchDescriptorPort({
        origin: descriptorOrigin(process.env.EXPO_PUBLIC_SEAZN_ENV),
        fetch: (url, init) => fetch(url, init),
        logger,
      });
```

Add `descriptor,` to the returned object.

`test/fakePorts.ts`: import `createFakeDescriptorPort` and `type FakeDescriptorPort`. Add `readonly descriptor: FakeDescriptorPort;` to `FakePorts`, and `descriptor: createFakeDescriptorPort(() => now)` to `fakes`.

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm vitest run src/services src/hooks`
Expected: PASS. Then `rg -n "descriptor" src/hooks/nativePorts.ts` must show the port in the returned object.

- [ ] **Step 9: Commit**

```bash
git add src/services/descriptorPort.ts src/services/fetchDescriptorPort.ts src/services/fetchDescriptorPort.test.ts src/services/fakeDescriptorPort.ts src/services/fakeDescriptorPort.test.ts src/services/seaznHosts.ts src/services/seaznHosts.test.ts src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts
git commit -F - <<'EOF'
feat(services): DescriptorPort with a fetch implementation and a fake

Status mapping, Retry-After and the sid guard per plan D2, D3 and D5.
Every error is logged; the token never is.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) the fake's queue and hold drive re-entry in Task 10; (2) an empty body, a body that is not JSON, a missing Retry-After and an unknown end reason are all tested; (3) a timeout and a network failure are tested; (4) not applicable.

---

### Task 9: The saved stream code keeps its descriptor; times in the venue zone

Spec §2: "The saved stream code also stores the descriptor … Every time the operator reads is shown in the descriptor's `venueTimezone`." D28 and D31 apply.

**Files:**

- Modify: `src/domain/mode/savedCode.ts`, `src/domain/mode/savedCode.test.ts`
- Create: `src/domain/mode/savedSession.ts`, `src/domain/mode/savedSession.test.ts`
- Modify: `src/domain/mode/reopen.ts`, `src/domain/mode/reopen.test.ts`
- Modify: `src/services/modeStore.ts`, `src/services/modeStore.test.ts`
- Modify: `src/hooks/useHome.ts` (`useOpenCode`, `useContinue`, `useHomeView`, `statusText`)
- Create: `test/fixtures/savedStream.ts`
- Modify fixtures in: `src/hooks/useReopenGate.test.tsx`, `src/hooks/useStreamLeave.test.tsx`, `src/ui/screens/StreamPlaceholderScreen.test.tsx`, `src/ui/screens/HomeScreen.test.tsx`

**Interfaces:**

- Consumes: `SessionDescriptor`, `parseDescriptor`, `descriptorToWire`, `parseCaptureQrText`, `buildStreamSession`, `sampleDescriptor`.
- Produces:
  - `SavedCode = {mode, raw, slot, savedAt, expiresAt, descriptor}`, where `venueTz` is removed;
  - `savedCodeFrom(code, now, descriptor)` and `venueZone(code): string | null`;
  - record version 2;
  - `sessionFromSaved(saved): Result<StreamSession, 'unreadable-code' | 'no-descriptor'>`;
  - `ExpiryNotice` and `ReopenTarget.notice` gain `venueTz: string | null`;
  - the fixture `savedStreamCode(overrides?)`.

- [ ] **Step 1: Write the fixture**

`test/fixtures/savedStream.ts`:

```ts
import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { captureRaw, FIXTURE_NOW } from './wire';

/** A stream code as Home saves it after a 200: v2 raw plus its descriptor. Made-up values. */
export function savedStreamCode(overrides: Partial<SavedCode> = {}): SavedCode {
  return {
    mode: 'stream',
    raw: captureRaw(),
    slot: 1,
    savedAt: FIXTURE_NOW,
    expiresAt: new Date(FIXTURE_NOW.getTime() + 4 * 3600_000),
    descriptor: sampleDescriptor(FIXTURE_NOW),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing domain tests**

Rewrite `src/domain/mode/savedCode.test.ts` around the fixture. These cases replace the S0 ones that named `venueTz`; keep the S0 cases for garbage text and unknown modes, with their fixtures swapped.

```ts
import { describe, expect, it } from 'vitest';
import {
  decodeSavedCode,
  encodeSavedCode,
  savedCodeFrom,
  venueZone,
  type SavedCode,
} from '@/domain/mode/savedCode';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_NOW } from '../../../test/fixtures/wire';

describe('saved codes, v2 (D28)', () => {
  it('round-trips a stream code with its descriptor', () => {
    const code = savedStreamCode();
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  it('round-trips a scoring code, which has no descriptor', () => {
    const code: SavedCode = {
      mode: 'scoring',
      raw: 'https://stg.seazn.club/score/abc',
      slot: null,
      savedAt: FIXTURE_NOW,
      expiresAt: null,
      descriptor: null,
    };
    expect(decodeSavedCode(encodeSavedCode(code))).toEqual(code);
  });

  it('drops a v1 record: clean slate, never migrated', () => {
    const v1 = JSON.stringify({
      v: 1,
      mode: 'stream',
      raw: 'r',
      slot: 1,
      savedAt: 1,
      expiresAt: 2,
      venueTz: null,
    });
    expect(decodeSavedCode(v1)).toBeNull();
  });

  it('drops a stream record with no descriptor', () => {
    expect(decodeSavedCode(encodeSavedCode(savedStreamCode({ descriptor: null })))).toBeNull();
  });

  it('drops a record whose descriptor no longer parses', () => {
    const text = encodeSavedCode(savedStreamCode()).replace('"state":"warming"', '"state":"odd"');
    expect(decodeSavedCode(text)).toBeNull();
  });

  it('keeps the descriptor handed over at save', () => {
    const descriptor = sampleDescriptor(FIXTURE_NOW);
    const code = savedCodeFrom(
      { mode: 'stream', raw: 'r', sid: 's', slot: 0, token: 't', expiresAt: FIXTURE_NOW },
      FIXTURE_NOW,
      descriptor,
    );
    expect(code.descriptor).toBe(descriptor);
  });

  it('reads the venue zone from the descriptor, else none', () => {
    expect(venueZone(savedStreamCode())).toBe('Europe/London');
    expect(venueZone(savedStreamCode({ descriptor: null }))).toBeNull();
  });
});
```

`src/domain/mode/savedSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

describe('sessionFromSaved', () => {
  it('builds the session arm needs', () => {
    const result = sessionFromSaved(savedStreamCode());
    expect(result).toMatchObject({
      ok: true,
      value: {
        slot: 1,
        primary: { transport: 'srt' },
        descriptor: { label: 'Seazn XI v Fake CC' },
      },
    });
  });

  it('says when the saved raw no longer parses', () => {
    expect(sessionFromSaved(savedStreamCode({ raw: '{"fake":true}' }))).toEqual({
      ok: false,
      error: 'unreadable-code',
    });
  });

  it('says when there is no descriptor', () => {
    expect(sessionFromSaved(savedStreamCode({ descriptor: null }))).toEqual({
      ok: false,
      error: 'no-descriptor',
    });
  });
});
```

In `src/domain/mode/reopen.test.ts`, replace the `SavedCode` fixture with `savedStreamCode({ expiresAt: EXPIRY })`. The expected notice becomes `{ mode: 'stream', expiredAt: EXPIRY, venueTz: 'Europe/London' }`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/domain/mode`
Expected: FAIL, because the types and `savedSession` are missing.

- [ ] **Step 4: Implement**

Replace `SavedCode`, `VERSION`, `savedCodeFrom`, `encodeSavedCode` and `decodeSavedCode` in `src/domain/mode/savedCode.ts`. Delete `isStringOrNull`, which is no longer used; keep `decodeMode`, `isExpired`, `parse`, `isTimeOrNull` and `isSlotOrNull`.

```ts
import { descriptorToWire, parseDescriptor } from '@/domain/credentials/parseDescriptor';
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { Mode, ModeCode } from '@/domain/mode/Mode';

/**
 * A code kept so the app can reopen into its mode (S0 spec §4). A stream code
 * keeps the descriptor the server gave at scan, "cached with the session"
 * (S1 spec §2), so the venue's zone and the session's URLs survive a restart.
 */
export type SavedCode = {
  readonly mode: Mode;
  readonly raw: string;
  readonly slot: number | null;
  readonly savedAt: Date;
  /** The QR's `exp` (D31). */
  readonly expiresAt: Date | null;
  /** Stream codes only, and required for them: a stream record without one is dropped. */
  readonly descriptor: SessionDescriptor | null;
};

const VERSION = 2;

export function savedCodeFrom(
  code: ModeCode,
  now: Date,
  descriptor: SessionDescriptor | null,
): SavedCode {
  const stream = code.mode === 'stream';
  return {
    mode: code.mode,
    raw: code.raw,
    slot: stream ? code.slot : null,
    savedAt: now,
    expiresAt: stream ? code.expiresAt : null,
    descriptor,
  };
}

/** Every time the operator reads for this code is in the venue's zone (spec §2). */
export function venueZone(code: SavedCode): string | null {
  return code.descriptor?.venueTimezone ?? null;
}

export function encodeSavedCode(code: SavedCode): string {
  return JSON.stringify({
    v: VERSION,
    mode: code.mode,
    raw: code.raw,
    slot: code.slot,
    savedAt: code.savedAt.getTime(),
    expiresAt: code.expiresAt?.getTime() ?? null,
    descriptor: code.descriptor === null ? null : descriptorToWire(code.descriptor),
  });
}

/** Clean slate (S0 decision 12): v1, unreadable, or a stream record with no descriptor → null. */
export function decodeSavedCode(text: string): SavedCode | null {
  const data = parse(text);
  if (data === null || data.v !== VERSION) return null;
  const mode = decodeMode(typeof data.mode === 'string' ? data.mode : null);
  if (mode === null || typeof data.raw !== 'string' || typeof data.savedAt !== 'number')
    return null;
  if (!isTimeOrNull(data.expiresAt) || !isSlotOrNull(data.slot)) return null;
  const descriptor = decodeDescriptor(data.descriptor);
  if (descriptor === false || (mode === 'stream' && descriptor === null)) return null;
  return {
    mode,
    raw: data.raw,
    slot: data.slot,
    savedAt: new Date(data.savedAt),
    expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt),
    descriptor,
  };
}

/** `false` is present but unreadable, which drops the whole record. */
function decodeDescriptor(value: unknown): SessionDescriptor | null | false {
  if (value === null || value === undefined) return null;
  const parsed = parseDescriptor(value);
  return parsed.ok ? parsed.value : false;
}
```

`src/domain/mode/savedSession.ts`:

```ts
import { type Result, err, ok } from '@/domain/Result';
import { parseCaptureQrText } from '@/domain/credentials/parseCaptureQr';
import { buildStreamSession, type StreamSession } from '@/domain/credentials/StreamSession';
import type { SavedCode } from '@/domain/mode/savedCode';

export type SavedSessionProblem = 'unreadable-code' | 'no-descriptor';

/**
 * What the viewfinder arms with: the saved raw parsed again (it was only
 * recognised at scan) joined to the saved descriptor.
 */
export function sessionFromSaved(saved: SavedCode): Result<StreamSession, SavedSessionProblem> {
  if (saved.descriptor === null) return err('no-descriptor');
  const code = parseCaptureQrText(saved.raw);
  if (!code.ok) return err('unreadable-code');
  return ok(buildStreamSession(code.value, saved.descriptor));
}
```

`src/domain/mode/reopen.ts`:

- import `venueZone`;
- widen the notice type to `{ readonly mode: Mode; readonly expiredAt: Date; readonly venueTz: string | null }`;
- return `notice: { mode: 'stream', expiredAt: code.expiresAt, venueTz: venueZone(code) }`.

`src/services/modeStore.ts`: `export type ExpiryNotice = { readonly mode: Mode; readonly expiredAt: Date; readonly venueTz: string | null };`.

`src/hooks/useHome.ts`:

- `useOpenCode`: `modeStore.open(savedCodeFrom(code, clock(), null))`. Task 10 passes the fetched descriptor; until then a new stream record is saved without one, and is dropped at the next load. Task 10 is in the same batch; do not stop between them.
- `statusText`: `format(notice.expiredAt, notice.venueTz)`.
- `useHomeView`: `continueTill: continueCode?.expiresAt ? format(continueCode.expiresAt, venueZone(continueCode)) : null`.
- `useContinue`: `const notice = { mode: 'stream' as const, expiredAt: code.expiresAt, venueTz: venueZone(code) };`.

Fixtures:

- `src/services/modeStore.test.ts`, `src/hooks/useReopenGate.test.tsx`, `src/hooks/useStreamLeave.test.tsx` and `src/ui/screens/StreamPlaceholderScreen.test.tsx`: replace each hand-built stream `SavedCode` literal with `savedStreamCode({…})`, carrying over the fields the test set (`slot: 2`, `expiresAt`, `raw`). Replace each notice literal with one that includes `venueTz: 'Europe/London'`.
- In `StreamPlaceholderScreen.test.tsx`, the 'says there is no slot…' and slot texts are unchanged.
- `src/ui/screens/HomeScreen.test.tsx`, `savedStream(expiresAt)`:

```ts
function savedStream(expiresAt: Date, descriptor = sampleDescriptor(TEST_NOW)): string {
  return encodeSavedCode(savedStreamCode({ raw: streamRaw(expiresAt), expiresAt, descriptor }));
}
```

- [ ] **Step 5: Add Home's venue-zone test**

In `HomeScreen.test.tsx`, beside 'offers Continue for a left stream with a valid code…':

```ts
it('gives the Continue time in the venue’s zone, naming it when it is not the phone’s (spec §2)', async () => {
  const madrid = sampleDescriptor(TEST_NOW, { venueTimezone: 'Europe/Madrid' });
  await renderHome({ kvSeed: { [STORE_KEYS.code('stream')]: savedStream(AT_1840, madrid) } });
  const detail = screen.getByText(/Slot 1 · code valid till/);
  expect(detail.textContent).toMatch(/19:40/);
  expect(detail.textContent).not.toBe('Slot 1 · code valid till 19:40');
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/mode/savedCode.ts src/domain/mode/savedCode.test.ts src/domain/mode/savedSession.ts src/domain/mode/savedSession.test.ts src/domain/mode/reopen.ts src/domain/mode/reopen.test.ts src/services/modeStore.ts src/services/modeStore.test.ts src/hooks/useHome.ts src/hooks/useReopenGate.test.tsx src/hooks/useStreamLeave.test.tsx src/ui/screens/StreamPlaceholderScreen.test.tsx src/ui/screens/HomeScreen.test.tsx test/fixtures/savedStream.ts
git commit -F - <<'EOF'
feat(mode): saved stream codes keep their descriptor; venue-zone times

Record v2; v1 and descriptor-less stream records are dropped (D28).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) v1, a missing descriptor and an unparseable descriptor are covered; (3) the cold-start load drops what it cannot trust; (4) a Madrid venue viewed from a London phone is tested.

---

### Task 10: Home checks a stream code with the server

Spec §1: "The phone fetches the descriptor with `tok`. The code panel on Home says 'Checking code…' while it waits, never a bare spinner," followed by the outcome table. D5, D24 and D27 apply.

**Files:**

- Modify: `src/domain/credentials/SessionDescriptor.ts` (add `endedByTimeout`), and create `src/domain/credentials/SessionDescriptor.test.ts`
- Modify: `src/hooks/useHome.ts`
- Modify: `src/ui/components/CodePanel.tsx`, `src/ui/components/CodePanel.test.tsx`
- Modify: `src/ui/screens/HomeScreen.tsx`, `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/i18n/en.json`, `es.json`, `fr.json`, `nl.json`

**Interfaces:**

- Consumes: `Ports.descriptor`, `Ports.scanFlight`, `DescriptorError`, `savedCodeFrom(code, now, descriptor)`.
- Produces:
  - `endedByTimeout(reason): boolean`;
  - `HomePanel = PanelOutcome | {kind: 'checking', tapped} | {kind: 'descriptorError', tapped, error, code}`, where `code` is a `StreamCode`;
  - `StreamCode = Extract<ModeCode, {mode: 'stream'}>`;
  - `HomeActions.retryCheck()`;
  - `HomeView.panel: HomePanel | null`;
  - `CodePanel` takes `outcome: HomePanel` and `onTryAgain`.

- [ ] **Step 1: Add the copy (4 languages)**

Add these keys to each dictionary after `panel.close`:

| key                                     | en                                                     | es                                                                 | fr                                                            | nl                                                                |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `panel.checking.title`                  | Checking code…                                         | Comprobando el código…                                             | Vérification du code…                                         | Code controleren…                                                 |
| `panel.descriptor.invalid.title`        | Not valid for streaming                                | No vale para emitir                                                | Non valable pour le direct                                    | Niet geldig voor streamen                                         |
| `panel.descriptor.invalid.body`         | This code isn't valid for streaming.                   | Este código no es válido para emitir.                              | Ce code n'est pas valable pour le direct.                     | Deze code is niet geldig voor streamen.                           |
| `panel.descriptor.endedOrganiser.title` | Stream ended                                           | Emisión terminada                                                  | Direct terminé                                                | Stream beëindigd                                                  |
| `panel.descriptor.endedOrganiser.body`  | This stream was ended by the organiser.                | El organizador terminó esta emisión.                               | L'organisateur a mis fin à ce direct.                         | De organisator heeft deze stream beëindigd.                       |
| `panel.descriptor.timedOut.title`       | Code timed out                                         | Código caducado                                                    | Code expiré                                                   | Code verlopen                                                     |
| `panel.descriptor.timedOut.body`        | This code timed out — ask the organiser for a new one. | Este código ha caducado: pide otro al organizador.                 | Ce code a expiré : demandez-en un nouveau à l'organisateur.   | Deze code is verlopen: vraag de organisator om een nieuwe.        |
| `panel.descriptor.offline.title`        | No connection                                          | Sin conexión                                                       | Pas de connexion                                              | Geen verbinding                                                   |
| `panel.descriptor.offline.body`         | Can't check this code — no connection. Try again.      | No se puede comprobar el código: sin conexión. Inténtalo de nuevo. | Impossible de vérifier ce code : pas de connexion. Réessayez. | Kan deze code niet controleren: geen verbinding. Probeer opnieuw. |
| `panel.descriptor.busy.title`           | Server busy                                            | Servidor ocupado                                                   | Serveur occupé                                                | Server bezet                                                      |
| `panel.descriptor.busy.body`            | Busy — trying again in {n}s                            | Ocupado: se reintenta en {n} s                                     | Occupé : nouvel essai dans {n} s                              | Bezet: opnieuw over {n} s                                         |
| `panel.tryAgain`                        | Try again                                              | Reintentar                                                         | Réessayer                                                     | Opnieuw proberen                                                  |

Run: `pnpm vitest run src/i18n` → PASS (key sets and placeholders match).

- [ ] **Step 2: Write the failing tests**

`src/domain/credentials/SessionDescriptor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { endedByTimeout } from '@/domain/credentials/SessionDescriptor';

describe('endedByTimeout (D4)', () => {
  it.each([
    ['no-inbound-timeout', true],
    ['max-duration', true],
    ['stopped', false],
    ['target-rejected', false],
    ['unknown', false],
  ] as const)('%s → %s', (reason, timedOut) => {
    expect(endedByTimeout(reason)).toBe(timedOut);
  });
});
```

Add to `src/ui/screens/HomeScreen.test.tsx` (importing `err` from `@/domain/Result`, `decodeSavedCode`, `createFetchDescriptorPort` and `DESCRIPTOR_TIMEOUT_MS`):

```ts
describe('Home: checking a stream code with the server (spec §1)', () => {
  afterEach(() => vi.useRealTimers());

  const scanStream = async (home: Awaited<ReturnType<typeof renderHome>>) => {
    home.scanner.queue({ outcome: 'scanned', raw: streamRaw(IN_TWO_HOURS) });
    fireEvent.click(liveStreamTile());
  };

  it('says Checking code… while it asks, then saves the descriptor and opens', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    expect(home.navigation.current()).toBe('home');
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    const saved = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('stream')) ?? '');
    expect(saved?.descriptor?.label).toBe('Seazn XI v Fake CC');
    expect(home.descriptor.calls).toEqual([
      { sid: '5d9c1d0e-0000-4000-8000-000000000001', token: 'fake-token-00000000000000000000' },
    ]);
  });

  it('opens no second scanner while a code is being checked', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    fireEvent.click(liveStreamTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
  });

  it('keeps Checking code… up against Back and the dim', async () => {
    const home = await renderHome();
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Checking code…');
    let handled = false;
    act(() => {
      handled = home.back.press();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handled).toBe(true);
    expect(screen.getByText('Checking code…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
    release();
  });

  it.each([
    [{ kind: 'invalid' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [{ kind: 'not-found' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [
      { kind: 'ended', endReason: 'stopped' },
      'Stream ended',
      'This stream was ended by the organiser.',
    ],
    [
      { kind: 'ended', endReason: 'unknown' },
      'Stream ended',
      'This stream was ended by the organiser.',
    ],
    [
      { kind: 'ended', endReason: 'no-inbound-timeout' },
      'Code timed out',
      'This code timed out — ask the organiser for a new one.',
    ],
    [
      { kind: 'ended', endReason: 'max-duration' },
      'Code timed out',
      'This code timed out — ask the organiser for a new one.',
    ],
    [{ kind: 'offline' }, 'No connection', "Can't check this code — no connection. Try again."],
    [{ kind: 'rate-limited', retryAfterS: 7 }, 'Server busy', 'Busy — trying again in 7s'],
  ] as const)('explains %j and saves nothing', async (error, title, body) => {
    const home = await renderHome();
    home.descriptor.answer(err(error));
    await scanStream(home);
    await screen.findByText(title);
    expect(screen.getByText(body)).toBeTruthy();
    expect(home.navigation.current()).toBe('home');
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('tries the same code again from the offline panel, without the scanner', async () => {
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'offline' }));
    await scanStream(home);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(home.navigation.current()).toBe('stream'));
    expect(home.descriptor.calls).toHaveLength(2);
    expect(home.scanner.scans).toBe(1);
  });

  it('retries once by itself when the server says it is busy (D5)', async () => {
    vi.useFakeTimers();
    const home = await renderHome();
    home.descriptor.answer(err({ kind: 'rate-limited', retryAfterS: 7 }));
    await scanStream(home);
    await act(async () => undefined);
    expect(screen.getByText('Busy — trying again in 7s')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6999));
    expect(home.descriptor.calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(async () => undefined);
    expect(home.descriptor.calls).toHaveLength(2);
    expect(home.navigation.current()).toBe('stream');
  });

  it('calls a descriptor port that throws "no connection" (missing module)', async () => {
    const throwing = { fetch: () => Promise.reject(new Error('module missing')) };
    const home = await renderHome({ descriptor: throwing as never });
    await scanStream(home);
    await screen.findByText('No connection');
  });

  it('says no connection after 8 s when the server never answers, and scans again (Review Focus 1)', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    const descriptor = createFetchDescriptorPort({
      origin: 'https://stg.seazn.club',
      fetch: () => new Promise(() => undefined),
      logger: fakes.ports.logger,
    });
    const home = await renderHome({ descriptor });
    await scanStream(home);
    await act(() => vi.advanceTimersByTimeAsync(DESCRIPTOR_TIMEOUT_MS));
    expect(screen.getByText('No connection')).toBeTruthy();
    fireEvent.click(liveStreamTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(2);
  });

  it('speaks the operator’s language while checking', async () => {
    const home = await renderHome({ deviceLanguages: ['fr'] });
    const release = home.descriptor.hold();
    await scanStream(home);
    await screen.findByText('Vérification du code…');
    release();
  });
});
```

(`descriptor: throwing as never` is the one cast in the file. It stands in for a port whose implementation breaks its own contract, which is the case being tested.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/domain/credentials src/ui/screens/HomeScreen.test.tsx`
Expected: FAIL. `endedByTimeout` is missing, and Home opens without checking.

- [ ] **Step 4: Implement the domain helper**

Append to `src/domain/credentials/SessionDescriptor.ts`:

```ts
/** D4: these two read "timed out" to the operator; every other reason reads "ended by the organiser". */
export function endedByTimeout(reason: OrganiserEndReason): boolean {
  return reason === 'no-inbound-timeout' || reason === 'max-duration';
}
```

- [ ] **Step 5: Implement Home's check**

In `src/hooks/useHome.ts`, import `err` and `type DescriptorError`/`SessionDescriptor`, and add `useEffect`:

```ts
export type StreamCode = Extract<ModeCode, { mode: 'stream' }>;

/** What the panel shows: a scan's outcome, the check in flight, or the server's refusal. */
export type HomePanel =
  | PanelOutcome
  | { readonly kind: 'checking'; readonly tapped: Mode }
  | {
      readonly kind: 'descriptorError';
      readonly tapped: Mode;
      readonly error: DescriptorError;
      readonly code: StreamCode;
    };
```

Update `HomeView.panel` to `HomePanel | null`, `SetPanel` to `(panel: HomePanel | null) => void`, and `useState<HomePanel | null>`. Add `retryCheck(): void;` to `HomeActions`. `OpenCode` becomes `(code: ModeCode, descriptor: SessionDescriptor | null) => Promise<void>`, and `useOpenCode` passes its `descriptor` to `savedCodeFrom(code, clock(), descriptor)`.

Add:

```ts
type OpenOrCheck = (code: ModeCode) => Promise<void>;

/**
 * Spec §1: a stream code is checked with the server before anything is saved.
 * The scan flight is still up while this runs, so a second tap is ignored
 * until the answer is in. A port that throws is read as no connection.
 */
function useOpenOrCheck(openCode: OpenCode, setPanel: SetPanel): OpenOrCheck {
  const { descriptor } = usePorts();
  return useCallback(
    async (code: ModeCode) => {
      if (code.mode !== 'stream') return openCode(code, null);
      setPanel({ kind: 'checking', tapped: 'stream' });
      const offline = err({ kind: 'offline' } as const);
      const answer = await descriptor.fetch(code.sid, code.token).catch(() => offline);
      if (!answer.ok) {
        return setPanel({ kind: 'descriptorError', tapped: 'stream', error: answer.error, code });
      }
      setPanel(null);
      await openCode(code, answer.value);
    },
    [descriptor, openCode, setPanel],
  );
}

/**
 * Try again (offline) and the busy retry (D5): the same code, under a scan
 * flight of its own so a tile tap cannot interleave.
 */
function useRetryCheck(panel: HomePanel | null, openOrCheck: OpenOrCheck): () => void {
  const { scanFlight } = usePorts();
  return useCallback(() => {
    if (panel?.kind !== 'descriptorError') return;
    if (!scanFlight.begin()) return;
    void openOrCheck(panel.code)
      .catch(ignoreUnexpected)
      .finally(() => scanFlight.end());
  }, [panel, openOrCheck, scanFlight]);
}

/** D5: one automatic retry per 429 answer, cancelled if the panel changes first. */
function useBusyRetry(panel: HomePanel | null, retry: () => void): void {
  useEffect(() => {
    if (panel?.kind !== 'descriptorError' || panel.error.kind !== 'rate-limited') return;
    const timer = setTimeout(retry, panel.error.retryAfterS * 1000);
    return () => clearTimeout(timer);
  }, [panel, retry]);
}
```

Wire it in:

- `useHandleScan` takes `openOrCheck` in place of `openCode`, with `if (outcome.kind === 'open') return openOrCheck(outcome.code);`.
- `usePanelActions` takes `openOrCheck`. `openFromPanel` calls `openOrCheck(code)`, and `closePanel` becomes `useCallback(() => setPanel((p) => (p?.kind === 'checking' ? p : null)), [setPanel])`, which means `SetPanel` must accept an updater. Type it as `Dispatch<SetStateAction<HomePanel | null>>` from `react`.
- In `useHome`, add `const openOrCheck = useOpenOrCheck(openCode, setPanel);`, pass it to `useHandleScan` and `usePanelActions`, then `const retryCheck = useRetryCheck(panel, openOrCheck); useBusyRetry(panel, retryCheck);`, and include `retryCheck` in `actions`.
- `useHomeView`'s `panelTime` is unchanged: only the `expired` kind has a time.

- [ ] **Step 6: Implement the panel copy**

In `src/ui/components/CodePanel.tsx`:

- replace the local `PanelOutcome` with `import type { HomePanel } from '@/hooks/useHome';`;
- add `retry: boolean` and `closable: boolean` to `Copy`;
- the existing cases return `retry: false, closable: true`;
- add the cases below to `panelCopy`, typed `(outcome: HomePanel, …)`.

```ts
    case 'checking':
      return { title: t('panel.checking.title'), body: null, open: null, retry: false, closable: false };
    case 'descriptorError':
      return descriptorCopy(outcome.error, t);
```

```ts
/** Spec §1's table, with a short title over the spec's sentence (D27). */
function descriptorCopy(error: DescriptorError, t: Translator['t']): Copy {
  const plain = (title: MessageKey, body: MessageKey, retry = false): Copy => ({
    title: t(title),
    body: t(body),
    open: null,
    retry,
    closable: true,
  });
  switch (error.kind) {
    case 'invalid':
    case 'not-found':
      return plain('panel.descriptor.invalid.title', 'panel.descriptor.invalid.body');
    case 'ended':
      return endedByTimeout(error.endReason)
        ? plain('panel.descriptor.timedOut.title', 'panel.descriptor.timedOut.body')
        : plain('panel.descriptor.endedOrganiser.title', 'panel.descriptor.endedOrganiser.body');
    case 'offline':
      return plain('panel.descriptor.offline.title', 'panel.descriptor.offline.body', true);
    case 'rate-limited':
      return {
        title: t('panel.descriptor.busy.title'),
        body: t('panel.descriptor.busy.body', { n: error.retryAfterS }),
        open: null,
        retry: false,
        closable: true,
      };
  }
}
```

Add `onTryAgain: () => void` to `CodePanelProps`. In the render:

- the dim `Pressable` gets `disabled={!copy.closable}`;
- `{copy.retry ? <Button label={t('panel.tryAgain')} onPress={props.onTryAgain} /> : null}` goes before the ghost button;
- the ghost "Scan again" renders only when `copy.closable`.

In `CodePanel.test.tsx`, pass `onTryAgain={noop}` wherever the panel is rendered.

In `src/ui/screens/HomeScreen.tsx`, pass `onTryAgain={actions.retryCheck}`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS, with the full suite green.

- [ ] **Step 8: Mutate the scan flight once**

`cp src/hooks/useHome.ts /private/tmp/claude-501/s1a/useHome.bak`. In `useTapTile`, change `if (!scanFlight.begin()) return;` to `scanFlight.begin();`.
Run: `pnpm vitest run src/ui/screens/HomeScreen.test.tsx`. Expected: FAIL ('opens no second scanner while a code is being checked'). Restore and re-run: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/credentials/SessionDescriptor.ts src/domain/credentials/SessionDescriptor.test.ts src/hooks/useHome.ts src/ui/components/CodePanel.tsx src/ui/components/CodePanel.test.tsx src/ui/screens/HomeScreen.tsx src/ui/screens/HomeScreen.test.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json
git commit -F - <<'EOF'
feat(home): check stream codes with the server before saving them

"Checking code…" while the descriptor is fetched, then spec §1's outcome
table, with Try again for offline and one automatic retry on 429.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second tap while checking and a retry under its own flight are covered; (2) a throwing port stands in for a missing module; (3) a server that never answers, with the flight released afterwards, is tested; (4) French is tested. The Continue card's venue zone is covered in Task 9.

---

### Task 11: Engine port reshape, and a fake that plays scenes

Spec §2 covers the new `arm({session, heartbeat})`, the snapshot additions, and the new `DegradeReason` and `EndReason` members. Its "One authority" section removes `projectEvent`: "The fake plays scripted snapshots instead." D8, D9, D38, D39 and D40 apply. The names and wire strings here are the TypeScript side of plan B's decision 6 mapping table (`2026-09-30-s1-plan-b-kotlin-core.md`); plan C's bridge maps one onto the other.

**Files:**

- Modify: `modules/capture-engine/src/CaptureEnginePort.ts`
- Rewrite: `modules/capture-engine/src/FakeCaptureEngine.ts`, `modules/capture-engine/src/FakeCaptureEngine.test.ts`
- Modify: `src/domain/session/SessionState.ts`
- Delete: `src/domain/session/projectEvent.ts`, `src/domain/session/projectEvent.test.ts`
- Modify: `src/domain/credentials/StreamCredentials.ts` (remove `SessionCredentials`)
- Modify: `src/hooks/engineSelectors.ts`, `src/hooks/engineSelectors.test.ts`
- Modify: `src/ui/components/DevEngineControls.tsx`
- Create: `test/fixtures/session.ts`
- Modify every test that forces an `ended` state:
  - `src/hooks/useOrientationGate.test.tsx:66`
  - `src/hooks/useReopenGate.test.tsx:133`
  - `src/ui/screens/HomeScreen.test.tsx:483`
  - `src/hooks/useStreamLeave.test.tsx` (`STOPPED`, `FAILED`)
  - the `SessionState` literals in `src/hooks/engineSelectors.test.ts`

**Interfaces:**

- Consumes: `StreamSession`, `SessionDescriptor`.
- Produces:
  - `HeartbeatTarget = {url, token}`, with the arm intent `{kind: 'arm', session, heartbeat}`;
  - `EngineSnapshot = {state, telemetry, descriptor, reportedAtMs, survivesBackground}`;
  - `Delivery`, `ThermalStatus`, `SrtStats`, `HeartbeatStatus`, and `Telemetry` per D9;
  - `SessionState`: `reconnecting` gains `holdWindowSeconds` and `cause: ReconnectCause` (D38), and `ended` gains `durationMs: number | null`;
  - `ReconnectCause = 'uplink-lost' | 'video-stalled' | 'not-delivered'`, equal to plan B's `ReconnectCause.wire` values;
  - `DegradeReason` adds `not-delivered`, `camera-taken` and `mic-silenced`; `EndReason` adds `stopped-by-organiser`; `SessionEvent` is removed. Every wire member equals plan B's `.wire` string (D40);
  - `FakeScene`, and `FakeCaptureEngine = port & {scene, forceState, patch, intents, suspend, dispose}`;
  - `IDLE_TELEMETRY`, `createFakeCaptureEngine(now?)`;
  - selectors `selectOverlayUrl`, `selectPlaybackUrl`, `selectScoreUpdates`, `selectLabel` and `selectWarmingDeadlineMs`, all reading the descriptor;
  - `selectEngineStatus`, which maps `stopped-by-organiser` to `stopped` (D10);
  - the fixture `streamSession()`.

- [ ] **Step 1: Write the session fixture**

`test/fixtures/session.ts`:

```ts
import { parseCaptureQr } from '@/domain/credentials/parseCaptureQr';
import { parseDescriptor } from '@/domain/credentials/parseDescriptor';
import { buildStreamSession, type StreamSession } from '@/domain/credentials/StreamSession';
import { captureWire, descriptorWire } from './wire';

/** A made-up armed session: the v2 fixture joined to the descriptor fixture. */
export function streamSession(descriptor: Record<string, unknown> = {}): StreamSession {
  const code = parseCaptureQr(captureWire());
  const parsed = parseDescriptor(descriptorWire(descriptor));
  if (!code.ok || !parsed.ok) throw new Error('fixtures must parse');
  return buildStreamSession(code.value, parsed.value);
}
```

- [ ] **Step 2: Write the failing fake-engine tests**

Replace `modules/capture-engine/src/FakeCaptureEngine.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import {
  createFakeCaptureEngine,
  type FakeCaptureEngine,
  type FakeScene,
} from './FakeCaptureEngine';
import { streamSession } from '../../../test/fixtures/session';

const NOW = Date.parse('2026-10-03T13:00:00Z');
const session = streamSession();
const heartbeat = { url: session.descriptor.heartbeatUrl, token: session.token };

let clock = NOW;
let engine: FakeCaptureEngine;

beforeEach(() => {
  vi.useFakeTimers();
  clock = NOW;
  engine = createFakeCaptureEngine(() => clock);
});
afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

const state = () => engine.getSnapshot().state;

describe('the fake engine (spec §2: scripted snapshots, no state machine of its own)', () => {
  it('starts idle, knowing no session', () => {
    expect(state()).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().descriptor).toBeNull();
  });

  it('arms with the session’s descriptor and a ready pre-flight', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    expect(state()).toEqual({ kind: 'armed' });
    expect(engine.getSnapshot().descriptor).toBe(session.descriptor);
    const { cameraReady, networkReachable, audioLevel } = engine.getSnapshot().telemetry;
    expect({ cameraReady, networkReachable, floor: audioLevel >= AUDIO_FLOOR }).toEqual({
      cameraReady: true,
      networkReachable: true,
      floor: true,
    });
  });

  it('never reports a secret back up (D8)', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    const reported = JSON.stringify(engine.getSnapshot());
    for (const secret of ['fake-token-', 'fake-pass-', 'fake-key-']) {
      expect(reported).not.toContain(secret);
    }
  });

  it('connects on start, then publishes a second later on the primary transport', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'connecting', transport: 'srt' });
    clock += 1000;
    vi.advanceTimersByTime(1000);
    expect(state()).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW + 1000 });
  });

  it('ignores start unless armed, and a second start while connecting', () => {
    engine.send({ kind: 'start' });
    expect(state()).toEqual({ kind: 'idle' });
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'start' });
    engine.send({ kind: 'start' });
    vi.advanceTimersByTime(5000);
    expect(state().kind).toBe('publishing');
  });

  it('stops with the time on air, and ignores a stop with nothing running', () => {
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'idle' });
    engine.scene('live');
    engine.send({ kind: 'stop' });
    expect(state()).toEqual({ kind: 'ended', reason: 'operator-stopped', durationMs: 754_000 });
  });

  it('resets to idle and forgets the descriptor', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'reset' });
    expect(state()).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().descriptor).toBeNull();
  });

  it('keeps every intent it was sent, in order', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'switchCamera' });
    expect(engine.intents.map((intent) => intent.kind)).toEqual(['arm', 'switchCamera']);
  });

  it('reports at least once a second, and stops when suspended', () => {
    const first = engine.getSnapshot().reportedAtMs;
    clock += 1000;
    vi.advanceTimersByTime(1000);
    expect(engine.getSnapshot().reportedAtMs).toBe(first + 1000);
    engine.suspend();
    clock += 5000;
    vi.advanceTimersByTime(5000);
    expect(engine.getSnapshot().reportedAtMs).toBe(first + 1000);
  });
});

describe('scenes: every state spec §6 lists', () => {
  it.each<[FakeScene, object]>([
    ['armed-not-ready', { kind: 'armed' }],
    ['armed-ready', { kind: 'armed' }],
    ['connecting', { kind: 'connecting', transport: 'srt' }],
    ['live', { kind: 'publishing', transport: 'srt' }],
    ['fell-back', { kind: 'degraded', transport: 'rtmps', reason: 'fell-back-to-rtmps' }],
    [
      'holding',
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 38,
        holdWindowSeconds: 183,
      },
    ],
    ['stalled', { kind: 'reconnecting', cause: 'video-stalled', holdRemainingSeconds: 38 }],
    ['restarting', { kind: 'reconnecting', cause: 'not-delivered', holdRemainingSeconds: 38 }],
    ['not-delivered', { kind: 'degraded', reason: 'not-delivered' }],
    ['camera-taken', { kind: 'degraded', reason: 'camera-taken' }],
    ['mic-silenced', { kind: 'degraded', reason: 'mic-silenced' }],
    ['stopped', { kind: 'ended', reason: 'operator-stopped', durationMs: 754_000 }],
    [
      'stopped-by-organiser',
      { kind: 'ended', reason: 'stopped-by-organiser', durationMs: 754_000 },
    ],
    ['fatal', { kind: 'ended', reason: 'fatal-error' }],
    ['shed', { kind: 'publishing' }],
  ])('%s', (scene, expected) => {
    engine.scene(scene);
    expect(state()).toMatchObject(expected);
  });

  it('puts armed-not-ready below the audio floor, and shed on the first ladder step', () => {
    engine.scene('armed-not-ready');
    expect(engine.getSnapshot().telemetry.audioLevel).toBeLessThan(AUDIO_FLOOR);
    engine.scene('shed');
    expect(engine.getSnapshot().telemetry.shed).toBe('overlay-preview');
  });

  it('keeps the descriptor across scenes', () => {
    engine.send({ kind: 'arm', session, heartbeat });
    engine.scene('live');
    expect(engine.getSnapshot().descriptor).toBe(session.descriptor);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run modules/capture-engine`
Expected: FAIL. The intent shape and `scene` do not exist yet.

- [ ] **Step 4: Reshape the state types and the port**

In `src/domain/session/SessionState.ts`:

- delete `SessionEvent` and its comment;
- rewrite the header comment's last paragraph to say that the Kotlin `SessionMachine` is the authority and this is its report;
- change the members:

```ts
  /** Uplink gone. The front door is holding the input for the rest of the window. */
  | {
      readonly kind: 'reconnecting';
      /** Which of plan B's three triggers is being ridden out; the status line names it (D38). */
      readonly cause: ReconnectCause;
      readonly holdRemainingSeconds: number;
      readonly holdWindowSeconds: number;
      readonly sinceEpochMs: number;
    }
  /** `durationMs` is time on air, or null when the session never went live. */
  | { readonly kind: 'ended'; readonly reason: EndReason; readonly durationMs: number | null };
```

```ts
/**
 * Why a live session is reconnecting, as plan B's `ReconnectCause.wire`:
 * the uplink dropped, the video stopped advancing (F-P5-6), or viewers stopped
 * receiving and native is forcing a new session (F-P5-13).
 */
export type ReconnectCause = 'uplink-lost' | 'video-stalled' | 'not-delivered';

/**
 * Native sends one reason, the most important of plan B's ordered list (D39).
 * `audio-below-floor` is TypeScript-only and never on the wire: the level
 * floor is a display rule here (spec §2, "audioFloor stays"), not native's.
 */
export type DegradeReason =
  | 'fell-back-to-rtmps'
  | 'poor-uplink'
  | 'audio-below-floor'
  /** DeliveryWatch: viewers are not receiving, and native is forcing a new session (F-P5-13). */
  | 'not-delivered'
  /** Another app holds the camera; a phone-made slate is on air (spec decision 7). */
  | 'camera-taken'
  /** A call silenced the microphone (F-P5-8). */
  | 'mic-silenced';

export type EndReason =
  | 'operator-stopped'
  /** A 410 on reconnect, a heartbeat saying the session is over, or refused ingest (spec §1). */
  | 'stopped-by-organiser'
  | 'hold-window-expired'
  | 'fatal-error';
```

Delete `src/domain/session/projectEvent.ts` and its test (`git rm`). In `src/domain/credentials/StreamCredentials.ts`, delete `SessionCredentials` and its comment block.

Replace the types in `modules/capture-engine/src/CaptureEnginePort.ts`, keeping the file's existing comments on intents, the heartbeat contract, `reportedAtMs` and `survivesBackground`:

```ts
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { StreamSession } from '@/domain/credentials/StreamSession';
import type { SessionState, ShedStep } from '@/domain/session/SessionState';

/** Where native posts the heartbeat from its foreground service (spec decisions 5 and 6). */
export type HeartbeatTarget = { readonly url: string; readonly token: string };

export type EngineIntent =
  | { readonly kind: 'arm'; readonly session: StreamSession; readonly heartbeat: HeartbeatTarget }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  /** Clear a finished session so the next fixture can be scanned. */
  | { readonly kind: 'reset' }
  | { readonly kind: 'switchCamera' };

export type EngineSnapshot = {
  readonly state: SessionState;
  readonly telemetry: Telemetry;
  /**
   * What the session was armed with, secrets left behind (D8): the UI needs
   * the overlay and playback URLs, the label and the warming deadline, and
   * never the token, passphrase or stream key.
   */
  readonly descriptor: SessionDescriptor | null;
  readonly reportedAtMs: number;
  readonly survivesBackground: boolean;
};

export type Delivery = 'ok' | 'stalled' | 'unknown';
/** Android's PowerManager thermal status names. */
export type ThermalStatus =
  'none' | 'light' | 'moderate' | 'severe' | 'critical' | 'emergency' | 'shutdown';
/** SRT's own counters, cumulative since the attempt connected: plan B's `SrtTelemetry`. */
export type SrtStats = {
  readonly sent: number;
  readonly retransmitted: number;
  readonly dropped: number;
  readonly rttMs: number | null;
};
/** Counted and dropped, never blocking (ruling 5). Diagnostics shows it; nothing else reads it. */
export type HeartbeatStatus = {
  readonly lastSentAtEpochMs: number | null;
  /** `session-over` is the server saying the organiser ended it; native turns that into `ended`. */
  readonly lastResult: 'ok' | 'failed' | 'session-over' | null;
  readonly consecutiveFailures: number;
  readonly failures: number;
};

/**
 * Names match plan B's `Snapshot` where the core reports the value (D40):
 * `bitrateKbps`, `targetBitrateKbps`, `encodedVideoFps`, `audioPacketsPerSecond`,
 * `srt`, `delivery`, `deliveredLagMs`, `dataUsedBytes`, `charging`,
 * `heartbeat`, `shed`. The device fields are plan B's `DeviceSample`
 * flattened, with the thermal int named. `audioLevel`, `cameraReady`,
 * `networkReachable`, `deliveryCheckedAtMs` and `captureTimestampMs` are
 * platform facts plan C's bridge adds.
 */
export type Telemetry = {
  /** Measured egress: what actually left the phone. Null before the first measurement. */
  readonly bitrateKbps: number | null;
  /** The regulator's video target. */
  readonly targetBitrateKbps: number | null;
  /** Peak audio level, 0-1. Nothing downstream normalises, so this is load-bearing. */
  readonly audioLevel: number;
  /** Pre-flight (spec §1): the camera is producing frames. */
  readonly cameraReady: boolean;
  /** Pre-flight: a validated network, not merely a connected one. */
  readonly networkReachable: boolean;
  /** F-P5-4: encoded video frames and audio packets per second. Null until measured. */
  readonly encodedVideoFps: number | null;
  readonly audioPacketsPerSecond: number | null;
  /** Null while on RTMPS or before connecting. */
  readonly srt: SrtStats | null;
  readonly delivery: Delivery;
  readonly deliveredLagMs: number | null;
  readonly deliveryCheckedAtMs: number | null;
  readonly dataUsedBytes: number;
  readonly charging: boolean | null;
  readonly batteryPercent: number | null;
  /** From the charge counter: P5 found the percentage unreliable for drain. */
  readonly drainPctPerHour: number | null;
  readonly thermalStatus: ThermalStatus | null;
  /** Android API 30+; −1 below it; null when unknown. */
  readonly thermalHeadroom: number | null;
  /** M2: NTP-synced, reported even single-camera. */
  readonly captureTimestampMs: number | null;
  /** How far down the degradation ladder the device is (AGENTS §8). A device condition, not a state. */
  readonly shed: ShedStep | null;
  readonly heartbeat: HeartbeatStatus;
};
```

Keep the `CaptureEnginePort` interface as it is.

- [ ] **Step 5: Rewrite the fake**

`modules/capture-engine/src/FakeCaptureEngine.ts`:

```ts
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { Transport } from '@/domain/credentials/StreamCredentials';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type {
  CaptureEnginePort,
  EngineIntent,
  EngineSnapshot,
  Telemetry,
} from './CaptureEnginePort';

/**
 * The fake is built first, on purpose (AGENTS §10), and it holds no state
 * machine (spec §2, "One authority"): it plays named snapshots. Intents move
 * it only the few steps a laptop needs — arm, start, stop, reset — and every
 * other state is one `scene()` away.
 */
export type FakeScene =
  | 'armed-not-ready'
  | 'armed-ready'
  | 'connecting'
  | 'live'
  | 'fell-back'
  | 'holding'
  | 'stalled'
  | 'restarting'
  | 'not-delivered'
  | 'camera-taken'
  | 'mic-silenced'
  | 'stopped'
  | 'stopped-by-organiser'
  | 'fatal'
  | 'shed';

export const FAKE_SCENES: readonly FakeScene[] = [
  'armed-not-ready',
  'armed-ready',
  'connecting',
  'live',
  'fell-back',
  'holding',
  'stalled',
  'restarting',
  'not-delivered',
  'camera-taken',
  'mic-silenced',
  'stopped',
  'stopped-by-organiser',
  'fatal',
  'shed',
];

export type FakeCaptureEngine = CaptureEnginePort & {
  /** Jump to a named state from spec §6's list, with telemetry to match. */
  scene(name: FakeScene): void;
  /** Jump to any state; telemetry follows its kind. */
  forceState(state: SessionState): void;
  /** Change telemetry alone, as the next 1 Hz report would. */
  patch(telemetry: Partial<Telemetry>): void;
  /** Every intent received, in order. */
  readonly intents: readonly EngineIntent[];
  /** Stop reporting: what a suspended process looks like from JS. */
  suspend(): void;
  /** Stop every timer. Always call this in test teardown. */
  dispose(): void;
};

/** 12:34 on air: the elapsed clock shows every kind of digit. */
const ON_AIR_MS = 754_000;
const CONNECT_MS = 1000;
const REPORT_MS = 1000;

export const IDLE_TELEMETRY: Telemetry = {
  bitrateKbps: null,
  targetBitrateKbps: null,
  audioLevel: 0,
  cameraReady: false,
  networkReachable: false,
  encodedVideoFps: null,
  audioPacketsPerSecond: null,
  srt: null,
  delivery: 'unknown',
  deliveredLagMs: null,
  deliveryCheckedAtMs: null,
  dataUsedBytes: 0,
  charging: null,
  batteryPercent: null,
  drainPctPerHour: null,
  thermalStatus: null,
  thermalHeadroom: null,
  captureTimestampMs: null,
  shed: null,
  heartbeat: { lastSentAtEpochMs: null, lastResult: null, consecutiveFailures: 0, failures: 0 },
};

/** Camera up, sound above the floor, network validated: every chip green. */
const ARMED: Telemetry = {
  ...IDLE_TELEMETRY,
  audioLevel: 0.42,
  cameraReady: true,
  networkReachable: true,
  encodedVideoFps: 30,
  audioPacketsPerSecond: 47,
  charging: false,
  batteryPercent: 74,
  thermalStatus: 'none',
  thermalHeadroom: 0.68,
};

/** Fixed numbers, so UI tests can assert them; four- and five-digit values exercise tabular figures. */
function onAir(now: number): Telemetry {
  return {
    ...ARMED,
    bitrateKbps: 2840,
    targetBitrateKbps: 3000,
    srt: { sent: 120_000, retransmitted: 240, dropped: 3, rttMs: 48 },
    delivery: 'ok',
    deliveredLagMs: 9200,
    deliveryCheckedAtMs: now - 1500,
    dataUsedBytes: 312_000_000,
    drainPctPerHour: 18,
    captureTimestampMs: now,
    heartbeat: {
      lastSentAtEpochMs: now - 4000,
      lastResult: 'ok',
      consecutiveFailures: 0,
      failures: 0,
    },
  };
}

type Scene = { readonly state: SessionState; readonly telemetry: Telemetry };

const publishing = (transport: Transport, since: number): SessionState => ({
  kind: 'publishing',
  transport,
  sinceEpochMs: since,
});
const degraded = (transport: Transport, reason: DegradeReason, since: number): SessionState => ({
  kind: 'degraded',
  transport,
  reason,
  sinceEpochMs: since,
});
const reconnecting = (cause: ReconnectCause, since: number): SessionState => ({
  kind: 'reconnecting',
  cause,
  holdRemainingSeconds: 38,
  holdWindowSeconds: 183,
  sinceEpochMs: since,
});
const ended = (reason: EndReason, durationMs: number | null): SessionState => ({
  kind: 'ended',
  reason,
  durationMs,
});

/** Spec §6's states. A table, exempt from the line count (AGENTS §12). */
function sceneOf(name: FakeScene, now: number): Scene {
  const since = now - ON_AIR_MS;
  const live = onAir(now);
  switch (name) {
    case 'armed-not-ready':
      return { state: { kind: 'armed' }, telemetry: { ...ARMED, audioLevel: 0.01 } };
    case 'armed-ready':
      return { state: { kind: 'armed' }, telemetry: ARMED };
    case 'connecting':
      return { state: { kind: 'connecting', transport: 'srt' }, telemetry: ARMED };
    case 'live':
      return { state: publishing('srt', since), telemetry: live };
    case 'fell-back':
      return {
        state: degraded('rtmps', 'fell-back-to-rtmps', since),
        telemetry: { ...live, srt: null },
      };
    case 'holding':
      return {
        state: reconnecting('uplink-lost', since),
        telemetry: { ...live, bitrateKbps: 0, delivery: 'unknown' },
      };
    case 'stalled':
      return {
        state: reconnecting('video-stalled', since),
        telemetry: { ...live, encodedVideoFps: 0 },
      };
    case 'restarting':
      return {
        state: reconnecting('not-delivered', since),
        telemetry: { ...live, delivery: 'stalled', deliveredLagMs: 21_000 },
      };
    case 'not-delivered':
      return {
        state: degraded('srt', 'not-delivered', since),
        telemetry: { ...live, delivery: 'stalled', deliveredLagMs: 21_000 },
      };
    case 'camera-taken':
      return {
        state: degraded('srt', 'camera-taken', since),
        telemetry: { ...live, cameraReady: false },
      };
    case 'mic-silenced':
      return {
        state: degraded('srt', 'mic-silenced', since),
        telemetry: { ...live, audioLevel: 0 },
      };
    case 'stopped':
      return { state: ended('operator-stopped', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'stopped-by-organiser':
      return { state: ended('stopped-by-organiser', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'fatal':
      return { state: ended('fatal-error', ON_AIR_MS), telemetry: IDLE_TELEMETRY };
    case 'shed':
      return {
        state: publishing('srt', since),
        telemetry: {
          ...live,
          shed: 'overlay-preview',
          thermalStatus: 'severe',
          thermalHeadroom: 0.12,
        },
      };
  }
}

function telemetryFor(state: SessionState, now: number): Telemetry {
  switch (state.kind) {
    case 'idle':
    case 'ended':
      return IDLE_TELEMETRY;
    case 'armed':
    case 'connecting':
      return ARMED;
    default:
      return onAir(now);
  }
}

const sinceOf = (state: SessionState): number | null =>
  'sinceEpochMs' in state ? state.sinceEpochMs : null;

export function createFakeCaptureEngine(now: () => number = Date.now): FakeCaptureEngine {
  let snapshot: EngineSnapshot = {
    state: { kind: 'idle' },
    telemetry: IDLE_TELEMETRY,
    descriptor: null,
    reportedAtMs: now(),
    survivesBackground: false,
  };
  let primary: Transport = 'srt';
  const intents: EngineIntent[] = [];
  const listeners = new Set<() => void>();
  let connect: ReturnType<typeof setTimeout> | null = null;
  let report: ReturnType<typeof setInterval> | null = null;

  const publish = (next: Partial<EngineSnapshot>): void => {
    snapshot = { ...snapshot, ...next, reportedAtMs: now() };
    for (const listener of listeners) listener();
  };
  const show = (state: SessionState, telemetry: Telemetry = telemetryFor(state, now())) =>
    publish({ state, telemetry });
  const cancelConnect = (): void => {
    if (connect !== null) clearTimeout(connect);
    connect = null;
  };

  const arm = (descriptor: SessionDescriptor, transport: Transport): void => {
    if (snapshot.state.kind !== 'idle') return;
    primary = transport;
    publish({ state: { kind: 'armed' }, telemetry: ARMED, descriptor });
  };
  const start = (): void => {
    if (snapshot.state.kind !== 'armed') return;
    show({ kind: 'connecting', transport: primary });
    connect = setTimeout(() => {
      connect = null;
      show(publishing(primary, now()));
    }, CONNECT_MS);
  };
  const stop = (): void => {
    const { kind } = snapshot.state;
    if (kind === 'idle' || kind === 'ended') return;
    cancelConnect();
    const since = sinceOf(snapshot.state);
    show(ended('operator-stopped', since === null ? null : now() - since));
  };
  const reset = (): void => {
    cancelConnect();
    publish({ state: { kind: 'idle' }, telemetry: IDLE_TELEMETRY, descriptor: null });
  };

  const send = (intent: EngineIntent): void => {
    intents.push(intent);
    switch (intent.kind) {
      case 'arm':
        return arm(intent.session.descriptor, intent.session.primary.transport);
      case 'start':
        return start();
      case 'stop':
        return stop();
      case 'reset':
        return reset();
      case 'switchCamera':
        return;
    }
  };

  const stopReporting = (): void => {
    if (report !== null) clearInterval(report);
    report = null;
  };
  // The heartbeat contract: a report at least once a second, changed or not.
  report = setInterval(() => publish({}), REPORT_MS);

  return {
    send,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,
    intents,
    scene: (name) => {
      cancelConnect();
      const { state, telemetry } = sceneOf(name, now());
      show(state, telemetry);
    },
    forceState: (state) => {
      cancelConnect();
      show(state);
    },
    patch: (telemetry) => publish({ telemetry: { ...snapshot.telemetry, ...telemetry } }),
    suspend: stopReporting,
    dispose: () => {
      cancelConnect();
      stopReporting();
    },
  };
}
```

- [ ] **Step 6: Update the selectors**

In `src/hooks/engineSelectors.ts`:

- `selectEngineStatus`, `ended` branch: `return state.reason === 'operator-stopped' || state.reason === 'stopped-by-organiser' ? 'stopped' : 'failed';`, with the comment `// D10: an organiser stop spends the code, exactly as the operator's does.`
- Delete `selectRttMs`, `selectDroppedFrames`, `selectInterruption` and `selectHoldWindowSeconds`, plus `STATUS_LINE_BUDGET`, `selectStatusLine`, `interruptionNote`, `degradedLine`, `endedLine` and `transportName`. Task 12 replaces the status line with keys.
- Replace the three credential selectors and add two:

```ts
export const selectOverlayUrl = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.overlayUrl ?? null;
export const selectPlaybackUrl = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.playbackUrl ?? null;
export const selectScoreUpdates = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.scoreUpdates ?? null;
export const selectLabel = (snapshot: EngineSnapshot) => snapshot.descriptor?.label ?? null;
/** A number, not the Date: `useEngineSelector` compares by identity. */
export const selectWarmingDeadlineMs = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.warmingDeadline.getTime() ?? null;
```

In `src/hooks/engineSelectors.test.ts`:

- delete `describe('selectStatusLine', …)`;
- add `durationMs: null` to every `ended` literal;
- add `cause: 'uplink-lost'` and `holdWindowSeconds: 183` where a reconnecting literal is built;
- build its snapshots from `IDLE_TELEMETRY` and `descriptor: null`;
- add a row to the `selectEngineStatus` table:

```ts
    [{ kind: 'ended', reason: 'stopped-by-organiser', durationMs: 1 }, 'stopped'],
```

In `src/ui/components/DevEngineControls.tsx`, add `durationMs: null` to its two `ended` literals. In the tests listed under **Files**, add `durationMs: null` to each `ended` literal.

- [ ] **Step 7: Run everything**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS. If typecheck lists a file that is not under **Files**, it held a reference this plan missed. Fix it the same way and name it in the batch report.

Then: `rg -n "projectEvent|SessionEvent|SessionCredentials|interruption|droppedFrames|batteryLevel|selectStatusLine" src app modules test` should print nothing.

- [ ] **Step 8: Commit**

```bash
git add modules/capture-engine/src src/domain/session/SessionState.ts src/domain/credentials/StreamCredentials.ts src/hooks/engineSelectors.ts src/hooks/engineSelectors.test.ts src/ui/components/DevEngineControls.tsx test/fixtures/session.ts src/hooks/useOrientationGate.test.tsx src/hooks/useReopenGate.test.tsx src/ui/screens/HomeScreen.test.tsx src/hooks/useStreamLeave.test.tsx
git rm src/domain/session/projectEvent.ts src/domain/session/projectEvent.test.ts
git commit -F - <<'EOF'
feat(engine): S1 engine port and a fake that plays scenes

arm({session, heartbeat}); the snapshot carries the descriptor, not the
credentials (D8), and the S1 telemetry (D9). projectEvent leaves the
domain: native is the one authority (spec §2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second start while connecting is tested, as is stop with nothing running; (2) a start with no arm is tested; (3) suspend and reset are tested; (4) not applicable.

---

### Task 12: The status line as an i18n key, in four languages

Spec §4: "`selectStatusLine` is rewritten to return dictionary keys". The examples are spec §4's list, the failure table is spec §5, and D13 applies. Copy stays within S0's 48-character budget in every language.

**Files:**

- Create: `src/hooks/statusKey.ts`, `src/hooks/statusKey.test.ts`
- Create: `src/i18n/budgets.test.ts`
- Modify: `src/i18n/en.json`, `es.json`, `fr.json`, `nl.json`

**Interfaces:**

- Consumes: `EngineSnapshot`, `Telemetry`, `AUDIO_FLOOR`, `MessageKey`.
- Produces:
  - `StatusKey` (the `stream.status.*` keys) and `STATUS_LINE_BUDGET = 48`;
  - `selectStatusKey(snapshot): StatusKey`, which never reads the heartbeat;
  - `viewfinderStatusKey(engineKey, {kind, unusable, codeTimedOut}): StatusKey`;
  - `selectHoldRemaining` and `selectHoldWindow`.

- [ ] **Step 1: Add the keys (4 languages)**

| key                                 | en                                                            | es                                                           | fr                                                      | nl                                                            |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------- |
| `stream.status.starting`            | Starting the camera…                                          | Encendiendo la cámara…                                       | Démarrage de la caméra…                                 | Camera wordt gestart…                                         |
| `stream.status.noCamera`            | Camera not ready yet.                                         | La cámara aún no está lista.                                 | La caméra n'est pas prête.                              | Camera is nog niet klaar.                                     |
| `stream.status.noNetwork`           | No network. Check the signal.                                 | Sin red. Revisa la señal.                                    | Pas de réseau. Vérifiez le signal.                      | Geen netwerk. Controleer het signaal.                         |
| `stream.status.noSound`             | No sound. Check the mic before going live.                    | Sin sonido. Revisa el micro antes de emitir.                 | Pas de son. Vérifiez le micro avant le direct.          | Geen geluid. Controleer de microfoon.                         |
| `stream.status.ready`               | Ready. Hold Go live for 3 seconds.                            | Listo. Mantén Emitir 3 segundos.                             | Prêt. Maintenez le bouton 3 secondes.                   | Klaar. Houd Live gaan 3 seconden vast.                        |
| `stream.status.codeTimedOut`        | Code timed out — ask the organiser for a new one              | Código caducado: pide otro al organizador                    | Code expiré : demandez-en un autre                      | Code verlopen: vraag de organisator een nieuwe                |
| `stream.status.unusable`            | This code can't be used. Go Home and scan again.              | Este código no sirve. Ve a Inicio y escanea.                 | Code inutilisable. Retour à l'accueil.                  | Deze code werkt niet. Ga naar Home en scan.                   |
| `stream.status.connecting`          | Opening the link.                                             | Abriendo la conexión.                                        | Ouverture de la liaison.                                | Verbinding wordt geopend.                                     |
| `stream.status.live`                | Live. Sound and picture going out.                            | En directo. Sale imagen y sonido.                            | En direct. Image et son diffusés.                       | Live. Beeld en geluid gaan uit.                               |
| `stream.status.fellBack`            | Switched to backup link (RTMPS)                               | Cambiado al enlace de reserva (RTMPS)                        | Passé sur la liaison de secours (RTMPS)                 | Overgeschakeld op reserveverbinding (RTMPS)                   |
| `stream.status.weakSignal`          | Weak signal. Still live.                                      | Señal débil. Sigue en directo.                               | Signal faible. Toujours en direct.                      | Zwak signaal. Nog steeds live.                                |
| `stream.status.liveNoSound`         | Live with no sound. Check the mic now.                        | En directo sin sonido. Revisa el micro.                      | En direct sans son. Vérifiez le micro.                  | Live zonder geluid. Controleer de microfoon.                  |
| `stream.status.notDelivered`        | Viewers not receiving — restarting                            | No llega a los espectadores: reiniciando                     | Rien ne parvient au public : relance                    | Kijkers ontvangen niets: herstarten                           |
| `stream.status.cameraTaken`         | Camera taken by another app — slate on air                    | Otra app usa la cámara: se emite una placa                   | Caméra prise par une app : carton à l'antenne           | Camera bezet door een app: kaart in beeld                     |
| `stream.status.micSilenced`         | Mic silenced by a call                                        | Micro silenciado por una llamada                             | Micro coupé par un appel                                | Microfoon gedempt door een oproep                             |
| `stream.status.holding`             | Uplink lost — holding, {remaining} s of {window}              | Sin conexión: esperando, {remaining} s de {window}           | Liaison perdue : attente, {remaining} s sur {window}    | Verbinding weg: wachten, {remaining} s van {window}           |
| `stream.status.holdingStalled`      | Video stalled — restarting, {remaining} s of {window}         | Vídeo detenido: reiniciando, {remaining} s de {window}       | Vidéo figée : redémarrage, {remaining} s sur {window}   | Video staat stil: herstart, {remaining} s van {window}        |
| `stream.status.holdingNotDelivered` | Viewers not receiving — restarting, {remaining} s of {window} | El público no recibe: reiniciando, {remaining} s de {window} | Public sans image : relance, {remaining} s sur {window} | Kijkers ontvangen niets: herstart, {remaining} s van {window} |
| `stream.status.endedOperator`       | You stopped the broadcast.                                    | Has detenido la emisión.                                     | Vous avez arrêté la diffusion.                          | Je hebt de uitzending gestopt.                                |
| `stream.status.endedOrganiser`      | Stopped by the organiser                                      | Detenida por el organizador                                  | Arrêté par l'organisateur                               | Gestopt door de organisator                                   |
| `stream.status.endedHoldExpired`    | The connection was lost for too long.                         | La conexión se perdió demasiado tiempo.                      | La liaison a été perdue trop longtemps.                 | De verbinding was te lang weg.                                |
| `stream.status.endedFatal`          | Something failed. Your code is kept.                          | Algo falló. Tu código se conserva.                           | Un échec est survenu. Code conservé.                    | Er ging iets mis. Je code blijft bewaard.                     |

- [ ] **Step 2: Write the failing tests**

`src/i18n/budgets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

/**
 * Copy budgets for the HUD column (S0 R-budget; spec §6 "the longest one on
 * the HUD column"). A `numberOfLines` truncation throws no error, so the
 * budget is enforced here, in every language, with the widest values filled in.
 * Later tasks add rows.
 */
const BUDGETS: readonly (readonly [keys: RegExp, max: number])[] = [[/^stream\.status\./, 48]];

const WIDEST: Readonly<Record<string, string>> = {
  remaining: '183',
  window: '183',
  time: '14:32 CEST',
  duration: '10:00:00',
};

const fill = (text: string) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => WIDEST[name] ?? whole);

describe.each([
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const)('%s copy budgets', (_lang, dictionary: Readonly<Record<string, string>>) => {
  it.each(BUDGETS)('every %s key fits in %i characters', (pattern, max) => {
    const keys = Object.keys(dictionary).filter((key) => pattern.test(key));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const text = fill(dictionary[key] ?? '');
      expect({ key, text, fits: text.length <= max }).toEqual({ key, text, fits: true });
    }
  });
});
```

`src/hooks/statusKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import { selectStatusKey, viewfinderStatusKey } from '@/hooks/statusKey';
import { createTranslator } from '@/i18n/translate';

const ARMED_OK: Partial<Telemetry> = { cameraReady: true, networkReachable: true, audioLevel: 0.4 };
const snap = (state: SessionState, telemetry: Partial<Telemetry> = ARMED_OK): EngineSnapshot => ({
  state,
  telemetry: { ...IDLE_TELEMETRY, ...telemetry },
  descriptor: null,
  reportedAtMs: 0,
  survivesBackground: true,
});
const { t } = createTranslator('en');
const line = (s: EngineSnapshot) => t(selectStatusKey(s), { remaining: 38, window: 183 });
const since = 1;

describe('the status line (spec §4 and §5)', () => {
  it.each<[string, SessionState, string]>([
    [
      'holding',
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 38,
        holdWindowSeconds: 183,
        sinceEpochMs: since,
      },
      'Uplink lost — holding, 38 s of 183',
    ],
    [
      'the video stalled',
      {
        kind: 'reconnecting',
        cause: 'video-stalled',
        holdRemainingSeconds: 38,
        holdWindowSeconds: 183,
        sinceEpochMs: since,
      },
      'Video stalled — restarting, 38 s of 183',
    ],
    [
      'restarting for viewers',
      {
        kind: 'reconnecting',
        cause: 'not-delivered',
        holdRemainingSeconds: 38,
        holdWindowSeconds: 183,
        sinceEpochMs: since,
      },
      'Viewers not receiving — restarting, 38 s of 183',
    ],
    [
      'fell back',
      { kind: 'degraded', transport: 'rtmps', reason: 'fell-back-to-rtmps', sinceEpochMs: since },
      'Switched to backup link (RTMPS)',
    ],
    [
      'not delivered',
      { kind: 'degraded', transport: 'srt', reason: 'not-delivered', sinceEpochMs: since },
      'Viewers not receiving — restarting',
    ],
    [
      'camera taken',
      { kind: 'degraded', transport: 'srt', reason: 'camera-taken', sinceEpochMs: since },
      'Camera taken by another app — slate on air',
    ],
    [
      'mic silenced',
      { kind: 'degraded', transport: 'srt', reason: 'mic-silenced', sinceEpochMs: since },
      'Mic silenced by a call',
    ],
    [
      'organiser stop',
      { kind: 'ended', reason: 'stopped-by-organiser', durationMs: 1 },
      'Stopped by the organiser',
    ],
  ])('says the spec’s sentence when %s', (_name, state, sentence) => {
    expect(line(snap(state))).toBe(sentence);
  });

  it.each<[string, Partial<Telemetry>, string]>([
    ['no camera', { ...ARMED_OK, cameraReady: false }, 'stream.status.noCamera'],
    ['no network', { ...ARMED_OK, networkReachable: false }, 'stream.status.noNetwork'],
    ['no sound', { ...ARMED_OK, audioLevel: 0.049 }, 'stream.status.noSound'],
    ['sound exactly at the floor', { ...ARMED_OK, audioLevel: 0.05 }, 'stream.status.ready'],
  ])('names the first pre-flight problem when armed: %s', (_name, telemetry, key) => {
    expect(selectStatusKey(snap({ kind: 'armed' }, telemetry))).toBe(key);
  });

  it('says live with no sound when the level is under the floor on air (a display rule, D39)', () => {
    const live: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: since };
    expect(line(snap(live, { ...ARMED_OK, audioLevel: 0.01 }))).toBe(
      'Live with no sound. Check the mic now.',
    );
    expect(line(snap(live))).toBe('Live. Sound and picture going out.');
  });

  it('never lets a failing heartbeat change what it says (ruling 5)', () => {
    const heartbeat = {
      lastSentAtEpochMs: 1,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    const failing = { ...ARMED_OK, heartbeat };
    const live: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: since };
    expect(selectStatusKey(snap(live, failing))).toBe('stream.status.live');
    expect(selectStatusKey(snap({ kind: 'armed' }, failing))).toBe('stream.status.ready');
  });

  it('never mentions heat, which the top strip owns (AGENTS §8)', () => {
    const hot = { ...ARMED_OK, shed: 'overlay-preview' as const, thermalStatus: 'severe' as const };
    const live: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: since };
    expect(selectStatusKey(snap(live, hot))).toBe('stream.status.live');
  });
});

describe('viewfinderStatusKey', () => {
  it('says the code timed out once the warming deadline passes while armed (spec §5, D13)', () => {
    const key = viewfinderStatusKey('stream.status.ready', {
      kind: 'armed',
      unusable: false,
      codeTimedOut: true,
    });
    expect(t(key)).toBe('Code timed out — ask the organiser for a new one');
  });

  it('says a saved code cannot be used before and while arming', () => {
    for (const kind of ['idle', 'armed'] as const) {
      expect(
        viewfinderStatusKey('stream.status.starting', {
          kind,
          unusable: true,
          codeTimedOut: false,
        }),
      ).toBe('stream.status.unusable');
    }
  });

  it('leaves an on-air line alone, whatever the clock says', () => {
    expect(
      viewfinderStatusKey('stream.status.live', {
        kind: 'publishing',
        unusable: true,
        codeTimedOut: true,
      }),
    ).toBe('stream.status.live');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/hooks/statusKey.test.ts src/i18n`
Expected: `statusKey.test.ts` FAILS (module not found), and the budgets and dictionary tests PASS. If a budget row fails, shorten that string in its language and say so in the batch report.

- [ ] **Step 4: Implement**

`src/hooks/statusKey.ts`:

```ts
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
} from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type StatusKey = Extract<MessageKey, `stream.status.${string}`>;

/**
 * Copy budget: 48 characters (S0). The column is ~17 characters a line and
 * three lines before `StatusLine` ellipsises, silently. Enforced for every
 * language in src/i18n/budgets.test.ts.
 */
export const STATUS_LINE_BUDGET = 48;

const DEGRADED: Readonly<Record<DegradeReason, StatusKey>> = {
  'fell-back-to-rtmps': 'stream.status.fellBack',
  'poor-uplink': 'stream.status.weakSignal',
  'audio-below-floor': 'stream.status.liveNoSound',
  'not-delivered': 'stream.status.notDelivered',
  'camera-taken': 'stream.status.cameraTaken',
  'mic-silenced': 'stream.status.micSilenced',
};

/** D38: the line says which trigger is being ridden out, with the hold's countdown. */
const RECONNECTING: Readonly<Record<ReconnectCause, StatusKey>> = {
  'uplink-lost': 'stream.status.holding',
  'video-stalled': 'stream.status.holdingStalled',
  'not-delivered': 'stream.status.holdingNotDelivered',
};

const ENDED: Readonly<Record<EndReason, StatusKey>> = {
  'operator-stopped': 'stream.status.endedOperator',
  'stopped-by-organiser': 'stream.status.endedOrganiser',
  'hold-window-expired': 'stream.status.endedHoldExpired',
  'fatal-error': 'stream.status.endedFatal',
};

/**
 * The one true sentence (AGENTS §6), as a key (spec §4). Reads state and
 * pre-flight only. It never reads the heartbeat: a failing heartbeat never
 * blocks or degrades the stream (ruling 5), so it never changes what the
 * operator is told. Heat is the top strip's, never this line's (AGENTS §8).
 */
export function selectStatusKey(snapshot: EngineSnapshot): StatusKey {
  const { state, telemetry } = snapshot;
  switch (state.kind) {
    case 'idle':
      return 'stream.status.starting';
    case 'armed':
      return armedKey(telemetry);
    case 'connecting':
      return 'stream.status.connecting';
    case 'publishing':
      // D39: the level floor is a display rule, never a native reason.
      return telemetry.audioLevel < AUDIO_FLOOR
        ? 'stream.status.liveNoSound'
        : 'stream.status.live';
    case 'degraded':
      return DEGRADED[state.reason];
    case 'reconnecting':
      return RECONNECTING[state.cause];
    case 'ended':
      return ENDED[state.reason];
  }
}

/** The first pre-flight chip that is off, in the blocker's order after the code (Task 13). */
function armedKey(telemetry: Telemetry): StatusKey {
  if (!telemetry.cameraReady) return 'stream.status.noCamera';
  if (!telemetry.networkReachable) return 'stream.status.noNetwork';
  if (telemetry.audioLevel < AUDIO_FLOOR) return 'stream.status.noSound';
  return 'stream.status.ready';
}

/**
 * Arm-time facts the snapshot cannot know: whether the saved code is usable,
 * and whether the clock has passed the warming deadline (spec §5). They never
 * override an on-air line.
 */
export function viewfinderStatusKey(
  engineKey: StatusKey,
  input: { kind: SessionState['kind']; unusable: boolean; codeTimedOut: boolean },
): StatusKey {
  const arming = input.kind === 'idle' || input.kind === 'armed';
  if (arming && input.unusable) return 'stream.status.unusable';
  if (input.kind === 'armed' && input.codeTimedOut) return 'stream.status.codeTimedOut';
  return engineKey;
}

export const selectHoldRemaining = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdRemainingSeconds : null;
export const selectHoldWindow = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'reconnecting' ? snapshot.state.holdWindowSeconds : null;
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/hooks/statusKey.test.ts src/i18n`
Expected: PASS.

- [ ] **Step 6: Mutate "the heartbeat never blocks" once**

`cp src/hooks/statusKey.ts /private/tmp/claude-501/s1a/statusKey.bak`. Add as the first line of `selectStatusKey`: `if (snapshot.telemetry.heartbeat.failures > 3) return 'stream.status.weakSignal';`.
Run: `pnpm vitest run src/hooks/statusKey.test.ts`. Expected: FAIL ("never lets a failing heartbeat change what it says"). Restore and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/statusKey.ts src/hooks/statusKey.test.ts src/i18n/budgets.test.ts src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json
git commit -F - <<'EOF'
feat(stream): status line as i18n keys in four languages, 48-char budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable, as this is pure; (2) the audio floor's edge and each missing chip are tested; (3) the ended reasons are tested; (4) the budgets are checked in all four languages.

---

### Task 13: The warming gate, the pre-flight, and the tally plate

Spec §1: Go live "enables only when every chip is green … 'Go live by 14:32': the descriptor's `warmingDeadline`". Spec §4 sets the plate list, D14 the tally states, and spec §6 "Mutation … the LIVE gate … the warming gate".

**Files:**

- Create: `src/domain/session/warming.ts`, `src/domain/session/warming.test.ts`
- Create: `src/hooks/preflight.ts`, `src/hooks/preflight.test.ts`

**Interfaces:**

- Consumes: `SessionState`, `EngineSnapshot`, `AUDIO_FLOOR`.
- Produces:
  - `WarmingGate` and `warmingGate(deadline: Date | null, now: Date)`;
  - `Chip` and `Preflight` (a `Record<Chip, boolean>`);
  - `CHIP_ORDER` (display: camera, sound, network, code);
  - `goLiveBlocker(preflight): Chip | null`, in blocker order code, camera, network, sound;
  - `selectCameraReady`, `selectNetworkReachable`, `selectSoundReady`;
  - `TallyPlate`, `TallyTone`, `tallyPlateFor(kind, ready)`, `tallyTone(plate)`.

- [ ] **Step 1: Write the failing tests**

`src/domain/session/warming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { warmingGate } from '@/domain/session/warming';

const DEADLINE = new Date('2026-10-03T13:10:00Z');

describe('warmingGate (spec §1, the web’s 10-minute no-signal timeout)', () => {
  it('is open until the deadline', () => {
    expect(warmingGate(DEADLINE, new Date(DEADLINE.getTime() - 1))).toBe('open');
  });

  it('has passed at the deadline itself, not a millisecond later', () => {
    expect(warmingGate(DEADLINE, DEADLINE)).toBe('passed');
  });

  it('stays passed after it', () => {
    expect(warmingGate(DEADLINE, new Date(DEADLINE.getTime() + 60_000))).toBe('passed');
  });

  it('is unknown with no descriptor', () => {
    expect(warmingGate(null, DEADLINE)).toBe('unknown');
  });
});
```

`src/hooks/preflight.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import {
  goLiveBlocker,
  tallyPlateFor,
  tallyTone,
  type Preflight,
  type TallyPlate,
} from '@/hooks/preflight';

const ALL_GREEN: Preflight = { code: true, camera: true, network: true, sound: true };

describe('goLiveBlocker (spec §1: Go live only when every chip is green)', () => {
  it('lets Go live through with every chip green', () => {
    expect(goLiveBlocker(ALL_GREEN)).toBeNull();
  });

  it.each([
    [{ code: false, camera: false }, 'code'],
    [{ camera: false, sound: false }, 'camera'],
    [{ network: false, sound: false }, 'network'],
    [{ sound: false }, 'sound'],
  ] as const)('names the first chip that is off: %j → %s', (off, chip) => {
    expect(goLiveBlocker({ ...ALL_GREEN, ...off })).toBe(chip);
  });
});

describe('the tally plate (spec §4, D14)', () => {
  it.each<[SessionState['kind'], boolean, TallyPlate]>([
    ['idle', false, 'starting'],
    ['armed', false, 'notReady'],
    ['armed', true, 'ready'],
    ['connecting', true, 'connecting'],
    ['publishing', true, 'live'],
    ['degraded', true, 'trouble'],
    ['reconnecting', true, 'trouble'],
    ['ended', true, 'ended'],
  ])('%s (ready: %s) shows %s', (kind, ready, plate) => {
    expect(tallyPlateFor(kind, ready)).toBe(plate);
  });

  it('never shows LIVE while connecting: LIVE only while frames advance (F-P5-6)', () => {
    expect(tallyPlateFor('connecting', true)).not.toBe('live');
  });

  it('is red only for LIVE: red means on air (AGENTS §5)', () => {
    const plates: TallyPlate[] = [
      'starting',
      'notReady',
      'ready',
      'connecting',
      'live',
      'trouble',
      'ended',
    ];
    expect(plates.filter((plate) => tallyTone(plate) === 'live')).toEqual(['live']);
    expect(tallyTone('trouble')).toBe('degraded');
    expect(tallyTone('ready')).toBe('healthy');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/domain/session/warming.test.ts src/hooks/preflight.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/domain/session/warming.ts`:

```ts
export type WarmingGate = 'open' | 'passed' | 'unknown';

/**
 * Go live must happen before the descriptor's warming deadline — the web's
 * 10-minute no-signal timeout (spec §1). The instant itself counts as passed:
 * the server's timer has fired by then. Pure; the caller supplies the clock.
 */
export function warmingGate(deadline: Date | null, now: Date): WarmingGate {
  if (deadline === null) return 'unknown';
  return now.getTime() < deadline.getTime() ? 'open' : 'passed';
}
```

`src/hooks/preflight.ts`:

```ts
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';

export type Chip = 'code' | 'camera' | 'network' | 'sound';
export type Preflight = Readonly<Record<Chip, boolean>>;

/** Spec §1's order on screen: camera, sound, network, code. */
export const CHIP_ORDER: readonly Chip[] = ['camera', 'sound', 'network', 'code'];

/** The reason shown at the control: a dead code first, since no fix on the phone helps. */
const BLOCKER_ORDER: readonly Chip[] = ['code', 'camera', 'network', 'sound'];

export const selectCameraReady = (snapshot: EngineSnapshot) => snapshot.telemetry.cameraReady;
export const selectNetworkReachable = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.networkReachable;
/** The one floor, shared with the meter's notch (S0's audioFloor rule). */
export const selectSoundReady = (snapshot: EngineSnapshot) =>
  snapshot.telemetry.audioLevel >= AUDIO_FLOOR;

/** Go live enables only when every chip is green (spec §1; AGENTS §6: the pre-flight is the safety). */
export function goLiveBlocker(preflight: Preflight): Chip | null {
  return BLOCKER_ORDER.find((chip) => !preflight[chip]) ?? null;
}

export type TallyPlate =
  'starting' | 'notReady' | 'ready' | 'connecting' | 'live' | 'trouble' | 'ended';

export type TallyTone = 'live' | 'healthy' | 'degraded' | 'inert';

/**
 * Spec §4's state plate (D14). The LIVE gate: LIVE only while publishing —
 * connecting is native saying frames are not yet advancing (F-P5-6).
 */
export function tallyPlateFor(kind: SessionState['kind'], ready: boolean): TallyPlate {
  switch (kind) {
    case 'idle':
      return 'starting';
    case 'armed':
      return ready ? 'ready' : 'notReady';
    case 'connecting':
      return 'connecting';
    case 'publishing':
      return 'live';
    case 'degraded':
    case 'reconnecting':
      return 'trouble';
    case 'ended':
      return 'ended';
  }
}

/** The only place a plate becomes a colour. Red is LIVE and nothing else (AGENTS §5). */
export function tallyTone(plate: TallyPlate): TallyTone {
  switch (plate) {
    case 'live':
      return 'live';
    case 'ready':
      return 'healthy';
    case 'trouble':
      return 'degraded';
    default:
      return 'inert';
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/domain/session src/hooks/preflight.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutate the LIVE gate and the warming gate, once each**

1. `cp src/hooks/preflight.ts /private/tmp/claude-501/s1a/preflight.bak`. In `tallyPlateFor`, change `case 'connecting': return 'connecting';` to `case 'connecting': return 'live';`. Run `pnpm vitest run src/hooks/preflight.test.ts`. Expected: FAIL ("never shows LIVE while connecting"). Restore and re-run: PASS.
2. `cp src/domain/session/warming.ts /private/tmp/claude-501/s1a/warming.bak`. Change `<` to `<=`. Run `pnpm vitest run src/domain/session/warming.test.ts`. Expected: FAIL ("has passed at the deadline itself"). Restore and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/session/warming.ts src/domain/session/warming.test.ts src/hooks/preflight.ts src/hooks/preflight.test.ts
git commit -F - <<'EOF'
feat(stream): warming gate, pre-flight blocker and tally plate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) the no-descriptor case is `unknown`; (3) not applicable; (4) not applicable.

---

### Task 14: Phase 1 gate

**Files:** none new. This is a verification task.

**Interfaces:** Consumes everything from Tasks 1–13; produces a green phase 1.

- [ ] **Step 1: The full check, with counts**

Run: `pnpm check > /private/tmp/claude-501/s1a/check1.out 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

Run: `pnpm vitest run --reporter=json --outputFile=/private/tmp/claude-501/s1a/phase1.json > /dev/null 2>&1; node -e 'const r=require("/private/tmp/claude-501/s1a/phase1.json");console.log(r.numTotalTests,r.numFailedTests)'`
Expected: a total above S0's count and `0` failed. Report both numbers.

- [ ] **Step 2: The inert-seam check (failure class 1)**

Run: `rg -n "logger|record|descriptor|withTimeout" src/hooks/nativePorts.ts`
Expected: each is built in `createNativePorts` and returned.

Run: `rg -n "projectEvent|transportPolicy|SessionCredentials|parseSessionCredentials|interruption|selectStatusLine" src app modules test`
Expected: no output.

- [ ] **Step 3: Record the phase 1 mutations**

Put the mutation table in the batch report: the guard, the file, the test that failed, and the restored PASS. The guards are the scrub (Task 1), the KV timeout (2), the M2 re-check and the leave rule (4), the sid guard (8), the scan flight (10), the heartbeat-never-blocks line (12), and the LIVE and warming gates (13).

- [ ] **Step 4: Commit only if the gate needed a fix**

If Steps 1–2 needed a change, commit it as `fix: phase 1 gate — <what>`, ending with the Co-Authored-By line. Otherwise there is nothing to commit.

---

## Phase 2 — Screens against the fake

### Task 15: New dependencies, the autolink check, and the surfaces port

Spec §4: "New dependencies are `react-native-webview` and `expo-video`. For each one, check what autolinks and pin it (failure class 4)." D16, D33 and D37 apply.

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml` (through `pnpm expo install` only)
- Create: `src/services/surfaces.ts`
- Create: `src/services/native/nativeSurfaces.tsx`
- Create: `test/fakeSurfaces.ts`, `test/fakeSurfaces.test.ts`
- Modify: `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `PreviewProps`, `OverlayProps = {url, onFailed}`, `VideoProps = {url, playing}`;
  - `interface Surfaces {Preview; Overlay; Video}` and `createNativeSurfaces()`;
  - `FakeSurfaces = Surfaces & {failOverlay(); crashOverlay()}` and `createFakeSurfaces()`;
  - `Ports.surfaces`, and `FakePorts.surfaces: FakeSurfaces`.

- [ ] **Step 1: Record what autolinks today**

```bash
mkdir -p /private/tmp/claude-501/s1a
pnpm exec expo-modules-autolinking resolve --platform android --json > /private/tmp/claude-501/s1a/expo-before.json
pnpm exec expo-modules-autolinking react-native-config --platform android --json > /private/tmp/claude-501/s1a/rn-before.json
node -e 'const b=require("./node_modules/expo/bundledNativeModules.json");console.log(b["react-native-webview"],b["expo-video"])'
```

Expected: both commands exit 0. The last line prints `13.16.1 ~57.0.3`, which are SDK 57's versions. If it prints something else, use what it prints and say so.

- [ ] **Step 2: Install through Expo, never by hand**

Run: `pnpm expo install react-native-webview expo-video`
Expected: `package.json` gains `"react-native-webview": "13.16.1"` and `"expo-video": "~57.0.3"`. These are the SDK's own ranges, pinned the way every other Expo package in this repo is.

- [ ] **Step 3: Diff what autolinks now (failure class 4)**

```bash
pnpm exec expo-modules-autolinking resolve --platform android --json > /private/tmp/claude-501/s1a/expo-after.json
pnpm exec expo-modules-autolinking react-native-config --platform android --json > /private/tmp/claude-501/s1a/rn-after.json
node -e '
const names = (f, pick) => new Set(pick(require(f)));
const expo = (j) => (j.modules ?? []).map((m) => m.packageName);
const rn = (j) => Object.keys(j.dependencies ?? {});
for (const [label, pick, a, b] of [["expo", expo, "expo-before", "expo-after"], ["rn", rn, "rn-before", "rn-after"]]) {
  const before = names(`/private/tmp/claude-501/s1a/${a}.json`, pick);
  const after = names(`/private/tmp/claude-501/s1a/${b}.json`, pick);
  console.log(label, "added:", [...after].filter((n) => !before.has(n)), "removed:", [...before].filter((n) => !after.has(n)));
}'
pnpm ls react-native-webview expo-video --depth 0
```

Expected: `expo added: [ 'expo-video' ]`, `rn added: [ 'react-native-webview' ]`, and nothing removed. **Anything else is a silent native peer: stop and report it.** Neither package needs an `app.json` plugin for Plan A. expo-video's plugin covers background playback and picture-in-picture, which S1 does not use. Confirm with `rg -n "expo-video|webview" app.json`, which should print nothing. No prebuild is part of this plan.

Run: `pnpm prettier --check package.json` → exit 0.

- [ ] **Step 4: Write the failing fake-surfaces test**

`test/fakeSurfaces.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFakeSurfaces } from './fakeSurfaces';

describe('the fake surfaces', () => {
  it('reports an overlay load failure to the last rendered overlay', () => {
    const surfaces = createFakeSurfaces();
    const onFailed = vi.fn();
    surfaces.Overlay({ url: 'https://stg.seazn.club/overlay/fixtures/f', onFailed }, undefined);
    surfaces.failOverlay();
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('throws from the overlay once told to crash', () => {
    const surfaces = createFakeSurfaces();
    surfaces.crashOverlay();
    expect(() =>
      surfaces.Overlay(
        { url: 'https://stg.seazn.club/overlay/fixtures/f', onFailed: vi.fn() },
        undefined,
      ),
    ).toThrow('overlay crashed');
  });
});
```

(The fakes are plain function components, so calling one directly is a legitimate test of its contract. The `undefined` second argument satisfies React 19's function-component signature, if TypeScript asks for it. If it does not, drop it.)

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm vitest run test/fakeSurfaces.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 6: Implement the port, the fakes, and the native adapter**

`src/services/surfaces.ts`:

```ts
import type { ComponentType } from 'react';

export type PreviewProps = Record<string, never>;
export type OverlayProps = { readonly url: string; readonly onFailed: () => void };
export type VideoProps = { readonly url: string; readonly playing: boolean };

/**
 * The native views the viewfinder draws, as a port (D16). Screens never import
 * react-native-webview or expo-video, so they render on react-native-web in
 * tests with the fakes in test/fakeSurfaces.ts. Phase 4 swaps Preview for the
 * engine's native view; frames never cross the bridge (AGENTS §2).
 */
export interface Surfaces {
  readonly Preview: ComponentType<PreviewProps>;
  readonly Overlay: ComponentType<OverlayProps>;
  readonly Video: ComponentType<VideoProps>;
}
```

`test/fakeSurfaces.ts`:

```ts
import { createElement } from 'react';
import type { OverlayProps, Surfaces, VideoProps } from '@/services/surfaces';

export type FakeSurfaces = Surfaces & {
  /** The WebView reporting a load failure, as onError / onHttpError would. */
  failOverlay(): void;
  /** The overlay throwing while it renders, to reach its error boundary. Set before rendering. */
  crashOverlay(): void;
};

/** Plain elements tests can find; `react` only, so node tests can build ports too. */
export function createFakeSurfaces(): FakeSurfaces {
  let reportFailure: (() => void) | null = null;
  let crashing = false;
  function Preview() {
    return createElement('div', { 'data-testid': 'preview' });
  }
  function Overlay({ url, onFailed }: OverlayProps) {
    if (crashing) throw new Error('overlay crashed');
    reportFailure = onFailed;
    return createElement('div', { 'data-testid': 'overlay', 'data-url': url });
  }
  function Video({ url, playing }: VideoProps) {
    return createElement('div', {
      'data-testid': 'viewer-video',
      'data-url': url,
      'data-playing': String(playing),
    });
  }
  return {
    Preview,
    Overlay,
    Video,
    failOverlay: () => reportFailure?.(),
    crashOverlay: () => {
      crashing = true;
    },
  };
}
```

`src/services/native/nativeSurfaces.tsx`:

```tsx
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { OverlayProps, Surfaces, VideoProps } from '@/services/surfaces';

/** Empty until phase 4 hands the engine's native preview in (spec §3 Bridge). */
function NativePreview() {
  return <View style={styles.fill} />;
}

const ORIGINS = ['https://*'];

/**
 * The Tier A route in a transparent WebView (AGENTS §7). It never takes a
 * touch — the controls live in the gutters — and every way it can fail is
 * reported, so the stage can say so instead of going quietly blank.
 */
function NativeOverlay({ url, onFailed }: OverlayProps) {
  return (
    <View pointerEvents="none" style={styles.clear}>
      <WebView
        source={{ uri: url }}
        style={styles.clear}
        containerStyle={styles.clear}
        originWhitelist={ORIGINS}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
        onError={onFailed}
        onHttpError={onFailed}
        onRenderProcessGone={onFailed}
        onContentProcessDidTerminate={onFailed}
      />
    </View>
  );
}

function muted(player: VideoPlayer): void {
  player.muted = true;
  player.loop = false;
}

/** ExoPlayer on Android. `useCaching: false`: a manifest is fetched live, never stored (D37). */
function NativeVideo({ url, playing }: VideoProps) {
  const player = useVideoPlayer({ uri: url, useCaching: false }, muted);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return (
    <VideoView player={player} style={styles.fill} nativeControls={false} contentFit="contain" />
  );
}

export function createNativeSurfaces(): Surfaces {
  return { Preview: NativePreview, Overlay: NativeOverlay, Video: NativeVideo };
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  // D33: services cannot import theme tokens; 'transparent' is the absence of a colour.
  clear: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
});
```

(Check `useVideoPlayer`'s source type in the installed `expo-video` for `useCaching`, and the WebView prop names against the installed `react-native-webview` types. `pnpm typecheck` settles both. If a prop does not exist at this version, drop it and say which in the batch report.)

Wire the port:

- `src/hooks/usePorts.tsx`: `import type { Surfaces } from '@/services/surfaces';` and add `/** The native views the viewfinder draws (D16). */ readonly surfaces: Surfaces;`.
- `src/hooks/nativePorts.ts`: `surfaces: createNativeSurfaces(),`.
- `test/fakePorts.ts`: `readonly surfaces: FakeSurfaces;` in `FakePorts`, and `surfaces: createFakeSurfaces()` in `fakes`.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: exit 0 and PASS. `rg -n "surfaces" src/hooks/nativePorts.ts` shows the native port wired in.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/services/surfaces.ts src/services/native/nativeSurfaces.tsx test/fakeSurfaces.ts test/fakeSurfaces.test.ts src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts
git commit -F - <<'EOF'
feat(deps): react-native-webview and expo-video behind a surfaces port

Autolinking diff: exactly expo-video (Expo module) and react-native-webview
(RN library) added, nothing else.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) the missing-native-module case is covered by the ports design and settled on a device; (3) the overlay's failure callbacks are tested through the fake, and the native ones only on a device; (4) not applicable.

---

### Task 16: The stream settings store

Spec §4 Settings: "Score preview on or off. Controls on the left or the right." D23 applies. The settings live behind the key-value port, as S0's saved codes do.

**Files:**

- Create: `src/services/streamSettingsStore.ts`, `src/services/streamSettingsStore.test.ts`
- Create: `src/hooks/useStreamSettings.ts`
- Modify: `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`

**Interfaces:**

- Consumes: `KeyValueStore`, `Logger`.
- Produces:
  - `ControlSide`, `StreamSettings`, `DEFAULT_STREAM_SETTINGS = {overlay: true, side: 'right'}`, `SETTINGS_KEY = 'settings.stream'`;
  - `StreamSettingsStore {load; getSnapshot; subscribe; set(change): Promise<'saved' | 'refused'>}` and `createStreamSettingsStore(kv, logger)`;
  - `useStreamSettings(): {settings, change(change), saveFailed}`;
  - `Ports.streamSettings`.
- Logged: `settings.write-refused`, `settings.read-refused` and `settings.unreadable`.

- [ ] **Step 1: Write the failing tests**

`src/services/streamSettingsStore.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createMemoryKeyValueStore, type KeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createRingRecord } from '@/services/sessionRecord';
import {
  createStreamSettingsStore,
  DEFAULT_STREAM_SETTINGS,
  SETTINGS_KEY,
} from '@/services/streamSettingsStore';

function build(kv: KeyValueStore = createMemoryKeyValueStore()) {
  const record = createRingRecord();
  const store = createStreamSettingsStore(kv, createLogger({ record, now: () => 0 }));
  return { store, events: () => record.lines().map((line) => JSON.parse(line).event) };
}

describe('stream settings (D23)', () => {
  it('starts with the overlay on and controls on the right', async () => {
    const { store } = build();
    await store.load();
    expect(store.getSnapshot()).toEqual({ overlay: true, side: 'right' });
  });

  it('reads what was saved', async () => {
    const kv = createMemoryKeyValueStore({
      [SETTINGS_KEY]: '{"v":1,"overlay":false,"side":"left"}',
    });
    const { store } = build(kv);
    await store.load();
    expect(store.getSnapshot()).toEqual({ overlay: false, side: 'left' });
  });

  it('falls back to the defaults, and says so, for an unreadable record', async () => {
    const kv = createMemoryKeyValueStore({ [SETTINGS_KEY]: '{"v":9}' });
    const { store, events } = build(kv);
    await store.load();
    expect(store.getSnapshot()).toBe(DEFAULT_STREAM_SETTINGS);
    expect(events()).toContain('settings.unreadable');
  });

  it('applies a change at once and saves it', async () => {
    const kv = createMemoryKeyValueStore();
    const { store } = build(kv);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);
    const saved = store.set({ side: 'left' });
    expect(store.getSnapshot().side).toBe('left');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await saved).toBe('saved');
    expect(kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":true,"side":"left"}');
  });

  it('keeps a choice the phone refused to save, for this session, and logs it', async () => {
    const refusing: KeyValueStore = {
      get: async () => null,
      set: () => Promise.reject(new Error('keystore locked')),
      delete: async () => undefined,
    };
    const { store, events } = build(refusing);
    await store.load();
    expect(await store.set({ overlay: false })).toBe('refused');
    expect(store.getSnapshot().overlay).toBe(false);
    expect(events()).toContain('settings.write-refused');
  });

  it('reads once however often it is asked to load', async () => {
    const kv = createMemoryKeyValueStore();
    const get = vi.spyOn(kv, 'get');
    const { store } = build(kv);
    await Promise.all([store.load(), store.load()]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('never lets a slow first read overwrite a choice made meanwhile', async () => {
    let answer: (text: string | null) => void = () => undefined;
    const slow: KeyValueStore = {
      get: () => new Promise((resolve) => (answer = resolve)),
      set: async () => undefined,
      delete: async () => undefined,
    };
    const { store } = build(slow);
    const loading = store.load();
    await store.set({ side: 'left' });
    answer('{"v":1,"overlay":true,"side":"right"}');
    await loading;
    expect(store.getSnapshot().side).toBe('left');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/services/streamSettingsStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/services/streamSettingsStore.ts`:

```ts
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';

export type ControlSide = 'left' | 'right';
export type StreamSettings = { readonly overlay: boolean; readonly side: ControlSide };

export const DEFAULT_STREAM_SETTINGS: StreamSettings = { overlay: true, side: 'right' };
export const SETTINGS_KEY = 'settings.stream';

/**
 * Spec §4's two stream settings, behind the key-value port (D23). A change
 * applies at once; a refused save is logged and the choice holds for the
 * session. Shaped for useSyncExternalStore.
 */
export type StreamSettingsStore = {
  load(): Promise<void>;
  getSnapshot(): StreamSettings;
  subscribe(listener: () => void): () => void;
  set(change: Partial<StreamSettings>): Promise<'saved' | 'refused'>;
};

export function createStreamSettingsStore(kv: KeyValueStore, logger: Logger): StreamSettingsStore {
  let settings = DEFAULT_STREAM_SETTINGS;
  let loading: Promise<void> | null = null;
  let touched = false;
  const listeners = new Set<() => void>();
  const publish = (next: StreamSettings) => {
    settings = next;
    for (const listener of listeners) listener();
  };
  return {
    load: () =>
      (loading ??= read(kv, logger).then((saved) => {
        // A choice made while the first read was slow is newer than it.
        if (!touched) publish(saved);
      })),
    getSnapshot: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: async (change) => {
      touched = true;
      const next = { ...settings, ...change };
      publish(next);
      try {
        await kv.set(
          SETTINGS_KEY,
          JSON.stringify({ v: 1, overlay: next.overlay, side: next.side }),
        );
        return 'saved';
      } catch {
        logger.warn('settings.write-refused');
        return 'refused';
      }
    },
  };
}

async function read(kv: KeyValueStore, logger: Logger): Promise<StreamSettings> {
  let text: string | null;
  try {
    text = await kv.get(SETTINGS_KEY);
  } catch {
    logger.warn('settings.read-refused');
    return DEFAULT_STREAM_SETTINGS;
  }
  if (text === null) return DEFAULT_STREAM_SETTINGS;
  const decoded = decode(text);
  if (decoded === null) logger.warn('settings.unreadable');
  return decoded ?? DEFAULT_STREAM_SETTINGS;
}

function decode(text: string): StreamSettings | null {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const { v, overlay, side } = data as Record<string, unknown>;
    if (v !== 1 || typeof overlay !== 'boolean' || (side !== 'left' && side !== 'right'))
      return null;
    return { overlay, side };
  } catch {
    return null;
  }
}
```

`src/hooks/useStreamSettings.ts`:

```ts
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePorts } from '@/hooks/usePorts';
import type { StreamSettings } from '@/services/streamSettingsStore';

/**
 * The stream settings for the viewfinder and Settings. Loads once, on first
 * use; `saveFailed` says the last change held for this session only (D23).
 */
export function useStreamSettings(): {
  readonly settings: StreamSettings;
  readonly saveFailed: boolean;
  change(change: Partial<StreamSettings>): void;
} {
  const { streamSettings } = usePorts();
  const settings = useSyncExternalStore(streamSettings.subscribe, streamSettings.getSnapshot);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    void streamSettings.load();
  }, [streamSettings]);
  const change = useCallback(
    (next: Partial<StreamSettings>) => {
      void streamSettings.set(next).then((result) => setSaveFailed(result === 'refused'));
    },
    [streamSettings],
  );
  return { settings, saveFailed, change };
}
```

Wire the port:

- `usePorts.tsx`: `readonly streamSettings: StreamSettingsStore;`.
- `nativePorts.ts`: `streamSettings: createStreamSettingsStore(kv, logger),`.
- `test/fakePorts.ts`: `streamSettings: createStreamSettingsStore(kv, logger)` in `ports`, before `...portOverrides`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/services src/hooks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/streamSettingsStore.ts src/services/streamSettingsStore.test.ts src/hooks/useStreamSettings.ts src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts
git commit -F - <<'EOF'
feat(stream): settings store for score preview and control side

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) loading twice, and a change during a slow load, are covered; (2) nothing saved and an unreadable record are covered; (3) a refused write is covered; (4) not applicable.

---

### Task 17: HUD atoms: TallyPlate, LivePlate, Elapsed, AudioMeter, EdgeStrip

Spec §4 fixes the tally column's contents: "The state plate, 56 dp and solid … Elapsed as H:MM:SS in `tabular-nums`, on air only … An audio meter of 6 segments, tinted orange below the floor." The edge strips are both solid and sit on the stage edge. AGENTS §8 requires `React.memo` and selectors that return primitives.

**Files:**

- Create: `src/i18n/formatElapsed.ts`, `src/i18n/formatElapsed.test.ts`
- Create: `src/hooks/useClockTick.ts`
- Modify: `src/hooks/engineSelectors.ts` (add `selectMeterSegments` and `METER_SEGMENTS`)
- Create: `src/ui/components/TallyPlate.tsx`, `LivePlate.tsx`, `Elapsed.tsx`, `AudioMeter.tsx`, `EdgeStrip.tsx`
- Create: `src/ui/components/Hud.test.tsx`
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `tallyTone`, `tallyPlateFor`, `selectSoundReady` (Task 13), `selectSinceEpochMs`, `selectStateKind`, `Ports.clock`.
- Produces:
  - `formatElapsed(ms): string` (H:MM:SS) and `useClockTick(active): number`;
  - `METER_SEGMENTS = 6` and `selectMeterSegments`;
  - `<TallyPlate plate>`, `<LivePlate />`, `<Elapsed />`, `<AudioMeter />`, `<EdgeStrip edge>`.

- [ ] **Step 1: Add the copy (4 languages), and budget it**

| key                       | en                       | es                           | fr                          | nl                          |
| ------------------------- | ------------------------ | ---------------------------- | --------------------------- | --------------------------- |
| `stream.tally.starting`   | Starting                 | Iniciando                    | Démarrage                   | Starten                     |
| `stream.tally.notReady`   | Not ready                | No listo                     | Pas prêt                    | Niet klaar                  |
| `stream.tally.ready`      | Ready                    | Listo                        | Prêt                        | Klaar                       |
| `stream.tally.connecting` | Connecting               | Conectando                   | Connexion                   | Verbinden                   |
| `stream.tally.live`       | Live                     | En directo                   | En direct                   | Live                        |
| `stream.tally.trouble`    | Trouble                  | Problema                     | Problème                    | Probleem                    |
| `stream.tally.ended`      | Ended                    | Terminado                    | Terminé                     | Beëindigd                   |
| `stream.meter.label`      | Sound level {level} of 6 | Nivel de sonido {level} de 6 | Niveau sonore {level} sur 6 | Geluidsniveau {level} van 6 |
| `stream.elapsed.label`    | On air for {time}        | En directo desde hace {time} | À l'antenne depuis {time}   | Live sinds {time}           |

Add `[/^stream\.tally\./, 12]` to `BUDGETS` in `src/i18n/budgets.test.ts`.

- [ ] **Step 2: Write the failing tests**

`src/i18n/formatElapsed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatElapsed } from '@/i18n/formatElapsed';

describe('formatElapsed (spec §4: H:MM:SS)', () => {
  it.each([
    [0, '0:00:00'],
    [999, '0:00:00'],
    [754_000, '0:12:34'],
    [3_600_000, '1:00:00'],
    [36_000_000, '10:00:00'],
    [-5000, '0:00:00'],
  ])('%i ms reads %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
```

`src/ui/components/Hud.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TallyPlate as Plate } from '@/hooks/preflight';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { LivePlate } from '@/ui/components/LivePlate';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('TallyPlate', () => {
  it.each<[Plate, string]>([
    ['starting', 'Starting'],
    ['notReady', 'Not ready'],
    ['ready', 'Ready'],
    ['connecting', 'Connecting'],
    ['live', 'Live'],
    ['trouble', 'Trouble'],
    ['ended', 'Ended'],
  ])('%s reads %s', (plate, word) => {
    renderWithPorts(<TallyPlate plate={plate} />);
    expect(screen.getByTestId('tally-plate').textContent).toBe(word);
  });
});

describe('LivePlate (beside Back on Settings and Diagnostics)', () => {
  it('is absent off air', () => {
    renderWithPorts(<LivePlate />);
    expect(screen.queryByTestId('tally-plate')).toBeNull();
  });

  it.each([
    ['live', 'Live'],
    ['connecting', 'Connecting'],
    ['holding', 'Trouble'],
  ] as const)('reads the viewfinder’s own plate on air: %s → %s', (scene, word) => {
    const view = renderWithPorts(<LivePlate />);
    act(() => view.engine.scene(scene));
    expect(screen.getByTestId('tally-plate').textContent).toBe(word);
  });
});

describe('Elapsed', () => {
  afterEach(() => vi.useRealTimers());

  it('shows time on air as H:MM:SS, and ticks', () => {
    vi.useFakeTimers();
    const view = renderWithPorts(<Elapsed />);
    act(() => view.engine.scene('live'));
    expect(screen.getByText('0:12:34')).toBeTruthy();
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + 1000));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:12:35')).toBeTruthy();
  });

  it('is absent before the broadcast starts', () => {
    const view = renderWithPorts(<Elapsed />);
    act(() => view.engine.scene('connecting'));
    expect(screen.queryByText(/\d:\d\d:\d\d/)).toBeNull();
  });
});

describe('AudioMeter', () => {
  it('lights segments with the level', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('armed-ready'));
    const meter = screen.getByRole('progressbar', { name: 'Sound level 3 of 6' });
    expect(meter.getAttribute('aria-valuenow')).toBe('3');
  });

  it('lights nothing below the floor', () => {
    const view = renderWithPorts(<AudioMeter />);
    act(() => view.engine.scene('armed-not-ready'));
    expect(screen.getByRole('progressbar', { name: 'Sound level 0 of 6' })).toBeTruthy();
  });
});
```

(Expected values come from the fake's scenes: the armed level is 0.42, which lights 3 of 6, and the not-ready level is 0.01, which lights 0. Colour is device-only, per AGENTS §10.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/i18n src/ui/components/Hud.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/i18n/formatElapsed.ts`:

```ts
/** Time on air as H:MM:SS (spec §4). Pure, like formatTime. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
```

`src/hooks/useClockTick.ts`:

```ts
import { useEffect, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';

/**
 * The phone clock, once a second while `active`. Only the one leaf that shows
 * a running time uses it — Elapsed — so nothing else re-renders (AGENTS §8).
 */
export function useClockTick(active: boolean): number {
  const { clock } = usePorts();
  const [now, setNow] = useState(() => clock().getTime());
  useEffect(() => {
    if (!active) return;
    setNow(clock().getTime());
    const timer = setInterval(() => setNow(clock().getTime()), 1000);
    return () => clearInterval(timer);
  }, [active, clock]);
  return now;
}
```

Append to `src/hooks/engineSelectors.ts`:

```ts
export const METER_SEGMENTS = 6;

/** Whole segments, not the level: a primitive that changes only when a segment does. */
export const selectMeterSegments = (snapshot: EngineSnapshot) =>
  Math.min(METER_SEGMENTS, Math.round(snapshot.telemetry.audioLevel * METER_SEGMENTS));
```

`src/ui/components/TallyPlate.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { tallyTone, type TallyPlate as Plate, type TallyTone } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, plate as plateColour, plateInk, space } from '@/ui/theme/tokens';

const WORD: Readonly<Record<Plate, MessageKey>> = {
  starting: 'stream.tally.starting',
  notReady: 'stream.tally.notReady',
  ready: 'stream.tally.ready',
  connecting: 'stream.tally.connecting',
  live: 'stream.tally.live',
  trouble: 'stream.tally.trouble',
  ended: 'stream.tally.ended',
};

/**
 * The state plate (spec §4): 56 dp of solid colour, judged by what reads at
 * two metres, not by its type. The colour comes only from `tallyTone`, so red
 * can only ever mean LIVE.
 */
export const TallyPlate = memo(function TallyPlate({ plate }: { plate: Plate }) {
  const { t } = useT();
  const tone = tallyTone(plate);
  return (
    <View style={PLATE[tone]} testID="tally-plate" accessibilityLiveRegion="polite">
      <Text variant="state" style={INK[tone]}>
        {t(WORD[plate])}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  plate: { minHeight: 56, justifyContent: 'center', paddingHorizontal: space.sm },
  live: { backgroundColor: plateColour.live },
  healthy: { backgroundColor: plateColour.healthy },
  degraded: { backgroundColor: plateColour.degraded },
  inert: { backgroundColor: plateColour.inert },
  onPlate: { color: plateInk },
  onInert: { color: colour.ink },
});

const PLATE: Readonly<Record<TallyTone, object>> = {
  live: [styles.plate, styles.live],
  healthy: [styles.plate, styles.healthy],
  degraded: [styles.plate, styles.degraded],
  inert: [styles.plate, styles.inert],
};
const INK: Readonly<Record<TallyTone, object>> = {
  live: styles.onPlate,
  healthy: styles.onPlate,
  degraded: styles.onPlate,
  inert: styles.onInert,
};
```

(Type `PLATE` and `INK` as `StyleProp<ViewStyle>` and `StyleProp<TextStyle>` from `react-native` rather than `object` if the compiler asks.)

`src/ui/components/LivePlate.tsx`:

```tsx
import { memo } from 'react';
import { selectStateKind } from '@/hooks/engineSelectors';
import { tallyPlateFor } from '@/hooks/preflight';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { TallyPlate } from '@/ui/components/TallyPlate';

/**
 * Beside Back on Settings and Diagnostics (AGENTS §6), so the broadcast is
 * never out of sight. The viewfinder's own plate, so the LIVE gate holds
 * here too: connecting never reads LIVE.
 */
export const LivePlate = memo(function LivePlate() {
  const kind = useEngineSelector(selectStateKind);
  const plate = tallyPlateFor(kind, false);
  const onAir = plate === 'connecting' || plate === 'live' || plate === 'trouble';
  return onAir ? <TallyPlate plate={plate} /> : null;
});
```

`src/ui/components/Elapsed.tsx`:

```tsx
import { memo } from 'react';
import { selectSinceEpochMs } from '@/hooks/engineSelectors';
import { useClockTick } from '@/hooks/useClockTick';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { formatElapsed } from '@/i18n/formatElapsed';
import { Text } from '@/ui/components/Text';

/** Time on air, on air only (spec §4). It survives a drop: the hold keeps the broadcast continuous. */
export const Elapsed = memo(function Elapsed() {
  const { t } = useT();
  const since = useEngineSelector(selectSinceEpochMs);
  const now = useClockTick(since !== null);
  if (since === null) return null;
  const time = formatElapsed(now - since);
  return (
    <Text variant="elapsed" accessibilityLabel={t('stream.elapsed.label', { time })}>
      {time}
    </Text>
  );
});
```

`src/ui/components/AudioMeter.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { METER_SEGMENTS, selectMeterSegments } from '@/hooks/engineSelectors';
import { selectSoundReady } from '@/hooks/preflight';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { colour, space } from '@/ui/theme/tokens';

/**
 * Permanent, never in Settings (AGENTS §6): nothing downstream normalises, so
 * a quiet mic reaches YouTube quiet. Six segments, orange below the floor.
 */
export const AudioMeter = memo(function AudioMeter() {
  const { t } = useT();
  const lit = useEngineSelector(selectMeterSegments);
  const sound = useEngineSelector(selectSoundReady);
  return (
    <View
      style={styles.meter}
      accessibilityRole="progressbar"
      accessibilityLabel={t('stream.meter.label', { level: lit })}
      aria-valuemin={0}
      aria-valuemax={METER_SEGMENTS}
      aria-valuenow={lit}
    >
      {ROWS[sound ? 'ok' : 'low'][lit]?.map(renderSegment)}
    </View>
  );
});

function renderSegment(style: StyleProp<ViewStyle>, index: number) {
  return <View key={index} style={style} />;
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', gap: space.xs, height: 12 },
  segment: { flex: 1, backgroundColor: colour.surface2 },
  ok: { backgroundColor: colour.lime },
  low: { backgroundColor: colour.caution },
});

/** Every lit count, precomputed, so a render allocates nothing. */
const row = (lit: number, tint: StyleProp<ViewStyle>) =>
  Array.from({ length: METER_SEGMENTS }, (_, i) =>
    i < lit ? [styles.segment, tint] : styles.segment,
  );
const ROWS = {
  ok: Array.from({ length: METER_SEGMENTS + 1 }, (_, lit) => row(lit, styles.ok)),
  low: Array.from({ length: METER_SEGMENTS + 1 }, (_, lit) => row(lit, styles.low)),
};
```

`src/ui/components/EdgeStrip.tsx`:

```tsx
import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colour, space } from '@/ui/theme/tokens';

/**
 * A solid strip on the top or bottom edge of the stage: the only thing ever
 * drawn over the preview (AGENTS §6, D17). Solid, so it never tints the shot.
 */
export const EdgeStrip = memo(function EdgeStrip({
  edge,
  children,
}: {
  edge: 'top' | 'bottom';
  children: ReactNode;
}) {
  return <View style={edge === 'top' ? top : bottom}>{children}</View>;
});

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colour.surface,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});

const top = [styles.strip, styles.top];
const bottom = [styles.strip, styles.bottom];
```

- [ ] **Step 3b: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/i18n src/ui/components/Hud.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/formatElapsed.ts src/i18n/formatElapsed.test.ts src/hooks/useClockTick.ts src/hooks/engineSelectors.ts src/ui/components/TallyPlate.tsx src/ui/components/LivePlate.tsx src/ui/components/Elapsed.tsx src/ui/components/AudioMeter.tsx src/ui/components/EdgeStrip.tsx src/ui/components/Hud.test.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(hud): tally plate, live plate, elapsed clock, audio meter, edge strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) off air shows no plate and no clock; (3) not applicable; (4) the tally copy fits its 12-character budget in four languages. Colour and the 56 dp height are device-only.

---

### Task 18: HoldAction, the 3-second hold

AGENTS §6: "Go Live and Stop are both 3-second holds, with a progress fill." Spec §4: "each a 3 s hold with a Reanimated fill." D15 applies.

**Files:**

- Create: `src/hooks/useHold.ts`
- Create: `src/ui/components/HoldFill.tsx`, `src/ui/components/HoldAction.tsx`, `src/ui/components/HoldAction.test.tsx`
- Create: `test/press.ts`
- Modify: `test/setup-ui.ts` (stub `HoldFill`)
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `Text`, the tokens.
- Produces:
  - `HOLD_MS = 3000`, `Hold`, `useHold(onHeld, enabled)`;
  - `<HoldFill holding tone>`;
  - `<HoldAction label tone disabled reason onHeld>`;
  - `pressIn(el)` and `pressOut(el)` in `test/press.ts`.

- [ ] **Step 1: Prove the press path in jsdom first (Not verified list)**

Create `test/press.ts`:

```ts
import { fireEvent } from '@testing-library/react';

/**
 * How a test holds a react-native-web Pressable. Keyboard Enter reaches
 * onPressIn at once and onPressOut on release (RNW 0.21 PressResponder), with
 * no press-delay timer in the way. One place to change if that ever stops
 * being true.
 */
export function pressIn(element: HTMLElement): void {
  fireEvent.keyDown(element, { key: 'Enter' });
}

export function pressOut(element: HTMLElement): void {
  fireEvent.keyUp(element, { key: 'Enter' });
}
```

Write this probe as the first test in `src/ui/components/HoldAction.test.tsx`, and run it alone:

```tsx
import { render, screen } from '@testing-library/react';
import { Pressable, Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { pressIn, pressOut } from '../../../test/press';

describe('the press path in jsdom (probe)', () => {
  it('reaches onPressIn on press and onPressOut on release', () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    render(
      <Pressable
        accessibilityRole="button"
        delayPressIn={0}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
      >
        <Text>probe</Text>
      </Pressable>,
    );
    pressIn(screen.getByRole('button'));
    expect(onPressIn).toHaveBeenCalledTimes(1);
    pressOut(screen.getByRole('button'));
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm vitest run src/ui/components/HoldAction.test.tsx`
Expected: PASS. **If it fails**, change `test/press.ts` to `fireEvent.mouseDown` / `fireEvent.mouseUp`, keeping `delayPressIn={0}`, and re-run. If neither works, stop and report it: every hold test depends on this.

- [ ] **Step 2: Add the copy (4 languages), and budget it**

| key                       | en                                     | es                                  | fr                                    | nl                                    |
| ------------------------- | -------------------------------------- | ----------------------------------- | ------------------------------------- | ------------------------------------- |
| `stream.action.goLive`    | Go live                                | Emitir                              | Passer en direct                      | Live gaan                             |
| `stream.action.stop`      | Stop                                   | Detener                             | Arrêter                               | Stoppen                               |
| `stream.action.holdLabel` | {label}. Press and hold for 3 seconds. | {label}. Mantén pulsado 3 segundos. | {label}. Maintenez appuyé 3 secondes. | {label}. 3 seconden ingedrukt houden. |

Add `[/^stream\.action\.(goLive|stop)$/, 16]` to `BUDGETS`.

- [ ] **Step 3: Write the failing hold tests**

Append to `src/ui/components/HoldAction.test.tsx`, adding `act`, `afterEach`, `beforeEach` and `renderWithPorts` to the imports:

```tsx
import { HOLD_MS } from '@/hooks/useHold';
import { HoldAction } from '@/ui/components/HoldAction';
import { renderWithPorts } from '../../../test/renderWithPorts';

type Props = Parameters<typeof HoldAction>[0];

function renderHold(props: Partial<Props> = {}, options?: Parameters<typeof renderWithPorts>[1]) {
  const onHeld = vi.fn();
  const all: Props = {
    label: 'Go live',
    tone: 'go',
    disabled: false,
    reason: null,
    onHeld,
    ...props,
  };
  const view = renderWithPorts(<HoldAction {...all} />, options);
  const button = () =>
    screen.getByRole('button', { name: /Press and hold for 3 seconds|Maintenez/ });
  return { ...view, onHeld, button, all };
}

describe('HoldAction (AGENTS §6: a 3 s hold, both ways)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('acts once after a full 3 s hold, not a moment before', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(hold.onHeld).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('does nothing when let go early: a mis-tap is not a decision', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(2000));
    pressOut(hold.button());
    act(() => vi.advanceTimersByTime(5000));
    expect(hold.onHeld).not.toHaveBeenCalled();
  });

  it('acts once for a second press landing mid-hold', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1000));
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(6000));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('asks for the full hold again after it acted', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    pressOut(hold.button());
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(hold.onHeld).toHaveBeenCalledTimes(1);
  });

  it('never acts while disabled, and shows the reason', () => {
    const hold = renderHold({ disabled: true, reason: 'No sound' });
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).not.toHaveBeenCalled();
    expect(screen.getByText('No sound')).toBeTruthy();
  });

  it('abandons a hold when it becomes disabled mid-way', () => {
    const hold = renderHold();
    pressIn(hold.button());
    act(() => vi.advanceTimersByTime(1500));
    hold.rerender(<HoldAction {...hold.all} disabled />);
    act(() => vi.advanceTimersByTime(3000));
    expect(hold.onHeld).not.toHaveBeenCalled();
  });

  it('abandons a hold when unmounted mid-way', () => {
    const hold = renderHold();
    pressIn(hold.button());
    hold.unmount();
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(hold.onHeld).not.toHaveBeenCalled();
  });

  it('shows the fill while held and clears it on release', () => {
    const hold = renderHold({ tone: 'stop', label: 'Stop' });
    pressIn(hold.button());
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('true');
    expect(screen.getByTestId('hold-fill').dataset.tone).toBe('stop');
    pressOut(hold.button());
    expect(screen.getByTestId('hold-fill').dataset.holding).toBe('false');
  });

  it('says how to use it, in the operator’s language', () => {
    renderHold({ label: 'Passer en direct' }, { deviceLanguages: ['fr'] });
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});
```

Stub the fill in `test/setup-ui.ts`, after the `FadeOut` mock:

```ts
// The hold's fill is a Reanimated worklet; tests read whether it is running and its tone.
vi.mock('@/ui/components/HoldFill', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  return {
    HoldFill: ({ holding, tone }: { holding: boolean; tone: string }) =>
      createElement(View, {
        testID: 'hold-fill',
        dataSet: { holding: String(holding), tone },
      } as ViewProps),
  };
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/HoldAction.test.tsx`
Expected: the probe PASSES and the rest FAIL (modules not found).

- [ ] **Step 5: Implement**

`src/hooks/useHold.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** Owner's call, 2026-09-12 (AGENTS §6): one length for Go live and Stop. */
export const HOLD_MS = 3000;

export type Hold = { readonly holding: boolean; pressIn(): void; pressOut(): void };

/**
 * A press held for HOLD_MS acts once. Release, disabling or unmounting before
 * then abandons it; a second press while one is running is ignored, so a
 * double press can never act twice.
 */
export function useHold(onHeld: () => void, enabled: boolean): Hold {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);
  const pressIn = useCallback(() => {
    if (!enabled || timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onHeld();
    }, HOLD_MS);
  }, [enabled, onHeld]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  useEffect(() => cancel, [cancel]);
  return { holding, pressIn, pressOut: cancel };
}
```

`src/ui/components/HoldFill.tsx`:

```tsx
import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { HOLD_MS } from '@/hooks/useHold';
import { colour } from '@/ui/theme/tokens';

/**
 * The hold's progress, on the UI thread (AGENTS §8). Lime for Go live, cream
 * for Stop (D15): a fill is never red, which means only ON AIR.
 */
export const HoldFill = memo(function HoldFill({
  holding,
  tone,
}: {
  holding: boolean;
  tone: 'go' | 'stop';
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = holding ? withTiming(1, { duration: HOLD_MS, easing: Easing.linear }) : 0;
  }, [holding, progress]);
  const width = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return <Animated.View pointerEvents="none" style={[TONE[tone], width]} />;
});

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.35 },
  go: { backgroundColor: colour.lime },
  stop: { backgroundColor: colour.ink },
});

const TONE = { go: [styles.fill, styles.go], stop: [styles.fill, styles.stop] } as const;
```

(The one render-time array joins Reanimated's animated style to a static one, which is how that API is used. It is stubbed in tests. The 35% cream fill for Stop is a device check.)

`src/ui/components/HoldAction.tsx`:

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useHold } from '@/hooks/useHold';
import { useT } from '@/hooks/useLanguage';
import { HoldFill } from '@/ui/components/HoldFill';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type HoldActionProps = {
  readonly label: string;
  readonly tone: 'go' | 'stop';
  readonly disabled: boolean;
  /** Why it is disabled, said at the control (spec §1). */
  readonly reason: string | null;
  readonly onHeld: () => void;
};

/**
 * Go live and Stop (AGENTS §6): a 3 s hold under a moving fill, because at a
 * ground the costly mistake is a mis-tap, in either direction.
 */
export const HoldAction = memo(function HoldAction(props: HoldActionProps) {
  const { t } = useT();
  const { label, tone, disabled, reason, onHeld } = props;
  const hold = useHold(onHeld, !disabled);
  return (
    <View style={styles.zone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.action.holdLabel', { label })}
        accessibilityState={{ disabled }}
        disabled={disabled}
        delayPressIn={0}
        onPressIn={hold.pressIn}
        onPressOut={hold.pressOut}
        style={disabled ? plateOff : styles.plate}
      >
        <HoldFill holding={hold.holding} tone={tone} />
        <Text variant="action" style={disabled ? styles.labelOff : styles.label}>
          {label}
        </Text>
      </Pressable>
      {reason === null ? null : <Text variant="metricUnit">{reason}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  zone: { gap: space.xs },
  plate: {
    minHeight: 64,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 2,
    borderColor: colour.ink,
    backgroundColor: colour.surface2,
  },
  off: { borderColor: colour.rule },
  label: { color: colour.ink },
  labelOff: { color: colour.ink3 },
});

const plateOff = [styles.plate, styles.off];
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/ui/components/HoldAction.test.tsx src/i18n`
Expected: PASS.

- [ ] **Step 7: Mutate the hold guard once**

`cp src/hooks/useHold.ts /private/tmp/claude-501/s1a/useHold.bak`. Change `if (!enabled || timer.current !== null) return;` to `if (!enabled) return;`.
Run the test file. Expected: FAIL ('acts once for a second press landing mid-hold'). Restore and re-run: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useHold.ts src/ui/components/HoldFill.tsx src/ui/components/HoldAction.tsx src/ui/components/HoldAction.test.tsx test/press.ts test/setup-ui.ts src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(hud): HoldAction — a 3 s hold with a Reanimated fill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a double press and a second full hold are covered; (2) disabled, with its reason, is covered; (3) disabling mid-hold and unmounting mid-hold are covered; (4) French is covered. The fill's motion and colour are device-only.

---

### Task 19: Pre-flight chips, the overlay preview, and the top strip's caption

Spec §1: "four pre-flight chips: camera, sound (audio above the floor), network, code. Under them, 'Go live by 14:32'." Spec §4: the overlay WebView "with `delayMs = 0`, inside its own error boundary. A crash shows a caption, never an opaque plate." AGENTS §7 applies, as do D17, D18 and D30.

**Files:**

- Create: `src/domain/session/previewUrls.ts`, `src/domain/session/previewUrls.test.ts`
- Create: `src/hooks/advisory.ts`, `src/hooks/advisory.test.ts`
- Create: `src/ui/components/PreflightChips.tsx`, `src/ui/components/PreflightChips.test.tsx`
- Create: `src/ui/components/OverlayPreview.tsx`, `src/ui/components/OverlayPreview.test.tsx`
- Modify: `src/ui/components/ErrorBoundary.tsx` (+ `ErrorBoundary.test.tsx`): a `fallback` prop
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `Preflight` and `CHIP_ORDER` (Task 13), `Ports.surfaces`, `Ports.logger`.
- Produces:
  - `withQueryParam(url, name, value)` and `overlayPreviewUrl(url)`;
  - `Advisory`, `ADVISORY_KEY`, `topAdvisory(input)`, `selectShedding`, `selectCharging` (named apart from the existing `selectShed`, which returns the step);
  - `<PreflightChips preflight goLiveBy>`;
  - `<OverlayPreview url visible onFailed>`, which logs `overlay.failed` or `overlay.crashed` and calls `onFailed`;
  - `ErrorBoundary`'s `fallback?: ReactNode`.

- [ ] **Step 1: Add the copy (4 languages), and budget it**

| key                             | en                                                   | es                                                  | fr                                                   | nl                                                |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `stream.chip.camera`            | Camera                                               | Cámara                                              | Caméra                                               | Camera                                            |
| `stream.chip.sound`             | Sound                                                | Sonido                                              | Son                                                  | Geluid                                            |
| `stream.chip.network`           | Network                                              | Red                                                 | Réseau                                               | Netwerk                                           |
| `stream.chip.code`              | Code                                                 | Código                                              | Code                                                 | Code                                              |
| `stream.chip.ok`                | {chip}: ready                                        | {chip}: listo                                       | {chip} : prêt                                        | {chip}: klaar                                     |
| `stream.chip.notOk`             | {chip}: not ready                                    | {chip}: no listo                                    | {chip} : pas prêt                                    | {chip}: niet klaar                                |
| `stream.blocker.code`           | Code timed out                                       | Código caducado                                     | Code expiré                                          | Code verlopen                                     |
| `stream.blocker.camera`         | Camera not ready                                     | Cámara no lista                                     | Caméra pas prête                                     | Camera niet klaar                                 |
| `stream.blocker.network`        | No network                                           | Sin red                                             | Pas de réseau                                        | Geen netwerk                                      |
| `stream.blocker.sound`          | No sound                                             | Sin sonido                                          | Pas de son                                           | Geen geluid                                       |
| `stream.goLiveBy`               | Go live by {time}                                    | Emitir antes de las {time}                          | Direct avant {time}                                  | Live gaan vóór {time}                             |
| `stream.advisory.shed`          | Phone is hot. Preview paused — still live            | Móvil caliente. Vista pausada: sigue en directo     | Téléphone chaud. Aperçu en pause, toujours en direct | Telefoon is heet. Voorbeeld gepauzeerd, nog live  |
| `stream.advisory.overlayFailed` | Score preview failed — the broadcast is not affected | Falló la vista del marcador: la emisión sigue igual | Aperçu du score en panne : la diffusion continue     | Scorevoorbeeld mislukt: de uitzending loopt door  |
| `stream.advisory.scoreAhead`    | You see the score slightly ahead of viewers          | Ves el marcador un poco antes que el público        | Vous voyez le score un peu avant le public           | Je ziet de score iets eerder dan kijkers          |
| `stream.advisory.notCharging`   | Not charging — plug in for a long match              | No está cargando: conéctalo para un partido largo   | Pas en charge : branchez pour un long match          | Laadt niet op: sluit aan voor een lange wedstrijd |

Add these rows to `BUDGETS`:

```ts
  [/^stream\.chip\.(camera|sound|network|code)$/, 10],
  [/^stream\.blocker\./, 24],
  [/^stream\.goLiveBy$/, 32],
  [/^stream\.advisory\./, 56],
```

- [ ] **Step 2: Write the failing tests**

`src/domain/session/previewUrls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { overlayPreviewUrl, withQueryParam } from '@/domain/session/previewUrls';

describe('withQueryParam', () => {
  it('adds a query to a URL with none', () => {
    expect(withQueryParam('https://a.example/p', 'k', 'v')).toBe('https://a.example/p?k=v');
  });

  it('keeps an existing query', () => {
    expect(withQueryParam('https://a.example/p?x=1', 'k', 'v')).toBe('https://a.example/p?x=1&k=v');
  });

  it('replaces the same parameter rather than repeating it', () => {
    expect(withQueryParam('https://a.example/p?k=old&x=1', 'k', 'v')).toBe(
      'https://a.example/p?x=1&k=v',
    );
  });

  it('keeps a fragment after the query', () => {
    expect(withQueryParam('https://a.example/p#top', 'k', 'v')).toBe('https://a.example/p?k=v#top');
  });

  it('encodes what it adds', () => {
    expect(withQueryParam('https://a.example/p', 'k', 'a b&c')).toBe(
      'https://a.example/p?k=a%20b%26c',
    );
  });
});

describe('overlayPreviewUrl (AGENTS §7: the phone runs delayMs = 0)', () => {
  it('asks the Tier A route for no delay', () => {
    expect(overlayPreviewUrl('https://stg.seazn.club/overlay/fixtures/f1')).toBe(
      'https://stg.seazn.club/overlay/fixtures/f1?delayMs=0',
    );
  });
});
```

`src/hooks/advisory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { topAdvisory } from '@/hooks/advisory';

const QUIET = {
  shed: false,
  overlayFailed: false,
  armed: false,
  overlayOn: true,
  charging: true,
} as const;

describe('topAdvisory (D17: one caption at a time, most important first)', () => {
  it('says nothing when there is nothing to say', () => {
    expect(topAdvisory(QUIET)).toBeNull();
  });

  it('puts heat first: preview paused, still live (AGENTS §8)', () => {
    expect(topAdvisory({ ...QUIET, shed: true, overlayFailed: true, charging: false })).toBe(
      'shed',
    );
  });

  it('says the score preview failed, over the rest', () => {
    expect(topAdvisory({ ...QUIET, overlayFailed: true, armed: true, charging: false })).toBe(
      'overlayFailed',
    );
  });

  it('tells the operator once, while arming, that the score runs ahead (D18)', () => {
    expect(topAdvisory({ ...QUIET, armed: true, charging: false })).toBe('scoreAhead');
  });

  it('does not mention the score with the preview off', () => {
    expect(topAdvisory({ ...QUIET, armed: true, overlayOn: false })).toBeNull();
  });

  it('warns when not charging; unknown is not a warning', () => {
    expect(topAdvisory({ ...QUIET, charging: false })).toBe('notCharging');
    expect(topAdvisory({ ...QUIET, charging: null })).toBeNull();
  });
});
```

`src/ui/components/PreflightChips.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { renderWithPorts } from '../../../test/renderWithPorts';

const GREEN = { code: true, camera: true, network: true, sound: true };

describe('PreflightChips (spec §1)', () => {
  it('names every chip and whether it is ready', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, sound: false }} goLiveBy="14:10" />);
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Sound: not ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    expect(screen.getByText('Go live by 14:10')).toBeTruthy();
  });

  it('says nothing about a deadline it does not have', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} goLiveBy={null} />);
    expect(screen.queryByText(/Go live by/)).toBeNull();
  });
});
```

`src/ui/components/OverlayPreview.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { readRecord } from '../../../test/fakePorts';
import { renderWithPorts } from '../../../test/renderWithPorts';

const URL = 'https://stg.seazn.club/overlay/fixtures/fake-fixture';

describe('OverlayPreview (AGENTS §7)', () => {
  it('draws the Tier A route with no delay', () => {
    renderWithPorts(<OverlayPreview url={URL} visible onFailed={vi.fn()} />);
    expect(screen.getByTestId('overlay').dataset.url).toBe(`${URL}?delayMs=0`);
  });

  it('draws nothing when hidden, or with no URL', () => {
    renderWithPorts(<OverlayPreview url={URL} visible={false} onFailed={vi.fn()} />);
    renderWithPorts(<OverlayPreview url={null} visible onFailed={vi.fn()} />);
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('reports a page that failed to load, and records it', () => {
    const onFailed = vi.fn();
    const view = renderWithPorts(<OverlayPreview url={URL} visible onFailed={onFailed} />);
    act(() => view.surfaces.failOverlay());
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(readRecord(view.record).map((e) => e.event)).toContain('overlay.failed');
  });

  it('survives a crash inside the overlay without taking its neighbours down', () => {
    const onFailed = vi.fn();
    const fakes = renderWithPorts(<Text>HUD</Text>);
    fakes.surfaces.crashOverlay();
    fakes.rerender(
      <>
        <OverlayPreview url={URL} visible onFailed={onFailed} />
        <Text>HUD</Text>
      </>,
    );
    expect(screen.getByText('HUD')).toBeTruthy();
    expect(screen.queryByText('Something broke')).toBeNull();
    expect(onFailed).toHaveBeenCalled();
    expect(readRecord(fakes.record).map((e) => e.event)).toContain('overlay.crashed');
  });
});
```

In `src/ui/components/ErrorBoundary.test.tsx`, add:

```tsx
it('shows the given fallback instead of the full-screen message', () => {
  render(
    <ErrorBoundary fallback={null}>
      <Thrower />
    </ErrorBoundary>,
  );
  expect(screen.queryByText('Something broke')).toBeNull();
});
```

(Use the file's existing throwing component. If it has none, add `function Thrower(): never { throw new Error('boom'); }`.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/domain/session src/hooks/advisory.test.ts src/ui/components`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`src/domain/session/previewUrls.ts`:

```ts
/**
 * Adds or replaces one query parameter, keeping every other parameter and any
 * fragment. String work rather than `URL`: Hermes' URL polyfill has lacked
 * parts of the API (S0's recognise note).
 */
export function withQueryParam(url: string, name: string, value: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  const encodedName = encodeURIComponent(name);
  const kept = query.split('&').filter((pair) => pair !== '' && pair.split('=')[0] !== encodedName);
  const added = `${encodedName}=${encodeURIComponent(value)}`;
  return `${path}?${[...kept, added].join('&')}${hash}`;
}

/** AGENTS §7: the phone's preview runs delayMs = 0. The parameter name is unverified (D30). */
export function overlayPreviewUrl(overlayUrl: string): string {
  return withQueryParam(overlayUrl, 'delayMs', '0');
}
```

`src/hooks/advisory.ts`:

```ts
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Advisory = 'shed' | 'overlayFailed' | 'scoreAhead' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  shed: 'stream.advisory.shed',
  overlayFailed: 'stream.advisory.overlayFailed',
  scoreAhead: 'stream.advisory.scoreAhead',
  notCharging: 'stream.advisory.notCharging',
};

/**
 * The top strip's one caption (D17). Device conditions go here, never in the
 * status line: heat sheds the overlay while the broadcast is fine (AGENTS §8).
 */
export function topAdvisory(input: {
  shed: boolean;
  overlayFailed: boolean;
  armed: boolean;
  overlayOn: boolean;
  charging: boolean | null;
}): Advisory | null {
  if (input.shed) return 'shed';
  if (input.overlayOn && input.overlayFailed) return 'overlayFailed';
  if (input.overlayOn && input.armed) return 'scoreAhead';
  if (input.charging === false) return 'notCharging';
  return null;
}

/** Any step down the ladder sheds the overlay first (AGENTS §8). */
export const selectShedding = (snapshot: EngineSnapshot) => snapshot.telemetry.shed !== null;
export const selectCharging = (snapshot: EngineSnapshot) => snapshot.telemetry.charging;
```

`src/ui/components/ErrorBoundary.tsx`: add `fallback?: ReactNode;` to `Props`, with this comment: `/** Rendered instead of the full-screen message — around the overlay, nothing at all (AGENTS §7). */`. In `render()`, after `if (error === null) return this.props.children;`, add `if (this.props.fallback !== undefined) return this.props.fallback;`.

`src/ui/components/PreflightChips.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Chip, Preflight } from '@/hooks/preflight';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

const NAME: Readonly<Record<Chip, MessageKey>> = {
  camera: 'stream.chip.camera',
  sound: 'stream.chip.sound',
  network: 'stream.chip.network',
  code: 'stream.chip.code',
};

/** Spec §1's pre-flight, in its order, then "Go live by" in the venue's time. */
export const PreflightChips = memo(function PreflightChips({
  preflight,
  goLiveBy,
}: {
  preflight: Preflight;
  goLiveBy: string | null;
}) {
  const { t } = useT();
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <ChipView chip="camera" ok={preflight.camera} />
        <ChipView chip="sound" ok={preflight.sound} />
        <ChipView chip="network" ok={preflight.network} />
        <ChipView chip="code" ok={preflight.code} />
      </View>
      {goLiveBy === null ? null : (
        <Text variant="metricUnit">{t('stream.goLiveBy', { time: goLiveBy })}</Text>
      )}
    </View>
  );
});

const ChipView = memo(function ChipView({ chip, ok }: { chip: Chip; ok: boolean }) {
  const { t } = useT();
  const name = t(NAME[chip]);
  return (
    <View
      accessible
      accessibilityLabel={t(ok ? 'stream.chip.ok' : 'stream.chip.notOk', { chip: name })}
      style={ok ? chipOk : chipOff}
    >
      <Text variant="control">{name}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { paddingHorizontal: space.xs, borderWidth: 2 },
  ok: { borderColor: colour.lime },
  off: { borderColor: colour.caution },
});

const chipOk = [styles.chip, styles.ok];
const chipOff = [styles.chip, styles.off];
```

`src/ui/components/OverlayPreview.tsx`:

```tsx
import { memo, useCallback } from 'react';
import { overlayPreviewUrl } from '@/domain/session/previewUrls';
import { usePorts } from '@/hooks/usePorts';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

type OverlayPreviewProps = {
  readonly url: string | null;
  readonly visible: boolean;
  /** The stage then hides it and says so on the top strip (D17). */
  readonly onFailed: () => void;
};

/**
 * The Tier A scorebug over the camera, never re-drawn in React Native
 * (AGENTS §7). Inside its own boundary: an overlay crash never takes the HUD
 * with it, and shows as a caption, never an opaque plate (spec §4).
 */
export const OverlayPreview = memo(function OverlayPreview({
  url,
  visible,
  onFailed,
}: OverlayPreviewProps) {
  const { surfaces, logger } = usePorts();
  const failed = useCallback(() => {
    logger.warn('overlay.failed');
    onFailed();
  }, [logger, onFailed]);
  const crashed = useCallback(() => {
    logger.error('overlay.crashed');
    onFailed();
  }, [logger, onFailed]);
  if (url === null || !visible) return null;
  const { Overlay } = surfaces;
  return (
    <ErrorBoundary fallback={null} onCatch={crashed}>
      <Overlay url={overlayPreviewUrl(url)} onFailed={failed} />
    </ErrorBoundary>
  );
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/domain src/hooks src/ui/components src/i18n`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/session/previewUrls.ts src/domain/session/previewUrls.test.ts src/hooks/advisory.ts src/hooks/advisory.test.ts src/ui/components/PreflightChips.tsx src/ui/components/PreflightChips.test.tsx src/ui/components/OverlayPreview.tsx src/ui/components/OverlayPreview.test.tsx src/ui/components/ErrorBoundary.tsx src/ui/components/ErrorBoundary.test.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(hud): pre-flight chips, overlay preview in its own boundary, top caption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable; (2) a missing URL and a missing deadline are covered; (3) a load failure and a crash are covered; (4) the copy is budgeted in four languages.

---

### Task 20: "What viewers see" — the hold-to-peek

Spec §4: "a hold-to-peek that plays the delivered video on air, muted. It shows the moment the finger lands, with no confirmation delay, and stays warm for 30 s after release." AGENTS §6: "Never put a confirmation delay on it." D35, D36 and D37 apply.

**Files:**

- Modify: `src/domain/session/previewUrls.ts`, `src/domain/session/previewUrls.test.ts` (add `peekPlaybackUrl`)
- Create: `src/hooks/usePeek.ts`
- Create: `src/ui/components/ViewerPeek.tsx`, `src/ui/components/StageVideo.tsx`, `src/ui/components/ViewerPeek.test.tsx`
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `withQueryParam`, `Ports.surfaces.Video`.
- Produces:
  - `PEEK_BANDWIDTH_MBPS = '1.0'` and `peekPlaybackUrl(playbackUrl)`;
  - `PEEK_WARM_MS = 30_000`, `Peek`, `usePeek(available)`;
  - `<ViewerPeek onPressIn onPressOut>` (the control in the column);
  - `<StageVideo url showing>` (the picture on the stage).

- [ ] **Step 1: Add the copy (4 languages), and budget it**

| key                 | en                                       | es                                           | fr                                               | nl                                           |
| ------------------- | ---------------------------------------- | -------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `stream.peek.label` | What viewers see                         | Lo que ve el público                         | Ce que voit le public                            | Wat kijkers zien                             |
| `stream.peek.hint`  | Press and hold to watch what viewers see | Mantén pulsado para ver lo que ve el público | Maintenez appuyé pour voir ce que voit le public | Ingedrukt houden om te zien wat kijkers zien |

Add `[/^stream\.peek\.label$/, 28]` to `BUDGETS`.

- [ ] **Step 2: Write the failing tests**

Append to `src/domain/session/previewUrls.test.ts`:

```ts
import { peekPlaybackUrl } from '@/domain/session/previewUrls';

const PLAYBACK = 'https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8';

describe('peekPlaybackUrl (D35: a capped rendition, so a peek costs little)', () => {
  it('asks for the rendition closest to 1 Mbps', () => {
    expect(peekPlaybackUrl(PLAYBACK)).toBe(`${PLAYBACK}?clientBandwidthHint=1.0`);
  });

  it('keeps a query the server already put on the URL', () => {
    expect(peekPlaybackUrl(`${PLAYBACK}?token=abc`)).toBe(
      `${PLAYBACK}?token=abc&clientBandwidthHint=1.0`,
    );
  });

  it('replaces a hint already there instead of sending two', () => {
    expect(peekPlaybackUrl(`${PLAYBACK}?clientBandwidthHint=8`)).toBe(
      `${PLAYBACK}?clientBandwidthHint=1.0`,
    );
  });

  it('never asks for LL-HLS, pending lane D (D36)', () => {
    expect(peekPlaybackUrl(PLAYBACK)).not.toContain('protocol=');
  });
});
```

`src/ui/components/ViewerPeek.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEEK_WARM_MS, usePeek } from '@/hooks/usePeek';
import { StageVideo } from '@/ui/components/StageVideo';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const PLAYBACK = 'https://video.example/fake/manifest/video.m3u8';

function PeekHarness({ available }: { available: boolean }) {
  const peek = usePeek(available);
  return (
    <>
      <ViewerPeek onPressIn={peek.pressIn} onPressOut={peek.pressOut} />
      {peek.mounted ? <StageVideo url={PLAYBACK} showing={peek.showing} /> : null}
    </>
  );
}

const peekButton = () => screen.getByRole('button', { name: 'What viewers see' });
const video = () => screen.queryByTestId('viewer-video');

describe('What viewers see (spec §4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the moment the finger lands, with no delay', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    expect(video()?.dataset.playing).toBe('true');
    expect(video()?.dataset.url).toBe(`${PLAYBACK}?clientBandwidthHint=1.0`);
  });

  it('stops on release but stays warm for 30 s, then lets go', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    expect(video()?.dataset.playing).toBe('false');
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS - 1));
    expect(video()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(video()).toBeNull();
  });

  it('reuses the warm player when pressed again within 30 s', () => {
    renderWithPorts(<PeekHarness available />);
    pressIn(peekButton());
    pressOut(peekButton());
    act(() => vi.advanceTimersByTime(10_000));
    const warm = video();
    pressIn(peekButton());
    expect(video()).toBe(warm);
    act(() => vi.advanceTimersByTime(PEEK_WARM_MS));
    expect(video()?.dataset.playing).toBe('true');
  });

  it('shows nothing off air', () => {
    renderWithPorts(<PeekHarness available={false} />);
    pressIn(peekButton());
    expect(video()).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/domain/session/previewUrls.test.ts src/ui/components/ViewerPeek.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

Append to `src/domain/session/previewUrls.ts`:

```ts
/**
 * Cloudflare's own-player hint, in Mbps: the master playlist is restricted to
 * the rendition closest to it, so a peek on cellular costs little (D35).
 * Deliberately no `protocol=llhls`: it works only on low-latency inputs,
 * unconfirmed pending lane D (D36).
 */
export const PEEK_BANDWIDTH_MBPS = '1.0';

export function peekPlaybackUrl(playbackUrl: string): string {
  return withQueryParam(playbackUrl, 'clientBandwidthHint', PEEK_BANDWIDTH_MBPS);
}
```

`src/hooks/usePeek.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** Spec §4: the player stays warm this long after release. */
export const PEEK_WARM_MS = 30_000;

export type Peek = {
  readonly showing: boolean;
  /** The player exists: showing, or cooling down. */
  readonly mounted: boolean;
  pressIn(): void;
  pressOut(): void;
};

/**
 * The hold here IS the feature (AGENTS §6): it answers the instant the finger
 * lands and stops a billed preview running unattended. No confirmation delay.
 */
export function usePeek(available: boolean): Peek {
  const [showing, setShowing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cooling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopCooling = useCallback(() => {
    if (cooling.current !== null) clearTimeout(cooling.current);
    cooling.current = null;
  }, []);
  const pressIn = useCallback(() => {
    if (!available) return;
    stopCooling();
    setMounted(true);
    setShowing(true);
  }, [available, stopCooling]);
  const pressOut = useCallback(() => {
    setShowing(false);
    stopCooling();
    cooling.current = setTimeout(() => {
      cooling.current = null;
      setMounted(false);
    }, PEEK_WARM_MS);
  }, [stopCooling]);
  useEffect(() => {
    if (available) return;
    stopCooling();
    setShowing(false);
    setMounted(false);
  }, [available, stopCooling]);
  useEffect(() => stopCooling, [stopCooling]);
  return { showing, mounted, pressIn, pressOut };
}
```

`src/ui/components/ViewerPeek.tsx`:

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet, type PressableStateCallbackType } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/** The control: held, never tapped. It reads as a pair with the action below it (AGENTS §6). */
export const ViewerPeek = memo(function ViewerPeek({
  onPressIn,
  onPressOut,
}: {
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('stream.peek.label')}
      accessibilityHint={t('stream.peek.hint')}
      delayPressIn={0}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={peekStyle}
    >
      <Text variant="control">{t('stream.peek.label')}</Text>
    </Pressable>
  );
});

function peekStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedPeek : styles.peek;
}

const styles = StyleSheet.create({
  peek: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colour.ink3,
  },
  pressed: { borderColor: colour.ink },
});

const pressedPeek = [styles.peek, styles.pressed];
```

`src/ui/components/StageVideo.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { peekPlaybackUrl } from '@/domain/session/previewUrls';
import { usePorts } from '@/hooks/usePorts';

/**
 * The delivered picture over the stage while the peek is held; invisible but
 * still loaded while it cools, so a second peek is instant. Muted, fetched
 * live, never cached (D37).
 */
export const StageVideo = memo(function StageVideo({
  url,
  showing,
}: {
  url: string;
  showing: boolean;
}) {
  const { surfaces } = usePorts();
  const { Video } = surfaces;
  return (
    <View
      pointerEvents="none"
      style={showing ? styles.shown : styles.hidden}
      aria-hidden={!showing}
    >
      <Video url={peekPlaybackUrl(url)} playing={showing} />
    </View>
  );
});

const styles = StyleSheet.create({
  shown: { ...StyleSheet.absoluteFillObject },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0 },
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm typecheck && pnpm vitest run src/domain/session src/ui/components/ViewerPeek.test.tsx src/i18n`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/session/previewUrls.ts src/domain/session/previewUrls.test.ts src/hooks/usePeek.ts src/ui/components/ViewerPeek.tsx src/ui/components/StageVideo.tsx src/ui/components/ViewerPeek.test.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(hud): hold-to-peek "What viewers see", capped at ~1 Mbps

clientBandwidthHint=1.0 on the playback URL; no protocol=llhls pending
lane D; the player fetches manifests live, uncached.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second press while warm reuses the player; (2) off air shows nothing; (3) the cooldown timer is cleared on unmount by the effect cleanup; (4) the label is budgeted in four languages. Playback, muting and data use are device-only.

---

### Task 21: The viewfinder, arming and Arm

Spec §1: the operator scans, lands in the viewfinder, and "the app arms: it parses the code, starts the camera and checks the network. Four pre-flight chips … Under them, 'Go live by 14:32'." Go live is a 3 s hold that enables only when every chip is green. AGENTS §6: full-bleed preview, controls in a 150 dp side column, edge strips only. D17, D18, D29 and Review Focus 4 apply.

**Files:**

- Create: `src/hooks/useStreamArm.ts`, `src/hooks/useDeadlinePassed.ts`, `src/hooks/useViewfinder.ts`
- Create: `src/ui/components/StreamStage.tsx`, `src/ui/components/StreamColumn.tsx`
- Create: `src/ui/screens/StreamScreen.tsx`
- Create: `test/renderViewfinder.tsx`, `src/ui/screens/StreamScreen.arm.test.tsx`
- Modify: `src/hooks/engineSelectors.ts` (add `selectVenueZone`)
- Modify: `app/stream/index.tsx`
- Delete: `src/ui/screens/StreamPlaceholderScreen.tsx`, `src/ui/screens/StreamPlaceholderScreen.test.tsx`, `src/hooks/useSavedStreamSlot.ts`
- Modify: `src/i18n/*.json` (remove `stream.placeholder.title` and `stream.placeholder.body`)

**Interfaces:**

- Consumes:
  - `sessionFromSaved` (Task 9), `warmingGate` (Task 13);
  - `selectStatusKey`, `viewfinderStatusKey`, `selectHoldRemaining`, `selectHoldWindow` (Task 12);
  - `goLiveBlocker`, `tallyPlateFor` and the chip selectors (Task 13);
  - the Task 17–20 components, `useStreamSettings` (Task 16), `useStreamLeave` (Task 4), `usePeek` (Task 20).
- Produces:
  - `useStreamArm(): {unusable}`, which sends `arm` once per visit and logs `intent.arm` or `stream.unusable-code`;
  - `useDeadlinePassed(deadlineMs): boolean`, with one timer at the deadline;
  - `Viewfinder` and `useViewfinder()`;
  - `<StreamStage>`, `<StreamColumn>`, `<StreamScreen>`;
  - `renderViewfinder(options?, {saved?, prepare?})` in `test/renderViewfinder.tsx`.

- [ ] **Step 1: Write the test harness**

`test/renderViewfinder.tsx`:

```tsx
import { act, render, type RenderResult } from '@testing-library/react';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { savedStreamCode } from './fixtures/savedStream';
import { wrapperFor } from './renderWithPorts';

type Options = Parameters<typeof createFakePorts>[0];
type Setup = {
  readonly saved?: SavedCode;
  /** Runs before the first render: an engine already live, an overlay set to crash. */
  readonly prepare?: (fakes: FakePorts) => void;
};

/** The viewfinder as the operator reaches it: a saved stream code, the store loaded, on /stream. */
export async function renderViewfinder(
  options: Options = {},
  { saved = savedStreamCode(), prepare }: Setup = {},
): Promise<RenderResult & FakePorts> {
  const kvSeed = {
    [STORE_KEYS.active]: 'stream',
    [STORE_KEYS.code('stream')]: encodeSavedCode(saved),
    ...options.kvSeed,
  };
  const fakes = createFakePorts({ ...options, kvSeed });
  prepare?.(fakes);
  const rendered: RenderResult = render(<StreamScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  fakes.navigation.go('stream');
  return { ...rendered, ...fakes };
}
```

- [ ] **Step 2: Write the failing tests**

`src/ui/screens/StreamScreen.arm.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });
const plate = () => screen.getByTestId('tally-plate').textContent;
const arms = (view: Awaited<ReturnType<typeof renderViewfinder>>) =>
  view.engine.intents.filter((intent) => intent.kind === 'arm');

describe('the viewfinder arming (spec §1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms once with the saved code, and shows Arm ready', async () => {
    const view = await renderViewfinder();
    expect(arms(view)).toHaveLength(1);
    expect(plate()).toBe('Ready');
    expect(screen.getByText('Ready. Hold Go live for 3 seconds.')).toBeTruthy();
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Sound: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    // 13:10Z is 14:10 in London in October.
    expect(screen.getByText('Go live by 14:10')).toBeTruthy();
    expect(screen.getByText('Seazn XI v Fake CC')).toBeTruthy();
  });

  it('sends the heartbeat target with the arm, never logging its token', async () => {
    const view = await renderViewfinder();
    const [arm] = arms(view);
    expect(arm?.kind === 'arm' && arm.heartbeat.url).toBe(
      'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    );
    const logged = view.record.lines().join('\n');
    expect(logged).toContain('intent.arm');
    expect(arm?.kind === 'arm' && logged.includes(arm.heartbeat.token)).toBe(false);
  });

  it('starts once after a full 3 s hold on Go live', async () => {
    const view = await renderViewfinder();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.filter((intent) => intent.kind === 'start')).toHaveLength(1);
    // Connecting now: Stop has taken Go live's place.
    expect(
      screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' }),
    ).toBeTruthy();
  });

  it.each([
    ['cameraReady', { cameraReady: false }, 'Camera', 'Camera not ready', 'Camera not ready yet.'],
    [
      'networkReachable',
      { networkReachable: false },
      'Network',
      'No network',
      'No network. Check the signal.',
    ],
    [
      'audioLevel',
      { audioLevel: 0.01 },
      'Sound',
      'No sound',
      'No sound. Check the mic before going live.',
    ],
  ] as const)(
    'blocks Go live when %s is off, and says why',
    async (_, patch, chip, reason, line) => {
      const view = await renderViewfinder();
      act(() => view.engine.patch(patch));
      expect(plate()).toBe('Not ready');
      expect(screen.getByLabelText(`${chip}: not ready`)).toBeTruthy();
      expect(screen.getByText(reason)).toBeTruthy();
      expect(screen.getByText(line)).toBeTruthy();
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
    },
  );

  it('disables Go live at the warming deadline with nothing else changing (Review Focus 4)', async () => {
    const view = await renderViewfinder();
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000));
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText('Code timed out — ask the organiser for a new one')).toBeTruthy();
    expect(screen.getByLabelText('Code: not ready')).toBeTruthy();
    expect(screen.getByText('Code timed out')).toBeTruthy();
    expect(screen.queryByText(/Go live by/)).toBeNull();
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.engine.intents.some((intent) => intent.kind === 'start')).toBe(false);
  });

  it('opens already timed out when the deadline passed before the visit', async () => {
    await renderViewfinder(
      {},
      {
        prepare: (fakes) => fakes.setNow(new Date(TEST_NOW.getTime() + 11 * 60_000)),
      },
    );
    expect(screen.getByText('Code timed out — ask the organiser for a new one')).toBeTruthy();
  });

  it('never arms with a code it cannot read, says so, and offers Home', async () => {
    const view = await renderViewfinder({}, { saved: savedStreamCode({ raw: '{"v":2}' }) });
    expect(arms(view)).toHaveLength(0);
    expect(screen.getByText("This code can't be used. Go Home and scan again.")).toBeTruthy();
    expect(plate()).toBe('Not ready');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    const events = readRecord(view.record).map((entry) => entry.event);
    expect(events.filter((event) => event === 'stream.unusable-code')).toHaveLength(1);
  });

  it('never arms twice on one visit, even if the engine drops back to idle', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'idle' }));
    expect(arms(view)).toHaveLength(1);
  });

  it.each(['armed-ready', 'live'] as const)(
    'does not arm an engine that is already %s',
    async (scene) => {
      const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene(scene) });
      expect(arms(view)).toHaveLength(0);
    },
  );

  it('reads in French', async () => {
    await renderViewfinder({ deviceLanguages: ['fr'] });
    expect(plate()).toBe('Prêt');
    expect(screen.getByText('Prêt. Maintenez le bouton 3 secondes.')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : prêt')).toBeTruthy();
    expect(screen.getByText('Direct avant 14:10')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Passer en direct. Maintenez appuyé 3 secondes.' }),
    ).toBeTruthy();
  });
});
```

(The re-arm test needs no rerender: `forceState` inside `act` re-runs the arm effect with `kind` back at `idle`, which is exactly the second chance the guard must refuse. The French time format comes from `formatTime`, as in S0. If it prints `14 h 10`, copy what the dictionary and `formatTime` produce, never what the code under test computes.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/ui/screens/StreamScreen.arm.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the hooks**

Append to `src/hooks/engineSelectors.ts`:

```ts
/** The venue's zone from the armed descriptor: every time the operator reads is in it (spec §2). */
export const selectVenueZone = (snapshot: EngineSnapshot) =>
  snapshot.descriptor?.venueTimezone ?? null;
```

`src/hooks/useStreamArm.ts`:

```ts
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { sessionFromSaved } from '@/domain/mode/savedSession';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * Arms the engine with the saved stream code on entering the viewfinder
 * (spec §1). Once per visit and code: an engine already armed or live is
 * native's session, never re-armed (the engine wins at reopen), and the leave
 * that resets a failed session must not re-arm it on its way out. An engine
 * that falls back to idle mid-visit is recovered by leaving and Continue.
 */
export function useStreamArm(): { readonly unusable: boolean } {
  const { modeStore, logger } = usePorts();
  const engine = useEngine();
  const store = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const saved = store.status === 'ready' ? (store.saved.codes.stream ?? null) : null;
  const session = useMemo(() => (saved === null ? null : sessionFromSaved(saved)), [saved]);
  const kind = useEngineSelector(selectStateKind);
  const armedFor = useRef<string | null>(null);
  useEffect(() => {
    if (saved === null || session === null || kind !== 'idle') return;
    if (armedFor.current === saved.raw) return;
    armedFor.current = saved.raw;
    if (!session.ok) return logger.warn('stream.unusable-code', { problem: session.error });
    const { value } = session;
    engine.send({
      kind: 'arm',
      session: value,
      heartbeat: { url: value.descriptor.heartbeatUrl, token: value.token },
    });
    logger.info('intent.arm', { slot: value.slot });
  }, [saved, session, kind, engine, logger]);
  return { unusable: session !== null && !session.ok };
}
```

(`problem` and `slot` are on the scrub allow-list from Task 1. If either is not, add it there with a test: both are plain values, never secrets.)

`src/hooks/useDeadlinePassed.ts`:

```ts
import { useEffect, useState } from 'react';
import { warmingGate } from '@/domain/session/warming';
import { usePorts } from '@/hooks/usePorts';

/**
 * Whether the warming deadline has passed, by the phone clock. One timer at
 * the deadline, so Go live disables itself even when nothing else changes
 * (Review Focus 4): no telemetry tick is needed to notice.
 */
export function useDeadlinePassed(deadlineMs: number | null): boolean {
  const { clock } = usePorts();
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const deadline = deadlineMs === null ? null : new Date(deadlineMs);
    const gate = warmingGate(deadline, clock());
    setPassed(gate === 'passed');
    if (gate !== 'open' || deadlineMs === null) return;
    const timer = setTimeout(() => setPassed(true), deadlineMs - clock().getTime());
    return () => clearTimeout(timer);
  }, [deadlineMs, clock]);
  return passed;
}
```

`src/hooks/useViewfinder.ts`:

```ts
import { useCallback } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import { selectStateKind, selectVenueZone, selectWarmingDeadlineMs } from '@/hooks/engineSelectors';
import {
  goLiveBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  type Chip,
  type Preflight,
  type TallyPlate,
} from '@/hooks/preflight';
import {
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  viewfinderStatusKey,
  type StatusKey,
} from '@/hooks/statusKey';
import { useEngine, useEngineSelector } from '@/hooks/useCaptureEngine';
import { useDeadlinePassed } from '@/hooks/useDeadlinePassed';
import { useFormatTime } from '@/hooks/useFormatTime';
import { usePorts } from '@/hooks/usePorts';
import { useStreamArm } from '@/hooks/useStreamArm';

type Kind = SessionState['kind'];
export type ViewfinderAction = 'goLive' | 'stop' | 'ended';

/** Everything the column shows, as a projection of native state (AGENTS §2). No state machine. */
export type Viewfinder = {
  readonly kind: Kind;
  readonly plate: TallyPlate;
  readonly statusKey: StatusKey;
  readonly holdRemaining: number | null;
  readonly holdWindow: number | null;
  readonly preflight: Preflight;
  readonly blocker: Chip | null;
  readonly goLiveBy: string | null;
  readonly action: ViewfinderAction;
  readonly onAir: boolean;
  start(): void;
  stop(): void;
};

const ACTION: Readonly<Record<Kind, ViewfinderAction>> = {
  idle: 'goLive',
  armed: 'goLive',
  connecting: 'stop',
  publishing: 'stop',
  degraded: 'stop',
  reconnecting: 'stop',
  ended: 'ended',
};

export function useViewfinder(): Viewfinder {
  const { unusable } = useStreamArm();
  const kind = useEngineSelector(selectStateKind);
  const { preflight, codeTimedOut, goLiveBy } = usePreflight(unusable);
  const blocker = goLiveBlocker(preflight);
  const engineKey = useEngineSelector(selectStatusKey);
  const holdRemaining = useEngineSelector(selectHoldRemaining);
  const holdWindow = useEngineSelector(selectHoldWindow);
  const intents = useIntents();
  const action = ACTION[kind];
  return {
    kind,
    plate: unusable && kind === 'idle' ? 'notReady' : tallyPlateFor(kind, blocker === null),
    statusKey: viewfinderStatusKey(engineKey, { kind, unusable, codeTimedOut }),
    holdRemaining,
    holdWindow,
    preflight,
    blocker,
    goLiveBy: action === 'goLive' ? goLiveBy : null,
    action,
    onAir: action === 'stop',
    ...intents,
  };
}

/** Spec §1's four chips. The code chip is the saved code being usable and the deadline not passed. */
function usePreflight(unusable: boolean) {
  const camera = useEngineSelector(selectCameraReady);
  const network = useEngineSelector(selectNetworkReachable);
  const sound = useEngineSelector(selectSoundReady);
  const deadlineMs = useEngineSelector(selectWarmingDeadlineMs);
  const zone = useEngineSelector(selectVenueZone);
  const passed = useDeadlinePassed(deadlineMs);
  const format = useFormatTime();
  const open = deadlineMs !== null && !passed;
  return {
    preflight: { code: !unusable && open, camera, network, sound },
    codeTimedOut: passed,
    goLiveBy: open ? format(new Date(deadlineMs), zone) : null,
  };
}

/** Intents, not RPC (AGENTS §2): they return nothing and are reconciled against native state. */
function useIntents() {
  const engine = useEngine();
  const { logger } = usePorts();
  const start = useCallback(() => {
    logger.info('intent.start');
    engine.send({ kind: 'start' });
  }, [engine, logger]);
  const stop = useCallback(() => {
    logger.info('intent.stop');
    engine.send({ kind: 'stop' });
  }, [engine, logger]);
  return { start, stop };
}
```

(`deadlineMs` is narrowed to `number` by `open` only if TypeScript follows the alias. If it does not, write `open && deadlineMs !== null ? … : null`.)

- [ ] **Step 5: Implement the stage, the column and the screen**

`src/ui/components/StreamStage.tsx`:

```tsx
import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ADVISORY_KEY, selectCharging, selectShedding, topAdvisory } from '@/hooks/advisory';
import { selectLabel, selectOverlayUrl, selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import { usePorts } from '@/hooks/usePorts';
import { EdgeStrip } from '@/ui/components/EdgeStrip';
import { GhostButton } from '@/ui/components/GhostButton';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { StageVideo } from '@/ui/components/StageVideo';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';

type StageProps = {
  readonly armed: boolean;
  readonly overlayOn: boolean;
  readonly peek: Peek;
  readonly canLeave: boolean;
  readonly onHome: () => void;
};

/**
 * The shot, full-bleed. Nothing is drawn over it but the overlay preview, the
 * peek, and the two solid edge strips (AGENTS §6, D17): the top one carries
 * one caption at a time, the bottom one the match label and the way out.
 */
export const StreamStage = memo(function StreamStage({
  armed,
  overlayOn,
  peek,
  canLeave,
  onHome,
}: StageProps) {
  const { t } = useT();
  const { surfaces } = usePorts();
  const [overlayFailed, setOverlayFailed] = useState(false);
  const onFailed = useCallback(() => setOverlayFailed(true), []);
  const shed = useEngineSelector(selectShedding);
  const charging = useEngineSelector(selectCharging);
  const overlayUrl = useEngineSelector(selectOverlayUrl);
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const label = useEngineSelector(selectLabel);
  const advisory = topAdvisory({ shed, overlayFailed, armed, overlayOn, charging });
  const { Preview } = surfaces;
  return (
    <View style={styles.stage}>
      <Preview />
      <OverlayPreview
        url={overlayUrl}
        visible={overlayOn && !shed && !overlayFailed}
        onFailed={onFailed}
      />
      {peek.mounted && playbackUrl !== null ? (
        <StageVideo url={playbackUrl} showing={peek.showing} />
      ) : null}
      {advisory === null ? null : (
        <EdgeStrip edge="top">
          <Text variant="status">{t(ADVISORY_KEY[advisory])}</Text>
        </EdgeStrip>
      )}
      <EdgeStrip edge="bottom">
        <Text variant="metricUnit" numberOfLines={1} style={styles.label}>
          {label ?? ''}
        </Text>
        {canLeave ? <GhostButton label={t('stream.home')} onPress={onHome} /> : null}
      </EdgeStrip>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colour.stage },
  label: { flex: 1 },
});
```

(If `advisory` or `label` makes `StreamStage` longer than the house limit, move the two strips into a `StageStrips` component in the same file. Keep JSX nesting at three levels at most.)

`src/ui/components/StreamColumn.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import type { Peek } from '@/hooks/usePeek';
import type { Viewfinder } from '@/hooks/useViewfinder';
import type { Chip } from '@/hooks/preflight';
import type { MessageKey } from '@/i18n/messages';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { HoldAction } from '@/ui/components/HoldAction';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { StatusLine } from '@/ui/components/StatusLine';
import { TallyPlate } from '@/ui/components/TallyPlate';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { colour, layout, space } from '@/ui/theme/tokens';

const BLOCKER_KEY: Readonly<Record<Chip, MessageKey>> = {
  code: 'stream.blocker.code',
  camera: 'stream.blocker.camera',
  network: 'stream.blocker.network',
  sound: 'stream.blocker.sound',
};

type ColumnProps = { readonly view: Viewfinder; readonly blocked: boolean; readonly peek: Peek };

/**
 * The side column (spec §4), top to bottom: state plate, elapsed, meter, the
 * one true sentence, then the pre-flight or the peek, then the action.
 */
export const StreamColumn = memo(function StreamColumn({ view, blocked, peek }: ColumnProps) {
  const { t } = useT();
  const vars = { remaining: view.holdRemaining ?? '', window: view.holdWindow ?? '' };
  const line = blocked ? t('stream.leaveOnAir') : t(view.statusKey, vars);
  return (
    <View style={styles.column}>
      <TallyPlate plate={view.plate} />
      <Elapsed />
      <AudioMeter />
      <StatusLine>{line}</StatusLine>
      {view.action === 'goLive' ? (
        <PreflightChips preflight={view.preflight} goLiveBy={view.goLiveBy} />
      ) : null}
      {view.onAir ? <ViewerPeek onPressIn={peek.pressIn} onPressOut={peek.pressOut} /> : null}
      <ColumnAction view={view} />
    </View>
  );
});

const ColumnAction = memo(function ColumnAction({ view }: { view: Viewfinder }) {
  const { t } = useT();
  if (view.action === 'stop') {
    return (
      <HoldAction
        label={t('stream.action.stop')}
        tone="stop"
        disabled={false}
        reason={null}
        onHeld={view.stop}
      />
    );
  }
  if (view.action === 'ended') return null;
  const blocked = view.kind !== 'armed' || view.blocker !== null;
  const reason =
    view.kind === 'armed' && view.blocker !== null ? t(BLOCKER_KEY[view.blocker]) : null;
  return (
    <HoldAction
      label={t('stream.action.goLive')}
      tone="go"
      disabled={blocked}
      reason={reason}
      onHeld={view.start}
    />
  );
});

const styles = StyleSheet.create({
  column: {
    width: layout.columnWidth,
    gap: space.sm,
    padding: space.sm,
    backgroundColor: colour.ground,
  },
});
```

`src/ui/screens/StreamScreen.tsx`:

```tsx
import { StyleSheet, View } from 'react-native';
import { usePeek } from '@/hooks/usePeek';
import { useStreamLeave } from '@/hooks/useStreamLeave';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { useViewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { StreamStage } from '@/ui/components/StreamStage';
import { colour } from '@/ui/theme/tokens';

/**
 * Live Stream's viewfinder (spec §4): Arm, on air and Ended are one screen,
 * a projection of the engine's state. The column sits on the side the
 * operator picked in Settings.
 */
export function StreamScreen() {
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  const leave = useStreamLeave();
  const peek = usePeek(view.onAir);
  return (
    <View style={settings.side === 'left' ? styles.columnLeft : styles.columnRight}>
      <StreamStage
        armed={view.kind === 'armed'}
        overlayOn={settings.overlay}
        peek={peek}
        canLeave={leave.canLeave}
        onHome={leave.leave}
      />
      <StreamColumn view={view} blocked={leave.blocked} peek={peek} />
    </View>
  );
}

const styles = StyleSheet.create({
  columnRight: { flex: 1, flexDirection: 'row', backgroundColor: colour.ground },
  columnLeft: { flex: 1, flexDirection: 'row-reverse', backgroundColor: colour.ground },
});
```

`app/stream/index.tsx`:

```tsx
import { StreamScreen } from '@/ui/screens/StreamScreen';

export default function StreamRoute() {
  return <StreamScreen />;
}
```

Delete the placeholder, whose leave tests moved to `useStreamLeave.test.tsx` in Task 4, and its slot hook:

```bash
git rm src/ui/screens/StreamPlaceholderScreen.tsx src/ui/screens/StreamPlaceholderScreen.test.tsx src/hooks/useSavedStreamSlot.ts
```

Remove `stream.placeholder.title` and `stream.placeholder.body` from all four dictionaries. `DevEngineControls.tsx` is now unused; Task 25 deletes it.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS. `rg -n "StreamPlaceholderScreen|useSavedStreamSlot|stream\.placeholder" src app test` prints nothing.

- [ ] **Step 7: Mutate the warming timer and the arm guard, once each**

1. `cp src/hooks/useDeadlinePassed.ts /private/tmp/claude-501/s1a/deadline.bak`. Delete the `const timer = setTimeout(…)` line and the `return () => clearTimeout(timer);` line. Run `pnpm vitest run src/ui/screens/StreamScreen.arm.test.tsx`. Expected: FAIL ('disables Go live at the warming deadline with nothing else changing'). Restore and re-run: PASS.
2. `cp src/hooks/useStreamArm.ts /private/tmp/claude-501/s1a/arm.bak`. Delete `if (armedFor.current === saved.raw) return;`. Run the same file. Expected: FAIL ('never arms twice on one visit…'). Restore and re-run: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useStreamArm.ts src/hooks/useDeadlinePassed.ts src/hooks/useViewfinder.ts src/hooks/engineSelectors.ts src/ui/components/StreamStage.tsx src/ui/components/StreamColumn.tsx src/ui/screens/StreamScreen.tsx src/ui/screens/StreamScreen.arm.test.tsx test/renderViewfinder.tsx app/stream/index.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json
git commit -F - <<'EOF'
feat(stream): the viewfinder — arming, pre-flight and Go live

Replaces the S0 placeholder. Arms once per visit, never over native's own
session; one timer at the warming deadline disables Go live without a tick.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a second arm is covered, both in one visit and for an engine already armed or live; (2) an unreadable code is covered; (3) a deadline passing while idle, and one already passed at open, are covered; (4) French is covered. Portrait is the orientation gate's job, already tested in S0.

---

### Task 22: On air: every state the operator can see

Spec §6 lists the states the fake must render, and AGENTS §10 says: "render each state through the fake … and assert what the operator can see." This task adds no production code unless a test finds a gap. It pins the LIVE gate and "the heartbeat never blocks" at the screen, the two places they reach the operator.

**Files:**

- Create: `src/ui/screens/StreamScreen.onAir.test.tsx`
- Modify: only what a failing test proves wrong, reported as a deviation.

**Interfaces:**

- Consumes: everything from Task 21, `FakeScene`, `FakeSurfaces`.
- Produces: tests only.

- [ ] **Step 1: Write the tests**

`src/ui/screens/StreamScreen.onAir.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeScene } from '@/engine/FakeCaptureEngine';
import { HOLD_MS } from '@/hooks/useHold';
import { pressIn } from '../../../test/press';
import { renderViewfinder } from '../../../test/renderViewfinder';

const plate = () => screen.getByTestId('tally-plate').textContent;
const stop = () => screen.getByRole('button', { name: 'Stop. Press and hold for 3 seconds.' });

async function onAir(scene: FakeScene, options: Parameters<typeof renderViewfinder>[0] = {}) {
  const view = await renderViewfinder(options);
  act(() => view.engine.scene(scene));
  return view;
}

describe('on air (spec §6, through the fake)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never reads LIVE while connecting', async () => {
    await onAir('connecting');
    expect(plate()).toBe('Connecting');
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Opening the link.')).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  it('says live with no sound when the level drops under the floor on air (D39)', async () => {
    const view = await onAir('live');
    act(() => view.engine.patch({ audioLevel: 0.01 }));
    expect(plate()).toBe('Live');
    expect(screen.getByText('Live with no sound. Check the mic now.')).toBeTruthy();
  });

  it('shows live: the plate, the clock, the line, and Stop in place of Go live', async () => {
    await onAir('live');
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(screen.getByText('Live. Sound and picture going out.')).toBeTruthy();
    expect(stop()).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Go live/ })).toBeNull();
    expect(screen.queryByLabelText(/^Camera:/)).toBeNull();
  });

  it('hides Home on air, and Back says how to stop instead of leaving', async () => {
    const view = await onAir('live');
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    act(() => void view.back.press());
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    expect(view.navigation.current()).toBe('stream');
  });

  it('stops once after a full 3 s hold on Stop', async () => {
    const view = await onAir('live');
    pressIn(stop());
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(view.engine.intents.some((intent) => intent.kind === 'stop')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    // Stopped: the hold control is gone, replaced by Ended.
    expect(view.engine.intents.filter((intent) => intent.kind === 'stop')).toHaveLength(1);
  });

  it.each<[FakeScene, string]>([
    ['fell-back', 'Switched to backup link (RTMPS)'],
    ['holding', 'Uplink lost — holding, 38 s of 183'],
    ['stalled', 'Video stalled — restarting, 38 s of 183'],
    ['restarting', 'Viewers not receiving — restarting, 38 s of 183'],
    ['not-delivered', 'Viewers not receiving — restarting'],
    ['camera-taken', 'Camera taken by another app — slate on air'],
    ['mic-silenced', 'Mic silenced by a call'],
  ])('%s reads Trouble, keeps the clock and Stop, and says: %s', async (scene, line) => {
    await onAir(scene);
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(stop()).toBeTruthy();
  });

  it('sheds the overlay on a hot phone and says so, still Live (AGENTS §8)', async () => {
    await onAir('shed');
    expect(plate()).toBe('Live');
    expect(screen.getByText('Phone is hot. Preview paused — still live')).toBeTruthy();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.getByText('Live. Sound and picture going out.')).toBeTruthy();
  });

  it('keeps the HUD whole when the overlay crashes, with a caption, not a plate', async () => {
    await renderViewfinder({}, { prepare: (fakes) => fakes.surfaces.crashOverlay() });
    expect(screen.getByText('Score preview failed — the broadcast is not affected')).toBeTruthy();
    expect(screen.getByTestId('tally-plate')).toBeTruthy();
    expect(screen.queryByText('Something broke')).toBeNull();
  });

  it('says so when the overlay page fails to load', async () => {
    const view = await onAir('live');
    act(() => view.surfaces.failOverlay());
    expect(screen.getByText('Score preview failed — the broadcast is not affected')).toBeTruthy();
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('never lets a failing heartbeat change what the operator sees (ruling 5)', async () => {
    const view = await onAir('live');
    const heartbeat = {
      lastSentAtEpochMs: 0,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    act(() => view.engine.patch({ heartbeat }));
    expect(plate()).toBe('Live');
    expect(screen.getByText('Live. Sound and picture going out.')).toBeTruthy();
    expect(screen.queryByText(/Phone is hot|failed/)).toBeNull();
  });

  it('plays what viewers see the moment the finger lands, at the capped rendition', async () => {
    await onAir('live');
    pressIn(screen.getByRole('button', { name: 'What viewers see' }));
    const video = screen.getByTestId('viewer-video');
    expect(video.dataset.playing).toBe('true');
    expect(video.dataset.url).toBe(
      'https://video.example/fake/manifest/video.m3u8?clientBandwidthHint=1.0',
    );
  });

  it('offers no peek before the broadcast starts', async () => {
    await renderViewfinder();
    expect(screen.queryByRole('button', { name: 'What viewers see' })).toBeNull();
  });

  it('reads holding in Spanish, within the column', async () => {
    await onAir('holding', { deviceLanguages: ['es'] });
    expect(plate()).toBe('Problema');
    expect(screen.getByText(/38 s/)).toBeTruthy();
  });
});
```

(The three reconnect causes each get their own line (D38): which trigger is being ridden out changes what the operator should do. The Spanish holding line comes from the dictionary's `stream.status.holding`. Assert its full text once the dictionary is read, not a pattern, if the implementer prefers; the pattern keeps this test off the translation draft.)

- [ ] **Step 2: Run**

Run: `pnpm vitest run src/ui/screens/StreamScreen.onAir.test.tsx`
Expected: PASS. A failure here is a gap in Tasks 17–21. Fix it there, and name it in the batch report.

- [ ] **Step 3: Mutate the LIVE gate and the heartbeat rule at the screen**

1. `cp src/hooks/preflight.ts /private/tmp/claude-501/s1a/preflight.bak`. In `tallyPlateFor`, make `connecting` return `'live'`. Run the file. Expected: FAIL ('never reads LIVE while connecting'). Restore and re-run: PASS.
2. `cp src/hooks/statusKey.ts /private/tmp/claude-501/s1a/statusKey.bak`. Add `if (snapshot.telemetry.heartbeat.failures > 3) return 'stream.status.weakSignal';` as the first line of `selectStatusKey`. Run the file. Expected: FAIL ('never lets a failing heartbeat change…'). Restore and re-run: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/StreamScreen.onAir.test.tsx
git commit -F - <<'EOF'
test(stream): every on-air state through the fake, as the operator sees it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(Add any production file a test forced to change, and say why in the commit body.)

Four questions: (1) Stop held twice is covered by HoldAction's own tests; (2) no peek before air is covered; (3) a crash and a load failure are covered; (4) Spanish is covered.

---

### Task 23: Ended, "Scan another", and reopening while live

Spec §4, Ended: "duration, how it ended, and **Scan another** / **Home**." D24: Scan another asks Home to scan, then leaves; only Home calls `scan()`. Spec §1: "the engine wins at reopen", so a phone killed while live comes back to the live viewfinder, never re-armed.

**Files:**

- Create: `src/services/homeIntent.ts`, `src/services/homeIntent.test.ts`
- Create: `src/ui/components/EndedBlock.tsx`
- Create: `src/ui/screens/StreamScreen.ended.test.tsx`
- Modify: `src/ui/components/StreamColumn.tsx` (render `EndedBlock` for `ended`)
- Modify: `src/hooks/engineSelectors.ts` (add `selectEndedDurationMs`)
- Modify: `src/hooks/useHome.ts` (take a pending scan request), `src/ui/screens/HomeScreen.test.tsx`
- Modify: `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `useStreamLeave` (its `leave`), `formatElapsed`, `tapTile`.
- Produces:
  - `HomeIntent {requestScan(); takeScan(): boolean}`, `createHomeIntent()`, and `Ports.homeIntent`;
  - `selectEndedDurationMs`;
  - `<EndedBlock onScanAnother>`.

- [ ] **Step 1: Add the copy (4 languages), and budget it**

| key                        | en                | es                    | fr                     | nl                 |
| -------------------------- | ----------------- | --------------------- | ---------------------- | ------------------ |
| `stream.ended.duration`    | On air {duration} | En directo {duration} | À l'antenne {duration} | Live {duration}    |
| `stream.ended.neverLive`   | Never went live   | No llegó a emitir     | Jamais passé en direct | Nooit live geweest |
| `stream.ended.scanAnother` | Scan another      | Escanear otro         | Scanner un autre       | Nog een scannen    |

Add `[/^stream\.ended\.scanAnother$/, 16]` and `[/^stream\.ended\.(duration|neverLive)$/, 24]` to `BUDGETS`.

- [ ] **Step 2: Write the failing tests**

`src/services/homeIntent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createHomeIntent } from '@/services/homeIntent';

describe('the scan-another hand-off (D24)', () => {
  it('has nothing to take at first', () => {
    expect(createHomeIntent().takeScan()).toBe(false);
  });

  it('is taken exactly once, however often it was asked', () => {
    const intent = createHomeIntent();
    intent.requestScan();
    intent.requestScan();
    expect(intent.takeScan()).toBe(true);
    expect(intent.takeScan()).toBe(false);
  });
});
```

`src/ui/screens/StreamScreen.ended.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STORE_KEYS } from '@/services/modeStore';
import { renderViewfinder } from '../../../test/renderViewfinder';

const plate = () => screen.getByTestId('tally-plate').textContent;

describe('Ended (spec §4)', () => {
  it.each([
    ['stopped', 'You stopped the broadcast.'],
    ['stopped-by-organiser', 'Stopped by the organiser'],
    ['fatal', 'Something failed. Your code is kept.'],
  ] as const)('%s shows the time on air and how it ended', async (scene, line) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(plate()).toBe('Ended');
    expect(screen.getByText('On air 0:12:34')).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Press and hold/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Scan another' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  it('says it never went live when it ended before the first frame', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    expect(screen.getByText('Never went live')).toBeTruthy();
    expect(screen.queryByText(/^On air/)).toBeNull();
  });

  it('Scan another forgets the spent code, goes Home, and asks Home to scan', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'Scan another' }));
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(view.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(view.ports.homeIntent.takeScan()).toBe(true);
  });

  it('leaves once for a double press', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    const forget = vi.spyOn(view.ports.modeStore, 'forget');
    const button = screen.getByRole('button', { name: 'Scan another' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(view.navigation.current()).toBe('home'));
    expect(forget).toHaveBeenCalledTimes(1);
    expect(view.engine.intents.filter((intent) => intent.kind === 'reset')).toHaveLength(1);
  });
});

describe('reopening while live (spec §1: the engine wins)', () => {
  it('comes back to the live viewfinder without arming again', async () => {
    const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
    expect(plate()).toBe('Live');
    expect(screen.getByText('0:12:34')).toBeTruthy();
    expect(view.engine.intents.some((intent) => intent.kind === 'arm')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  });
});
```

In `src/ui/screens/HomeScreen.test.tsx`, add:

```tsx
describe('Scan another (D24)', () => {
  it('scans from the Live Stream tile once Home is ready, and only once', async () => {
    const home = renderWithPorts(<HomeScreen />);
    home.ports.homeIntent.requestScan();
    await act(() => home.ports.modeStore.load());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    home.rerender(<HomeScreen />);
    expect(home.scanner.scans).toBe(1);
  });

  it('does nothing when nobody asked', async () => {
    const home = renderWithPorts(<HomeScreen />);
    await act(() => home.ports.modeStore.load());
    expect(home.scanner.scans).toBe(0);
  });
});
```

(`scanner.scans` is the fake scanner's own counter, from S0. The request is made before the store loads, which is the order a real hand-off arrives in: the leave navigates first and Home mounts loading.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/services/homeIntent.test.ts src/ui/screens/StreamScreen.ended.test.tsx src/ui/screens/HomeScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

`src/services/homeIntent.ts`:

```ts
/**
 * Ended's "Scan another" (D24): the viewfinder asks, Home scans. Only Home
 * calls `scan()` (S0), so a request is a flag Home takes once it is ready.
 */
export type HomeIntent = {
  requestScan(): void;
  /** True once per request; taking it clears it. */
  takeScan(): boolean;
};

export function createHomeIntent(): HomeIntent {
  let pending = false;
  return {
    requestScan: () => {
      pending = true;
    },
    takeScan: () => {
      const was = pending;
      pending = false;
      return was;
    },
  };
}
```

Wire it: `readonly homeIntent: HomeIntent;` in `Ports`, `homeIntent: createHomeIntent(),` in `nativePorts.ts` and in the fake `ports`.

Append to `src/hooks/engineSelectors.ts`:

```ts
/** Time on air when it ended; null for a session that never went live. */
export const selectEndedDurationMs = (snapshot: EngineSnapshot) =>
  snapshot.state.kind === 'ended' ? snapshot.state.durationMs : null;
```

In `src/hooks/useHome.ts`, add the hook and call it in `useHome()` right after `tapTile` is built, passing the store's ready flag as `useHome` already derives it:

```ts
/** Takes a "Scan another" hand-off (D24) once the store is ready, and scans from the Live Stream tile. */
function useScanRequest(ready: boolean, tapTile: (mode: Mode) => void): void {
  const { homeIntent } = usePorts();
  useEffect(() => {
    if (ready && homeIntent.takeScan()) tapTile('stream');
  }, [ready, homeIntent, tapTile]);
}
```

`src/ui/components/EndedBlock.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { selectEndedDurationMs } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { formatElapsed } from '@/i18n/formatElapsed';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** Spec §4's Ended: how long it was on air, then Scan another. Home is on the bottom strip. */
export const EndedBlock = memo(function EndedBlock({
  onScanAnother,
}: {
  onScanAnother: () => void;
}) {
  const { t } = useT();
  const durationMs = useEngineSelector(selectEndedDurationMs);
  const summary =
    durationMs === null
      ? t('stream.ended.neverLive')
      : t('stream.ended.duration', { duration: formatElapsed(durationMs) });
  return (
    <View style={styles.block}>
      <Text variant="metricValue">{summary}</Text>
      <Button label={t('stream.ended.scanAnother')} onPress={onScanAnother} />
    </View>
  );
});

const styles = StyleSheet.create({ block: { gap: space.sm } });
```

In `StreamColumn.tsx`:

- give `ColumnProps` and `ColumnAction` an `onScanAnother: () => void`;
- in `ColumnAction`, replace `if (view.action === 'ended') return null;` with `if (view.action === 'ended') return <EndedBlock onScanAnother={onScanAnother} />;`.

In `StreamScreen.tsx`, build it once:

```tsx
const { homeIntent } = usePorts();
const scanAnother = useCallback(() => {
  homeIntent.requestScan();
  leave.leave();
}, [homeIntent, leave.leave]);
```

Then pass `onScanAnother={scanAnother}` to `StreamColumn`. `leave.leave` is already one-at-a-time (S0's `useLeaveOnce`), which is what the double-press test holds it to.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Mutate scan flight at the hand-off once**

`cp src/services/homeIntent.ts /private/tmp/claude-501/s1a/homeIntent.bak`. In `takeScan`, delete `pending = false;`. Run `pnpm vitest run src/services/homeIntent.test.ts src/ui/screens/HomeScreen.test.tsx`. Expected: FAIL in both ('is taken exactly once…' and '…and only once'). Restore and re-run: PASS.

Then re-run S0's scan-flight mutation, since Home now has a second way to reach `scan()`: `cp src/services/scanFlight.ts /private/tmp/claude-501/s1a/scanFlight.bak`, make its guard always admit, and run `pnpm vitest run src/services/scanFlight.test.ts src/ui/screens/HomeScreen.test.tsx`. Expected: FAIL. Restore and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/homeIntent.ts src/services/homeIntent.test.ts src/ui/components/EndedBlock.tsx src/ui/components/StreamColumn.tsx src/ui/screens/StreamScreen.tsx src/ui/screens/StreamScreen.ended.test.tsx src/hooks/engineSelectors.ts src/hooks/useHome.ts src/ui/screens/HomeScreen.test.tsx src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(stream): Ended with time on air, and Scan another via Home

Home takes the hand-off once ready and scans from its tile, so only Home
ever calls scan(). A viewfinder opened on a live engine never re-arms.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a double press on Scan another and a repeated request are covered; (2) a session that never went live, and Home with no request, are covered; (3) reopening on a live engine after process death is covered; (4) the copy is budgeted in four languages.

---

### Task 24: Settings and Diagnostics routes, and the Settings screen

AGENTS §6: "Settings and Diagnostics stay reachable in every state, live included … Both screens carry a LIVE plate beside the way back." They live inside `app/stream/`, so only leaving the mode is blocked on air. Spec §4 Settings lists score preview on/off, controls left or right, power advice, and the open-source licences. D19, D22 and D23 apply.

**Files:**

- Modify: `src/services/devicePorts.ts` (`Route`)
- Modify: `src/services/native/expoRouterNavigation.ts`; create `src/services/native/expoRouterNavigation.test.ts`
- Create: `app/stream/settings.tsx`, `app/stream/diagnostics.tsx` (the second renders a placeholder until Task 25)
- Create: `src/hooks/useStreamLinks.ts`
- Create: `src/ui/screens/SettingsScreen.tsx`, `src/ui/screens/SettingsScreen.test.tsx`
- Create: `src/ui/components/SubScreenHeader.tsx`, `src/ui/components/ChoiceRow.tsx`
- Modify: `src/ui/components/StreamStage.tsx` (Settings and Diagnostics links on the bottom strip)
- Modify: `src/i18n/*.json`, `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `useStreamSettings` (Task 16), `LivePlate` (Task 17), `BackPort`, `NavigationPort`.
- Produces:
  - `Route = 'home' | 'stream' | 'streamSettings' | 'streamDiagnostics'`;
  - `createExpoRouterNavigation`, which pushes into a sub-route, goes back from one, and replaces otherwise;
  - `useStreamLinks(): {settings(); diagnostics()}` and `useBackToViewfinder(): () => void`;
  - `<SubScreenHeader title onBack>`, `<ChoiceRow label role checked onPress>`, `<SettingsScreen>`.

- [ ] **Step 1: Add the copy (4 languages), and budget it**

| key                        | en                                                                           | es                                                                                    | fr                                                                                              | nl                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `stream.link.settings`     | Settings                                                                     | Ajustes                                                                               | Réglages                                                                                        | Instellingen                                                                               |
| `stream.link.diagnostics`  | Diagnostics                                                                  | Diagnóstico                                                                           | Diagnostic                                                                                      | Diagnose                                                                                   |
| `stream.back`              | Back to camera                                                               | Volver a la cámara                                                                    | Retour à la caméra                                                                              | Terug naar camera                                                                          |
| `settings.title`           | Stream settings                                                              | Ajustes de emisión                                                                    | Réglages du direct                                                                              | Streaminstellingen                                                                         |
| `settings.overlay.label`   | Score preview                                                                | Vista del marcador                                                                    | Aperçu du score                                                                                 | Scorevoorbeeld                                                                             |
| `settings.overlay.hint`    | Shows the score over the camera on this phone only. Viewers always see it.   | Muestra el marcador sobre la cámara solo en este móvil. El público siempre lo ve.     | Affiche le score sur la caméra, sur ce téléphone seulement. Le public le voit toujours.         | Toont de score over de camera, alleen op deze telefoon. Kijkers zien hem altijd.           |
| `settings.side.label`      | Controls on the                                                              | Controles a la                                                                        | Commandes à                                                                                     | Bediening aan de                                                                           |
| `settings.side.left`       | Left                                                                         | Izquierda                                                                             | Gauche                                                                                          | Linkerkant                                                                                 |
| `settings.side.right`      | Right                                                                        | Derecha                                                                               | Droite                                                                                          | Rechterkant                                                                                |
| `settings.power.label`     | Power                                                                        | Batería                                                                               | Alimentation                                                                                    | Stroom                                                                                     |
| `settings.power.advice`    | A long match drains the battery. Plug in, or use a power bank on the tripod. | Un partido largo agota la batería. Conéctalo o usa una batería externa en el trípode. | Un long match vide la batterie. Branchez le téléphone ou fixez une batterie externe au trépied. | Een lange wedstrijd kost veel batterij. Sluit aan of gebruik een powerbank op het statief. |
| `settings.licences.label`  | Open-source licences                                                         | Licencias de código abierto                                                           | Licences open source                                                                            | Opensourcelicenties                                                                        |
| `settings.licences.entry`  | {name} — {licence}                                                           | {name} — {licence}                                                                    | {name} — {licence}                                                                              | {name} — {licence}                                                                         |
| `settings.licences.source` | libsrt source code: {url}                                                    | Código fuente de libsrt: {url}                                                        | Code source de libsrt : {url}                                                                   | Broncode van libsrt: {url}                                                                 |
| `settings.saveFailed`      | Couldn't save that. It applies until the app closes.                         | No se pudo guardar. Se aplica hasta cerrar la app.                                    | Impossible d'enregistrer. Valable jusqu'à la fermeture de l'app.                                | Kon niet opslaan. Geldt tot de app sluit.                                                  |

Add `[/^stream\.link\./, 14]` and `[/^stream\.back$/, 20]` to `BUDGETS`. The links share the bottom strip with the label and Home.

- [ ] **Step 2: Write the failing tests**

`src/services/native/expoRouterNavigation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({ router }));

import { createExpoRouterNavigation } from '@/services/native/expoRouterNavigation';

describe('the Expo Router adapter (D19)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces between modes: there is no back stack between them', () => {
    const navigation = createExpoRouterNavigation();
    navigation.go('stream');
    expect(router.replace).toHaveBeenCalledWith('/stream');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushes Settings over the viewfinder, so the camera stays mounted', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamSettings');
    expect(router.push).toHaveBeenCalledWith('/stream/settings');
    expect(navigation.current()).toBe('streamSettings');
  });

  it('goes back to the viewfinder rather than stacking a second one', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamDiagnostics');
    navigation.go('stream');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('ignores a repeated move', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamSettings');
    navigation.go('streamSettings');
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
```

(This file mocks `expo-router`, so it runs in the `domain` project on node. If that project's include pattern or the boundaries rule objects to `src/services/native/**` tests, name it in the batch report and move it under `test/`.)

`src/ui/screens/SettingsScreen.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { SETTINGS_KEY } from '@/services/streamSettingsStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';

function renderSettings(options: Parameters<typeof renderWithPorts>[1] = {}) {
  const view = renderWithPorts(<SettingsScreen />, options);
  view.navigation.go('stream');
  view.navigation.go('streamSettings');
  return view;
}

describe('Settings (spec §4)', () => {
  it('turns the score preview off, and saves it', async () => {
    const view = renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Score preview' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(view.kv.entries.get(SETTINGS_KEY)).toBe('{"v":1,"overlay":false,"side":"right"}'),
    );
  });

  it('moves the controls to the left', async () => {
    const view = renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(screen.getByRole('radio', { name: 'Left' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Right' }).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(view.kv.entries.get(SETTINGS_KEY)).toContain('"side":"left"'));
  });

  it('says when the phone refused to save, and keeps the choice', async () => {
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    const view = renderSettings();
    Object.assign(view.kv, refusing);
    fireEvent.click(screen.getByRole('switch', { name: 'Score preview' }));
    expect(
      await screen.findByText("Couldn't save that. It applies until the app closes."),
    ).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Score preview' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('lists the licences behind an expander, with the libsrt source', () => {
    renderSettings();
    expect(screen.queryByText('libsrt — MPL-2.0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open-source licences' }));
    expect(screen.getByText('libsrt — MPL-2.0')).toBeTruthy();
    expect(screen.getByText('StreamPack — Apache-2.0')).toBeTruthy();
    expect(screen.getByText('libsrt source code: https://github.com/Haivision/srt')).toBeTruthy();
  });

  it('goes back to the camera, by its button and by Back', () => {
    const view = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(view.navigation.current()).toBe('stream');
    view.navigation.go('streamSettings');
    expect(view.back.press()).toBe(true);
    expect(view.navigation.current()).toBe('stream');
  });

  it('carries the LIVE plate on air, and none off air (AGENTS §6)', () => {
    const view = renderSettings();
    expect(screen.queryByTestId('tally-plate')).toBeNull();
    act(() => view.engine.scene('live'));
    expect(screen.getByTestId('tally-plate').textContent).toBe('Live');
  });

  it('is reachable from the viewfinder on air', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(view.navigation.current()).toBe('streamSettings');
  });

  it('reads in Dutch', () => {
    renderSettings({ deviceLanguages: ['nl'] });
    expect(screen.getByRole('switch', { name: 'Scorevoorbeeld' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terug naar camera' })).toBeTruthy();
  });
});
```

(`Object.assign(view.kv, …)` swaps the write after the store was built over the same object. If the memory store's `set` is bound in a closure, which S0's may be, build the refusing store with `createFakePorts({ kv })` overrides instead, as `streamSettingsStore.test.ts` does.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/services/native/expoRouterNavigation.test.ts src/ui/screens/SettingsScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement navigation**

`src/services/devicePorts.ts`:

```ts
/** Settings and Diagnostics sit inside Live Stream (AGENTS §6): on air, only leaving the mode is blocked. */
export type Route = 'home' | 'stream' | 'streamSettings' | 'streamDiagnostics';
```

`src/services/native/expoRouterNavigation.ts`:

```ts
import { router } from 'expo-router';
import type { NavigationPort, Route } from '@/services/devicePorts';

type Path = '/' | '/stream' | '/stream/settings' | '/stream/diagnostics';

const PATH: Readonly<Record<Route, Path>> = {
  home: '/',
  stream: '/stream',
  streamSettings: '/stream/settings',
  streamDiagnostics: '/stream/diagnostics',
};

const SUB: ReadonlySet<Route> = new Set(['streamSettings', 'streamDiagnostics']);

/**
 * Between modes, `replace`: there is no back stack between them. Inside Live
 * Stream, Settings and Diagnostics are pushed over the viewfinder and popped
 * back to it (D19), so the camera is never remounted mid-match.
 */
export function createExpoRouterNavigation(initial: Route = 'home'): NavigationPort {
  let current = initial;
  return {
    current: () => current,
    go: (route) => {
      if (route === current) return;
      const from = current;
      current = route;
      if (from === 'stream' && SUB.has(route)) return router.push(PATH[route]);
      if (SUB.has(from) && route === 'stream') return router.back();
      router.replace(PATH[route]);
    },
  };
}
```

`src/hooks/useStreamLinks.ts`:

```ts
import { useCallback, useEffect } from 'react';
import { usePorts } from '@/hooks/usePorts';

/** The viewfinder's ways into Settings and Diagnostics, open in every state. */
export function useStreamLinks(): { settings(): void; diagnostics(): void } {
  const { navigation } = usePorts();
  const settings = useCallback(() => navigation.go('streamSettings'), [navigation]);
  const diagnostics = useCallback(() => navigation.go('streamDiagnostics'), [navigation]);
  return { settings, diagnostics };
}

/**
 * Back from Settings or Diagnostics returns to the camera. Subscribed after the
 * viewfinder's own Back, so it is asked first (BackHandler: newest first), and
 * the viewfinder's leave rule never runs from here.
 */
export function useBackToViewfinder(): () => void {
  const { navigation, back } = usePorts();
  const toCamera = useCallback(() => navigation.go('stream'), [navigation]);
  useEffect(
    () =>
      back.subscribe(() => {
        toCamera();
        return true;
      }),
    [back, toCamera],
  );
  return toCamera;
}
```

- [ ] **Step 5: Implement the screen**

`src/ui/components/SubScreenHeader.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { LivePlate } from '@/ui/components/LivePlate';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** The way back, with the LIVE plate beside it so the broadcast is never out of sight (AGENTS §6). */
export const SubScreenHeader = memo(function SubScreenHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <View style={styles.header}>
      <GhostButton label={t('stream.back')} onPress={onBack} />
      <LivePlate />
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
});
```

`src/ui/components/ChoiceRow.tsx`:

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type ChoiceRowProps = {
  readonly label: string;
  readonly role: 'switch' | 'radio';
  readonly checked: boolean;
  readonly onPress: () => void;
};

/** A switch or a radio as one large row: easy to hit on a tripod, and its state is said, not only shown. */
export const ChoiceRow = memo(function ChoiceRow({
  label,
  role,
  checked,
  onPress,
}: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      style={checked ? rowOn : styles.row}
    >
      <Text variant="control">{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 2,
    borderColor: colour.rule,
  },
  on: { borderColor: colour.lime },
});

const rowOn = [styles.row, styles.on];
```

`src/ui/screens/SettingsScreen.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { useBackToViewfinder } from '@/hooks/useStreamLinks';
import { useStreamSettings } from '@/hooks/useStreamSettings';
import { ChoiceRow } from '@/ui/components/ChoiceRow';
import { GhostButton } from '@/ui/components/GhostButton';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/** D22: shipped and linked native code, and the one source link MPL-2.0 asks for. */
const LICENCES: readonly { name: string; licence: string }[] = [
  { name: 'libsrt', licence: 'MPL-2.0' },
  { name: 'StreamPack', licence: 'Apache-2.0' },
  { name: 'react-native-webview', licence: 'MIT' },
  { name: 'expo-video', licence: 'MIT' },
  { name: 'React Native', licence: 'MIT' },
  { name: 'Expo', licence: 'MIT' },
];
const LIBSRT_SOURCE = 'https://github.com/Haivision/srt';

/** Spec §4's Settings. Nothing here disturbs a live broadcast, so nothing is disabled on air. */
export function SettingsScreen() {
  const { t } = useT();
  const toCamera = useBackToViewfinder();
  const { settings, change, saveFailed } = useStreamSettings();
  const toggleOverlay = useCallback(
    () => change({ overlay: !settings.overlay }),
    [change, settings.overlay],
  );
  const toLeft = useCallback(() => change({ side: 'left' }), [change]);
  const toRight = useCallback(() => change({ side: 'right' }), [change]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SubScreenHeader title={t('settings.title')} onBack={toCamera} />
      <ChoiceRow
        label={t('settings.overlay.label')}
        role="switch"
        checked={settings.overlay}
        onPress={toggleOverlay}
      />
      <Text variant="metricUnit">{t('settings.overlay.hint')}</Text>
      <Text variant="control">{t('settings.side.label')}</Text>
      <View style={styles.pair}>
        <ChoiceRow
          label={t('settings.side.left')}
          role="radio"
          checked={settings.side === 'left'}
          onPress={toLeft}
        />
        <ChoiceRow
          label={t('settings.side.right')}
          role="radio"
          checked={settings.side === 'right'}
          onPress={toRight}
        />
      </View>
      <Text variant="control">{t('settings.power.label')}</Text>
      <Text variant="body">{t('settings.power.advice')}</Text>
      <Licences />
      {saveFailed ? <Text variant="status">{t('settings.saveFailed')}</Text> : null}
    </ScrollView>
  );
}

function Licences() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return (
    <View style={styles.licences}>
      <GhostButton label={t('settings.licences.label')} onPress={toggle} />
      {open
        ? LICENCES.map((entry) => (
            <Text key={entry.name} variant="metricUnit">
              {t('settings.licences.entry', entry)}
            </Text>
          ))
        : null}
      {open ? (
        <Text variant="metricUnit">{t('settings.licences.source', { url: LIBSRT_SOURCE })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  content: { gap: space.sm, padding: space.md },
  pair: { flexDirection: 'row', gap: space.sm },
  licences: { gap: space.xs },
});
```

(The `.map` arrow inside `Licences` is the one render-time function here. It is not a HUD component, so AGENTS §8's rule does not bind it; hoist it to a module-level `renderLicence` if lint or review asks. `ChoiceRow`'s `aria-checked` duplicates `accessibilityState` because react-native-web maps the latter to `aria-checked` only for some roles. Keep whichever the test proves is needed, and drop the other.)

`app/stream/settings.tsx`:

```tsx
import { SettingsScreen } from '@/ui/screens/SettingsScreen';

export default function StreamSettingsRoute() {
  return <SettingsScreen />;
}
```

`app/stream/diagnostics.tsx` renders `null` until Task 25, so the route exists and `Route` has no dead member:

```tsx
export default function StreamDiagnosticsRoute() {
  return null;
}
```

In `StreamStage.tsx`, take `onSettings` and `onDiagnostics` props from `StreamScreen` (built there with `useStreamLinks()`), and add two `GhostButton`s to the bottom strip after the label: `t('stream.link.settings')` and `t('stream.link.diagnostics')`. They are shown in every state, with no `canLeave` condition.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Mutate the sub-route push once**

`cp src/services/native/expoRouterNavigation.ts /private/tmp/claude-501/s1a/nav.bak`. Delete the `router.push` line. Run `pnpm vitest run src/services/native/expoRouterNavigation.test.ts`. Expected: FAIL ('pushes Settings over the viewfinder…'). Restore and re-run: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/devicePorts.ts src/services/native/expoRouterNavigation.ts src/services/native/expoRouterNavigation.test.ts app/stream/settings.tsx app/stream/diagnostics.tsx src/hooks/useStreamLinks.ts src/ui/components/SubScreenHeader.tsx src/ui/components/ChoiceRow.tsx src/ui/components/StreamStage.tsx src/ui/screens/StreamScreen.tsx src/ui/screens/SettingsScreen.tsx src/ui/screens/SettingsScreen.test.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json src/i18n/budgets.test.ts
git commit -F - <<'EOF'
feat(stream): Settings, reachable on air, over the mounted viewfinder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) a repeated move is covered; (2) a refused save is covered; (3) Back, both the button and Android's, is covered; (4) Dutch, on air and off air are covered. The side swap's layout is device-only.

---

### Task 25: Diagnostics, the session record and Share, and dev scenes

Spec §4 Diagnostics: link, delivery, device and heartbeat values, plus the session record with **Share record**. AGENTS §5: Geist Mono for Diagnostics values. D20, D21, D25 and D32 apply. The old `DevEngineControls` becomes dev-only scene buttons here.

**Files:**

- Create: `src/hooks/diagnostics.ts`, `src/hooks/diagnostics.test.ts`
- Create: `src/hooks/useDevScenes.ts`, `src/ui/components/DevScenes.tsx`
- Create: `src/ui/components/DiagnosticsSection.tsx`
- Create: `src/ui/screens/DiagnosticsScreen.tsx`, `src/ui/screens/DiagnosticsScreen.test.tsx`
- Modify: `src/services/devicePorts.ts` (`SharePort`); create `src/services/native/nativeShare.ts`
- Modify: `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`
- Modify: `app/stream/diagnostics.tsx`
- Delete: `src/ui/components/DevEngineControls.tsx`
- Modify: `src/i18n/*.json` (add `diag.*` and `stream.dev.scene`; remove `stream.dev.arm`, `.live`, `.stop`, `.fail` and `.state`)

**Interfaces:**

- Consumes: `EngineSnapshot`, `Translator`, `SessionRecord`, `FAKE_SCENES`, `Ports.devEngine`.
- Produces:
  - `SharePort {share(text): Promise<void>}`, `createNativeShare()`, and `FakePorts.share` with `shared: string[]` and `refuse()`;
  - `DiagnosticsRow`, `DiagnosticsSection`, `diagnosticsSections(snapshot, nowMs, t)`, `RECORD_TAIL = 20`;
  - `useDevScenes(): {scenes, play(scene)} | null`;
  - `<DiagnosticsSection>`, `<DevScenes>`, `<DiagnosticsScreen>`.
- Logged: `record.shared` and `record.share-failed`.

- [ ] **Step 1: Add the copy (4 languages)**

| key                      | en                     | es                    | fr                  | nl                     |
| ------------------------ | ---------------------- | --------------------- | ------------------- | ---------------------- |
| `diag.title`             | Diagnostics            | Diagnóstico           | Diagnostic          | Diagnose               |
| `diag.section.link`      | Link                   | Enlace                | Liaison             | Verbinding             |
| `diag.section.delivery`  | Delivery               | Entrega               | Diffusion           | Levering               |
| `diag.section.device`    | Phone                  | Móvil                 | Téléphone           | Telefoon               |
| `diag.section.heartbeat` | Heartbeat              | Latido                | Battement           | Hartslag               |
| `diag.section.record`    | Session record         | Registro de la sesión | Journal de session  | Sessielogboek          |
| `diag.transport`         | Transport              | Transporte            | Transport           | Transport              |
| `diag.bitrate`           | Bitrate                | Tasa de bits          | Débit               | Bitrate                |
| `diag.target`            | Target                 | Objetivo              | Cible               | Doel                   |
| `diag.fps`               | Video                  | Vídeo                 | Vidéo               | Video                  |
| `diag.audio`             | Audio                  | Audio                 | Audio               | Audio                  |
| `diag.rtt`               | Round trip             | Ida y vuelta          | Aller-retour        | Rondreis               |
| `diag.resent`            | Resent                 | Reenviados            | Renvoyés            | Opnieuw verzonden      |
| `diag.dropped`           | Dropped                | Perdidos              | Perdus              | Verloren               |
| `diag.delivery`          | Viewers receiving      | El público recibe     | Le public reçoit    | Kijkers ontvangen      |
| `diag.lag`               | Behind live            | Retraso               | Retard              | Achterstand            |
| `diag.checked`           | Checked                | Comprobado            | Vérifié             | Gecontroleerd          |
| `diag.data`              | Data used              | Datos usados          | Données utilisées   | Dataverbruik           |
| `diag.battery`           | Battery                | Batería               | Batterie            | Batterij               |
| `diag.drain`             | Drain                  | Consumo               | Consommation        | Verbruik               |
| `diag.charging`          | Charging               | Cargando              | En charge           | Laden                  |
| `diag.thermal`           | Heat                   | Temperatura           | Chaleur             | Warmte                 |
| `diag.hbSent`            | Last sent              | Último envío          | Dernier envoi       | Laatst verzonden       |
| `diag.hbResult`          | Last result            | Último resultado      | Dernier résultat    | Laatste resultaat      |
| `diag.hbFailures`        | Failures               | Fallos                | Échecs              | Mislukt                |
| `diag.unit.kbps`         | {value} kbps           | {value} kbps          | {value} kbps        | {value} kbps           |
| `diag.unit.fps`          | {value} fps            | {value} fps           | {value} i/s         | {value} fps            |
| `diag.unit.pps`          | {value} packets/s      | {value} paquetes/s    | {value} paquets/s   | {value} pakketten/s    |
| `diag.unit.ms`           | {value} ms             | {value} ms            | {value} ms          | {value} ms             |
| `diag.unit.seconds`      | {value} s              | {value} s             | {value} s           | {value} s              |
| `diag.unit.ago`          | {value} s ago          | hace {value} s        | il y a {value} s    | {value} s geleden      |
| `diag.unit.mb`           | {value} MB             | {value} MB            | {value} Mo          | {value} MB             |
| `diag.unit.percent`      | {value}%               | {value} %             | {value} %           | {value}%               |
| `diag.unit.perHour`      | {value}%/h             | {value} %/h           | {value} %/h         | {value}%/u             |
| `diag.unit.ofSent`       | {value} of {total}     | {value} de {total}    | {value} sur {total} | {value} van {total}    |
| `diag.none`              | —                      | —                     | —                   | —                      |
| `diag.yes`               | Yes                    | Sí                    | Oui                 | Ja                     |
| `diag.no`                | No                     | No                    | Non                 | Nee                    |
| `diag.delivery.ok`       | Yes                    | Sí                    | Oui                 | Ja                     |
| `diag.delivery.stalled`  | Stalled                | Detenido              | Bloqué              | Vastgelopen            |
| `diag.delivery.unknown`  | Not checked yet        | Aún sin comprobar     | Pas encore vérifié  | Nog niet gecontroleerd |
| `diag.thermal.none`      | Normal                 | Normal                | Normale             | Normaal                |
| `diag.thermal.light`     | Warm                   | Templado              | Tiède               | Warm                   |
| `diag.thermal.moderate`  | Hot                    | Caliente              | Chaud               | Heet                   |
| `diag.thermal.severe`    | Very hot               | Muy caliente          | Très chaud          | Erg heet               |
| `diag.thermal.critical`  | Critical               | Crítico               | Critique            | Kritiek                |
| `diag.thermal.emergency` | Emergency              | Emergencia            | Urgence             | Noodgeval              |
| `diag.thermal.shutdown`  | Shutting down          | Apagándose            | Arrêt en cours      | Wordt uitgeschakeld    |
| `diag.hb.ok`             | Accepted               | Aceptado              | Accepté             | Geaccepteerd           |
| `diag.hb.failed`         | Failed                 | Falló                 | Échec               | Mislukt                |
| `diag.hb.sessionOver`    | Session over           | Sesión terminada      | Session terminée    | Sessie voorbij         |
| `diag.share`             | Share record           | Compartir registro    | Partager le journal | Logboek delen          |
| `diag.shareFailed`       | Couldn't open sharing. | No se pudo compartir. | Partage impossible. | Delen lukte niet.      |
| `stream.dev.scene`       | Scene: {scene}         | Escena: {scene}       | Scène : {scene}     | Scène: {scene}         |

- [ ] **Step 2: Write the failing tests**

`src/hooks/diagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { diagnosticsSections } from '@/hooks/diagnostics';
import { createTranslator } from '@/i18n/translate';

const NOW = Date.parse('2026-10-03T13:00:00Z');
const t = createTranslator('en').t;

function sectionsFor(scene: Parameters<ReturnType<typeof createFakeCaptureEngine>['scene']>[0]) {
  const engine = createFakeCaptureEngine(() => NOW);
  engine.scene(scene);
  const sections = diagnosticsSections(engine.getSnapshot(), NOW, t);
  engine.dispose();
  return Object.fromEntries(
    sections.flatMap((section) => section.rows.map((row) => [row.label, row.value])),
  );
}

describe('diagnosticsSections (spec §4)', () => {
  it('reads the live link, delivery, phone and heartbeat', () => {
    expect(sectionsFor('live')).toMatchObject({
      Transport: 'SRT',
      Bitrate: '2840 kbps',
      Target: '3000 kbps',
      Video: '30 fps',
      Audio: '47 packets/s',
      'Round trip': '48 ms',
      Resent: '240 of 120000',
      Dropped: '3',
      'Viewers receiving': 'Yes',
      'Behind live': '9.2 s',
      Checked: '1.5 s ago',
      'Data used': '312 MB',
      Battery: '74%',
      Drain: '18%/h',
      Charging: 'No',
      Heat: 'Normal',
      'Last sent': '4 s ago',
      'Last result': 'Accepted',
      Failures: '0',
    });
  });

  it('says what is unknown rather than inventing a number', () => {
    expect(sectionsFor('fell-back')).toMatchObject({
      Transport: 'RTMPS',
      'Round trip': '—',
      Resent: '—',
    });
    expect(sectionsFor('armed-ready')).toMatchObject({ Transport: '—', Bitrate: '—', Target: '—' });
  });

  it('names the heat step and the stall', () => {
    expect(sectionsFor('shed')).toMatchObject({ Heat: 'Very hot' });
    expect(sectionsFor('not-delivered')).toMatchObject({
      'Viewers receiving': 'Stalled',
      'Behind live': '21 s',
    });
  });
});
```

(Numbers are left ungrouped, `120000` and not `120,000`, so no locale decides a separator. If review wants grouping, use `Intl.NumberFormat(lang)` in one place and adjust these expectations from the fixture, not from the function.)

`src/ui/screens/DiagnosticsScreen.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { readRecord } from '../../../test/fakePorts';
import { captureWire } from '../../../test/fixtures/wire';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('Diagnostics (spec §4)', () => {
  it('shows live values and follows the 1 Hz report (D32)', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    act(() => view.engine.scene('live'));
    expect(screen.getByText('2840 kbps')).toBeTruthy();
    act(() => view.engine.patch({ bitrateKbps: 3000 }));
    expect(screen.getByText('3000 kbps')).toBeTruthy();
  });

  it('carries the LIVE plate on air', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    act(() => view.engine.scene('holding'));
    expect(screen.getByTestId('tally-plate').textContent).toBe('Trouble');
  });

  it('shows the latest session record lines and shares them, with no secret in them', async () => {
    const view = await renderViewfinder();
    view.rerender(<DiagnosticsScreen />);
    expect(screen.getByText(/intent\.arm/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    await waitFor(() => expect(view.share.shared).toHaveLength(1));
    const shared = view.share.shared[0] ?? '';
    expect(shared).toContain('intent.arm');
    const cred = captureWire().cred as {
      token: string;
      srt: { passphrase: string; streamId: string };
    };
    for (const secret of [cred.token, cred.srt.passphrase, cred.srt.streamId]) {
      expect(shared.includes(secret)).toBe(false);
    }
    expect(readRecord(view.record).map((entry) => entry.event)).toContain('record.shared');
  });

  it('says when sharing could not open, and records it', async () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    view.share.refuse();
    fireEvent.click(screen.getByRole('button', { name: 'Share record' }));
    expect(await screen.findByText("Couldn't open sharing.")).toBeTruthy();
    expect(readRecord(view.record).map((entry) => entry.event)).toContain('record.share-failed');
  });

  it('plays any fake scene in a development build', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Scene: holding' }));
    expect(view.engine.getSnapshot().state.kind).toBe('reconnecting');
  });

  it('shows no scenes in a release build', () => {
    renderWithPorts(<DiagnosticsScreen />, { devTools: false, devEngine: null });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
  });

  it('goes back to the camera', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    view.navigation.go('stream');
    view.navigation.go('streamDiagnostics');
    expect(view.back.press()).toBe(true);
    expect(view.navigation.current()).toBe('stream');
  });
});
```

(Read the fixture's field names for the token, passphrase and stream id from `test/fixtures/wire.ts`, which Task 5 wrote; the cast above follows Task 6's. `view.rerender` keeps the same ports, so the record holds the arm the viewfinder logged.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/hooks/diagnostics.test.ts src/ui/screens/DiagnosticsScreen.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the share port**

In `src/services/devicePorts.ts`:

```ts
/** The system share sheet (D21). Rejects when it could not open. */
export interface SharePort {
  share(text: string): Promise<void>;
}
```

`src/services/native/nativeShare.ts`:

```ts
import { Share } from 'react-native';
import type { SharePort } from '@/services/devicePorts';

/** React Native's own share sheet: no new dependency (D21). */
export function createNativeShare(): SharePort {
  return {
    share: async (text) => {
      await Share.share({ message: text });
    },
  };
}
```

In `test/fakePorts.ts`, add a `fakeShare()` beside the others and put it in `fakes`:

```ts
function fakeShare(): SharePort & { readonly shared: string[]; refuse(): void } {
  const shared: string[] = [];
  let refusing = false;
  return {
    shared,
    refuse: () => {
      refusing = true;
    },
    share: async (text) => {
      if (refusing) throw new Error('share sheet refused');
      shared.push(text);
    },
  };
}
```

Wire `readonly share: SharePort;` into `Ports`, and `share: createNativeShare(),` into `nativePorts.ts`.

- [ ] **Step 5: Implement the rows, the scenes and the screen**

`src/hooks/diagnostics.ts`:

```ts
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';
import type { Translator } from '@/i18n/translate';

export type DiagnosticsRow = { readonly label: string; readonly value: string };
export type DiagnosticsSection = {
  readonly title: string;
  readonly rows: readonly DiagnosticsRow[];
};

/** How many session-record lines the screen shows; Share sends them all. */
export const RECORD_TAIL = 20;

type T = Translator['t'];

/**
 * Spec §4's Diagnostics, as label and value text. Unknown is "—", never a
 * zero: a value the phone has not measured must not read as a measurement.
 */
export function diagnosticsSections(
  snapshot: EngineSnapshot,
  nowMs: number,
  t: T,
): DiagnosticsSection[] {
  const tel = snapshot.telemetry;
  const row = (label: MessageKey, value: string): DiagnosticsRow => ({ label: t(label), value });
  return [
    {
      title: t('diag.section.link'),
      rows: linkRows(snapshot, t).map(([label, value]) => row(label, value)),
    },
    {
      title: t('diag.section.delivery'),
      rows: deliveryRows(tel, nowMs, t).map(([label, value]) => row(label, value)),
    },
    {
      title: t('diag.section.device'),
      rows: deviceRows(tel, t).map(([label, value]) => row(label, value)),
    },
    {
      title: t('diag.section.heartbeat'),
      rows: heartbeatRows(tel, nowMs, t).map(([label, value]) => row(label, value)),
    },
  ];
}

type Pair = readonly [MessageKey, string];

const unit = (t: T, key: MessageKey, value: number | null): string =>
  value === null ? t('diag.none') : t(key, { value });
const secondsAgo = (t: T, nowMs: number, atMs: number | null): string =>
  atMs === null ? t('diag.none') : t('diag.unit.ago', { value: roundTenth((nowMs - atMs) / 1000) });
const roundTenth = (value: number) => Math.round(value * 10) / 10;

function linkRows(snapshot: EngineSnapshot, t: T): Pair[] {
  const { state, telemetry: tel } = snapshot;
  const transport = 'transport' in state ? state.transport.toUpperCase() : t('diag.none');
  const srt = tel.srt;
  return [
    ['diag.transport', transport],
    ['diag.bitrate', unit(t, 'diag.unit.kbps', tel.bitrateKbps)],
    ['diag.target', unit(t, 'diag.unit.kbps', tel.targetBitrateKbps)],
    ['diag.fps', unit(t, 'diag.unit.fps', tel.encodedVideoFps)],
    ['diag.audio', unit(t, 'diag.unit.pps', tel.audioPacketsPerSecond)],
    ['diag.rtt', unit(t, 'diag.unit.ms', srt?.rttMs ?? null)],
    [
      'diag.resent',
      srt === null
        ? t('diag.none')
        : t('diag.unit.ofSent', { value: srt.retransmitted, total: srt.sent }),
    ],
    ['diag.dropped', srt === null ? t('diag.none') : String(srt.dropped)],
  ];
}

const DELIVERY: Readonly<Record<Telemetry['delivery'], MessageKey>> = {
  ok: 'diag.delivery.ok',
  stalled: 'diag.delivery.stalled',
  unknown: 'diag.delivery.unknown',
};

function deliveryRows(tel: Telemetry, nowMs: number, t: T): Pair[] {
  const lag = tel.deliveredLagMs === null ? null : roundTenth(tel.deliveredLagMs / 1000);
  return [
    ['diag.delivery', t(DELIVERY[tel.delivery])],
    ['diag.lag', unit(t, 'diag.unit.seconds', lag)],
    ['diag.checked', secondsAgo(t, nowMs, tel.deliveryCheckedAtMs)],
    ['diag.data', t('diag.unit.mb', { value: Math.round(tel.dataUsedBytes / 1_000_000) })],
  ];
}

function deviceRows(tel: Telemetry, t: T): Pair[] {
  const charging =
    tel.charging === null ? t('diag.none') : t(tel.charging ? 'diag.yes' : 'diag.no');
  const thermal =
    tel.thermalStatus === null ? t('diag.none') : t(`diag.thermal.${tel.thermalStatus}`);
  return [
    ['diag.battery', unit(t, 'diag.unit.percent', tel.batteryPercent)],
    ['diag.drain', unit(t, 'diag.unit.perHour', tel.drainPctPerHour)],
    ['diag.charging', charging],
    ['diag.thermal', thermal],
  ];
}

const HEARTBEAT: Readonly<Record<NonNullable<Telemetry['heartbeat']['lastResult']>, MessageKey>> = {
  ok: 'diag.hb.ok',
  failed: 'diag.hb.failed',
  'session-over': 'diag.hb.sessionOver',
};

function heartbeatRows(tel: Telemetry, nowMs: number, t: T): Pair[] {
  const { lastSentAtEpochMs, lastResult, failures } = tel.heartbeat;
  const result = lastResult === null ? t('diag.none') : t(HEARTBEAT[lastResult]);
  return [
    ['diag.hbSent', secondsAgo(t, nowMs, lastSentAtEpochMs)],
    ['diag.hbResult', result],
    ['diag.hbFailures', String(failures)],
  ];
}
```

(``t(`diag.thermal.${…}`)`` needs the template type to narrow to `MessageKey`. If TypeScript refuses it, use a `Record<ThermalStatus, MessageKey>` table like `DELIVERY`. Heat is shown here as a device condition only (AGENTS §8), never as a broadcast state.)

`src/hooks/useDevScenes.ts`:

```ts
import { useCallback } from 'react';
import { FAKE_SCENES, type FakeScene } from '@/engine/FakeCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/** Dev builds only (D25): every state of spec §6, one tap away on a laptop or a phone. */
export function useDevScenes(): {
  readonly scenes: readonly FakeScene[];
  play(scene: FakeScene): void;
} | null {
  const { devEngine, devTools } = usePorts();
  const play = useCallback((scene: FakeScene) => devEngine?.scene(scene), [devEngine]);
  return devTools && devEngine !== null ? { scenes: FAKE_SCENES, play } : null;
}
```

`src/ui/components/DevScenes.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDevScenes } from '@/hooks/useDevScenes';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

export const DevScenes = memo(function DevScenes() {
  const { t } = useT();
  const dev = useDevScenes();
  if (dev === null) return null;
  return (
    <View style={styles.block}>
      <Text variant="control">{t('stream.dev.title')}</Text>
      {dev.scenes.map((scene) => (
        <GhostButton
          key={scene}
          label={t('stream.dev.scene', { scene })}
          onPress={() => dev.play(scene)}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({ block: { gap: space.xs } });
```

(Dev-only and off the HUD, so the per-scene arrow is acceptable; review may ask for a `SceneButton` component instead.)

`src/ui/components/DiagnosticsSection.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DiagnosticsSection as Section } from '@/hooks/diagnostics';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/** Values in Geist Mono with tabular figures (AGENTS §5): a column of numbers that does not twitch. */
export const DiagnosticsSection = memo(function DiagnosticsSection({
  section,
}: {
  section: Section;
}) {
  return (
    <View style={styles.section}>
      <Text variant="control">{section.title}</Text>
      {section.rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text variant="metricUnit" style={styles.label}>
            {row.label}
          </Text>
          <Text variant="metricValue" style={styles.value}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  section: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  label: { flex: 1 },
  value: { fontVariant: ['tabular-nums'] },
});
```

`src/ui/screens/DiagnosticsScreen.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { diagnosticsSections, RECORD_TAIL } from '@/hooks/diagnostics';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { useBackToViewfinder } from '@/hooks/useStreamLinks';
import { Button } from '@/ui/components/Button';
import { DevScenes } from '@/ui/components/DevScenes';
import { DiagnosticsSection } from '@/ui/components/DiagnosticsSection';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

const whole = <T,>(snapshot: T) => snapshot;

/** Spec §4's Diagnostics. Re-renders at 1 Hz on purpose: it shows ticking values and is not the HUD (D32). */
export function DiagnosticsScreen() {
  const { t } = useT();
  const { clock } = usePorts();
  const toCamera = useBackToViewfinder();
  const snapshot = useEngineSelector(whole);
  const sections = diagnosticsSections(snapshot, clock().getTime(), t);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SubScreenHeader title={t('diag.title')} onBack={toCamera} />
      {sections.map((section) => (
        <DiagnosticsSection key={section.title} section={section} />
      ))}
      <SessionRecord />
      <DevScenes />
    </ScrollView>
  );
}

function SessionRecord() {
  const { t } = useT();
  const { record, share, logger } = usePorts();
  const [failed, setFailed] = useState(false);
  const lines = record.lines();
  const send = useCallback(() => {
    share.share(record.lines().join('\n')).then(
      () => logger.info('record.shared', { lines: record.lines().length }),
      () => {
        logger.warn('record.share-failed');
        setFailed(true);
      },
    );
  }, [share, record, logger]);
  return (
    <View style={styles.record}>
      <Text variant="control">{t('diag.section.record')}</Text>
      {lines.slice(-RECORD_TAIL).map((line, index) => (
        <Text key={index} variant="metricValue" numberOfLines={2}>
          {line}
        </Text>
      ))}
      <Button label={t('diag.share')} onPress={send} />
      {failed ? <Text variant="status">{t('diag.shareFailed')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  content: { gap: space.md, padding: space.md },
  record: { gap: space.xs },
});
```

(The record is already scrubbed at write time, by Task 1's allow-list, so Share sends nothing that was not safe to keep. The share test pins that at the edge. `whole` is the D32 identity selector; `useEngineSelector` compares by identity, and the snapshot object changes at each 1 Hz report, which is the intent.)

`app/stream/diagnostics.tsx`:

```tsx
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';

export default function StreamDiagnosticsRoute() {
  return <DiagnosticsScreen />;
}
```

Delete the old controls and their keys:

```bash
git rm src/ui/components/DevEngineControls.tsx
```

Remove `stream.dev.arm`, `stream.dev.live`, `stream.dev.stop`, `stream.dev.fail` and `stream.dev.state` from all four dictionaries. Keep `stream.dev.title`.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: PASS. `rg -n "DevEngineControls|stream\.dev\.(arm|live|stop|fail|state)" src app test` prints nothing. `rg -n "share" src/hooks/nativePorts.ts` shows the native port wired (failure class 1).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/diagnostics.ts src/hooks/diagnostics.test.ts src/hooks/useDevScenes.ts src/ui/components/DevScenes.tsx src/ui/components/DiagnosticsSection.tsx src/ui/screens/DiagnosticsScreen.tsx src/ui/screens/DiagnosticsScreen.test.tsx src/services/devicePorts.ts src/services/native/nativeShare.ts src/hooks/usePorts.tsx src/hooks/nativePorts.ts test/fakePorts.ts app/stream/diagnostics.tsx src/i18n/en.json src/i18n/es.json src/i18n/fr.json src/i18n/nl.json
git commit -F - <<'EOF'
feat(stream): Diagnostics with the session record, Share, and dev scenes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Four questions: (1) not applicable: Share twice shares twice, which is harmless; (2) unknown values, a release build with no scenes, and a refused share sheet are covered; (3) not applicable; (4) Diagnostics copy is present in four languages (the Task 26 sweep).

---

### Task 26: Phase 2 gate: locales, the four questions, the mutation record, and the device list

**Files:**

- Create: `src/ui/screens/StreamScreen.locales.test.tsx`
- Modify: nothing else unless the sweep finds a gap.

- [ ] **Step 1: Sweep every state in every language for a raw key**

`src/ui/screens/StreamScreen.locales.test.tsx`:

```tsx
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FAKE_SCENES } from '@/engine/FakeCaptureEngine';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderViewfinder } from '../../../test/renderViewfinder';

const LANGS = ['en', 'es', 'fr', 'nl'] as const;
/** What `t()` prints for a key no dictionary has. */
const RAW_KEY = /\b(stream|settings|diag|home|mode)\.[a-z]+[A-Za-z.]*\b/;

describe('no screen in any state shows a raw key (AGENTS §10, question 4)', () => {
  it.each(LANGS.flatMap((lang) => FAKE_SCENES.map((scene) => [lang, scene] as const)))(
    '%s, %s',
    async (lang, scene) => {
      const view = await renderViewfinder({ deviceLanguages: [lang] });
      act(() => view.engine.scene(scene));
      expect(document.body.textContent ?? '').not.toMatch(RAW_KEY);
      view.rerender(<SettingsScreen />);
      expect(document.body.textContent ?? '').not.toMatch(RAW_KEY);
      view.rerender(<DiagnosticsScreen />);
      expect(document.body.textContent ?? '').not.toMatch(RAW_KEY);
    },
  );
});
```

Run: `pnpm vitest run src/ui/screens/StreamScreen.locales.test.tsx src/i18n`
Expected: PASS: 60 sweep cases (4 languages × 15 scenes), plus the dictionary and budget tests. A raw key found is a missing translation; add it to the dictionary, never loosen the pattern. Then check that the pattern catches one: temporarily rename `stream.tally.live` in `fr.json` (back it up with `cp` first), run the file, and expect a FAIL. Restore it.

(The URL in the licences `libsrt source code: https://github.com/…` does not match the pattern. If a record line in Diagnostics does, for example `stream.unusable-code`, exclude the record block by rendering Diagnostics with an empty record, or scope the check to everything outside `SessionRecord`. Say which in the batch report.)

- [ ] **Step 2: Run the whole check, and record the counts**

```bash
pnpm check > /private/tmp/claude-501/s1a/check.txt 2>&1; echo "EXIT=$?"
pnpm vitest run --reporter=json --outputFile=/private/tmp/claude-501/s1a/r.json > /dev/null 2>&1; echo "EXIT=$?"
node -e 'const r=require("/private/tmp/claude-501/s1a/r.json");console.log({total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,suites:r.numTotalTestSuites,failedSuites:r.numFailedTestSuites})'
pnpm prettier --check package.json docs
```

Expected: both `EXIT=0`; `failed: 0` and `failedSuites: 0`; `total` above the phase 1 gate's count. Put the numbers in the batch report. `PASS(0) FAIL(0)` from a summary is not a count.

- [ ] **Step 3: Answer the four questions, for the whole of phase 2**

Fill in the table in the batch report. Every cell names a test, or says why none applies.

| Question                       | Arm                               | On air                         | Ended / Home                                | Settings / Diagnostics                       |
| ------------------------------ | --------------------------------- | ------------------------------ | ------------------------------------------- | -------------------------------------------- |
| 1. A second call               | arm once per visit; a second hold | Stop held twice                | Scan another twice; the hand-off taken once | a repeated `go`                              |
| 2. An empty input              | an unreadable code; no deadline   | no peek before air             | never went live                             | unknown values; release build; nothing saved |
| 3. After an interruption       | deadline passed before the visit  | overlay crash and load failure | reopened while live, no re-arm              | refused save; refused share                  |
| 4. Mode, orientation, language | fr                                | es; the locale sweep           | budgets                                     | nl; the locale sweep                         |

- [ ] **Step 4: Re-run every guard mutation in phase 2, and record it**

For each row, `cp` the file to `/private/tmp/claude-501/s1a/`, make the change, run the named test file, confirm the FAIL, restore from the copy, and confirm the PASS. Never use `git checkout` or `git stash` for this.

| Guard                                     | File                                          | Change                                  | Test that must fail                                      |
| ----------------------------------------- | --------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| The LIVE gate, at the screen              | `src/hooks/preflight.ts`                      | `connecting` → `'live'`                 | `StreamScreen.onAir.test.tsx`                            |
| The warming gate's timer                  | `src/hooks/useDeadlinePassed.ts`              | delete the `setTimeout` and its cleanup | `StreamScreen.arm.test.tsx`                              |
| The warming gate's instant                | `src/domain/session/warming.ts`               | `<` → `<=`                              | `warming.test.ts`                                        |
| The leave rule                            | `src/domain/mode/reopen.ts`                   | `case 'live': return 'free';`           | `useStreamLeave.test.tsx`, `StreamScreen.onAir.test.tsx` |
| The heartbeat never blocks, at the screen | `src/hooks/statusKey.ts`                      | a `heartbeat.failures > 3` early return | `StreamScreen.onAir.test.tsx`, `statusKey.test.ts`       |
| Scan flight                               | `src/services/scanFlight.ts`                  | the guard always admits                 | `scanFlight.test.ts`, `HomeScreen.test.tsx`              |
| The scan hand-off                         | `src/services/homeIntent.ts`                  | `takeScan` never clears                 | `homeIntent.test.ts`, `HomeScreen.test.tsx`              |
| One hold at a time                        | `src/hooks/useHold.ts`                        | drop `timer.current !== null`           | `HoldAction.test.tsx`                                    |
| One arm per visit                         | `src/hooks/useStreamArm.ts`                   | drop the `armedFor` check               | `StreamScreen.arm.test.tsx`                              |
| The sub-route push                        | `src/services/native/expoRouterNavigation.ts` | delete the `router.push` line           | `expoRouterNavigation.test.ts`                           |

A mutation that survives is a finding: the guard is decoration, or two guards cover for each other. Report it; do not weaken the mutation.

After the table: `git status --short` shows nothing outside what this batch committed.

- [ ] **Step 5: List what only a device can settle**

Put this list in the batch report, unticked, for the device pass that follows phase 4. It is not done here, and no line of it is claimed.

- Plate colours at two metres in sun: red only for LIVE, lime Ready, orange Trouble, and Connecting inert.
- The hold fills: lime for Go live, cream at 35% for Stop, visible on the plate, and linear over 3 s.
- The overlay WebView: transparent over the preview, never taking a touch, and the Tier A route rendering with `delayMs=0` (D30 unverified).
- The peek: expo-video starts on press, is muted, uses the capped rendition, keeps no cache, and its data cost over five peeks.
- Controls on the left and right: nothing over the middle third.
- TalkBack: the plate announces changes; the hold, switch and radio labels are read.
- Keep-awake through a 30 minute armed wait.
- Barlow Condensed at 150 dp in French and Dutch: the longest tally, action and status copy fits.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/StreamScreen.locales.test.tsx
git commit -F - <<'EOF'
test(stream): phase 2 gate — no raw key in any state or language

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Self-review

Checked against the spec and the code on `docs/s1-live-stream-spec` at the time of writing.

**Spec coverage (Plan A's scope: §7 phases 1 and 2).**

| Spec                                                                          | Task(s)                  |
| ----------------------------------------------------------------------------- | ------------------------ |
| §1 Scan → descriptor fetch → Checking code… → the error panels                | 5, 8, 10                 |
| §1 Arm: four chips, Go live by, the 3 s hold, the warming deadline            | 13, 18, 19, 21           |
| §1 On air, Stop, Ended, Scan another, the engine wins at reopen               | 22, 23                   |
| §2 capture-qr.v2, the descriptor, the saved session, venue zone               | 5, 6, 7, 9               |
| §2 One authority: native owns state, JS projects it                           | 11 (no TS state machine) |
| §3 The bridge: intents, the 1 Hz snapshot, primitive selectors                | 11, 12, 17               |
| §4 HUD: plate, elapsed, meter, status line, chips, overlay, peek, edge strips | 17–21                    |
| §4 Settings and Diagnostics, reachable on air, with the LIVE plate            | 24, 25                   |
| §5 Errors as visible states; the logger; the record; scrubbing                | 1, 2, 3, 10, 19, 25      |
| §6 Every state rendered through the fake                                      | 11, 22, 23, 26           |
| §7 Phase 1 and phase 2 gates                                                  | 14, 26                   |

Out of scope, and left to later plans: the native engine (phase 3), wiring it and the native record (phase 4, D20), the web endpoint and the overlay parameter (phase 5, D2, D30), and the device matrix.

**Guards the brief asked to mutate.** The LIVE gate display (Tasks 13 and 22), the warming gate (13 and 21), the leave rule (Task 4), the heartbeat never blocking the display (12 and 22), and scan flight (Tasks 10 and 23). Each is in the Task 26 table.

**Placeholders.** None. Every step names its files, shows its code, and gives its command and expected result. Where the installed version may differ (expo-video's `useCaching`, WebView prop names, RNW's press path), the step says how to find out and what to report.

**Type consistency.** These names are used identically across tasks:

- `StreamSession`, `SessionDescriptor`, `SavedCode.descriptor`, `venueZone`;
- `EngineIntent.arm {session, heartbeat}` and `EngineSnapshot.descriptor`;
- `Telemetry` fields as listed in Task 11, named as plan B's `Snapshot` (D9, D40);
- `ReconnectCause` and the single `DegradeReason` (D38, D39), with wire strings equal to plan B's `.wire` values;
- `TallyPlate`, `tallyPlateFor`, `tallyTone`, `Chip`, `Preflight`, `goLiveBlocker`;
- `StatusKey`, `selectStatusKey`, `viewfinderStatusKey`;
- `Surfaces`, `StreamSettings`, `HomeIntent`, `SharePort`;
- `Route` with the two sub-routes.

`selectShedding` (a boolean, in `advisory.ts`) is named apart from S0's `selectShed` (the step) on purpose.

**House rules.**

- Screens reach native things only through `Ports`: the surfaces, share, the descriptor, settings and the home intent.
- `domain/` stays pure: `previewUrls.ts`, `warming.ts`, the parsers.
- No barrel files, no `console.log`, and no snapshot tests.
- Colour comes only from tokens; the one exception is `'transparent'` in `services/` (D33).
- HUD components are `memo` with precomputed styles.
- No EAS; no prebuild in this plan.
- Secrets never reach the log (Task 1's scrub, pinned again at Share in Task 25).
