# Match Day: Watch live link — design

Date: 2026-11-20. Status: approved by the owner (ruling below). Plan:
`docs/superpowers/plans/2026-11-20-matchday-watch-live.md`.

## Intent

The web's Seazn-hosted video work (web plan `docs/superpowers/plans/2026-11-20-seazn-hosted-video.md`, branch
`docs/seazn-hosted-video`) adds Seazn as a stream destination. A Seazn match plays live on the public match page. A
volunteer holding a Match Day code should be able to see that a match on the list is live on Seazn and get to it in
one tap. Today they would have to find the match on the public site themselves.

## Owner ruling

2026-11-20, option **A** (the owner's answer: "A"): in Match Day, a match that is streaming live to Seazn shows a
**Watch live** link. The link opens the public match page in the phone's browser. The app has no player of its own.

Rejected:

- **B, an in-app player.** This would need a video surface in Match Day, playback tokens on the phone and a second
  watch path to keep in step with the web's player. The public page already does that job. It would also bring back
  the billed-preview and thermal questions that What viewers see had to answer in Live Stream (AGENTS.md §6, §8).
- **C, nothing.** The day read would know a match is live and the phone would say nothing. That leaves the volunteer
  with no way in.

## Shape

- **Wire.** Every row of the day read (capture-matchday-day.v1, `CaptureMatchdayRow`) gets
  `live_seazn: { watch_url: string } | null`. `watch_url` is the absolute https address of the public match page,
  `https://<host>/live/<org>/<competition>/<division>/fixtures/<fixture id>`, on the web deployment's own host. It
  has no query and no fragment, so it can carry no token or secret. `null` means the match is not live on Seazn: a
  YouTube stream, no stream, or a match not in play. The web pins this in its plan's Task 17 (web commit
  `docs(stream): pin Match Day live_seazn shape for phone Watch live`). The call contract's candidates reuse the row
  and always carry `null`.
- **Parse.** `dayWire.ts` stays the one parser. A missing, `null`, garbled or non-https `live_seazn`, or a
  `watch_url` with a query or a fragment, reads as `null`. It never refuses the day: the link is decoration on a
  polled list, and a wrong field must not cost the operator the list.
- **Host.** The phone opens the link only when its origin is exactly the build's Seazn host (`hosts[0]`,
  `isBuildOrigin`, the rule the scoring link already follows). A URL for any other host shows no link.
- **Row.** The link is a compact ghost button, "Watch live", under the match's row on its court card and on the
  court's day. It sits outside the row's own button, because a control inside a control is a nested target for touch
  and for screen readers. A screen reader names it "Watch {match} live". It shows on any row that carries a valid
  link; in practice that is a playing match's Now row.
- **Open.** The tap goes through the existing `LinkPort.openUrl` (`ports.link`, `createNativeLink()` in
  `createNativePorts`). No new port is needed. If the phone refuses (no browser), the list's line says "Couldn't open
  the match page".

## Constraints

- Scope (AGENTS.md §1). Match Day "never finalizes a match, edits, or streams". The link does none of these. It opens
  an outside page and adds no screen or mode, and it uploads nothing. AGENTS.md §1 gets one sentence recording it.
- No score on the phone (§7). The phone draws nothing new. The score is on the web's page.
- Ports (§3). Screens reach the browser only through `ports.link`. The host check lives in `src/hooks/`, beside
  `browserTarget.ts`. `domain/` stays pure and does not know the build's host.
- Copy in en/es/fr/nl. Colours from tokens only (`GhostButton` already uses them).
- Tests follow the owner's rule for this change: the main paths only, fake ports, no timers, no rare corner cases.
- Depends on the web plan's Task 17 merging to web `main`. The phone's day contract is vendored, so the phone
  re-vendors it with `pnpm contracts:vendor` and moves its pins after that merge. Until then the parser ignores the
  field, as it ignores every field the contract does not name.
