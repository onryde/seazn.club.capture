# S0 — App shell — design

**Status:** owner-approved design, 2026-09-29, brainstormed item by item. Corrected after the build to say what was built and ruled; the rulings made while building are listed at the end.
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
| 6 | Orientation | **Portrait baseline.** Live Stream locks landscape, **either way round**. A **turn card** shows until the phone is physically sideways, and again on the way out until it is upright. The card is glyph only, a phone outline turning to the pose asked for; "Turn your phone sideways" / "Turn your phone upright" is its screen-reader label (R28). | Rotating the UI at once, while the phone is still upright (the operator reads sideways text). |
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
  _layout.tsx                ports, fonts, language, ErrorBoundary, reopen gate, orientation gate
  index.tsx                  Home
  stream/_layout.tsx         Live Stream's own stack; keeps the screen awake
  stream/index.tsx           placeholder viewfinder (S1 replaces its contents)
src/
  domain/
    mode/                    NEW, pure: Mode, ModeCode, recognise(), reopenTarget(), leaveRule()
    orientation/             NEW, pure: physical orientation from accelerometer samples
    session/  policy/        kept (projection, transport policy, audio floor)
    credentials/             kept until S1 (the engine port and SessionState speak its types)
    Result.ts                kept
  hooks/                     usePorts, useHome, useReopenGate, useOrientationGate, useStreamLeave,
                             useLanguage, useCaptureEngine (kept)
  services/                  KeyValueStore port, modeStore, device ports; native/ holds the expo-* implementations
  i18n/                      en/es/fr/nl JSON, t(), tp(), formatTime(), language choice
  ui/
    theme/                   tokens + type (kept)
    components/              Tile, ContinueCard, CodePanel, TurnCard, StatusLine, Text, Button
    screens/                 HomeScreen, StreamPlaceholderScreen
modules/
  capture-engine/            kept: port + fake (the P5 StreamPack code lives on spike/p5-android; S1 brings it)
  code-scanner/              NEW local Expo module: port, Android implementation, iOS stub, fake
contracts/                   unchanged
.github/workflows/check.yml  NEW: typecheck, lint, tests, i18n check on every push
```

A route group such as `(stream)` has no URL segment, so its index would collide with `/`; a plain `stream/` folder gives `/stream`.

- **`app/` is a layer, and lint enforces it.** `eslint-plugin-boundaries` learns an `app` element type:
  - routes may import `ui` and `hooks` only, plus packages (the root layout needs Expo Router and the safe-area provider);
  - nothing imports `app/`;
  - `domain/` stays pure, with no react, react-native, ui or modules.

  A route file holds no logic and no styles. The root `_layout` is the exception: it is the composition root.
- **No barrel files**, as before (AGENTS §3).
- **No `scoring/` or `dashboard/` folders in S0.** An empty route is dead code, and S2 and S4 add them.

### Kept and removed

| Kept, as parts | Removed |
|---|---|
| `modules/capture-engine/` (port and fake; main has no native engine yet) | `src/navigation/Router.tsx` |
| `domain/session/`, `domain/policy/`, `domain/Result.ts`, `domain/credentials/` (the engine port and `SessionState` import its types; S1 replaces its parser with the v1 contract plus the descriptor) | `ui/screens/{Scan,Viewfinder,Settings,Diagnostics}Screen.tsx` |
| `hooks/useCaptureEngine`, `engineSelectors`, `useOptionalNativeModule`, `useAppLifecycle`, `useKeepAwake` | Components used only by those screens: TallyColumn, ActionZone, LivePlate, PeekButton, PeekNotice, LockNotice, OutputPreview, OverlayPreview, PreviewSurface, AudioMeter, Metric, Elapsed, Toggle |
| `ui/theme/`, `ui/components/{Text,Button,ErrorBoundary,StatusLine}` | `domain/settings/`, `hooks/useSettings`, `hooks/usePeek`, and the AsyncStorage dependency |
| | `ui/format.ts` (used only by removed screens) |

**Kept does not mean frozen.** A kept part is re-read against this design when S0 or S1 first uses it, and is deleted if it no longer fits. Removed code stays in git history, so S1 can take anything worth keeping back out of it.

## 2. The mode domain

`src/domain/mode/`, in pure TypeScript.

```ts
type Mode = 'stream' | 'scoring' | 'dashboard';

type ModeCode =
  | { readonly mode: 'stream';  readonly raw: string; readonly slot: number; readonly expiresAt: Date }   // capture QR v1 JSON
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
  - Any other malformation gives `foreign`. That includes an integer `exp` too large for a `Date` (R7).

  S0 checks only the shape and the expiry. It does not validate the credentials, because that is S1's parser.
- **Scoring code:** an `https` URL whose host is **exactly** one of `hosts`, with the path `/score/<token>`. It has no expiry, because the server holds it (S2). The scanned host is compared in lower case; the path is case-sensitive, as the web's routes are, so `/Score/…` is a `seaznPage` (R8).
- **`seaznPage`:** any other URL on a host in `hosts`. It is shown as "This is a Seazn page, not a code. Scan the code on the page."
- **Tournament codes are not recognised in S0.** The main repo has not defined their shape yet, so S4 adds them.
- **`hosts`** comes from `EXPO_PUBLIC_SEAZN_ENV`: `['seazn.club']` only when it is `production`, otherwise `['stg.seazn.club']`. A build that forgets the variable reads staging codes and refuses a club's real ones. It is never a suffix match, so `seazn.club.evil.io` is `foreign`.
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
  prepare(): void;   // intent: fetch Google's scanner module ahead of the first tap
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
- **The fake:** a queue of results. Tests use it. A **dev-only** "Paste a code" field on Home hands its text to the same path as a scan from the Live Stream tile. The field shows only when `__DEV__` is true (the `devTools` flag in `Ports`), so a release build never shows it.

**Flow:**

```
tile tap → scan()
  cancelled   → Home, nothing shown
  unavailable → Home, status line gives the reason
  scanned     → recognise(raw)
                  same mode, code         → save, set active, open mode (a refused save stays Home: "Couldn't save on this phone. Try again.")
                  other mode, code        → wrong-code panel (or "coming soon")
                  expired / newerVersion / seaznPage / foreign → CodePanel with plain message + [Scan again]
```

## 4. Storage and reopen

**The `KeyValueStore` port** lives in `services/`. It has one phone implementation, backed by `expo-secure-store` (the Android Keystore; the iOS Keychain), and an in-memory one for tests. **`modeStore`**, beside it, reads and writes the keys below and publishes a snapshot for `useSyncExternalStore`.

| Key | Value |
|---|---|
| `mode.active` | `'stream'`, or absent (S2 and S4 add `'scoring'` and `'dashboard'`) |
| `code.stream` | `{ v: 1, mode, raw, slot: number \| null, savedAt, expiresAt: number \| null, venueTz: string \| null }` (times in epoch ms; `expiresAt` is stored so a reopen can name the expiry without re-parsing the code) |
| `lang` | `'en' \| 'es' \| 'fr' \| 'nl'`, or absent, meaning follow the phone |

- Every record carries `v`. **A record that is unknown or unreadable is deleted, never migrated.**
- **Android backup is off for this store**, through the SecureStore config plugin. Keystore keys do not survive a restore, so a restored phone would otherwise hold records it cannot decrypt.
- **Never stored:** scores, approvals and engine state (native owns the engine state, AGENTS §2).
- **Reading never fails the app.** `load()` never rejects (R12). A record it cannot read is deleted; a store that throws on read is treated as empty and nothing is deleted, since the read may work next launch. Either way the status line says "Couldn't read saved codes. Scan again to continue." (R13).
- **A refused write is never silent.** The status line says "Couldn't save on this phone. Try again." (R19), and a code that could not be saved is not opened.
- **Writes are not atomic.** Opening a code writes the code, then the active mode. If the second write is refused, the code is on disk but not active, so the next launch lands on Home with the Continue card.

**The reopen gate** lives in the root `_layout`. **The splash screen stays up until the gate decides**; there is no spinner.

```
read modeStore + engine snapshot
  → reopenTarget()
  → expire the dead codes, except the mode the engine holds: publish the removal and any notice, then delete
  → navigation.go(target) (router.replace); hide splash
```

- **Expiry is published before the deletes** (R21). An expired code is unusable either way, so Home names the expiry even if the phone refuses the delete; the next launch expires it again.
- **The gate never expires the mode the engine holds** (R23). An expired stream code stays while its session is armed or live; the next check after the engine lets go expires it, with the notice.
- **No system link chooses the screen** (R22). `app/+native-intent.tsx` sends a cold start to `/`, whatever the link, and ignores links while the app is running, so the gate alone decides where the app lands.

The same check runs **when the app returns to the foreground**. A code that expired in a pocket sends the operator Home, with "Your Live Stream code expired at {time}. Scan a new one."

**A code is forgotten when:**
- its `exp` passes;
- the stream ends normally (the engine reaches `stopped`, and the operator leaves);
- the operator taps Forget on the Continue card. Forget is immediate, with no confirmation, because the code can be scanned again.

A stream that ends in **failure keeps its code**, so the operator can go straight back in.

If the phone refuses the leave's write (the forget, or clearing the active mode), the app still goes Home (R30): the operator asked to leave. The active mode stays set, so the next check reopens Live Stream, and leaving again retries the write. After a refused forget and a process death, the fresh engine is `idle`, so that second leave keeps the spent code: it sits on the Continue card until it expires or the operator taps Forget.

## 5. Orientation

- `app.json` sets `"orientation": "default"`, plus the `expo-screen-orientation` plugin with `initialOrientation: "PORTRAIT_UP"`.
  - On iOS the app starts in portrait before any JavaScript runs. The plugin writes `initialOrientation` only to `Info.plist`; on Android the activity's orientation is `unspecified`, so the system rotation policy applies until the gate's first lock, which follows the first settled sensor reading.
  - A plain `"portrait"` would leave landscape out of iOS's `UISupportedInterfaceOrientations`, and the Live Stream lock would then fail on iOS.
- **One controller.** `useOrientationGate(target)` is mounted in the root layout. The target comes from the path:
  - `/stream` and anything under it: `landscape`, meaning either side;
  - everything else, Home included: `portrait` (locked portrait-up).
- **How the phone is held** comes from `expo-sensors` (the accelerometer), which needs no permission. The pure functions in `domain/orientation/` classify each sample as `portrait | landscape | flat | unknown` and settle it over time. Left and right are not told apart, because the landscape lock accepts both sides. The screen-orientation API is not used for this, because it reports the *locked* orientation. Hysteresis, twice over:
  - **Dead bands.** Past about 60° from upright is landscape and under about 30° is portrait. A screen within about 20° of horizontal is flat and one tilted more than about 30° up is held (R10). Readings between either pair decide nothing, so a reclined phone in the hand does not flicker between flat and portrait.
  - **Hold.** A new reading must hold for about 300 ms before it counts.
- **The sequence:**
  1. The target differs from how the phone is held, so the app locks to how the phone is held and the turn card shows. The card reads upright in the operator's hands (R24). It is glyph only: the words "Turn your phone sideways" / "Turn your phone upright" are spoken, not shown (R28). **Exception:** while the engine is armed or live, the current lock stays, because a tilt mid-broadcast must never rotate the activity under the camera; the card may then read sideways.
  2. The phone matches the target, so the target lock is applied and the card fades.
  3. `flat`: the target lock is applied with no card. A phone lying on a table is never blocked.
  4. `unknown` (no settled reading yet, in the first ~300 ms): the current lock is kept and no card shows. If the phone has no accelerometer, or the check for one fails, it is treated as `flat` (R26).
- **The 180° flip is allowed.** The landscape lock accepts both sides, and in S1 the engine keeps the encoded picture upright (P4).
- **A refused lock is forgotten,** so the gate asks again the next time its lock changes (R26).
- **While the card shows,** the app behind it is hidden from screen readers, and the card is modal and a polite live region (R25). The view around the navigator is never collapsed, so showing the card never reparents the native stack (R27).
- **Reduced motion:** the glyph stands still in the target pose, which is the cue; screen readers still get the label (R29).

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

  The language lives in its own context. It changes only when the operator picks, so AGENTS §8's telemetry rule is unaffected. The pick is stored under `lang`; a refused read counts as no pick, and a refused write keeps the pick for the session.
- **Plurals:** our own table for the four languages, used on every platform. Hermes in RN 0.86 implements only Collator, NumberFormat, DateTimeFormat and getCanonicalLocales, so `Intl.PluralRules` is absent there, and one table gives the same answer in tests and on the phone. French treats 0 as `one`.
- **Times:** `Intl.DateTimeFormat` in the chosen language, at the given zone. The zone name is shown only when the zone differs from the phone's.
- **CI:** every `en` key must exist in `es`, `fr` and `nl`, with the same set of placeholders.
- **Review:** each non-English file carries `"_review": "pending native speaker"`. `pnpm i18n:release-check` fails while any marker remains, and development builds ignore it. It must run before any store build; S0 has none, so nothing runs it yet (R11, *Known gaps*).

## 7. Look

The palette, type and colour rules come from AGENTS §5, which stays in force (decision record R5).

- **Home (layout A):**
  - "SEAZN" in Barlow Condensed at the top.
  - The Continue card, shown only when it has something to resume: a `surface` card with a lime hairline, the title "Continue {mode}", and a detail line ("Slot 2 · code valid till 18:40"; court and teams need S1's descriptor). It has a lime **Continue** plate and a ghost **Forget** button.
  - Three equal tiles fill the remaining height, each with a lime 4 px left edge and a lime line icon. Each tile shows its name in Barlow Condensed, uppercase and letterspaced, a one-line purpose, and a hint naming the code.
  - A "Coming soon" tile shows the purpose at `ink3` and the words "Coming soon" in place of the hint, and has no lime edge.
  - The footer holds "Language {name} ▾" and the version, at `ink3`.
- **CodePanel:** slides up from the bottom over a dimmed Home, on `surface2`. It shows a small context line ("You opened Live Stream"), a Barlow Condensed title, a detail line, a lime primary plate when there is somewhere to go, and a ghost **Scan again**.
- **TurnCard:** a full screen on `ground`, with a lime phone outline centred on it that turns from the held pose to the target on a loop (still, in the target pose, under reduced motion). No words (R28).
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
- "Viewfinder coming next";
- the slot from the recognised code;
- a **dev-only** control that drives the **fake engine** through `armed`, then `live`, then `stopped` or `failed`.

That is enough to exercise:
- the landscape target and the TurnCard;
- Back blocked while `live`;
- the code being forgotten after `stopped`, and kept after `failed`;
- reopening into Live Stream while the fake engine reports `armed` or `live`.

**Leaving** writes once and navigates once (R30). A second leave while the first write is pending, such as Back and Home together, does nothing, and Back stays handled so Android never closes the app from this screen. A refused write still goes Home (§4).

**Main has no native engine.** The P5 StreamPack implementation lives in `modules/p5-spike` on `origin/spike/p5-android`, and S1 brings it into `modules/capture-engine`. S0's composition root (`createNativePorts()`) wires the fake engine. **Proving "the engine wins at reopen" against the real foreground service is an S1 acceptance criterion.**

## 9. Testing and verification

| Layer | Runs | Covers |
|---|---|---|
| **Domain** (vitest, pure) | every push | `recognise()` for every outcome, including hostile input (over 4 KB, binary, the lookalike host `seazn.club.evil.io`, `http://`, and `/score/` with an empty token); `reopenTarget()` across the engine, saved-state and clock combinations; `leaveRule()`; `classify()` and `track()` over recorded sample sequences, including the flicker at 45°; the plural table for the 4 languages, French 0 included; `formatTime()` with a matching and a differing zone |
| **Screen** (vitest + `react-native-web` + `@testing-library/react`) | every push | Home: 3 tiles with 2 "Coming soon", and the Continue card shown, hidden and Forget. Every CodePanel variant. TurnCard shown and hidden against a fake accelerometer. The placeholder blocking Back while `live`. Driven by the fake engine, scanner, store and accelerometer. **No snapshot tests** (AGENTS §10). Assertions check what the operator can see. |
| **i18n** | CI | keys and placeholders match across the 4 files; `pnpm i18n:release-check` refuses `_review` markers, but no build runs it yet (*Known gaps*) |
| **CI** | every push | Before S0 the repo had no CI (no `.github/`). S0 adds one GitHub Actions workflow: `pnpm install --frozen-lockfile`, then `pnpm check` (typecheck, lint, all tests; the i18n key check is one of the tests). AGENTS §0 already claimed "CI runs domain tests on every push"; S0 makes that true. |
| **Device** (OnePlus, Gradle + adb, **no EAS**) | before S0 is called done | see the checklist below |
| **Mutation** | once per rule family | each break below must turn its tests red |

- **Screens never reach a native capability directly.** Every port (engine, scanner, store, accelerometer, orientation lock, back button, foreground, navigation, splash) sits in one `Ports` object that reaches hooks through a provider. The concrete `expo-*` implementations are built only by `createNativePorts()`, which the root `_layout` calls. That is what lets screen tests run on `react-native-web` with fakes (`test/fakePorts.ts`); the components that draw with Reanimated or SVG are stubbed in `test/setup-ui.ts`.
- The Android hardware Back button sits behind a small `BackPort`, because `react-native-web` has no `BackHandler`. The leave guard is tested on the placeholder screen against a fake `BackPort`.
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
8. Portrait Home → turn card (the glyph turning sideways) → landscape, turning the phone both ways → Back → turn card (the glyph turning upright) → portrait Home. Each card reads upright in the hand.
9. The phone lying flat on a table enters Live Stream with no card.
10. The language picker switches all visible text in each of the 4 languages, and the choice survives a restart. A phone set to German shows English.
11. Screenshots at 2–3 screen sizes (the OnePlus plus two emulator profiles, one small), with nothing clipped.

## 10. AGENTS.md changes (part of S0)

The decision record says AGENTS.md is rewritten when the shell makes it true. S0 does it:
- **§1, scope lock:** three modes, each unlocked by its own QR code, with no login. Live Stream keeps the five-screen description of its own screens, rewritten in S1 when those screens are designed. Adding a fourth mode is a product decision.
- **§3, layering:** add `app/` as the routes layer and its lint rule. Remove `navigation/`.
- **§6, UI rules:** "Landscape-locked" becomes "Live Stream is landscape, either way round; everything else is portrait". Add the TurnCard rule. "Settings and Diagnostics stay reachable in every state" still holds, because they sit inside the stream group; only leaving the mode is blocked on air.
- **§8, performance:** "Context is for the theme only, which never changes" becomes a rule about what context may carry: values that never tick (the `Ports` object, the language, the theme if it ever needs one), never telemetry.
- **§11, tooling:** add `expo-router`, `expo-secure-store`, `expo-screen-orientation`, `expo-sensors` and `expo-localization`, and the Google code scanner (and why it does not break "no `expo-camera`"). Remove AsyncStorage.
- **§12, style:** `BootFailure` and `ErrorBoundary` may render React Native's own `Text`, outside the type scale.
- The §1 "Superseded in part" pointer is deleted.

## 11. Dependencies

**New:**
- `expo-router`;
- `expo-secure-store`;
- `expo-screen-orientation`;
- `expo-sensors`;
- `expo-localization`;
- `expo-splash-screen`;
- `react-native-reanimated` and `react-native-worklets`, for the TurnCard animation (AGENTS §8: animations run on the UI thread);
- `react-native-svg`, for the tile icons;
- Android `com.google.android.gms:play-services-code-scanner`, in the local module;
- dev: `@testing-library/react`, `jsdom`.

All are installed with `pnpm expo install` so they match SDK 57. That also brought Expo Router's peers (`react-native-screens`, `expo-linking`, `expo-constants`, `@expo/metro-runtime`) and `expo-system-ui`. Expo Router's drawer peers (`react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`, `@react-native-masked-view/masked-view`) autolink even though S0 has no drawer, so they are pinned as direct dependencies rather than left at whatever pnpm picks (R14).

**Removed:** `@react-native-async-storage/async-storage`, and `expo-video` and `react-native-webview`, which served only the removed preview components. S1 adds back what it needs.

## Known gaps

- **No scanning on phones without Google Play,** because §11 forbids our own camera. We will revisit this only if a club hits it.
- **iOS scanning** comes in the iOS wave.
- **Server-checked messages wait for S1:**
  - "This code was turned off by the organiser" and "Can't check this code — no connection. Try again." (decided in the brainstorm) arrive with S1's descriptor fetch, for stream codes.
  - Venue-zone times arrive the same way. Until then, times use the phone's zone.
- **"The engine wins at reopen"** is proven only against the fake engine in S0. The real proof is in S1.
- **The translation release check runs in no build** (R11). S0 has only local debug and device builds, with no store-build path. Wiring the check into Gradle now would fail every local release build on markers no native speaker can clear yet. The first store-build task wires it in.
- **The turn card's announcement:**
  - iOS: the live region is Android-only, so VoiceOver is neither told nor moved to the card when it appears. iOS is not built in S0.
  - Android: a live region that is freshly mounted may not be announced, because Fabric inserts the children before the parent. The device check settles it; the fallback is `AccessibilityInfo.announceForAccessibility` with the title when the card appears.
- **No logger yet** (AGENTS §11; it arrives with S1). A refused orientation lock or leave write is handled, but recorded nowhere.

## Rulings made during S0

Decisions taken while building S0, recorded here so they outlive the build's working notes. Rulings about how the work was run (R1–R6, R32: branches, review, who holds the phone) are left out.

- **R7** — an integer `exp` too large for a `Date` is `foreign`. See §2.
- **R8** — scanned hosts compare in lower case; `/score/` is case-sensitive. See §2.
- **R9** — finding expired codes skips a mode with no code rather than crashing on it: reopen must never crash, and its worst case is Home.
- **R10** — a flat/held dead band beside the upright/sideways one. See §5.
- **R11** — the translation release check exists but no build runs it yet. See §6 and *Known gaps*.
- **R12** — `load()` never rejects; a store that throws on read reads as empty. See §4.
- **R13** — one unreadable-store message, true whether or not a record was deleted. See §4.
- **R14** — Expo Router's drawer peers are pinned as direct dependencies. See §11.
- **R15** — the root `ErrorBoundary` hides the splash when it catches: a render error at boot would otherwise sit behind a splash that never lifts.
- **R16, R20** — `ui` may `import type` from `services` and the scanner module, and never a value: a type carries no native code, and a screen may need to name a port's types, such as `Route` or `ScanResult`.
- **R17** — the turn glyph turns from the pose held to the pose asked for, on both cards, so it shows the turn to make.
- **R18** — UI tests may import pure `services` values (`STORE_KEYS`, the in-memory store); native services stay barred. Test code is not shipped UI.
- **R19** — a refused store write is shown, never silent. See §4.
- **R21** — expiry is published before the deletes. See §4.
- **R22** — no system link chooses the screen. See §4.
- **R23** — the reopen gate never expires the mode the engine holds. See §4.
- **R24** — the lock follows the hands while the card shows, except when armed or live. See §5.
- **R25, R27** — the app behind the card is hidden from screen readers; the stage view is never collapsed. See §5.
- **R26** — a failed accelerometer check reads as flat, and a refused lock is asked for again; no port rejection goes unhandled. See §5.
- **R28** — the turn card is glyph only (owner, on the device); its words are the screen-reader label. See decision 6, §5 and §7.
- **R29** — under reduced motion the still glyph in the target pose is the cue. See §5.
- **R30** — leaving writes and navigates once; a refused write still goes Home. See §4 and §8.
- **R31** — Android Back closes an open CodePanel on Home, as Android apps do; it had sent the app to the launcher. Not yet built when this was written.

## Main-repo asks raised by S0

- **The capture session descriptor** (already an S1 dependency) also carries `venueTimezone`: an IANA name, resolved server-side through the venue lane.
- **Scoring and tournament payloads** carry `venueTimezone` the same way, when S2 and S4 define them.
- **The App Links verification file** (`/.well-known/assetlinks.json`) is needed first in **S2**, not S0.
