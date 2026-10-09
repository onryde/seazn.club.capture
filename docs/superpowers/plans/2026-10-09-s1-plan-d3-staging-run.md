# S1 Plan D3: the staging run, a verification plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan task by task. The owner's hands are needed in almost every task, so it runs in the main session and never in subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove S1 on staging, on a release build of main that holds D1 and D2. Every row of spec §5 gets its evidence, and the evidence is filed in `docs/specs/2026-10-xx-s1-plan-d-results.md`.

**Architecture:** This is a verification run, not code. Each task is a group of staging rows. Each step is one action by the owner or the agent, with an Expected line. The witnesses are the phone's screen (screenshots, cropped), the native session record (read back with Share record, because a release build has no `run-as`), `adb` reads, the web console as the owner reads it, and Cloudflare's playlist and API read from the laptop. Every task that puts a phone on air ends by deleting its Cloudflare recordings.

**Tech Stack:** a local Gradle release build (`pnpm expo prebuild -p android --no-install`, then `./gradlew assembleRelease`), `adb`, `ffmpeg`, `curl`, `node`, the Cloudflare Stream API, and staging (`stg.seazn.club`).

**Spec:** `docs/specs/2026-10-09-s1-plan-d-design.md`. This plan carries out §5 (slice D3) exactly, and uses §2 (the web side), §3.7 (the missing plan C results) and §8 (risks).

## Global Constraints

**Builds and the repo**

- Build locally and never run EAS: no `eas build`, `eas submit` or `eas update` (AGENTS §11; owner ruling 2026-09-11).
- Prebuild rewrites `package.json`. Restore it from the copy you take before every prebuild, and never commit it (AGENTS §13).
- `JAVA_HOME` is already JDK 17. Do not override it with `/usr/libexec/java_home -v 17`.
- The shell's cwd resets between calls, so every command you judge starts with `cd "$WT" &&`.
- Capture exit codes with a redirect and never a pipe: `cmd > "$EVID/x.txt" 2>&1; echo "EXIT=$?"`.
- Never use a bare `git stash` or `pop` (the stash is shared by every worktree). This run commits nothing except the results document, at the end, on a docs branch.

**Where things live**

- `REPO=/Users/ashokhein/github/seazn.club.capture`
- `WT=$REPO/.claude/worktrees/d3-staging` is the build worktree, at `origin/main`. `.claude/worktrees/` is gitignored.
- `EVID=$HOME/seazn-d3-evidence/<run date>` is outside every repo. Screenshots, shared records and logs go here, and none of them is committed. The owner may name another folder at the start. It must be outside the repo.
- `PKG=com.seazn.capture`
- `UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'`. Cloudflare's manifest answers `403 error code: 1010` to a non-browser User-Agent (U1-S6), so every `curl` or `ffmpeg` read of a playlist sends this one.
- With two phones attached, add `-s <serial>` to every `adb` command. `adb devices` lists the serials. The OnePlus is `12be753e`.

**Security** (plan C Task 40's rule, verbatim): "Never log, print, screenshot or commit a code's raw value, `tok`, an SRT passphrase or stream id, or an RTMPS stream key." Real staging codes are on paper or on the owner's laptop screen, and only the phone scans them. The Cloudflare account id and API token stay in the owner's own terminal and never go into this session. In the results, a Cloudflare uid is cut to 8 characters and `…`, as the P5 results did.

**Device evidence** (AGENTS §13)

- Verify as the customer. Report what the screen showed, not what the code implies. Open every screenshot before you cite it.
- Steps that need the owner's hands (scanning, holding, locking, turning, calling, the console, the web app) are listed for the owner. They are never simulated or reported as done by the agent.
- Never `am force-stop` or relaunch the app while the owner is holding the phone for a check, unless you have said so first. A force-stop with no warning reads to the owner as a crash.
- A black screenshot usually means the phone is locked or dozing. Check that before you diagnose anything.
- Every `wm size` and `wm density` override is reset afterwards, and the reset is confirmed.
- A claim that jsdom cannot see (brightness, video, colour, the bars' hues, the lock screen, the notification) is marked **device-only** in the results.

**The screenshot recipe** (every "Screenshot" step)

1. `adb exec-out screencap -p > "$EVID/<name>-raw.png"`
2. Open `$EVID/<name>-raw.png` with the Read tool. Check it is not black, and that nothing personal is in it: no other app, no other notification, no face, and no code. If anything personal shows, delete the file and retake it.
3. Read the status bar's height in pixels from the image, then crop it. `sips --cropOffset` silently does nothing, so use ffmpeg: `ffmpeg -y -i "$EVID/<name>-raw.png" -vf "crop=iw:ih-<bar>:0:<bar>" "$EVID/<name>.png" && rm "$EVID/<name>-raw.png"`
4. Open `$EVID/<name>.png` and confirm the crop.

**The record recipe** (every "Read the record" step)

1. The owner opens Settings (the icon row), then the Diagnostics card (`diag.title`, "Diagnostics"), and taps **Share record** (`diag.share`, "Share record"). The owner sends it to the laptop by their usual route (AGENTS §13; the record holds no secret, but it is never screenshotted). Save it as `$EVID/<task>-record.ndjson`.
2. Each line is one JSON object, `{at, kind, …}`, with `at` in ISO UTC. You can read it with `grep '"kind":"<kind>"' "$EVID/<task>-record.ndjson"`.
3. These are the line kinds this plan reads, as the native code writes them:
   - `heartbeat {result, status, word, claim}`. `word` is `Open` (a go-live or live answer, with a sid), `Over`, `NoBroadcast` (waiting), `Replaced`, `Taken` or `CodeEnded`. **While paired, a beat line is written only when it changes**, so an unchanged wait writes nothing. While a broadcast is held, every beat is written.
   - `broadcast-start {sid, cause}`. `cause` is `organiser`, `automatic`, `rejoin` or `operator`.
   - `broadcast-ended {sid, lastEnd, wasLive}`. `lastEnd` is `stopped-by-organiser`, `stopped-automatically`, `hold-window-expired`, `phone-lost` and so on.
   - `start-refused {refusal}`, `connecting`, `connect-failed`, `fell-back {from, to}`, `connected {transport}`, `live {transport}`, `hold-expired`, `stopped-delivered {status}`.
   - `delivered`, `not-delivered {cause, stalledMs, lagGrowthMs}`. `cause` is `stalled` or `lagging`.
   - `readiness {camera, sound, held, side}`, `thermal`, `shed`, `camera-taken`, `camera-reopened`, `mic-silenced`, `wake-lock`, `keeper-failed`, `previous-session-lost`.

**The recording recipe** (every "Delete the recordings" step)

These are owner steps, run in the owner's own terminal with `CF_ACCOUNT_ID` and `CF_API_TOKEN` set. The account is shared and prepaid, and a recording outlives its live input, so every broadcast's recording is deleted. The live input itself belongs to the web, so never delete it. To find the input's uid, ask `mobile-s1-web` which input the fixture uses, or use the Cloudflare dashboard (Stream, then Live inputs).

```bash
curl -s -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/stream/live_inputs/$INPUT_UID/videos" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const v of JSON.parse(s).result)console.log(v.uid,v.status&&v.status.state,v.duration,v.created)})'
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/stream/$VIDEO_UID"
```

- Expected: `200` for each video created during the task. Run the list again: those videos are gone.
- A `409` (code 10046) means the recording is still `live-inprogress`. Cloudflare refuses the delete until the recording finalises (P5 results), so wait a few minutes and repeat. A recording is never reported deleted until the list no longer shows it.
- Before you delete a recording, write its count and its durations into the task's results section. Row 7 needs the count.

**Copy**

- Expected strings are the dictionary's. Each one is quoted with its key, from `src/i18n/en.json`.
- D2 adds or rewords keys, such as `stream.advisory.shed` and the viewer-check keys under `stream.peek.`, and the heat caption with What viewers see hidden, `stream.advisory.hotLive` and `stream.advisory.hot` (the owner's ruling, 2026-10-09: the view is built and hidden behind `FEATURES.viewerCheck`, `src/ui/features.ts`). D1 adds no phone word for `match_finished`, because start never sends it (spec §3.4). Their final English is decided in the D1 and D2 plans, which do not exist yet. Task 0 Step 4 dumps them from the build commit into `$EVID/keys.txt`. The steps here name those keys, and the results quote the strings from `$EVID/keys.txt`, never from this plan.

**Web basis**

- Spec §2: staging runs web `e201fab8f`. The only change since `8afdd8b42` is web #930, which touches only the console, and the contracts are byte-identical. This is a peer report from `mobile-s1-web`, not an owner ruling.
- The console's Go live refuses a paired but silent phone with `409 phone_not_responding`, and shows "The camera phone isn't responding. Open Seazn Capture on the phone and keep it unlocked, then go live." `phone_not_paired` means only that no phone holds the pairing. The red error clears once the phone reads present again.
- A15, from the peer's answers:
  - a hand restart made **during** the match (session created before the result) is auto-stopped when the result lands. That needs the org switch on and the phone in automatic;
  - a hand start **after** the result, inside the 120-minute grace, is admitted and never auto-stopped;
  - past the grace, a phone start answers `401 code_ended`, and an organiser Go live answers `409 phone_not_paired`.
- `match_finished` is never sent by start, only by the scoring-link route (spec §3.4).
- A17 after an A14 takeover: the old phone's late beat hears `replaced`, the server records `stop_ignored {held:true}`, and the new phone's broadcast is not interrupted. If that same beat carries `claim` `new` while the new phone is alive, it hears `taken`. The web calls this the first deterministic proof of the live·dead T4 case.
- **Names of the web's steps** (web spec §12, as the peer gave them):
  - S3 is the SRT hold;
  - **S10 is the exit bar**: a real phone end to end, including the A14 takeover;
  - S11 is `phone_lost` at 15 minutes;
  - S2b is moot under W26.
  - The **forced-RTMPS session id** is not a §12 step. It is tracked under that name. The nearest web steps are S1's flag-false variant and S2's RTMPS leg.

## Review Focus

These five conditions are the ones most likely to give a false result. The spec implies each of them, but no row checks it on its own.

1. **A phone that is not really locked.** Keep-awake holds the screen on while paired (R4), so a phone left alone is dimmed, not locked. Row 2b is only true if the power button was pressed and the phone reads asleep. Task 2 Step 6 checks this with `dumpsys power` and a black screencap.
2. **A beat cadence read from the wrong lines.** The `heartbeat` line is written while paired only when the answer changes, so a cadence read from it looks like long gaps. Task 6 reads only D1's beat-send lines, one per beat sent (spec §3.4). The web's history, at most one row per 60 s, only corroborates the 60 s cadence and the state changes. It never proves a 10 s or 5 s cadence.
3. **Credit spent by accident.** A phone paired in automatic mode to the swiss R2 match that is already `in_play` goes live and spends a credit. Task 8 Step 1 and Task 10 Step 1 put the phone in operator mode and confirm the switch reads off before any round-line pairing.
4. **A screen-size override left in place.** Every later screenshot would then be at the wrong geometry. Task 10 Step 9 resets the overrides and confirms them. Task 12 Step 1 checks again before the results are written.
5. **A recording reported deleted while Cloudflare still holds it.** A `409` while the recording is `live-inprogress` looks like an ordinary failure. Every deletion step lists the recordings again, and Task 12 Step 2 checks every input used in the run.

---

### Task 0: Prerequisites and the build

**Rows:** spec §5's prerequisites, and §5.3's re-established facts (set up here, read in Tasks 1 and 2).

- [ ] **Step 1 (agent): Confirm D1 and D2 are on main.**

```bash
mkdir -p "$EVID"
cd "$REPO" && git fetch origin > "$EVID/fetch.txt" 2>&1; echo "EXIT=$?"
cd "$REPO" && git worktree add "$WT" origin/main > "$EVID/worktree.txt" 2>&1; echo "EXIT=$?"
cd "$WT" && git rev-parse HEAD | tee "$EVID/build.txt"
cd "$WT" && test -f contracts/VENDORED.json && test -f src/domain/session/viewerCheck.ts && test -f src/domain/session/idleDim.ts; echo "FILES=$?"
cd "$WT" && grep -rl 'OverlayPreview' src; echo "OVERLAY_GREP=$?"
cd "$WT" && grep -rhoE '(record|line)\("[a-z-]*beat[a-z-]*"' modules/capture-engine/android/core/src/main | sort -u
```

- Expected:
  - A sha in `$EVID/build.txt`, and `FILES=0`.
  - The `OverlayPreview` grep lists no file, so `OVERLAY_GREP=1`.
  - The last grep lists `heartbeat`, `final-beat` and **one more kind**: D1's beat-send line (spec §3.4). Write that kind into `$EVID/build.txt` as `BEAT_KIND=<kind>`. Task 6 reads it.
  - If no new kind appears, read D1's commit for the line's kind name. If D1 took §3.4's fallback (one line per change of interval, plus a count per minute), write down both kinds.
- Fail: if any check fails, D1 or D2 is not merged. Stop and report to the coordinator. D3 never runs on a build without both.

- [ ] **Step 2 (agent): Build the release APK.**

```bash
cd "$WT" && pnpm install --frozen-lockfile > "$EVID/install.txt" 2>&1; echo "EXIT=$?"
cd "$WT" && cp package.json "$EVID/package.json.bak" && pnpm expo prebuild -p android --no-install > "$EVID/prebuild.txt" 2>&1; echo "EXIT=$?"
cd "$WT" && cp "$EVID/package.json.bak" package.json && git status --short
cd "$WT/android" && ./gradlew assembleRelease --console=plain > "$EVID/assemble-release.txt" 2>&1; echo "EXIT=$?"
cd "$WT" && shasum -a 256 android/app/build/outputs/apk/release/app-release.apk | tee -a "$EVID/build.txt"
```

- Expected: `EXIT=0` for each step. `git status --short` prints nothing, because the restored `package.json` matches and `/android` is ignored. The APK's sha256 goes into `$EVID/build.txt`.
- On a bare prebuild, the release build is signed with prebuild's debug keystore (P5 results). That is fine for this run.

- [ ] **Step 2a (owner, optional): Settings before the install.** Only if the OnePlus holds a pre-D2 build signed with the same key as this one. Open Live Stream with a printed code, and in its Settings set "Controls on the" to **Left** and turn "Start and stop automatically" **off**. Write both down.
  - This is the one check of D2's settings upgrade (wire v2 → v3, D2 §4.1): a saved setting survives it. If the install in Step 3 needs an uninstall, the settings are gone, this check is not run, and the results say so.

- [ ] **Step 3 (agent): Install on each phone and note the geometry.**

```bash
adb devices
adb -s 12be753e install -r "$WT/android/app/build/outputs/apk/release/app-release.apk"
adb -s 12be753e shell wm size
adb -s 12be753e shell wm density
```

- Expected: `Success`. If the phone holds a build signed with another key, the install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Then `adb -s 12be753e uninstall com.seazn.capture` and install again. Saved codes are lost, and nothing in this run needs them.
- Write the physical `wm size` and `wm density` into `$EVID/build.txt`. Task 10 resets to these.
- Repeat on the second phone, with its own serial.

- [ ] **Step 3a (owner and agent): What D2 removed and blocked is gone from the installed app.**
  - (Agent) Run `adb -s 12be753e shell dumpsys package com.seazn.capture | grep -c WRITE_SETTINGS`. Expected: `0`. The `expo-brightness` plugin's permission is blocked in `app.json` (D2 PD3).
  - (Owner) In Android Settings, under Special app access, then Modify system settings: Seazn Capture is not listed. The app never asks for it.
  - (Owner) Open Live Stream's Settings, with a printed code as in Step 2a. Expected: Settings has no "Score preview" switch: the automatic switch is the only switch (D2 §4.1). This holds whether or not Step 2a ran.
  - (Owner) If Step 2a ran: "Controls on the" still reads **Left**, and the automatic switch is still off.
  - (Owner) Then go back to Home and, on Home, tap _Forget_ on the Continue card (`home.continue.forget`), so no pairing is held. Going Home alone keeps the pairing, and the Continue card offers it again; only Forget drops it (`useForget`, `src/hooks/useHome.ts`). The settings above are kept: they are not the pairing's.

- [ ] **Step 4 (agent): Dump the copy the run quotes.**

```bash
cd "$WT" && grep -nE '"stream\.(status|advisory|peek|chip|startsAt)[^"]*"|"panel\.(replaced|taken)\.|"diag\.(share|lag|transport|hbSent)"|"settings\.automatic\.' src/i18n/en.json > "$EVID/keys.txt"; echo "EXIT=$?"
```

- Expected: `EXIT=0`, and the file holds the reworded `stream.advisory.shed`, the hidden view's heat captions `stream.advisory.hotLive` and `stream.advisory.hot`, and D2's `stream.peek.*` keys (the loading countdown, the not-ready line, the honest label and the disabled reason). `stream.peek.hint` should no longer say "Press and hold".
- Fail: if any of these is missing, D2 is not what the spec says. Report it before going on.

- [ ] **Step 5 (owner): Staging is ready.** Each of these is arranged on staging (`stg.seazn.club`) and confirmed:
  - Credit: top up the staging org's streaming credit for **at least 22 broadcasts**. Credit is spent on the first ingest only (W5). The broadcasts this plan opens are:
    - row 1, 1b, and 1c twice;
    - 2a, 2b, 4 and 7 (twice);
    - 9;
    - 11 (twice), and S11 (once or twice);
    - 12 (up to six: four for the viewers' video, one for Task 10 Step 10d, one for Step 10e). The four for the viewers' video are deferred with it while the view is hidden (Task 10), so two are spent now; the count keeps the four for the run that turns the switch on;
    - 13 (twice: the rung, and Task 11 Step 5a's Spanish caption).
  - Two matches for Task 1, M1 and M2. They are on fixtures the owner can start and finish in the web app, each scheduled to start within 30 minutes, so the beat cadence is 10 s. The org's automatic switch is on, and the destination is YouTube (a test channel). The owner holds their printed stream codes. M1 also serves Tasks 2, 5, 9 and 10, or another scheduled match does. The round-line fixtures of spec §5.2 already exist on staging, and Task 8 lists them.
  - A second Android 12+ phone for rows 4, 5 and 6. CD34 rules out the Redmi Note 7 Pro (Android 10), because the app's minSdk is 31. With no second phone, rows 4 to 6 are **blocked**, and the results say so.
  - A phone that can call the OnePlus, for row 11.
  - A Wi-Fi router whose admin page can drop outbound UDP (rows 9 and 11), and the OnePlus on that Wi-Fi with mobile data off in Settings.
  - The phone on a wall-powered supply. A power bank does not out-deliver the encode (P5 results).

- [ ] **Step 6 (agent): Ask `mobile-s1-web` for the live inputs.** For each fixture the owner names, ask which Cloudflare live input it uses (for the recording recipe). Name fixtures by org, division and match, never by a code.
  - Expected: the answers are in `$EVID/web-answers.txt` before Task 1.

- [ ] **Step 7 (owner): Check the Cloudflare token works.**

```bash
curl -s -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/tokens/verify"
```

- Expected: `"success":true`. Verify at `/accounts/{id}/tokens/verify`. `/user/tokens/verify` gives a false `1000 Invalid API Token`.

---

### Task 1: Automatic start and stop (rows 1, 1a, 1b, 1c), carries 20 and 26, and the notification

**Rows:** 1, 1a (A12), 1b (A16), 1c (A15). Carry 20 (hint 0.1 and the listed window) and carry 26 (the 20 s per 60 s lag rule) are read on row 1's fixture. §5.3's notification text is also read here.

The order saves credit and uses two matches.

- M1 carries row 1, then row 1c (ii): a hand start after the result.
- M2 carries row 1b, then row 1a, then row 1c (i): a hand restart during the match.

The phone stays in automatic mode, with the org switch on, for the whole task.

- [ ] **Step 1 (owner): Pair to M1 in automatic mode.**
  - Open the app. On Home, tap the Live Stream tile and scan M1's code.
  - Hold the phone sideways on the tripod.
  - In Settings, turn on "Start and stop automatically" (`settings.automatic.label`), and go back to the camera.
- Expected:
  - The status line reads "Waiting for Go live · {destination}" (`stream.status.waitingGoLive`).
  - The chips show "Auto" (`stream.chip.auto`) and "Starts {time}" (`stream.startsAt`) with the match's time.
  - (Agent) Screenshot `r1-paired`.
- [ ] **Step 2 (owner and agent): The paired notification (§5.3, device-only).** The owner pulls down the shade, with any other notification cleared or swiped aside. Screenshot `r1-notif-paired`, and crop it to our card with `ffmpeg -y -i in.png -vf "crop=<w>:<h>:<x>:<y>" out.png`, using the card's box measured from the opened image.
  - Expected: "Paired · waiting for Go live" (`stream.notification.paired`).
- [ ] **Step 3 (owner): Start M1.** In the web app, start M1 (it goes `in_play`). Write the wall-clock time to the second into `$EVID/r1-times.txt`. Do not touch the phone.
  - Expected: within one poll (10 s), the line reads "Going live — the match has started" (`stream.status.goingLiveMatch`), then "Live. Sound and picture going out." (`stream.status.live`), and the tally is red LIVE.
  - (Agent) Screenshot `r1-live`.
- [ ] **Step 4 (owner and agent): The live notification (§5.3, device-only).** Pull down the shade. Screenshot `r1-notif-live`, cropped to our card.
  - Expected: `LIVE · <kbps>k · <n> min`. `<kbps>` is the regulator's target, at most 3000.
- [ ] **Step 5 (agent): Carry 20, read from the laptop while live.**
  - The owner shares the record now (record recipe, saved as `$EVID/r1-record-live.ndjson`).
  - Take `playbackUrl` from its lines (`grep -o '"playbackUrl":"[^"]*"'`) and put it in `URL` in this shell only. It is public by the scrub's rule, but it is never written into the results.

```bash
curl -s -A "$UA" "$URL" | grep -c '#EXT-X-STREAM-INF'
curl -s -A "$UA" "$URL?clientBandwidthHint=0.1" | grep -c '#EXT-X-STREAM-INF'
V=$(curl -s -A "$UA" "$URL?clientBandwidthHint=0.1" | grep -v '^#' | head -1); case "$V" in http*) VURL="$V";; *) VURL="${URL%/*}/$V";; esac
curl -s -A "$UA" "$VURL" | awk -F'[:,]' '/#EXTINF/{n++; s+=$2} /#EXT-X-TARGETDURATION/{t=$2} END{print n" segments, "s" s listed, target "t}'
```

- Expected: the first count is the number of renditions, N ≥ 1, and you record it. The hinted count is exactly `1` ("hint 0.1 returns one variant"). The last line gives Cloudflare's listed window, in segments and seconds, and you record it.
- Pass: the hinted count is 1.
- [ ] **Step 6 (owner): Let it run for 15 minutes.** Leave the phone alone. Every 5 minutes, the owner opens Settings, then Diagnostics, and the agent takes a screenshot (`r1-diag-5`, `r1-diag-10`, `r1-diag-15`). These read "Behind live" (`diag.lag`) for carry 26.
- [ ] **Step 7 (owner): Enter M1's result in the web app.**
  - Expected: within one poll of the result, with no touch, the line reads "Match finished — stream stopped" (`stream.status.stoppedMatch`).
  - (Agent) Screenshot `r1-stopped`. Write the result's time into `$EVID/r1-times.txt`.
- [ ] **Step 8 (agent): Read the record for rows 1 and carry 26.** Use the record recipe, saved as `$EVID/r1-record.ndjson`.
  - Expected for row 1:
    - one `broadcast-start` with `cause` `automatic`, whose `at` is within 10 s of the start time in Step 3 (allow the beat's round trip, and record the gap);
    - then `connected` and `live`;
    - then `heartbeat` with `word` `Over`, and `broadcast-ended` with `lastEnd` `stopped-automatically` and `wasLive` true, within 10 s of the result in Step 7.
  - Expected for carry 26:
    - `delivered` once after `live`;
    - no `not-delivered` with `cause` `lagging` on a healthy link.
    - Any `not-delivered` line is quoted with `cause`, `stalledMs` and `lagGrowthMs`. Set it beside the Diagnostics "Behind live" readings to judge whether the rule (lag growth of 20 000 ms within a 60 000 ms window) fired on a real lag.
- [ ] **Step 9 (owner): Row 1c (ii), a hand start after the result, on M1.** M1 has its result and has auto-stopped (Step 7). Write down the time. Within the 120-minute grace, still paired to M1, hold **Go live** on the phone for 3 s, by hand.
  - Expected:
    - it is admitted, with no `start-refused` line;
    - "Opening the link." (`stream.status.connecting`), then LIVE;
    - it is **not** auto-stopped. Wait **6 minutes**, which is past the 5-minute cron and many polls: still LIVE.
  - (Agent) Screenshot `r1c2-live`, after the 6 minutes.
  - Then the owner stops it from the console.
  - Expected in the record: `broadcast-start` with `cause` `operator`, then `broadcast-ended` with `lastEnd` `stopped-by-organiser`, and no `stopped-automatically`.
  - This step is also row 3's grace check (spec §5.1, row 3). Task 3 cites its evidence.
- [ ] **Step 10 (owner): Row 1b, A16, on M2.**
  - Go back to Home and tap _Forget_ on the Continue card (`home.continue.forget`), so the phone holds no pairing. Going Home alone keeps it.
  - In the web app, start M2, so it is `in_play` with the org switch on.
  - Then scan M2's code. Settings' automatic switch is still on from Step 1, and it is a stored setting.
  - Expected: one `broadcast-start` with `cause` `automatic` within one poll of the pairing, and **one only**, in the record for the next 2 minutes. The line reads "Going live — the match has started" (`stream.status.goingLiveMatch`), then LIVE.
  - (Agent) Screenshot `r1b-live`.
- [ ] **Step 11 (owner): Row 1a, A12, on M2.** While M2 is still `in_play`, press **Stop** in the console. Wait 60 s, which is six polls.
  - Expected: "Organiser stopped it — waiting for Go live" (`stream.status.stoppedOrganiser`, A:633). There is **no** auto-restart.
  - (Agent) Screenshot `r1a-stopped`. In the record: `broadcast-ended` with `lastEnd` `stopped-by-organiser`, and no later `broadcast-start`.
- [ ] **Step 12 (owner): Row 1c (i), A15, a hand restart during the match, on M2.** M2 is still `in_play`. The phone is in automatic, and the switch is on.
  - Hold **Go live** on the phone for 3 s. Expected: LIVE. This session is created before the result.
  - Wait 2 minutes, then enter M2's result in the web app. Write down the time.
  - Expected:
    - it is auto-stopped when the result lands: within one poll, or at most the 5-minute cron;
    - the phone shows "Match finished — stream stopped" (`stream.status.stoppedMatch`);
    - the record holds `broadcast-start` with `cause` `operator`, then `heartbeat` with `word` `Over`, then `broadcast-ended` with `lastEnd` `stopped-automatically`.
  - Send the sid from `broadcast-start` to `mobile-s1-web`, and ask it to confirm that the server ended the session with `session_predates_result`.
  - (Agent) Screenshot `r1c1-stopped`.
- [ ] **Step 13 (owner, optional): Past the grace, on M1.** Do this only if the run is still going **more than 120 minutes after M1's result** (Step 7), and the phone is still paired to M1.
  - Expected, per the peer's answers: a phone start answers `401 code_ended`, and an organiser Go live answers `409 phone_not_paired`.
  - On the phone, the beats themselves may already answer `401` and end the code before any start. Write down what the screen showed. The existing reading is Home's "Code ended" (`panel.codeEnded.title`), with "This code has ended. Scan the new one." (`panel.codeEnded.body`).
  - Then the owner presses Go live in the console. Expected: `409 phone_not_paired`.
  - (Agent) Screenshot `r1c-grace-ended`. In the record: a `heartbeat` line, or a start, with `status` `401` and `word` `CodeEnded`.
  - If the step is not run, the results say "not run (optional)".
- [ ] **Step 14 (owner): Delete the recordings** for rows 1, 1a, 1b and 1c (the recording recipe). Record the count and durations first.

**Pass and fail:**

- **Row 1 passes** when the start came with no touch within one poll (cause `automatic`), and the stop came with no touch, showing `stoppedMatch`.
- **Row 1a** passes when there is no restart after the organiser's Stop.
- **Row 1b** passes when there is exactly one automatic start.
- **Row 1c passes** when the restart made during the match was stopped automatically (i), and the start after the result was admitted and not stopped (ii). The past-grace step is optional, and its outcome is recorded either way.
- A screen line that differs from the dictionary string fails its row.
- **Device-only:** the notification texts, the LIVE tally and the lag readings.

---

### Task 2: The console's Go live and Stop (rows 2a, 2b and 2c), and §5.3's locked-phone facts

**Rows:** 2 (a) is the default path, R4: a dimmed phone. 2 (b) is the fallback: a locked phone. 2 (c) is the negative check the coordinator added: a phone that is not responding. §5.3: the camera and microphone open on a locked phone, and readiness passes there.

- [ ] **Step 1 (owner): Pair in operator mode.**
  - Pair the row 1 fixture, or another scheduled match.
  - In Settings, turn "Start and stop automatically" off, so only the console starts it.
  - Put the phone sideways on the tripod and leave it alone for 2 minutes. That is past both the 30 s dim and max(60 s, poll + 30 s).
  - Expected: after 30 s with no touch, the screen dims (R8) and stays on. The owner confirms this by eye (**device-only**; a screencap does not show brightness).
- [ ] **Step 2 (owner): Row 2a, the console Go live on the dimmed phone.** Press **Go live** in the console. Write the time into `$EVID/r2-times.txt`.
  - Expected:
    - The console accepts it, and shows **no** `phone_not_responding` error ("The camera phone isn't responding…"). The dimmed phone must read present.
    - Within one poll, the phone shows "Going live — started by the organiser" (`stream.status.goingLiveOrganiser`), then LIVE.
    - The screen is no longer dim. Arming restores it.
  - (Agent) Screenshot `r2a-live`.
- [ ] **Step 3 (owner): Row 2a, the console Stop.** Press **Stop** in the console.
  - Expected: on the next beat, "Organiser stopped it — waiting for Go live" (`stream.status.stoppedOrganiser`). (Agent) Screenshot `r2a-stopped`.
- [ ] **Step 4 (agent): Read the record** (`$EVID/r2a-record.ndjson`).
  - Expected: `broadcast-start` with `cause` `organiser`, within one poll of the console time. Then `connected` and `live`. Then `heartbeat` with `word` `Over`, and `broadcast-ended` with `lastEnd` `stopped-by-organiser`.
- [ ] **Step 5 (agent): The service is held.** Run `adb shell dumpsys activity services com.seazn.capture | grep -c 'isForeground=true'`.
  - Expected: `1` or more, while paired.
- [ ] **Step 6 (owner): Row 2b, lock the phone.** Press the power button, so the phone locks. Leave it sideways on the tripod for **5 minutes or more**. Write down the lock time.
  - Then the agent runs `adb shell dumpsys power | grep -E 'mWakefulness='`. Expected: `mWakefulness=Asleep` or `Dozing`, never `Awake`.
  - Then the agent screenshots `r2b-locked-raw` without cropping. Expected: black. Delete it afterwards. It is the lock's witness, not evidence to keep.
  - If the `mWakefulness` field is absent on this build, the owner's word and the black capture stand, and the results say so.
- [ ] **Step 7 (owner): Read the console after 5 minutes.**
  - Expected: the Phone node shows the phone present, with its last beat within one poll.
  - If it shows `phone_not_responding`, write that down: it is a valid verdict for this step, not an error in the run.
- [ ] **Step 8 (owner): Press Go live in the console, with the phone still locked.**
  - **Verdict A:** beats continued under the foreground service. The console accepts, and the phone publishes while locked. Confirm with `curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" "$URL"` (the URL is from Task 1 Step 5, if it is the same fixture; otherwise read it from this run's record afterwards). Expected: `200` within 30 s.
  - **Verdict B:** beats stopped. The console shows "The camera phone isn't responding. Open Seazn Capture on the phone and keep it unlocked, then go live." (`409 phone_not_responding`).
  - Write down which verdict happened. **It is the fallback's verdict.**
- [ ] **Step 9 (owner): Unlock and read the screen.** Unlock the phone.
  - Expected under verdict A: the viewfinder shows LIVE, and the picture is upright. (Agent) Screenshot `r2b-live`.
  - Under verdict B: the owner presses Go live in the console again with the phone unlocked. Expected: LIVE within one poll, and the console's error clears.
- [ ] **Step 10 (agent): The §5.3 facts, from the record** (`$EVID/r2b-record.ndjson`).
  - Expected under verdict A, with each line's `at` between the lock time and the unlock time:
    - a `readiness` line with `camera` true, `sound` true and `held` true (the camera, the mic and readiness, on a locked phone);
    - `broadcast-start` with `cause` `organiser`;
    - `connected` and `live`.
  - Quote these lines in the results. They re-establish the claims plan C's missing results never filed (§3.7). They are **device-only**.
- [ ] **Step 11 (owner): Stop from the console while the phone is locked.** Lock the phone again and press **Stop** in the console.
  - Expected: after you unlock, "Organiser stopped it — waiting for Go live" (`stream.status.stoppedOrganiser`). The record holds `broadcast-ended` with `lastEnd` `stopped-by-organiser`, timed while it was locked.
  - Expected (D2, the idle dim): the screen is at **full brightness** when you unlock, not dim, because nothing counts toward the dim in the background. If you then leave it untouched, it dims about 30 s later. A dim screen on unlock is a finding (**device-only**).
- [ ] **Step 12 (agent and owner): Row 2c, the negative check.**
  - Tell the owner first: "I am about to force-stop the app; this is deliberate."
  - Then run `adb shell am force-stop com.seazn.capture` and write down the time.
  - Wait **120 s**. That is past max(60 s, poll + 30 s) for any poll up to 90 s. The owner then presses Go live in the console.
  - Expected: the console shows "The camera phone isn't responding. Open Seazn Capture on the phone and keep it unlocked, then go live." It is **not** `phone_not_paired`, because the pairing is still held.
- [ ] **Step 13 (owner): Reopen, and the error clears.**
  - Open the app from the launcher. If Home shows a Continue card, tap it.
  - Expected:
    - The app re-pairs without a scan. The record holds a `heartbeat` line with `claim` `resume`.
    - Within one poll, the console's red error clears, and the phone reads present.
    - No Go live is needed, which saves a credit.
  - (Agent) Screenshot `r2c-repaired`.
- [ ] **Step 14 (owner): Delete the recordings** for rows 2a and 2b (the recording recipe).

**Pass and fail:**

- **2a passes** when the dimmed phone never triggered `phone_not_responding`, went live within one poll, and stopped on the next beat.
- **2b passes** under either verdict, as long as it is written down with its evidence. **Verdict A** proves the Android fallback, R4. **Verdict B** is a finding for the owner: the fallback does not hold on this handset, and keep-awake is the only path.
- **2c passes** when the console showed `phone_not_responding` and cleared after the reopen.

---

### Task 3: The start gates (row 3)

**Row:** 3. The server checks, in order: holder, already_live, destination, entitlement (403), credit (402). Arrange **one** failing state at a time, with every earlier gate passing.

- [ ] **Step 1 (owner): no_destination.**
  - In staging, clear the fixture's destination. Pair in operator mode.
  - Expected before Go live: "Waiting for the organiser to pick a destination" (`stream.status.waitingDestination`). (Agent) Screenshot `r3-nodest-waiting`.
  - Hold **Go live** for 3 s. Expected: "Ask the organiser to pick where to stream" (`stream.status.refusedDestination`). (Agent) Screenshot `r3-nodest`.
  - If Go live cannot be held with no destination, write down what the control showed. The waiting line then stands as the row's evidence, and the refusal is read from the console's Go live instead.
  - Restore the destination.
- [ ] **Step 2 (owner): not_entitled.** Turn the org's streaming entitlement off in staging. Hold Go live.
  - Expected: "Streaming isn't included for this club" (`stream.status.refusedEntitlement`). (Agent) Screenshot `r3-entitlement`. Restore the entitlement.
- [ ] **Step 3 (owner): no_credit.** Set the org's credit to zero in staging. The W23 free restart is waived. Hold Go live.
  - Expected: "No streaming credit — ask the organiser" (`stream.status.refusedCredit`). (Agent) Screenshot `r3-credit`.
  - Restore the credit, to at least what Task 0 Step 5 set.
- [ ] **Step 4 (agent): A start after the result, inside the grace, is admitted.** This check is run once, in Task 1 Step 9 (row 1c (ii)): a hand Go live on M1 after its result, inside the 120-minute grace, is admitted and not auto-stopped. Copy that step's evidence (`r1c2-live` and its record lines) into row 3's section of the results.
  - Start never sends `match_finished` (spec §3.4), so row 3 has no `match_finished` check.
- [ ] **Step 5 (agent): Read the record** (`$EVID/r3-record.ndjson`).
  - Expected: three `start-refused` lines, with `refusal` `no_destination`, `not_entitled` and `no_credit`, in that order. There is no `connected` line between them.
- [ ] **Step 6 (agent): Check the copy fits.** Open each screenshot and confirm that each line is whole, or cut with an ellipsis if it is wider than the strip (the one-line rule), and never wrapped.

**Pass:** each gate shows its own line, and the start after the result inside the grace was admitted (Task 1 Step 9). Nothing goes on air, so no recording needs deleting. The agent confirms this by listing the input's videos: none were created during Task 3.

---

### Task 4: Two phones on one code and slot, and the takeover (rows 4, 5 and 6)

**Rows:** 4 (A9), 5 (A14), 6 (A17). These need the second Android 12+ phone with the same APK installed (Task 0 Step 3). Phone A is the OnePlus `12be753e`, and phone B is the second phone.

- [ ] **Step 1 (owner): Row 4, a slot that is not live.**
  - Phone A scans the code C in operator mode and is paired.
  - Phone B scans the same code C.
  - Expected on phone A, within one poll: Home, with the panel "Paired on another phone" (`panel.replaced.title`) and "This code is now paired on another phone. Scan it again to use this one." (`panel.replaced.body`).
  - Phone B is paired. (Agent) Screenshots `r4-a-replaced` (`adb -s 12be753e`) and `r4-b-paired`.
- [ ] **Step 2 (owner): Row 4, a live slot.**
  - Press Go live in the console, so phone B goes live.
  - Phone A scans C again.
  - Expected on phone A: "Already live" (`panel.taken.title`) and "This camera is live on another phone." (`panel.taken.body`). (Agent) Screenshot `r4-a-taken`.
  - In phone A's record: `heartbeat` lines with `word` `Replaced` (Step 1) and `Taken` (Step 2).
- [ ] **Step 3 (agent): Row 5, A14, kill the live phone's network.**
  - Phone B is live. Run `adb -s <B> shell svc wifi disable` and `adb -s <B> shell svc data disable`, and write down the time.
  - The server needs three things: 60 s with no beat, a fresh Cloudflare read that shows the input not connected, and no connected sample for 60 s.
- [ ] **Step 4 (owner): Retry phone A's scan.** From 60 s after the cut, phone A scans C every 30 s until it no longer reads "Already live".
  - Expected: the scan pairs, and within one poll phone A goes live with no Go live pressed. That is the takeover.
  - Write down the time from the cut to the takeover. (Agent) Screenshot `r5-a-live`.
- [ ] **Step 5 (agent): The same sid.** Read phone A's record (`$EVID/r5-a-record.ndjson`) and phone B's (`$EVID/r4-b-record.ndjson`, shared once B is back on the network in Step 7).
  - Expected: phone A's `broadcast-start` `sid` equals phone B's earlier `broadcast-start` `sid`. "The takeover keeps the same sid." The sid is a plain word, so the results quote it.
- [ ] **Step 6 (owner): Row 6, A17, a late stop after the takeover.**
  - Phone A is now live on the taken-over sid (Step 4). Start the laptop's manifest log on phone A's broadcast with `run_in_background`, with `URL` read from phone A's shared record (`grep -o '"playbackUrl":"[^"]*"' "$EVID/r5-a-record.ndjson"`):

```bash
while true; do printf '%s %s\n' "$(date -u +%H:%M:%S)" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" "$URL")"; sleep 2; done > "$EVID/r6-manifest.txt"
```

- Phone B is still offline. On phone B, hold **Stop** for 3 s. This ends phone B's broadcast and unpairs it (A3). Phone B writes a stopped record holding the sid (A17), which rides the next paired beat of the same code and slot.
- Then the agent runs `adb -s <B> shell svc wifi enable` and `adb -s <B> shell svc data enable`.
- The owner scans C on phone B again, so its next paired beat carries the late stop.
- [ ] **Step 7 (agent): Row 6, read what happened.**
  - Phone B's late beat:
    - Expected per the web peer: it hears `replaced`.
    - If that beat carries `claim` `new` while phone A is alive, it hears `taken` instead.
    - Either way, phone B's record holds a `heartbeat` line with that `claim` and `word` (`Replaced` or `Taken`), then `stopped-delivered` with its `status`. A refused claim still counts as delivered (G0-g).
    - Phone B shows Home's panel: "Paired on another phone" (`panel.replaced.title`) or "Already live" (`panel.taken.title`).
    - (Agent) Screenshot `r6-b-panel`.
  - Phone A's broadcast is uninterrupted:
    - phone A's tally stays LIVE (screenshot `r6-a-live`, `adb -s 12be753e`);
    - phone A's record has no `broadcast-ended` and no `heartbeat` with `word` `Over` from Step 6 on;
    - `$EVID/r6-manifest.txt` shows `200` throughout.
  - Send `mobile-s1-web` the sid, and ask it to confirm that the server recorded `stop_ignored {held:true}` for it, and closed no session.
  - The web calls this the first deterministic proof of the live·dead T4 case.
- [ ] **Step 8 (owner): End and clean up.** Stop the `r6-manifest.txt` loop. Stop phone A from the console if it is still live. Delete the recordings for rows 4 to 6 (the recording recipe).

**Pass and fail:**

- **Row 4 passes** on `replaced` then `taken`.
- **Row 5 passes** when the takeover kept the same sid.
- **Row 6 passes** when phone B's late beat heard `replaced` (or `taken` with `claim` `new`), the server recorded `stop_ignored {held:true}`, and phone A's broadcast was never interrupted.
- If phone A lost its broadcast, that is a finding for `mobile-s1-web` and for the owner.
- **Blocked** if there is no second phone.

---

### Task 5: The hold window, and S3 (row 7)

**Row:** 7 (A10). The web's §12 S3 (the SRT hold) is measured in the same run. The phone is on Wi-Fi with mobile data off.

- [ ] **Step 1 (owner): Go live.** Pair in operator mode and Go live from the console.
  - (Agent) Read `URL` (the `playbackUrl`) from a shared record, as in Task 1 Step 5.
  - Start the laptop's manifest log with `run_in_background`:

```bash
while true; do printf '%s %s\n' "$(date -u +%H:%M:%S)" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" "$URL")"; sleep 2; done > "$EVID/r7-manifest.txt"
```

- [ ] **Step 2 (agent): A cut under 183 s.** Run `adb shell svc wifi disable` and write down the time. After **60 s**, run `adb shell svc wifi enable`.
  - Expected during the cut: "Uplink lost — holding, {remaining} s of 183" (`stream.status.holding`, with the descriptor's `holdWindowSeconds`, 183). (Agent) Screenshot `r7-holding`.
  - Expected after the cut: back to "Live. Sound and picture going out." (`stream.status.live`).
- [ ] **Step 3 (agent): Read the record** (`$EVID/r7a-record.ndjson`).
  - Expected: `connected` and `live` again after the restore, and a `heartbeat` with `word` `Open` and the **same** sid. The rejoin answers `live`.
  - There is no `broadcast-ended` and no `hold-expired`.
- [ ] **Step 4 (agent): A cut over 183 s.** Run `adb shell svc wifi disable` again, and write down the time. Wait **220 s**, then run `adb shell svc wifi enable`.
  - Expected:
    - "Connection lost too long — stream stopped" (`stream.status.stoppedHoldWindow`).
    - In the record: `hold-expired`, and `broadcast-ended` with `lastEnd` `hold-window-expired`.
    - After the restore, the beat answers `Over` for the old sid.
  - (Agent) Screenshot `r7-stopped`.
- [ ] **Step 5 (agent): S3, the SRT hold.** Stop the manifest log. In `$EVID/r7-manifest.txt`, find the first non-`200` after the Step 4 cut (P5 saw the master go to `204` when the variant goes). The hold is that time minus the cut time.
  - Confirm with the record that the transport was SRT: `connected` with `transport` `srt`.
  - Expected: about 183 s. Send the number to `mobile-s1-web` as S3. A difference beyond the slack changes the web's constant before production. That is the web's call, not this row's pass.
- [ ] **Step 6 (owner): Count, then delete the recordings.** List the input's videos. Expected: the under-183 s cut left **one** recording across it, and the over-183 s cut started a new one or ended it. Write down the count and durations, then delete them.

**Pass:** under 183 s, the phone rejoins and the same sid is live. Over 183 s, it is over. The S3 number is sent.

---

### Task 6: The beat cadence (row 8)

**Row:** 8. Expected: 10 s in play, or within 30 minutes of the scheduled start; 5 s while starting; 60 s otherwise.

**The evidence** is D1's beat-send lines in the phone's record (spec §3.4): one line per beat **sent**, with its send time, the interval since the last send, and the answer word. Their kind is `BEAT_KIND` in `$EVID/build.txt` (Task 0 Step 1).

The web's `fixture_stream_phone_beats` keeps at most one row per 60 s, plus the state changes, and purges them at 24 h. It only **corroborates** the 60 s waiting cadence and the state changes, and is asked for within 24 h. It cannot show a 10 s or 5 s cadence. The `heartbeat` line is not the evidence, because while paired it is written only when the answer changes.

- [ ] **Step 1 (agent): Learn the line's fields.** Set `BEAT_KIND` in the shell from `$EVID/build.txt`. Then, on any record shared so far, run `grep "\"kind\":\"$BEAT_KIND\"" "$EVID/r1-record.ndjson" | head -3`.
  - Write down the name of the interval field as `IFIELD`.
  - If D1 took §3.4's fallback (one line per change of interval, plus a count per minute), write down both kinds. Then read the cadence as the interval named on each change line, cross-checked by the per-minute count: 10 s gives 6 a minute, 5 s gives 12, and 60 s gives 1.
- [ ] **Step 2 (owner): A wait more than 30 minutes out.** Pair the phone in operator mode to a fixture scheduled more than 45 minutes away. Leave it alone for 6 minutes. Write down the start and end times, the fixture and the slot. Then share the record (`$EVID/r8a-record.ndjson`).
- [ ] **Step 3 (owner): A wait within 30 minutes.** Pair to a fixture inside its 30-minute window, or wait until the Step 2 fixture enters its window. Wait 3 minutes, write down the times, and share the record (`$EVID/r8b-record.ndjson`).
- [ ] **Step 4 (agent): Tabulate the intervals.** Run this over `$EVID/r8a-record.ndjson`, `$EVID/r8b-record.ndjson`, `$EVID/r1-record.ndjson` (in play, starting and live) and `$EVID/r2a-record.ndjson` (starting after a console Go live):

```bash
grep "\"kind\":\"$BEAT_KIND\"" "$EVID/r8a-record.ndjson" | node -e 'const f=process.argv[1];let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const l of s.trim().split("\n")){const o=JSON.parse(l);console.log(o.at,o[f],o.word??"")}})' "$IFIELD"
```

- Expected:
  - waiting more than 30 minutes out (`r8a`): 60 s;
  - waiting within 30 minutes (`r8b`): 10 s;
  - in play (`r1`, before the go-live): 10 s;
  - starting (`r1` and `r2a`, between `broadcast-start` and `live`): 5 s;
  - live (`r1`): 10 s at most (`BeatCadence.HELD_MAX_MS`).
  - Each within ±2 s. Any interval outside that is quoted with its `at`.
- [ ] **Step 5 (agent): The web corroborates, within 24 h.** Ask `mobile-s1-web` for the `fixture_stream_phone_beats` rows of Step 2's pairing and of row 1's pairing. Name the fixture, the slot and the time window. Never send the code's raw value; if the web needs it, the owner gives it in person.
  - Expected: Step 2's window shows about one row per 60 s, and row 1's window shows the state changes (waiting, then starting, live and over) at the times the record shows them.
  - The rows are purged at 24 h, so ask the same day.

**Pass:** each of the four cadences matches. A cadence that cannot be read is listed as **unread**, with the reason. It is never counted as a pass.

---

### Task 7: The forced-RTMPS session id (row 9)

**Row:** 9. The web asked for a **forced-RTMPS session id**, which it checks server-side. This is **not** a web §12 step, and it is tracked under that name. The nearest web steps are S1's flag-false variant and S2's RTMPS leg. The web's §12 S10 is the exit bar (Task 9).

- [ ] **Step 1 (owner): Block UDP.** On the router's admin page, add a rule that drops outbound UDP from the OnePlus, either all UDP or UDP to port 778. Mobile data stays off. Write down the rule in words in `$EVID/r9-method.txt`.
- [ ] **Step 2 (owner): Go live.** Pair in operator mode, then Go live from the console.
  - Expected:
    - "Opening the link." (`stream.status.connecting`) for roughly 19 s. P5 measured 18.8 s to fall back.
    - Then "Switched to backup link (RTMPS)" (`stream.status.fellBack`), then LIVE.
  - (Agent) Screenshot `r9-fellback`.
  - Open Diagnostics, and screenshot `r9-diag`. Expected: "Transport" (`diag.transport`) reads RTMPS.
- [ ] **Step 3 (agent): Read the record** (`$EVID/r9-record.ndjson`).
  - Expected: `connect-failed` lines while on SRT, then `fell-back` from `srt` to `rtmps`, then `connected` and `live` with `transport` `rtmps`.
  - Take the `broadcast-start` `sid`.
- [ ] **Step 4 (agent): Send the sid.** Send it to `mobile-s1-web` as "the forced-RTMPS session id (capture row 9), for the server-side check". Do not label it S10.
- [ ] **Step 5 (owner): Clean up.** Stop from the console, remove the router rule, and delete the recordings.

**Pass:** the phone fell back to RTMPS by itself and published, and the sid was sent.

---

### Task 8: The round line on real data (row 10, and spec §5.2)

**Row:** 10. **Caution (spec §5.2):** one swiss R2 match in s-a-f-e is already `in_play`. Paired in automatic mode with the switch on, it auto-starts and spends a credit. **Pair only scheduled matches.**

- [ ] **Step 1 (owner): Operator mode first.** On any pairing, open Settings and turn "Start and stop automatically" off.
  - Then go back to Home and, on Home, tap _Forget_ on the Continue card (`home.continue.forget`), so no pairing is held. Going Home alone keeps it; the switch stays off, since the settings are not the pairing's.
  - (Agent) Screenshot the Settings switch reading off, before Home: `r10-operator`.
  - The owner also turns the automatic switch off in the s-a-f-e console, if they can.
- [ ] **Step 2 (owner): Pair each fixture and read its line.** For each row below, scan the fixture's code from the Live Stream tile and hold the phone sideways. (Agent) Screenshot `r10-<n>`. Then go back to Home and tap _Forget_ on the Continue card before the next one; going Home alone keeps the pairing.

| n   | Org               | Division and match                                                  | Expected round line (it is drawn in caps, so compare without case) |
| --- | ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | TestDevicePad     | the SF fixture                                                      | "TestDevicePad · SF"                                               |
| 2   | my-organization-4 | Tile Open Renamed, pool A, round 1                                  | "Tile Open Renamed · Group A · Round 1"                            |
| 3   | s-a-f-e           | Girls Under-14 Championship, knockout R1                            | "Girls Under-14 Championship · SF"                                 |
| 4   | s-a-f-e           | Girls Under-14 Championship, the R2 final                           | "Girls Under-14 Championship · Final"                              |
| 5   | s-a-f-e           | Girls Under-14 Championship, a league round N                       | "Girls Under-14 Championship · Round N"                            |
| 6   | s-a-f-e           | Mixed Doubles Under-17 Intermediate Level, knockout R1              | "QF"                                                               |
| 7   | s-a-f-e           | Mixed Doubles Under-17 Intermediate Level, R2                       | "SF"                                                               |
| 8   | s-a-f-e           | Mixed Doubles Under-17 Intermediate Level, the R3 final             | "Final"                                                            |
| 9   | s-a-f-e           | Mixed Doubles Under-17 Intermediate Level, a **scheduled** swiss R2 | "Round 2"                                                          |
| 10  | s-a-f-e           | Mixed Doubles Under-17 Intermediate Level, swiss R3                 | "Round 3"                                                          |

- Expected: each round line reads as listed, above the match label. The expected strings come from the web's rule, not from a device.
- [ ] **Step 3 (agent): Read the record** (`$EVID/r10-record.ndjson`). Expected: no `broadcast-start` line anywhere in it.
- [ ] **Step 4 (agent): Send the differences.** Send any label that differs from the table to `mobile-s1-web`, with its row number and what the screen showed.

**Pass:** all 10 match the table. A difference is a finding, recorded and sent, not something to fix here. Nothing goes on air, so nothing needs deleting.

---

### Task 9: The exit bar (row 11, web S10), S11 and S2b

**Row:** 11 is the exit bar (live-stream spec S:269-283), without the overlay (R1). It is the web's §12 **S10**: "a real phone on staging pairs, starts from the console **and** from the phone, streams a real match to YouTube, stops from each end, and takes over a dead phone (A14). Recorded with the device model". The evidence for S10 is this task, plus Task 2 (the console's start and stop) and Task 4 (the A14 takeover). S11 is `phone_lost` at 15 minutes. S2b is moot under W26.

- [ ] **Step 1 (owner): Start from the phone.**
  - Pair the row 1 fixture in operator mode. Its destination is YouTube.
  - Hold **Go live** for 3 s.
  - Expected: "Opening the link." (`stream.status.connecting`), then LIVE. The owner confirms that the YouTube test channel plays it. (Agent) Screenshot `r11-live`.
  - The agent reads this broadcast's `playbackUrl` into `URL` from a shared record (`grep -o '"playbackUrl":"[^"]*"' "$EVID/r11-record-live.ndjson"`). Then start the manifest log with `run_in_background`:

```bash
while true; do printf '%s %s\n' "$(date -u +%H:%M:%S)" "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" "$URL")"; sleep 2; done > "$EVID/r11-manifest.txt"
```

- [ ] **Step 2 (agent): Pull the uplink.** Run `adb shell svc wifi disable` for 30 s, then `adb shell svc wifi enable`.
  - Expected: "Uplink lost — holding, {remaining} s of 183" (`stream.status.holding`), then LIVE again.
- [ ] **Step 3 (owner): Block UDP.** Add the router rule from Task 7. Then the agent cuts Wi-Fi for 10 s (`svc wifi disable`, then `enable`), so the reconnect has to find a new path.
  - Expected: "Switched to backup link (RTMPS)" (`stream.status.fellBack`) and LIVE.
  - Remove the rule afterwards.
- [ ] **Step 4 (owner): Lock the phone for 5 minutes or more.** Press the power button. Check that it is locked, as in Task 2 Step 6.
  - Expected: the manifest log shows `200` throughout, and the console's Phone node shows beats.
- [ ] **Step 5 (owner): Open another camera app.** Unlock, open the phone's own camera app for 20 s, then close it.
  - Expected:
    - "Camera taken by another app — slate on air" (`stream.status.cameraTaken`) while it is open.
    - Then "Camera reopening — picture back shortly" (`stream.status.cameraReopening`), then LIVE.
  - (Agent) Screenshot `r11-taken`.
- [ ] **Step 6 (owner): Take a call.** From the other phone, call the OnePlus, answer it, talk for 20 s, and hang up.
  - Expected: "Mic silenced by a call" (`stream.status.micSilenced`) during the call, then LIVE. (Agent) Screenshot `r11-call`, with the call screen cropped out or excluded.
- [ ] **Step 7 (owner): Stop from the console.**
  - Expected: "Organiser stopped it — waiting for Go live" (`stream.status.stoppedOrganiser`).
  - The console's Phone node showed beats throughout Steps 1 to 7. The owner states that, with a console screenshot cropped to the Phone node if possible.
- [ ] **Step 8 (owner): Web S10's other half, stopping from the phone.**
  - Go live from the console, then hold **Stop** on the phone for 3 s.
  - Expected: "You stopped the broadcast." (`stream.status.endedOperator`). The phone is unpaired (A3).
- [ ] **Step 9 (agent): Read the record** (`$EVID/r11-record.ndjson`).
  - Expected, in order:
    - `broadcast-start` with `cause` `operator`;
    - the holding and reconnect lines, then `fell-back`;
    - `camera-taken`, then `camera-reopened`;
    - `mic-silenced`;
    - `broadcast-ended` with `lastEnd` `stopped-by-organiser`;
    - the second broadcast's `broadcast-start` with `cause` `organiser`, and its end.
  - Write down the device model in the results (`adb shell getprop ro.product.model`).
- [ ] **Step 10 (owner): S11, run 1 (W19), with the phone gone.**
  - Go live from the console, with the console's panel open.
  - Tell the owner first, then run `adb shell am force-stop com.seazn.capture`. That stops both the beats and the video. Write down the time.
  - Leave the console open for 16 minutes.
  - Expected: the session ends `phone_lost` at 15 minutes (± one poll). The console shows it.
  - Then reopen the app. Expected: the re-pair hears `Over`, and the phone shows "Stream ended — this phone was offline" (`stream.status.stoppedPhoneLost`). (Agent) Screenshot `r11-phonelost`.
- [ ] **Step 11 (owner): S11, run 2, beats stopped while video still flows.** The phone cannot stop its own beats while it keeps publishing. The way to do it is a router rule that drops traffic to the staging web host only, while Cloudflare ingest keeps flowing.
  - If the router can block one host by name or by address, block `stg.seazn.club`, go live, and wait 16 minutes.
  - Expected: the session stays live past 15 minutes.
  - If the router cannot block one host, S11 run 2 is **not run from the phone**. It goes to `mobile-s1-web`, which can drive it with its own tooling. The results say which happened.
- [ ] **Step 12 (agent): S2b, moot.** S2b (SRT on `srt://live.stg.seazn.club:778`) is moot under W26: the custom ingest host is ruled out, and the phone pins `live.cloudflare.com` (`Hosts.kt`). Record "not run: moot under W26". Nothing is run.
- [ ] **Step 13 (owner): Send and clean up.**
  - Send `mobile-s1-web` the S10 evidence: the device model; the console start and stop (Task 2); the phone start (Step 1) and phone stop (Step 8); YouTube playing; and the A14 takeover (Task 4). Send S11's results as well.
  - Stop the `r11-manifest.txt` background loop (TaskStop), and keep the file as row 11's lock evidence.
  - Delete every recording from this task.

**Pass:** each exit-bar event shows its line and returns to LIVE, the Phone node showed beats throughout, and the record reads back. S11 run 1 ends with `phone_lost` at about 15 minutes.

---

### Task 10: Part 2 on the device (row 12)

**Row:** 12: the viewers' video, C2, and the idle dim. Everything in this task that jsdom cannot see is **device-only** (spec §6).

**What viewers see is hidden in this build** (the owner's ruling, 2026-10-09: "keep all code and just hide button then when later stage like when org reqeust we can implemnt"). `FEATURES.viewerCheck` in `src/ui/features.ts` is `false`, so there is no cell to tap and no cover. Steps 2, 3, 4, 5, 5a, 5c and 5d, and the cover half of Step 5b, are **deferred until the switch is on**: the results mark them _deferred (view hidden)_, never passed or failed, and they run as written in the first staging run of a build with the switch on. Step 1 checks the hidden row instead.

- [ ] **Step 1 (owner): Pair in operator mode.** Pair a scheduled TestDevicePad match, with a doubles fixture from §5.2 if one is scheduled, so C2's wrapping is read. Confirm the automatic switch reads off.
  - Paired, before the Go live: the camera box shows the camera's picture and nothing drawn over it. There is no score layer (D2 §4.1, R1). (Agent) Screenshot `r12-paired`.
  - Go live from the console. Live, before any tap: the same, no score layer over the camera. (Agent) Screenshot `r12-live`.
  - Live: the icon row is Settings, Take photo and Remote scoring, three buttons packed from the start of the row, with no What viewers see cell and no reason line under the row (AGENTS §6: the view is hidden by the owner's ruling, 2026-10-09; the packed three-button row is the controller's). Every control of the controls half is on screen. Read it from `r12-live`.
- [ ] **Step 2 (owner): The viewers' video, the picture path.** _Deferred until the switch is on._ Tap **What viewers see** once (a tap, not a hold).
  - Expected:
    - A 5 s countdown, with the loading string from `$EVID/keys.txt`.
    - Then a picture, with the honest label ("What viewers see · no scoreboard yet", or the key D2 chose).
    - A 20 s countdown that starts at the first frame.
    - Then it closes by itself.
  - (Agent) Screenshots `r12-loading`, `r12-showing` and `r12-closed`. Time it with a stopwatch: from the first frame to closing is 20 s (±1 s).
- [ ] **Step 3 (owner): A second tap closes it.** _Deferred until the switch is on._ Tap to open, wait for the picture, then tap the peek cell again.
  - Expected: it closes at once. A tap never restarts the 20 s.
- [ ] **Step 4 (owner): The not-ready path.** _Deferred until the switch is on._
  - Tap **What viewers see** in the first 10 s after a fresh Go live, when Cloudflare is not likely to have a segment yet. Repeat with new Go lives until a not-ready happens, up to 3 tries.
  - Expected: after the 5 s countdown with no frame, the not-ready line from `$EVID/keys.txt` shows for 3 s, then it closes.
  - (Agent) Screenshot `r12-notready`.
  - Also write down, for **every** tap in Steps 2 to 4, whether a picture arrived inside 5 s. This is spec §8's risk. If most taps get no picture, the countdown length goes back to the owner with the numbers.
- [ ] **Step 5 (owner): One cover at a time.** _Deferred until the switch is on._ Open the viewers' video, then tap **Remote scoring** (`stream.scoring.open`).
  - Expected: the video closes, and the panel "Score this match" (`stream.scoring.title`) opens.
  - Then open the video again. Expected: the panel closes. (Agent) Screenshot `r12-onecover`.
- [ ] **Step 5a (owner): The cover up close.** _Deferred until the switch is on._ Open the video at 804 × 332 and look at it at arm's length.
  - Expected:
    - It covers the camera box only. The status strip and Stop stay visible, and Stop still works.
    - The honest line "What viewers see · no scoreboard yet" (`stream.peek.honest`) reads over the picture.
    - The countdown and **Hide** sit in the box's bottom-right corner, on the night ground, in steady figures. Hide is a rounded plate with a thin rule, and it reads over the video. Nothing in the corner is clipped.
    - The cell answers a plain tap with no press delay. A tap anywhere on the box closes the view, and so does Hide. A Hide tap that also reached the box would close it twice, which is closing once, so nothing more is checked there.
  - (Agent) Screenshot `r12-cover-804`, and read the colours from it: night ground behind the lines, ink text, and no red.
- [ ] **Step 5b (owner): TalkBack on the cover and the label.** The cover half is _deferred until the switch is on_; the label half runs now. Turn TalkBack on (Accessibility settings), open the video, and swipe through the cover (switch on only). Then swipe to the match label.
  - Expected:
    - TalkBack reads the cover's lines (the countdown, the honest line) and Hide as a button named "Hide".
    - It reads the match label once, as typed, and never says the v on its own.
  - If TalkBack reads the whole box as one element (a double tap on it closes the view), write that down. The follow-up is `focusable={false}` on the box, which is the coordinator's to route. Nothing is changed in this run.
  - Turn TalkBack off.
- [ ] **Step 5c (agent): The player goes with the view.** _Deferred until the switch is on._ With the view hidden, the record of this task holds no `viewer.*` or `peek.*` line at all; write down any that it does, as a finding. After Steps 2 to 5, read the record with Share record.
  - Expected:
    - For each tap, `viewer.check` lines in order: `loading`, then `showing` or `notReady`, then `idle`.
    - One `viewer.firstFrame` line with its `ms` for each tap that got a picture. Write the `ms` values beside Step 4's notes: they are spec §8's HLS numbers.
    - After each `idle`, no player is left. (Owner) As a cross-check, read the app's data usage in Android Settings before a tap and 60 s after its close: what it received stops climbing (the upload goes on, because the phone is on air).
- [ ] **Step 5d (owner): A stall, if one happens.** _Deferred until the switch is on._ If a picture stalls while showing, or the 5 s countdown runs on a stalled feed, write down what the cover did.
  - Expected (the controller's ruling, B3):
    - A player retry while showing is silent: the 20 s countdown keeps running and closes the view.
    - If native reads the delivery as stalled while showing, the cover says "No viewer picture" (`stream.peek.unavailable`) until it closes.
    - While loading, a stalled feed shows only the 5 s countdown, then the not-ready line.
  - None of these is a failure. A new line for any of them is the owner's call after this run.
- [ ] **Step 6 (agent): C2 at the owner's 804 × 332.** Screenshot `r12-c2-804-en`.
  - Expected:
    - The round line is in lime caps.
    - There is one row per side: a lime bar on the first, a lilac bar on the second, and names in mixed case.
    - A small grey "v" sits in the left margin, between the rows.
    - The one message line is below.
    - Each side wraps to at most 2 lines and ends in an ellipsis beyond that.
  - Write down which doubles names wrapped.
- [ ] **Step 6a (agent): C2 up close,** from `r12-c2-804-en` and a second screenshot, `r12-c2-804-long`, of the longest doubles label staging has.
  - Expected:
    - The picture matches the arithmetic: 394.7 × 222 for a label of one line a side, and 316.4 × 178 for two lines a side. Read the camera box from the screenshot in px, over the density.
    - A long side wraps inside its own row, beside its bar. It never runs under the controls half or past the strip, and a cut second line ends in an ellipsis.
    - Each bar runs the height of its row. The v sits in the margin, centred between the rows, never inside a row.
    - The names are in mixed case, as typed. The round line is in capitals.
  - These are the real staging names (PD5). This step is the only place they are read.
- [ ] **Step 7 (owner): The longest locale.** On Home, pick French in the language picker, go back to Live Stream, and screenshot `r12-c2-804-fr`.
  - Expected: as in Step 6, with the French strings from `fr.json`, and nothing clipped. Then switch back to English.
- [ ] **Step 8 (agent): C2 at 640 × 360.**
  - Run `adb shell wm size 360x640` and `adb shell wm density 160`. The owner holds the phone sideways.
  - Screenshot `r12-c2-640-en`, then repeat in French as `r12-c2-640-fr`.
  - Expected: the same drawing at the smaller size. The controls half is fully on screen, and nothing overlaps.
- [ ] **Step 9 (agent): Reset the geometry.** Run `adb shell wm size reset` and `adb shell wm density reset`, then `adb shell wm size` and `adb shell wm density`.
  - Expected: only the physical values written in Task 0 Step 3, with no `Override` line.
- [ ] **Step 10 (owner): The idle dim.** Stop from the console, so the phone is paired and waiting. Do not touch the screen.
  - Expected: at about 30 s (stopwatch), the screen dims, but it does not go off.
  - Touch it once. Expected: full brightness at once, and the 30 s starts again.
  - If the dim does not happen, that is spec §8's `expo-brightness` risk. Write down the phone's power mode, and report it as a finding for the owner (the scrim fallback is the owner's call). Do not change any code.
- [ ] **Step 10a (owner and agent): The dim is the window's, never the system's.** Paired and waiting, before the dim and again while dimmed, the agent runs `adb shell settings get system screen_brightness`.
  - Expected: the same value both times. With adaptive brightness on, the value can drift with the light. Then the owner reads the brightness slider in quick settings instead, which does not drop.
  - Expected: the dim is about a tenth of full brightness (0.1), and the viewfinder can still be read up close.
- [ ] **Step 10b (owner): A touch anywhere wakes it, and still acts.** Let it dim, then tap the Settings icon once.
  - Expected: full brightness at once, and the same tap opened Settings.
  - Leave Settings untouched for 30 s. Expected: it dims there too. Touch it once. Expected: full brightness at once, because Settings is inside the route.
  - Back on the viewfinder, tilt the phone upright so the turn card shows, and let it dim. A tap on the turn card does **not** wake it: the card sits outside the route, as designed. Turn the phone sideways again and touch the screen. Expected: it wakes.
  - Expected: the viewfinder and Settings are laid out as before D2, full screen, with nothing shifted by the stream layout's new root view.
  - If "engine not responding" shows while the screen is dim, it stays dim until a touch, by the controller's ruling. Then it reads at full brightness. This is not induced, only written down if it happens.
- [ ] **Step 10c (owner): The background.** Let it dim, press the phone's Home button, wait 40 s, and come back to the app.
  - Expected: full brightness on return, and a dim again 30 s later if untouched. The system brightness is as it was.
- [ ] **Step 10d (owner): Live Stream opened while locked.** Paired in operator mode, go to the app's Home (the Continue card shows), then press the power button to lock the phone. Press **Go live** in the console. The record cannot be read on a locked phone, so watch the console: when it shows the broadcast live, or the manifest `curl` of Task 2 Step 8 returns `200`, press **Stop** in the console, wait one beat, and unlock.
  - Expected: the app is on Live Stream, because the remote Go live moved it there while locked. It is paired and waiting, at **full brightness**, and it dims 30 s after the unlock if untouched.
  - A dim screen on unlock is a finding: the dim's clock counted in the background, from Android's `AppState` at that mount (B5). This is **device-only**.
  - If the console refuses the Go live with "The camera phone isn't responding" (Task 2 Step 8's verdict B), this step cannot run. Write that down.
  - This is one broadcast (Task 0 Step 5 counts it).
- [ ] **Step 10e (owner): A console Go live on a dimmed phone.** Paired and waiting, with the phone sideways on its tripod and unlocked, let the screen dim. Then, without touching the phone, press **Go live** in the console.
  - Expected: full brightness at once, as the phone arms, before the picture is live. Then no dimming while armed or live, even after 60 s with no touch.
  - Write down what the screen showed from the console press to live: when the brightness came back (at arming or only at live), and what the status line read meanwhile. (Agent) Screenshot `r12-dim-golive` once it is live.
  - A screen still dim while armed is a finding for the owner. Do not change any code.
  - This is one broadcast (Task 0 Step 5 counts it).
- [ ] **Step 11 (owner): Clean up.** Stop, and delete the recordings from this task.

**Pass:** with What viewers see hidden, the on-air icon row is Settings, Take photo and Remote scoring, and the record holds no `viewer.*` or `peek.*` line. The viewers' video's own pass (R2 and R10: picture, 20 s, close; not-ready, 3 s, close; a second tap closes it; one cover at a time; a `viewer.check` line per state and a `viewer.firstFrame` per picture) is deferred until the switch is on. C2 draws as R3 at both sizes and in both languages, at the picture sizes the arithmetic gives. The camera box shows no score layer, paired or live. The dim fires at 30 s, on the window only, and a touch or a console Go live wakes it at once. A phone always comes back from the background or a lock bright. The geometry is reset. Steps 5b and 5d are written down whatever they show: they are evidence for the owner, not pass or fail.

---

### Task 11: The thermal rung (row 13)

**Row:** 13. This runs on a debug build, as the spec says. Run it last, because the debug build replaces the release build on the phone.

With What viewers see hidden (the owner's ruling, 2026-10-09; Task 10), step 1 sheds `viewer-feed` with nothing to close. This task proves the rung's caption and the record; the video closing and the cell's reason are **deferred until the switch is on**, and run then as D2 §4.2 says.

- [ ] **Step 1 (agent): Check the thermal override exists.** Run `adb shell cmd thermalservice help`.
  - Expected: the help lists `override-status`. This is Android's own thermal service command. This repo has not used it before, so it is checked here first.
  - If it is missing, row 13 is **blocked** on this handset, and the results say so.
- [ ] **Step 2 (agent): Install the debug build.** Run `cd "$WT" && pnpm expo run:android`. It builds the debug APK, installs it, and serves it from Metro. The worktree was prebuilt in Task 0.
  - Restore `package.json` from `$EVID/package.json.bak` if `git status --short` shows it changed.
  - Expected: the app opens on Home.
- [ ] **Step 3 (owner): Go live.** Pair in operator mode and go live from the console, so the plate reads LIVE. (With the switch on, also tap **What viewers see**, so the picture is showing.)
- [ ] **Step 4 (agent): Force thermal status 2.** Run `adb shell cmd thermalservice override-status 2` and write down the time.
  - Expected: within 10 s (the device sampler's period), the strip's one message line reads `stream.advisory.hotLive` from `$EVID/keys.txt`, "Phone hot · still live", beside the LIVE plate. It names no viewer check. The icon row is unchanged: Settings, Take photo, Remote scoring.
  - If the phone reaches status 2 before the Go live (armed or connecting), the line reads `stream.advisory.hot`, "Phone hot", with no "still live". This is not forced: record it if seen, and say so if not.
  - (Agent) Screenshot `r13-shed`.
  - Deferred until the switch is on: the video closes; the peek cell is disabled with "Phone hot" (`stream.peek.hot`); the caption reads the reworded `stream.advisory.shed`; a tap on the cell opens nothing.
- [ ] **Step 4a (agent): Statuses 3 and 4.** Run `adb shell cmd thermalservice override-status 3`, wait 10 s, and screenshot `r13-shed-3`. Then do the same with `4`, as `r13-shed-4`.
  - Expected at each: the same as at 2. The caption reads the same, "Phone hot · still live", because the ladder only goes down.
  - Nothing else on screen changes: no lower preview frame rate, and no change to the encode. Steps 2 and 3 are report-only (`_FINDINGS.md` N26), so there is nothing to observe.
- [ ] **Step 5 (agent): Read the record.** Debug builds allow `run-as`, so run `adb shell run-as com.seazn.capture tail -40 files/record/session-record.ndjson > "$EVID/r13-record.ndjson"`.
  - Expected: a `thermal` line with status 2, and a `shed` line with `shed` `viewer-feed`. After Step 4a, `thermal` lines with 3 and 4, and `shed` lines with `preview-framerate` and `encode`.
- [ ] **Step 5a (owner and agent): The Spanish caption at 640 × 360.** The thermal override stays at 4. The owner stops from the console, goes to Home, picks Spanish in the language picker, and goes back to Live Stream. The agent runs `adb shell wm size 360x640` and `adb shell wm density 160`, and the owner holds the phone sideways and goes live from the console.
  - Expected: the strip's caption reads `stream.advisory.hotLive` from `es.json`, "Móvil caliente · sigue en directo", in full and ending in "directo", with no ellipsis. It measures 179.4 of the 298 dp the line has at this size (`stripTextFit.test.ts`). The spec's caption, `stream.advisory.shed` ("Móvil caliente: sin vista del público, sigue en directo", 295.8 of 298 dp), is the one only the drawn text can settle: deferred until the switch is on.
  - (Agent) Screenshot `r13-shed-es-640`. Then run `adb shell wm size reset` and `adb shell wm density reset`.
  - A cut caption is a finding for the owner, with the screenshot. Do not change any code.
  - English goes back on Home after Step 7's stop.
- [ ] **Step 6 (agent): Reset.** Run `adb shell cmd thermalservice reset`. Expected: after 10 s, the caption goes and the line reads Live again (`stream.status.live`). With the switch on, the cell is enabled again too.
- [ ] **Step 7 (owner and agent): Clean up.** Stop from the console, and pick English again on Home. Delete the recordings. Put the release build back with `adb install -r "$WT/android/app/build/outputs/apk/release/app-release.apk"`, and stop Metro.

**Pass:** at thermal status 2, the caption reads "Phone hot · still live" (`stream.advisory.hotLive`) beside the LIVE plate. At 3 and 4 the same holds, and nothing else changes (N26). The video closing and the cell's reason are deferred until the switch is on. The record holds `shed` `viewer-feed`, then `preview-framerate` and `encode`. The Spanish caption is written down whatever it shows: evidence for the owner.

---

### Task 12: Close the run, and the results document

- [ ] **Step 1 (agent): Check the geometry, on every phone.** Run `adb shell wm size` and `adb shell wm density`.
  - Expected: the physical values only. If not, reset them and record that they had been left.
- [ ] **Step 2 (owner): The final recording sweep.** List the videos of **every** live input used in the run (the recording recipe).
  - Expected: no video created today remains. Any `409` is retried until the list is empty.
- [ ] **Step 3 (agent): Write the results document.** Name it `docs/specs/<run date>-s1-plan-d-results.md`, on a new docs branch from main (for example `docs/s1-plan-d-results`). Use the skeleton below.
  - Every claim names the handset, the build sha, and the screenshot file name or the record lines.
  - Every claim jsdom cannot see is marked **device-only**.
  - Screenshots stay in `$EVID`. They are cited by file name, never committed.
- [ ] **Step 4 (agent): Check the formatting.** Run `cd "$REPO" && pnpm prettier --write <results file> && pnpm prettier --check <results file>; echo "EXIT=$?"`. Expected: `EXIT=0`.
  - Commit it only on the owner's go, staging the file by path. The commit ends with the attribution lines.
- [ ] **Step 5 (agent): Remove the build worktree.** Do this only after the owner says the phone may keep the installed APK: `cd "$REPO" && git worktree remove "$WT"`.

**The results document's skeleton:**

```markdown
# S1 Plan D: staging results

Date: <run date>. Spec: docs/specs/2026-10-09-s1-plan-d-design.md §5. Plan: docs/superpowers/plans/2026-10-09-s1-plan-d3-staging-run.md.
Build: capture main <sha>, release APK sha256 <hash>, local Gradle (no EAS). Web: staging at <sha from mobile-s1-web> (expected e201fab8f).
Handsets: <model, Android version, serial> × 2; physical geometry <wm size / wm density>.

## Verdict

<one paragraph: which rows passed, which failed, which were blocked or unread, and why>

## Rulings in force

R1–R11 (spec §1), and the web basis as the peer reported it (not an owner ruling).

## Prerequisites

D1 and D2 on main (Task 0 Step 1); credit topped up; fixtures; second phone (yes/no); the answers from mobile-s1-web.

## Rows

### Row 1: automatic start and stop

### Row 1a: A12, organiser Stop

### Row 1b: A16, late pairing

### Row 1c: A15, manual restart

### Row 2a: console Go live and Stop, dimmed (R4 default)

### Row 2b: console Go live with the phone locked (fallback). Verdict: A or B

### Row 2c: a phone not responding (negative check)

### Row 3: start gates

### Row 4: A9

### Row 5: A14

### Row 6: A17

### Row 7: A10 hold window

### Row 8: beat cadence

### Row 9: the forced-RTMPS session id

### Row 10: round line on real data (with the §5.2 table, a Seen column added)

### Row 11: exit bar (web S10)

### Row 12: Part 2 on the device

### Row 13: thermal rung

Each row: Expected (from the plan), What the screen showed, Record lines (quoted), Screenshots (file names), Pass / Fail / Blocked, Device-only claims.

## Carries

### Carry 20: hint 0.1 and Cloudflare's listed window

### Carry 26: the 20 s per 60 s lag rule

## Owed to the web (mobile-s1-web)

| Step | What was sent | When | Result |
| S3 | the SRT hold, in s | | |
| S10 (web §12, the exit bar) | rows 11, 2 and 5: the device model, starts and stops from each end, the A14 takeover | | |
| Forced-RTMPS session id (not a §12 step; nearest: S1 flag-false, S2 RTMPS leg) | the sid from row 9 | | |
| S11 | run 1, and run 2 or the reason it was handed over | | |
| S2b | not run: moot under W26 | | |
| Round lines | the labels that differed | | |

## Device facts re-established (spec §5.3)

The camera and mic open on a locked phone; readiness on a locked phone; the notification text paired and live.

## HLS start inside 5 s (spec §8)

Taps, pictures within 5 s, and not-readies.

## Recordings deleted

| Input (8 chars…) | Videos | Durations | Deleted (200) | Re-listed empty |

## Deviations

Row 13 used Android's thermal override; any other change, with its reason.

## Findings

Each finding with its row, evidence, and who it is for (owner, mobile-s1-web, or a new N-ID in _FINDINGS.md).
```

---

## Self-review

- **Spec coverage:**
  - §5's prerequisites are Task 0.
  - Rows 1 and 1a to 1c are Task 1. Row 2 is Task 2, with 2c added by the coordinator. Row 3 is Task 3. Rows 4 to 6 are Task 4. Row 7 is Task 5. Row 8 is Task 6. Row 9 is Task 7. Row 10 is Task 8. Row 11 is Task 9. Row 12 is Task 10. Row 13 is Task 11.
  - Carries 20 and 26 are Task 1. S3 is Task 5. S10 (the exit bar) is Task 9, with Tasks 2 and 4. The forced-RTMPS session id is Task 7. S11 and S2b are Task 9.
  - §5.2 is Task 8, with its caution. §5.3 is Tasks 1 and 2. Recording deletion ends every task, with a final sweep in Task 12.
  - The results skeleton is in Task 12. §3.7 is reflected: no step cites plan C results. §8's three risks are Task 10 Step 4, Task 10 Step 10 and Task 0 Step 5.
- **Gaps stated rather than hidden:**
  - Row 8 depends on D1's beat-send line. The web's history only corroborates it.
  - S11 run 2 needs a host-blocking router, or it is handed to the web.
  - S2b is moot under W26.
  - Rows 4 to 6 need a second Android 12+ phone.
