# Contracts

The web's capture contracts, vendored and pinned (plan D spec §3.1, owner ruling R7). The source of truth is the
web repo `onryde/seazn.club`, folder `docs/contracts/`. This folder is a byte copy of that folder at one commit, and
nothing here is edited by hand.

Vendored from web `55ac34d5dcaf74d6735bdaf1e57aaa159586b7c8` (web #943, merged 2026-10-12, which serves the record
route) on 2026-10-12: 6 schemas and 199 fixtures. Staging deploys the web's `main`. 55ac34d5d changed only the record
contract and its fixtures: it lists the five keys the app wrote after capture 7ea8f63 (`bytes`, `failures`, `retryMs`,
`pickAspect16x9`, `pickSource`), drops a bad line where it refused the body (owner ruling RL: 422 is now only a body the
server cannot read as lines), closes a pairing window at `pair-refused`, `engine-error` and `reset` too, adds eight
fixtures and rewords `valid-invalid.json`. Before it, `53f28ebfc` (web #941) added the record contract and its 52
fixtures, and changed no other file. The first vendoring, on 2026-10-09, was at web `8afdd8b42`; the second, the same
day, at `5a02cc4a5`, which changed the descriptor schema's prose and fifteen fixtures' RTMPS host to
`live.cloudflare.com`, and no verdict.

| File                           | What it is                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- |
| `capture-qr.v2.json`           | The stream QR: code, slot and token, never a credential                    |
| `capture-descriptor.v1.json`   | `GET code`'s answer: the waiting fields, and the session shape with `cred` |
| `capture-beat.v1.json`         | A beat and its answer                                                      |
| `capture-start.v1.json`        | `POST start`'s answer and its refusals                                     |
| `capture-scoring-link.v1.json` | The Remote scoring link's answer                                           |
| `capture-record.v1.json`       | One line of Send record to Seazn's NDJSON body, its 201 and its refusals   |
| `fixtures/<contract>/…`        | The web's own fixtures for each, in the web's tree                         |
| `VENDORED.json`                | The web commit and the sha256 of every file above, written by the script   |

## How a contract changes

A contract changes only through `pnpm contracts:vendor` and the pin test (R7):

1. In the web checkout, at the commit to vendor, with `docs/contracts` clean (untracked files elsewhere in the
   checkout do not matter), run from this repo:

   ```bash
   pnpm contracts:vendor <path-to-web-checkout>
   ```

   It refuses a dirty `docs/contracts` before touching anything here, copies the files git tracks there, writes
   `VENDORED.json`, and prints each file added, changed or removed. It only reads the web checkout, and it never runs
   in CI. A fresh clone of the public repo, checked out at that commit, serves as well: the 5a02cc4a5 and 55ac34d5d
   vendorings used one, so the web checkout in daily use was never moved.

2. By hand, copy the web's commit and its six schema pins (`SHA256` in the web's
   `apps/web/src/server/api-v1/__tests__/capture-contract.test.ts`) into `WEB_COMMIT` and `WEB_PINS` in
   `test/contractPins.test.ts`. The script never writes them, so a re-vendor cannot move both sides of the pin at
   once.

3. Run `pnpm check`. `test/contractPins.test.ts` holds every file here to `VENDORED.json` and the six schemas to the
   web's own pins. A changed shape reds its parser's tests; the parser changes in the same pull request.

## Rules

- **Pin only (R7).** Nothing fetches the web repo, in CI or on a schedule. The web learns of drift from its own pin;
  the phone learns of it when the web session says so.
- **Byte for byte.** Prettier never formats the copies (`.prettierignore`). This README is ours, and so is
  `VENDORED.json`; the pin covers neither.
- **The wire shape never reaches the domain.** Each wire shape has one parser, in one language (AGENTS §4): the QR
  and the waiting fields in TypeScript (`src/domain/credentials`), the session shape and the server's answers in
  Kotlin (`Bodies.kt`). The record upload is the one exception: the app's TypeScript sends it and reads its answer,
  and the engine never sees it (`src/services/recordContract.ts`, `recordUploadPort.ts`).

## Words a schema allows that a route never sends

Two readings stay on the phone although the web never sends them on that route (plan D spec §2, §3.4):

- **410**, on a beat, on `GET code` and on the descriptor. `capture-beat.v1.json` says "A beat never answers 410
  (ask 8)" and `capture-descriptor.v1.json` "This route never sends 410 (ask 8)" (web X8: an ended code is 401
  `code_ended`, an ended session 200 `over`, an outage 503 `unavailable`). The phone keeps a defensive reading
  (`ServerWord.kt`).
- **`match_finished`**, in `capture-start.v1.json`'s refusal enum. Only the scoring-link route sends it
  (`capture-phone.ts:794` at web `5a02cc4a5`, as at `e201fab8f`), and the phone reads it there
  (`ScoringLinkPanel.tsx:16`). `POST start` never does: a start after the result is admitted inside the 120-minute
  grace and answers `401 code_ended` after it, and both already have readings.

## No longer blocked

The earlier README held vendoring back until C1, C2, M3 and N2 landed (`_FINDINGS.md`). Checked on 2026-10-09
against the files above:

- **C1** (both credential sets in hand): landed. `capture-descriptor.v1.json`'s open session carries `cred.srt` and
  `cred.rtmps` together, only to the slot's current phone, with `cred.srt: null` as the safety net (A18).
- **C2** (`holdWindowSeconds` reaches the app): landed. Every session branch of `capture-descriptor.v1.json` carries
  `holdWindowSeconds` per transport.
- **M3** (the slot): landed. `capture-qr.v2.json` and `capture-beat.v1.json` both carry `slot`.
- **N2** (credential lifetime and scope): landed. The QR carries no publish credential at all ("The QR never carries
  credentials: the phone fetches them with the tok"); the descriptor issues them per session, to the current phone,
  behind the code's Bearer.
