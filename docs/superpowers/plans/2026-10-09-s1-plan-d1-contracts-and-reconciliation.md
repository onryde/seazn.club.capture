# S1 Plan D, slice D1: contracts and reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks run in order, one implementer at a time: each task builds on the files the one before it leaves.

**Goal:** Vendor the web's capture contracts byte for byte with a two-sided pin, check the phone's QR vectors and the round-line fixtures against them, put every beat the phone sends into the session record, align the test paths with the web, and put a dated revision note on every text the web's rulings made stale.

**Architecture:** `contracts/` becomes a byte copy of the web's `docs/contracts/`, written by a local script (`pnpm contracts:vendor <path>`) that records the web commit and every sha256 in `contracts/VENDORED.json`. One vitest file holds the folder to that record and holds the five schema pins equal to literals copied by hand from the web's own test, so nothing fetches the web repo (R7). The existing contract consumers move from `test/fixtures/contracts/` to `contracts/`. The Kotlin core gains a pure `BeatLog`, held in the pairing, that writes a `beat-interval` line when the beat cadence changes and a `beats` line for each minute a beat went, so a three-hour match fits the record the operator shares.

**Tech Stack:** Node 26 (`.mjs` script, `node:child_process` git calls), vitest projects `domain` and `ui`, ajv 8.11.0 + ajv-formats 2.1.1 (draft 2020-12), the Kotlin core (JDK 17, Gradle, `allWarningsAsErrors`).

**Spec:** `docs/specs/2026-10-09-s1-plan-d-design.md`, sections 0, 1, 2, 3 (all of slice D1) and the D1 column of §6, as revised on 2026-10-09 after the web peer answered (§2 and §3.4). Every line number below was re-read on 2026-10-09 on `docs/s1-plan-d-spec` (base `ada2ffd`); the spec's own numbers are approximate.

**Sources, in authority order:** the spec; the web checkout (read only; `docs/contracts` identical at `8afdd8b42` and at staging's `e201fab8f`); AGENTS.md; this plan's _Decisions this plan takes_.

## Global Constraints

Every task's requirements include this section. Values in quotes are the spec's, verbatim.

- **R7, pin only.** "Drift check is **pin only**: vendored byte copies with pinned sha256s, verified offline. No fetch of the web repo in CI, blocking or scheduled."
- **The script.** "`pnpm contracts:vendor <path-to-web-checkout>`, a local script, never run in CI (_rec_). It refuses unless the checkout is clean, copies `docs/contracts/**`, records `git rev-parse HEAD` and every sha256 in `VENDORED.json`, and prints the files that changed." The web repo "is read-only from here, and the script never writes to it." See D-1 for "clean".
- **The two-sided pin.** "It also asserts that the five schema pins equal the web's own pins, written into the test as literals copied from the web's `capture-contract.test.ts:48-52` at 8afdd8b42." "After running it, the literals in the pin test are updated by hand from the web's test, so a re-vendor cannot quietly update both sides of the pin." The five values, read from that file at `8afdd8b42` and at `e201fab8f` on 2026-10-09 (the same at both):
  - `capture-qr.v2.json` `3292e33f84b693e5def6048012f6653ca7e31e1573fda3901da4fe67a62c5d43`
  - `capture-descriptor.v1.json` `84e936b72b866df4fc37317e06fc3f6f5555dd2196b10b24efc890b52f28a5d6`
  - `capture-beat.v1.json` `e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736`
  - `capture-start.v1.json` `012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae`
  - `capture-scoring-link.v1.json` `f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f`
- **The web commit (D-10).** The spec's first vendoring is "at web 8afdd8b42"; staging runs `e201fab8f`, and "`docs/contracts` is byte-identical" (spec §2; `git diff --quiet 8afdd8b42 e201fab8f -- docs/contracts` exits 0, checked 2026-10-09). The script vendors the web checkout's `HEAD`, whichever it is, and `VENDORED.json`'s `web` is the commit actually vendored. Today the checkout's `HEAD` is `8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac`; if it is `e201fab8fc3c67cc8bfb9a1df44490b75c3a1888` when Task 2 runs, that is the literal written instead, and nothing else changes. Any other `HEAD` whose `docs/contracts` differs from `8afdd8b42`'s: stop and report.
- **The web repo is read-only.** `/Users/ashokhein/github/seazn.club` is only read. Never `checkout`, `stash`, `fetch` or write there; every git call there carries `--no-optional-locks`.
- **Every beat sent, in the record (spec §3.4).** "the record [writes] one line per beat **sent**, in every build (_rec_): the send time, the interval since the last send, and the answer word. A three-hour match at 10 s is about 1,100 lines, and the record that Share sends is a 1,000-line ring. So D1 writes one line per change of interval plus a `beats` line per minute (sent, failed, last answer word). **N25** (owner, 2026-10-09: "count beats, don't list them"): a beat held on air no longer gets a line of its own either. The per-minute line carries it, and a change of answer still gets its own line. A three-hour match then writes about 200 beat lines, and Share's ring holds the whole match."
- **Revision notes.** "Each stale text gets an inline revision note dated 2026-10-09 that cites this spec. It is not deleted: the reasoning stays readable (AGENTS §0)." See D-5 and D-6 for tables and AGENTS.md.
- **No device.** "No device is needed for D1. It is one PR." Nothing here claims what the operator sees on a phone. Whether a real match's record shows the cadence is D3's row 8.
- **Worktree.** A new branch `feat/s1-plan-d1-contracts` in a new worktree off `main` once `docs/s1-plan-d-spec` (the spec and this plan) has merged, else off `docs/s1-plan-d-spec`. Call it `$WT`. Put `cd "$WT" &&` in every command (the shell's cwd resets between calls). Run `pnpm install --frozen-lockfile` once, in Task 1. Never a bare `git stash`. To back up a file for a mutation, `cp` it to `"$TMPDIR"` and restore it from there, never with `git checkout`.
- **Exit codes** with a redirect, never a pipe: `cmd > "$TMPDIR/x.log" 2>&1; echo "EXIT=$?"`.
- **Counting JS tests** (rtk can print `PASS(0) FAIL(0)` for a suite that failed to collect):
  ```bash
  cd "$WT" && pnpm vitest run --project domain <files…> --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
  ```
  Positional paths are substring filters: confirm every printed `name` is a file you meant.
- **Counting Kotlin tests** (from `modules/capture-engine/android/core`; clear the results first, so a stale XML is never counted):
  ```bash
  cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests '<FQCN>' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  cd "$WT/modules/capture-engine/android/core" && node -e 'const fs=require("fs");const d="build/test-results/test";let t=0,f=0,e=0;for(const n of fs.readdirSync(d).filter((n)=>n.endsWith(".xml"))){const x=fs.readFileSync(d+"/"+n,"utf8").match(/<testsuite [^>]*>/)[0];const g=(k)=>Number(x.match(new RegExp(" "+k+"=\"(\\d+)\""))[1]);t+=g("tests");f+=g("failures");e+=g("errors")}console.log({tests:t,failures:f,errors:e})'
  ```
  Several `--tests` may be given. `JAVA_HOME` is already JDK 17: never override it.
- **Scoped verification until Task 7.** Tasks 1 to 6 run the files they touch, `pnpm typecheck`, `pnpm lint` and `pnpm format:check`; never `pnpm check`, `pnpm test` or a bare `pnpm vitest run`. Task 4 runs the whole Kotlin core suite, because every core test drives the machine it changes. Task 7 runs the full suites.
- **Tests.** Every new test fails before its change: run it once first and record the red. Expected values come from the spec, the web's contracts, hand-worked arithmetic or hand-written literals, never from the code under test. No snapshot tests. Every sweep states its count. Every new guard is mutated once and a named test must fail (AGENTS §10).
- **Prettier.** `pnpm format:check` covers `src app modules test`. Run `pnpm prettier --write` on every file you create or edit under those folders and on `scripts/vendor-contracts.mjs`, `contracts/README.md`, the amendment and the live-stream spec. **Never run `--write` on `AGENTS.md`, `_FINDINGS.md` or plan C:** none of the three is Prettier-clean at `ada2ffd`, and a rewrite is an unrelated diff. Instead their Prettier drift must not grow. Baselines at `ada2ffd`, counted with `pnpm -s prettier <file> | diff <file> - | grep -c '^[<>]'`: `AGENTS.md` 58, `_FINDINGS.md` 120, `docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md` 2. Kotlin is not formatted by Prettier: follow the file's own style (two-space indent, the long lines the core already uses).
- **Implementers and reviewers** are the repo's agents in `.claude/agents/`, which run on Opus (AGENTS §13).
- **Commits.** One commit per task, `git add` by path, never `-A`. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed by an implementer.

## Decisions this plan takes (the owner may overrule)

Each is the plan's, not the owner's. The orchestrator puts them to the owner with the PR.

- **D-1. "Clean" means a clean `docs/contracts`.** The spec says the script "refuses unless the checkout is clean". The web checkout today carries untracked files outside it (`m1.txt`, `m2.txt`, `.claude/settings.json`), and the web repo is read-only from here, so a whole-checkout rule would refuse the first vendoring. The script refuses any uncommitted change or untracked file **under `docs/contracts`**, copies only the files git tracks there, and ignores the rest of the checkout (Task 1).
- **D-2. The web's `tampered` QR fixture stays readable.** §3.2 says "A vector the schema rejects must also be one the parser rejects." The phone's own QR vectors (`wire/code-vectors.json`, 31 rows) agree with the schema row for row, checked with ajv on 2026-10-09. The web's fixture `capture-qr.v2/tampered.json` (a valid QR plus a `cred` key) is refused by the schema (`additionalProperties: false`) and read by the parser, which drops the extra key and keeps nothing of it: a deliberate tolerant reading that `streamCode.test.ts:64-73` pins ("keeps nothing a mis-issued code carries beyond the four fields"). Task 3 records it as the one named exception rather than changing the parser. If the owner wants the parser strict, it is a one-line refusal plus flipping that existing test.
- **D-3. The beat record takes the spec's second form: the limit is the record the operator shares.** Three limits were found. The core's `SessionRecord` has none (it hands each line to a sink; `LAST_LINES = 20` is Diagnostics' tail only). The Android file `RecordFile` keeps 5 MiB and one rotation (`RecordFile.kt:24,34`), which a line per beat would fit. But the record anyone reads after a match is Diagnostics' _Share record_ (`useDiagnostics.ts:47-60`), which sends the JS ring, and that ring holds the last `RECORD_CAPACITY = 1000` lines (`src/services/sessionRecord.ts:26`; `nativePorts.ts:39` builds it with the default), every other line included. 1,100 beat lines do not fit in 1,000. So Task 4 writes one `beat-interval` line each time the cadence changes and one `beats` line for each minute in which a beat went: about 180 lines over three hours at any cadence, plus a handful of interval lines.
- **D-4. The beat lines' shape.** The "interval" whose change writes a line is the cadence the phone beats at (`BeatCadence.intervalMs`, from the server's `pollSeconds` and the 10 s held cap), not the measured gap: the gap moves with the tick (every 500 ms in the rig, the platform's on a phone) and would write a line on every jitter. The measured gap rides the interval line as `sinceLastMs`. The `beat-interval` line is written at the send, so its `at` is the send time: `{intervalMs, sinceLastMs, held}`. The `beats` line is `{minuteEpochMs, sent, failed, word}`: the minute's start on the wall clock (UTC), the beats sent in it, the answers that failed or never came, and the last answer word heard (`ServerWord`'s class name, as the `heartbeat` line writes it). It is written at the first beat of a later minute, or when the pairing stops beating (unpaired, ended, re-paired), so no minute is lost or written twice. A minute in which no beat went writes no line. An answer is counted in the minute of the beat before it. The A8 final beat counts as sent, with no interval line (it goes once, off the cadence); its answer has its own line already. Every new key passes the scrub as a number, a boolean or a listed plain word (`word`), so the scrub's key sets do not change; `allow-list.json` gains the two kinds and five scalar keys, as that file asks.
- **D-5. A stale table row gets its note as a paragraph under its table.** Appending to a cell would make Prettier re-pad every row of the table. The amendment already does this for A18 (`_A18, revised 2026-10-05 …_` under the Decisions table), so each note names the row it amends.
- **D-6. AGENTS.md's two texts are replaced, not annotated.** AGENTS.md holds working rules, which must read as current; the spec's table gives the new text verbatim, and the old reasoning stays in the live-stream spec and in the spec's §1 R7.
- **D-7. Three stale texts the spec did not list are reconciled too:** the live-stream spec's exit bar at S:21 ("a real stg fixture with the overlay", the same exit bar as S:273), `.github/workflows/check.yml:9-10` ("nothing is vendored under contracts/ yet") and `wire/server-bodies.json`'s `about` ("The contracts are test/fixtures/contracts/, copied … at 7e75fd4a7").
- **D-8. `Configs.kt:78` is aligned too.** §3.5 names `:35` and `:66`; the same fake's `startUrl` at `:78` is `/api/capture/codes/…/start`, which the web does not serve either. Other Kotlin test literals with pre-D3 paths (`AttemptPollersTest.kt:62-63`, `IntentMappingTest.kt`, `PairMappingTest.kt`, `PairingValuesTest.kt:30-32`, `SessionConfigTest.kt:94`, `SessionRecordTest.kt:245`, `ScriptAnswersTest.kt:45`, `EngineTest.kt:268`, `CodeVectorsTest.kt:62` on purpose, and `wire/host-vectors.json:7,23`, `scrub/vectors.json:238`) are outside §3.5 and are left; the summary lists them for a later tidy.
- **D-9. The round line is read through `Bodies.waiting`.** The web's `valid-live-stage.json` names `rtmps://live.stg.seazn.club:443/live/`, the ingest host W26 ruled out, so `Bodies.code` reads that fixture as `ForeignIngest`. Its waiting fields, the round line among them, are what §3.2 asks about, and `Bodies.waiting` is the reader of those. The summary passes the fixture's host to `mobile-s1-web`.
- **D-10. `VENDORED.json` names the commit actually vendored** (Global Constraints, _The web commit_), and the pin test's `WEB_COMMIT` is that commit, copied by hand.
- **D-11. Ruled (owner, 2026-10-09, N25: "Count beats, don't list them"): a held beat is counted, not listed.** Before D1 a beat held on air was written on every answer (`SessionMachine.kt:627-639`: "a held beat is written every time, as plan B wrote them"; `ProjectionPairedTest` "held beats are each written"), about 1,080 `heartbeat` lines over a three-hour broadcast at 10 s, enough on its own to push the start of the match out of Share's 1,000-line ring. Task 4 applies the paired rule to held beats: a `heartbeat` line only when the answer changes (result, status, word or claim), and the minute's `beats` line counts every beat. Three hours of held beats then write at most 200 beat lines (Task 4, Step 6), and Share holds the whole match. Task 6 files N25 as decided and fixed by Task 4. This is the owner's ruling, not one the owner may overrule here.

## Review Focus

Most likely first. Each line names the test that pins it.

1. **A held beat must be counted, never listed (N25), and a change of answer must still get its line.** Task 4, Step 6 (`held beats are written only when the answer changes, as paired ones are (N25)`; `three hours of held beats at 10 s write at most 200 beat lines (N25)`).
2. **A refused vendoring must leave `contracts/` exactly as it was.** A dirty `docs/contracts`, a web `README.md` that would overwrite ours, a folder with no `docs/contracts`, a folder that is not a git checkout: each is refused before anything is deleted. Task 1, Step 2 (`refuses %s, and leaves contracts/ exactly as it was`; `refuses a folder with no docs/contracts …`).
3. **A minute's count must be written exactly once, whatever ends the pairing.** Unpair, an operator Stop with its final beat, a re-pair, and a second Unpair that finds nothing. Task 4, Step 1 (`the open minute is written once when the operator unpairs, and never again`; `a Stop from air counts the final beat and writes the minute`; `a re-pair writes the old pairing's minute and starts its own log`).
4. **Finder's `.DS_Store` on the owner's Mac must not red the pin test.** `.gitignore` ignores it, so CI never sees it and a local run would. The one shared walk (`listFiles`) leaves it out, and the pin test uses that walk. Task 1, Step 2 (`lists files without Finder's .DS_Store …`).
5. **The interval line must not fire on tick jitter, and three hours must stay small.** Task 4, Step 1 (`three hours paired at 10 s are one interval line and one line a minute, counting every beat sent`).
6. **The web removes or renames a fixture.** The re-vendor deletes it from `contracts/` and from `VENDORED.json` and reports it, so the pin never holds a ghost. Task 1, Step 2 (`follows the web …`).
7. **The web checkout is in daily use.** Untracked files elsewhere must not block a vendoring, and the run must not write even git's index there. Task 1, Step 2 (`vendors with untracked files elsewhere …`; `never writes to the web checkout …`).

---

## File map

| File                                                                                                                | Task | Change                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------- |
| `scripts/vendor-contracts.mjs`                                                                                      | 1    | Create: the vendoring script and its shared walk                |
| `test/vendorContracts.test.ts`                                                                                      | 1    | Create: the script against throwaway git checkouts              |
| `package.json`                                                                                                      | 1    | Modify: `contracts:vendor` script                               |
| `contracts/VENDORED.json`, `contracts/*.json`, `contracts/fixtures/**`                                              | 2    | Create: written by the script, never by hand                    |
| `test/contractPins.test.ts`                                                                                         | 2    | Create: the pin test                                            |
| `test/fixtures/contracts/`                                                                                          | 2    | Delete                                                          |
| `modules/capture-engine/src/serverBodies.test.ts`                                                                   | 2    | Modify: read `contracts/`; `PINNED` replaced by `VENDORED.json` |
| `modules/capture-engine/src/scoringLinkBodies.test.ts`, `stageKinds.test.ts`, `test/serverScript.test.ts`           | 2    | Modify: read `contracts/`                                       |
| `modules/capture-engine/src/wire/server-bodies.json`                                                                | 2    | Modify: `about` text                                            |
| `.prettierignore`                                                                                                   | 2    | Modify: ignore the vendored copies                              |
| `modules/capture-engine/src/qrContract.test.ts`, `stageFixtures.test.ts`                                            | 3    | Create                                                          |
| `modules/capture-engine/android/core/build.gradle.kts`                                                              | 3    | Modify: `capture.contracts` system property                     |
| `…/core/src/test/kotlin/com/seazn/capture/engine/core/Vendored.kt`, `…/adapter/StageFixturesTest.kt`                | 3    | Create                                                          |
| `modules/capture-engine/src/wire/waiting-vectors.json`                                                              | 3    | Modify: "QF" rows to the reshaped label                         |
| `…/core/src/main/kotlin/com/seazn/capture/engine/core/BeatLog.kt`                                                   | 4    | Create: the beat summary, pure                                  |
| `…/core/Phase.kt`, `…/core/SessionMachine.kt`                                                                       | 4    | Modify: the pairing holds it; the machine feeds and closes it   |
| `…/core/src/test/kotlin/com/seazn/capture/engine/core/BeatLogTest.kt`                                               | 4    | Create                                                          |
| `modules/capture-engine/src/scrub/allow-list.json`, `…/core/ScrubParityTest.kt`, `src/services/scrubParity.test.ts` | 4    | Modify: two kinds, five scalar keys, the counts                 |
| `…/core/src/test/kotlin/com/seazn/capture/engine/core/Configs.kt`, `…/core/ConfigsTest.kt`                          | 5    | Modify, Create                                                  |
| `docs/specs/2026-10-01-s1-amendment-stable-code-design.md`, `docs/specs/2026-09-30-s1-live-stream-design.md`        | 6    | Modify: revision notes                                          |
| `docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md`                                                | 6    | Modify: revision notes                                          |
| `contracts/README.md`, `AGENTS.md`, `_FINDINGS.md`, `.github/workflows/check.yml`                                   | 6    | Modify                                                          |

Task 4 also flips `ProjectionPairedTest`'s held-beat test (N25), and may touch existing core tests that assert an exact command list containing a beat send (its Step 8 says how).

---

### Task 1: The vendoring script

**Files:**

- Create: `scripts/vendor-contracts.mjs`
- Create: `test/vendorContracts.test.ts`
- Modify: `package.json` (the `scripts` block, after `"i18n:release-check"`)

**Interfaces:**

- Consumes: nothing.
- Produces, for Task 2 and later re-vendors:
  - `listFiles(root: string, prefix?: string): string[]`: every file under `root` as sorted posix paths relative to it, `.DS_Store` left out at any depth.
  - `sha256(file: string): string`: lowercase hex of the file's bytes.
  - `vendor(web: string, target: string): { commit: string; added: string[]; changed: string[]; removed: string[] }`: throws (before touching `target`) on a refused web checkout.
  - `OURS: readonly string[]` = `['README.md', 'VENDORED.json']`.
  - CLI: `pnpm contracts:vendor <path-to-web-checkout>`, exit 0 on success, 1 on a refusal, 2 with no argument.

- [ ] **Step 1: Set up the worktree and record the web checkout's state**

```bash
cd /Users/ashokhein/github/seazn.club.capture && git worktree add -b feat/s1-plan-d1-contracts .claude/worktrees/plan-d1 main
```

(Use `docs/s1-plan-d-spec` in place of `main` if the spec branch has not merged.) Then, with `WT=/Users/ashokhein/github/seazn.club.capture/.claude/worktrees/plan-d1`:

```bash
cd "$WT" && pnpm install --frozen-lockfile > "$TMPDIR/install.log" 2>&1; echo "EXIT=$?"
git -C /Users/ashokhein/github/seazn.club rev-parse HEAD
git -C /Users/ashokhein/github/seazn.club --no-optional-locks status --porcelain > "$TMPDIR/web-status-before.txt"; cat "$TMPDIR/web-status-before.txt"
```

Expected: `EXIT=0`; `8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac` today, or `e201fab8fc3c67cc8bfb9a1df44490b75c3a1888` (D-10; any other: Task 2, Step 3 says what to check); the web status lists only paths outside `docs/contracts` (today `?? .claude/settings.json`, `?? m1.txt`, `?? m2.txt`). Keep the file: Task 7 compares against it.

- [ ] **Step 2: Write the failing test**

Create `test/vendorContracts.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFiles, vendor } from '../scripts/vendor-contracts.mjs';

/**
 * `pnpm contracts:vendor` (plan D spec §3.1, owner ruling R7) against throwaway web checkouts: real git repositories
 * in the OS temp folder, never the web repo. The expected hashes are `shasum -a 256` of the literal bytes, worked out
 * by hand, never by the script.
 */
const SHA = {
  // printf '{"a":1}\n' | shasum -a 256
  a: 'e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c',
  // printf '{ "x":  1 }\n' | shasum -a 256
  valid: '5757bf015012fab52b466f6ca6ec214570e56fa1a58c09fbb389f95e6fc19954',
} as const;

type Files = Readonly<Record<string, string>>;
type Pins = { readonly web: string; readonly files: Files };

const WEB_FILES: Files = {
  'capture-a.v1.json': '{"a":1}\n',
  // Two spaces inside: a byte copy keeps them, where a JSON round trip or Prettier would not.
  'fixtures/capture-a.v1/valid.json': '{ "x":  1 }\n',
};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'capture-vendor-'));
  made.push(dir);
  return dir;
}

/** git with an identity and none of the machine's hooks or signing, so a commit never waits on anything. */
function git(dir: string, ...args: string[]): string {
  const config = [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
  ];
  return execFileSync('git', [...config, '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function commitAll(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'contracts');
}

/** A web checkout: `files` under docs/contracts and a README of the web's own outside it, committed. */
function webCheckout(files: Files = WEB_FILES): string {
  const dir = temp();
  git(dir, 'init', '-q');
  write(join(dir, 'docs', 'contracts'), files);
  write(dir, { 'README.md': 'the web\n' });
  commitAll(dir);
  return dir;
}

/** A contracts/ folder holding only our README, as this repo's does. */
function ourFolder(): string {
  const dir = temp();
  write(dir, { 'README.md': '# ours\n' });
  return dir;
}

const tree = (root: string): Files =>
  Object.fromEntries(listFiles(root).map((path) => [path, readFileSync(join(root, path), 'utf8')]));
const pins = (target: string): Pins =>
  JSON.parse(readFileSync(join(target, 'VENDORED.json'), 'utf8')) as Pins;
const contractsOf = (web: string) => join(web, 'docs', 'contracts');

describe('pnpm contracts:vendor (plan D spec §3.1)', () => {
  it('copies docs/contracts byte for byte, keeps our README, and pins every file with the web commit', () => {
    const web = webCheckout();
    const target = ourFolder();
    const result = vendor(web, target);
    const head = git(web, 'rev-parse', 'HEAD');
    expect(listFiles(target)).toEqual([
      'README.md',
      'VENDORED.json',
      'capture-a.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
    expect(readFileSync(join(target, 'fixtures/capture-a.v1/valid.json'), 'utf8')).toBe(
      '{ "x":  1 }\n',
    );
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('# ours\n');
    expect(pins(target)).toEqual({
      web: head,
      files: { 'capture-a.v1.json': SHA.a, 'fixtures/capture-a.v1/valid.json': SHA.valid },
    });
    expect(result).toEqual({
      commit: head,
      added: ['capture-a.v1.json', 'fixtures/capture-a.v1/valid.json'],
      changed: [],
      removed: [],
    });
  });

  it('gives an identical tree on a second run, and reports nothing changed (a second call)', () => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    const first = tree(target);
    expect(vendor(web, target)).toEqual({
      commit: git(web, 'rev-parse', 'HEAD'),
      added: [],
      changed: [],
      removed: [],
    });
    expect(tree(target)).toEqual(first);
  });

  it('follows the web: a changed file, an added one and a removed one, each reported, and no ghost left', () => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    write(contractsOf(web), {
      'capture-a.v1.json': '{"a":2}\n',
      'fixtures/capture-a.v1/invalid.json': '{}\n',
    });
    rmSync(join(contractsOf(web), 'fixtures', 'capture-a.v1', 'valid.json'));
    commitAll(web);
    expect(vendor(web, target)).toEqual({
      commit: git(web, 'rev-parse', 'HEAD'),
      added: ['fixtures/capture-a.v1/invalid.json'],
      changed: ['capture-a.v1.json'],
      removed: ['fixtures/capture-a.v1/valid.json'],
    });
    expect(listFiles(target)).toEqual([
      'README.md',
      'VENDORED.json',
      'capture-a.v1.json',
      'fixtures/capture-a.v1/invalid.json',
    ]);
    expect(Object.keys(pins(target).files)).toEqual([
      'capture-a.v1.json',
      'fixtures/capture-a.v1/invalid.json',
    ]);
  });

  it.each([
    [
      'a tracked file changed and not committed',
      (web: string) => write(contractsOf(web), { 'capture-a.v1.json': '{"a":2}\n' }),
      /docs\/contracts is not clean/,
    ],
    [
      'an untracked file under docs/contracts',
      (web: string) => write(contractsOf(web), { 'fixtures/new.json': '{}\n' }),
      /docs\/contracts is not clean/,
    ],
    [
      'a README.md of the web’s own under docs/contracts',
      (web: string) => {
        write(contractsOf(web), { 'README.md': 'web\n' });
        commitAll(web);
      },
      /README\.md: those names are ours/,
    ],
  ] as const)('refuses %s, and leaves contracts/ exactly as it was', (_why, spoil, message) => {
    const web = webCheckout();
    const target = ourFolder();
    vendor(web, target);
    const before = tree(target);
    spoil(web);
    expect(() => vendor(web, target)).toThrow(message);
    expect(tree(target)).toEqual(before);
  });

  it('refuses a folder with no docs/contracts, and one that is not a git checkout, touching nothing (an empty input)', () => {
    const target = ourFolder();
    expect(() => vendor(temp(), target)).toThrow(/no docs\/contracts in /);
    const plain = temp();
    write(join(plain, 'docs', 'contracts'), WEB_FILES);
    expect(() => vendor(plain, target)).toThrow(/is not a git checkout/);
    expect(listFiles(target)).toEqual(['README.md']);
  });

  it('vendors with untracked files elsewhere in the web checkout, as the owner’s has today (D-1)', () => {
    const web = webCheckout();
    write(web, { 'm1.txt': 'notes\n', '.claude/settings.json': '{}\n' });
    expect(vendor(web, ourFolder()).added).toEqual([
      'capture-a.v1.json',
      'fixtures/capture-a.v1/valid.json',
    ]);
  });

  it('never writes to the web checkout, not even git’s index refresh', () => {
    const web = webCheckout();
    // A tracked file's mtime moved and its bytes did not: a plain `git status` would refresh the index and rewrite it.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(contractsOf(web), 'capture-a.v1.json'), later, later);
    const index = join(web, '.git', 'index');
    const before = readFileSync(index);
    vendor(web, ourFolder());
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  it('lists files without Finder’s .DS_Store, at any depth, sorted', () => {
    const root = temp();
    write(root, {
      '.DS_Store': 'x',
      'fixtures/.DS_Store': 'x',
      'b.json': '{}',
      'a.json': '{}',
      'fixtures/c/d.json': '{}',
    });
    expect(listFiles(root)).toEqual(['a.json', 'b.json', 'fixtures/c/d.json']);
  });
});
```

- [ ] **Step 3: Run it to watch it fail**

```bash
cd "$WT" && pnpm vitest run --project domain test/vendorContracts.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && grep -m1 -o "Failed to resolve import[^\"]*\|Cannot find module[^\"]*" "$TMPDIR/v.log"
```

Expected: `EXIT=1`, and the import of `../scripts/vendor-contracts.mjs` does not resolve (the suite fails to collect: `numTotalTests` 0).

- [ ] **Step 4: Write the script**

Create `scripts/vendor-contracts.mjs`:

```js
// `pnpm contracts:vendor <path-to-web-checkout>` (plan D spec §3.1, owner ruling R7: pin only).
//
// Copies the files git tracks under the web checkout's docs/contracts, byte for byte, into this repo's contracts/,
// and writes contracts/VENDORED.json: the web commit and the sha256 of every file copied. Run by hand, never in CI.
// It only READS the web checkout: every git call runs with --no-optional-locks, so not even git's index refresh
// writes there. Afterwards, copy the web's five pins and its commit into test/contractPins.test.ts BY HAND, so a
// re-vendor can never move both sides of the pin at once.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'docs/contracts';

/** Ours, never the web's: kept by every run, and pinned by nothing. */
export const OURS = Object.freeze(['README.md', 'VENDORED.json']);

/** Finder's folder metadata (.gitignore ignores it too): never a contract, so never listed. */
const IGNORED = new Set(['.DS_Store']);

/**
 * Every file under `root`, as posix paths relative to it, sorted, Finder's metadata left out.
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function listFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      if (IGNORED.has(entry.name)) return [];
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listFiles(root, path) : [path];
    })
    .sort();
}

/**
 * The sha256 of a file's bytes, as `shasum -a 256` prints it.
 * @param {string} file
 * @returns {string}
 */
export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * @param {string} web
 * @param {...string} args
 * @returns {string}
 */
function git(web, ...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', web, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The files to copy, relative to docs/contracts, after every check, so a refused run touches nothing: `web` holds a
 * docs/contracts, is a git checkout, its docs/contracts is clean (no uncommitted change, no untracked file), and
 * nothing there takes one of OUR names. Untracked files elsewhere in the web checkout do not matter (plan D1, D-1).
 * @param {string} web
 * @returns {string[]}
 */
function trackedContracts(web) {
  if (!existsSync(join(web, SOURCE))) throw new Error(`no ${SOURCE} in ${web}`);
  let dirty;
  try {
    dirty = git(web, 'status', '--porcelain', '--untracked-files=all', '--', SOURCE);
  } catch {
    throw new Error(`${web} is not a git checkout`);
  }
  if (dirty.trim() !== '') throw new Error(`${SOURCE} is not clean in ${web}:\n${dirty}`);
  const files = git(web, 'ls-files', '-z', '--', SOURCE)
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => path.slice(SOURCE.length + 1))
    .sort();
  if (files.length === 0) throw new Error(`git tracks nothing under ${SOURCE} in ${web}`);
  const clash = files.filter((path) => OURS.includes(path));
  if (clash.length > 0) {
    throw new Error(
      `${SOURCE} holds ${clash.join(', ')}: those names are ours (contracts/), refusing to overwrite`,
    );
  }
  return files;
}

/**
 * @param {string} target
 * @returns {Record<string, string>}
 */
function readPins(target) {
  const file = join(target, 'VENDORED.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).files : {};
}

/**
 * Vendors `web`'s docs/contracts into `target`. Everything is checked before anything in `target` is removed.
 * @param {string} web a web checkout, only ever read
 * @param {string} target this repo's contracts/ folder
 * @returns {{ commit: string, added: string[], changed: string[], removed: string[] }}
 */
export function vendor(web, target) {
  const files = trackedContracts(web);
  const commit = git(web, 'rev-parse', 'HEAD').trim();
  mkdirSync(target, { recursive: true });
  const before = readPins(target);
  for (const name of readdirSync(target)) {
    if (!OURS.includes(name)) rmSync(join(target, name), { recursive: true, force: true });
  }
  for (const path of files) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(web, SOURCE, path), join(target, path));
  }
  /** @type {Record<string, string>} */
  const after = Object.fromEntries(files.map((path) => [path, sha256(join(target, path))]));
  writeFileSync(
    join(target, 'VENDORED.json'),
    `${JSON.stringify({ web: commit, files: after }, null, 2)}\n`,
  );
  return {
    commit,
    added: files.filter((path) => !(path in before)),
    changed: files.filter((path) => path in before && before[path] !== after[path]),
    removed: Object.keys(before)
      .filter((path) => !(path in after))
      .sort(),
  };
}

function main() {
  const web = process.argv[2];
  if (web === undefined) {
    console.error('usage: pnpm contracts:vendor <path-to-web-checkout>');
    process.exit(2);
  }
  const target = fileURLToPath(new URL('../contracts/', import.meta.url));
  try {
    const { commit, added, changed, removed } = vendor(resolve(web), target);
    console.log(`vendored web ${commit}`);
    for (const path of added) console.log(`added    ${path}`);
    for (const path of changed) console.log(`changed  ${path}`);
    for (const path of removed) console.log(`removed  ${path}`);
    if (added.length + changed.length + removed.length === 0) console.log('no file changed');
    console.log(
      'Next, by hand: the web commit and its five pins into test/contractPins.test.ts (WEB_COMMIT, WEB_PINS).',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 5: Add the package script**

In `package.json`, after `"i18n:release-check": "node scripts/check-i18n-release.mjs",` add:

```json
    "contracts:vendor": "node scripts/vendor-contracts.mjs",
```

- [ ] **Step 6: Run the test to watch it pass, then the usage check**

```bash
cd "$WT" && pnpm prettier --write scripts/vendor-contracts.mjs test/vendorContracts.test.ts > /dev/null
cd "$WT" && pnpm vitest run --project domain test/vendorContracts.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests)' "$TMPDIR/v.json"
cd "$WT" && pnpm -s contracts:vendor > "$TMPDIR/usage.log" 2>&1; echo "EXIT=$?"; cat "$TMPDIR/usage.log"
```

Expected: `EXIT=0`, `total 10 failed 0`; then `EXIT=2` and `usage: pnpm contracts:vendor <path-to-web-checkout>`.

- [ ] **Step 7: Mutate each guard once**

Back up first: `cd "$WT" && cp scripts/vendor-contracts.mjs "$TMPDIR/vendor.bak"`. For each mutation, edit, run Step 6's vitest line, record which test failed, then `cp "$TMPDIR/vendor.bak" scripts/vendor-contracts.mjs`.

1. Delete the line `if (dirty.trim() !== '') throw new Error(…);` → expected red: the two `not clean` rows of `refuses %s, and leaves contracts/ exactly as it was`.
2. In `vendor`, move `const files = trackedContracts(web);` below the `for (const name of readdirSync(target))` loop → expected red: `refuses %s, and leaves contracts/ exactly as it was` (all three rows).
3. Remove `'--no-optional-locks', ` from `git` → expected red: `never writes to the web checkout, not even git's index refresh`. If it stays green on this machine, record that in the task report as a finding (the test would then be decoration on this filesystem) instead of shipping it silently.
4. Change `const IGNORED = new Set(['.DS_Store']);` to `new Set([])` → expected red: `lists files without Finder's .DS_Store, at any depth, sorted`.

Confirm `diff "$TMPDIR/vendor.bak" scripts/vendor-contracts.mjs` prints nothing at the end.

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
cd "$WT" && pnpm typecheck > "$TMPDIR/tc.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm lint > "$TMPDIR/lint.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm format:check > "$TMPDIR/fmt.log" 2>&1; echo "EXIT=$?"
cd "$WT" && git add scripts/vendor-contracts.mjs test/vendorContracts.test.ts package.json && git commit -q -F - <<'EOF'
feat(contracts): pnpm contracts:vendor, a local byte copy of the web's contracts

Plan D spec §3.1, R7: pin only. Copies the files git tracks under a web
checkout's docs/contracts, records the commit and every sha256 in
contracts/VENDORED.json, and prints what changed. Refuses a dirty
docs/contracts before touching anything; never writes to the web checkout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: three `EXIT=0`.

---

### Task 2: The first vendoring and the pin test

**Files:**

- Create: `test/contractPins.test.ts`
- Create (by the script): `contracts/VENDORED.json`, `contracts/capture-{beat,descriptor,scoring-link,start}.v1.json`, `contracts/capture-qr.v2.json`, `contracts/fixtures/**` (139 files)
- Delete: `test/fixtures/contracts/` (four files)
- Modify: `modules/capture-engine/src/serverBodies.test.ts:1-30` and `:60-71`
- Modify: `modules/capture-engine/src/scoringLinkBodies.test.ts:9`, `modules/capture-engine/src/stageKinds.test.ts:9`, `test/serverScript.test.ts:12-15`
- Modify: `modules/capture-engine/src/wire/server-bodies.json:2` (`about`)
- Modify: `.prettierignore:7-8`

**Interfaces:**

- Consumes: `listFiles`, `OURS`, `pnpm contracts:vendor` (Task 1).
- Produces: `contracts/` with 144 vendored files and `VENDORED.json` (`{ web: string; files: Record<string, string> }`); `serverBodies.test.ts`'s `verdict(ref: string, body: unknown): string[]` now knows all five schemas, `capture-qr.v2.json` included. Contract paths for later tasks: TS tests reach `contracts/` as `new URL('../../../contracts/', import.meta.url)` from `modules/capture-engine/src/`.

- [ ] **Step 1: Write the failing pin test**

Create `test/contractPins.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listFiles, OURS } from '../scripts/vendor-contracts.mjs';

/**
 * The pin (plan D spec §3.1, owner ruling R7: pin only, verified offline, never a fetch of the web repo).
 *
 * contracts/ is a byte copy of the web's docs/contracts at one commit, written by `pnpm contracts:vendor`, which
 * records every file's sha256 in contracts/VENDORED.json. This test holds the folder to that record, file for file.
 *
 * The other side of the pin is the web's own: its capture-contract.test.ts pins the five schemas. Those five values
 * and the commit are copied below BY HAND from apps/web/src/server/api-v1/__tests__/capture-contract.test.ts:48-52
 * at 8afdd8b42 (the same at e201fab8f, staging's commit; the script never writes them), so a re-vendor cannot quietly
 * move both sides at once. WEB_COMMIT is the commit actually vendored (plan D1, D-10).
 */
const WEB_COMMIT = '8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac';
const WEB_PINS: Readonly<Record<string, string>> = {
  'capture-qr.v2.json': '3292e33f84b693e5def6048012f6653ca7e31e1573fda3901da4fe67a62c5d43',
  'capture-descriptor.v1.json': '84e936b72b866df4fc37317e06fc3f6f5555dd2196b10b24efc890b52f28a5d6',
  'capture-beat.v1.json': 'e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736',
  'capture-start.v1.json': '012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae',
  'capture-scoring-link.v1.json':
    'f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f',
};

const root = new URL('../contracts/', import.meta.url);
/** Hashed here with node:crypto, not with the script's helper: the check does not lean on what wrote the record. */
const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(new URL(path, root)))
    .digest('hex');
const vendored = JSON.parse(readFileSync(new URL('VENDORED.json', root), 'utf8')) as {
  readonly web: string;
  readonly files: Readonly<Record<string, string>>;
};
const onDisk = listFiles(fileURLToPath(root)).filter((path) => !OURS.includes(path));

describe('the vendored contracts, pinned (plan D spec §3.1, R7)', () => {
  it('pins 144 files: the five schemas and 139 fixtures (moves only with a re-vendor)', () => {
    const pinned = Object.keys(vendored.files);
    expect(pinned).toHaveLength(144);
    expect(pinned.filter((path) => !path.includes('/'))).toHaveLength(5);
  });

  it('holds exactly the pinned files: none missing, none extra', () => {
    expect(onDisk).toEqual(Object.keys(vendored.files).sort());
  });

  it.each(Object.entries(vendored.files))('%s is byte for byte its pin', (path, pin) => {
    expect(sha256(path)).toBe(pin);
  });

  it('is the web commit this test names', () => {
    expect(vendored.web).toBe(WEB_COMMIT);
  });

  it.each(Object.entries(WEB_PINS))(
    "%s: the web's own pin, VENDORED.json's and the file agree",
    (file, web) => {
      expect(vendored.files[file]).toBe(web);
      expect(sha256(file)).toBe(web);
    },
  );

  it('holds the same five schemas the web pins, no more and no fewer', () => {
    expect(onDisk.filter((path) => !path.includes('/'))).toEqual(Object.keys(WEB_PINS).sort());
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd "$WT" && pnpm vitest run --project domain test/contractPins.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && grep -m1 -o "ENOENT[^\"]*VENDORED.json" "$TMPDIR/v.log"
```

Expected: `EXIT=1`; `ENOENT … contracts/VENDORED.json` (the suite fails to collect).

- [ ] **Step 3: Vendor the web's contracts**

```bash
git -C /Users/ashokhein/github/seazn.club rev-parse HEAD
cd "$WT" && pnpm -s contracts:vendor /Users/ashokhein/github/seazn.club > "$TMPDIR/vendor.log" 2>&1; echo "EXIT=$?"
cd "$WT" && head -1 "$TMPDIR/vendor.log"; grep -c '^added ' "$TMPDIR/vendor.log"; grep -c '^changed \|^removed ' "$TMPDIR/vendor.log"
```

Expected: `8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac` (or `e201fab8fc3c67cc8bfb9a1df44490b75c3a1888`: then write that full sha as `WEB_COMMIT` in `test/contractPins.test.ts` and in the README of Task 6, and nothing else changes); `EXIT=0`; `vendored web <that sha>`; `144`; `0`. If `HEAD` is neither, run `git -C /Users/ashokhein/github/seazn.club --no-optional-locks diff --quiet 8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac HEAD -- docs/contracts; echo "EXIT=$?"`: on `EXIT=0` proceed the same way with that sha; otherwise stop and report (Global Constraints, _The web commit_).

Then confirm the spec's claim about today's copies before deleting them:

```bash
cd "$WT" && for f in capture-beat.v1.json capture-descriptor.v1.json capture-scoring-link.v1.json capture-start.v1.json; do cmp -s "test/fixtures/contracts/$f" "contracts/$f" && echo "same $f" || echo "DIFF $f"; done
cd "$WT" && shasum -a 256 test/fixtures/contracts/capture-descriptor.v1.json contracts/capture-descriptor.v1.json
```

Expected: `same` for beat, scoring-link and start; `DIFF capture-descriptor.v1.json`; `45fc9ad7…` then `84e936b7…`.

- [ ] **Step 4: Run the pin test to watch it pass**

Run Step 2's first command, then the count line from Global Constraints. Expected: `EXIT=0`, `total 153 failed 0` (2 + 144 + 1 + 5 + 1).

- [ ] **Step 5: Mutate the pin once each way**

```bash
cd "$WT" && cp contracts/fixtures/capture-qr.v2/valid.json "$TMPDIR/valid.json.bak" && printf ' ' >> contracts/fixtures/capture-qr.v2/valid.json
cd "$WT" && pnpm vitest run --project domain test/contractPins.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);for(const f of r.testResults)for(const a of f.assertionResults)if(a.status==="failed")console.log(a.title)' "$TMPDIR/v.json"
cd "$WT" && cp "$TMPDIR/valid.json.bak" contracts/fixtures/capture-qr.v2/valid.json
```

Expected: `EXIT=1`, one failure: `fixtures/capture-qr.v2/valid.json is byte for byte its pin`. Then, the same way: create `contracts/fixtures/extra.json` containing `{}` (expected failure: `holds exactly the pinned files: none missing, none extra`; then `rm` it), and change the first hex digit of `WEB_PINS['capture-beat.v1.json']` in a `cp` backup of the test (expected failure: `capture-beat.v1.json: the web's own pin, VENDORED.json's and the file agree`; then restore). End with Step 4 green again.

- [ ] **Step 6: Move every consumer to `contracts/` and delete the old copies**

In `modules/capture-engine/src/serverBodies.test.ts`, replace everything from line 1 down to and including the `for (const file of Object.keys(PINNED)) { … }` loop (lines 1-30) with:

```ts
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import beats from './wire/beat-bodies.json';
import probe from './wire/scripted-probe.json';
import vectors from './wire/server-bodies.json';

/**
 * Review C4a m-4: the made-up server bodies the native tests answer with are the web's contract
 * shapes, checked here with ajv, so a fixture that drifts from the contract reds. PairWire.kt and the
 * host's ScriptedServer.kt each assert their bodies equal these vectors.
 */

/** The vendored contracts (plan D spec §3.1), pinned file for file by test/contractPins.test.ts. */
const contracts = new URL('../../../contracts/', import.meta.url);
const text = (file: string) => readFileSync(new URL(file, contracts), 'utf8');
/** The schemas: VENDORED.json's top-level files. The fixtures sit in folders below them. */
const SCHEMAS = Object.keys(
  (JSON.parse(text('VENDORED.json')) as { files: Record<string, string> }).files,
).filter((path) => !path.includes('/'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const ids = new Map<string, string>();
for (const file of SCHEMAS) {
  const schema = JSON.parse(text(file)) as { $id: string };
  ajv.addSchema(schema);
  ids.set(file, schema.$id);
}
```

In the same file, replace the two tests `it.each(Object.entries(PINNED))('%s is the pinned copy', …)` and `it('pins exactly the contracts in the folder', …)` (with the comment above the second) by:

```ts
// The pin itself is test/contractPins.test.ts; here, that every vendored schema reached ajv.
it('registers the five vendored schemas, the QR among them', () => {
  expect([...SCHEMAS].sort()).toEqual([
    'capture-beat.v1.json',
    'capture-descriptor.v1.json',
    'capture-qr.v2.json',
    'capture-scoring-link.v1.json',
    'capture-start.v1.json',
  ]);
});
```

In `modules/capture-engine/src/scoringLinkBodies.test.ts:9` replace `'../../../test/fixtures/contracts/capture-scoring-link.v1.json'` with `'../../../contracts/capture-scoring-link.v1.json'`.

In `modules/capture-engine/src/stageKinds.test.ts:9` replace `'../../../test/fixtures/contracts/capture-descriptor.v1.json'` with `'../../../contracts/capture-descriptor.v1.json'`.

In `test/serverScript.test.ts`, replace

```ts
 * host's own are (C4a m-4, serverBodies.test.ts): the pinned copies, through ajv.
 */
const contracts = new URL('./fixtures/contracts/', import.meta.url);
```

with

```ts
 * host's own are (C4a m-4, serverBodies.test.ts): the vendored copies (contracts/), through ajv.
 */
const contracts = new URL('../contracts/', import.meta.url);
```

In `modules/capture-engine/src/wire/server-bodies.json`'s `about`, replace `The contracts are test/fixtures/contracts/, copied from the web repo at 7e75fd4a7 and pinned there by sha256.` with `The contracts are contracts/, vendored from the web repo (contracts/VENDORED.json names the commit) and pinned by test/contractPins.test.ts.`

In `.prettierignore`, replace

```
# The web's contracts, copied byte for byte and pinned by sha256 (review C4a m-4): never reformatted.
test/fixtures/contracts/
```

with

```
# The web's contracts, vendored byte for byte and pinned by sha256 (plan D spec §3.1): never reformatted.
# contracts/README.md is ours and stays formatted.
contracts/*.json
contracts/fixtures/
```

Then delete the old copies and prove nothing names them:

```bash
cd "$WT" && git rm -r -q test/fixtures/contracts
cd "$WT" && git grep -n "fixtures/contracts" -- src modules test app scripts .prettierignore package.json; echo "GREP_EXIT=$?"
```

Expected: no line, `GREP_EXIT=1`.

- [ ] **Step 7: Run every consumer and the pin**

```bash
cd "$WT" && pnpm prettier --write test/contractPins.test.ts modules/capture-engine/src/serverBodies.test.ts modules/capture-engine/src/scoringLinkBodies.test.ts modules/capture-engine/src/stageKinds.test.ts test/serverScript.test.ts modules/capture-engine/src/wire/server-bodies.json > /dev/null
cd "$WT" && pnpm vitest run --project domain test/contractPins.test.ts modules/capture-engine/src/serverBodies.test.ts modules/capture-engine/src/scoringLinkBodies.test.ts modules/capture-engine/src/stageKinds.test.ts test/serverScript.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
cd "$WT" && pnpm typecheck > "$TMPDIR/tc.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm lint > "$TMPDIR/lint.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm format:check > "$TMPDIR/fmt.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm prettier --check contracts/README.md > "$TMPDIR/p.log" 2>&1; echo "EXIT=$?"
```

Expected: every `EXIT=0`, five files `passed`, `failed 0`. Record the total. (`stageKinds.test.ts` still finds 15 kinds in 6 branches: the descriptor's diff touched only `stage.label`'s description.)

- [ ] **Step 8: Commit**

```bash
cd "$WT" && git add contracts test/contractPins.test.ts modules/capture-engine/src/serverBodies.test.ts modules/capture-engine/src/scoringLinkBodies.test.ts modules/capture-engine/src/stageKinds.test.ts test/serverScript.test.ts modules/capture-engine/src/wire/server-bodies.json .prettierignore && git commit -q -F - <<'EOF'
feat(contracts): vendor the web's contracts, pinned both sides

Plan D spec §3.1. contracts/ is a byte copy of the web's docs/contracts
(5 schemas, 139 fixtures), VENDORED.json pins every file, and
test/contractPins.test.ts holds the five schema pins equal to the web's
own, copied by hand. test/fixtures/contracts/ is gone; its readers use
contracts/. The descriptor moves 45fc9ad7 -> 84e936b7 (description only);
capture-qr.v2.json is vendored for the first time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
cd "$WT" && git status --short
```

Expected: `git status --short` is empty (the deletion is staged with `git rm`).

---

### Task 3: The QR vectors and the round line, checked against the vendored files

**Files:**

- Create: `modules/capture-engine/src/qrContract.test.ts`
- Create: `modules/capture-engine/src/stageFixtures.test.ts`
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/Vendored.kt`
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/adapter/StageFixturesTest.kt`
- Modify: `modules/capture-engine/android/core/build.gradle.kts` (the `tasks.test` block, after the `scrubVectors` input)
- Modify: `modules/capture-engine/src/wire/waiting-vectors.json` (five rows)

**Interfaces:**

- Consumes: `contracts/capture-qr.v2.json`, `contracts/fixtures/capture-qr.v2/*.json`, `contracts/fixtures/capture-descriptor.v1/{valid-waiting-stage,valid-live-stage,valid-waiting-stage-label-40,invalid-stage-label-41}.json` (Task 2); `parseStreamCode(input: unknown): Result<StreamCode, WireError>` (`src/domain/credentials/streamCode.ts`); `parseWaitingFields(input: unknown, host: string): WaitingFields | null` (`src/domain/credentials/waitingFields.ts`); `Bodies.waiting(fields: Map<String, Any?>, env: Environment): WaitingFields?` and `WaitingFields.stageLabel: String?` (Kotlin); `JsonReader.parse(text: String): Any?`; `internal val String.characters: Int` (`core/Beats.kt:65`).
- Produces: the Gradle system property `capture.contracts` (the repo's `contracts/` folder) and `object Vendored { fun text(path: String): String }` in the core test sources, for any later Kotlin test that reads a vendored file.

- [ ] **Step 1: Write the QR test**

Create `modules/capture-engine/src/qrContract.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parseStreamCode } from '@/domain/credentials/streamCode';
import vectors from './wire/code-vectors.json';

/**
 * Plan D spec §3.2: the QR, held to the vendored capture-qr.v2.json for the first time. A vector the schema
 * refuses is one the parser refuses, and the reverse; the verdict each row expects is the vector file's, written by
 * hand (carry G1), never the parser's.
 */
const contracts = new URL('../../../contracts/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('capture-qr.v2.json', contracts), 'utf8')) as {
  $id: string;
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaAdmits = ajv.compile(schema);

const qr = (overrides: Record<string, unknown>) => ({
  v: 2,
  code: 'fx42hmnp7k2q',
  slot: 1,
  tok: 'tok-9f3c2a7e5b1d4680ab',
  ...overrides,
});
const rows = [
  ...vectors.codes.map((row) => [`code: ${row.why}`, qr({ code: row.value }), row.ok] as const),
  ...vectors.tokens.map((row) => [`token: ${row.why}`, qr({ tok: row.value }), row.ok] as const),
];

describe("the phone's QR vectors against capture-qr.v2.json (plan D §3.2)", () => {
  it('sweeps 31 rows: 17 codes and 14 tokens, 8 the schema admits and 23 it refuses', () => {
    expect(rows).toHaveLength(31);
    expect(rows.filter(([, , ok]) => ok)).toHaveLength(8);
  });

  it.each(rows)('%s: the schema and the parser give the row its verdict', (_why, body, ok) => {
    expect(schemaAdmits(body)).toBe(ok);
    expect(parseStreamCode(body).ok).toBe(ok);
  });
});

const FIXTURES = new URL('fixtures/capture-qr.v2/', contracts);
const fixtures = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .sort();
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));

/**
 * The one fixture the schema refuses and the parser reads (plan D1, D-2): a valid QR plus a `cred` key, which the
 * schema's `additionalProperties: false` refuses and the parser drops, keeping nothing of it (streamCode.test.ts,
 * "keeps nothing a mis-issued code carries beyond the four fields"). Named here, so changing either side is a decision.
 */
const TOLERATED = new Set(['tampered.json']);

describe("the web's QR fixtures through the parser (plan D §3.2)", () => {
  it('reads all 12: 3 valid, 7 invalid, tampered and wrong-version', () => {
    expect(fixtures).toHaveLength(12);
    expect(fixtures.filter((name) => name.startsWith('valid'))).toEqual([
      'valid-exp-zero.json',
      'valid-exp.json',
      'valid.json',
    ]);
    expect(fixtures.filter((name) => name.startsWith('invalid'))).toHaveLength(7);
  });

  // The web names a fixture the schema admits `valid…`; every other name is one it refuses.
  it.each(fixtures)('%s: the parser refuses what the schema refuses', (name) => {
    const body = fixture(name);
    const admitted = name.startsWith('valid');
    expect(schemaAdmits(body)).toBe(admitted);
    expect(parseStreamCode(body).ok).toBe(admitted || TOLERATED.has(name));
  });

  it('keeps nothing of what the tolerated fixture carries beyond the schema', () => {
    const read = parseStreamCode(fixture('tampered.json'));
    expect(read.ok && Object.keys(read.value).sort()).toEqual([
      'code',
      'expiresAt',
      'slot',
      'token',
    ]);
  });
});
```

- [ ] **Step 2: Write the round-line tests, TS and Kotlin**

Create `modules/capture-engine/src/stageFixtures.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWaitingFields } from '@/domain/credentials/waitingFields';

/**
 * Plan D spec §3.2: the web's round-line fixtures (the label reshaped on 2026-10-08) through the TS waiting-fields
 * parser. The labels are the spec's and the fixtures' own text, written out here; StageFixturesTest.kt holds
 * Bodies.waiting to the same four.
 */
const FIXTURES = new URL('../../../contracts/fixtures/capture-descriptor.v1/', import.meta.url);
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')) as Record<string, unknown>;
const STAGING = 'stg.seazn.club';

describe("the web's round-line fixtures, through parseWaitingFields (plan D §3.2)", () => {
  it.each([
    ['valid-waiting-stage', 'Open · Group A · Round 1'],
    ['valid-live-stage', 'Open · QF'],
    ['valid-waiting-stage-label-40', 'Girls Under-14 Championship · Round 1234'],
  ])('%s shows its label verbatim', (name, label) => {
    expect(parseWaitingFields(fixture(name), STAGING)?.stage?.label).toBe(label);
  });

  it('shows 40 characters and no line at 41, the rest of the answer still read', () => {
    expect([...'Girls Under-14 Championship · Round 1234']).toHaveLength(40);
    const raw = fixture('invalid-stage-label-41');
    expect([...(raw.stage as { label: string }).label]).toHaveLength(41);
    const read = parseWaitingFields(raw, STAGING);
    expect(read).not.toBeNull();
    expect(read?.stage).toBeNull();
    expect(read?.label).toBe('Northside Hawks v Riverside Rovers');
  });
});
```

Create `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/Vendored.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.io.File

/** A file of the web's contracts, vendored under the repo's `contracts/` (plan D spec §3.1), by its path there. */
object Vendored {
  fun text(path: String): String {
    val root = System.getProperty("capture.contracts") ?: error("capture.contracts is not set: run through Gradle")
    return File(root, path).readText(Charsets.UTF_8)
  }
}
```

Create `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/adapter/StageFixturesTest.kt`:

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.Vendored
import com.seazn.capture.engine.core.characters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Plan D spec §3.2: the web's round-line fixtures through Bodies.waiting, the reader of the waiting fields. Read
 * there and not through Bodies.code: valid-live-stage's cred names a host native refuses (plan D1, D-9). The labels
 * are the fixtures' own text, written out; stageFixtures.test.ts holds the TS parser to the same four.
 */
class StageFixturesTest {
  @Suppress("UNCHECKED_CAST")
  private fun fixture(name: String): Map<String, Any?> =
    JsonReader.parse(Vendored.text("fixtures/capture-descriptor.v1/$name.json")) as Map<String, Any?>

  @Test
  fun `the web's round-line fixtures show their label verbatim`() {
    val rows =
      listOf(
        "valid-waiting-stage" to "Open · Group A · Round 1",
        "valid-live-stage" to "Open · QF",
        "valid-waiting-stage-label-40" to "Girls Under-14 Championship · Round 1234",
      )
    for ((name, label) in rows) assertEquals(label, Bodies.waiting(fixture(name), Environment.STAGING)?.stageLabel, name)
  }

  @Test
  fun `40 characters show and 41 are no line, the rest still read`() {
    assertEquals(40, "Girls Under-14 Championship · Round 1234".characters)
    val raw = fixture("invalid-stage-label-41")
    assertEquals(41, ((raw["stage"] as Map<*, *>)["label"] as String).characters)
    val read = assertNotNull(Bodies.waiting(raw, Environment.STAGING))
    assertNull(read.stageLabel)
    assertEquals("Northside Hawks v Riverside Rovers", read.label)
  }
}
```

- [ ] **Step 3: Run them; the Kotlin one fails for want of the property**

```bash
cd "$WT" && pnpm prettier --write modules/capture-engine/src/qrContract.test.ts modules/capture-engine/src/stageFixtures.test.ts > /dev/null
cd "$WT" && pnpm vitest run --project domain modules/capture-engine/src/qrContract.test.ts modules/capture-engine/src/stageFixtures.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests)' "$TMPDIR/v.json"
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.adapter.StageFixturesTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
grep -m1 -o "capture.contracts is not set[^\"]*" "$TMPDIR/g.log"
```

Expected: the TS files pass at once, `total 50 failed 0` (32 + 14 + 4): they characterise readers that already hold the contract, so Step 6's mutations are what prove they can fail. The Kotlin run is `EXIT=1` with `capture.contracts is not set: run through Gradle`.

- [ ] **Step 4: Give the Kotlin tests the vendored folder**

In `modules/capture-engine/android/core/build.gradle.kts`, inside `tasks.test { … }`, directly after the block that ends `.withPropertyName("scrubVectors")` and its `.withPathSensitivity(PathSensitivity.RELATIVE)`, add:

```kotlin
  // Plan D spec §3.1: the web's contracts, vendored at the repo root. The round-line fixtures are read from there
  // (StageFixturesTest), under the same rule as the vectors: a re-vendor reruns the tests.
  systemProperty("capture.contracts", layout.projectDirectory.dir("../../../../contracts").asFile.absolutePath)
  inputs
    .dir(layout.projectDirectory.dir("../../../../contracts"))
    .withPropertyName("vendoredContracts")
    .withPathSensitivity(PathSensitivity.RELATIVE)
```

Run Step 3's Gradle line and the Kotlin count. Expected: `EXIT=0`, `{ tests: 2, failures: 0, errors: 0 }`.

- [ ] **Step 5: Bring the "QF" waiting vectors to the reshaped label**

`wire/waiting-vectors.json` row "stage: a label with a known kind" shows `"label": "QF"` as the round line, the pre-2026-10-08 shape for an unpooled match ("exactly the code"); four negative rows use the same old-shape label as their good label. Change those five labels, and row one's expected `stageLabel`, to the reshaped `Open · QF` (the web's `valid-live-stage`), leaving every `"code": "QF"` and the row with `"stage": "QF"` (not an object) as they are:

```bash
cd "$WT" && node -e '
const fs = require("fs");
const p = "modules/capture-engine/src/wire/waiting-vectors.json";
let text = fs.readFileSync(p, "utf8");
const swap = (why, from, to) => {
  const at = text.indexOf(`"why": "${why}"`);
  if (at < 0) throw new Error(`no row: ${why}`);
  const next = text.indexOf("\"why\":", at + 1);
  const hit = text.indexOf(from, at);
  if (hit < 0 || (next > 0 && hit > next)) throw new Error(`no ${from} in row: ${why}`);
  text = text.slice(0, hit) + to + text.slice(hit + from.length);
};
const LABEL = "\"label\": \"QF\"";
const RESHAPED = "\"label\": \"Open · QF\"";
swap("stage: a label with a known kind", LABEL, RESHAPED);
swap("stage: a label with a known kind", "\"stageLabel\": \"QF\"", "\"stageLabel\": \"Open · QF\"");
swap("stage: no role shows nothing", LABEL, RESHAPED);
swap("stage: a role kind that is not a string shows nothing", LABEL, RESHAPED);
swap("stage: a null role shows nothing", LABEL, RESHAPED);
swap("stage: a role that is not an object shows nothing", LABEL, RESHAPED);
fs.writeFileSync(p, text);
console.log("swapped 6");'
cd "$WT" && pnpm prettier --write modules/capture-engine/src/wire/waiting-vectors.json > /dev/null
cd "$WT" && grep -c '"label": "QF"\|"stageLabel": "QF"' modules/capture-engine/src/wire/waiting-vectors.json; grep -c 'Open · QF' modules/capture-engine/src/wire/waiting-vectors.json
```

Expected: `swapped 6`; `0`; `6`. Both readers of the file still agree with it (TS `waitingVectors.test.ts`; Kotlin `BodiesTest`, whose `staged` count stays 3):

```bash
cd "$WT" && pnpm vitest run --project domain modules/capture-engine/src/waitingVectors.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.adapter.BodiesTest' --tests 'com.seazn.capture.engine.adapter.StageFixturesTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Mutate each reader once**

Back up, mutate, run, restore from the backup (never `git checkout`):

1. `src/domain/credentials/waitingFields.ts`: `const STAGE = { min: 1, max: 40 };` → `max: 41`. Run `stageFixtures.test.ts`. Expected red: `shows 40 characters and no line at 41, the rest of the answer still read` (and `waitingVectors.test.ts`'s 41-character row, if run).
2. `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/adapter/Bodies.kt`: `private val STAGE_LABEL = 1..40` → `1..41`. Run `StageFixturesTest`. Expected red: `40 characters show and 41 are no line, the rest still read`.
3. `src/domain/credentials/streamCode.ts`, in `readExp`: `readInteger(input, 'exp', 0)` → `readInteger(input, 'exp', -1)`. Run `qrContract.test.ts`. Expected red: `invalid-exp-negative.json: the parser refuses what the schema refuses`.

After each, `diff` the file against its backup and confirm it prints nothing.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
cd "$WT" && pnpm typecheck > "$TMPDIR/tc.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm lint > "$TMPDIR/lint.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm format:check > "$TMPDIR/fmt.log" 2>&1; echo "EXIT=$?"
cd "$WT" && git add modules/capture-engine/src/qrContract.test.ts modules/capture-engine/src/stageFixtures.test.ts modules/capture-engine/src/wire/waiting-vectors.json modules/capture-engine/android/core/build.gradle.kts modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/Vendored.kt modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/adapter/StageFixturesTest.kt && git commit -q -F - <<'EOF'
test(contracts): the QR vectors and the round line against the vendored files

Plan D spec §3.2. The phone's 31 QR vectors and the web's 12 QR fixtures
go through ajv and parseStreamCode, one tolerated exception named (the
tampered fixture's extra key, dropped). The web's round-line fixtures go
through parseWaitingFields and Bodies.waiting: verbatim at 40 characters,
no line at 41. The waiting vectors' "QF" labels take the reshaped form.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Every beat sent, in the record

**Files:**

- Create: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/BeatLog.kt`
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Phase.kt:72-73` (`PairingState`, after `lastBeatLine`)
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/SessionMachine.kt`: `reduce` (`:37-44`), `end` (`:137-155`), `Heartbeats.tick` (`:591-608`), `Heartbeats.answered` (`:610-651`; the held-beat line at `:627-639`)
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/BeatLogTest.kt`
- Modify: `modules/capture-engine/src/scrub/allow-list.json` (`kinds`, `scalars`)
- Modify: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/ScrubParityTest.kt:78,85`
- Modify: `src/services/scrubParity.test.ts:64-68`
- Modify: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/ProjectionPairedTest.kt:153-158` (the held-beat test, flipped first: N25)
- Possibly modify: core tests that assert an exact command list containing a beat send, or one line per held beat (Step 8)

**Interfaces:**

- Consumes: `Now(monoMs, wallMs)`; `RecordEntry(kind, fields)`; `Command.Record(entry)`, `Command.PostHeartbeat(beatId, …)`; `BeatCadence.intervalMs(pollSeconds, held): Long`; `Phase.beating: PairingState?` (null while permissions are asked and once Ended, `Phase.kt:247`) and `Phase.pairing: PairingState?` (`Phase.kt:233`); `ServerWord.ofBeat`; the test `MachineRig` (`paired()`, `hear()`, `live()`, `advance()`, `records(kind)`, `sent<T>()`) and `RecordEntry.field(key)`.
- Produces: `data class BeatLog` with `send(beatId: Int, intervalMs: Long?, held: Boolean, now: Now): Pair<BeatLog, List<RecordEntry>>`, `heard(word: String?, ok: Boolean): BeatLog`, `minuteLine(): RecordEntry?`; `PairingState.beatLog: BeatLog`; `internal object BeatLogs { fun closed(before: Phase, step: Step): Step }`; record kinds `beat-interval` `{intervalMs, sinceLastMs, held}` and `beats` `{minuteEpochMs, sent, failed, word}` (D-4).

- [ ] **Step 1: Write the failing tests**

Create `BeatLogTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Plan D spec §3.4: every beat sent, in the record, summarised (plan D1, D-3 and D-4): a `beat-interval` line when the
 * cadence changes, a `beats` line per minute a beat went. The minutes are worked by hand: the rig's wall clock starts
 * at 1_790_000_000_000 ms (2026-09-21T14:13:20.000Z) = 29_833_333 × 60_000 + 20_000, so 20 s into the minute that
 * starts at 1_789_999_980_000 (minute A).
 */
class BeatLogTest {
  private val minuteA = 1_789_999_980_000L

  /** [ms] after the rig's start, on both clocks. */
  private fun at(ms: Long) = Now(ms, 1_790_000_000_000L + ms)

  private fun interval(intervalMs: Long, sinceLastMs: Long?, held: Boolean) =
    RecordEntry("beat-interval", listOf("intervalMs" to intervalMs, "sinceLastMs" to sinceLastMs, "held" to held))

  private fun minute(minuteEpochMs: Long, sent: Int, failed: Int, word: String?) =
    RecordEntry("beats", listOf("minuteEpochMs" to minuteEpochMs, "sent" to sent, "failed" to failed, "word" to word))

  private fun beats(commands: List<Command>): List<RecordEntry> =
    commands.filterIsInstance<Command.Record>().map { it.entry }.filter { it.kind == "beats" }

  @Test
  fun `the first beat writes its interval, with no beat before it`() {
    val (log, lines) = BeatLog().send(1, 60_000, held = false, at(0))
    assertEquals(listOf(interval(60_000, null, false)), lines)
    assertEquals(1, log.sent)
  }

  @Test
  fun `a change of cadence is a line with the gap since the beat before, and the same cadence is none`() {
    val (first, _) = BeatLog().send(1, 60_000, held = false, at(0))
    // 60 s after the start is 20 s into the next minute: the closed minute's line, and no interval line.
    val (second, same) = first.send(2, 60_000, held = false, at(60_000))
    assertEquals(listOf("beats"), same.map { it.kind })
    val (_, changed) = second.send(3, 10_000, held = true, at(67_500))
    assertEquals(listOf(interval(10_000, 7_500, true)), changed)
  }

  @Test
  fun `a minute's beats are one line, written by the first beat of the next minute`() {
    var log = BeatLog()
    val lines = mutableListOf<RecordEntry>()
    // 0, 10, 20 and 30 s after the start are 20, 30, 40 and 50 s into minute A; the third beat's answer fails.
    for ((id, s) in listOf(0L, 10L, 20L, 30L).withIndex()) {
      val (sent, written) = log.send(id + 1, 10_000, held = false, at(s * 1_000))
      lines += written
      log = sent.heard("NoBroadcast", ok = s != 20L)
    }
    assertEquals(listOf(interval(10_000, null, false)), lines)
    val (_, next) = log.send(5, 10_000, held = false, at(40_000))
    assertEquals(listOf(minute(minuteA, sent = 4, failed = 1, word = "NoBroadcast")), next)
  }

  @Test
  fun `a minute with no beat writes no line, and a log that sent nothing has none to write (an empty input)`() {
    val (first, _) = BeatLog().send(1, 60_000, held = false, at(0))
    // 130 s after the start is 30 s into the minute after next: the minute between had no beat.
    val (_, lines) = first.send(2, 60_000, held = false, at(130_000))
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = null)), lines)
    assertNull(BeatLog().minuteLine())
  }

  @Test
  fun `three hours paired at 10 s are one interval line and one line a minute, counting every beat sent`() {
    val rig = MachineRig().paired()
    rig.beats = { HeartbeatResponse.Answered(200, BeatReply("waiting", null, null, null, Configs.waiting(10))) }
    rig.hear("waiting")
    rig.advance(3 * 60 * 60 * 1_000L)
    rig.send(Input.Unpair)
    // Before the first answer the cadence is BeatCadence.DEFAULT_POLL_S, 10 s, and the server keeps 10: one line.
    assertEquals(listOf(interval(10_000, null, false)), rig.records("beat-interval"))
    val minutes = rig.records("beats")
    assertEquals(rig.sent<Command.PostHeartbeat>().size, minutes.sumOf { it.field("sent") as Int })
    // 20 s into minute A to 20 s into minute A + 180: 181 minutes, the first (4 beats) and the last (3) partial.
    assertEquals(181, minutes.size)
    assertEquals(listOf(4, 3), listOf(minutes.first().field("sent"), minutes.last().field("sent")))
    assertTrue(minutes.drop(1).dropLast(1).all { it.field("sent") == 6 }, "a whole minute at 10 s is 6 beats")
    assertTrue(minutes.all { it.field("failed") == 0 && it.field("word") == "NoBroadcast" })
  }

  @Test
  fun `the open minute is written once when the operator unpairs, and never again (a second call)`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "NoBroadcast")), beats(rig.send(Input.Unpair)))
    assertEquals(emptyList(), beats(rig.send(Input.Unpair)))
  }

  @Test
  fun `an answer that comes twice is counted once (a second call)`() {
    val rig = MachineRig().paired()
    val answer = Input.HeartbeatAnswered(rig.phase.beating!!.heartbeat.inFlightId!!, HeartbeatResponse.Answered(503))
    rig.send(answer)
    rig.send(answer)
    assertEquals(1, beats(rig.send(Input.Unpair)).single().field("failed"))
  }

  @Test
  fun `a beat that never comes back counts as failed (after an interruption)`() {
    val rig = MachineRig().paired()
    // The claim at 0 is never answered: at 10 s it is given up (Heartbeat.TIMEOUT_MS) and the next beat goes.
    rig.advance(10_000)
    val line = beats(rig.send(Input.Unpair)).single()
    assertEquals(listOf<Any?>(2, 1), listOf(line.field("sent"), line.field("failed")))
  }

  @Test
  fun `a pairing that never beat writes no minute (an empty input)`() {
    val rig = MachineRig()
    rig.permissions = null
    rig.send(Input.Pair(rig.request, Configs.PHONE, stopped = null))
    assertEquals(emptyList(), beats(rig.send(Input.Unpair)))
  }

  @Test
  fun `a re-pair writes the old pairing's minute and starts its own log (another pairing)`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.send(Input.Pair(rig.request, Configs.PHONE, stopped = null))
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "NoBroadcast")), rig.records("beats"))
    assertEquals(listOf(interval(10_000, null, false), interval(10_000, null, false)), rig.records("beat-interval"))
  }

  @Test
  fun `a Stop from air counts the final beat and writes the minute`() {
    val rig = MachineRig().live()
    val before = rig.sent<Command.PostHeartbeat>().size
    val stop = rig.send(Input.Stop)
    assertEquals(before + 1, rig.sent<Command.PostHeartbeat>().size, "the final beat (A8)")
    assertEquals(1, beats(stop).size)
    assertEquals(rig.sent<Command.PostHeartbeat>().size, rig.records("beats").sumOf { it.field("sent") as Int })
  }

  @Test
  fun `both lines pass the record's scrub as written`() {
    val written = mutableListOf<String>()
    val record = SessionRecord { written += it }
    record.append(1_790_000_000_000L, interval(10_000, 7_500, true))
    record.append(1_790_000_000_000L, minute(minuteA, sent = 6, failed = 1, word = "NoBroadcast"))
    assertEquals(
      listOf(
        """{"at":"2026-09-21T14:13:20.000Z","kind":"beat-interval","intervalMs":10000,"sinceLastMs":7500,"held":true}""",
        """{"at":"2026-09-21T14:13:20.000Z","kind":"beats","minuteEpochMs":1789999980000,"sent":6,"failed":1,"word":"NoBroadcast"}""",
      ),
      written,
    )
  }
}
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.BeatLogTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
grep -m2 "Unresolved reference" "$TMPDIR/g.log"
```

Expected: `EXIT=1`, `Unresolved reference 'BeatLog'` (compilation).

- [ ] **Step 3: Write `BeatLog`**

Create `BeatLog.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * Plan D spec §3.4: every beat sent, in the session record, in every build. The record anyone reads after a match is
 * Diagnostics' Share record, the app's last 1,000 lines (`RECORD_CAPACITY`), and a line per beat is about 1,100 over a
 * three-hour match at 10 s. So the beats are summarised, as the spec provides (plan D1, D-3, D-4): a `beat-interval`
 * line each time the cadence the phone beats at changes, with the gap since the beat before, and a `beats` line for
 * each wall-clock minute in which a beat went: how many went, how many failed or never came back, and the last answer
 * word. A minute with no beat writes no line; an answer counts in the minute of the beat before it.
 *
 * Pure, held in the pairing. The machine writes the open minute when the pairing stops beating ([BeatLogs.closed]).
 */
data class BeatLog(
  /** This pairing's first beat. Beat ids never repeat across pairings, so it tells one pairing's log from the next. */
  val firstBeatId: Int? = null,
  /** The cadence of the last beat sent on the cadence, as [BeatCadence.intervalMs] gave it. */
  val intervalMs: Long? = null,
  /** The last beat sent, on the monotonic clock. */
  val lastSentMonoMs: Long? = null,
  /** The start of the minute being counted, on the wall clock (UTC). */
  val minuteEpochMs: Long? = null,
  val sent: Int = 0,
  val failed: Int = 0,
  /** The last answer word heard in the minute, as the `heartbeat` line writes it, or null. */
  val word: String? = null,
) {
  /**
   * Beat [beatId] goes now. [intervalMs] is its cadence, or null for the A8 final beat, which goes once, off the
   * cadence: counted, with no interval line. Returns the closed minute's line when a new minute opens, and the
   * interval line when the cadence changed.
   */
  fun send(beatId: Int, intervalMs: Long?, held: Boolean, now: Now): Pair<BeatLog, List<RecordEntry>> {
    val minute = now.wallMs - now.wallMs.mod(MINUTE_MS)
    val closed = if (minuteEpochMs != null && minuteEpochMs != minute) listOfNotNull(minuteLine()) else emptyList()
    val counting = if (minuteEpochMs == minute) this else copy(minuteEpochMs = minute, sent = 0, failed = 0, word = null)
    val changed =
      if (intervalMs == null || intervalMs == this.intervalMs) emptyList()
      else listOf(RecordEntry("beat-interval", listOf("intervalMs" to intervalMs, "sinceLastMs" to lastSentMonoMs?.let { now.monoMs - it }, "held" to held)))
    val next =
      counting.copy(
        firstBeatId = firstBeatId ?: beatId,
        intervalMs = intervalMs ?: this.intervalMs,
        lastSentMonoMs = now.monoMs,
        sent = counting.sent + 1,
      )
    return next to closed + changed
  }

  /** A beat's answer ([ok] for a 2xx), or a beat given up ([word] null, not [ok]). */
  fun heard(word: String?, ok: Boolean): BeatLog = copy(failed = if (ok) failed else failed + 1, word = word ?: this.word)

  /** The counted minute's line, or null when no beat went in it. */
  fun minuteLine(): RecordEntry? {
    val minute = minuteEpochMs ?: return null
    if (sent == 0) return null
    return RecordEntry("beats", listOf("minuteEpochMs" to minute, "sent" to sent, "failed" to failed, "word" to word))
  }

  companion object {
    const val MINUTE_MS = 60_000L
  }
}

/**
 * The open minute's line when a pairing stops beating, whatever the input: unpaired, ended (an operator Stop's final
 * beat included, from the Ended pairing's log), or left for a re-pair. One place, so no end path can forget it.
 */
internal object BeatLogs {
  fun closed(before: Phase, step: Step): Step {
    val log = before.beating?.beatLog ?: return step
    val first = log.firstBeatId ?: return step
    if (step.phase.beating?.beatLog?.firstBeatId == first) return step
    val last = step.phase.pairing?.beatLog?.takeIf { it.firstBeatId == first } ?: log
    val line = last.minuteLine() ?: return step
    return step.copy(commands = step.commands + Command.Record(line))
  }
}
```

- [ ] **Step 4: Hold it in the pairing and feed it**

`Phase.kt`, in `PairingState`, after `val lastBeatLine: List<Pair<String, Any?>>? = null,`:

```kotlin
  /** Plan D §3.4: every beat sent this pairing, summarised for the record ([BeatLog]). */
  val beatLog: BeatLog = BeatLog(),
```

`SessionMachine.kt`, `reduce`: rename the existing `fun reduce(phase: Phase, input: Input, now: Now): Step { … }` to `private fun reduced(…)` with the same body, and put above it, under the existing KDoc (add the KDoc's last paragraph):

```kotlin
   *
   * Plan D §3.4: whatever the input, a pairing that stops beating writes its open minute of beats ([BeatLogs.closed]).
   */
  fun reduce(phase: Phase, input: Input, now: Now): Step = BeatLogs.closed(phase, reduced(phase, input, now))
```

(The `*/` that closes the existing KDoc moves below the new paragraph.)

`SessionMachine.kt`, `end`: inside `if (reason == EndReason.OPERATOR_STOPPED && wasLive && pairing != null) {`, replace

```kotlin
      val (beat, id) = finalBeat(phase, pairing, now)
      commands += beat
      // The final beat's id is spent: the next pairing's beats start after it (plan B: ids never repeat).
      val beating = pairing.copy(heartbeat = pairing.heartbeat.copy(nextId = id + 1, inFlightId = null))
```

with

```kotlin
      val (beat, id) = finalBeat(phase, pairing, now)
      // Plan D §3.4: the final beat is a beat sent too, off the cadence: counted, with no interval line.
      val (beatLog, lines) = pairing.beatLog.send(id, intervalMs = null, held = true, now)
      commands += lines.map { Command.Record(it) }
      commands += beat
      // The final beat's id is spent: the next pairing's beats start after it (plan B: ids never repeat).
      val beating = pairing.copy(heartbeat = pairing.heartbeat.copy(nextId = id + 1, inFlightId = null), beatLog = beatLog)
```

`SessionMachine.kt`, `Heartbeats.tick`: replace the body from `val commands = step.commands.toMutableList()` to the end of the function with:

```kotlin
    val commands = step.commands.toMutableList()
    val timedOut = heartbeat.failures > pairing.heartbeat.failures
    if (timedOut) commands += record("heartbeat", "result" to HeartbeatResult.FAILED, "message" to "no answer")
    // Plan D §3.4: a beat given up is a failed one in the minute's count.
    val counted = if (timedOut) pairing.beatLog.heard(word = null, ok = false) else pairing.beatLog
    if (id == null) return Step(phase.withPairing(pairing.copy(heartbeat = heartbeat, beatLog = counted)), commands)
    // RR3: the stopped sid rides only a beat that holds none.
    val carried = if (held == null) pairing.stopped?.sid else null
    val (beatLog, lines) = counted.send(id, interval, held = held != null, now)
    val next = pairing.copy(heartbeat = heartbeat, stoppedInFlight = carried, beatLog = beatLog)
    val nextPhase = phase.withPairing(next)
    val body = Beats.payload(Projection.beatFacts(nextPhase, next, now))
    commands += lines.map { Command.Record(it) }
    commands += Command.PostHeartbeat(id, pairing.request.heartbeatUrl, pairing.token, body)
    return Step(nextPhase, commands)
```

`SessionMachine.kt`, `Heartbeats.answered`: in `val refreshed = pairing.copy(…)`, after `waitingUnreadableSaid = …,` add:

```kotlin
        beatLog = pairing.beatLog.heard(word::class.simpleName, ok),
```

(`answered` returns before this when the answer is not the beat in flight's, so an answer that comes twice is counted once.)

- [ ] **Step 5: Run the new tests to watch them pass**

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.BeatLogTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Then the Kotlin count. Expected: `EXIT=0`, `{ tests: 12, failures: 0, errors: 0 }`.

- [ ] **Step 6: A held beat is counted, not listed (N25): flip the tests first**

The owner's ruling (2026-10-09, N25): "Count beats, don't list them." In `ProjectionPairedTest.kt`, replace the test

```kotlin
  @Test fun `held beats are each written, as plan B did`() {
    val rig = MachineRig().live()
    val before = rig.records("heartbeat").size
    repeat(3) { rig.hear("live", sid = "sess_42") }
    assertEquals(before + 3, rig.records("heartbeat").size)
  }
```

with

```kotlin
  @Test fun `held beats are written only when the answer changes, as paired ones are (N25)`() {
    val rig = MachineRig().live()
    rig.hear("live", sid = "sess_42")
    val before = rig.records("heartbeat").size
    repeat(3) { rig.hear("live", sid = "sess_42") }
    assertEquals(before, rig.records("heartbeat").size, "the same answer three times: counted, not listed")
    rig.hear(null, status = 503)
    assertEquals(before + 1, rig.records("heartbeat").size, "a change of answer still gets its line")
  }
```

and add to `BeatLogTest.kt`:

```kotlin
  @Test
  fun `three hours of held beats at 10 s write at most 200 beat lines (N25)`() {
    val rig = MachineRig().armed()
    rig.beats = { HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_42", "organiser", null, Configs.waiting(10))) }
    rig.advance(3 * 60 * 60 * 1_000L)
    // Armed holds sess_42 throughout, so every beat is a held one (held = heldSid != null), with no uplink to fake.
    assertTrue(rig.phase is Phase.Armed, rig.phase.name)
    // Worked by hand: 180 minutes, each closed by the next minute's first beat (180 `beats` lines); one interval line
    // (10 s throughout, held or not); and a `heartbeat` line only when the answer changes (the go-live that answered
    // the claim, then the first answer without a claim): 183, under the owner's bar of 200. A line per held beat
    // would add about 1,080.
    assertEquals(180, rig.records("beats").size)
    val lines = listOf("heartbeat", "beat-interval", "beats").sumOf { rig.records(it).size }
    assertTrue(lines <= 200, "$lines beat lines")
  }
```

Run both and watch them fail on the old rule:

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.ProjectionPairedTest' --tests 'com.seazn.capture.engine.core.BeatLogTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1`; exactly two failures, `held beats are written only when the answer changes …` (the same answer wrote three lines) and `three hours of held beats …` (about 1,260 lines). If `rig.phase is Phase.Armed` fails instead, the repeated go-live re-armed: answer `BeatReply("live", "sess_42", null, null, Configs.waiting(10))` instead, and say so in the report.

- [ ] **Step 7: Write a held beat's line only when it changes**

In `Heartbeats.answered`, replace

```kotlin
    // The beat line. Its claim is the one the answered beat carried, before this answer cleared it
    // (PV11). Paired, it is written only when it changes, message aside, so hours of waiting cost a
    // few lines; a held beat is written every time, as plan B wrote them.
```

with

```kotlin
    // The beat line. Its claim is the one the answered beat carried, before this answer cleared it
    // (PV11). Paired or held, it is written only when it changes, message aside (N25, owner
    // 2026-10-09: count beats, don't list them): the minute's `beats` line counts every beat, so
    // hours of waiting or of air cost a few lines.
```

and `val changed = phase.heldSid != null || compared != pairing.lastBeatLine` with `val changed = compared != pairing.lastBeatLine`. Rerun Step 6's command, then the Kotlin count. Expected: `EXIT=0`, `failures: 0, errors: 0`; `BeatLogTest` now holds 13 tests.

- [ ] **Step 8: Run the whole core suite, and reconcile tests that list every command**

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
cd "$WT/modules/capture-engine/android/core" && grep -l '<failure' build/test-results/test/*.xml
```

A test may red only because it asserts an exact command list (or record list) that now holds a `beat-interval` or `beats` line beside a beat send or an end. For each such test, add the expected line to its expected list, written out by hand from D-4 (never by filtering the new kinds out, and never by calling `BeatLog`), and name the test in the task report. A test that pinned one line per held beat is brought to the new rule the way Step 6 brought `ProjectionPairedTest`'s, and named in the report (`SessionMachineServerTest` `a heartbeat answer that comes twice is recorded once` is expected to stay green: its first `live` answer differs from the go-live's by the claim). Any other red is a defect in Steps 3, 4 and 7: fix the code, not the test. Rerun until `EXIT=0`, then the Kotlin count; record `tests`.

Also check the TypeScript side reads nothing that the new lines could break:

```bash
cd "$WT" && git grep -n '"kind":"heartbeat"\|kind === .heartbeat.' -- src modules test | grep -v android; echo "GREP_EXIT=$?"
```

Expected: no reader that counts lines by position. Report what it prints.

- [ ] **Step 9: The allow-list names the new kinds and keys**

First the counts, so they red. `ScrubParityTest.kt:78` `assertEquals(85, kinds.size)` → `87`; `:85` `assertEquals(32, scalars.size)` → `37`. `src/services/scrubParity.test.ts`: the test title `"passes each of the record's 85 kinds as itself"` → `87`, `expect(kinds).toHaveLength(85);` → `87`.

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.ScrubParityTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1`. Then edit `modules/capture-engine/src/scrub/allow-list.json` by hand (both objects are in sorted key order; keep them so). In `kinds`, directly before its `"bitrate"` entry:

```json
    "beat-interval": "native: the beat cadence changed (plan D §3.4), with the gap since the beat before",
    "beats": "native: one minute's beats: how many went, how many failed, and the last answer word (plan D §3.4)",
```

In `scalars`, each at its sorted place:

```json
    "failed": "native: beats, the minute's beats that failed or never came back",
    "intervalMs": "native: beat-interval, the cadence the phone beats at",
    "minuteEpochMs": "native: beats, the minute's start on the wall clock",
    "sent": "native: beats, the beats sent in the minute",
    "sinceLastMs": "native: beat-interval, the gap since the beat before, or null for the first",
```

and `held`'s reason becomes `"native: readiness, whether the phone is held level; beat-interval, whether a broadcast is held"`. Then:

```bash
cd "$WT" && pnpm prettier --write modules/capture-engine/src/scrub/allow-list.json src/services/scrubParity.test.ts > /dev/null
cd "$WT" && node -e 'const a=require("./modules/capture-engine/src/scrub/allow-list.json");for(const k of ["kinds","scalars"]){const ks=Object.keys(a[k]);console.log(k,ks.length,JSON.stringify(ks)===JSON.stringify([...ks].sort()))}'
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.ScrubParityTest' --tests 'com.seazn.capture.engine.core.BeatLogTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm vitest run --project domain src/services/scrubParity.test.ts src/services/scrub.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

Expected: `kinds 87 true`, `scalars 37 true`; both `EXIT=0`.

- [ ] **Step 10: Mutate each guard once**

Back up each file to `"$TMPDIR"`, mutate, run `BeatLogTest`, record the red, restore from the backup, `diff` to confirm:

1. `BeatLog.send`: `if (intervalMs == null || intervalMs == this.intervalMs) emptyList()` → `if (intervalMs == null) emptyList()` → expected red: `three hours paired at 10 s …` and `a change of cadence is a line …`.
2. `SessionMachine.reduce`: `= BeatLogs.closed(phase, reduced(phase, input, now))` → `= reduced(phase, input, now)` → expected red: `the open minute is written once …`, `a re-pair writes …`, `a Stop from air …`, `three hours paired …`.
3. `Heartbeats.tick`: `val counted = if (timedOut) … else pairing.beatLog` → `val counted = pairing.beatLog` → expected red: `a beat that never comes back counts as failed …`.
4. `BeatLogs.closed`: `val last = step.phase.pairing?.beatLog?.takeIf { it.firstBeatId == first } ?: log` → `val last = log` → expected red: `a Stop from air counts the final beat …` (the final beat is not in the sum).
5. `Heartbeats.answered`: restore the line per held beat, `val changed = compared != pairing.lastBeatLine` → `val changed = phase.heldSid != null || compared != pairing.lastBeatLine` → expected red: `three hours of held beats at 10 s write at most 200 beat lines (N25)` and `ProjectionPairedTest` `held beats are written only when the answer changes …`.

- [ ] **Step 11: Typecheck, lint, format, commit**

```bash
cd "$WT" && pnpm typecheck > "$TMPDIR/tc.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm lint > "$TMPDIR/lint.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm format:check > "$TMPDIR/fmt.log" 2>&1; echo "EXIT=$?"
cd "$WT" && git add modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/BeatLog.kt modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Phase.kt modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/SessionMachine.kt modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/BeatLogTest.kt modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/ScrubParityTest.kt modules/capture-engine/src/scrub/allow-list.json src/services/scrubParity.test.ts
```

Add, by path, `ProjectionPairedTest.kt` and every core test Step 8 changed, then:

```bash
cd "$WT" && git commit -q -F - <<'EOF'
feat(engine): every beat sent is in the record, a line a minute

Plan D spec §3.4. The record kept a waiting beat only when its answer
changed, so D3 had no evidence of the cadence. The shared record holds
1,000 lines and a line per beat is ~1,100 over a 3 h match, so the beats
are summarised: a beat-interval line when the cadence changes, with the
gap since the beat before, and a beats line per minute with how many
went, failed, and the last answer word. The open minute is written once
when the pairing stops beating; the A8 final beat is counted.
N25 (owner, 2026-10-09: count beats, don't list them): a beat held on
air writes a heartbeat line only when its answer changes, as a paired
one does, so 3 h of air write at most 200 beat lines and Share's
1,000-line ring holds the whole match.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The Kotlin test fakes name the web's paths

**Files:**

- Modify: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/Configs.kt:35,66,78`
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/ConfigsTest.kt`

**Interfaces:**

- Consumes: `Configs.pairRequest(): PairRequest` (fields `codeUrl`, `heartbeatUrl`, `startUrl`), `Configs.valid(): SessionConfig` (field `heartbeatUrl`).
- Produces: nothing new; the fakes' URLs become `https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q`, `…/beats` and `…/start`.

- [ ] **Step 1: Write the failing test**

Create `ConfigsTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Plan D spec §3.5: the test fakes name the paths the web serves, `GET {origin}/api/v1/capture/codes/{code}`,
 * `…/beats` and `…/start` (spec §2), never one it does not. The engine reads its URLs from the descriptor, so this
 * is for the next reader of a test, who should not learn a path from a fake that the server never answered.
 */
class ConfigsTest {
  @Test
  fun `the fakes' URLs are the web's capture paths`() {
    val request = Configs.pairRequest()
    assertEquals(
      listOf(
        "/api/v1/capture/codes/fx42hmnp7k2q",
        "/api/v1/capture/codes/fx42hmnp7k2q/beats",
        "/api/v1/capture/codes/fx42hmnp7k2q/start",
        "/api/v1/capture/codes/fx42hmnp7k2q/beats",
      ),
      listOf(request.codeUrl, request.heartbeatUrl, request.startUrl, Configs.valid().heartbeatUrl).map { URI(it).path },
    )
  }
}
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain --tests 'com.seazn.capture.engine.core.ConfigsTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1`, the assertion lists `/api/capture/codes/fx42hmnp7k2q/beat`, `/api/capture/codes/fx42hmnp7k2q/start` and `/api/capture/heartbeat`.

- [ ] **Step 3: Align the three URLs**

In `Configs.kt`:

- `:35` `heartbeatUrl = "https://stg.seazn.club/api/capture/heartbeat",` → `heartbeatUrl = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats",`
- `:66` `heartbeatUrl: String = "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat",` → `heartbeatUrl: String = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats",`
- `:78` `startUrl = "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/start",` → `startUrl = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start",` (D-8)

- [ ] **Step 4: Run the whole Kotlin core suite**

Every core test builds on `Configs`, so the full core suite is this task's scope:

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --console=plain > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Then the Kotlin count. Expected: `EXIT=0`, `failures: 0, errors: 0`; record `tests`.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/Configs.kt modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/ConfigsTest.kt && git commit -q -F - <<'EOF'
test(engine): the Kotlin test fakes name the web's capture paths

Plan D spec §3.5. Configs.kt's heartbeat and start URLs move from
/api/capture/... to /api/v1/capture/codes/{code}/beats and /start, the
paths the web serves. Cosmetic: the engine reads its URLs from the
descriptor. ConfigsTest holds the fakes to the web's paths.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The text reconciliation, the README and the findings

**Files:**

- Modify: `docs/specs/2026-10-01-s1-amendment-stable-code-design.md` (14 notes)
- Modify: `docs/specs/2026-09-30-s1-live-stream-design.md` (4 notes)
- Modify: `docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md` (4 notes)
- Modify: `contracts/README.md` (rewrite)
- Modify: `AGENTS.md:139`, `AGENTS.md:180-181`
- Modify: `_FINDINGS.md` (new N24 and N25 before the `---` above `## P5 device spike (Android)`)
- Modify: `.github/workflows/check.yml:9-10`

**Interfaces:**

- Consumes: the file and test names of Tasks 1 and 2 (`scripts/vendor-contracts.mjs`, `pnpm contracts:vendor`, `contracts/VENDORED.json`, `test/contractPins.test.ts`, `WEB_COMMIT`, `WEB_PINS`).
- Produces: documentation only. Every edit below is anchored on a string that occurs exactly once in its file at `ada2ffd` (checked on 2026-10-09); line numbers are given for orientation. An edit that "appends" adds the note after the anchor on the same line, separated by one space. An edit that "inserts a paragraph before" adds the note, then a blank line, directly above the anchor line.

The spec reference every note uses is `plan D spec`, the file `docs/specs/2026-10-09-s1-plan-d-design.md`; the first note in each file names the path in full.

- [ ] **Step 1: Record the Prettier baselines of the three unclean files**

```bash
cd "$WT" && for f in AGENTS.md _FINDINGS.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md; do echo "$f $(pnpm -s prettier "$f" | diff "$f" - | grep -c '^[<>]')"; done
cd "$WT" && for f in docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md; do echo "$f $(grep -c 'plan D spec\|plan D §3' "$f")"; done
```

Expected: `58`, `120`, `2`; then `0`, `0`, `0`.

- [ ] **Step 2: The amendment (`docs/specs/2026-10-01-s1-amendment-stable-code-design.md`)**

1. **A5 (A:21) and A18 (A:34), the Decisions table** (D-5). Insert a paragraph before the line starting `A8's earlier ruling was given to the coordinator on 2026-10-01`:

   ```markdown
   _A5 and A18, revised 2026-10-09 (plan D spec, `docs/specs/2026-10-09-s1-plan-d-design.md` §3.6):_ A18's custom ingest host is ruled out (web W26, 2026-10-05): SRT is never rewritten to it, and native pins `live.cloudflare.com` for both transports (`Hosts.kt`); `cred.srt: null` stays a safety switch only. A5's "Server push is a later fallback" is replaced by owner ruling R4 (2026-10-09, option C): keep-awake, with the window dimmed after 30 s untouched, is the default while paired and waiting, and the Android locked-phone path is the fallback. Push stays out (AGENTS §1, ruling 11).
   ```

2. **A:45.** Append after `ends the current broadcast only: the phone returns to waiting.`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): the web never sends 410, on any route (web X8: an ended code is 401 `code_ended`, an ended session 200 `over`, an outage 503 `unavailable`). The phone's defensive reading of a 410 stays. This note holds for every 410 line in this document._
   ```

3. **A:68.** Append after ``The phone still reads a beat's 410 defensively, as `Over` for the `sid` it names.``:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): 410 is not sent on `GET code` or the descriptor either (web X8); the defensive reading stays._
   ```

4. **A:101.** Append after `and a remote Go live must work with the phone locked.`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6, R4): the locked phone is now the fallback, not the primary path; keep-awake while paired and waiting is the default._
   ```

5. **A:123.** Append after `A go-live opens them from the foreground service, then readiness is judged.`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6, R4): this is the fallback path; by default the phone stays awake, dimmed, while paired and waiting._
   ```

6. **A:158, inside the contract-shapes code block.** Append after `410 → the broadcast is over (at a scan, a server fault: read as not valid).`:

   ```text
     // revised 2026-10-09 (plan D spec §3.6): never sent (web X8); read defensively
   ```

7. **A:232 and A:239, the server's-word table and its 410 bullet.** Append after `A 410 to a beat that names neither changes nothing.`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): no route sends 410 (web X8), the descriptor included, so this bullet and the table's `descriptor | 410` row are defensive readings only._
   ```

8. **A:321.** Append after `widened from the session to the pairing).`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6, R4): the wake lock still covers the whole pairing; keep-awake, with the dim, now holds the screen on while paired and waiting by default, and a locked phone is the fallback._
   ```

9. **A:560.** Append after ``or SRT on a lookalike such as `live.cloudflare.com.example`, is refused.``:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): no `live.*` host is an ingest host (web W26); native pins `live.cloudflare.com` for both transports._
   ```

10. **A:565.** Append after ``on the owner's laptop with the `live.stg.seazn.club` host.``:

    ```markdown
    _Revised 2026-10-09 (plan D spec §3.6): `live.stg.seazn.club` is not an ingest host (web W26); native pins `live.cloudflare.com` and refuses a credential on any other host._
    ```

11. **A:594, the device-gate table's row "SRT on the custom ingest host"** (D-5). Insert a paragraph before `### Device-only claims`:

    ```markdown
    _Revised 2026-10-09 (plan D spec §3.6): the row "the cadence moving from 60 s to 10 s; SRT on the custom ingest host" keeps its cadence half only. The custom ingest host is ruled out (web W26), and native pins `live.cloudflare.com` for both transports._
    ```

12. **A:630, the S0-gaps row "keep-awake while armed or live"** (D-5). Insert a paragraph before `## AGENTS.md changes`:

    ```markdown
    _Revised 2026-10-09 (plan D spec §3.6, R4 and R8): the row "§4 S0 gaps, keep-awake while armed or live" is superseded. Keep-awake is the default while paired and waiting, the window dimmed after 30 s untouched and never dimmed when armed or live; the Android locked-phone path is the fallback._
    ```

13. **A:660.** Append after `so a hold window ends the broadcast as today.`:

    ```markdown
    _Revised 2026-10-09 (plan D spec §3.6): the custom ingest host is ruled out (web W26); SRT stays on `live.cloudflare.com`, and `cred.srt: null` is a safety switch only._
    ```

14. **A:661.** Append after `would need a ruling against AGENTS §1's push scope.`:

    ```markdown
    _Revised 2026-10-09 (plan D spec §3.6, R4): keep-awake is the default and the Android locked path the fallback; push stays out (AGENTS §1, ruling 11)._
    ```

- [ ] **Step 3: The live-stream spec (`docs/specs/2026-09-30-s1-live-stream-design.md`)**

1. **S:21, the exit bar** (D-7). Replace `a real stg fixture with the overlay, the failure drills in §6` with:

   ```markdown
   a real stg fixture with the overlay _(revised 2026-10-09, plan D spec, `docs/specs/2026-10-09-s1-plan-d-design.md` §3.6: without the overlay, R1; the exit bar runs in plan D's slice D3)_, the failure drills in §6
   ```

2. **S:197.** Append after `- **Keep-awake** while armed or live, proven in a release build.`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6, R4): keep-awake, with the dim, while paired and waiting too; the locked phone is the fallback._
   ```

3. **S:264, the CI table's row "Contract drift"** (D-5). Insert a paragraph before `**Detox waits.**`:

   ```markdown
   _Contract drift, revised 2026-10-09 (plan D spec §1 R7, §3.1): pin only. `contracts/` is a byte copy of the web's `docs/contracts` with every file's sha256 in `contracts/VENDORED.json`, checked offline by `test/contractPins.test.ts` inside `pnpm check`, which also holds the five schema pins equal to the web's own. No job fetches the web repo, so no token is needed (the repo is public)._
   ```

4. **S:273, the exit bar's run.** Replace `go live on a real stg fixture with the overlay. During the match:` with:

   ```markdown
   go live on a real stg fixture with the overlay _(revised 2026-10-09, plan D spec §3.6: without the overlay, R1; it runs in plan D's slice D3)_. During the match:
   ```

- [ ] **Step 4: Plan C (`docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md`)**

1. **C:196, the rulings table's "SRT host" row** (D-5; the many `live.*` hits are not edited one by one, as the spec says). Insert a paragraph before `## Pre-flight, folded`:

   ```markdown
   _SRT host, revised 2026-10-09 (plan D spec, `docs/specs/2026-10-09-s1-plan-d-design.md` §3.6): the environment's `live.*` host is ruled out as an ingest host (web W26, 2026-10-05). Native pins `live.cloudflare.com` for both transports (`Hosts.kt`), and `cred.srt: null` is a safety switch only. This note stands for every `live.*` ingest-host line in this plan, C:19898 and C:19901 among them, which are not edited one by one._
   ```

2. **The top of the carries table (C:227).** Append after `Carries 2 and 4 are rewritten by the amendment (CD5).`:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): this plan's `live.*` ingest-host text is stale; see the note under the rulings table._
   ```

3. **C:11161, the D2 marker (§3.3).** Replace the code comment line `/** Provisional (D2): the web side owns the path; plan D reconciles it with the published schema. */` with:

   ```ts
   /** Provisional (D2): the web side owns the path; plan D reconciles it with the published schema. Closed 2026-10-09 (plan D spec §3.3): fetchCodePort.ts builds /api/v1/capture/codes/{code}, the path the web serves; beats and start come from the descriptor. */
   ```

4. **C:19910.** Append after ``vendoring `contracts/capture-qr.v1.json`, with the drift job against the main repo's copy (spec §6);``:

   ```markdown
   _Revised 2026-10-09 (plan D spec §3.6): vendored instead are `capture-qr.v2.json` and the four v1 bodies (beat, descriptor, scoring-link, start) with every fixture, byte for byte and pinned, and there is no drift job (R7)._
   ```

- [ ] **Step 5: Confirm C1, C2, M3 and N2 have landed, then rewrite `contracts/README.md`**

The spec: "Before the README drops 'blocked', D1 confirms against `_FINDINGS.md` that C1, C2, M3 and N2 have each landed on the web, and says so per ID." Read each ID's text (`_FINDINGS.md` N2 at `:34-50`; C1, C2, M3 in the _Inherited_ table), then check the vendored files:

```bash
cd "$WT" && grep -c '"holdWindowSeconds"' contracts/capture-descriptor.v1.json
cd "$WT" && grep -o "cred only to the slot's current phone[^\"]*" contracts/capture-descriptor.v1.json | head -1
cd "$WT" && grep -c '"slot"' contracts/capture-qr.v2.json contracts/capture-beat.v1.json
cd "$WT" && grep -o 'The QR never carries credentials[^.]*' contracts/capture-qr.v2.json
cd "$WT" && grep -c '"srt"' contracts/fixtures/capture-descriptor.v1/valid-live.json; grep -c '"rtmps"' contracts/fixtures/capture-descriptor.v1/valid-live.json
```

Expected (2026-10-09): `10`; `cred only to the slot's current phone (§6.3.1, §5.3).`; `2` and `2`; `The QR never carries credentials: the phone fetches them with the tok (§6`; at least `1` and `1`. If any differs, stop and report rather than write "landed".

Replace the whole of `contracts/README.md` with:

````markdown
# Contracts

The web's capture contracts, vendored and pinned (plan D spec §3.1, owner ruling R7). The source of truth is the
web repo `onryde/seazn.club`, folder `docs/contracts/`. This folder is a byte copy of that folder at one commit, and
nothing here is edited by hand.

Vendored from web `8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac` on 2026-10-09: 5 schemas and 139 fixtures. Staging runs
web `e201fab8f`, whose `docs/contracts` is byte-identical.

| File                           | What it is                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- |
| `capture-qr.v2.json`           | The stream QR: code, slot and token, never a credential                    |
| `capture-descriptor.v1.json`   | `GET code`'s answer: the waiting fields, and the session shape with `cred` |
| `capture-beat.v1.json`         | A beat and its answer                                                      |
| `capture-start.v1.json`        | `POST start`'s answer and its refusals                                     |
| `capture-scoring-link.v1.json` | The Remote scoring link's answer                                           |
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
   in CI.

2. By hand, copy the web's commit and its five schema pins (`SHA256` in the web's
   `apps/web/src/server/api-v1/__tests__/capture-contract.test.ts`) into `WEB_COMMIT` and `WEB_PINS` in
   `test/contractPins.test.ts`. The script never writes them, so a re-vendor cannot move both sides of the pin at
   once.

3. Run `pnpm check`. `test/contractPins.test.ts` holds every file here to `VENDORED.json` and the five schemas to the
   web's own pins. A changed shape reds its parser's tests; the parser changes in the same pull request.

## Rules

- **Pin only (R7).** Nothing fetches the web repo, in CI or on a schedule. The web learns of drift from its own pin;
  the phone learns of it when the web session says so.
- **Byte for byte.** Prettier never formats the copies (`.prettierignore`). This README is ours, and so is
  `VENDORED.json`; the pin covers neither.
- **The wire shape never reaches the domain.** Each wire shape has one parser, in one language (AGENTS §4): the QR
  and the waiting fields in TypeScript (`src/domain/credentials`), the session shape and the server's answers in
  Kotlin (`Bodies.kt`).

## Words a schema allows that a route never sends

Two readings stay on the phone although the web never sends them on that route (plan D spec §2, §3.4):

- **410**, on a beat, on `GET code` and on the descriptor. `capture-beat.v1.json` says "A beat never answers 410
  (ask 8)" and `capture-descriptor.v1.json` "This route never sends 410 (ask 8)" (web X8: an ended code is 401
  `code_ended`, an ended session 200 `over`, an outage 503 `unavailable`). The phone keeps a defensive reading
  (`ServerWord.kt`).
- **`match_finished`**, in `capture-start.v1.json`'s refusal enum. Only the scoring-link route sends it
  (`capture-phone.ts:794` at web `e201fab8f`), and the phone reads it there (`ScoringLinkPanel.tsx:16`). `POST start`
  never does: a start after the result is admitted inside the 120-minute grace and answers `401 code_ended` after
  it, and both already have readings.

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
````

- [ ] **Step 6: AGENTS.md (D-6)**

Replace line 139:

```text
contracts/         # capture-qr.v2.json, once vendored (see its README)
```

with:

```text
contracts/         # the web's capture contracts, vendored and pinned
```

Replace lines 180-181:

```markdown
- Contracts are vendored. Changing `capture-qr.v2.json` requires the CI drift
  check against the main repo's copy.
```

with:

```markdown
- Contracts are vendored. A contract changes only through `pnpm contracts:vendor`
  and the pin test (R7, plan D spec §3.1); no CI job fetches the web repo.
```

- [ ] **Step 7: `.github/workflows/check.yml` (D-7)**

Replace

```yaml
# speaker) cannot merge. Not here: the contract drift check — nothing is
# vendored under contracts/ yet.
```

with

```yaml
# speaker) cannot merge. The vendored contracts are pinned by a test inside
# `pnpm check` (test/contractPins.test.ts); nothing fetches the web repo (R7).
```

- [ ] **Step 8: `_FINDINGS.md`, N24 (§3.7) and N25 (D-11, decided)**

Re-check the absence first:

```bash
cd "$WT" && git log --all --oneline -- 'docs/specs/*plan-c-results*' | wc -l
cd /Users/ashokhein/github/seazn.club.capture && find . -path ./node_modules -prune -o -name '*plan-c-results*' -print | wc -l
```

Expected: `0` and `0`. If either finds the file, write N24 as closed with that path instead, and tell the orchestrator.

Insert before the `---` line that sits directly above `## P5 device spike (Android)` (after N23's last item, `so it is the most expensive of the three.`, and its blank line):

```markdown
### N24 — Plan C's device-gate results were never filed

**Status:** open · evidence gap · closes with a path if the owner knows where the results are
**Where:** plan C's C8 (`docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md`, C:111, C:354,
C:19826) · `docs/specs/2026-10-0x-s1-plan-c-results.md` · plan D spec §3.7 and §5.3

Plan C's C8 names a results document, `docs/specs/2026-10-0x-s1-plan-c-results.md`, for the C device gate's
evidence: the scripted-server rows, the release rows (beats for 30 minutes in Doze, battery while paired for 60
minutes, an OEM background kill, a fresh install on Android 14+) and the staging rows listed for plan D. On
2026-10-09 it exists nowhere: not on main, on no branch (`git log --all -- 'docs/specs/*plan-c-results*'` is empty)
and in no worktree. So the gate's evidence was never filed, and nothing in this repo shows which of its rows ran.

What follows: plan D's staging run (slice D3) cites no plan C result. Each D3 row that depends on a plan C device
fact re-establishes it on the D3 build (plan D spec §5.3): the camera and mic opening on a locked phone (row 2b),
readiness on a locked phone, and the foreground notification's text (AGENTS §9).

**Open (the owner's call):**

1. If the results exist somewhere, name the path and this closes with it.
2. Otherwise the D3 rows stand in for the facts plan D needs, and the release rows plan D does not cover (the Doze
   cadence, battery while paired, the OEM kill) are run again or dropped by name.

---

### N25 — The shared record could not hold a three-hour broadcast

**Status:** decided · fixed by plan D1 Task 4 · owner, 2026-10-09: "Count beats, don't list them"
**Where:** `src/services/sessionRecord.ts:26` (`RECORD_CAPACITY = 1000`) · `src/hooks/useDiagnostics.ts:47-60` (Share
record sends the ring) · `SessionMachine.kt`, `Heartbeats.answered` (the held-beat line) · plan D spec §3.4

Share record (D21) sends the JS ring, which keeps the last 1,000 lines of either side. Before D1 a beat held on air
was written on every answer, as plan B wrote them, and the held cadence is at most 10 s, so a three-hour broadcast
wrote about 1,080 `heartbeat` lines on its own. The ring would then lose the start of a long match before it ended:
the go-live, the first `beat-interval` lines (5 s while starting, D3 row 8), the first connect. The native file
(`RecordFile.kt`, 5 MiB and one rotation) keeps all of it, but nothing shares it.

**Ruling and fix:** a held beat is counted, not listed. Its `heartbeat` line is written only when the answer
changes, as a paired one is, and the minute's `beats` line counts every beat (plan D1 Task 4). Three hours of held
beats write at most 200 beat lines (`BeatLogTest`, `three hours of held beats at 10 s write at most 200 beat
lines`), so Share's ring holds the whole match.

---
```

(The inserted block ends with its own `---`, so the existing `---` above `## P5 device spike (Android)` now follows N25's and stays as the separator. Check that exactly one `---` sits between N25's last line and `## P5 device spike (Android)`; remove the duplicate if two do. Before writing N25, re-read the four places it cites and confirm each still says what it says here.)

- [ ] **Step 9: Verify the notes and the formatting**

```bash
cd "$WT" && for f in docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md; do echo "$f $(grep -c 'plan D spec\|plan D §3' "$f")"; done
cd "$WT" && pnpm prettier --write docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md contracts/README.md > /dev/null
cd "$WT" && pnpm prettier --check docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md contracts/README.md .github/workflows/check.yml > "$TMPDIR/p.log" 2>&1; echo "EXIT=$?"
cd "$WT" && for f in AGENTS.md _FINDINGS.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md; do echo "$f $(pnpm -s prettier "$f" | diff "$f" - | grep -c '^[<>]')"; done
cd "$WT" && git diff --stat
```

Expected: `14`, `4`, `4`; `EXIT=0`; the three drift counts at most `58`, `120`, `2`; the diff touches only this task's seven files. Read the amendment's diff once: `prettier --write` may re-wrap nothing (prose wrap is preserved) and may only re-pad a table this task did not edit if the file was already clean, which it was.

- [ ] **Step 10: Commit**

```bash
cd "$WT" && git add docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md contracts/README.md AGENTS.md _FINDINGS.md .github/workflows/check.yml && git commit -q -F - <<'EOF'
docs: reconcile the texts plan D's web rulings made stale

Plan D spec §3.3, §3.6 and §3.7. Dated revision notes, the stale text
kept: the custom ingest host (W26), 410 never sent (X8), keep-awake as
the default while paired (R4), pin-only contracts (R7) and the exit bar
without the overlay (R1). The D2 path marker in plan C is closed.
contracts/README.md says what is vendored and how; AGENTS §3 and §4 name
the pin, and names the two words a schema allows that a route never
sends (410, match_finished). N24 records that plan C's device-gate
results were never filed; N25 records the owner's ruling that a held
beat is counted, not listed, fixed by the previous commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Full verification and the owner's summary

**Files:** none changed. If a step reds, fix it in the task that owns the file, as a new commit, and rerun this task from Step 1.

**Interfaces:** consumes everything above.

- [ ] **Step 1: `pnpm check`, with its exit code and the vitest count**

```bash
cd "$WT" && pnpm check > "$TMPDIR/check.log" 2>&1; echo "EXIT=$?"
cd "$WT" && pnpm vitest run --reporter=json --outputFile="$TMPDIR/all.json" > "$TMPDIR/all.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("files",r.numTotalTestSuites,"total",r.numTotalTests,"passed",r.numPassedTests,"failed",r.numFailedTests,"pending",r.numPendingTests)' "$TMPDIR/all.json"
cd "$WT" && pnpm i18n:release-check > "$TMPDIR/rel.log" 2>&1; echo "EXIT=$?"
```

Expected: three `EXIT=0`, `failed 0`. Record the totals, and the same totals on the base commit for comparison (`git -C "$WT" stash` is forbidden: run the base count in a second, throwaway worktree at the base commit, then remove it with `git worktree remove`).

- [ ] **Step 2: The Kotlin core, in full**

```bash
cd "$WT/modules/capture-engine/android/core" && rm -rf build/test-results/test && ./gradlew test --no-daemon --console=plain > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Then the Kotlin count. Expected: `EXIT=0`, `failures: 0, errors: 0`. Record `tests`.

- [ ] **Step 3: Prettier on every touched doc and script**

```bash
cd "$WT" && pnpm prettier --check contracts/README.md docs/specs/2026-10-01-s1-amendment-stable-code-design.md docs/specs/2026-09-30-s1-live-stream-design.md docs/superpowers/plans/2026-10-09-s1-plan-d1-contracts-and-reconciliation.md .github/workflows/check.yml scripts/vendor-contracts.mjs package.json > "$TMPDIR/p.log" 2>&1; echo "EXIT=$?"
cd "$WT" && for f in AGENTS.md _FINDINGS.md docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md; do echo "$f $(pnpm -s prettier "$f" | diff "$f" - | grep -c '^[<>]')"; done
```

Expected: `EXIT=0`; the drift counts at most `58`, `120`, `2`.

- [ ] **Step 4: The web checkout is untouched, and the branch holds only this slice**

```bash
git -C /Users/ashokhein/github/seazn.club rev-parse HEAD
git -C /Users/ashokhein/github/seazn.club --no-optional-locks status --porcelain | diff "$TMPDIR/web-status-before.txt" - && echo "WEB UNCHANGED"
cd "$WT" && git status --short; git log --oneline main..HEAD
cd "$WT" && git diff --name-only main..HEAD | grep -v '^contracts/' | sort
```

Expected: `8afdd8b42fcb6ba115ac18c7cc3d8461f7ea07ac`; `WEB UNCHANGED`; a clean status; six commits; outside `contracts/`, only the files in this plan's file map.

- [ ] **Step 5: The owner's summary**

Write it as the final report to the orchestrator, ready to be the pull request's body. Under 40 lines, in this order:

1. **What D1 did**, one line per spec point: §3.1 (vendored at the commit `VENDORED.json` names, 144 files, the two-sided pin, `pnpm contracts:vendor`), §3.2 (QR vectors and fixtures, the round line in TS and Kotlin, the "QF" rows), §3.3 (the D2 marker closed), §3.4 (every beat sent: a `beat-interval` line per cadence change and a `beats` line per minute, and why not a line per beat; `match_finished` and 410 named in the README), §3.5 (the test paths), §3.6 (22 notes across three documents, the README, AGENTS §3 and §4), §3.7 (N24), and N25 (a held beat counted, not listed: the owner's ruling, applied in Task 4).
2. **The counts**: `pnpm check` exit code; vitest files and tests, base against branch; Kotlin tests, base against branch; the Prettier results.
3. **The decisions the owner may overrule**, D-1 to D-10, one line each, D-3 and D-2 first; then D-11 as the owner's ruling (N25), applied.
4. **For D3**: row 8 reads the cadence from the `beat-interval` and `beats` lines, and Share holds the whole match (N25); the web fixture `valid-live-stage.json` still names `rtmps://live.stg.seazn.club` (D-9), for `mobile-s1-web`.
5. **Device-only claims**: none in D1. That a real match's shared record shows the cadence is D3's (row 8).
6. **Left for later**: the pre-D3 path literals in other Kotlin tests and vectors (D-8); the ladder finding is D2's (spec §3.7, §4.2).

---

## Spec coverage (self-review)

| Spec point                                                                                         | Task                                          |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| §3.1 layout, `VENDORED.json`, every fixture in the web's tree                                      | 2 (written by 1)                              |
| §3.1 first vendoring; descriptor 45fc9ad7 → 84e936b7; qr.v2 vendored; the commit actually vendored | 2, Step 3 (D-10)                              |
| §3.1 `test/fixtures/contracts/` deleted; `serverBodies.test.ts` reads `contracts/`, `PINNED` gone  | 2, Step 6                                     |
| §3.1 pin test: missing, extra, different; README and VENDORED excepted; five literals              | 2, Steps 1-5                                  |
| §3.1 `pnpm contracts:vendor`: refuses unclean, copies, records HEAD and sha256s, prints changes    | 1 (D-1 for "clean")                           |
| §3.2 QR vectors through ajv; a schema-refused vector is parser-refused                             | 3, Step 1 (D-2)                               |
| §3.2 round-line fixtures through the TS parser and Kotlin `Bodies`; 40 verbatim, 41 absent         | 3, Steps 2-4 (D-9)                            |
| §3.2 waiting-vectors "QF" to the reshaped form                                                     | 3, Step 5                                     |
| §3.3 the note at C:11161                                                                           | 6, Step 4.3                                   |
| §3.4 every beat sent, in every build: send time, interval since the last, answer word              | 4 (D-3, D-4: the second form)                 |
| §3.4 the size check, and the second form when it does not fit                                      | D-3; 4, Step 1 (three hours: 181 lines and 1) |
| §3.4 N25: a held beat counted, not listed; 3 h of air at most 200 beat lines                       | 4, Steps 6-7, 10 (D-11)                       |
| §3.4 `match_finished` needs no phone word; the README notes it beside the 410                      | 6, Step 5                                     |
| §3.5 `Configs.kt` paths                                                                            | 5 (D-8)                                       |
| §3.6 every row of the table                                                                        | 6, Steps 2-6 (D-5, D-6, D-7)                  |
| §3.7 N24; the ladder finding left to D2                                                            | 6, Step 8                                     |
| §6 D1: a second call, an empty input, the pin mutated by one byte                                  | 1, Step 2; 2, Step 5; 3, Step 1; 4, Step 1    |
