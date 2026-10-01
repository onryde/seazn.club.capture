# S1 amendment — the stable stream code — design

**Status:** owner-approved design, 2026-10-01, brainstormed section by section (§1 states and contract, §2 screens and copy, §3 what changes where). Awaiting owner review of this written amendment, then the revised plan C.
**Amends:** [S1 — Live Stream, handheld](2026-09-30-s1-live-stream-design.md). Where the two disagree, this document wins. Everything it does not mention stands.
**Web side:** agreed with the seazn.club lane D session (`r1-laned`) on 2026-10-01. Its owner's rulings for the web side are recorded under _Web-side rulings_; they are facts we build against, not rulings for this repo. The web holds its schema publish until this amendment is approved.

## Why

The web owner ruled that the stream QR stops carrying ingest credentials and becomes a **stable code**: one printable code per fixture, scanned once, reused for every Go live until the match is finished. Credentials are served only once a broadcast starts. Our owner accepted it and added two things of their own: either side may start or stop a broadcast, and an opt-in automatic mode starts and stops with the match.

The same shape serves S3's court-bound phones: a court phone scans a court code, stays paired all day, and the server hands it each match in turn. So the names are neutral — a **stream code**, never a fixture — and the label and start time always come from the server.

## Decisions

| #   | Decision                  | Ruling (owner, 2026-10-01)                                                                                                                                                                                                                                                                                     |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The code                  | capture-qr.v2 becomes `{v:2, code, slot, tok, exp?}`. No credentials. `exp` is optional; absent means the server decides. Replaces S1 decision 4's QR shape; `tok` stays the Bearer for every phone→server call and is still stored server-side only as a hash.                                                |
| A2  | Who starts                | **Either side.** The organiser's Go live in the console, or the operator's 3 s Go live hold on the phone (`POST start`). Either way the phone publishes with no second tap.                                                                                                                                    |
| A3  | Who stops                 | **Either side.** An organiser Stop returns the phone to paired·waiting on the same code. The operator's own 3 s Stop hold ends the broadcast **and unpairs**; the next broadcast needs a rescan.                                                                                                               |
| A4  | Automatic mode            | Seazn starts the broadcast at match start and stops it about 3 min after the result is saved, **only when** the console's per-fixture switch ("Stream the match automatically") **and** the phone's Settings switch are both on. The phone's switch is **on by default**. Every beat carries the phone's mode. |
| A5  | Architecture              | **The native engine owns the whole code lifecycle**: a new paired·waiting phase, heartbeats with no session, the server's answers driving Go live. JS sends intents only (AGENTS §2). Server push is a later fallback if waiting drains batteries.                                                             |
| A6  | Neutral names             | `code`, not fixture. S1 builds the fixture kind; S3 adds the court kind with no engine change.                                                                                                                                                                                                                 |
| A7  | Another mode while paired | Opening Remote Scoring or the Dashboard while paired (not live) asks first and unpairs on confirm. While live, other modes stay blocked as today.                                                                                                                                                              |
| A8  | The final beat            | Unchanged from the earlier 2026-10-01 ruling: one best-effort beat `{state:"ended", endReason:"operator-stopped"}` only when the operator stops a broadcast that was live.                                                                                                                                     |

## Web-side rulings we build against

- **Expiry.** A stream code is valid until the match is finished (result saved, void or abandoned) plus 2 h, with no time cap. Expiry blocks new pairing and new Go lives only; it **never ends a live broadcast**. A pause today and a resume tomorrow work on the same saved code.
- **401** from any code call means the code is expired or revoked: the phone forgets it. **410**, or an "over" answer, ends the current broadcast only: the phone returns to waiting.
- **Start gates.** `POST start` spends a credit, so it passes the console's gates: credit, entitlement, and a destination the organiser has already chosen. Refusals: `409 no_destination`, `402 no_credit`, `403 not_entitled`, each with a plain message. `409 already_live` means a broadcast is already open: the phone takes it over.
- **Ingest hosts.** `cred` points at Seazn's own Cloudflare custom domains: `live.seazn.club` in production (RTMPS `:443/live/`, SRT `:778`) and `live.stg.seazn.club` on staging. SRT over the custom host is still to be proven on staging by the web side.
- **Cadence.** The server drives `pollSeconds`: 60 s until about 30 min before the scheduled start, 10 s after.

## 1. States and contract

### The engine's phases

```
Idle ──pair (scan)──▶ Paired·waiting ──go-live──▶ Arming → Armed → Connecting → On air
                         ▲      │                                              │
                         │      └── 401: code expired/revoked ──▶ Idle (forget)  │
                         └──── organiser Stop · "over" · 410 · hold window ran out · fatal error ◀┘
                               operator's Stop hold ──▶ Ended ──▶ Idle (unpair, forget)
```

- **Paired·waiting** is entered at the scan, while the app is on screen. That is when the camera|microphone foreground service starts, after its permissions are granted: Android 14+ forbids starting it from the background, and a remote Go live must work with the phone locked.
- While paired, the engine beats at the server's `pollSeconds`. The camera is open only while the viewfinder is on screen (to frame the shot), and closed when the phone is locked or the app is in the background.
- **Go live** arrives from a beat's answer (the console's Go live, or automatic mode at match start) or from the operator's hold through `POST start`. The engine then fetches the code's descriptor, which now carries the session's `sid` and credentials, and arms and publishes with no further tap.
- **A broadcast ends back in paired·waiting** for an organiser Stop, an "over" answer, a 410, the hold window running out, or a fatal error — the code is still valid. Only the operator's Stop hold and a 401 leave the code.
- A refused start leaves the engine paired, with the refusal reason in the snapshot.
- Plan B's streaming rules — bitrate regulation, the SRT→RTMPS fallback, the stall watchdog, the hold window, the delivery watch, the session record — are unchanged; they run inside each broadcast exactly as before.

### Contract shapes

Names are negotiable until the web publishes the schemas in `docs/contracts/`; then we vendor them and they are frozen.

```
QR v2:      { v:2, code, slot, tok, exp? }

GET code    (Authorization: Bearer <tok>, Cache-Control: no-store) → one of:
  waiting:  { state:"waiting", code, label, venueTimezone, scheduledStart?, pollSeconds,
              autoAllowed, destinationName|null, heartbeatUrl, startUrl }
  session:  { state:"warming"|"live"|"ending"|"completed"|"failed", endReason?, sid,
              cred:{ srt:{url,streamId,passphrase,latencyMs}, rtmps:{url,streamKey} }, preferred,
              playbackUrl, overlayUrl|null, holdWindowSeconds:{srt,rtmps}, maxDurationMinutes,
              warmingDeadline, label, venueTimezone, scoreUpdates, autoAllowed, heartbeatUrl, startUrl }
  401 → the code is expired or revoked: forget it.   429 → Retry-After.

POST start  (Bearer tok) → 200 { sid }
                         | 409 already_live (take that broadcast over)
                         | 409 no_destination | 402 no_credit | 403 not_entitled  (stay paired; show why)

POST beat   (Bearer tok) { code, slot, sid|null, at, state:"paired"|"armed"|"connecting"|"publishing"|
              "degraded"|"reconnecting"|"ended", mode:"auto"|"operator", transport, bitrateKbps, delivery,
              deliveredLagS, audioOk, battery, thermal, dataUsedMB, appVersion,
              endReason? }      // only "operator-stopped", only with state "ended"
         → { state:"waiting"|"go-live"|"live"|"over", sid?, pollSeconds? }
```

- Times stay epoch seconds (`exp`, `warmingDeadline`, `scheduledStart`); `at` stays ISO-8601 UTC.
- `heartbeatUrl`, `startUrl` and `overlayUrl` must sit on the build's exact Seazn host, per environment (the existing rule). **New:** `cred` URLs must sit on that environment's ingest host (`live.seazn.club` or `live.stg.seazn.club`); a descriptor whose `cred` points anywhere else is refused.
- The descriptor is fetched when a beat's answer flips to `go-live`, after a `POST start` 200, and on every reconnect (unchanged). The phone keeps the last session descriptor for the broadcast's life, so a reconnect at a wet ground never depends on reaching our API (register C1).
- A session-shape descriptor whose `sid` differs from the broadcast the engine holds is a new broadcast: the old one has ended.
- `tok` is compared in constant time server-side and never echoed or logged on either side (unchanged). The descriptor now carries publish secrets: no-store, never logged.

## 2. Screens and copy

English shown. Every string ships in en/es/fr/nl, checked against `docs/i18n-glossary.md`, with no `_review` marker (CI enforces it).

- **Home.** While paired, the Continue card reads **"Paired · {label}"** with **"Waiting for Go live"**. Tapping it opens the viewfinder.
- **Viewfinder, paired·waiting** (replaces the Arm state of S1 §1):
  - live preview while the screen is open;
  - status line **"Waiting for Go live · {destinationName}"**, or **"Waiting for the organiser to pick where to stream"** when none is chosen;
  - **"Starts {time}"** in the venue's zone under the label, when `scheduledStart` is present;
  - an **AUTO** chip when automatic mode is on at both ends; nothing otherwise;
  - the pre-flight chips (camera, sound, network) as today;
  - the **Go live** 3 s hold, in both modes.
- **Start refused** (stays paired; the line replaces the status line):
  - `no_destination`: **"Ask the organiser to pick where to stream"**
  - `no_credit`: **"No streaming credit — ask the organiser"**
  - `not_entitled`: **"Streaming isn't included for this club"**
- **Going live without a tap:** **"Going live — started by the organiser"**; in automatic mode at match start, **"Going live — the match has started"**. Then the Live HUD as built.
- **Live:** unchanged, except the Stop hold's screen-reader label becomes **"Hold to stop and unpair"**.
- **After a stop:**
  - organiser Stop → waiting, **"Stopped by the organiser — waiting for the next Go live"**;
  - automatic stop → waiting, **"Match finished — stream stopped"**;
  - the operator's Stop → the Ended state as built, plus **"Scan the code again for the next broadcast"**; the code is forgotten.
- **Code ended** (401): **"This code has ended. Scan the new one."**, back to Home, code forgotten. Never during a live broadcast.
- **Settings:** a new switch **"Start and stop automatically"**, on by default, captioned **"Only when the organiser turns it on for the match"**. It stays usable on air: it only affects the automatic stop.
- **Another mode while paired:** a confirm sheet, **"This phone is paired for streaming. Opening {mode} unpairs it."**, with **Unpair & open** and **Cancel**.
- **Android notification:** **"Paired · waiting for Go live"** while paired; **"LIVE · 3000k · 47 min"** while live (unchanged), in the operator's language (plan C ruling P3).

The Home outcome table of S1 §1 changes: a 200 `waiting` or `session` descriptor saves the code and opens `/stream` paired; 401/404 read "This code isn't valid for streaming."; the 410 rows go (a 410 now ends only a broadcast, never a code).

## 3. What changes where

All of it is folded into **plan C**, renamed _plan C — platform, bridge and stable code_: one branch (`feat/s1-plan-c`), one review chain, one device gate. Plan D is unchanged in role and still waits on the web's published schemas.

- **The core (plan B, merged)** — a new first batch, ahead of plan C's C1:
  - `Phase.Paired` with intents `pair(code)`, `start`, `unpair`; inputs for a beat's answer (waiting / go-live / live / over, `pollSeconds`), a start's answer (sid or refusal) and a 401;
  - the heartbeat moves from the session to the pairing, with `sid` null while waiting and `mode` in every beat; the final "ended" beat stays;
  - every end except the operator's Stop returns to `Paired`; a 401 forgets;
  - tests for each transition, the four questions, and a mutation per guard.
- **The JS (plan A, merged)** — folded into plan C's C5 and widened:
  - the QR parser for `{v:2, code, slot, tok, exp?}`; the descriptor as a `waiting | session` union; the ingest-host check per environment;
  - identity by code + slot + tok; the adopt/replace/leave/reopen rules rewritten around the paired code (the engine is paired on a code, not holding a session);
  - Home's Continue card, the waiting viewfinder, the refusal lines, the Settings switch, the other-mode confirm, the operator's Stop unpairing;
  - the fake engine gains the paired phase; `test/engineContract.ts` gains its rules.
- **Plan C itself:**
  - arming reads `cred`/`preferred` from the descriptor;
  - the foreground service starts at pairing, after permissions, with the paired notification;
  - a `POST start` adapter; 401 vs 410 handled apart;
  - the camera opens while paired only when the viewfinder is on screen, and on a remote Go live even when locked;
  - device gate additions: a console Go live with the phone locked; battery over a long wait; an organiser Stop then a second Go live on the same code; a refused start.
- **Pre-flight:** plan C's 12 pre-flight mismatches (P1–P12) are re-checked against the revised plan.
- Plan C grows from 26 tasks to about 36.

## Known gaps

- **SRT on the custom ingest host** is unproven until the web side's ffmpeg check on staging.
- **Battery while waiting** is measured at plan C's device gate; server push is the fallback, and would need a ruling against AGENTS §1's push scope.
- **iOS** stays out of scope (plan C M3). The paired·waiting phase relies on Android's foreground service; iOS cannot hold a camera in the background (P1).
