# S4 Match Day — design

**Status:** brainstormed with the owner, 2026-11-03 to 2026-11-07. Nothing is built.
**Replaces:** the Dashboard sub-project (S4) of the
[decision record](2026-09-29-multi-mode-app-decisions.md). The third mode is renamed **Match Day**.
**Depends on:** S2 Remote Scoring as built (`docs/specs/2026-11-01-s2-remote-scoring-design.md` and the per-sport
designs). Match Day adds no pad, no queue and no sync of its own.
**Needs:** new web work in `seazn.club` (§9), built by this session in a `seazn.club` worktree on staging, as S2 did
(_owner, 2026-11-07_). The division-builder session is told of every change. The phone ships only after the web.

Owner decisions are marked _(owner, date)_. Everything marked _(my call)_ is the controller's, and the owner can
overturn it. A builder may decide anything marked _(builder)_.

## 1. Why

Chess arbiters and court umpires score many matches a day. One scoring QR per match does not work for them: someone
has to hand out a fresh code before every match. The owner wants one code per person per day. It shows the day's
matches. A tap on a match opens that match's own scoring, and Back returns to the day.

The Dashboard idea from 2026-09-29 (approve the next round) is kept and folded in. The person walking the hall is the
one who sees a round finish, so the approval belongs on the same screen.

## 2. Goals, non-goals, anti-goals

**Goals**

- One scan per day gives a scorer or arbiter every match of the day they are allowed to see.
- A tap on a match opens it in Remote Scoring exactly as if its own code had been scanned. Back returns to Match Day.
- The phone approves the server's next Swiss round and the server's knockout draw with a 3 s hold.
- The code is kept: the Match Day tile reopens the saved day without a rescan until the operator taps Exit.

**Non-goals (v1)**

- Push alerts to Match Day phones (decision record ruling 11(c)): deferred.
- Calling a match to a court, moving a match, or any Match Day desk action on the web other than approvals.
- Editing a proposal: changing a slot, unpairing a round or rebuilding a draw stays on the web desk.
- Finalizing a match. The device-link rules stand: a scoring link cannot finalize (web `scoring.ts:599-602`).
- Streaming. Match Day never starts the camera.

**Anti-goals: these would be a failure even if the rest works**

- A second pad, queue or sync written for Match Day. The pad is S2's, unchanged.
- A tap or a result lost because the operator left a match or exited Match Day.
- The phone working out a pairing or a draw. It shows what the server computed and approves it, nothing more
  (decision record ruling 14).
- A Match Day code that keeps working after its day, or after the organiser withdraws it.

## 3. The credential

_(owner, 2026-11-07: "yes" to the controller's recommendation)_

- **Minted on the web** by the organiser, on the Match Day desk (`/o/{org}/c/{comp}/match-day`).
- **Scope, chosen at mint:** the whole competition, or narrowed to one venue or a set of courts. A narrowed code sees
  and opens **only matches on its courts**. Matches not yet on a court are listed only for a code that covers the
  whole competition. A match that moves off the code's courts drops out of the list, and opening it is refused
  _(owner, 2026-11-07)_. This also covers the old S3 "court code" idea (memory `s3-court-code-notes`).
- **One day.** The organiser picks the day when minting; today is the default. The code opens at the start of that
  day and expires at its end, in the division's time zone. The web decides both instants and puts them in the code's
  answer (§9). Before the day starts, the tile shows "Match Day opens Sat 8 Nov" and lists nothing _(my call)_.
- **Revocable** on the web at any time.
- **Powers:**
  - Always: list the day's matches, and open a listed match's scoring link.
  - Only with **"can approve draws"** ticked at mint: approve a proposed Swiss round or knockout draw (§7)
    _(owner, 2026-11-07, approvals in v1; the tick is my call)_.
  - Never: finalize, call to a court, edit, stream, or anything else an organiser does.
- **Every link opened and every approval is logged on the server** against the code that did it.
- **Each match keeps its own scoring QR.** Scanning a match's code still opens that match alone, as in S2
  _(owner: "match QR still same, just match day open the match remote qr for scoring")_.

**The scoring links outlive the code** _(owner, 2026-11-07)_. Opening a match hands the phone that match's normal
scoring link: the same sealed link as its printed QR, with no expiry of its own. Exit, the end of the day and a
withdrawal stop the code from opening matches; they do not stop links already opened. So unsent taps always land. To
cut one phone off a match, the organiser makes a new link for that match on the web, which revokes the old one and
also replaces its printed QR. No new kind of link is built.

This reverses the web Match Day spec's line "scorers keep the per-match link; no court-bound scorer link"
(`seazn.club/docs/superpowers/specs/2026-10-31-match-day-design.md` §2) for this new credential. The web must record
the change too.

It also supersedes the decision record's R1 (an approval link that lives for the whole tournament). R1 existed so that
push alerts could run all day. Push is deferred, and a day code is the smaller risk.

## 4. Getting in, staying in, getting out

_(owner, 2026-11-07)_

- **First time:** the Match Day tile on Home opens the phone's code scanner. A valid Match Day code is saved, and the
  day opens.
- **After that:** the Match Day tile always opens the saved day. It never asks for a scan while the code is still
  valid.
- **Exit:** a way out, on Match Day's top bar under ⋯ so a pocket tap cannot reach it _(⋯ is my call)_. It opens a
  confirm:
  - No unsent taps: "Exit Match Day? You'll need to scan again." [Exit] [Stay].
  - Unsent taps: "Exit Match Day? 3 taps still sending — they'll keep sending." [Exit] [Stay].

  Exit tries to send at once and leaves either way. It forgets the Match Day code. **It never discards a tap.**
  Each match opened from Match Day keeps its own scoring link until its queue is empty, so its taps go on sending
  after Exit. Until they land, Home shows a small card: "Sending 3 taps · Court 2" _(owner, 2026-11-07: "yes and
  apply our rec")_.

- **The day ends** (past the code's expiry): the tile opens the scanner with one line, "Match Day ended", and
  forgets the code _(my call)_.
- **The organiser withdraws the code** (the server refuses it): the same, with "Match Day code withdrawn"
  _(my call)_.
- **The Continue card on Home** reads "Match Day · {competition} · {scope}" _(my call)_, for example
  "Match Day · SAFE Open · Hall A".
- **Reopen after a kill** (decision record ruling 3): into Match Day. If a match was open, into that match's pad,
  whose Back returns to the list _(my call)_.
- **Another kind of code scanned while Match Day is saved:** decision record ruling 2 applies: the app offers to
  switch mode. Match Day stays saved, and its tile still opens it _(my call)_.

## 5. The list

_(owner, 2026-11-07: layout B, "by court")_

```text
‹  MATCH DAY                         ⋯
   SAFE Open 2026 · Hall A · Sat 7 Nov
┌ banner, only when an approval waits ┐
│ GROUPS FINISHED · MEN'S SINGLES     │
│ Knockout draw is ready  [Review]    │
└─────────────────────────────────────┘
┌ COURT 1                    PLAYING ┐
│ NOW   Ng v Brown              14-9 │
│ NEXT  Patel v Okafor         10:40 │
└────────────────────────────────────┘
┌ COURT 2                       FREE ┐
│ NEXT  Lee / Tan v Ashok / Ravi 10:20│
└────────────────────────────────────┘
NOT ON A COURT YET · 4
  Singh v Murphy   Women's singles · R2
```

- **Header:** the competition, the code's scope and the day.
- **One card per court, table or board**, in the order the web gives. Each card shows:
  - the court's state (Playing, Free);
  - its **Now** match, if any, with a short score;
  - its **Next** match, and a **Then** match if there is one, with scheduled times.
- **Not on a court yet:** the day's matches with no court.
- **Finished matches** sit under their court below its Next, dimmed, with the result _(my call)_.
- **The venue filter** shows only on a code scoped to the whole competition that covers more than one venue.
- **Several sports in one competition** need no special handling: a row's sport only decides which pad opens.
- **Online chess boards** (the web's `2026-11-05-match-day-all-in-one-design.md` lists them with the hall) are listed
  under an "Online" heading, read-only, with their result when it comes. A tap does nothing; their result comes
  from online play, not a scorer _(my call)_.
- **A court with unsent taps** shows "Sending N" on its card.
- **Freshness:** the list polls every 15 s while it is on screen, and pull to refresh fetches it again
  _(my call; the web desk polls too, `match-day-shell.tsx:150`)_. No Realtime subscription for the list in v1
  (AGENTS.md §8: Realtime is one subscription per match, owned by the focused match).
- **Offline:** the list shows its last good copy with "Offline · updated 10:42". A match whose scoring link was
  already fetched can still be opened and scored offline.
- **Copy:** in all four locales (en/es/fr/nl). The screen is portrait.

## 6. Opening a match and coming back

_(owner, 2026-11-07: "click the match -> goes to remote scoring -> and we can come back to Match Day again")_

- **A tap on a match row** asks the server for that match's scoring link through the Match Day code (§9). It then
  opens S2 Remote Scoring with that link, exactly as a scan of the match's own code would:
  - **Now** (in play) → the sport's pad.
  - **Next** (not started) → the Start screen (rules, toss).
  - **Finished** or finalized → view only.
- **The match's top bar** shows "‹ Court 1" in place of S2's Back to Home. It returns to the list, scrolled to that
  court.
- **Leaving a match never stops its sending.** The queue and sync run as S2 defines them.
- **Several scorers on one match** are fine: no claim (S2 ruling 3), and `expected_seq` keeps them in step.
- **The match's scoring link is stored as S2 stores it** (`scoring.link.{id}`, secure store). It is forgotten by S2's
  own rules, not by Exit while it still has taps to send.
- **Refusals:**
  - The server says the match is outside the code's scope, or the code is gone → one line on the list, and the
    match does not open.
  - The match is not found → the list refreshes.

## 7. Approvals

_(owner, 2026-11-07: Swiss next round and knockout draw on the phone, in v1)_

- **A banner** appears at the top of the list only when the server reports an approval waiting in the code's scope,
  and only on a code with "can approve draws". There are two kinds:
  - **Swiss:** "Round 3 complete · Round 4 pairings are ready".
  - **Knockout draw:** "Groups finished · {division} · Knockout draw is ready". This is the seed proposal: the web
    computes it (`POST /stages/{id}/seed-proposal`) and confirms it (`…/seed-proposal/confirm`), which fills the
    knockout's empty slots. Winners inside a bracket already move up by themselves, so only the step from groups into
    the knockout needs approval.
- **On a code without the tick**, the banner says "Round 3 complete · pair on the web desk" and has no button
  _(my call)_.
- **Review** opens the proposal read-only: every pairing or slot as the server computed it, and "To change a slot,
  use the web desk".
- **Approve** is the shared 3 s hold with its progress fill (AGENTS.md §6; decision record ruling 14). It is not
  undone on the phone.
- **Two phones approve at once:** the server takes the first. The second shows "Already approved" and refreshes
  _(my call)_.
- **A proposal goes stale** (a result changed after it was computed): the server refuses it. The phone shows
  "Draw changed — review again" and reloads it _(my call)_.
- **After approval,** the new matches appear on their courts at the next refresh, which runs at once.
- **The session record** gets one line per approval: its kind, the stage and the outcome. It never carries the
  token.

## 8. Rules the build keeps

- **The token is a credential.**
  - It lives in the secure store, like saved codes, with Android backup excluded.
  - It is never in a record line, a log line, an error or a URL query string.
  - It is masked wherever a scoring link is masked today.
- **Code recognition:** `src/domain/mode/recognise.ts` learns the Match Day link's path, which the web chooses (§9),
  on the build's Seazn hosts only. It routes the UI only; the server's answer is the only trust decision.
- **`Mode` becomes `'stream' | 'scoring' | 'matchday'`.** `dashboard` is renamed everywhere, with its tests and
  copy.
- **Wire shapes** have one parser each, in TypeScript, in `src/domain/` (AGENTS.md §4). The web's contracts are
  vendored through `pnpm contracts:vendor` and the pin test.
- **The screens** are portrait, use theme tokens only, and are reachable through ports with a fake for every
  endpoint, so every state is built on a laptop first (AGENTS.md §10).
- **Settings:** Match Day adds nothing to the app's Settings in v1.
- **AGENTS.md §1** and the decision record are updated in the same change that ships the mode.

## 9. What the web must build

This session builds it in a `seazn.club` worktree on staging, before the phone work that uses it. Its shapes are
vendored into the phone through `pnpm contracts:vendor`. The day read follows the web's newer read model
(`2026-11-05-match-day-all-in-one-design.md`) if it has landed by then.

1. **Mint and revoke** a Match Day code on the Match Day desk:
   - its scope (competition, venue or courts);
   - the "can approve draws" tick;
   - an expiry at the end of the day.

   Shown as a QR with the Seazn logo, like other codes (AGENTS.md §6).

2. **A link shape** for the QR, on the Seazn host, that the phone can recognise. The scoring link's shape is
   `/score/{token}`.
3. **A day read**, authorised by the Match Day code: courts in scope with their Now / Next / Then matches, the matches
   with no court, finished matches, each match's sport, the competition and scope names, the expiry, and any
   approvals waiting (when ticked). Built from the desk's read model (`server/usecases/match-day.ts`).
4. **Open a match:** given a fixture in scope, return its scoring link, minted if needed (the same ENSURE as
   `POST /fixtures/{id}/device-links`, so it is the printed QR's link, never a second one). Refuse a fixture outside
   the code's courts or day. Log it against the code.
5. **Approvals,** authorised by a ticked code:
   - read the proposal and approve it, for the Swiss next round and the seed proposal;
   - a stale or second approval is refused with a code the phone can read.

   Approvals are in v1 _(owner, 2026-11-07: "include the approval as well")_, so this blocks the release. The Swiss
   proposal needs a preview that does not yet exist for later rounds (today `/generate` pairs round 1, and
   `swiss/add-round` adds later rounds without a separate preview).

6. **Record the reversal** of "no court-bound scorer link" in the web's Match Day spec.

The web recon is in `seazn.club/.superpowers/sdd/2026-10-31-match-day/scout-matchday-phone.md`. It flags, unverified,
that a score-only API key may reach `core.finalize` through `/events`. That belongs to the web, whatever Match Day
does.

## 10. Exit bar (staging, the owner's phone)

1. Scan a Match Day code → the list matches the web desk for the same scope.
2. Tap Now on a court → the pad. Score, then go back → the list. Then tap Next → the Start screen.
3. Kill the app on the list and on a pad → it reopens where it was.
4. Flight mode: score two matches, go back, Exit → "taps still sending", and Home shows the Sending card. Then
   network back → the taps land, and the console agrees.
5. A venue-scoped code lists only its venue.
6. A Swiss round completes → the banner, the review, a 3 s hold → the next round's matches appear on the list. The
   same for a knockout draw.
7. A code without the tick shows the banner and no button.
8. Withdraw the code on the web → the next tile tap says "Match Day code withdrawn".
9. A match's own scoring QR still opens that match alone.

## 11. Left to the builder

- The route layout under `app/`, provided Match Day reuses the S2 screens and nothing in `src/domain/scoring/` learns
  about Match Day.
- Component splits, and the exact copy beyond the strings quoted above. All copy goes in the four dictionaries.
- How the list stores its last good copy.
