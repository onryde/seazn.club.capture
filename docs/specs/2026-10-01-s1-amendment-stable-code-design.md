# S1 amendment — the stable stream code — design

**Status:** owner-approved design, 2026-10-01, brainstormed section by section (§1 states and contract, §2 screens and copy, §3 what changes where). Revised the same day after an independent review and a re-review (_Review dispositions_, at the end), and nine further owner rulings (A9–A17). The written amendment was owner-approved on 2026-10-01. Next: the revised plan C.
**Amends:** [S1 — Live Stream, handheld](2026-09-30-s1-live-stream-design.md). Where the two disagree, this document wins. _What this changes in S1_ lists every part of S1 it replaces, keeps or drops. Nothing outside that list changes.
**Web side:** agreed with the seazn.club lane D session (`r1-laned`) on 2026-10-01. Its owner's rulings for the web side are recorded under _Web-side rulings_; they are facts we build against, not rulings for this repo. This revision adds asks the web has not yet seen (_Asks for the web side_). The amendment is approved; the web publishes its schemas once lane D agrees to the asks.

## Why

The web owner ruled that the stream QR stops carrying ingest credentials and becomes a **stable code**: one printable code per fixture, scanned once, reused for every Go live until the match is finished. Credentials are served only once a broadcast starts. Our owner accepted it and added two things of their own: either side may start or stop a broadcast, and an opt-in automatic mode starts and stops with the match.

The same shape serves S3's court-bound phones: a court phone scans a court code, stays paired all day, and the server hands it each match in turn. So the names are neutral — a **stream code**, never a fixture — and the label and start time always come from the server.

## Decisions

| #   | Decision                  | Ruling (owner, 2026-10-01)                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The code                  | capture-qr.v2 becomes `{v:2, code, slot, tok, exp?}`. No credentials. `exp` is optional; absent means the server decides. Replaces S1 decision 4's QR shape; `tok` stays the Bearer for every phone→server call and is still stored server-side only as a hash.                                                                          |
| A2  | Who starts                | **Either side.** The organiser's Go live in the console, or the operator's 3 s Go live hold on the phone (`POST start`). Either way the phone publishes with no second tap.                                                                                                                                                              |
| A3  | Who stops                 | **Either side.** An organiser Stop returns the phone to paired·waiting on the same code. The operator's own 3 s Stop hold ends the broadcast **and unpairs**; the next broadcast needs a rescan.                                                                                                                                         |
| A4  | Automatic mode            | Seazn starts the broadcast at match start and stops it about 3 min after the result is saved, **only when** the console's per-fixture switch ("Stream the match automatically") **and** the phone's Settings switch are both on. The phone's switch is **on by default**. Every beat carries the phone's mode.                           |
| A5  | Architecture              | **The native engine owns the whole code lifecycle**: a new paired·waiting phase, heartbeats with no session, the server's answers driving Go live. JS sends intents only (AGENTS §2). Server push is a later fallback if waiting drains batteries.                                                                                       |
| A6  | Neutral names             | `code`, not fixture. S1 builds the fixture kind; S3 adds the court kind with no engine change.                                                                                                                                                                                                                                           |
| A7  | Another mode while paired | Opening Remote Scoring or the Dashboard while paired (not live) asks first and unpairs on confirm. While live, other modes stay blocked as today.                                                                                                                                                                                        |
| A8  | The final beat            | Unchanged from the earlier 2026-10-01 ruling: one best-effort beat `{state:"ended", endReason:"operator-stopped"}` only when the operator stops a broadcast that was live.                                                                                                                                                               |
| A9  | A second phone            | The newest pairing of the same code and slot takes over. The old phone is told and unpairs, reading "Paired on another phone". While LIVE, a takeover is refused: the new phone reads "This camera is live on another phone".                                                                                                            |
| A10 | Rejoin                    | A paired phone that hears "live" for its code and slot rejoins and publishes with no tap: after process death, or after its hold window ran out while the server kept the broadcast open. Status line "Rejoining the live stream".                                                                                                       |
| A11 | Readiness                 | A remote or automatic start checks readiness. The phone publishes once its pre-flight passes (camera, sound, network, held sideways), on any screen. If not ready it stays paired, shows why, and reports "not ready: {reason}" in its beat. The encoded orientation comes from how the phone is held, never from the screen's rotation. |
| A12 | After an organiser Stop   | An organiser Stop turns automatic mode off for that match. Only a manual Go live, from the console or the phone, restarts it.                                                                                                                                                                                                            |
| A13 | Copy                      | "Waiting for the organiser to pick where to stream" becomes "Waiting for the organiser to pick a destination". "Stopped by the organiser — waiting for the next Go live" becomes "Organiser stopped it — waiting for Go live". `destinationName` is cut with an ellipsis on the phone past about 24 characters.                          |
| A14 | A dead phone              | A live slot may be taken over once the live phone has sent no heartbeat and no video for the hold window (60 s). The new phone then rejoins the open broadcast per A10, with no console visit.                                                                                                                                           |
| A15 | The automatic stop        | After A12, only the automatic **start** is off for that match. The automatic **stop** (about 3 min after the result) still applies to a broadcast restarted by hand.                                                                                                                                                                     |
| A16 | A late pairing            | With automatic mode on at both ends, a phone that pairs while the match is in progress, before any broadcast has run, starts once its checks pass (A11). Still only once per match, and never after an organiser Stop (A12). The automatic start fires once per match, at match start or on a late pairing, whichever comes first.       |
| A17 | The operator's Stop wins  | The phone remembers the `sid` it stopped. On the next pairing it re-sends the stopped signal for that `sid`, never rejoins it, and waits for a fresh Go live.                                                                                                                                                                            |

A8's earlier ruling was given to the coordinator on 2026-10-01 while plan C was prepared, and was recorded only in working notes outside the repository. This document is now its record: the phone sends one final best-effort beat only when the operator stops a broadcast that was live. Every other end, and every internal stop (unpair, replace, orphan clear), sends nothing, and nothing is retried. Plan B's core does not send it today (`Heartbeats.tick` returns once there is no session), so it is new core work (§3).

## Web-side rulings we build against

- **Expiry.** A stream code is valid until the match is finished (result saved, void or abandoned) plus 2 h, with no time cap. Expiry blocks new pairing and new Go lives only; it **never ends a live broadcast**. A pause today and a resume tomorrow work on the same saved code.
- **401** from any code call means the code is expired or revoked: the phone forgets it. **410**, or an "over" answer, ends the current broadcast only: the phone returns to waiting.
- **Start gates.** `POST start` spends a credit, so it passes the console's gates: credit, entitlement, and a destination the organiser has already chosen. Refusals: `409 no_destination`, `402 no_credit`, `403 not_entitled`, each with a plain message. `409 already_live` means a broadcast is already open: the phone takes it over.
- **Ingest hosts.** `cred` points at Seazn's own Cloudflare custom domains: `live.seazn.club` in production (RTMPS `:443/live/`, SRT `:778`) and `live.stg.seazn.club` on staging. SRT over the custom host is still to be proven on staging by the web side.
- **Cadence.** The server drives `pollSeconds`: 60 s until about 30 min before the scheduled start, 10 s after.

## Asks for the web side

New in this revision, to be agreed with lane D before the schemas are published. Each follows from a ruling above.

1. **The beat answer carries what the phone shows** (§1 _Contract shapes_): `startedBy` on `go-live`, `endReason` on `over`, and the waiting fields (`label`, `scheduledStart`, `autoAllowed`, `destinationName`, `overlayUrl`, `pollSeconds`) on every answer. **`auto_stopped`** joins `endReason` in both the beat answer and the descriptor, which share one vocabulary.
2. **Pairing is claimed, per phone, with a kind (A9, A14).** Each beat carries `phone`, a random id the app makes once per install, and `claim: "new" | "resume"` until the pairing's first 2xx answer (`null` after it). The kind decides **who holds the slot**; it never decides the broadcast. The server keeps one current phone per code and slot:
   - a claim of either kind from the current phone, or for a slot with none, is answered by the slot's state;
   - a `new` claim (a scan, or a Continue tap) from another phone takes the slot, unless the slot is LIVE and its phone is alive: then `taken`;
   - the live phone counts as dead once the server has had no beat from it **and** Cloudflare has reported the input not connected, both for 60 s (A14). A `new` claim then takes the slot;
   - a `resume` claim (an automatic re-pair at cold start) from a phone that is not current is answered `replaced`, never a takeover;
   - a beat without a claim from a phone that is not current is answered `replaced`.
   - **What happens to the broadcast** is the same for every accepted claim: if the slot has an open broadcast, the answer names that `sid` (`go-live` or `live`), and the phone joins it (A10). A takeover therefore reuses the open broadcast and its credit; no claim ever opens a new one.
3. **`go-live` and `live` are told apart (A10).** `go-live` names an open broadcast that has received no ingest yet; `live`, one that has. A beat naming a sid that has ended is answered `over` for that sid first, whatever has opened since.
4. **`409 already_live` carries `{sid, startedBy}`** of the open broadcast, so the phone can take it over.
5. **The waiting shape gains `overlayUrl|null`**, so the operator frames with the scorebug (S1 decision 8).
6. **The automatic start and stop are the server's to apply (A12, A15, A16).** The automatic start fires once per match and slot: at match start, or on a late pairing (a claim while the match is in progress and no broadcast has run), whichever is first, and only when `autoAllowed` and the phone's `mode` are both on. After an organiser Stop it does not fire for that match. The automatic stop still ends a broadcast restarted by hand. `autoAllowed` stays the console's switch; an organiser Stop does not change it.
7. **A stop from the phone closes its `sid`, and only that one (A17).** A paired beat (one that holds no `sid`) carrying `stopped: sid` closes that broadcast if it is still open. If it has already ended, or a newer `sid` exists, the stop is a no-op answered 200. The server never names a stopped `sid` as open again.
8. **Beats and 410.** A 410 from a beat ends the broadcast it names, as from any code call (the web ruling). The phone reads it so; the web may instead confirm that beats never answer 410.
9. **`POST start` carries `{phone}`.** A start from a phone that is not current is refused with `409 replaced`, so it cannot spend a credit for another phone's slot.
10. **Required: a warming broadcast whose phone has gone quiet is ended.** A broadcast that has received no ingest, whose slot's phone has sent no beat for 60 s (A14's clock), is ended by the server, `over` with `stopped`, rather than left warming until the 10-minute no-signal timeout. Without it, a second phone that pairs the slot can join a broadcast the first phone's operator stopped before its first frame (_Known gaps_).

## 1. States and contract

### The engine's phases

```
Idle ──pair──▶ Pairing ──granted──▶ Paired ──go-live · live · start──▶ Arming ──▶ Armed ──ready──▶ Connecting ⇄ On air
 ▲ ▲              │                   │ ▲                                 │          │                    │
 │ ├── refused ───┘                   │ └── over · 410 · waiting · another sid · hold window ran out · start failed
 │ └──────────────────────────────────┴──── 401 · replaced · taken · unpair, from Paired; replaced from any phase;
 │                                          a 401 while a broadcast is held acts once it ends
 │
 └──reset── Ended ◀── the operator's Stop hold, from Arming on (the final beat only if it was live, A8; A17's memory always)
                  ◀── a permanent failure, from any phase but Idle
```

Pairing waits for the camera and microphone permissions; a refusal returns to Idle. Arming fetches the session descriptor. Armed waits until the phone is ready (A11).

- **Pairing**, then **Paired**, is entered at the scan, while the app is on screen. In Pairing the engine asks for camera and microphone permission; once granted it starts the camera|microphone foreground service with a partial wake lock, and is Paired. Android 14+ forbids starting that service from the background, and a remote Go live must work with the phone locked.
- **While paired** the engine beats at the server's `pollSeconds`. The first beat goes at once, as the pairing's claim (A9).
- **A broadcast is held** from Arming to On air. From Arming on, the engine has a `sid`, Home is hidden, and the Stop hold replaces Go live.
- **Arming** fetches the code's descriptor, which now carries the session's `sid` and credentials. Native parses it (_Who reads what_).
- **Armed** waits until the phone is ready (_Readiness_), then connects with no tap. The operator's own start reaches it only once ready, because Go live enables only then. A11's "stays paired" is read as this: a not-ready phone keeps its pairing and its `sid` in Armed, with Home hidden, rather than dropping back to Paired.
- **A broadcast ends back in Paired** for an organiser Stop, an "over" answer, a 410, a `waiting` answer or another `sid` while one is held, the hold window running out, or a start that failed. The code is still valid. Only the operator's Stop hold, a 401, a takeover (`replaced`, `taken`) and a refused permission leave the code.
- **Ended** follows only the operator's Stop and a permanent failure. `reset` leaves it for Idle, as today.
- Plan B's streaming rules — bitrate regulation, the SRT→RTMPS fallback, the stall watchdog, the hold window, the delivery watch, the session record — are unchanged; they run inside each broadcast exactly as before. Refused ingest still never ends a broadcast (plan B).

### Readiness (A11)

Native judges readiness, for every start: the operator's hold, the console's Go live, automatic mode and a rejoin. One gate, one authority.

| Check   | Ready when                                                                                    | Read from                                                        |
| ------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| camera  | our camera delivers frames (`camera` is `own`)                                                | the platform's frame counter, as plan B's `camera` already       |
| sound   | the audio level is at or above the floor                                                      | the mic's peak; the floor is one value shared with JS            |
| network | the network is validated                                                                      | `NET_CAPABILITY_VALIDATED`, as plan B                            |
| held    | the accelerometer reads the phone on its side, either way round; flat or upright is not ready | a native accelerometer reader, using JS's rule (one vector file) |

- **The floor and the pose rule are shared, not copied.** The audio floor (today `AUDIO_FLOOR`, a TS display selector) and the held-pose rule (`src/domain/orientation/`) each get one vector file read by both sides, as plan C's scrub does. JS keeps the meter's notch and the turn card; the chips and Go live read native's verdict from the snapshot.
- **On the viewfinder** the camera and mic are open, so readiness is current. The chips show camera, sound and network. There is no held chip: the turn card covers an upright phone, and a flat one shows the blocker "Turn the phone sideways".
- **With the phone locked or the app elsewhere**, the camera and mic are closed while waiting. A go-live opens them from the foreground service, then readiness is judged.
- **Not ready.** The engine stays Armed, keeps checking, shows the reason as the status line and in the notification, and sends `notReady` in every beat. The server's 10-minute no-signal timeout ends a broadcast that never gets ready (`over`, `no_inbound_timeout`), and the phone returns to Paired.
- **The encoded orientation** is the side the accelerometer reads when Armed turns to Connecting. It is fixed for the broadcast: `setTargetRotation` is never called while streaming (F-P5-6). The display's rotation is never read for it.
- **The side needs a sign.** JS's pose rule folds both landscape sides into one (`orientation.ts`), so the shared vector file adds the side (left or right) and pins it with cases for both. JS ignores the sign.
- **The dead band and `unknown`** read not ready, with the held line. **No accelerometer at all** never blocks, as JS's `watchPhysical` rule says: `held` reads ready, the side defaults to `ROTATION_90`, and the record gets a `no-accelerometer` line. Every phone at minSdk 31 that we know of has one; the rule exists so a missing sensor cannot make streaming impossible.

### Pairing, takeover and rejoin (A9, A10)

- **The phone's id.** Native makes a random id once per install and keeps it in app-private storage excluded from backup, so a restored phone is a new phone. It is not derived from hardware, and it is not a secret. Every beat carries it as `phone`.
- **The claim.** From `pair` until the pairing's first 2xx answer, every beat carries a claim; after it, `claim` is null. Its kind decides who holds the slot, and nothing else:
  - **`new`**: a scan, or the operator's tap on Continue. It takes the slot from another phone that is paired but not live, or that is live but dead (A14).
  - **`resume`**: the automatic re-pair at cold start (_Process death and reopen_). It keeps the slot only if this phone still holds it. From a phone that is no longer current it is answered `replaced`, never a takeover. So an old phone that died before it heard `replaced` cannot take the slot back from a newer pairing when it is reopened.
  - The same phone back after process death is not a takeover, whichever the kind.
- **What a claim does to the broadcast** is the same for both kinds: if the slot has an open broadcast, the answer names its `sid`, and the phone joins it (A10). A takeover reuses the open broadcast and its credit. No claim opens a new one.
- **A LIVE slot** (one that has received ingest) refuses a `new` claim with `taken` while its phone is alive. Its phone counts as dead once the server has had no beat from it and Cloudflare has reported the input not connected, both for 60 s (A14). A `new` claim then takes the slot and is answered `live` with the open `sid`: the new phone rejoins with no console visit.
- **The old phone** unpairs on `replaced`, in any phase, forgets the code, and Home reads "Paired on another phone". It forgets the code so that its next cold start has nothing to re-pair; the `resume` kind covers the case where it never heard `replaced`.
- **The new phone** on `taken` unpairs at once, forgets the code, and Home reads "This camera is live on another phone".
- **Rejoin (A10).** A paired phone holding no `sid` that hears `live` for its code and slot rejoins that broadcast: Arming, then Armed, then publishing once ready, with "Rejoining the live stream". That covers process death mid-match, a hold window that ran out while the server kept the broadcast open, and a takeover of a dead phone (A14). It never rejoins a `sid` it stopped (A17).

### Contract shapes

Names are negotiable until the web publishes the schemas in `docs/contracts/`; then we vendor them and they are frozen.

```
QR v2:      { v:2, code, slot, tok, exp? }

GET code    (Authorization: Bearer <tok>, Cache-Control: no-store) → one of:
  waiting:  { state:"waiting", code, label, venueTimezone, scheduledStart?, pollSeconds,
              autoAllowed, destinationName|null, overlayUrl|null, heartbeatUrl, startUrl }
  session:  { state:"warming"|"live"|"ending"|"completed"|"failed", endReason?, sid,   // endReason: the beat's vocabulary
              cred:{ srt:{url,streamId,passphrase,latencyMs}, rtmps:{url,streamKey} }, preferred,
              playbackUrl, overlayUrl|null, holdWindowSeconds:{srt,rtmps}, maxDurationMinutes,
              warmingDeadline, label, venueTimezone, scoreUpdates, autoAllowed, heartbeatUrl, startUrl }
  401 → the code is expired or revoked: forget it.   404 → not a stream code.   429 → Retry-After.
  410 → the broadcast is over (at a scan, a server fault: read as not valid).

POST start  (Bearer tok) { phone }
                         → 200 { sid }
                         | 409 already_live { sid, startedBy }  (take that broadcast over)
                         | 409 replaced  (this phone no longer holds the slot: unpair, as a beat's `replaced`)
                         | 409 no_destination | 402 no_credit | 403 not_entitled  (stay paired; show why)

POST beat   (Bearer tok) { code, slot, phone, claim:"new"|"resume"|null, sid|null, at,
              state:"paired"|"arming"|"armed"|"connecting"|"publishing"|"degraded"|"reconnecting"|"ended",
              cause:"organiser"|"automatic"|"operator"|"rejoin"|null,   // while a broadcast is held
              notReady:"camera"|"sound"|"network"|"held"|null,
              startFailed:"not-found"|"cred-host"|"config"|"start-error"|null,   // the last start, while paired
              stopped: sid|null,   // A17: only on a beat whose sid is null; a stopped sid, until delivered
              mode:"automatic"|"operator", transport, bitrateKbps, delivery, deliveredLagS, audioOk,
              battery, thermal, dataUsedMB, appVersion,
              endReason? }      // only "operator-stopped", only with state "ended" (A8)
         → 200 { state:"waiting"|"go-live"|"live"|"over"|"replaced"|"taken",
                 sid?,          // go-live, live, over
                 startedBy?,    // go-live: "organiser"|"automatic"|"operator"
                 endReason?,    // over: "stopped"|"auto_stopped"|"no_inbound_timeout"|"target_rejected"|"max_duration"
                 label, scheduledStart|null, autoAllowed, destinationName|null, overlayUrl|null,
                 pollSeconds }
         | 401 → the code ended.
         | 410 → the broadcast the beat names (its `sid`, or its `stopped`) is over.
         | anything else → counted; nothing changes (429's Retry-After delays the next beat).
```

- Times stay epoch seconds (`exp`, `warmingDeadline`, `scheduledStart`); `at` stays ISO-8601 UTC.
- **Spelling.** The phone's words are kebab-case and the server's snake_case, as each side already writes them. `"operator-stopped"` is A8's literal. `mode` says `"automatic"`, to match `cause` and `startedBy`. Both are negotiable until the schemas are published.
- `heartbeatUrl`, `startUrl` and `overlayUrl` must sit on the build's exact Seazn host, per environment (the existing rule). **New:** `cred` URLs must sit on that environment's ingest host (`live.seazn.club` or `live.stg.seazn.club`); a descriptor whose `cred` points anywhere else is refused.
- **`pollSeconds`** is taken from the latest 2xx answer, beat or descriptor, and clamped to 5–300 s. While a broadcast is held, beats go at least every 10 s (ruling 5's console health). A 429 delays the next beat by its Retry-After, within the same clamp.
- The descriptor is fetched at Arming, and on every reconnect (unchanged). The phone keeps the last session descriptor for the broadcast's life, so a reconnect at a wet ground never depends on reaching our API (register C1).
- `tok` is compared in constant time server-side and never echoed or logged on either side (unchanged). The descriptor carries publish secrets: no-store, never logged.

### Who reads what

The safest split that keeps AGENTS §2: **publish credentials exist only in native memory**, for one broadcast's life.

| Shape                     | Parsed by                                            | Why                                                                                                                 |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| QR v2                     | JS (`parseCaptureQr`), at the scan                   | the scan is JS's; it carries no publish secret                                                                      |
| `GET code` at the scan    | JS, the waiting fields only, whichever shape answers | Home's outcome lines. The JS type has no `cred` field, so a session-shaped answer is read without its credentials   |
| `GET code` at Arming      | native, the full session shape                       | a remote go-live lands with JS asleep (S1 decision 6's reason). Native publishes, so native alone ever holds `cred` |
| beat answer, `POST start` | native                                               | the engine acts on them                                                                                             |

- **`cred` never reaches JS, SecureStore or the bridge.** The saved code is the QR (`code`, `slot`, `tok`, `exp`), the waiting fields, and the three URLs a cold-start `pair` needs (`codeUrl`, `heartbeatUrl`, `startUrl`). It holds `tok`, as today, and no publish key. The snapshot carries only the session's non-secret fields.
- **The ingest-host rule** is implemented in native, where `cred` is read. The Seazn-host rule for `heartbeatUrl`, `startUrl` and `overlayUrl` runs on both sides, JS at the scan and native at `pair` and at Arming, against one shared vector file.
- **AGENTS §4's "a v2 contract touches one file"** still holds per shape: each wire shape has one parser, in one language. The session shape moves to native, and leaves `parseDescriptor`.
- **The record** protects `tok` from `pair`, and each broadcast's passphrase, stream id and stream key from Arming (plan B's `protect`, called earlier).

### One rule for the server's word

Plan B's `SessionOver` (final review M-4) keeps the heartbeat and the descriptor from disagreeing about a session. It is replaced by **`ServerWord`**, one rule over both sources, giving one verdict for the `sid` the engine holds.

| Source     | Answer                                                   | Verdict                                    |
| ---------- | -------------------------------------------------------- | ------------------------------------------ |
| descriptor | 2xx `session` shape with `ending`, `completed`, `failed` | `Over(sid, endReason)`                     |
| descriptor | 2xx `session` shape with `warming` or `live`             | `Open(sid)`                                |
| descriptor | 2xx `waiting` shape (cancelled before the fetch)         | `NoBroadcast`                              |
| beat       | `over`                                                   | `Over(sid, endReason)`                     |
| beat       | `go-live`                                                | `Open(sid, startedBy)`                     |
| beat       | `live`                                                   | `Open(sid, rejoin)`                        |
| beat       | `waiting`                                                | `NoBroadcast`                              |
| beat       | `replaced`, `taken`                                      | `Replaced`, `Taken`                        |
| either     | 410                                                      | `Over(the sid the call named, endReason?)` |
| either     | 401                                                      | `CodeEnded`                                |
| either     | 404                                                      | `NotFound`                                 |
| either     | anything else                                            | `NoEvidence` (counted, nothing changes)    |

- Against a held `sid` S: `Over(S)`, `NoBroadcast` and `Open(N ≠ S)` all mean S is over. `Open(S)` changes nothing. So the two sources cannot disagree about the same `sid`, and one vector file pins every row on both answers.
- **A 410** is `Over` from either source, as the web ruled for any code call and as plan B's merged rule and plan C Task 1's end-path test already treat a beat's 410. A beat names one broadcast at most: its `sid` while one is held, or its `stopped` (A17) while paired, never both. So a 410 to a beat that holds a `sid` always means that `sid` is over, and a 410 to a paired beat carrying `stopped` is that stop's delivery. A 410 to a beat that names neither changes nothing.
- **A `waiting`-shaped descriptor at Arming** means the organiser cancelled before the fetch: `NoBroadcast`, so S is over and the phone returns to Paired with "Stream stopped — waiting for Go live". It is never read as a bad config.
- **`NotFound`** is one verdict; what it costs depends only on the phase. At Arming it fails the start (S marked refused). Anywhere else, on a beat or a reconnect's fetch, it is counted like `NoEvidence`.

### The answer table

Every phase × every answer. "S" is the held `sid`; "N" another. The waiting fields and `pollSeconds` refresh on every 2xx answer, in every phase.

| Answer                                                | Paired (no sid)                                                                     | Arming or Armed (S)                                                                     | Connecting or On air (S)                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `waiting`                                             | nothing                                                                             | S is over: Paired, "Stream stopped — waiting for Go live"                               | S is over: end it, Paired, same line                                              |
| `go-live` N                                           | start N: Arming, cause `startedBy`                                                  | drop S's start; Arming for N                                                            | S is over (one open broadcast per slot): end it, then Arming for N                |
| `live` N                                              | rejoin N: Arming, cause `rejoin` (A10)                                              | as `go-live` N, cause `rejoin`                                                          | as `go-live` N, cause `rejoin`                                                    |
| `go-live` or `live` S                                 | —                                                                                   | nothing (a confirmation)                                                                | nothing                                                                           |
| `over` S                                              | —                                                                                   | Paired, the line for its `endReason`                                                    | end S, Paired, the line for its `endReason`                                       |
| `over` N                                              | nothing                                                                             | nothing                                                                                 | nothing                                                                           |
| `replaced`                                            | Idle, code forgotten, "Paired on another phone"                                     | drop the start, then the same                                                           | end S at once (the slot was not LIVE, or this phone was dead, A14), then the same |
| `taken`                                               | Idle, code forgotten, "This camera is live on another phone"                        | ignored (only a claim gets it)                                                          | ignored                                                                           |
| 401                                                   | Idle, code forgotten, "This code has ended. Scan the new one."                      | Arming: the same. Armed: kept until S ends, then the same                               | kept until S ends, then the same (expiry never ends a broadcast)                  |
| beat 410 naming S                                     | —                                                                                   | Paired, "Stream stopped — waiting for Go live"                                          | end S, Paired, the same line                                                      |
| 404 (`NotFound`)                                      | counted                                                                             | Arming: the start fails (_Start failures_). Armed: counted                              | counted                                                                           |
| 429, 5xx, no answer                                   | counted; 429 delays the next beat                                                   | the same                                                                                | the same                                                                          |
| descriptor 410 or over state                          | —                                                                                   | Paired, the line for its `endReason` (an organiser cancelled at once)                   | as today: end S, Paired                                                           |
| `POST start` 200 S                                    | Arming for S, cause `operator`                                                      | —                                                                                       | —                                                                                 |
| `POST start` 409 already_live                         | Arming for its `sid`, cause its `startedBy`                                         | its `sid` is S (the console's Go live raced the hold): nothing                          | —                                                                                 |
| `POST start` refusal                                  | stay Paired, the refusal line                                                       | —                                                                                       | —                                                                                 |
| `POST start` 404, 429, 5xx, none                      | stay Paired, "Couldn't start the stream — try again"; no retry (it spends a credit) | —                                                                                       | —                                                                                 |
| `POST start` 409 replaced                             | as a beat's `replaced`                                                              | —                                                                                       | —                                                                                 |
| a late `POST start` answer                            | —                                                                                   | 200 or 409 already_live naming S: nothing. Anything else: ignored, with no refusal line | —                                                                                 |
| `go-live` or `live` naming a refused or stopped `sid` | ignored (_Start failures_, A17)                                                     | ignored                                                                                 | ignored                                                                           |

- **"Kept until S ends"** (the 401 row): the broadcast runs on, and when it ends for any reason the engine goes to Idle with the unpair reason `code-ended` instead of Paired. "Live" for the 401 rule is everything from Armed to On air, once credentials are in hand: the web ruled that expiry never ends a broadcast.
- **`replaced` acts at once in every phase** (A9: the old phone unpairs). The server sends it only when the slot has received no ingest, or when the old phone was dead for 60 s and a new phone has taken the slot (A14). Either way the old phone is not the one reaching viewers, so it stops publishing at once.
- **A late `POST start` answer** happens when the hold's request was in flight and a beat's `go-live` arrived first. It never moves the engine and never shows a refusal.
- **A `session`-shaped answer at the scan** is not acted on by JS. JS saves the waiting fields and sends `pair`. The first beat is a claim, answered within a second: `go-live` or `live` starts or rejoins, `taken` unpairs. So an open broadcast is never left unclaimed.
- **The automatic start** fires once per match and slot: at match start, or on a late pairing (a phone that pairs while the match is in progress, before any broadcast has run), whichever comes first (A4, A16). The phone sees it as `go-live` with `startedBy: "automatic"`, and starts once ready (A11). It never fires after an organiser Stop (A12), and never restarts a broadcast that ended mid-match. A broadcast the server still holds open is rejoined (A10).
- **The automatic stop** still ends a broadcast restarted by hand after an organiser Stop (A15). The phone sees it as `over` with `auto_stopped`, and reads "Match finished — stream stopped".

### Start failures

A start that fails never loops all day, and never leaves the screen silent.

| Failure                                | Engine                                                      | Beat                         | Retry                                                         | Status line                                    |
| -------------------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| descriptor unreachable or timed out    | stays Arming                                                | `arming`                     | spaced 10 s apart (plan B's `DescriptorAsks`)                 | "Starting — can't reach Seazn, retrying"       |
| descriptor 429                         | stays Arming                                                | `arming`                     | after Retry-After, clamped to 300 s                           | the same                                       |
| descriptor 401                         | Idle, code forgotten                                        | —                            | none                                                          | Home: "This code has ended. Scan the new one." |
| descriptor 404                         | Paired; S marked refused                                    | `startFailed: "not-found"`   | not for S; the next `sid` or the operator's hold starts again | "Couldn't start the stream — try again"        |
| descriptor 410, or an over state       | Paired                                                      | `paired`                     | —                                                             | the line for its `endReason`                   |
| descriptor `waiting` shape             | Paired (`NoBroadcast`); S not marked refused                | `paired`                     | —                                                             | "Stream stopped — waiting for Go live"         |
| `cred` on a foreign host               | Paired; S marked refused; a `cred-host-refused` record line | `startFailed: "cred-host"`   | not for S                                                     | "Couldn't start the stream — try again"        |
| `SessionConfig.problems()` not empty   | Paired; S marked refused                                    | `startFailed: "config"`      | not for S                                                     | "Couldn't start the stream — try again"        |
| `POST start`: no answer, 404, 429, 5xx | stays Paired                                                | `startFailed: "start-error"` | none on its own (it spends a credit); the next hold           | "Couldn't start the stream — try again"        |
| not ready                              | stays Armed                                                 | `notReady`                   | checks continuously                                           | "Can't go live yet — {reason}"                 |
| a permanent failure (_below_)          | Ended `fatal-error`; the pairing ends                       | none after it                | none                                                          | the Ended block                                |

- **A refused `sid` is not retried from beat answers.** The server keeps answering `go-live` S while S stays open; the engine ignores S until a new `sid` or the operator's hold. That is a guard with a test and a mutation.
- **The start-failed line** shows until the next start, of any cause, or the end of the pairing.

### Permanent failures and permissions

- **Permissions are asked at `pair`**, before the foreground service starts (plan C CD16 and CD21, moved from arm to pair). A refusal of camera or microphone does not pair: the engine goes to Idle with the unpair reason `permissions`. JS forgets the code it saved at the scan, and Home shows CD21's line, "Allow the camera and microphone in Android Settings, then try again". A refused permission is not sticky: the next `pair` asks again. A refused notification permission blocks nothing.
- **A permanent failure ends the pairing.** A `LinkageError` or an unconfigurable codec (CD11) sends the engine to Ended `fatal-error` from any phase, with no further beats, so no go-live can loop against it. The code is kept (S1 §5 stands), marked **`tapToPair`** (_Process death and reopen_). The Ended block shows the failure. Only the operator's tap on Continue re-pairs it: no cold start or foreground does.
- **The absent engine** (plan C CD23: no native module) answers `pair` with Ended `fatal-error` naming the code, and `reset` with Idle. It ignores everything else.

### The final beat (A8)

New core work. On `stop` from a broadcast whose first encoded frame went out, the core emits one `PostHeartbeat` `{sid, state:"ended", endReason:"operator-stopped"}`, with the pairing's URL and `tok`, beside `Command.End`. `End` stops capture and publishing at once. There is no retry of that beat. A stop before the first frame, and every other end, sends nothing at the moment of the stop. A17's memory, below, is what reaches the server later.

### The operator's Stop wins (A17)

- **What is kept.** On every operator `stop` from Arming on, live or not, native writes a **stopped record** `{code, slot, sid, stoppedAt, keepUntil}` before `Command.End`. `keepUntil` is `stoppedAt` plus the broadcast's `maxDurationMinutes`: after that the broadcast cannot still be open. A Stop before the descriptor has answered (in Arming, while "Starting — can't reach Seazn, retrying") has no `maxDurationMinutes`; its `keepUntil` is `stoppedAt` plus **`StoppedRecord.DEFAULT_KEEP_MS`, 12 h**, a named constant in the core. S1 sets no cap of its own (the descriptor's value is the only one), so 12 h is chosen: longer than any match broadcast we expect, so the record cannot lapse while the broadcast might be open, and short enough that a stale record ignores one dead `sid` for an afternoon at most. A test pins it and a mutation must fail it. One record per code and slot; a newer Stop on the same code and slot replaces it.
- **Where it lives.** In native app-private storage, beside the phone's id, excluded from backup, written synchronously. Not in JS: JS forgets the code at the Stop (A3), and the record must outlive both that forget and the process. It holds a `sid`, which is not a secret, and no `tok`.
- **On the next pairing** of the same code and slot, every paired beat — one that holds no `sid` — carries `stopped: sid` until it is delivered. A beat that holds a `sid` never carries it, so no answer can be read as being about two broadcasts. A paired beat always comes again: every pairing starts Paired, and every broadcast ends back in Paired or ends the pairing. While the record exists, a `go-live` or `live` naming that `sid` is ignored: the phone never rejoins it, and waits in Paired for a fresh Go live (a new `sid`). The engine's in-memory refused `sid`s also gain it, so a server that still names it after delivery is ignored for the pairing's life.
- **Delivered** means a 2xx or a 410 to a beat that carried it. The server closes the `sid` if it is still open, and answers 200 as a no-op if it has already ended or a newer `sid` exists (web ask 7). The record is then deleted.
- **Not delivered** — a 404, 429, 5xx or no answer — keeps the record. It rides every paired beat of that pairing, then of any later pairing of the same code and slot, until delivered or until `keepUntil` passes. A 401 for its code also deletes it: the code is dead, and the server's no-signal timeout or the organiser closes the broadcast.
- **Cleared** by delivery, by a 401 for its code, or at startup once past `keepUntil`. Nothing else clears it.
- A8 still governs the moment of the Stop. A17 makes the stop reach the server later even when A8 sent nothing (a stop before the first frame) or its one beat was lost. It is sent on the next pairing only, never on its own.

### Beats while locked

- **The partial wake lock covers the whole pairing.** It is taken with the foreground service when Pairing turns to Paired. It is released with the service: at an unpair, at Ended, or, after an operator Stop from a live broadcast, when A8's final beat answers or after 10 s (`Heartbeat.TIMEOUT_MS`), whichever is first. While it is held, the scheduler's `uptimeMillis` and the clock's `elapsedRealtime` cannot drift apart, so beats keep their cadence with the screen off (plan C CD10, widened from the session to the pairing).
- **The evidence is in the record:** `tick-late {gapMs}` lines (CD33) and the beat lines. A phone that slept says so.
- **Network in Doze** for a foreground-service process is a device-only claim. It is proven at the device gate with `adb shell dumpsys deviceidle force-idle` and the screen off for 30 min, reading the beat lines.

### Process death and reopen

- **Native is the authority while its process lives.** JS's saved code is the cold-start memory only.
- **The automatic re-pair runs once, at cold start** — when JS starts and finds the engine Idle — and never at a later foreground. That is ruling 3 and R2's "re-arms without a rescan", for a pairing. Its claim is `resume` (_Pairing, takeover and rejoin_), and its answer decides: `live` rejoins (A10), `go-live` starts, `waiting` waits, `replaced` unpairs. It runs only when all of these hold:
  - the saved state's `active` mode is `stream`;
  - a stream code is saved and unexpired;
  - the code is not marked `tapToPair` (a permanent failure, below);
  - the snapshot's `unpaired` does not name it (a forget still landing).
- **Why only at cold start.** While the process lives, native holds the pairing, so an Idle engine in a living process means the pairing was ended on purpose or by the server. A foreground is also not a reliable signal: React Native reports `background` on `onHostPause`, and the system's permission dialog pauses the activity, so closing the dialog would read as a foreground and send a second `pair`.
- **Every other `pair` is the operator's:** a scan, or a tap on Continue. Each claims `new`. Nothing else sends `pair`.
- **A visit never pairs.** Reaching `/stream` — by a reopen through `reopenTarget`, a route rule, or Back — sends no intent. The cold-start reopen needs no tap, so its one `pair` is the re-pair above, claiming `resume`, and never `new`. A replaced phone that is reopened therefore hears `replaced` and stays unpaired: nothing on the viewfinder can send a second, `new` claim behind it.
- **`pair` is idempotent.** Native ignores a `pair` for the code, slot and `tokenTag` it is already Pairing or Paired on: a second one while the permission dialog is up asks nothing twice.
- **`tapToPair`.** When the snapshot shows Ended `fatal-error` for the saved code, JS marks it `tapToPair`. The automatic re-pair skips such a code; only Continue re-pairs it, and the mark is cleared once the snapshot shows that code Paired.
- **A7's confirm forgets the stream code** after its `unpair` lands, as the operator's Stop does. Unpairing means a rescan to come back, so no foreground can pull the operator out of Remote Scoring into `/stream`.
- **An orphan:** a paired engine with no saved code is unpaired (`orphanedSession` extended). A held broadcast is never an orphan: the route rule shows it, and only the operator's Stop ends it.
- **`reopenTarget`:** a held broadcast always reopens into `/stream`, and a paired engine does, as an armed one did. An Idle engine reopens into `/stream` only at cold start, and only when the `resume` re-pair was sent. Any other Idle engine with a saved code goes Home, to the Continue card.
- **What the operator sees after a cold-start reopen:**
  - the re-pair sent: the viewfinder with "Pairing this phone…", then the claim's answer — the paired lines (§2), "Rejoining the live stream" for `live`, a starting line for `go-live`;
  - the claim answered `replaced`: Home, the code forgotten, the panel "Paired on another phone" (the same for `taken`, 401 and a refused permission, with their own panels);
  - no re-pair sent (`tapToPair`, another active mode, an expired code, or a forget still landing): Home, with the Continue card when a code is still saved, or the expiry notice for an expired one.
- **The route follows a broadcast.** While the engine holds a broadcast, the app shows `/stream`, whatever screen it was on. That is a rule on the snapshot's state, run on every state change and not only at launch, so a remote go-live never leaves Home on screen during a broadcast (AGENTS §6).
- The foreground service stays `START_NOT_STICKY`. A sticky restart from the background could not regain the camera, so recovery is the foreground re-pair above. An OEM kill during a long wait is on the device gate.

### The engine port

What JS sends, and what it reads. JS never derives any of it by comparing snapshots.

**Intents** (each returns void; native ignores one that does not fit its phase, with an `intent-ignored` record line):

| Intent                                                                                 | From                                                            | Native does                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair(code, slot, token, codeUrl, heartbeatUrl, startUrl, language, automatic, claim)` | the scan or Continue (`new`); the cold-start re-pair (`resume`) | Idle: Pairing (permissions), then the service, the wake lock, Paired and the claim. Pairing or Paired on the same code: nothing (idempotent). Paired on another: unpair, then pair. Holding a broadcast: ignored |
| `start`                                                                                | the operator's Go live hold                                     | Paired and ready: `POST start`. Otherwise ignored                                                                                                                                                                |
| `stop`                                                                                 | the operator's Stop hold                                        | holding a broadcast: end it (A8's beat if it was live), Ended `operator-stopped`; the pairing ends. Otherwise ignored                                                                                            |
| `unpair`                                                                               | Forget, A7's confirm, an orphan clear                           | Paired: Idle. Holding a broadcast: ignored, so it can never end one                                                                                                                                              |
| `reset`                                                                                | Ended's Scan another and Home                                   | Ended: Idle                                                                                                                                                                                                      |
| `setAutomatic(on)`                                                                     | the Settings switch, at once                                    | the next beat's `mode`; echoed in the snapshot                                                                                                                                                                   |
| `setLanguage(language)`                                                                | the language picker                                             | the notification's language, from the next update                                                                                                                                                                |
| `switchCamera`                                                                         | reserved (plan C CD29)                                          | as plan C                                                                                                                                                                                                        |

`arm` goes: native arms itself. The camera opens while the native preview view is attached and the app is in the foreground, Settings and Diagnostics included, so no intent is needed for it.

**The snapshot** gains, beside plan A's fields:

| Field              | Shape                                                                                                                            | Set                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.kind`       | adds `pairing`, `paired` and `arming`                                                                                            | always                                                                                                                                              |
| `pairing`          | `{code, slot, tokenTag, automatic, label, venueTimezone, scheduledStart, autoAllowed, destinationName, overlayUrl, pollSeconds}` | from `pair` until `reset` or Idle; replaces the top-level `slot` and `tokenTag`                                                                     |
| `broadcast`        | `{sid, cause, playbackUrl, overlayUrl, label, holdWindowSeconds, maxDurationMinutes, scoreUpdates}`                              | while a broadcast is held, and in Ended; replaces `descriptor`                                                                                      |
| `ready`            | `{camera, sound, network, held}`, booleans                                                                                       | always; false when unknown                                                                                                                          |
| `refusal`          | `no_destination`, `no_credit`, `not_entitled`, `start-failed`, or null                                                           | until the next start or the end of the pairing                                                                                                      |
| `lastEnd`          | why the last broadcast ended, or null                                                                                            | in Paired after a broadcast, until the next start                                                                                                   |
| `unpaired`         | `{reason: code-ended \| replaced \| taken \| permissions, code, slot, tokenTag}` or null                                         | in Idle after an unpair the operator did not ask for, until the next `pair`                                                                         |
| `codeEndedPending` | boolean                                                                                                                          | a 401 seen while a broadcast is held. No HUD line: Diagnostics' heartbeat row shows the 401, and the "Code ended" panel follows the broadcast's end |

- Times cross the bridge as epoch seconds, and the JS mapping makes them `Date`s. The opaque descriptor echo (plan C CD5) goes.
- **`lastEnd`** is one of `stopped-by-organiser`, `stopped-automatically`, `no-signal`, `destination-refused`, `max-duration`, `hold-window-expired`, `stopped`. The server's `endReason` maps onto the first five; `stopped` is any other.
- **JS forgets the saved code** when `unpaired` names it, or when the snapshot is Ended `operator-stopped` for it. The rule is idempotent: it compares identities, not two snapshots.
- `EngineStatus` (`src/domain/mode/reopen.ts`) gains `paired`; `live` there covers every phase that holds a broadcast.

### Identity rules in JS

A code is the same code when its `code`, `slot` and `tokenTag` all match (plan A's `sameCode`, moved from the session to the pairing).

| Situation                                        | JS does                                                                                                                                                                                                            | Source             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| the same code scanned while paired               | adopt: open `/stream`; no intent                                                                                                                                                                                   | plan A, by analogy |
| another code, or another slot, while paired      | save the new code, send `pair` (native unpairs first), silently                                                                                                                                                    | plan A batch 9 I1  |
| a code scanned while a broadcast is held         | cannot happen: Home is hidden                                                                                                                                                                                      | AGENTS §6          |
| Forget on the Continue card                      | `unpair`; forget the code once the snapshot is Idle. If a broadcast became held instead (a remote go-live raced the tap), keep the code; the route rule shows `/stream`. Bounded at 5 s, as plan A's disarm (CD26) | plan A Final I1    |
| a second scan while a `pair` is in flight        | the later scan wins; native applies the intents in order                                                                                                                                                           | the four questions |
| a scoring or dashboard code scanned while paired | one sheet: A7's confirm, which also offers the switch (ruling 2). Confirm unpairs and forgets the stream code, reconciled as Forget is                                                                             | A7, ruling 2       |

## 2. Screens and copy

English shown. Every string ships in en/es/fr/nl, checked against `docs/i18n-glossary.md`, with no `_review` marker (CI enforces it). Status lines stay within the 48-character budget (`budgets.test.ts`), and `{destination}` is counted at 24 characters.

- **Home.** While paired, the Continue card reads **"Paired · {label}"** with **"Waiting for Go live"**. Tapping it opens the viewfinder. While a broadcast is held, Home is hidden.
- **Viewfinder, paired** (replaces the Arm state of S1 §1):
  - live preview, with the scorebug over it from `overlayUrl` when the server gives one (S1 decision 8 kept);
  - **"Starts {time}"** in the venue's zone under the label, when `scheduledStart` is present;
  - an **AUTO** chip when automatic mode is on at both ends (`autoAllowed` and the phone's switch); nothing otherwise;
  - the pre-flight chips camera, sound and network, from native's `ready`. The code chip and the "Go live by" line go: a waiting code has no warming deadline, and a dead code now unpairs (401);
  - the **Go live** 3 s hold, in both modes. It enables only when native reports ready. A flat phone shows the blocker **"Turn the phone sideways"**.
  - The screen is kept awake while the viewfinder shows a paired or held engine, as Arm was.
- **The paired status line**, first match wins:
  1. a refusal (below);
  2. the last broadcast's end (below);
  3. **"Waiting for the organiser to pick a destination"** when `destinationName` is null;
  4. **"Waiting for Go live · {destination}"**, the name cut to 23 characters plus "…" past 24.
- **Start refused** (stays paired):
  - `no_destination`: **"Ask the organiser to pick where to stream"**
  - `no_credit`: **"No streaming credit — ask the organiser"**
  - `not_entitled`: **"Streaming isn't included for this club"**
  - no answer, 404, 429, 5xx, a foreign `cred` host, a bad config: **"Couldn't start the stream — try again"**
- **Starting** (Arming and Armed; the action column shows Stop from Arming on, and never Go live):
  - the console's Go live: **"Going live — started by the organiser"**;
  - automatic mode, at match start or on a late pairing (A16): **"Going live — the match has started"**;
  - a rejoin: **"Rejoining the live stream"**;
  - the operator's hold: plan A's "Opening the link.";
  - the descriptor unreachable: **"Starting — can't reach Seazn, retrying"**;
  - not ready: **"Can't go live yet — the camera isn't ready"**, **"… — no sound from the mic"**, **"… — no network"**, **"… — turn the phone sideways"**.
  - Then the Live HUD as built.
- **Live:** unchanged, except the Stop hold's screen-reader label becomes **"Hold to stop and unpair"**.
- **After a broadcast ends without the operator** (back in Paired; the line stays until the next start):
  - organiser Stop: **"Organiser stopped it — waiting for Go live"**;
  - automatic stop: **"Match finished — stream stopped"**;
  - the hold window ran out: **"Connection lost too long — stream stopped"** (a rejoin follows if the server kept it open);
  - the no-signal timeout: **"No picture reached Seazn — stream stopped"**;
  - the maximum duration: **"Stream reached its time limit"**;
  - the destination refused it: **"The destination refused the stream"**;
  - any other: **"Stream stopped — waiting for Go live"**.
- **The operator's Stop:** the Ended state as built, plus **"Scan the code again for the next broadcast"**; the code is forgotten. A rescan waits for a fresh Go live: the stopped broadcast never resumes (A17).
- **A permanent failure:** the Ended state as built ("Something failed. Your code is kept."). A permission revoked mid-pairing needs no line here: Android kills the process, so the cold-start re-pair meets the refusal and shows the Home panel below.
- **Unpaired without asking** — back to Home, the code forgotten, a code panel:
  - 401: **"Code ended"** / **"This code has ended. Scan the new one."**
  - `replaced`: **"Paired on another phone"** / **"This code is now paired on another phone. Scan it again to use this one."**
  - `taken`: **"Already live"** / **"This camera is live on another phone."**
  - permissions: **"Camera and microphone needed"** / CD21's **"Allow the camera and microphone in Android Settings, then try again"**
- **Pairing:** **"Pairing this phone…"** while the snapshot is Pairing (the permission dialog may be up).
- **Settings:** a new switch **"Start and stop automatically"**, on by default, captioned **"Only when the organiser turns it on for the match"**. It sends `setAutomatic` at once. It stays usable on air, the one named exception to AGENTS §6's rule: it only affects the automatic stop.
- **Another mode while paired:** one confirm sheet, **"This phone is paired for streaming. Opening {mode} unpairs it."**, with **Unpair & open** and **Cancel**. It closes, as Cancel, if the engine leaves Paired while it is open; `unpair` is ignored once a broadcast is held.
- **Android notification**, in the operator's current language (plan C ruling P3, now updated by `setLanguage`):
  - paired: **"Paired · waiting for Go live"**;
  - Arming and Armed: the `STARTING` tally word, with the status line when not ready;
  - connecting and live: as plan C, `LIVE · 3000k · 47 min`.

**The Home outcome table** of S1 §1 becomes:

| Outcome                              | Home shows                                                        |
| ------------------------------------ | ----------------------------------------------------------------- |
| 200 `waiting` or `session`           | the code and its waiting fields are saved; `/stream`, then `pair` |
| 401 / 404, or a 410 (a server fault) | "This code isn't valid for streaming."                            |
| No network / timeout                 | "Can't check this code — no connection. Try again."               |
| 429                                  | "Busy — trying again in {n}s", using Retry-After                  |

The two 410 lines ("This stream was ended by the organiser", "This code timed out…") go. `DescriptorError.ended` stays, read as not valid.

### New strings

Lengths are English, counted as `budgets.test.ts` counts. Key names are proposals for the plan.

| Key                                | English                                                                                            | Length | Budget |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | -----: | -----: |
| `stream.status.waitingGoLive`      | Waiting for Go live · {destination}                                                                |    46¹ |     48 |
| `stream.status.waitingDestination` | Waiting for the organiser to pick a destination                                                    |     47 |     48 |
| `stream.status.refusedDestination` | Ask the organiser to pick where to stream                                                          |     41 |     48 |
| `stream.status.refusedCredit`      | No streaming credit — ask the organiser                                                            |     39 |     48 |
| `stream.status.refusedEntitlement` | Streaming isn't included for this club                                                             |     38 |     48 |
| `stream.status.startFailed`        | Couldn't start the stream — try again                                                              |     37 |     48 |
| `stream.status.startRetrying`      | Starting — can't reach Seazn, retrying                                                             |     38 |     48 |
| `stream.status.goingLiveOrganiser` | Going live — started by the organiser                                                              |     37 |     48 |
| `stream.status.goingLiveMatch`     | Going live — the match has started                                                                 |     34 |     48 |
| `stream.status.rejoining`          | Rejoining the live stream                                                                          |     25 |     48 |
| `stream.status.notReadyCamera`     | Can't go live yet — the camera isn't ready                                                         |     42 |     48 |
| `stream.status.notReadySound`      | Can't go live yet — no sound from the mic                                                          |     41 |     48 |
| `stream.status.notReadyNetwork`    | Can't go live yet — no network                                                                     |     30 |     48 |
| `stream.status.notReadyHeld`       | Can't go live yet — turn the phone sideways                                                        |     43 |     48 |
| `stream.status.stoppedOrganiser`   | Organiser stopped it — waiting for Go live                                                         |     42 |     48 |
| `stream.status.stoppedMatch`       | Match finished — stream stopped                                                                    |     31 |     48 |
| `stream.status.stoppedHoldWindow`  | Connection lost too long — stream stopped                                                          |     41 |     48 |
| `stream.status.stoppedNoSignal`    | No picture reached Seazn — stream stopped                                                          |     41 |     48 |
| `stream.status.stoppedMaxDuration` | Stream reached its time limit                                                                      |     29 |     48 |
| `stream.status.stoppedRefused`     | The destination refused the stream                                                                 |     34 |     48 |
| `stream.status.stopped`            | Stream stopped — waiting for Go live                                                               |     36 |     48 |
| `stream.status.pairing`            | Pairing this phone…                                                                                |     19 |     48 |
| `stream.blocker.held`              | Turn the phone sideways                                                                            |     23 |     24 |
| `stream.chip.auto`                 | Auto                                                                                               |      4 |     10 |
| `stream.startsAt`                  | Starts {time}                                                                                      |    17² |     32 |
| `stream.action.stopUnpairLabel`    | Hold to stop and unpair                                                                            |     23 |      — |
| `stream.ended.scanAgain`           | Scan the code again for the next broadcast                                                         |     42 |      — |
| `stream.settings.automatic`        | Start and stop automatically                                                                       |     28 |      — |
| `stream.settings.automaticCaption` | Only when the organiser turns it on for the match                                                  |     49 |      — |
| `stream.notification.paired`       | Paired · waiting for Go live                                                                       |     28 |      — |
| `home.continue.paired`             | Paired · {label}                                                                                   |      — |      — |
| `home.continue.waiting`            | Waiting for Go live                                                                                |     19 |      — |
| `panel.codeEnded.title` / `.body`  | Code ended / This code has ended. Scan the new one.                                                |      — |      — |
| `panel.replaced.title` / `.body`   | Paired on another phone / This code is now paired on another phone. Scan it again to use this one. |      — |      — |
| `panel.taken.title` / `.body`      | Already live / This camera is live on another phone.                                               |      — |      — |
| `panel.permissions.title`          | Camera and microphone needed (body: CD21's string)                                                 |      — |      — |
| `sheet.unpair.body`                | This phone is paired for streaming. Opening {mode} unpairs it.                                     |      — |      — |
| `sheet.unpair.confirm` / `.cancel` | Unpair & open / Cancel                                                                             |      — |      — |

¹ With `{destination}` at its 24-character cap. `budgets.test.ts` gains `destination` in `WIDEST`, 24 characters wide.
² With `{time}` at `WIDEST`'s "14:32 CEST", under the `stream.goLiveBy` row it replaces.

## 3. What changes where

All of it is folded into **plan C**, renamed _plan C — platform, bridge and stable code_: one branch (`feat/s1-plan-c`), one review chain, one device gate. Plan D is unchanged in role and still waits on the web's published schemas. Plan C is rewritten, not prepended to: its task count is re-counted then, and is not estimated here.

- **The core (plan B, merged)** — a new first batch, ahead of plan C's C1:
  - `Phase.Pairing`, `Phase.Paired` and `Phase.Arming`; a `Pairing` (code, slot, token, URLs, phone id, automatic, language, the waiting fields) held from `pair` to Idle or Ended, with each broadcast's `Session` inside it;
  - intents `pair`, `start` (now `POST start` from Paired; Armed connects on its own once ready), `stop`, `unpair`, `reset`, `setAutomatic`, `setLanguage`; inputs for a beat's answer, a start's answer, the readiness facts and the accelerometer's side;
  - `ServerWord` replaces `SessionOver`, with one vector file for both sources, including a beat's 410, a `waiting`-shaped descriptor and `NotFound`;
  - the claim's kind (`new`, `resume`), `pair` idempotent, and the stopped record (A17) in app-private storage with its delivery and `keepUntil` rules;
  - the heartbeat moves from the session to the pairing: `sid` null while paired, `phone`, `claim`, `mode`, `cause`, `notReady` and `startFailed` in every beat; `pollSeconds` clamped, and at least every 10 s while a broadcast is held;
  - readiness judged natively, with the audio floor and the pose rule from shared vector files;
  - A8's final beat, with the service released after it (_The final beat_);
  - the refused-`sid` guard, the 401 deferral, and `unpair` ignored while a broadcast is held;
  - the record protects `tok` from `pair`. Beat lines while paired are written only when the answer or the result changes, so hours of waiting cost a few lines. One record per pairing, with each broadcast between `broadcast-start {sid, cause}` and `ended`;
  - tests for every row of the answer table and the start-failure table, the four questions, and a mutation per guard: the `pollSeconds` clamp, the same-`sid` no-op, the refused-`sid` guard, the claim flag and its kind, `pair`'s idempotence, the stopped record (never rejoined, kept until delivered, dropped past `keepUntil`, `DEFAULT_KEEP_MS` when no descriptor answered, sent only on paired beats), a visit that never pairs, a beat's 410, the 401 deferral, `unpair` while held, the readiness gate and its no-accelerometer rule, the ingest-host check, the final beat's only-if-live rule.
- **The JS (plan A, merged)** — folded into plan C's C5 and widened:
  - the QR parser for `{v:2, code, slot, tok, exp?}`; the scan's `GET code` parsed to its waiting fields, with no `cred` in the type; the Seazn-host check on the shared vectors. `StreamSession` and the session-shape parsing leave JS;
  - the saved code: the QR, the waiting fields and the three URLs, plus the `tapToPair` mark;
  - identity by code, slot and `tokenTag` on the pairing; the adopt, replace, leave and reopen rules per _Identity rules in JS_ and _Process death and reopen_: the cold-start-only `resume` re-pair and its four conditions, `tapToPair`, A7's confirm forgetting the code, Forget reconciled against a racing go-live; the route rule for a held broadcast;
  - Home's Continue card and panels, the paired viewfinder, every line in §2, the Settings switch and its persisted value, the one confirm sheet, the operator's Stop forgetting the code;
  - the fake engine gains the paired phase and scripted beat answers; `test/engineContract.ts` gains the pair, start, takeover, rejoin and unpair scenarios, and the arm-from-idle scenarios become pair-then-go-live.
- **Plan C decisions rewritten:**

| Plan C | Today                                                                    | Becomes                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CD5    | the session's name on `SessionConfig`; the descriptor JSON echoed opaque | the name is the pairing's (code, slot, `tokenTag`). No descriptor echo: the snapshot's `broadcast` holds the non-secret fields. Carries 2 and 4 are rewritten with it           |
| CD6    | the JS "in hand" rule from the viewfinder's arm                          | from the scan to the unpair                                                                                                                                                     |
| CD7    | one record while a session exists                                        | while a pairing exists                                                                                                                                                          |
| CD10   | the wake lock from arm to End                                            | from `pair` to unpair or Ended                                                                                                                                                  |
| CD11   | a refused permission is sticky                                           | a refused permission at `pair` does not pair and is asked again at the next `pair`; linkage and codec failures stay sticky, and end the pairing                                 |
| CD16   | the service starts at an accepted arm; the arm's language                | at an accepted `pair`, after permissions, with the paired notification; the language from `pair`, then `setLanguage`                                                            |
| CD18   | the keep-open advisory while armed or on air                             | while paired or holding a broadcast                                                                                                                                             |
| CD21   | permissions asked at arm; the line in the Ended block                    | asked at `pair`; the line on a Home panel. A revocation kills the process, so it reaches the same panel through the cold-start re-pair                                          |
| CD22   | the session marker written at arm                                        | written at `pair`                                                                                                                                                               |
| CD23   | the absent engine answers `arm`                                          | answers `pair` with Ended `fatal-error`                                                                                                                                         |
| CD26   | the disarm bound                                                         | the unpair bound                                                                                                                                                                |
| CD27   | one streamer per armed session, built at arm; rotation from the display  | the camera and mic open while the preview is attached, or at a go-live; encoders and endpoint per broadcast; rotation from the accelerometer when Armed turns to Connecting     |
| CD31   | `platform.armed(config)` on a new session                                | `platform.paired(pairing)` on a new pairing (service, permissions, wake lock), and `platform.armed(config)` on each broadcast; a throw from either ends the pairing fatal-error |

- **Plan C's other changes:** a `POST start` adapter; 401 and 410 handled apart; the accelerometer adapter; the descriptor parser in native, with the ingest-host check.
- **Pre-flight:** plan C's 12 pre-flight mismatches (P1–P12) are re-checked against the revised plan.

### The device gate: plan C, and what waits for plan D

Plan C's device run has no real web: its heartbeat URL points nowhere real (plan C Task 26). So plan C adds a **scripted code server**, debug builds only: a platform stand-in that answers `GET code`, beats and `POST start` from a script file pushed with `adb`. The session descriptor's credentials are the raw stg input's, written by the owner on the owner's laptop with the `live.stg.seazn.club` host. The file is copied into the app's private storage with `adb shell run-as`, never left on `/sdcard`, never committed, and deleted from the phone and the laptop after the run. A release build carries none of it, and a `GlueRulesTest` rule checks that.

| Check                                                                                                              | Where                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| beats keep their cadence for 30 min, screen off, `dumpsys deviceidle force-idle`                                   | plan C, release build (beats fail and are counted) |
| battery while paired for 60 min at a 60 s cadence                                                                  | plan C, release build                              |
| a scripted go-live reaches a locked phone: the camera and mic open, readiness passes, it publishes                 | plan C, debug build                                |
| the encoded orientation follows the side held, with the screen locked (`ffprobe` rotation)                         | plan C, debug build                                |
| a go-live with the phone upright: `notReady: "held"` in the beat and the notification; turned, it publishes        | plan C, debug build                                |
| a go-live while another app holds the camera: not ready, camera; no slate                                          | plan C, debug build                                |
| a scripted `over`, then a second `go-live` on the same code                                                        | plan C, debug build                                |
| each `POST start` refusal, and a foreign `cred` host                                                               | plan C, debug build                                |
| `replaced` and `taken` reach Home with their panels                                                                | plan C, debug build                                |
| a kill while live, then a reopen: re-pair (`resume`), `live`, rejoin                                               | plan C, debug build                                |
| a `resume` claim answered `replaced`: Home's panel, no takeover                                                    | plan C, debug build                                |
| the permission dialog: one prompt, one `pair`; a refusal, then a foreground, prompts nothing                       | plan C, debug build                                |
| A17: Stop, rescan; the claim carries `stopped`; a scripted `go-live` naming it is ignored                          | plan C, debug build                                |
| A7's confirm, then a foreground in Remote Scoring: no re-pair, no `/stream`                                        | plan C, debug build                                |
| an OEM background kill during a long wait (OnePlus)                                                                | plan C, release build                              |
| the console's Go live and Stop, with the phone locked                                                              | plan D, staging                                    |
| the real start gates: credit, entitlement, destination                                                             | plan D, staging                                    |
| automatic mode at a real match start and stop; A12 after an organiser Stop                                         | plan D, staging                                    |
| two real phones on one code and slot (A9); a dead live phone taken over after 60 s (A14)                           | plan D, staging                                    |
| a late pairing in a running match starts automatically once (A16); the automatic stop after a manual restart (A15) | plan D, staging                                    |
| a late stop closes only its `sid` (A17, web ask 7)                                                                 | plan D, staging                                    |
| the server keeping a broadcast open after a hold window (A10)                                                      | plan D, staging                                    |
| the cadence moving from 60 s to 10 s; SRT on the custom ingest host                                                | plan D, staging                                    |

### Device-only claims

Settled only on a phone, and each report says so:

- camera and microphone access from a locked phone, under a foreground service started at pairing (Android's while-in-use rule);
- network access and the partial wake lock in Doze, for a foreground-service process;
- the accelerometer delivering with the screen off while the wake lock is held;
- an OEM kill during a long wait;
- battery over a long wait;
- what a remote start does with another app holding the camera.

## What this changes in S1

| S1 part                                                       | Now                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision 4, the QR shape                                      | replaced by A1                                                                                                                                            |
| Decision 5, beats "while armed or live"                       | replaced: beats for the whole pairing                                                                                                                     |
| Decision 8, the overlay while framing                         | kept, through the waiting shape's `overlayUrl`                                                                                                            |
| Decision 9, an organiser stop learnt "from refused ingest"    | replaced: only from the beat and descriptor answers (plan B already ruled refused ingest does not end a session)                                          |
| §1 _Getting in_, the outcome table                            | replaced by §2's table                                                                                                                                    |
| §1 the Arm state                                              | replaced by Paired. The warming gate, the code chip and "Go live by" are dropped; the chips are native's verdict                                          |
| §1 _Ended_                                                    | kept for the operator's Stop and a permanent failure only. Every other end returns to Paired with a line                                                  |
| §1 _Reopen and leaving_                                       | changed: a paired engine reopens like an armed one; a cold start re-pairs once, under four conditions; the route follows a held broadcast; T14 M2 stands  |
| §1 _During the session_                                       | replaced: 410, `over`, `waiting` and another `sid` end the broadcast and return to Paired; refused ingest does not end it                                 |
| §2 the anti-corruption layer and `StreamSession`              | changed: JS parses the QR and the waiting fields; native parses the session shape; `StreamSession` leaves JS                                              |
| §2 `DescriptorPort.fetch(sid, token)`                         | becomes a fetch of the code with its `tok`, read to the waiting fields; `DescriptorError` keeps `ended`, read as not valid                                |
| §2 the engine port                                            | replaced by _The engine port_                                                                                                                             |
| §2 "`audioFloor` stays, as a display selector"                | changed: one shared floor; native judges sound readiness                                                                                                  |
| §2 _Storage and time_                                         | changed: the saved code holds the QR and the waiting fields, never `cred`                                                                                 |
| §3 `SessionMachine` and `Heartbeat`                           | changed as §3 above; `SessionOver` becomes `ServerWord`                                                                                                   |
| §3 platform: the service, the encoded orientation, the bridge | changed: the service from pairing; the side from the accelerometer; the intents above                                                                     |
| §4 Settings                                                   | gains the automatic switch                                                                                                                                |
| §4 S0 gaps, keep-awake "while armed or live"                  | becomes: while the viewfinder shows a paired or held engine                                                                                               |
| §5 the failure table                                          | 410 at scan reads not valid; an organiser stop returns to Paired with its line; the warming-deadline row goes; the crash row stands, and the pairing ends |
| §6 _Tests_ and _Mutation_                                     | the warming-deadline test and its mutation go; the answer table, readiness and the guards in §3 come in                                                   |
| §6 _Device checks_                                            | the organiser-Stop check reads "Organiser stopped it — waiting for Go live"; the gate is split as §3 says                                                 |
| §7 phases 4 and 5                                             | phase 4 runs on the scripted code server; phase 5 is plan D's staging run                                                                                 |
| _Ask_, all of it                                              | replaced by this document's contract and _Asks for the web side_                                                                                          |

## AGENTS.md changes

Built in revised plan C's first batch, each citing its ruling. The text below is the edit; nothing else in AGENTS.md changes.

- **§1 Scope lock.** "keeps the five-screen shape of its own: **Scan** → **Arm** → **Live** (HUD) → **Settings** → **Diagnostics**" becomes "keeps the five-screen shape of its own: **Scan** → **Paired** → **Live** (HUD) → **Settings** → **Diagnostics**. A stream code pairs the phone once and serves every Go live of the match (A1, A5)."
- **§2 The native/JS line.** "Commands are **intents, not RPC**: `start`, `stop`, `switchCamera` return void" becomes "Commands are **intents, not RPC**: `pair`, `start`, `stop`, `unpair`, `reset`, `setAutomatic`, `setLanguage` and `switchCamera` return void". Add to "Native owns": "pairing, heartbeats, the server's answers, and the start readiness gate (A5, A11)".
- **§3 Layering.** The tree's line "`credentials/   # StreamCredentials sum type + QR parsing (anti-corruption)`" becomes "`credentials/   # QR v2 and the waiting fields, parsed (anti-corruption); publish credentials are native's`".
- **§4 Domain rules.**
  - "`StreamCredentials = SrtCredentials | RtmpsCredentials`. A sum type, never a struct with optional fields. C1 requires both shapes in hand at scan time." becomes "Publish credentials are a sum type, never a struct with optional fields: `SrtTarget | RtmpsTarget`, in the native core only. C1 requires both shapes in hand when a broadcast starts (at Arming), kept for its life. They never reach TypeScript (A1, A5)."
  - "The wire shape never reaches the domain. A v2 contract touches one file." becomes "The wire shape never reaches the domain. Each wire shape has one parser, in one language: the QR and the waiting fields in TypeScript, the session shape and the server's answers in Kotlin. A v2 of any shape touches one file."
- **§6 UI rules.**
  - "A phone lying flat is never blocked." becomes "A phone lying flat is never blocked by the card; Go live still waits until the phone is held sideways (A11)."
  - After "One hold length for both…", add: "A start from the console, from automatic mode, or a rejoin needs no hold: the operator is not there to hold it, and the server's Go live is the decision (A2, A10). The Stop hold ends the broadcast and unpairs (A3)."
  - "Go Live enables only when _armed_: credentials parsed, camera running, audio above a level floor, network reachable. The pre-flight is the safety." becomes "Go Live enables only when _paired and ready_: camera running, audio above the level floor, network reachable, phone held sideways, as native judges it. The pre-flight is the safety, for every start, held or remote (A11)."
  - After "the encode profile is the first one that will be.", add: "The named exception is Settings' automatic switch: it stays usable on air, because it only affects the automatic stop (A4)."
  - After "P4 still holds inside Live Stream.", add: "The encoded orientation is the side the phone is held, read from the accelerometer, never the screen's rotation (A11)."
  - After "Home is hidden and Back says how to stop.", add: "A broadcast started remotely moves the app to Live Stream from wherever it is (A2)."
- **§9 Lifecycle.** "foreground service, `camera` + `microphone` foregroundServiceType, matching `FOREGROUND_SERVICE_*` permissions, started from the foreground." becomes "…started from the foreground **at pairing**, after the camera and microphone permissions, and held with a partial wake lock for the whole pairing, so beats and a remote Go live work with the phone locked (A5)." The notification sentence becomes "The persistent notification carries status: `Paired · waiting for Go live`, then `LIVE · 3000k · 47 min`."
- **§10 Testing.** "Detox covers scan→arm→live." becomes "Detox covers scan→pair→live."
- **§11 Tooling.** "**never apply while a session is armed or live**" becomes "**never apply while the phone is paired or holding a broadcast**. A paired phone is waiting for a match, and a remote Go live can arrive at any moment."

## Known gaps

- **SRT on the custom ingest host** is unproven until the web side's ffmpeg check on staging.
- **Battery while waiting** is measured at plan C's device gate; server push is the fallback, and would need a ruling against AGENTS §1's push scope.
- **iOS** stays out of scope (plan C M3). The paired phase relies on Android's foreground service; iOS cannot hold a camera in the background (P1).
- **The printed code is now a lasting bearer.** Under S1 decision 4, `tok` lasted one session. Now it lasts the code's life, which has no time cap (web-side ruling), and it authorises a credit-spending `POST start` and the publish credentials. A photographed code is usable until the match finishes plus 2 h, or until the organiser revokes it. This is recorded, not a request to change the web's ruling.
- **A Stop before the first frame sends no beat at the moment of the Stop (A8).** The server's broadcast stays warming until the stopping phone pairs again and delivers A17's stopped signal, or until the 10-minute no-signal timeout. It blocks no other phone's pairing (only a LIVE slot refuses a takeover), and the credit was spent at the start. Ask 10 ends it within 60 s.
- **A takeover before ingest lands.** If a new phone takes over while the old one is connecting, both can publish to the same input for up to one beat interval (10 s while a broadcast is held) before the old one hears `replaced`. Cloudflare keeps one of them.
- **A dead phone that comes back (A14).** A phone silent for 60 s may still be inside its own hold window. If it reconnects after a newer phone took the slot, both publish until its next beat is answered `replaced`, at most 10 s.
- **A Stop before the first frame, and a second phone.** A17's memory is per phone. If another phone pairs the same code and slot before the stopping phone pairs again, its claim can join the stopped broadcast while it is still warming, until the 10-minute no-signal timeout. Closed if lane D agrees ask 10, which ends that broadcast within 60 s of the stopping phone's last beat.

## Review dispositions

The independent review of 651c5e6 raised 2 Critical, 13 Important and 11 Minor findings, and 5 owner questions. Every finding is fixed above unless this table says otherwise.

| Finding | Where it is settled                                                                                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1      | _Contract shapes_: `startedBy`, `endReason` (with `auto_stopped`) and the waiting fields on every answer. The review's `"auto"` is spelled `"automatic"`, to match `cause`.                                                                                                                   |
| C2      | _The answer table_, every phase × answer; _Pairing, takeover and rejoin_ (A9, A10).                                                                                                                                                                                                           |
| I1      | _The engine port_.                                                                                                                                                                                                                                                                            |
| I2      | _Who reads what_. One deviation: JS saves the code at the scan's 200 and forgets it on a refused permission, rather than saving only once paired. Saving later would let the orphan rule unpair a phone that paired before its save landed.                                                   |
| I3      | _Beats while locked_; the clamp in _Contract shapes_.                                                                                                                                                                                                                                         |
| I4      | _Readiness_ (A11, which answers the upright phone), _Process death and reopen_ (the route rule), the confirm sheet in §2. Plan A ruling 7 N4 ("nothing under the turn card acts") governs JS controls; a native start is not one, and the card still hides the HUD until the phone is turned. |
| I5      | _Start failures_; _Permanent failures and permissions_.                                                                                                                                                                                                                                       |
| I6      | _What this changes in S1_, and the S1 header's pointer.                                                                                                                                                                                                                                       |
| I7      | _Process death and reopen_.                                                                                                                                                                                                                                                                   |
| I8      | _AGENTS.md changes_, including §2.                                                                                                                                                                                                                                                            |
| I9      | Under the Decisions table, and _The final beat_.                                                                                                                                                                                                                                              |
| I10     | _One rule for the server's word_.                                                                                                                                                                                                                                                             |
| I11     | A13; _New strings_.                                                                                                                                                                                                                                                                           |
| I12     | §3, the rewrite table and _The device gate_. The task count is left to the rewritten plan.                                                                                                                                                                                                    |
| I13     | _Identity rules in JS_.                                                                                                                                                                                                                                                                       |
| M1      | The phase diagram; the beat reports `arming` while Arming.                                                                                                                                                                                                                                    |
| M2      | Under _The answer table_: "live" for the 401 rule is Armed to On air; a 401 then is acted on when the broadcast ends.                                                                                                                                                                         |
| M3      | _The answer table_'s last rows; `POST start` is never retried on its own.                                                                                                                                                                                                                     |
| M4      | §2's Home table keeps a 410 line, read as not valid.                                                                                                                                                                                                                                          |
| M5      | §2's notification; `setLanguage`. This widens plan C ruling P3 (the language in the arm intent) so the shade follows a language changed during a long pairing. It does not reverse it.                                                                                                        |
| M6      | §3's core bullets: deduplicated beat lines, one record per pairing, `tok` protected from `pair`.                                                                                                                                                                                              |
| M7      | §2 _Starting_ and the line rules: Stop from Arming on; refusal and end lines last until the next start.                                                                                                                                                                                       |
| M8      | _The engine port_ (the camera follows the attached preview); _The device gate_ (another app holding the camera).                                                                                                                                                                              |
| M9      | _Known gaps_.                                                                                                                                                                                                                                                                                 |
| M10     | _Identity rules in JS_: one sheet.                                                                                                                                                                                                                                                            |
| M11     | _Device-only claims_.                                                                                                                                                                                                                                                                         |
| Q1      | Ruled: A9.                                                                                                                                                                                                                                                                                    |
| Q2      | Ruled: A10.                                                                                                                                                                                                                                                                                   |
| Q3      | Ruled: A11.                                                                                                                                                                                                                                                                                   |
| Q4      | Ruled: A15 and A16, which replace this document's earlier reading. The automatic start fires once per match, at match start or on a late pairing; the automatic stop still applies after a manual restart.                                                                                    |
| Q5      | Ruled: A13.                                                                                                                                                                                                                                                                                   |

### The re-review (c5a423a)

The re-review found five new Important contradictions (N1–N5), residue on C1, C2, I2, I3, I7, I8 and I10, seven minors, and four owner questions (A–D). The owner ruled on A–D as A14–A17. Lane D's session added two recommendations, both taken.

| Finding                     | Where it is settled                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1                          | _Process death and reopen_: the automatic re-pair runs once, at cold start, under four conditions; `pair` is idempotent, with a Pairing state; `tapToPair` after a permanent failure; A7's confirm forgets the stream code. |
| N2                          | `claim: "new" \| "resume"` (_Pairing, takeover and rejoin_; web ask 2). A `resume` from a phone that is not current is `replaced`.                                                                                          |
| N3                          | Ruled by A17: _The operator's Stop wins_, the beat's `stopped` field, web ask 7.                                                                                                                                            |
| N4                          | _One rule for the server's word_: a 410 from either source, a `waiting`-shaped descriptor, one `NotFound` verdict; web ask 8.                                                                                               |
| N5                          | _AGENTS.md changes_: §3, §4 (both rules), §6's flat-phone line, §10.                                                                                                                                                        |
| C1 residue                  | Web ask 1: `auto_stopped` in both vocabularies.                                                                                                                                                                             |
| C2 residue                  | _The answer table_: a late `POST start` answer is ignored, with no refusal line.                                                                                                                                            |
| I2 residue                  | The saved code names `codeUrl`, `heartbeatUrl` and `startUrl`.                                                                                                                                                              |
| I3 residue                  | _Beats while locked_ states one release rule for the wake lock and the service.                                                                                                                                             |
| I7, I8, I10                 | Through N1, N5 and N4.                                                                                                                                                                                                      |
| A11's wording               | Read in _The engine's phases_: "stays paired" means keeps its pairing, in Armed with its `sid`. A11's text is unchanged.                                                                                                    |
| No accelerometer; the side  | _Readiness_: no sensor never blocks; the shared vector file carries the side.                                                                                                                                               |
| `startFailed`               | Gains `start-error` for a `POST start` with no answer or an error.                                                                                                                                                          |
| `codeEndedPending`          | _The engine port_: Diagnostics, then the "Code ended" panel.                                                                                                                                                                |
| The scripted server's file  | _The device gate_: app-private via `run-as`, never on `/sdcard`, never committed.                                                                                                                                           |
| Forget racing a go-live     | _Identity rules in JS_: reconciled as plan A's disarm.                                                                                                                                                                      |
| Naming                      | `mode` says `"automatic"`. Kebab-case for the phone's words and snake_case for the server's stay, because A8 fixes `"operator-stopped"`; both are negotiable at publish.                                                    |
| Web asks                    | Asks 2 (claim kind, 2xx), 7 (A17 stop), 8 (beat 410), 9 (`phone` on `POST start`), and `auto_stopped` in ask 1.                                                                                                             |
| Q-A, Q-B, Q-C, Q-D          | Ruled: A14, A15, A16, A17.                                                                                                                                                                                                  |
| Lane D: A14's silence clock | No beat **and** Cloudflare's input not connected, both for 60 s; the takeover joins the open `sid` and its credit. The claim's kind decides the slot only, so N2's guarantee holds and no claim opens a broadcast.          |
| Lane D: A17's late stop     | It closes only the `sid` it names, 200 as a no-op otherwise; 2xx or 410 is delivered; any other answer keeps the record, bounded by `keepUntil`.                                                                            |

### Re-review 2 (621f3c7)

Three Important findings, each settled by the coordinator's ruling of 2026-10-01 taken from the reviewer's fixes.

| Finding | Where it is settled                                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR1     | _Process death and reopen_: a visit never pairs; only a scan or Continue sends `pair(new)`; the cold-start reopen sends only `resume`; what the operator sees after a reopen; `reopenTarget` sends other Idle engines Home. |
| RR2     | _The operator's Stop wins_: `StoppedRecord.DEFAULT_KEEP_MS`, 12 h, for a Stop before the descriptor answers, with a test and a mutation.                                                                                    |
| RR3     | `stopped` rides only paired beats, so a 410 to a beat that holds a `sid` always means that `sid`; the delivery rules stand.                                                                                                 |
| Ask 10  | Now required: a warming broadcast whose phone has gone quiet for 60 s is ended. The second-phone gap stays in _Known gaps_, closed if lane D agrees it.                                                                     |
| Polish  | The answer table's `replaced` cell now names A14.                                                                                                                                                                           |
