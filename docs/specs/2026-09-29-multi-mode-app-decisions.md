# Seazn Capture becomes a three-mode app — decision record

**Status:** owner-ruled 2026-09-29 in a brainstorm. It records the decisions below; no screen is specified or built by it.
**Supersedes:** part of [AGENTS.md](../../AGENTS.md) §1 (scope lock) and §6 (landscape lock). See _What this overturns_.
**Next:** the S0 app-shell spec, then one spec, plan and build cycle per sub-project, in the order below.

## Why

A live event on 2026-09-26 showed what organisers want. They want a phone mounted on each court all day
("Court 1 = Mobile A"). They want the next match pushed to it without anyone touching it. And they want a
scorer to walk up, scan a code, and score from their own phone. The owner's scenario is recorded in the main
repo (`seazn.club`, `_SCENARIO-2026-09-27-court-bound-device.md`), and so is its ruling: per-match sessions,
with the device re-pointed between matches.

The owner also wants one app for the three jobs a club does at a ground:

- stream a match;
- score a match;
- approve a tournament's next step.

## The product

The app opens **portrait** on a home screen with three modes. **Only one mode runs at a time.** Each mode is
unlocked by its own QR code. **There is no login anywhere.**

| Mode               | Unlocked by                                                        | Orientation          | What it does                                                                                                   |
| ------------------ | ------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Live Stream**    | Capture QR (v1), or a court-pairing QR                             | **Always landscape** | _Handheld:_ today's capture design. _Court-bound:_ a paired phone that streams whatever match the desk assigns |
| **Remote Scoring** | Device-link QR, from the console, a printed sheet or a court phone | Portrait             | Scores **one fixture**, like today's device link                                                               |
| **Dashboard**      | Tournament approval QR (new)                                       | Portrait             | Lists divisions pending a decision (next round, stage completion, knockout proposal) and approves them         |

## Rulings

| #   | Topic                | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Rejected, and why                                                                                                                                                                                                               |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dashboard scope      | A tournament QR loads the divisions that are pending the next round, stage completion, or a knockout proposal. It is not the org console.                                                                                                                                                                                                                                                                                                                                              | "Approve what devices want to do": that is not what the owner wants the Dashboard for.                                                                                                                                          |
| 2   | Identity             | One mode at a time. Each mode has its own QR type. No login. If the operator scans the wrong type of code, the app offers to switch mode rather than calling the code invalid.                                                                                                                                                                                                                                                                                                         | Accounts or login: rejected by the owner.                                                                                                                                                                                       |
| 3   | Reopen               | After a kill, crash or reboot, the app reopens **into the last mode** while that mode's QR is still valid. Live Stream must do this: native may still be live under the Android foreground service.                                                                                                                                                                                                                                                                                    | Always opening on home: that would hide a live broadcast.                                                                                                                                                                       |
| 4   | Orientation          | The home screen, Scoring and Dashboard are portrait. Live Stream locks to landscape on entry and unlocks on exit.                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                               |
| 5   | Scoring build        | **Native UI with shared rules.** The app imports `@seazn/engine`, the pure-TypeScript package that the web pad and the server already use (CI keeps it free of react/next/postgres). **The app writes no scoring rules.** It must match the web pad's weak-network behaviour: optimistic taps, a durable queue, idempotency keys, `expected_seq`, and a visible "pending N".                                                                                                           | WebView of the web pad: the owner wants native. A server returning "allowed next actions": a large API change, and every decision would need a network round trip at the ground.                                                |
| 6   | Court-bound flow     | Pair once by QR, and the phone is bound to its court until revoked. The desk assigns the next match, and **the assignment queues** while a match is live. The phone arms itself. It **goes live when the scorer taps Start** in Remote Scoring, and the desk can start it by hand. It **ends when the result is final plus about 2 minutes of grace**, and the desk can end it sooner. Then it re-points to the queued match. Every match is a new session: one credit, one recording. | Pairing per day (weekly re-pairing), typing a device ID; the desk always starting (keeps the desk busy), starting at the scheduled time (schedules slip), starting as soon as the previous match ends (streams an empty court). |
| 7   | Court phone screen   | A landscape split, 50/50. **Left:** live preview with the scorebug overlay, the tally plate and a full-screen toggle. **Right:** "Court 1 · Mobile A", the current match, the scoring QR, a "Scorer connected / No scorer yet" chip, the clock, the battery, and the status line. **The mounted phone never scores.**                                                                                                                                                                  | A QR shown only on a tap (a scorer who walks up won't know to tap); scoring on the camera phone itself, as in the owner's sample app (every tap moves the shot).                                                                |
| 8   | Scoring UI           | Native (see 5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                               |
| 9   | Scoring QR security  | **The first scan claims the match.** The court phone's QR is then replaced by "Scorer connected · {device}". A second scan gets "This match already has a scorer — ask the desk". The desk can release or hand over the claim. Each match's link expires with the match.                                                                                                                                                                                                               | Showing the QR only on a tap; an open QR (a public scoring credential, all day).                                                                                                                                                |
| 10  | Broadcast invariant  | **The scoring QR never enters the broadcast.** It is safe by construction (the camera is encoded, not the screen), is written down as an invariant with a test, and forbids any "mirror the device screen" feature.                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                               |
| 11  | Unattended operation | (a) A **court status board** on the console, fed by a device heartbeat every ~10 s, with each court marked red after about 3 missed beats. (c) **Push alerts** to every phone that holds the tournament's Dashboard QR. Court mode warns when the phone is not charging, but does not block. A new first rung on the degradation ladder: **dim the preview half, keep the QR**.                                                                                                        | SMS or email alerts (slow, or they cost money). The phone's own screen alone (nobody is watching it).                                                                                                                           |
| 12  | Plumbing             | **Expo Router.** **The web's 4 locales** for every string, from day one.                                                                                                                                                                                                                                                                                                                                                                                                               | Hand-rolled routing (the Router's own comment says to revisit it once navigation grows a second axis, which it has).                                                                                                            |
| 13  | Order                | **S0 → S1 → S2 → S3 → S4** (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A web stand-in for the court-bound phone first (risks never being replaced); the Dashboard first.                                                                                                                               |
| 14  | Dashboard actions    | **Review and approve.** The server shows its proposal, and the phone approves with a **3-second hold**, because approval cannot be undone. "Open on console" is for edits. **The phone never computes and never edits.**                                                                                                                                                                                                                                                               | Editing on the phone (error-prone, and it duplicates the console); view-only.                                                                                                                                                   |

## Review of the rulings

The rulings were reviewed together, before anything was written:

- **R1 — the approval link's lifetime.** A short expiry would break ruling 11's all-day alerts. The tournament
  approval link therefore **lives for the tournament and is revocable** from the console. Every approval
  records which link made it.
- **R2 — keeping a court phone alive: no kiosk mode** (owner, option c). There is no app pinning and no
  auto-start at boot. A phone that restarts, or that a passer-by takes out of the app, is caught by ruling 11:
  it turns red after about 30 s, and the push goes out. Recovery takes one step, because ruling 3 reopens the
  app into Live Stream on that court and re-arms it without a rescan.
- **R3 — court-bound is Android only for now.** iOS stops the camera in the background and cannot relaunch
  after a reboot, and the iOS half of P5 is unmeasured.
- **R4 — the engine's speed on a phone is unmeasured.** Folding a long cricket ledger through `@seazn/engine`
  under Hermes on a budget Android handset gets a short spike at the start of S2.
- **R5 — one theme across all modes** (owner). Stadium night with the lime LED (AGENTS.md §5):
  - lime plates carry night ink;
  - **red means ON AIR in every mode**, so Scoring and the Dashboard never use red for errors or buttons;
  - orange means trouble;
  - team colours appear only as small markers.
- **R6 — a court match scored on paper never goes final.** The capture QR's `exp` (provision time +
  `max_duration` + 30 min) is the backstop. The status board shows "no result yet".

## The contract fact (web side, 2026-09-29)

`capture-qr.v1` stays exactly `{v, sid, slot, cred: {srt, rtmps}, preferred, exp}`. This was decided in the
main repo (lane D). `playbackUrl`, `overlayUrl` and `holdWindowSeconds` come from an **authenticated session
descriptor**:

- it is fetched at scan time and cached with the session;
- it is authenticated by `sid` plus a credential the QR carries, so there is still no login;
- `playbackUrl` is required, because the delivery watch depends on it (P5 F-P5-13).

The capture app's QR parser is therefore: scan, fetch the descriptor, then build `SessionCredentials`. Nothing
past the parser changes. **Owner, capture side: adopt.**

## What this overturns

| Where          | Was                                                                                                       | Now                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md §1   | "The whole app is five screens … No accounts, no login, no fixture browsing, no scoring … no remote push" | Three modes. The five capture screens become the Live Stream mode. Scoring and a tournament Dashboard are in scope. Push alerts go to Dashboard phones. Still true: no accounts, no login, no fixture browsing, no chat, no replays, no payments. |
| AGENTS.md §6   | "Landscape-locked"                                                                                        | Live Stream only. The home screen, Scoring and the Dashboard are portrait.                                                                                                                                                                        |
| Design doc §8  | Go Live is a 3-second hold                                                                                | Still true for handheld. A court-bound phone is started by the scorer's Start, or by the desk (ruling 6). The pre-flight still gates it.                                                                                                          |
| Router.tsx     | No navigation library                                                                                     | Expo Router (ruling 12).                                                                                                                                                                                                                          |
| Design doc §12 | i18n "only if a non-English club"                                                                         | 4 locales from day one (ruling 12).                                                                                                                                                                                                               |

**What holds:**

- the native/JS line (§2): re-pointing a court phone is just `stop`, then `arm`, then `start`;
- AGENTS.md §7's one-render-path rule for the overlay;
- the degradation ladder, which gains only a rung 0 for court phones;
- the P5 inheritance list, where F-P5-13's delivery watch matters more, because a court phone has no operator.

AGENTS.md itself is rewritten in S0, when the shell makes it true. Until then its §1 carries a pointer to this
record.

## Sub-projects, in order

| #      | Sub-project                  | Scope                                                                                                                                                                            | Main-repo dependencies                                                                                                                               |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S0** | App shell                    | Portrait home with three modes; the QR-type router ("wrong code, switch mode?"); reopen into the last mode; orientation per mode; Expo Router; 4 locales; the theme across modes | None                                                                                                                                                 |
| **S1** | Live Stream, handheld (= M1) | Today's capture design on the real StreamPack engine, carrying the P5 inheritance list (the results doc's Verdict) and the delivered-playlist watch; the QR parser as above      | The session-descriptor endpoint                                                                                                                      |
| **S2** | Remote Scoring               | R4's engine spike; a native chassis on `@seazn/engine`; **one sport first**, then the rest; offline queue parity; first-scan claim                                               | `@seazn/engine` and the sport skins (already pure data) packaged for React Native; claim-on-first-scan for `device_links`                            |
| **S3** | Live Stream, court-bound     | Pairing; the assignment queue; the scorer-start trigger; the grace end; the split screen; the heartbeat; Android only (R3)                                                       | Device registration beside `fixture_stream_sessions`; a court channel and token mint; the heartbeat API; the console status board; push registration |
| **S4** | Dashboard                    | Tournament QR; pending divisions; approve with a hold; receiving push                                                                                                            | The tournament approval link (a new credential beside `device_links`, R1); a pending-divisions API                                                   |

## For the main repo

- **Scorer sheets programme:** ruling 9 means one claim locks the shared, re-showable link everywhere,
  including on paper. This must be agreed there before `device_links` hardens.
- **A new credential kind:** the tournament approval link. It is more powerful than a scoring link, because
  it can close stages and lock brackets.
- **Lane C already reacted to F-P5-13:** "Live" derived from ingest status alone can charge a credit while
  nothing is recorded.
