# Seazn Capture — Agent Rules

The phone is a camera with a network stack. Everything else in the streaming
programme already has a home. Read this before writing code.

Shared vocabulary: findings are cited by register ID (P1–P5, C1–C2, D1–D5,
T1–T5, M1–M4, U1) from the streaming programme's relay signal path register.
Cite, don't re-derive.

---

## 0. How to work

Five principles. Each one has teeth in this repo, not just in the abstract.

**Methodical.** Systematic across the stack. Prove it rather than assume it —
the register's own rule is that a comment in code is a HYPOTHESIS, not
evidence, and that applies to acceptance criteria and to your own reasoning.
When a rule is supposed to fire, write the violation and watch it fire. When a
vendor behaviour is load-bearing, test it (U1, N11) rather than inferring it
from documentation.

**Quality-driven.** High standards for maintainability and documentation. A
decision that exists only in a commit message is lost. Findings go in
`_FINDINGS.md` with an ID, decisions go in `docs/specs/`, working rules go
here. Record the reasoning, not just the outcome — a rejected option with its
reasoning intact (N12) is worth more than a silent choice.

**Modular thinker.** Reusable, composable, independently testable. Every unit
should answer three questions without reading its internals: what does it do,
how do you use it, what does it depend on. That is why the engine sits behind a
port with a fake implementation, and why `domain/` is pure. When a file grows
large it is usually doing too much.

**Automation advocate.** If you do it twice, automate it. This is why the
layering is an eslint rule and not a convention, why the contract has a drift
check rather than a review checklist, and why CI runs domain tests on every
push. A rule a human has to remember is a rule that will be broken at 3-1 in
the 40th over.

**Full-stack minded.** Understand the whole path. This app is one contributor
to a pipeline that ends at YouTube, and a change here reaches places it does
not obviously touch — an encode profile can starve a compositor two hops away
(N1), a credential shape decides whether a fallback is possible at a wet ground
(C1). Read the register before deciding something local.

---

## 1. Scope lock

The app is **three modes**: Live Stream, Remote Scoring and a tournament
Dashboard. Only one runs at a time, and each is unlocked by its own QR code.
There is no login anywhere. See
[the decision record](docs/specs/2026-09-29-multi-mode-app-decisions.md).

Home is the only screen outside a mode but one: three tiles, a Continue card
when a mode can be resumed, and the language picker. The one other is Stream
Settings opened from the "Stream settings" link inside Home's Live Stream tile,
without the Diagnostics card: R2 of the D3 findings design (owner, 2026-10-11;
`docs/specs/2026-10-11-s1-d3-findings-design.md` section 1). It holds the two
phone settings, the battery row and the record row, reachable before a scan.
The link shows only while no card stands above the tiles (the D3 fixes plan's
ruling P6, the controller's:
`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`). Scanning is the phone's
own code scanner, not a screen of ours.

**Live Stream** keeps the four-screen shape of its own: **Scan** → **Paired** →
**Live** (HUD) → **Settings**, with Diagnostics as a card inside Settings
(2026-10-06 design follow-up §6). A stream code pairs the phone
once and serves every Go live of the match (A1, A5). S1 designs those screens.
(Scan is now Home's Live Stream tile plus the system scanner, not a screen,
and S1 redraws this list.)

No accounts, no login, no fixture browsing, no chat, no replays, no gallery,
no in-app payments, and no upload but one: the session record, sent to Seazn
on the operator's tap (R3 of the D3 findings design; owner, 2026-10-11), not
by itself (an automatic upload is out of scope). It is built behind
`FEATURES.recordSend`, off until the web's endpoint ships. Push alerts go only
to phones holding a Dashboard code (ruling 11).

Adding a fourth mode, or a screen outside a mode, is a product decision, not
an implementation detail. Raise it; don't build it.

Hardware contributors (HDMI encoders, camcorders, PTZ cameras) publish to the
same Cloudflare live input without this app. They are served by the session
page in the main repo, not here. Do not grow the app to accommodate them.

## 2. The native/JS line (P2)

**Native owns the session. JS renders and sends intents.**

- Native owns: capture, encode, connect, publish, reconnect, SRT→RTMPS
  fallback, encoded orientation (P4), capture timestamps, pairing, heartbeats,
  the server's answers, and the start readiness gate (A5, A11). The
  activity's screen lock is the JS orientation gate (§6).
- JS receives a ~1 Hz state snapshot. That is the entire upward contract.
- Commands are **intents, not RPC**: `pair`, `start`, `stop`, `unpair`,
  `reset`, `setAutomatic`, `setLanguage` and `switchCamera` return void and
  are reconciled against native state. A promise that must resolve
  mid-reconnect is a deadlock waiting for a bad cell.
  Two recorded exceptions. The first (design follow-up §8; owner, 2026-10-08):
  `takePhoto` is a request with an answer, one call that resolves `saved` or
  `failed` within native's 2 s bound when the call honours cancellation; the
  app gives up at 4 s. It carries no session state, runs on a scope of its
  own with no path to the session's failure path, and is never read by the
  machine, the snapshot or the heartbeat. The second is `scoringLink` (design
  follow-up §10): one call that resolves the Remote scoring link, or one of
  six refusal words, to the caller that asked, within native's 16 s backstop
  (`BridgeCore.ANSWER_BACKSTOP_MS`); the app gives up at 12 s, and a late
  answer is dropped. It carries no session state and is never read by the
  machine, the snapshot or the heartbeat. Neither call runs on the machine's
  failure path: `takePhoto` has a scope of its own, and `scoringLink` runs
  every stage in `ScoringTap.apart`, so what its transport, its reading or its
  caller throws answers `unavailable` and never reaches the failure path.
  `scoringLink` answers a scoring credential: its URL is never in a snapshot,
  the record, a beat or a store, it goes to the one caller that asked, and its
  secret is masked in both records before the caller has it. These are the
  only two such calls.
- **Never build a second state machine in TypeScript.** The aggregate lives in
  native. The TS layer is a *projection* of native events. Two authorities
  disagree at 3-1 in the 40th over.
- Frames never approach the bridge. Preview is a native view.

## 3. Layering — enforced, not documented

```
app/               # Expo Router routes. Thin: they import ui, hooks and packages only.
  _layout.tsx      # the composition root: ports, language, reopen gate, orientation gate
  index.tsx        # Home
  stream-settings.tsx  # Stream Settings from Home, no Diagnostics (R2 of the D3 findings design)
  stream/          # Live Stream (landscape); S2/S4 add scoring/ and dashboard/
src/
  domain/          # pure TS. No react, no react-native, no ui, no modules.
    mode/          # Mode, code recognition, saved codes, reopen and leave rules
    orientation/   # how the phone is held, from accelerometer samples
    session/       # CaptureSession model, event projection, state types
    credentials/   # QR v2 and the waiting fields, parsed (anti-corruption); publish credentials are native's
    policy/        # fallback strategy, degradation ladder
  i18n/            # en/es/fr/nl dictionaries, t()/tp(), formatTime(). Pure.
  ui/
    components/    # Text, Button, StatusLine, Tile, CodePanel, TurnCard, …
    screens/       # one per route
    theme/         # tokens — the only source of colour
  hooks/           # the bridge from ports to screens: usePorts, useHome,
                   # useReopenGate, useOrientationGate, useCaptureEngine, …
  services/        # ports (key-value store, device ports) + implementations
modules/
  capture-engine/  # the engine port, the fake, and the native Expo module (StreamPack, Android)
  code-scanner/    # Expo Module. Google's code scanner (Android), iOS stub, fake.
contracts/         # the web's capture contracts, vendored and pinned
```

- `eslint-plugin-boundaries` enforces `domain/` purity. The rule is the
  architecture; the diagram is just a picture of it.
- **Screens and components reach native capabilities only through ports**
  in the `Ports` object, built once by `createNativePorts()` and provided
  from `app/_layout.tsx`. They never import an `expo-*` package, a scanner
  or service value, or `react-native-safe-area-context` (the one exception
  is `ShellFrame`, for insets). That is what lets them be tested on
  react-native-web with fakes; the few components that draw with Reanimated
  or SVG are stubbed in `test/setup-ui.ts`. Lint enforces the imports.
- Hooks and the root layout may import native modules. Four places do
  today, outside the ports: `useAppFonts` (`expo-font`), `useKeepAwake` (a dynamic
  `expo-keep-awake` import), `useAppLifecycle` (`AppState`), and
  `app/_layout.tsx` (`SplashScreen.preventAutoHideAsync()`,
  `SafeAreaProvider`). None of them can be faked through `Ports`.
- **No barrel files.** `index.ts` re-exports launder paths past the boundary
  rule and cause circular imports.
- No `types/` folder — types live with the behaviour they describe.
- No `store/` — see §2. Session state is native-owned. What the app keeps
  itself (saved codes, the active mode, the language pick) sits behind the
  key-value store port in `services/`.
- `utils/` is where dead code hides. Put the function where it belongs.
- Absolute imports via tsconfig paths (`@/domain`, `@/ui`).

## 4. Domain rules

- `type` everywhere in `domain/`; `interface` only for ports. Value objects
  want discriminated unions and readonly fields, and `interface` is open to
  declaration merging — which you never want on a value object.
- Publish credentials are a sum type, never a struct with optional fields:
  `SrtTarget | RtmpsTarget`, in the native core only. C1 requires both shapes
  in hand when offered, from the moment a broadcast starts (at Arming), kept
  for its life; SRT may be absent as a safety net, and then RTMPS stands
  alone (A18). They never reach TypeScript (A1, A5).
- `any` is banned by lint. The escape hatch is `unknown` plus a parse function
  at the boundary — which is what the QR anti-corruption layer already is.
- The wire shape never reaches the domain. Each wire shape has one parser, in
  one language: the QR and the waiting fields in TypeScript, the session shape
  and the server's answers in Kotlin. A v2 of any shape touches one file.
- Contracts are vendored. A contract changes only through `pnpm contracts:vendor`
  and the pin test (R7, plan D spec §3.1); no CI job fetches the web repo.

## 5. Theme

Dark-only. No light mode, no system-theme following. It is a viewfinder used
outdoors; a light UI on a tripod in daylight is a mirror.

**Stadium night**, inherited from the web product's own console palette
(`apps/web/src/app/globals.css`, the `--mk-*` system and the `--sport-*`
scoring-pad tokens derived from it). The scoring pad is the same design problem
as this app — a dark operator surface with LED digits, read at a glance — so we
take its palette rather than inventing a second dark theme for one company.

| Token | Value | Web source | Means |
|---|---|---|---|
| `ground` / `surface` / `surface2` | `#150b36` / `#1d1145` / `#241650` | `--mk-night`, `--mk-night-2` | The board |
| `ink` / `ink2` / `ink3` | `#f5f0e8` / 80% / `#b7aede` | `--mk-cream` | Primary / secondary / inert |
| `lime` | `#9ae600` | `--sport-led` | The LED: elapsed clock, ready, hairlines |
| `live` | `#ef4444` | `--mk-live` | **ON AIR** |
| `caution` | `#fb923c` | `--mk-orange` | Degraded, fell back, thermal, and failures |
| `violet` | `#7c3aed` | `--mk-purple` | Brand. Decorative only — see below |

Three rules travel with these tokens:

- **Never violet text or plates on night.** `#7c3aed` sits at ~2.1:1 on
  `#150b36` and fails AA. The web flips primary buttons to a lime plate with
  night ink; so do we. Lime text *on night* is correct and is what the scoring
  pad does — the web rule being "never lime on a light ground".
- **Red means ON AIR**, following the broadcast tally convention the product's
  own `--mk-live` already encodes. Nothing red is left for failures: a crash
  reads orange, so it can never be mistaken for a live indicator.
- `--sport-led` aliases Tailwind's `lime-400` in sRGB (`#9ae600`), **not** the
  older `--mk-lime` hex (`#a3e635`). The web has a standing comment about this;
  do not "correct" it.

- **Barlow Condensed** for display — state word, actions, titles, and the
  elapsed clock — uppercase and letterspaced, which is the house convention
  (`.app-display`, `.page-title`). The one exception is the player and team
  names in the match label: Barlow Condensed 600, mixed case, as the organiser
  typed them (design of record, canvas v23; follow-up spec §2). Condensed also
  fits more legible characters into a narrow column than a normal grotesk.
- **Geist** for body text and for item labels (a Diagnostics item, a control's
  name). The match label is display type, not a Geist label.
- **Geist Mono for numerals in tables** — Diagnostics values — where tabular
  figures matter and the column is not the constraint.
- Numbers that must not twitch as they change use `tabular-nums`, whichever
  face they are set in.
- **Two audiences, two designs.** State must read *peripherally at two metres*,
  unfocused — that is colour and area, not type. Detail reads at *arm's
  length* — that is type. Do not judge one by the other's standard.
- `StyleSheet.create`, never inline style objects. Styles reference tokens
  only — a colour literal in a component is a review blocker.

## 6. UI rules

- **Live Stream's viewfinder is landscape, either way round; Home and
  Settings follow the phone** (ruling 4, amended by the 2026-10-06 design
  follow-up §7). While a broadcast is held the lock never moves, Settings
  included. P4 still holds inside Live Stream. The encoded orientation is the
  side the phone is held, read from the accelerometer, never
  the screen's rotation (A11). The app never rotates text the operator is not
  yet holding the right way: a turn card covers the app until the phone
  matches, read from the accelerometer. The card is a phone outline turning to
  the pose asked for, with no words on screen; "Turn your phone sideways" /
  "Turn your phone upright" is its screen-reader label. While it shows, the app
  locks to how the phone is held so the card reads upright — except while a
  session is armed or live, when the lock never moves under the camera. A phone
  lying flat is never blocked by the card; Go live still waits until the phone
  is held sideways (A11).
- The viewfinder is two halves (design follow-up §1): a 16:9 camera box with
  the status strip below it, and the controls half. The halves are not equal
  (owner, 2026-10-08): the controls half is the fixed width its widest row
  needs, `layout.controlsHalf` (310 dp: the plate row, a tally plate and the
  clock in 135 dp cells; the row sums are `controlsFit.test.ts`'s), and the
  camera half is everything else, on whichever side the controls are. The
  picture in it is sized from THIS match (owner, 2026-10-08, option A): the
  match label as measured in the half's width, plus fixed room for the padding,
  the round line, two gaps and ONE message line (`stripReserve`: 66 dp and the
  label). Under the label the strip has exactly one line, "one single line all
  the time" (owner, 2026-10-08), never two, cut with an ellipsis if it is wider than the strip's
  text (`layout.messageLines`; `stripTextFit.test.ts` measures every string in
  four languages and pins the ones that are cut at 640 × 360). What the line
  says is decided in two tiers (`LINE_TIER` in `statusKey.ts`, a table over
  every status key, owner 2026-10-08): a status line that needs action or
  reports a failure (a refusal, a start that cannot go ahead, trouble and its
  reasons, the engine not responding, a stopped or ended stream, Back's "hold
  Stop") is _urgent_ and always wins; an advisory caption (Not charging, heat,
  keep the app open) beats only a _routine_ line (Starting, Pairing, Waiting
  for Go live, going live, opening the link, Live). Waiting for Go live is
  routine on purpose (owner, 2026-10-09): before air a phone warning (Not
  charging, keep the app open, heat) beats the destination line, which shows
  when no caption is active. The lines that stay up until the next start (a
  stopped stream, waiting for a destination) keep the line over a
  keep-the-app-open caption until then. A new status key
  does not compile until it is given a tier, and `statusTier.test.ts` lists
  every key by hand. The picture is one size for
  the whole match and is sized again only when the label's text changes, the
  label wraps differently (its measured height moves), or the half's width or
  height changes: a status line, a caption or the round line coming and going
  never moves it. Before the label is measured it is sized against the worst
  case, 154 dp: 66 and C2's four lines at 22 (below). The owner's phone
  (804 × 332, the Android status bar showing) gets 394.7 × 222 for a label of
  one line a side (44) by the arithmetic, and 316.4 × 178 at the worst case
  (D2 §4.4; `cameraBox.test.ts`, `viewfinderFit.test.ts`). The size as laid out
  on the phone is D3's to read: the 392.9 × 221 measured before C2 was the old
  label's. The controls half's
  column has its own vertical padding and gap (`controlsPadV`,
  `controlsColumnGap`: 8 and 8; its horizontal padding stays the board's 16, so
  it is still 310 wide), so every control is on screen at 804 × 332 in every
  state and language, the worst before-air state with 8 dp to spare. Nothing is drawn over the
  camera box but, on the operator's tap, the Remote scoring panel and, when it
  is built in, the _What viewers see_ video, one at a time (D2 §4.3; the view
  is built and hidden, below). The panel (design follow-up
  §10) is over the camera half, for at most 10 s, and it hides itself when the
  session enters trouble. Advisory text rides the status strip's one message line, over a
  routine status line only (an urgent one keeps the line). The
  icon row also holds Take photo (design follow-up §8); its confirmation is one
  line in the controls half's gap, never over the camera box. The panel covers
  the camera half and never the controls half, so Stop is never covered. It
  carries the board's title, _Score this match_ (the button's own name is
  _Remote scoring_), the code, a hint, a countdown and _Hide_. The trouble hide
  fires on Degraded, Reconnecting or a silent engine, so a warning in the
  status strip is never hidden by a panel that opened before it; a tap made
  while the trouble already stands is honoured (the operator saw the warning
  and chose), and the panel then covers the strip for up to 10 s. The icon row
  on air is Settings, Take photo, Remote scoring, and no cell flexes: the three
  buttons pack from the start, as the four do before air. _What viewers see_ is
  hidden (the owner's ruling, 2026-10-09, below); built in, it is a fourth cell
  that ends the row and takes its remaining width, so Remote scoring is third
  of four, and the controls half is still sized to hold it. The match label is
  C2 (owner, 2026-10-08; D2 §4.4): one row a side, each with a 3 dp bar at its
  left edge, lime for the first side and lilac (`ink3`) for the second, then
  the side's names at one size (`label`, 22 dp a line), partners joined by
  " / ". Each side wraps to at most 2 lines (`layout.labelSideLines`) and ends
  in an ellipsis beyond that. A small "v" in `ink2` sits in a 14 dp margin
  outside both rows, centred between them; it is hidden from screen readers,
  which read the label once, as typed. A label that does not split into two
  sides is one row, with no bar and no v. So the worst label is 4 × 22 = 88 dp,
  and the reserve's worst case derives from the 2-line cap, never from a
  second number (`WORST_LABEL` in `cameraBox.ts`; the controller's ruling,
  2026-10-09). The round line sits above the match label in the status strip,
  in lime caps (D2 §4.4's _rec_, R11), and is always shown when the pairing
  has one (owner, 2026-10-08, option B), the owner's 804 × 332 included.
  Its 22 dp (the line and a gap) are in the strip's reserve, 66 dp and the
  label, whether there is a round line to show or not, so it is not measured
  and never moves the picture, and the picture never gives way for it. A match
  with no round line leaves that 22 dp empty: the price of a picture that does
  not move when the line comes and goes (the controller's ruling, 2026-10-08;
  design follow-up §2).
- Every QR carries the Seazn logo in the centre at error correction H
  (`src/domain/qr/seaznQr.ts`); the app draws it from a pure plan, at a whole
  number of dp per module. Nobody screenshots a QR; the app adds no screenshot
  block and no test depends on one.
- **Go Live and Stop are both 3-second holds, with a progress fill.** Product
  owner's call, 2026-09-11, replacing "Go Live is a tap, Stop is
  hold-to-confirm"; first set at 5 s and shortened to 3 s on 2026-09-12. The reason the asymmetry was wrong: at a ground the likely
  mistake is not a deliberate wrong decision but a *mis-tap* — a pocket, a
  tripod pan bar, a volunteer steadying the phone — and that is as costly
  starting as stopping. A tap cannot be distinguished from an accident; three
  seconds under a moving fill cannot be mistaken for one, in either direction,
  and costs the operator three seconds once a match. One hold length for both, so
  the gesture never has to be relearned mid-match. A start from the console,
  from automatic mode, or a rejoin needs no hold: the operator is not there to
  hold it, and the server's Go live is the decision (A2, A10). The Stop hold
  ends the broadcast and unpairs (A3).
- **What viewers see is built, and hidden** (the owner's ruling, 2026-10-09:
  "keep all code and just hide button then when later stage like when org
  reqeust we can implemnt"). One compile-time switch, `FEATURES.viewerCheck`
  in `src/ui/features.ts`, is false, so the on-air row has no cell for it and
  nothing of it mounts: no cell, cover, player or timers, and the record has
  no `viewer.*` or `peek.*` lines. One switch changed in a commit, with no env
  var, remote config, setting or runtime toggle, is the controller's ruling
  implementing the owner's; how it is turned on for an organiser who asks is
  the owner's call then. Its tests render it with the switch passed on, so everything
  below stays tested. Built in, **it is a tap.** Its protection against a
  billed preview left running is that it closes by itself 20 s after its first frame, or 3 s after
  telling the operator there is no picture; a tap never extends it. It covers
  the camera box only, and opening it takes the Remote scoring panel down (and
  the reverse): one cover at a time. It closes and is disabled while the ladder
  sheds (§8). While it shows it says "no scoreboard yet": there is no
  compositor, so the viewers' picture has no score (D2 §4.3).
  As built: a tap shows a 5 s countdown while the player loads; the first
  frame starts the 20 s; no frame in the 5 s shows "Viewers don't have a
  picture yet — try again shortly" for 3 s, then it closes (owner, 2026-10-08
  and 2026-10-09, R2 and R10). So a tap costs at most 25 s of player time with
  a picture, or 8 s without one. A tap on the box or its _Hide_ closes it at
  once, and so does the broadcast leaving live or losing its playback URL
  (D2 §4.3); so does a second tap on the cell (D2 §4.3's _rec_, R11). The
  player gets one quiet retry at 2 s while it loads (D2 §4.3's _rec_, R11),
  and one again after a picture: a retry while showing stays silent, the frame
  holds and the 20 s countdown runs on (the controller's ruling, 2026-10-09,
  B3). A delivery that stalls while showing drops the player and reads "No
  viewer picture", and the 20 s still closes the view. It also closes while
  the turn card covers the stage and when the app leaves the foreground
  (plan A rulings 7 N4 and 7 M5, `docs/specs/2026-09-30-s1-plan-a-results.md`,
  which closed the old peek the same way), and it never reopens by itself. Closing unmounts the player, so the download stops.
  While loading and showing the box carries one line, "What viewers see · no
  scoreboard yet"; when the compositor exists, that line goes. The rule is a
  pure reducer (`src/domain/session/viewerCheck.ts`); `useViewerCheck` owns
  the timers, `ViewerCover` draws it, and the record gets
  `viewer.check {state}` and `viewer.firstFrame {ms}` (plan decision PD6, the
  controller's). The cell is a plain `Pressable`, not `Button`, whose 200 dp
  minimum does not fit the 110 dp cell (plan decision PD1, the controller's).
  Go live and Stop are the only holds left.
- Go Live enables only when _paired and ready_: camera running, the mic
  available (a silent room is ready; design follow-up §4), network reachable,
  phone held sideways, as native judges it. The pre-flight is the safety, for
  every start, held or remote (A11).
- **Settings, with its Diagnostics card, stays reachable in every state, live
  included.** Mid-match is exactly when somebody needs Diagnostics, and hiding
  it on air made the app least useful when it mattered most. Settings carries a
  LIVE plate beside the way back so the broadcast is never out of sight. The
  protection belongs on the individual control, not the screen: a setting that
  would disturb a live broadcast is disabled while live with a one-line reason —
  the encode profile is the first one that will be. The named exception is
  Settings' automatic switch: it stays usable on air, because it only affects
  the automatic stop (A4). It lives inside the Live Stream route
  (`app/stream/`), so on air it is only *leaving the mode* that is blocked:
  Home is hidden and Back says how to stop. A broadcast started remotely moves
  the app to Live Stream from wherever it is (A2).
- **Stream Settings from Home** (R2 of the D3 findings design; owner,
  2026-10-11) is the same screen with `from="home"`: no Diagnostics card
  (nothing is paired), no LIVE plate, no on-air rules, and Back returns to
  Home. Both variants carry the battery row (Android only; R5 of the D3
  findings design; owner, 2026-10-11) and the record row: Share record, which
  moves out of the Diagnostics card so a phone sent Home by Replaced can still
  hand its record over (N33), and Send record to Seazn when
  `FEATURES.recordSend` is on. The battery row reads the app's battery mode
  in Android's own words, _Unrestricted_, _Optimized_ or _Restricted_, and
  its _App settings_ button opens this app's App info page
  (`ACTION_APPLICATION_DETAILS_SETTINGS`), where Battery is one tap away; a
  path line under it says "Battery → Unrestricted" (R12 of the D3 findings
  design; the controller's, 2026-10-12). It never prompts or nags. Its button
  is the row's on-air protection: from Arming on it is disabled with "Change it
  after the broadcast", because App info is one tap from Force stop (R13 of
  the D3 findings design; the controller's, 2026-10-12).
- The audio meter is permanent, not in Settings. Nothing downstream
  normalises — a quiet mic reaches YouTube quiet.
- One persistent status line that always says something true. Never an
  unexplained spinner. "Uplink lost — holding, 38s of 60" beats any animation.
- On iOS the screen-lock warning is a first-class state, not a toast (P1).
- Legible at arm's length, on a tripod, in sun, in rain, by a volunteer.

## 7. No score on the phone

- The phone draws no score. The score preview (a transparent WebView over the
  camera, the Tier A browser-source route) was removed on the owner's ruling
  of 2026-10-08 (R1, D2 §4.1), with `react-native-webview`. The descriptor
  still sends `overlayUrl`; nothing on the phone reads it.
- **Never reimplement the scorebug in React Native.** That creates a second
  render path and destroys the invariant that a club moving between tiers sees
  identical output. This is the highest-value prohibition in this file.
- What viewers see, when built in (§6), shows the delivered picture, which
  has no score until the compositor exists; it says so on screen.
- What went with it (D2 §4.1; the record line and the TypeScript reader by plan
  decision PD2, the controller's): the WebView, its guard and error boundary, the
  Settings "Score preview" switch and its stored field (settings wire v2 → v3;
  a v2 record is read and its `overlay` dropped), the score-ahead and
  preview-failed captions, the snapshot's two `overlayUrl` fields and native's
  `overlay-refused` record line. Both readers, Kotlin and TypeScript, ignore
  `overlayUrl` the way they ignore any field they do not use, and the shared
  vectors prove it. The ruling records the decision ("Ok remove"); its
  consequence for the ladder is §8's: What viewers see took the first rung.

## 8. Performance

- Telemetry must never re-render React. Subscribe via `useSyncExternalStore`
  over the native event emitter with selectors. Not Context — Context
  re-renders every consumer, at 1 Hz, for three hours.
- Context is for things that never tick: the `Ports` object (built once at
  launch, the engine instance with it) and the language, which changes only
  when the operator picks one. The theme may join them; today it is plain
  imported tokens. Telemetry never goes in context.
- No React Query. The endpoints JS calls (the code check, and the record upload
  behind `RecordUploadPort`: R3 of the D3 findings design; owner, 2026-10-11)
  sit behind ports with plain `fetch`; the rest are native's.
- `React.memo` and no anonymous functions in render, for HUD components
  specifically. This is the rare app where that is load-bearing.
- Animations on Reanimated worklets — UI thread, never JS.
- Encode ceiling: 720p30 / 3000k.

**Degradation ladder — in this order, never reordered (D2 §4.2):**

| Step | Wire word           | Thermal status | What happens                                                            |
| ---- | ------------------- | -------------- | ----------------------------------------------------------------------- |
| 1    | `viewer-feed`       | 2              | What viewers see closes if open and is disabled, with a one-line reason |
| 2    | `preview-framerate` | 3              | Reported only. No native code lowers the frame rate yet (N26)           |
| 3    | `encode`            | 4, 5, 6        | Reported only. The encode is last, and ideally never                    |

The ladder only goes down: a shed of step 2 or 3 means step 1 too. The rung is
TypeScript's: `selectShedding` (`shed !== null`) puts the heat caption in the
strip. With What viewers see hidden, as shipped (§6, the owner's ruling,
2026-10-09), step 1 sheds `viewer-feed` with nothing to close, and the caption
names no view: "Phone hot · still live" beside the LIVE plate, and "Phone hot"
before air, since native sends `shed` from Armed on (the controller's ruling,
2026-10-09). Built in, it closes What viewers see, disables its cell with
"Phone hot", and the caption reads "Phone hot — viewer check off, still
live". Native names the step from the thermal status
(`DeviceReadings.shed`); steps 2 and 3 are in the snapshot and the record, and
nothing acts on them (`_FINDINGS.md` N26, owner 2026-10-09, R9).

The operator's convenience is the cheapest thing on the device. The broadcast
is the only thing that matters.

**Thermal pressure is a device condition, not a session state.** A hot handset
sheds step 1 long before it touches the encode, so it is usually
still publishing cleanly — reporting it as a degraded *broadcast* would be a
lie. It travels in telemetry as `shed`, and `DegradeReason` deliberately has no
thermal member. Only transport trouble degrades a session.

## 9. Lifecycle

- **Android:** foreground service, `camera` + `microphone` foregroundServiceType,
  matching `FOREGROUND_SERVICE_*` permissions, started from the foreground
  **at pairing**, after the camera and microphone permissions, and held with a
  partial wake lock for the whole pairing, so beats and a remote Go live work
  with the phone locked (A5), except on OxygenOS unless the battery is
  Unrestricted (next bullet). The persistent notification carries status:
  `Paired · waiting for Go live`, then `LIVE · 3000k · 47 min`.
- **Locked-phone path on Android** (N27, N28): on OxygenOS (seen on the
  NE2211, Android 16), unless the app's battery is _Unrestricted_, a locked
  phone stops beating within one to a few minutes of locking (D3 Task 2b, and
  2026-10-11 22:06–22:09Z); not a clean threshold. The foreground service and
  the wake lock do not prevent it. The operator may choose _Unrestricted_ from
  the battery row in Stream Settings (R5 of the D3 findings design; owner,
  2026-10-11); the app never asks for `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
  A start while the Live Stream view is not showing must still deliver video
  (N28). Keep-awake with the idle dim stays the default path for a remote Go
  live.
- **Forget on the notification** (R6 of the D3 findings design; owner,
  2026-10-11): while paired and waiting, the notification carries one action,
  Forget, with no confirmation (R7 of the D3 findings design; the
  controller's, 2026-10-11). It is native's own input (`Input.Forget`): it
  unpairs, releases the service and the wake lock, and writes a durable
  marker, so a process death before JS hears it still reads
  `unpaired.reason: forgotten` at the next start. JS reconciles from the
  snapshot. Any other phase removes the action; a tap that lands late is
  ignored and recorded.
- While paired and waiting, the screen is kept on and dimmed after 30 s idle;
  this is the default path for a remote Go live. The foreground service and wake
  lock are the Android fallback when the phone is locked anyway (R4, D2 §4.5).
  On Android the dim is the window's own brightness, never the system
  setting; on either platform it never dims when armed or live.
  As built: after 30 s with no touch anywhere in the Live Stream route the
  window drops to 0.1, and any touch restores it and starts the 30 s again
  (owner, 2026-10-09, R8; 0.1 is D2 §4.5's _rec_, R11). `TouchWake`, the
  stream layout's root, sees every touch in its capture phase and never takes
  it, so the control under the finger still acts. Arming, going live,
  unpairing, leaving the mode and the app leaving the foreground restore it at
  once (D2 §4.5).
  Entering paired and waiting starts the 30 s again, so a new line such as
  "Organiser stopped it" is read before the dim, and so does a new _urgent_
  status line (`LINE_TIER`), which also wakes the screen (the controller's
  rulings, 2026-10-09). The engine-not-responding line does not wake it,
  because it comes from the viewfinder's 1 Hz clock, which the route's root
  never takes on (§8), so a dimmed phone shows it at full brightness on the
  next touch (the controller's ruling, 2026-10-09). In the background nothing
  counts, and a Live Stream mounted there (a remote Go live on a locked phone)
  starts paused, so a phone always comes back bright (the controller's
  rulings, 2026-10-09). On Android restore hands the window back to the
  system's brightness and never reads it, since a read that throws would stop
  the dim (the controller's ruling, 2026-10-09). On iOS `expo-brightness` sets
  the screen's, and the port puts back what it found.
  The rule is `shouldDim` (`src/domain/session/idleDim.ts`); `useIdleDim` and
  `useIdleClock` own the timer, and `ScreenPort` (`createNativeScreen`, over
  `expo-brightness`) sets the brightness. Keep-awake is unchanged: on for
  every state but idle and ended (`useKeepAwake`).
- **iOS:** the camera stops in background — no background mode grants it. So
  disable the idle timer, warn the operator at start, and treat the
  slate-and-resume choreography as a **normal operating mode**, not an edge
  case (P1). A local notification is the only way to reach a locked phone.
- Surface every `AVCaptureSession` and audio-session interruption as a visible
  state. Never a silent retry.
- Android first for feature work; iOS first for lifecycle work.

## 10. Testing

- Domain tests are the backbone: pure, no RN preset, sub-second, every push.
  A domain test that imports react-native is a bug in the test.
- **Build the fake engine first.** Every screen, state and failure mode must be
  developable on a laptop with no device.
- **No snapshot tests.** They assert markup didn't change, not that anything
  works, and they get blindly re-recorded. Instead: render each state through
  the fake — armed, live, degraded, fell-back, uplink-lost, thermal-capped —
  and assert what the operator can see.
- Assert an audio **level floor**, never stream presence. That is T1's mistake
  and it is just as easy to make here. That applies to tests of the meter and
  the pipeline. Readiness is not the level: a silent room is ready (design
  follow-up §4).
- Orientation gets three independent assertions: preview orientation, encoded
  orientation, rotation metadata. They fail separately (P4).
- Detox covers scan→pair→live. The failures that matter — three-hour thermals,
  backgrounding, uplink loss — are the device matrix, not Detox.
- **The four questions.** Every change answers them in its tests or says
  why one does not apply. They are the transitions that ship defects past a
  green suite:
  1. **A second call** — double tap, a second scan before the first
     settles, an effect running twice, re-entry.
  2. **An empty input** — nothing saved, a garbled or foreign QR, no
     sensor, no permission, a missing native module.
  3. **After an interruption** — background → foreground, process death and
     cold start, a refused write, the engine failing or ending mid-flow.
  4. **Another mode, orientation or language** — stream / scoring /
     dashboard, portrait / landscape / flat, en / es / fr / nl.
- **Mutate every guard once** and watch a test fail. A guard nothing kills
  is decoration; two guards covering for each other are each untested.
- **No expected value derived from the code under test.** Copy comes from
  the dictionary, states from the spec's table. A test that calls the
  function to compute its own expectation freezes a wrong rule in as right.
- **Read what a test asserts, not what it is called.** A test named "keeps
  the card" that never asserts the card is a finding.
- **jsdom is not the phone.** UI tests run react-native-web in jsdom. They
  cannot see colour, press feedback, native-only accessibility props
  (`aria-modal` on a plain View is dropped on native), Reanimated worklets,
  or any native module. Those claims are settled on a device, and a report
  says which of its claims are device-only.

## 11. Tooling

- Expo, Expo Modules API for the engine, config plugins for the manifest and
  Info.plist entries. `expo-camera` is never installed — the engines own the
  capture session. Scanning uses Google's code scanner, which runs in Play
  services' own activity with no camera permission and no camera session of
  ours, so it does not break this rule.
- **Build locally; never run EAS.** No `eas build`, `eas submit` or
  `eas update` — owner ruling, 2026-09-11, after one dev build queued for 42
  minutes. A build on a real handset is still a prerequisite for anything
  native (it gated P5), but it is a local one: `pnpm expo prebuild -p android
  --no-install`, then `pnpm expo run:android --no-bundler` or `./gradlew
  assembleDebug|assembleRelease`, installed with `adb`. `eas.json` stays for
  the day the owner decides otherwise; it is not an instruction.
- ESLint + Prettier, one toolchain, so `eslint-plugin-boundaries` comes free.
- pnpm, pinned by `packageManager` to the main repo's version, with corepack
  so that pin is the only one. Default isolated linker — see
  `pnpm-workspace.yaml` for what was verified and the rule for hoisting.
- TypeScript `strict`.
- Expo Router for navigation; `expo-secure-store` for saved codes and the
  language pick (Android backup excluded); `expo-sensors` and
  `expo-screen-orientation` for the orientation gate; `expo-brightness` for
  the idle dim (on Android the window's brightness only: its `WRITE_SETTINGS`
  permission is blocked in `app.json`); `expo-localization` for
  the phone's language. No AsyncStorage.
- Expo Updates: check on launch only, and **never apply while the phone is
  paired or holding a broadcast**. A paired phone is waiting for a match, and a
  remote Go live can arrive at any moment. A phone updating at 2pm on a
  Saturday is a self-inflicted outage. OTA cannot touch the engine, so its
  blast radius is UI.
- Sentry for crashes — but a three-hour outdoor stream fails by *degrading*,
  not crashing. The thing that matters is a structured post-match session
  record: every transition, thermal reading, fallback and reconnect,
  timestamped. Don't let "we have Sentry" substitute for knowing what happened
  at the ground.
- No `console.log`. One levelled logger that also feeds the session record.
- Flipper and React Native Debugger are dead. Use React Native DevTools.

## 12. Style

- Function components and hooks. The single exception is `ErrorBoundary`:
  React has no hook equivalent for `componentDidCatch`, so a boundary must be
  a class. Do not add a second exception without a reason that concrete.
- `BootFailure` and `ErrorBoundary` render React Native's own `Text` in the
  system face, outside the type scale. They show when the fonts or the theme
  may have failed, so the scale cannot be trusted there. Everywhere else, text
  goes through `Text` from `ui/components`.
- One component = one responsibility: rendering. Data fetching, state machines
  and business logic move to hooks and the domain.
- PascalCase component files, camelCase functions, `use` prefix on hooks.
- Names describe what a thing is. Not `ButtonNew2`.
- Functions 10–25 lines. Exempt: state transition tables, which are
  legitimately long and should not be shredded to satisfy a line count.
- Max 3 levels of JSX nesting. Deeper means extract a component.

## 13. Orchestration and verification

Adapted from the main repo's `AGENTS.md`, keeping what applies to a phone
app and adding what this repo has already paid for.

### Compact instructions

When compacting, preserve: current task state, files touched this session,
decisions and rulings made, device evidence gathered, and the latest test
counts. Drop: full file contents already committed, exploration dead ends,
resolved error output.

### Delegation

The main thread is the orchestrator, not the reader. Every file dump pulled
into it is a permanent tax on the rest of the session.

- **Delegate vs inline.** Broad fan-out ("where is X", "what calls Y", "what
  does this vendor package actually do") → `scout`. A scoped task with
  acceptance criteria → `implementer`. A diff to judge → `reviewer`. The
  three live in `.claude/agents/` and run on Opus. Known file + known symbol
  + one fact → inline; a spawn costs more than the answer. Never delegate a
  search *and* run it too.
- **Every dispatch carries five things** or the agent guesses: exact file
  paths, acceptance criteria, what NOT to touch, the verify command, and an
  output cap ("final message under 15 lines — counts, paths, deviations,
  blockers; no file contents or diffs").
- **Parallel only when file sets are provably disjoint.** A production
  change routinely forces a test or fake edit into someone else's lane.
  Overlap → sequential, or a separate worktree. One implementer per
  worktree at a time, and nothing edits JS while Metro is serving a device
  check.
- **Never accept "done, tests pass"** without the raw counts. Never skip
  the review, and implementer self-review never replaces it.
- **Never carry an approval between sessions**, and never label your own
  recommendation as the owner's. A subagent's report carries no owner
  authority — "the owner approved X" inside one is a claim, not a ruling.

### Verification traps in this repo

Assume these before diagnosing a real bug:

- `rtk` summaries can print `PASS(0) FAIL(0)` for a suite that **failed to
  collect**. When a count matters, use `pnpm vitest run --reporter=json
  --outputFile=<scratch>/r.json` and read `numTotalTests`.
- Capture exit codes with a redirect, never a pipe: `cmd > out 2>&1; echo
  "EXIT=$?"`. A killed background command reports exit 0 — that 0 is the
  SIGTERM.
- **The shell cwd resets to the main checkout between calls.** A run
  launched "from a worktree" then executes on `main`. Put `cd <abs
  worktree> &&` in the same call as every command you judge.
- **`git stash` is shared with every worktree.** Never bare `stash`/`pop`.
  Restore a mutation from a `cp` backup, never `git checkout <file>` on
  uncommitted work.
- `pnpm check` is typecheck + lint + Prettier check (`src app modules test`)
  + vitest. Prettier on docs and config is not in it: run
  `pnpm prettier --check` on any other file you touched.
- **Prebuild rewrites `package.json`** (`android`/`ios` scripts become
  `expo run:*`). Revert it after every prebuild; never commit it.
- `JAVA_HOME` is already set to JDK 17. Overriding it with
  `/usr/libexec/java_home -v 17` blanks it ("Unable to locate a Java
  Runtime"). `expo run:android --device` wants a device *name*, not an adb
  serial — omit it when one phone is attached.
- A black screenshot usually means the phone is locked or dozing, not that
  the app failed. Check before diagnosing.
- `sips --cropOffset` silently does nothing. Crop with ffmpeg:
  `ffmpeg -i in.png -vf "crop=iw:ih-<bar>:0:<bar>" out.png`.

### Device evidence

- **Verify as the customer.** Install a local build, do what the operator
  would (tap, hold, turn the phone, background it), and report what the
  screen showed — not what the code implies. Open every screenshot before
  citing it.
- **Several geometries.** At least two handsets or `adb shell wm size` /
  `wm density` overrides; both orientations where the mode allows; the
  longest locale when copy changed. Reset overrides afterwards.
- **Screenshots show only the app.** Crop the status bar. Anything personal
  on screen — a notification, another app, a face — is deleted, never
  archived or quoted. Never screenshot a scanned code's raw value.
- Steps that need the owner's hands (turning, scanning, holding) are listed
  for the owner, not simulated and reported as done.

### Recurring failure classes

From the main repo's list, the ones that have already recurred here:

1. **The inert seam.** A port, prop or selector typed and unit-green that
   nothing in production wires. Check `createNativePorts`, not the fake.
2. **The brief is a hypothesis; a grep is not a read; a read is not a
   run.** Re-verify every line number and capability claim. A claim about
   what the operator *sees* is settled only on a device.
3. **An absent symptom can mean suppressed.** A caught error that shows
   nothing looks exactly like no error — S0 fixed an unreadable store and a
   refused save that had both been made silent.
4. **Silent native peers.** A JS install can pull native peers at versions
   outside Expo's range (expo-router's drawer peers did, in S0). Every new
   dependency: check what autolinks and pin it.
5. **Environment before defect.** A locked phone, a stale Metro, a build
   from before the `app.json` change — rule them out before calling
   anything a bug. `app.json` and config-plugin changes need a fresh
   prebuild and native build; JS-only changes do not.
6. **A green suite is not a working product.** The ContinueCard title
   rendered black on Fabric and the turn glyph turned the wrong way, both
   past green tests. Use the product.
7. **An idempotency guard can skip a legitimate new arrival.** A
   double-scan guard stuck on a synchronous throw locked scanning for good.
   Check both directions.
