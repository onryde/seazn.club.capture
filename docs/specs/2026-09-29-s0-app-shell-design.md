# S0 — App shell — design

**Status:** owner-approved design, 2026-09-29, brainstormed item by item. It needs a written-spec review, then an implementation plan.
**Parent:** [the three-mode decision record](2026-09-29-multi-mode-app-decisions.md). Its rulings are binding here, and this spec does not reopen them.
**Next:** S1, handheld Live Stream, builds inside this shell.

## What S0 is for

S0 turns a single-purpose capture spike into the frame that every later mode lives in.

When S0 is done:
- a volunteer opens the app, in portrait, on a home screen with three modes;
- they tap one and scan a code with the phone's own scanner;
- the app either opens that mode, or tells them in plain words why not;
- the app comes back to the right place after it is killed;
- Live Stream turns the phone sideways, and nothing else does.

S0 ships no streaming, scoring or approving. S1, S2 and S4 fill those modes. S3 extends Live Stream.

**Nothing has shipped to a customer.** Only the web console is live. So S0 is a **clean slate for everything the operator sees**:
- no screen, route or stored value is kept for compatibility;
- nothing is migrated.

Code that P5 proved on a device is kept as parts. It is not kept as a design constraint: see *Kept and removed*.

## Decisions

Each item was put to the owner as options, with a recommendation. The rejected options are kept so the reasoning survives.

| # | Topic | Ruling | Rejected, and why |
|---|---|---|---|
| 1 | Scanning | **The system code scanner.** On Android that is Google's code scanner (`play-services-code-scanner`); iOS VisionKit follows later. The app never opens the camera to scan. AGENTS §11 (no `expo-camera`) stands. | Our own camera scanner (breaks §11, and fights the engine for the camera); `expo-camera` just for scanning (the same). |
| 2 | Home | **Three tiles** (Live Stream, Remote Scoring, Dashboard). Each tile has a one-line purpose and says which code unlocks it. A **Continue** card appears only when a mode that was left still has a valid code, with **Forget**. The footer holds the language picker and the app version. | A single "Scan" button that routes by code type (hides what the app does); a mode list with no descriptions. |
| 3 | Wrong code | **Recognise the code, then explain.** A panel: "This is a Remote Scoring code · Court 2 · Kestrels v Harriers", with [Open Remote Scoring] and [Scan again]. Plain messages cover the rest: "This isn't a Seazn code." / "This code expired at 18:40. Ask the desk for a new one." | "Invalid code" (a lie: the code is valid, just for another mode; decision record ruling 2). |
| 4 | Reopen | **The last code per mode, plus the active mode, in secure storage.** Order on reopen: **the engine first** (armed or live means Live Stream); then the last active mode, if its code is still valid; then Home, with an "expired at" notice. | Always opening on Home (hides a live broadcast, ruling 3). |
| 5 | Leaving a mode | **Live Stream:** armed means free to leave, and the code is kept. **On air, it cannot be left:** Home is hidden, and Back shows "Stop the broadcast first — hold Stop". Ended means leaving forgets the code. (Scoring and Dashboard rules are ruled, but built in S2 and S4.) | Leaving silently stops the stream (costs the match). |
| 6 | Orientation | **Portrait baseline.** Live Stream locks landscape, **either way round**. A **"Turn your phone sideways"** card shows until the phone is physically sideways, and "Turn upright" shows on the way out. | Rotating the UI at once, while the phone is still upright (the operator reads sideways text). |
| 7 | Navigation | **Expo Router.** Scanning is not a route. Stream codes are JSON, not links, so **S0 claims no App Links**. Each mode claims its links when it ships, starting with Scoring's `/score/*` in S2. | Claiming all Seazn links in S0 (a tapped scoring link would open an app that cannot score). |
| 8 | Language | **The phone's language, if it is en, es, fr or nl; otherwise English.** The footer picker overrides it and is remembered. The dictionaries use the web's format. es, fr and nl are drafted by us and **reviewed by a native speaker before release**. | English only until asked (ruling 12 says 4 locales from day one). |
| 9 | Home look | **Layout A: three equal tiles** under the Continue card. See *Look*. | B, where Continue becomes the hero and the modes shrink to rows (a screen that changes shape is harder to teach); C, a lime Scan plate on every tile (three lime actions dilute "lime is *the* action"). |
| 10 | Unbuilt modes | **Remote Scoring and Dashboard show "Coming soon" and cannot be tapped** until S2 and S4. A scoring code scanned from the Live Stream tile gets "Remote Scoring is coming soon" and a single [Scan again] button. | Handing scoring codes off to the web pad in the browser (owner: no); hiding the tiles (Home would change shape later). |
| 11 | Testing | **Domain, then screen, then an i18n check in CI, then a device check with evidence.** Detox waits until S1, when scan → arm → live exists. | Detox now (it would only tap tiles that lead nowhere); domain tests only (screen rules such as "Back blocked on air" would go unguarded). |
| 12 | Clean slate | Everything the operator sees is new, and **proven non-UI parts are kept**: the engine module and the pure domain. | Rewriting the engine and domain too (throws away P5's device-proven work); wrapping the spike-era screens (they were built to prove P5, not designed for an operator). |
| 13 | Time zone | Every time the operator reads is shown in the **venue timezone**, which the **server resolves** (the web's venue lane: `schedule_settings.tz` → `organizations.timezone` → UTC, from V305). The zone is stored with the code. When it differs from the phone's zone, the zone name is added ("18:40 CEST"). **S0 has no server, so it uses the phone's zone.** | The phone's zone always (wrong for a remote Dashboard user or a travelling organiser); `users.timezone` (that is the personal lane, not the venue's). |

## 1. Structure

```
app/                         Expo Router, thin: each file only imports a screen
  _layout.tsx                fonts, theme, language, ErrorBoundary, reopen gate, orientation gate
  index.tsx                  Home
  (stream)/_layout.tsx       target landscape; leave guard
  (stream)/index.tsx         placeholder viewfinder (S1 replaces its contents)
src/
  domain/
    mode/                    NEW, pure: Mode, ModeCode, recognise(), reopenTarget(), leaveRule()
    orientation/             NEW, pure: physical orientation from accelerometer samples
    session/  policy/        kept (projection, transport policy, audio floor)
    Result.ts                kept
  hooks/                     useActiveMode, useScanner, useOrientationGate, useLeaveGuard, useCaptureEngine (kept)
  services/                  CodeStore port + SecureStore implementation + fake
  i18n/                      en/es/fr/nl JSON, t(), tp(), formatTime(), language state
  ui/
    theme/                   tokens + type (kept)
    components/              Tile, ContinueCard, CodePanel, TurnCard, StatusLine, Text, Button
    screens/                 HomeScreen, StreamPlaceholderScreen
modules/
  capture-engine/            kept (P5-proven)
  code-scanner/              NEW local Expo module: port, Android implementation, iOS stub, fake
contracts/                   unchanged
```

- **`app/` is a layer, and lint enforces it.** `eslint-plugin-boundaries` learns an `app` element type:
  - routes may import `ui/screens` and `hooks` only;
  - nothing imports `app/`;
  - `domain/` stays pure, with no react, react-native, ui or modules.

  A route file holds no logic and no styles.
- **No barrel files**, as before (AGENTS §3).
- **No `(scoring)/` or `(dashboard)/` groups in S0.** An empty route is dead code, and S2 and S4 add them.

### Kept and removed

| Kept, as parts | Removed |
|---|---|
| `modules/capture-engine/` (port, fake, Android engine) | `src/navigation/Router.tsx` |
| `domain/session/`, `domain/policy/`, `domain/Result.ts` | `ui/screens/{Scan,Viewfinder,Settings,Diagnostics}Screen.tsx` |
| `hooks/useCaptureEngine`, `engineSelectors`, `useOptionalNativeModule`, `useAppLifecycle`, `useKeepAwake` | Components used only by those screens: TallyColumn, ActionZone, LivePlate, PeekButton, PeekNotice, LockNotice, OutputPreview, OverlayPreview, PreviewSurface, AudioMeter, Metric, Elapsed, Toggle |
| `ui/theme/`, `ui/components/{Text,Button,ErrorBoundary,StatusLine}` | `domain/settings/`, `hooks/useSettings`, `hooks/usePeek`, and the AsyncStorage dependency |
| | `domain/credentials/` (S1 replaces it with the v1 contract plus the descriptor) |
| | `ui/format.ts` (used only by removed screens) |

**Kept does not mean frozen.** A kept part is re-read against this design when S0 or S1 first uses it, and is deleted if it no longer fits. Removed code stays in git history, so S1 can take anything worth keeping back out of it.

## 2. The mode domain

`src/domain/mode/`, in pure TypeScript.

```ts
type Mode = 'stream' | 'scoring' | 'dashboard';

type ModeCode =
  | { readonly mode: 'stream';  readonly raw: string; readonly expiresAt: Date }   // capture QR v1 JSON
  | { readonly mode: 'scoring'; readonly raw: string; readonly token: string };    // https://<host>/score/<token>

type Recognition =
  | { readonly outcome: 'code'; readonly code: ModeCode }
  | { readonly outcome: 'expired'; readonly mode: Mode; readonly at: Date }
  | { readonly outcome: 'newerVersion'; readonly mode: Mode }
  | { readonly outcome: 'seaznPage' }
  | { readonly outcome: 'foreign' };

function recognise(raw: string, now: Date, hosts: readonly string[]): Recognition;
```

- **Stream code:** JSON with `v: 1` and the v1 fields `{v, sid, slot, cred: {srt, rtmps}, preferred, exp}`.
  - If `exp` is at or before `now`, the result is `expired`.
  - `v > 1` gives `newerVersion`, shown as "Update the app to use this code."
  - Any other malformation gives `foreign`.

  S0 checks only the shape and the expiry. It does not validate the credentials, because that is S1's parser.
- **Scoring code:** an `https` URL whose host is **exactly** one of `hosts`, with the path `/score/<token>`. It has no expiry, because the server holds it (S2).
- **`seaznPage`:** any other URL on a host in `hosts`. It is shown as "This is a Seazn page, not a code. Scan the code on the page."
- **Tournament codes are not recognised in S0.** The main repo has not defined their shape yet, so S4 adds them.
- **`hosts`** comes from the build profile: `['seazn.club']` for release builds and `['stg.seazn.club']` for staging. It is never a suffix match, so `seazn.club.evil.io` is `foreign`.
- **Input limit:** anything longer than 4 KB is `foreign`, and is never parsed.
- **Only this module knows the wire shapes.** A v2 QR touches this one file, and S1's parser.

```ts
// Selected from the kept SessionState: connecting, publishing, degraded and reconnecting all count as 'live',
// because each of them is a broadcast the operator must not walk away from.
// `ended` splits on EndReason: 'operator-stopped' is stopped; 'hold-window-expired' and 'fatal-error' are failed.
type EngineStatus = 'idle' | 'armed' | 'live' | 'stopped' | 'failed';

type SavedState = {
  readonly active: Mode | null;
  readonly codes: Readonly<Partial<Record<Mode, SavedCode>>>;
};

function reopenTarget(input: { engine: EngineStatus; saved: SavedState; now: Date }):
  | { readonly go: 'stream' }
  | { readonly go: 'home'; readonly notice?: { readonly mode: Mode; readonly expiredAt: Date } };
  // S0 builds only `stream`. S2 and S4 widen the union when their modes exist.

function leaveRule(mode: 'stream', engine: EngineStatus): 'free' | 'freeAndForget' | 'blockedOnAir';
```

- `reopenTarget` returns `stream` when the engine is `armed` or `live`, **whatever the saved state says**. Otherwise it returns the active mode, if that mode's code is still valid. Otherwise it returns Home. The notice is set when the active mode's code has expired.
- `leaveRule('stream', …)`:
  - `idle`, `armed` or `failed` → `free` (the code is kept, so the operator can go straight back in);
  - `live` → `blockedOnAir`;
  - `stopped` → `freeAndForget`.
- **Tile against code.** When the recognised mode equals the tapped tile's mode, that mode opens. Otherwise the wrong-code panel appears (decision 3), or the "coming soon" panel for an unbuilt mode (decision 10).

## 3. The scanner

The scanner is a local Expo module, `modules/code-scanner/`.

```ts
interface CodeScannerPort {
  scan(): Promise<ScanResult>;
}

type ScanResult =
  | { readonly outcome: 'scanned'; readonly raw: string }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'unavailable'; readonly reason: 'noPlayServices' | 'installing' | 'failed' };
```

- **The promise is deliberate.** AGENTS §2's rule, "intents, not RPC", protects the long-lived stream session. A scan is a one-shot screen the operator completes or backs out of, and nothing is live while it is open. The stream route **never calls `scan()`**: it is reachable only from Home.
- **Android:** `GmsBarcodeScanning` from `com.google.android.gms:play-services-code-scanner`, with the format set to QR only.
  - The app needs **no camera permission** to scan.
  - The scanner module downloads on first use. While it installs, the status line reads "Getting the scanner ready…".
  - Phones without Google Play get "This phone can't open the code scanner." **S0 has no fallback there:** a fallback needs our own camera, which §11 forbids. This is a known gap.
- **iOS:** a stub that returns `unavailable` / `failed` until the iOS wave, which uses VisionKit's `DataScannerViewController`. The rest of S0 runs on iOS.
- **The fake:** a queue of results. Tests use it. A **dev-only** "Paste a code" field on Home uses it too. The field is gated on `__DEV__` and is never compiled into a release build.

**Flow:**

```
tile tap → scan()
  cancelled   → Home, nothing shown
  unavailable → Home, status line gives the reason
  scanned     → recognise(raw)
                  same mode, code         → save, set active, open mode
                  other mode, code        → wrong-code panel (or "coming soon")
                  expired / newerVersion / seaznPage / foreign → CodePanel with plain message + [Scan again]
```

## 4. Storage and reopen

**The `CodeStore` port** lives in `services/`. It has one implementation, backed by `expo-secure-store` (the Android Keystore; the iOS Keychain), and a fake.

| Key | Value |
|---|---|
| `mode.active` | `'stream'`, or absent (S2 and S4 add `'scoring'` and `'dashboard'`) |
| `code.stream` | `{ v: 1, raw, savedAt, venueTz: string \| null }` |
| `lang` | `'en' \| 'es' \| 'fr' \| 'nl'`, or absent, meaning follow the phone |

- Every record carries `v`. **A record that is unknown or unreadable is deleted, never migrated.**
- **Android backup is off for this store**, through the SecureStore config plugin. Keystore keys do not survive a restore, so a restored phone would otherwise hold records it cannot decrypt.
- **Never stored:** scores, approvals and engine state (native owns the engine state, AGENTS §2).

**The reopen gate** lives in the root `_layout`. **The splash screen stays up until the gate decides**; there is no spinner.

```
read CodeStore + engine snapshot
  → delete expired codes
  → reopenTarget()
  → router.replace(target); hide splash
```

The same check runs **when the app returns to the foreground**. A code that expired in a pocket sends the operator Home, with "Your Live Stream code expired at {time}. Scan a new one."

**A code is forgotten when:**
- its `exp` passes;
- the stream ends normally (the engine reaches `stopped`, and the operator leaves);
- the operator taps Forget on the Continue card. Forget is immediate, with no confirmation, because the code can be scanned again.

A stream that ends in **failure keeps its code**, so the operator can go straight back in.

## 5. Orientation

- `app.json` sets `"orientation": "default"`, plus the `expo-screen-orientation` plugin with `initialOrientation: "PORTRAIT_UP"`.
  - The app starts in portrait before any JavaScript runs.
  - A plain `"portrait"` would leave landscape out of iOS's `UISupportedInterfaceOrientations`, and the Live Stream lock would then fail on iOS.
- **One controller.** `useOrientationGate(target)` is mounted in the root layout. Each route group declares its target:
  - Home: `portraitUp`;
  - `(stream)`: `landscape`, meaning either side.
- **How the phone is held** comes from `expo-sensors` (the accelerometer), which needs no permission. The pure function `physicalOrientation(samples)` in `domain/orientation/` returns `portrait | landscapeLeft | landscapeRight | flat | unknown`. It has hysteresis: the phone must be tilted clearly past about 60° for about 300 ms. The screen-orientation API is not used for this, because it reports the *locked* orientation.
- **The sequence:**
  1. The target differs from how the phone is held, so the current lock stays and the TurnCard shows ("Turn your phone sideways" / "Turn upright"). The card reads upright in the operator's hands.
  2. The phone matches the target, so the lock is applied and the card fades.
  3. `flat` or `unknown`: the target lock is applied with no card. A phone lying on a table is never blocked.
- **The 180° flip is allowed.** The landscape lock accepts both sides, and in S1 the engine keeps the encoded picture upright (P4).
- **Reduced motion:** the card's rotating icon stands still, and the text remains.

## 6. Languages

- **The web's format,** so strings can be moved between the two:
  - flat dotted keys;
  - `{name}` placeholders;
  - plurals as `key.one` / `key.other`.

  This app has its own files, `src/i18n/{en,es,fr,nl}.json`.
- **The runtime is our own, about 40 lines:** `t(key, vars?)`, `tp(key, count, vars?)` and `formatTime(date, tz)`, with no library.
- **Choosing the language:**
  1. the stored `lang`;
  2. otherwise the phone's first language, from `expo-localization`, if it is one of the four;
  3. otherwise `en`.

  The language lives in the context that also carries the theme. It changes only when the operator picks, so AGENTS §8's telemetry rule is unaffected.
- **Plurals:** the plan first tests whether Hermes has `Intl.PluralRules` **on the device** (it is a vendor behaviour, so it gets tested). If it is missing, the fallback is a built-in table for the four languages. French treats 0 as `one`.
- **Times:** `Intl.DateTimeFormat` in the chosen language, at the given zone. The zone name is shown only when the zone differs from the phone's.
- **CI:** every `en` key must exist in `es`, `fr` and `nl`, with the same set of placeholders.
- **Review:** each non-English file carries `"_review": "pending native speaker"`. A release-build check fails while any marker remains, and development builds ignore it.

## 7. Look

The palette, type and colour rules come from AGENTS §5, which stays in force (decision record R5).

- **Home (layout A):**
  - "SEAZN" in Barlow Condensed at the top.
  - The Continue card, shown only when it has something to resume: a `surface` card with a lime hairline, the title "Continue {mode}", and a detail line ("Court 2 · Kestrels v Harriers · code valid till 18:40"). It has a lime **Continue** plate and a ghost **Forget** button.
  - Three equal tiles fill the remaining height, each with a lime 4 px left edge and a lime line icon. Each tile shows its name in Barlow Condensed, uppercase and letterspaced, a one-line purpose, and a hint naming the code.
  - A "Coming soon" tile shows the purpose at `ink3` and the words "Coming soon" in place of the hint, and has no lime edge.
  - The footer holds "Language {name} ▾" and the version, at `ink3`.
- **CodePanel:** slides up from the bottom over a dimmed Home, on `surface2`. It shows a small context line ("You opened Live Stream"), a Barlow Condensed title, a detail line, a lime primary plate when there is somewhere to go, and a ghost **Scan again**.
- **TurnCard:** a full screen on `ground`, with a lime phone outline that rotates on a loop (still under reduced motion) and one Barlow Condensed line with a secondary line beneath.
- **StatusLine:** the persistent line from AGENTS §6. It shows the scanner's state and store errors, and never shows a bare spinner.
- **Red appears nowhere in S0.** Nothing is on air yet, apart from the placeholder's fake `live` state, which uses the kept ON AIR token. Trouble uses orange.

Copy, in `en`. The keys are indicative, and the plan fixes them:

| Where | Text |
|---|---|
| Tile, Live Stream | "Live Stream" · "Film a match to YouTube." · "Scan the stream code from the match page" |
| Tile, Remote Scoring | "Remote Scoring" · "Score one match from the side." · "Coming soon" |
| Tile, Dashboard | "Dashboard" · "Approve the next round of a tournament." · "Coming soon" |
| Wrong mode | "This is a {mode} code" + [Open {mode}] |
| Coming soon | "This is a {mode} code" · "{mode} is coming soon." |
| Expired | "This code expired at {time}. Ask the desk for a new one." |
| Newer version | "This code needs a newer version of the app." |
| Seazn page | "This is a Seazn page, not a code. Scan the code on the page." |
| Foreign | "This isn't a Seazn code." |
| No scanner | "This phone can't open the code scanner." |
| Installing | "Getting the scanner ready…" |
| Leave on air | "Stop the broadcast first — hold Stop." |
| Reopen expired | "Your {mode} code expired at {time}. Scan a new one." |

## 8. The stream placeholder

`StreamPlaceholderScreen` exists to prove the shell's stream rules before S1 fills the route. It shows:
- "Live Stream arrives in S1";
- the slot from the recognised code;
- a **dev-only** control that drives the **fake engine** through `armed`, then `live`, then `stopped` or `failed`.

That is enough to exercise:
- the landscape target and the TurnCard;
- Back blocked while `live`;
- the code being forgotten after `stopped`, and kept after `failed`;
- reopening into Live Stream while the fake engine reports `armed` or `live`.

The real engine stays linked but is not driven by S0. **Proving "the engine wins at reopen" against the real foreground service is an S1 acceptance criterion.**

## 9. Testing and verification

| Layer | Runs | Covers |
|---|---|---|
| **Domain** (vitest, pure) | every push | `recognise()` for every outcome, including hostile input (over 4 KB, binary, the lookalike host `seazn.club.evil.io`, `http://`, and `/score/` with an empty token); `reopenTarget()` across the engine, saved-state and clock combinations; `leaveRule()`; `physicalOrientation()` over recorded sample sequences, including the flicker at 45°; the plural table for the 4 languages, French 0 included; `formatTime()` with a matching and a differing zone |
| **Screen** (vitest + `react-native-web` + `@testing-library/react`) | every push | Home: 3 tiles with 2 "Coming soon", and the Continue card shown, hidden and Forget. Every CodePanel variant. TurnCard shown and hidden against a fake accelerometer. The placeholder blocking Back while `live`. Driven by the fake engine, scanner, store and accelerometer. **No snapshot tests** (AGENTS §10). Assertions check what the operator can see. |
| **i18n** | CI | keys and placeholders match across the 4 files; `_review` markers block release builds |
| **Device** (OnePlus, Gradle + adb, **no EAS**) | before S0 is called done | see the checklist below |
| **Mutation** | once per rule family | each break below must turn its tests red |

- The Android hardware Back button sits behind a small `BackPort`, because `react-native-web` has no `BackHandler`. The leave guard is tested at the hook level against a fake `BackPort`.
- **Mutations to run:**
  - `recognise` accepts a suffix host;
  - `reopenTarget` prefers the saved state over an `armed` engine;
  - the hysteresis window drops to 0 ms;
  - the i18n check ignores placeholders.

**Device checklist:** evidence is screenshots or a screen recording, per "verify as customer".
1. Google's scanner opens from the Live Stream tile, including the first-use install on a phone that has never had it.
2. A real capture-v1 QR, printed or on a laptop screen, opens the stream placeholder.
3. A `stg.seazn.club/score/…` QR shows "Remote Scoring is coming soon".
4. A random QR (a URL for another site) shows "This isn't a Seazn code".
5. An expired stream code shows the expiry message, at the right local time.
6. Closing the app completely from recents, then reopening, lands on the stream placeholder while its code is valid. After the phone clock is moved past `exp`, it lands on Home with the notice.
7. Codes survive a restart. Forget removes them.
8. Portrait Home → TurnCard → landscape, turning the phone both ways → Back → "Turn upright" → portrait Home.
9. The phone lying flat on a table enters Live Stream with no card.
10. The language picker switches all visible text in each of the 4 languages, and the choice survives a restart. A phone set to German shows English.
11. Screenshots at 2–3 screen sizes (the OnePlus plus two emulator profiles, one small), with nothing clipped.

## 10. AGENTS.md changes (part of S0)

The decision record says AGENTS.md is rewritten when the shell makes it true. S0 does it:
- **§1, scope lock:** three modes, each unlocked by its own QR code, with no login. Live Stream keeps the five-screen description of its own screens, rewritten in S1 when those screens are designed. Adding a fourth mode is a product decision.
- **§3, layering:** add `app/` as the routes layer and its lint rule. Remove `navigation/`.
- **§6, UI rules:** "Landscape-locked" becomes "Live Stream is landscape, either way round; everything else is portrait". Add the TurnCard rule. "Settings and Diagnostics stay reachable in every state" still holds, because they sit inside the stream group; only leaving the mode is blocked on air.
- **§8, performance:** "Context is for the theme only, which never changes" becomes "Context is for the theme and the language. The language changes only when the operator picks it."
- **§11, tooling:** add `expo-router`, `expo-secure-store`, `expo-screen-orientation`, `expo-sensors` and `expo-localization`, and the Google code scanner (and why it does not break "no `expo-camera`"). Remove AsyncStorage.
- The §1 "Superseded in part" pointer is deleted.

## 11. Dependencies

**New:**
- `expo-router`;
- `expo-secure-store`;
- `expo-screen-orientation`;
- `expo-sensors`;
- `expo-localization`;
- `expo-splash-screen`;
- `react-native-reanimated`, for the TurnCard animation (AGENTS §8: animations run on the UI thread);
- Android `com.google.android.gms:play-services-code-scanner`, in the local module;
- dev: `@testing-library/react`.

All are installed with `npx expo install` so they match SDK 57, which also pulls in Expo Router's peers (`react-native-screens`, `expo-linking`, `expo-constants`).

**Removed:** `@react-native-async-storage/async-storage`.

## Known gaps

- **No scanning on phones without Google Play,** because §11 forbids our own camera. We will revisit this only if a club hits it.
- **iOS scanning** comes in the iOS wave.
- **Server-checked messages wait for S1:**
  - "This code was turned off by the organiser" and "Can't check this code — no connection. Try again." (decided in the brainstorm) arrive with S1's descriptor fetch, for stream codes.
  - Venue-zone times arrive the same way. Until then, times use the phone's zone.
- **"The engine wins at reopen"** is proven only against the fake engine in S0. The real proof is in S1.

## Main-repo asks raised by S0

- **The capture session descriptor** (already an S1 dependency) also carries `venueTimezone`: an IANA name, resolved server-side through the venue lane.
- **Scoring and tournament payloads** carry `venueTimezone` the same way, when S2 and S4 define them.
- **The App Links verification file** (`/.well-known/assetlinks.json`) is needed first in **S2**, not S0.
