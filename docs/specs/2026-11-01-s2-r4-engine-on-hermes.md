# R4 — the engine on the phone: results

Plan S2-1 Task 1 (`docs/superpowers/plans/2026-11-01-s2-1-remote-scoring.md`), design §6.2. The decision
record's R4 asks whether `@seazn/engine` folds a long ledger on the OnePlus under Hermes, in a release
build, fast enough, and whether zod runs there at all. The O9 check proved the bundle compiles, not that it
runs. A crash is a blocker (ruling 26: S2 pauses for an engine fix release); a fold slower than one frame
(16.7 ms at 60 Hz) for a badminton match is a finding, not a blocker.

Status: **laptop done; device passed** (2026-11-02, the OnePlus NE2211; see "Device: passed" below).

## What is installed

| Package                   | Declared                                | Installed |
| ------------------------- | --------------------------------------- | --------- |
| `@seazn/engine` (alias)   | `npm:@onryde/seazn-engine@1.1.0`, exact | 1.1.0     |
| `zod` (the engine's peer) | `4.4.3`, exact: the peer range's floor  | 4.4.3     |

- zod 4.4.3 is the version the web and the engine resolve: each lockfile holds one zod, 4.4.3 (web `main`
  at `3e20c75ecd`, engine `main` at `081f7de`, read 2026-11-02). So the phone folds with the zod the
  engine's own tests ran on.
- The engine's peers are `zod ^4.4.3`, `vitest ^4.1.11` and `fast-check ^3`. The engine's `package.json`
  marks `vitest` and `fast-check` optional (`peerDependenciesMeta`), but the registry's metadata for 1.1.0,
  which is what pnpm resolves from, has no `peerDependenciesMeta` (GitHub Packages' packument, read
  2026-11-02), and neither has the lockfile's entry. So pnpm treats all three as required: it warns that
  vitest 5.0.0 does not meet `^4.1.11`, and it installed `fast-check` 3.23.2 and `pure-rand` 6.1.0 for the
  missing peer. They are JavaScript only and never imported by the app. The phone never imports the
  `testkit` subpath that needs vitest, and lint refuses that subpath in domain (below).
- Declaring zod 4.4.3 moved the tree's other zod 4 users (eas-cli's `@expo/*` packages,
  `eslint-plugin-react-hooks`) from 4.6.2 to 4.4.3, inside their own ranges.
- **Nothing autolinks.** None of the four new packages has `android/`, `ios/`, a podspec,
  `react-native.config.js` or `expo-module.config.json`, or an install script, and neither autolinking list
  names them (`expo-modules-autolinking resolve -p android` and `react-native-config -p android`,
  2026-11-02). `pnpm deps:check` fails as it did before this change, on eight Expo patch versions, none of
  them these.

## Registry access

`.npmrc` holds only `@onryde:registry=https://npm.pkg.github.com`. The plan's second line,
`//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`, does not work in a project `.npmrc` under the pinned
pnpm 10.34.5: pnpm ignores it ("environment variables are not expanded in registry credentials that come
from a project .npmrc"), and a cold install (empty store and cache, `NODE_AUTH_TOKEN` set) was refused
`ERR_PNPM_FETCH_401 … No authorization header was set`. The same line in a user-level config
(`NPM_CONFIG_USERCONFIG`, or the global rc by `pnpm config set`) installed it cold. The worktree's own
install worked only because the store and the metadata cache already held 1.1.0.

- Local, once: `pnpm config set '//npm.pkg.github.com/:_authToken' '${NODE_AUTH_TOKEN}'` (the literal, not
  the token), then `NODE_AUTH_TOKEN=$(gh auth token) pnpm install`.
- CI: every workflow that installs (`check`, `android-compile`, `bridge-contract`, `release`) has
  `packages: read`, `actions/setup-node`'s `registry-url` and `scope` (which write the same line to a
  user-level `.npmrc`), and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on the install step. Whether this
  repository's `GITHUB_TOKEN` may read the `onryde` package is **unverified until a push runs CI**.
- EAS (the next release): the `eas-build-pre-install` hook (`scripts/eas-build-pre-install.sh`), which EAS
  runs before its install, appends the line to the worker's user config (`~/.npmrc`, or the file
  `NPM_CONFIG_USERCONFIG` names) once, on every platform. It keeps what that file held: EAS's builders ship
  one with their npm cache's `registry=` (Expo's "Using private npm packages"). With no `NODE_AUTH_TOKEN` it
  stops the build at once, saying why (`test/easProfile.test.ts` runs it with a scratch `HOME`). The owner's
  part is the EAS secret, `docs/release.md` Once 8. The hook's run on a real worker is **unverified until
  the next release tag builds**.

## The probe

`src/domain/scoring/engineProbe.ts`: `syntheticBadmintonMatch()` is a decided best-of-3, home 21–15 21–18:
`core.start` and 75 `badminton.rally` events, 76 in all, the first rally naming the first server
(design §7.3). `timeFold(events, times)` folds it with `foldMatch(badminton, cfg, lineups, events,
{ strictFromSeq: 1 })`, every event validated, the heavier path, and times each fold with
`performance.now()`. The tests fold it against the engine's own schema and lineups (decided, 2–0, 21–15 and
21–18), and prove the strictness: badminton records no timeouts, and a strict fold refuses one that a replay
takes.

On the phone it is the **Fold probe** chip at the end of the S2 preview row (Home's Remote scoring tile in
the dev twin, a local release build included; `previewScoring`). It loads the engine on the tap, so an
engine that cannot load or fold reads `failed: <error>` on the chip and `scoring.foldProbe.failed {error}`
in the record, and the app stays up. A run folds the match 50 times and shows
`76 · <min> / <median> / <max> ms`; the record gets
`scoring.foldProbe {events, runs, minMs, medianMs, maxMs, firstMs}` (the record takes numbers, not arrays).

**Removed.** The probe went with the preview in Task 11: the preview stopped being mounted in `1f8f53d` (the real pad
route), and the Fold probe chip, `useFoldProbe`, `foldProbe` and `engineProbe` were deleted in the review fix after it
(`git log --diff-filter=D --oneline -- src/hooks/foldProbe.ts` names it). The result recorded here stands.

Where the plan put it, `DevScenes`, would not reach R4: `DevScenes` is in Live Stream's Diagnostics card and
shows only while `devTools` (`__DEV__`) is true, which a release build never is.

## Laptop numbers (2026-11-02)

Node 26.8.2 (V8), Intel i7-9750H, through vitest's `domain` project; each row is three runs of
`timeFold(…, 50)` in one fresh process. The machine was loaded by another repository's test shards: load
average about 450 for session A (both modes at once), about 34 for session B (one mode at a time). The
medians agree; the maxima are garbage collection and the load.

| Session | zod mode                      | median (ms) | min (ms)  | first fold of the process (ms) | max (ms)        |
| ------- | ----------------------------- | ----------- | --------- | ------------------------------ | --------------- |
| A       | JIT (`allowsEval` true, Node) | 0.16–0.21   | 0.15–0.16 | 8.2                            | 8.2, 57.8, 11.3 |
| A       | `z.config({ jitless: true })` | 0.24–0.40   | 0.22–0.26 | 5.3                            | 19.8, 5.0, 1.2  |
| B       | JIT (`allowsEval` true, Node) | 0.16–0.22   | 0.16–0.18 | 6.3                            | 6.3, 1.1, 0.7   |
| B       | `z.config({ jitless: true })` | 0.26–0.92   | 0.24–0.28 | 5.7                            | 38.3, 0.8, 0.9  |

So a 76-event fold is a fifth of a millisecond warm, and a cold first fold under 10 ms, on V8. Hermes has
no JIT and will be slower; how much slower is what the device says.

zod 4.4.3 decides for itself whether it may compile: `allowsEval` (`zod/v4/core/util.js:145`) tries
`new Function("")` inside a try/catch and falls back to the interpreted parser if it throws, or at once
under `jitless`. A `new Function` refusal therefore should not crash; the device run is what proves it.

## Device: passed (2026-11-02)

- **Device:** OnePlus NE2211, Android 16, the dev twin's release build 730 (`1.0.1-730`, from `d58a669`;
  Hermes; `@seazn/engine` 1.1.0, zod 4.4.3).
- **Run:** Home → Remote scoring → the preview row's **Fold probe**, tapped three times by the owner,
  50 strict folds of the 76-event match a run. The last run's line on screen: `76 · 0.78 / 0.84 / 6.72 ms`
  (min / median / max; the max is the first, cold fold).
- **Errors:** none. No crash, no `failed:` line, nothing from zod or `new Function` in logcat (only the
  camera HAL's own `APS_ALOG` lines, which are not the app's). `z.config({ jitless: true })` is not
  needed.
- **Verdict: R4 passes.** A refold costs under 1 ms warm on the phone, so refolding the whole match on
  every tap (Task 7) is affordable for a badminton match. A longer ledger (another sport, S2-2 on) runs the
  probe again with its own synthetic match.
- **Not measured:** a match scored entirely offline with many queued taps (one strict fold per queued tap);
  the exit bar's offline run (Task 13) watches for lag.

## The cricket snapshot: device

Plan S2-4 Task 1 (`docs/superpowers/plans/2026-11-07-s2-4-cricket-phone.md`, 2026-11-08). Every sport the
phone scores moves from 2.0.0 to the snapshot of engine PR onryde/seazn.club.engine#28 (merge commit
`44699f16`): badminton, table tennis and chess now, cricket from Batch 2 on. The snapshot pin lives on
`feat/s2-4-cricket` only; Task 20 repins to the release before the branch merges.

**The release (2026-11-09).** The pin is now `4.0.0`, exact: engine release PR onryde/seazn.club.engine#29
(merge `6c30c584`, tag `v4.0.0`). Its epoch report raises cricket only (2 → 3), as at the snapshot, and
`engineEpochs.test.ts`'s literals hold unchanged. The table below is the snapshot's, kept as the record.

| Package                 | Declared                                                                              | Installed |
| ----------------------- | ------------------------------------------------------------------------------------- | --------- |
| `@seazn/engine` (alias) | `npm:@onryde/seazn-engine@0.0.0-pr28.44699f16400a367a87747b8390c40fe16e1ff8f2`, exact | the same  |
| `zod` (the peer)        | `4.4.3`, under `pnpm-workspace.yaml`'s `zod@4: ^4.6.6` floor                          | 4.6.7     |

- **What moved.** A snapshot has no CHANGELOG: `.changeset/cricket-s2-4.md` and `src/sport/fold-epoch.ts`
  at `44699f16` name it. Ruling 71's exports (`orderFromLineup`; `cricketPadRules.wideDismissalKinds` and
  `noBallDismissalKinds`), ruling 76's hand strike swap, and ruling 75's mid-over bowler change
  (`cricket.bowler.change`, with `eligibleChangeBowlers`, `oversUsed` and `CricketBowlerChange`).
  `CRICKET_MARGIN_KINDS` is exported too. `FineInnings` is not.
- **Fold epochs** (`FOLD_EPOCH` at the snapshot): cricket 3, raised from 2 by the bowler change; badminton 2,
  tabletennis 2, boardgame 5 and football 4, as at 2.0.0. `src/domain/scoring/engineEpochs.test.ts` holds
  the phone's three and cricket's as literals.
- **Peers** are unchanged: `zod ^4.4.3`, `vitest ^4.1.11`, `fast-check ^3`. pnpm still warns that vitest
  5.1.0 does not meet `^4.1.11`.
- **`phone-subpaths.json`** names the same five subpaths and the same 59 modules in `closure.modules`
  (still measured 2026-10-31), so the domain's lint allowance (`internalPath`) and
  `test/domainBoundary.test.ts` are unchanged.
- **Nothing autolinks.** The package has no `android/`, `ios/`, podspec, `react-native.config.js`,
  `expo-module.config.json` or install script, and `expo-modules-autolinking resolve -p android` names no
  engine package (2026-11-08).
- **Same suites.** The scoring domain, the fake scoring port, the tap queue store and both boundary tests:
  73 files and 2582 tests on 2.0.0, and on the snapshot the same files with the same counts, plus
  `engineEpochs.test.ts`'s 2 (2584).

**Device: passed** (2026-11-10). The fold probe ran on the throwaway `probe/s2-4-engine` (`7f76c2d6`, never merged):
OnePlus NE2211, Android 16, release build 996 (`1.0.5-996`, engine 4.0.0), strict `foldMatch` × 50 a ledger, two runs.
Medians: badminton best-of-3 (76 events) 0.94 and 0.89 ms, table tennis best-of-5 (95) 1.00 and 0.77 ms, chess (2)
0.02 ms, and a cricket T20 tied with a super over each way (314) 7.83 and 7.88 ms, worst 8.45 ms: under one 60 Hz frame.
The table and the laptop figures are in `2026-11-10-s2-4-results.md` §"R4". The Batch 1 staging check (Step 8) is the
S2-2/S2-3/S2-4 device runs recorded in their results docs. The phone now pins 6.0.2 (cricket epoch 4, CK-SO-4); the fold's
per-event path did not change since 4.0.0.
