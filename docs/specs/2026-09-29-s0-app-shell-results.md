# S0 app shell — verification results

**Date:** 2026-09-29/30. **Branch:** `feat/s0-app-shell`. **Spec:** [2026-09-29-s0-app-shell-design.md](2026-09-29-s0-app-shell-design.md) §9.

**Device:** Redmi Note 7 Pro (Android 10, MIUI, 1080×2340 @440), serial ending `b6fb`.
The spec names the OnePlus; it was not available, so everything below was
checked on the Redmi. Builds were local (debug through `expo run:android` and
Metro; release through `expo run:android --variant release`), never EAS.

Codes used in testing were made up (`fake-sid-1`, empty credentials). No real
stream code was scanned, stored or photographed. Screenshots show only the app,
with the status bar cropped; they live in the git-ignored `.s0/` folder of the
worktree and are not committed.

## Device checklist (spec §9)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Google's scanner opens from the Live Stream tile; Back cancels to a quiet Home; a double tap opens one scanner | PASS | `BarcodeScanningActivityProxy` in focus; Home unchanged after Back. The first-use *install* path was not reachable: Play services already had the scanner module. It is covered by unit tests only. |
| 2 | A capture-v1 QR on a laptop screen opens the stream placeholder | PASS | Made-up v1 code (slot 2) read by the phone's scanner → `/stream`, SENSOR_LANDSCAPE, "Slot 2" (`t14-stream.png`) |
| 3 | A `stg.seazn.club/score/…` code shows Remote Scoring coming soon | PASS | "THIS IS A REMOTE SCORING CODE" / "Remote Scoring is coming soon." / Scan again |
| 4 | A foreign URL shows "not a Seazn code" | PASS | "NOT A SEAZN CODE" |
| 5 | An expired code shows the expiry at the right local time | PASS | "This code expired at 22:20." for `exp` 22:20 local |
| 6 | Reopen lands on the placeholder while valid; after `exp`, Home with the notice | PASS | Cold reopen → placeholder. Short-lived code, cold after `exp` → "Your Live Stream code expired at 22:45. Scan a new one."; background→foreground variant → 22:46 notice. (A short `exp` stood in for moving the phone clock.) |
| 7 | Codes survive a restart; Forget removes them | PASS | Continue card "Slot 1 · code valid till 04:30" after relaunch; Forget survives a relaunch |
| 8 | Turn card both ways, reads upright in the hand | PASS (owner) | Owner held the phone: portrait Home → sideways → card → landscape → Back → card → portrait. Glyph-only card per R28. |
| 9 | Flat on a table enters Live Stream with no card | PASS | Face-down phone → `/stream`, no card |
| 10 | Four languages switch all text and persist; German shows English | PASS / not testable | es, fr, nl, en on Home and the code panel; nl survived a restart. German fallback needs per-app locales (Android 13+); the Redmi is Android 10. Unit-tested only. |
| 11 | Fits at 2–3 sizes | PASS | Redmi, 720×1280 @320 and 1080×2400 @420 (`wm size`/`density`, reset after) — Home, code panel and placeholder, nothing clipped |

## Release build

| Check | Result |
|---|---|
| No dev paste field on Home | PASS |
| No dev engine controls on the placeholder | PASS |
| Keep-awake off on Home | PASS (no `KEEP_SCREEN_ON`) |
| Keep-awake off on `/stream` with the engine idle | PASS — matches `useKeepAwake` (off in idle and ended) |
| Keep-awake on while armed or live | **Not proven** — release has no way to arm; S1's engine owns this. In debug the dev client forces `KEEP_SCREEN_ON` everywhere, so debug can't answer it either. |

The release build found R34 (below): with the phone resting in the
orientation dead band, the placeholder opened in portrait
(`release-stream-portrait.png`).

## Findings from device work

Each was fixed on this branch and re-checked on the Redmi unless it says otherwise.

| ID | Found by | What happened | Fix | Re-checked |
|---|---|---|---|---|
| R31 | Device (T14) | Android Back with the code panel open left the app | Back closes the panel and the language list | PASS — panel and list close; with nothing open Back still leaves |
| R34 | Release build | A phone resting face down at ~20° reads inside the flat/held dead band (z share 0.939 against 0.94), never settles, and so was never locked: Home followed auto-rotate and the placeholder opened **portrait** | An unsettled reading locks the route's target unless the engine is armed or live | PASS — same pose: Home PORTRAIT, `/stream` SENSOR_LANDSCAPE |
| R35 | Device, after R34 | Armed engine, leave to Home, reading unsettled: the kept landscape lock drew Home sideways, tiles overlapping and unreachable | When a kept lock disagrees with the route, the route's turn card covers the screen | PASS — "Turn your phone upright" card covers Home; TalkBack tree shows only the card |
| R36 | Final review, proved on device | Every scan sends the app to Play services and back; the return re-ran the reopen gate mid-scan. A first fix (a flag held during the scan) did nothing on Android: a probe showed the scan result lands **44 ms before** the foreground event | The scan flight also covers the return: the next foreground after leaving for the scanner is claimed | PASS — probe: scanner Back → claimed; a later ordinary return → not claimed |
| I1 | Final review | After Stop → Home, the engine stayed stopped, so the next fresh code was forgotten on leaving | Leaving after Stop resets the engine (only if it is still stopped) | PASS — live → Stop → Home; new code → Home keeps it |
| — | Owner lens | Status line indented ~20 dp | Horizontal padding removed | PASS |
| — | Owner lens | `/stream` Home button stretches full column height; the dev Tools button overlaps it | Deferred to S1, which redraws the column | — |
| — | Owner lens | Coming-soon tiles as bright as the live tile | Deferred to S1 | — |

Also recorded: in a debug build Expo's dev tools keep the screen on everywhere,
so keep-awake can only be judged in a release build (AGENTS §13).

## Mutations (spec §9)

Unit mutations, each applied to one line, run against its focused tests, then restored from a copy (`git status` clean after each).

| Mutation | Tests | Result |
|---|---|---|
| `recognise` accepts a suffix host (`endsWith`) | recognise | RED, 2 fail |
| `reopenTarget` lets a saved state beat an **armed** engine | reopen | RED, 1 fail |
| Hysteresis `HOLD_MS` 300 → 0 | orientation | RED, 3 fail |
| The i18n check meets a renamed placeholder (`{time}` → `{hora}` in es) | dictionaries | RED, 1 fail |
| Scan guard: a second scan is let through | scanFlight + Home | RED, 3 fail |
| `leaveRule`: live becomes free to leave | reopen + placeholder | RED, 4 fail |
| Continue card reads the clock once, at mount | Home | **SURVIVED** (55/55) → test added (`8d0082c`) → RED, 1 fail |

The fix wave's own guards (scan flight, write queue, compare-and-delete,
engine reset, Back handling, R34/R35/R37 rows) were each mutated by the
implementer with RED evidence, reviewed in two scoped re-reviews.

## Not proven here

- iOS: nothing in S0 was run on an iPhone. VoiceOver announcement of the turn card is a known gap.
- The real capture engine: S0 has only the fake. Keep-awake while armed or live, orientation holds under a real camera session, and R37 (the lock after a remount mid-broadcast) are S1's.
- German-to-English fallback on a real phone (needs Android 13+).
- Scanner first-use install.
- The hand-only checks listed for the owner: turn card on Home and Stream with no flash, TalkBack announcement and no reach behind the card, reduced motion (still glyph), unsupported-locale fallback.
- The 3-hour soak (deferred to app completion).
