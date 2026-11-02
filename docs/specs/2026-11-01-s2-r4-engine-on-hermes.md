# R4 — the engine on the phone: results

Plan S2-1 Task 1 (`docs/superpowers/plans/2026-11-01-s2-1-remote-scoring.md`), design §6.2. The decision
record's R4 asks whether `@seazn/engine` folds a long ledger on the OnePlus under Hermes, in a release
build, fast enough, and whether zod runs there at all. The O9 check proved the bundle compiles, not that it
runs. A crash is a blocker (ruling 26: S2 pauses for an engine fix release); a fold slower than one frame
(16.7 ms at 60 Hz) for a badminton match is a finding, not a blocker.

Status: **laptop done; device pending** (Step 7 is the controller's).

## What is installed

| Package                   | Declared                                | Installed |
| ------------------------- | --------------------------------------- | --------- |
| `@seazn/engine` (alias)   | `npm:@onryde/seazn-engine@1.1.0`, exact | 1.1.0     |
| `zod` (the engine's peer) | `4.4.3`, exact: the peer range's floor  | 4.4.3     |

- The engine's peers are `zod ^4.4.3`, and `vitest ^4.1.11` and `fast-check ^3`, both optional
  (`peerDependenciesMeta`). pnpm warns that vitest 5.0.0 does not meet `^4.1.11`; the phone never imports the
  `testkit` subpath that needs it, and lint refuses it in domain (below). pnpm also installed `fast-check`
  3.23.2 and `pure-rand` 6.1.0 for that optional peer: JavaScript only, never imported by the app.
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
- EAS (the next release): `docs/release.md` Once 8. EAS needs a `NODE_AUTH_TOKEN` secret, and its install
  needs the credential line at user level too, which nothing writes yet.

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

## Device: pending

The controller's (Step 7): a release build of the dev twin on the OnePlus; Home → Remote scoring → scroll
the preview row to **Fold probe** → tap, twice or more (the first run pays the load and any warm-up), and
read the line and the record's `scoring.foldProbe` lines (with nothing paired the line is in the JS ring,
which Share record in Stream Settings hands over). Record here: the device and Android version, the
build (`appVersion`), each run's line, and the verdict. A `failed:` line or a crash is a blocker (ruling 26);
if the error is zod reaching `new Function`, add `z.config({ jitless: true })` where the engine is first
imported and run again.
