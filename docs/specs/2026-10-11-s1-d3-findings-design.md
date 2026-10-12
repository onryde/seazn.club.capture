# S1 D3 findings — design

**Status:** approved by the owner, 2026-10-11 ("approve").
**Basis:** main at 633918c (D1 and D2 merged through PR #21).
**Evidence:** the D3 staging run of 2026-10-10 and 2026-10-11, and the
owner's probe of 2026-10-11 22:19–22:31Z. The ledger is
`.superpowers/sdd/2026-10-09-s1-plan-d3-staging-run/progress.md` (git-excluded);
screenshots and records are in `~/seazn-d3-evidence/2026-10-10`. The results doc
(D3 Task 12) will cite them. The code map is the scout's, from main at 633918c.

The owner asked for every finding from the D3 run to be fixed ("all"), after a
brainstorm. This spec covers the app's side. The web's side is a brief (§11),
sent to `mobile-s1-web`.

D3 is not finished. Tasks 5, 7, 9, 11 and 12 remain (router UDP block, the
debug-build thermal rung, the results doc). This spec does not wait for them,
and it changes nothing they test.

---

## 1. Rulings this spec rests on

Each ruling is dated and named. A ruling marked _controller's_ is a
recommendation the owner may overrule in review; it is never the owner's.

| ID  | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Who, when                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| R1  | Fix all of the D3 findings (A1–A4, B6–B9); A5 is recorded, not changed.                                                                                                                                                                                                                                                                                                                                                                                | Owner, 2026-10-11 ("all")                                                              |
| R2  | Automatic stays **on** by default. The two phone settings, _Start and stop automatically_ and _Controls on the Left / Right_, are reachable from Home before a scan, through a "Stream settings" link inside the Live Stream tile (option A; a gear since 2026-10-12, below). It opens Stream Settings without the Diagnostics card. This is the owner's AGENTS §1 ruling: one added control on Home, and one screen reachable outside a mode.         | Owner, 2026-10-11; the gear, 2026-10-12                                                |
| R3  | A "Send record to Seazn" **button** (option B). Nothing uploads by itself; automatic upload may follow later. This is the owner's ruling on AGENTS §1's "no upload" for the session record, sent on the operator's tap.                                                                                                                                                                                                                                | Owner, 2026-10-11                                                                      |
| R4  | The upload authenticates with the last stream code's token, kept for 24 h after an unpair, for uploads only (option A). The server accepts a record for any valid token of that code, from a replaced phone too.                                                                                                                                                                                                                                       | Owner, 2026-10-11                                                                      |
| R5  | Battery: **no prompt and no card by default**. A row in Stream Settings shows whether background activity is allowed and opens this app's battery page, where the operator may choose _Unrestricted_. No `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permission.                                                                                                                                                                                            | Owner, 2026-10-11 ("A, instead of asking default, user may go to setting then choose") |
| R6  | A **Forget** action on the Android notification while the phone is paired and waiting (scanned, not live).                                                                                                                                                                                                                                                                                                                                             | Owner, 2026-10-11                                                                      |
| R7  | The notification's Forget has no confirmation step: a mis-tap costs a rescan.                                                                                                                                                                                                                                                                                                                                                                          | _Controller's_, 2026-10-11                                                             |
| R8  | A5 (the 20 s lag rule) is not changed: on 2026-10-11 it fired on a real stall.                                                                                                                                                                                                                                                                                                                                                                         | _Controller's_, 2026-10-11                                                             |
| R9  | The upload sends what Share record shares (the JS ring, the last 1,000 lines), so there is one record and one truth. N25's 1,000-line cap stays a separate matter.                                                                                                                                                                                                                                                                                     | _Controller's_, 2026-10-11                                                             |
| R10 | A rejoin after a hold has run out keeps trying while the server says live (the server is the authority, A14), but it shows a reason and backs off (§5).                                                                                                                                                                                                                                                                                                | _Controller's_, 2026-10-11                                                             |
| R11 | Portrait Home amends S0 decision 9 ("three equal tiles"): a portrait tile is never shorter than its own words; spare height is shared equally, and Home scrolls when the tiles outgrow the window. Landscape keeps equal widths. Re-measured with the gear (Batch 10): equal thirds fit with no card, but with a card they need a 736–807 dp window at 360 wide (`homeFit.test.ts`); a 360 × 800 phone leaves about 720. I2 of the Batch 5 review.     | _Controller's_, 2026-10-12; owner to confirm                                           |
| R12 | The battery row reads three modes in Android's own words, from two readings: _Unrestricted_ (`isIgnoringBatteryOptimizations`), else _Restricted_ (`ActivityManager.isBackgroundRestricted`), else _Optimized_; unknown hides the row. Its button is _App settings_ and opens App info (`ACTION_APPLICATION_DETAILS_SETTINGS`, the only public per-app target), with a path line under it ("Battery → Unrestricted"). I1 and M5 of the Batch 5 review. | _Controller's_, 2026-10-12                                                             |
| R13 | From Arming on, the battery row's button is disabled with one line, "Change it after the broadcast": App info is one tap from Force stop and the camera and microphone permissions, and the app in the background is N27's condition. The mode stays readable. I3 of the Batch 5 review.                                                                                                                                                               | _Controller's_, 2026-10-12                                                             |

**R2 as the owner presented it (2026-10-12).** "Instead of text, can we have
icon in right top corner?", choosing the gear mockup: the "Stream settings" link
became a gear in the Live Stream tile's top-right corner. It is the on-air icon
row's Settings glyph on a 48 dp target, named "Stream settings" for a screen
reader, and it opens the same Stream Settings (§6).

## 2. New findings to file

These go in `_FINDINGS.md` in the first task of the plan, with the evidence named
above. N26 is the last number in use.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N27 | A locked phone stops beating. On the NE2211 (Android 16, OxygenOS), with the foreground service (camera + microphone) and the partial wake lock both held, beats stopped about 2 minutes into a lock (D3 Task 2b, VERDICT B; and 2026-10-11 22:06–22:09Z). It happened on charge too, so it is not plain Doze. With the app set to **Unrestricted** battery, beats ran unbroken through a 9-minute lock (22:19:51–22:28:32Z), and a console Go live was heard while locked.                                                                                                    |
| N28 | A locked or background start has no video. At the locked Go live (22:26:04Z), StreamPack logged `VideoInput: Video source configuration is not set` and `…can't add output surface`. No `delivered` line until a lag-rule reconnect (one broadcast; resumed 22:30:17Z, delivered 22:30:23Z): the console showed Trouble; YouTube stayed on "Preparing stream". The same vendor lines precede D3's "no video after a camera taken → reopen" (sid a20dcecf). A YouTube event that starts with no video may stay on "Preparing" after the picture arrives (observed, not proven). |
| N29 | A rejoin after the hold runs out retries forever, with no reason shown. `Verdicts.over` returns the phone to Paired without marking the sid (`Pairings.kt:274-281`). The next beat saying `live` re-arms it as a new Session with `liveSinceEpochMs` null, so `outageFor` returns no outage (`SessionMachine.kt:327-331`), there is no hold, `Transports.failed` retries every 2 s with no limit (`:262-276`), and the snapshot shows CONNECTING with no reason (`Projection.kt:72`).                                                                                          |
| N30 | A square preview on the CPH2569. The camera served the preview 960 × 960 and the encoder 1280 × 720 (`dumpsys media.camera`, 2026-10-11 21:10Z), so the 16:9 box shows the picture pillarboxed. StreamPack 3.2.1 picks the preview size by **area only** (`CameraSizes.getPreviewOutputSize`: sort by area, reverse, `closestTo`), and 960 × 960 has exactly the area of 1280 × 720 (921,600). `PreviewSizeReport.sameArea` (`PreviewSizes.report`) already counts such ties; nothing acts on it.                                                                              |
| N31 | French Home tile titles ran past their tile on the owner's phone sideways (3-button navigation): ShellFrame's insets lay Home out 728 dp wide, not the display's 804, so a title's room is 162.7 dp; the font measure matched within 1 dp. The title had no `numberOfLines` and no `flexShrink`. It now wraps within 2 lines and steps down a size where its room is under 124 dp (to a 581 dp Home); fit widths are Home's laid-out width (the controller's ruling, 2026-10-12).                                                                                              |
| N32 | The 20 s lag rule fired at `lagGrowthMs` 20,456 with `stalledMs` 18,151 (2026-10-11 22:30:15Z): a real stall, close to the limit. D3 row 1 saw growth of 16–20 s near the limit too. Recorded; no change (R8).                                                                                                                                                                                                                                                                                                                                                                 |
| N33 | A replaced phone cannot hand over its record. Share record lives only in Live Stream's Settings, and a phone sent to Home by `Replaced` has no pairing to open it from.                                                                                                                                                                                                                                                                                                                                                                                                        |
| N34 | The round line is the server's text and is not localised: in French the phone shows "ROUND 2". It is the web's call (§11).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 3. A3 — a camera start off the Live Stream view has no video (N28)

**The defect.** When the camera is (re)started while the Live Stream view is not
showing (the app on Home, the screen locked, or the camera given back by another
app), the encoder gets no video. The broadcast connects, the bitrate climbs, and
Cloudflare has nothing to play.

**What is known.** The capture run rebuilds the streamer on reopen while only
paired (`CaptureRun.kt:281-289`, then `:202`). On air, `reopenCamera` returns
false if the source is already a camera (`StreamerAdapter.kt:338-346`).
StreamPack's `VideoInput` owns its output surfaces
(`addOutputSurface$streampack_core`), and no repo code adds or removes one. The
`Video source configuration is not set` line also appears at a normal pairing
(2026-10-11 22:19:11Z), where video then worked. So that line alone is not the
cause; what differs is whether a preview surface is attached when the stream
starts.

**Root cause first.** The first task of this item is an investigation on the
device, under superpowers:systematic-debugging. It reproduces three paths:

1. Paired on Home, screen on, then a console Go live.
2. Paired, screen locked for 3 minutes or more, on Unrestricted battery, then a
   console Go live.
3. Paired on Live Stream, another camera app opened and closed, then Go live.

It names the line of code where the encoder's input surface fails to attach. It
writes that cause into N28 before any fix.

**The fix's contract**, whatever the cause turns out to be:

- A start (held, remote, automatic or rejoin) delivers video whether or not the
  Live Stream view is attached, and whether or not the screen is on.
- Attaching or detaching the preview never stops or restarts the encode (P2:
  frames never approach the bridge; preview is a native view).
- A camera given back by another app resumes video on air without a new
  session where StreamPack allows it. Where it does not, a rebuild is recorded
  as one.

**Proof** (device-only; amended by the controller's ruling, 2026-10-12, since
a healthy start never writes `delivered`, which marks a cleared
`not-delivered`). Each of the three paths above gets `capture-clock` and `live`
within 30 s of `connected`, beats reading `delivery ok` with lag under 2 s, a
master playlist carrying `avc1` and `RESOLUTION=1280x720`, and a segment that
ffprobe and blackdetect show as real, non-black video. Path 2 on Unrestricted
battery is the locked-phone acceptance.

## 4. A1 — the preview is 16:9 (N30)

**Rule.** The preview stream's size has the encode's aspect, 16:9, whenever the
camera lists one. Among the 16:9 sizes, take the one whose area is closest to
1280 × 720. If none is listed, keep StreamPack's pick and record it.

**Mechanism.** StreamPack 3.2.1 cannot be told: its pick is area-only, and every
size with the same area ties. Ruled out:

- FILL scaling, because it would crop the preview, and the operator would then
  frame a picture the encoder does not send.
- Nudging the view's size, because an area tie cannot be broken by area.

The plan's first step for A1 is a short spike on the vendor API. It looks for a
supported way to give the camera source an explicit preview size (a camera
settings hook, an `IPreviewableSource` variant, or a preview surface of ours
whose buffer size we set). It takes the least invasive one that works on 3.2.1
without a fork. A fork, or a patch to the strict pin, is the owner's call, and
the plan stops and asks before one.

**Record.** The `preview-size` line gains `pickAspect16x9: boolean` and the
source of the pick (`ours` or `vendor`). The new field goes on the scrub
allow-list with its reason, and the parity test covers it.

**Proof.** A unit test of the pure rule over three lists: the CPH2569's (a
960 × 960 tie), the NE2211's, and a list with no 16:9 size. On the device:
`dumpsys media.camera` on the CPH2569 shows a 16:9 preview stream, and the
screenshot shows no pillarbox. The NE2211 is unchanged.

## 5. A4 — a rejoin after the hold runs out (N29)

**Rule** (R10, controller's):

- When the hold runs out, the broadcast ends for this phone as today
  (`HOLD_WINDOW_EXPIRED`, record line `hold-expired`).
- A later beat saying `live` for the same sid may rejoin it: the server is the
  authority, and this is how a broadcast recovers after a long outage.
- The rejoined session is marked as a rejoin of a broadcast that was live. Its
  connect phase projects as **Reconnecting**, with a reason that the operator
  can read, never as a bare CONNECTING.
- Its retry interval backs off: 2 s, 4 s, 8 s, 16 s, then 30 s, and the 30 s
  repeats while the server says live.
- A retry never ends the broadcast by itself. Only the server, Stop, or a new
  hold can end it.

**Copy.** A new status key, for example `stream.status.rejoining`: "Uplink lost
— still live on the server, retrying". It is `urgent` in `LINE_TIER`, because it
reports trouble. It needs all four locales, and `stripTextFit.test.ts` measures
it at 640 × 360.

**Proof.** Kotlin core tests:

- the hold runs out, then a `live` beat, gives a rejoin;
- the projection reads Reconnecting with the reason;
- the intervals follow the back-off;
- a `NoBroadcast` beat ends it.

Mutate the rejoin marker once and watch a test fail.

## 6. B6 — Stream settings from Home (R2)

- The Live Stream tile gets a gear in its top-right corner, named "Stream
  settings" (`home.streamSettings`) for a screen reader: R2 as the owner
  presented it (2026-10-12, §1), in place of the text link first built under
  the hint. It is a `Pressable` with a 48 dp target, the sibling of the tile's
  button, and it never competes with the tile's own tap. Upright the head row
  ends where the gear begins; sideways the tile's top padding is the gear's
  48 dp and the head sits under it, since a third of the row is too narrow to
  share the head's line.
- The gear opens Stream Settings with `from=home`. Diagnostics is not shown,
  because nothing is paired. Shown:
  - _Start and stop automatically_ (default on);
  - _Controls on the Left / Right_;
  - the battery row (§8);
  - the record row (§7).
- The same screen inside Live Stream is unchanged, with Diagnostics.
- The route sits outside `app/stream/`, so it has no LIVE plate and no
  on-air rules. The owner's R2 is what allows a screen reachable outside a mode.
  AGENTS §1 and §6 are updated in the same change, to say so.
- Home's layout tests (`homeFit.test.ts`) check, in all four locales, that the
  gear never covers the tile's icon or title at 592, 640, 728, 804 and 915 dp
  wide sideways and 360 and 412 upright, and that the sideways band fits with
  no card. The controller's ruling of 2026-10-12 (N31, N35) made the fits'
  geometry the size Home is laid out at behind ShellFrame's insets, so they
  carry 728 × 328, the owner's phone sideways.
- In portrait each tile grows from its own content and Home scrolls when the
  tiles outgrow the window (R11), so no tile is squeezed below its words when a
  card stands above them.

## 7. B7 — Send record to Seazn (R3, R4, R9)

- **Place.** A record row in Stream Settings, in both variants: _Share record_,
  which moves out of the Diagnostics card so that Home's Stream Settings has it
  too, and _Send record to Seazn_.
- **Credential.** When a code is saved, the phone also keeps an upload
  credential `{codeUrl, token, expiresAtMs}` (the D3 fixes plan's ruling P12,
  the controller's):
  - It is kept in secure storage, behind the key-value port, never in the
    record or a snapshot.
  - It follows the saved stream code: written at its save, replaced by the
    next code's. That is renewal at every pair, because every pair follows a
    save or comes from a saved code, and the token is the QR's own.
  - When the code is dropped (Forget, Replaced, Taken, Over), `expiresAtMs` is
    set to the time the app learns of the drop plus 24 h, and the entry is
    deleted after that. A drop while the app is not running is learnt at the
    next launch; the server's own token validity bounds the rest.
  - It is sent only to the code's URL on the build's Seazn host, the URL native
    holds the pairing to (Batch 6 fix round 1).
- **Button states:**
  - _Send record to Seazn_;
  - _Sending…_;
  - _Sent · ref R-7K2Q_, a short reference the server returns, for the operator
    to read to the organiser;
  - _Couldn't send — try again_, for a failure another try can change: the
    network, the 15 s bound, `429` or a `5xx`;
  - _Can't send this record_, for one it cannot, with the one line why
    (Batch 11 fix round 1, the controller's ruling 8): `401` "This stream code
    has ended"; `404` "Seazn doesn't take records here"; `413`, or over the
    limit before sending, "Too big to send — use Share record"; a contract
    mismatch (`422`, a `201` with no readable ref, or a record the port will
    not send) "Use Share record instead". The button stays enabled for both:
    a code can come back, and an endpoint can ship.
  - With no credential, the button is disabled, with the one line "Scan a
    stream code first".
  - From Arming on, the button is disabled, with the one line "Send it after
    the broadcast", as the battery row's button is; _Share record_ stays
    enabled (the controller's ruling, 2026-10-12, on Minor 8 of the Batch 6
    review). A send started just before Arming may finish on air, within the
    upload's 15 s bound.
- **Port.** A `RecordUploadPort` in `services/`, with plain `fetch` (AGENTS §8:
  no React Query) and a fake for tests. A request with an answer is fine here,
  because the call never touches the engine bridge.
- **Body.** The scrubbed record lines that Share sends, as `application/x-ndjson`,
  uncompressed: the contract accepts gzip, and the app does not send it. Before
  sending, the port checks each line as written. A line that names the token,
  is not a record line, or would change under the scrub fails closed: nothing
  is sent, and the port records `record.send {result:"refused-local"}`. Then
  each field whose key the web's contract does not list is dropped from its
  line, and the line goes (Q4 of the web's record design, batch 11). Share
  record keeps the line as written.
  - **What the server does with a bad line** (the owner's ruling, relayed by
    the web, 2026-10-12): it drops the line and still answers
    `201 {ref, kept, dropped}`. A bad line is one that is secret-shaped, has a
    field off the list, has a malformed `sid`, `tokenTag` or `at`, or is not
    JSON. `401`, `413` and `429` stay answers for the whole record. The
    vendored contract (`53f28ebfc`) predates the ruling and still says `422`
    for such a body. So the phone does not run S2–S5 or the contract's class
    narrowings itself: such a line is dropped server-side, and no longer fails
    every send until it leaves the ring (findings 1 and 4 of the Batch 11
    review). Its value still crosses to the server, which drops it unstored.
    The phone's own drop keeps the rest of a line whose only fault is an
    unlisted field, where the server would drop the line whole.
- **Record lines.** `record.send {result, status, bytes}`, with no reference
  and no token in the line.
- **Contract.** The web side owns the endpoint (§11). Its contract,
  `capture-record.v1.json` with 52 fixtures, merged as web #941 (`53f28ebfc`)
  on 2026-10-12, after the owner approved the web's design. The app vendors it
  like the others (`pnpm contracts:vendor`, the pin test; 7ccfbd8), and the
  port holds to it (`src/services/recordContract.ts`; 866f3f8):
  `POST {code URL}/records`, at most 1,000 lines and 1,048,576 bytes, a 201
  read for its `ref` alone (RD, the owner's ruling of 2026-10-12: `kept` and
  `dropped` are never read), and 401, 413 and 429 read by their status. The
  button is built behind `FEATURES.recordSend`, the same shape as
  `viewerCheck`, and the switch is on. The owner was asked in the session on
  2026-10-12 whether to turn Send record on with the endpoint on staging, and
  chose "On now (Recommended)". A production build answers _Can't send this
  record_, "Seazn doesn't take records here", until production has it.

## 8. B8 — the battery row (R5, N27)

- In Stream Settings, both variants, on Android only:
  - _Background activity_ reads the app's battery mode in Android's own
    words (R12): **Unrestricted** when
    `PowerManager.isIgnoringBatteryOptimizations`, else **Restricted** when
    `ActivityManager.isBackgroundRestricted`, else **Optimized**, Android's
    default. Optimized and Restricted are set in caution. It is read through a
    `PowerPort` in `Ports`, with a fake.
  - The row's hint is one sentence (it wraps on a narrow phone): "Allow it so
    a Go live from the console works with the screen locked."
  - Its button, _App settings_, opens this app's App info page
    (`ACTION_APPLICATION_DETAILS_SETTINGS` for the package, by React Native's
    `Linking.openSettings()`; no new permission), where Battery is one tap
    away. A path line under it says the way: "Battery → Unrestricted" (R12;
    the controller's note, 2026-10-12: App info is the only public per-app
    target, so the button and this spec no longer call it the battery page).
  - From Arming on, the button is disabled with one line, "Change it after
    the broadcast" (R13). The mode stays readable.
- The mode is re-read when the app returns to the foreground.
- No prompt, no card at pairing, no nag (R5).
- **iOS:** the row is absent. The camera stops in the background there anyway
  (P1). An unknown mode on Android hides the row too.
- The record gets `power {mode}` at every pairing's hold, and again when a
  return to the foreground reads a different mode (M4 of the Batch 5 review),
  so a later record shows which mode a locked failure ran in.
- AGENTS §9 is amended:
  - the locked-phone path needs Unrestricted battery on OxygenOS (N27) and the
    A3 fix (N28);
  - keep-awake with the dim stays the default path.

## 9. B9 — Forget on the notification (R6, R7)

- **Where.** Native builds the notification (`CaptureForegroundService` /
  `PairingKeeper`). While the phase is _paired and waiting_, it carries one
  action, **Forget** (localised; the notification already follows
  `setLanguage`).
- **When it is hidden.** It is removed the moment the phase leaves waiting
  (arming, connecting, live, reconnecting). A tap that lands after that is
  ignored, and recorded as such.
- **What a tap does.** It is a native intent equal to Home's Forget:
  - unpair;
  - stop the foreground service;
  - release the wake lock;
  - mark the pairing _forgotten_ in native's durable state, so it survives
    process death.
- **JS's side.** JS reconciles: when the snapshot shows no pairing, with the
  cause `forgotten`, the saved code is dropped. The upload credential's 24 h
  clock starts (§7). Home shows no Continue card. On a cold start, a forgotten
  marker that JS has not yet seen drops the saved code before the Continue card
  can offer it.
- **Proof.**
  - Kotlin tests: the action shows only while waiting; a tap while armed is
    ignored; the forgotten marker persists.
  - A JS test: the projection drops the saved code.
  - Device-only: tap Forget on the shade with the app in the background, then
    open the app, and Home shows no Continue card.

## 10. A2 — tile titles fit (N31)

- The tile's title row gets `flexShrink: 1` on the title, and the title wraps
  to at most 2 lines (`numberOfLines={2}`), then ends in an ellipsis.
- `homeFit.test.ts` gains a width check: for every mode title in en, es, fr and
  nl, at 640, 804 and 915 dp, the title's measured width (from the same font
  metrics the height check uses) fits the tile's title budget, or it wraps
  within 2 lines. The tile heights are re-checked with the wrap.
- The controller's ruling of 2026-10-12 (N31) made the widths Home's laid-out
  width behind ShellFrame's insets (592, 640, 728, 804 and 915), and added a
  step down: where the title's room is under its widest word (124 dp), the
  title is set a size smaller (`tileTitleRole`), so no word is broken (§2's
  N31 row).

## 11. The web's part (brief for `mobile-s1-web`)

Sent as a message, and written to `docs/specs/2026-10-11-s1-d3-web-brief.md` in
this branch:

1. **The record upload endpoint (R3, R4).**
   - `POST` under the capture API, authenticated with the code's token the way
     beats are.
   - It accepts a record for any currently valid token of that code. A phone
     the slot has replaced, or that no longer holds the slot, may still send.
   - Body: ndjson, at most 1,000 lines and 1 MB; gzip accepted.
   - Answer: `201 {ref}`, a short human reference. Also `401` for a bad token,
     `413` for too large, and `429` with a per-code rate limit.
   - The server rejects a body carrying secret-shaped fields, and never stores
     one.
   - Storage keyed to org, competition, fixture, slot and session id (from the
     record's own lines), with retention (30 days proposed; the owner's call),
     and an admin view next to the session in the console.
   - The contract file is published, for the app to vendor.

   Published on 2026-10-12 (web #941, `53f28ebfc`), vendored and followed in
   Batch 11 (§7). The web brief's §1 records the contract and the app's answers
   to the web's questions.

2. **The round line in other languages (N34).** Does the web localise the round
   line ("Round 2", "SF", "Final") by the phone's language? Or does the phone
   keep the server's English? The beat or the descriptor would need to carry
   the language.
3. **Owed from D3:**
   - the `stop_ignored {held:true}` check for sid c1778787 (row 6);
   - the `fixture_stream_phone_beats` rows for row 1 and the 2026-10-11 pairings
     (24 h purge);
   - the recordings to delete (the list in the ledger).
4. **Observed: YouTube "Preparing stream".** A broadcast that started with no
   video (N28) left YouTube on "Preparing" after video arrived, while earlier
   broadcasts on the same destination played. Does the restream need a
   restart when the first segments carry no video?

## 12. Order and slices

One plan, native execution with the owner's hands for the device checks, in
this order:

1. **Findings and docs:** N27–N34 into `_FINDINGS.md`; AGENTS §1, §6 and §9
   amended (R2, R3, R5).
2. **A3:** investigation on the device, then the fix (§3).
3. **A4:** the rejoin (§5).
4. **A1:** the spike, then the 16:9 rule (§4).
5. **B9:** Forget on the notification (§9).
6. **B6 + B8:** Stream settings from Home, and the battery row (§6, §8).
7. **B7:** Send record, built behind its switch (§7), on since 2026-10-12 (the
   owner's ruling).
8. **A2:** tile titles (§10).
9. **Device pass** on both phones: A3's three paths, A1 on the CPH2569, B9 on
   the shade, B6 and B8 on the owner's phone (728 × 328 as laid out) and at
   640 × 360, in en and fr.

Each slice answers AGENTS §10's four questions in its tests:

- a second call;
- an empty input;
- after an interruption;
- another mode, orientation or language.

## 13. Out of scope

- Automatic upload.
- A battery prompt.
- Any change to the lag rule.
- iOS lifecycle work.
- D3's remaining tasks.
- The web's endpoint itself.
