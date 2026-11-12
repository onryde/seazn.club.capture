# S4 Match Day — device exit bar (results)

The exit bar is the spec's §10 (`2026-11-07-s4-match-day-design.md`). This file is the runbook for the device pass
on 13 Nov 2026 and, once it has run, its results.

## Build and phone

- Build 1142 (`com.seazn.capture.dev`, "Seazn Club (dev)", 1.0.8), from `feat/s4-match-day` at 14dcc984, a local
  release build pointed at staging (stg.seazn.club).
- The owner's NE2211, Android 16, installed with `adb install -r` on 12 Nov.

## What a Match Day code's Day means

A code is minted for one **Day**, the date in the code sheet's Day box:

- **It works from 00:00 to 24:00 on that date**, in the organisation's time zone (S.A.F.E: Europe/London). Scanned
  before 00:00 it does not open yet, and the phone says when it opens. After 24:00 the phone says "Match Day ended"
  and forgets the code.
- **It lists the matches scheduled on that date**, plus any match in play whatever its time, and the day's finished
  matches. A match with no time, or on another date, is not on the list.

So a test on 13 Nov needs matches on 13 Nov and a code whose Day is 13/11. A code minted on 12 Nov for 12/11 stops at
midnight, which is why this pass was moved to the 13th.

## Staging setup (built 12 Nov)

Organisation S.A.F.E, competition **MD Test 13 Nov** (private, 13 Nov only), badminton, every match one game to 15.

| Venue        | Courts           |
| ------------ | ---------------- |
| Chase School | Court 1, Court 2 |
| Hall B       | Court 3          |

**Men's Singles** (Swiss, 2 rounds): Arun Nair, Ben Okafor, Chen Wei, Dev Patel.

| Time  | Court            | Match                                                       |
| ----- | ---------------- | ----------------------------------------------------------- |
| 09:00 | Court 1          | Arun Nair v Chen Wei (round 1)                              |
| 09:00 | Court 2          | Dev Patel v Ben Okafor (round 1)                            |
| 09:30 | Court 1, Court 2 | round 2, paired when round 1 is done (the phone's approval) |

**Women's Singles** (two groups of three, then semi-finals and a final): Asha Rao, Bea Lund, Cara Doyle, Dina Haddad,
Eva Novak, Fay Mensah.

| Time  | Court            | Match                                                            |
| ----- | ---------------- | ---------------------------------------------------------------- |
| 09:00 | Court 3          | Bea Lund v Cara Doyle (B)                                        |
| 09:30 | Court 3          | Asha Rao v Dina Haddad (A)                                       |
| 10:00 | Court 1          | Eva Novak v Asha Rao (A)                                         |
| 10:00 | Court 3          | Fay Mensah v Bea Lund (B)                                        |
| 10:30 | Court 1          | Dina Haddad v Eva Novak (A)                                      |
| 10:30 | Court 2          | Cara Doyle v Fay Mensah (B)                                      |
| 11:00 | Court 1, Court 2 | semi-finals, drawn when the groups finish (the phone's approval) |
| 11:30 | Court 1          | final                                                            |

Round 2 and the knockout were given times in advance, so they show on the list the moment they are drawn.

## Codes to mint on 13 Nov

On the competition's **Open Match Day** desk (it shows from 13 Nov), mint:

1. **Whole competition, Approve ticked**, Day 13/11. The main code for items 1–4, 6, 8 and 9.
2. **Venue Hall B, Approve not ticked**, Day 13/11. Items 5 and 7.

Show the QR on the laptop screen and scan it with the phone. The code's value is never photographed or written down.

## The pass (spec §10)

Steps marked _owner_ need the owner's hands; the controller reads the phone over adb and takes app-only screenshots,
status bar cropped.

| #   | Step                                                                                                                                     | Who                                            | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| 1   | Scan code 1 → the list matches the web desk: Courts 1–3, Now/Next as above                                                               | owner                                          |        |
| 2   | Tap a Now row → the pad; score; ‹ Court → the list. Tap a Next row → the Start screen                                                    | owner                                          |        |
| 3   | Kill the app on the list, and on a pad → it reopens where it was                                                                         | owner                                          |        |
| 4   | Flight mode: score two matches, back, Exit → "taps still sending" and the Sending card; network back → the taps land, the console agrees | owner                                          |        |
| 5   | Scan code 2 → only Hall B's Court 3                                                                                                      | owner                                          |        |
| 6   | Finish Men's round 1 → banner, Review, 3 s hold → round 2 on Courts 1–2. Finish the groups → the same for the draw                       | owner (results may be entered on the web desk) |        |
| 7   | With code 2 → the banner and no button                                                                                                   | owner                                          |        |
| 8   | Withdraw code 1 on the web → the next tile tap says "Match Day code withdrawn"                                                           | owner                                          |        |
| 9   | A match's own scoring QR still opens that match alone                                                                                    | owner                                          |        |

Then a 320 dp pass (`adb shell wm size` / `wm density`, reset afterwards) and the device-only list from the reviews:
row ellipsis, the pull spinner, caution colour, scroll to the court, Back's TalkBack name, Android Back, the hold's
fill and feel, TalkBack on the approval overlay, the Exit glyph and sheet, es/fr/nl on Hermes.

## Results

_To be filled in on 13 Nov._
