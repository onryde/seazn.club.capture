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

The whole app is five screens:

**Scan** (QR → credentials) → **Arm** (preview, pre-flight) → **Live** (HUD) →
**Settings** → **Diagnostics**

No accounts, no login, no fixture browsing, no scoring, no chat, no replays,
no gallery, no upload, no in-app payments, no remote push.

Adding a sixth screen is a product decision, not an implementation detail.
Raise it; don't build it.

Hardware contributors (HDMI encoders, camcorders, PTZ cameras) publish to the
same Cloudflare live input without this app. They are served by the session
page in the main repo, not here. Do not grow the app to accommodate them.

## 2. The native/JS line (P2)

**Native owns the session. JS renders and sends intents.**

- Native owns: capture, encode, connect, publish, reconnect, SRT→RTMPS
  fallback, orientation, capture timestamps.
- JS receives a ~1 Hz state snapshot. That is the entire upward contract.
- Commands are **intents, not RPC**: `start`, `stop`, `switchCamera` return
  void and are reconciled against native state. A promise that must resolve
  mid-reconnect is a deadlock waiting for a bad cell.
- **Never build a second state machine in TypeScript.** The aggregate lives in
  native. The TS layer is a *projection* of native events. Two authorities
  disagree at 3-1 in the 40th over.
- Frames never approach the bridge. Preview is a native view.

## 3. Layering — enforced, not documented

```
src/
  domain/          # pure TS. No react, no react-native, no ui, no modules.
    session/       # CaptureSession model, event projection, state types
    credentials/   # StreamCredentials sum type + QR parsing (anti-corruption)
    policy/        # fallback strategy, degradation ladder
  ui/
    components/    # Text, Button, StatusLine, Meter, Toggle, Badge
    screens/       # the five
    theme/         # tokens — the only source of colour
  hooks/           # useCaptureEngine, useSessionCredentials, useThermalState,
                   # useKeepAwake, useAppLifecycle. Resist a sixth.
  services/        # session API port + fetch implementation
  navigation/
modules/
  capture-engine/  # Expo Module. ios/ (HaishinKit.swift), android/ (StreamPack),
                   # src/ (TS spec, port interface, fake implementation)
contracts/         # vendored capture-qr.v1.json + generated types
```

- `eslint-plugin-boundaries` enforces `domain/` purity. The rule is the
  architecture; the diagram is just a picture of it.
- **No barrel files.** `index.ts` re-exports launder paths past the boundary
  rule and cause circular imports.
- No `types/` folder — types live with the behaviour they describe.
- No `store/` — see §2. State is native-owned.
- `utils/` is where dead code hides. Put the function where it belongs.
- Absolute imports via tsconfig paths (`@/domain`, `@/ui`).

## 4. Domain rules

- `type` everywhere in `domain/`; `interface` only for ports. Value objects
  want discriminated unions and readonly fields, and `interface` is open to
  declaration merging — which you never want on a value object.
- `StreamCredentials = SrtCredentials | RtmpsCredentials`. A sum type, never a
  struct with optional fields. C1 requires both shapes in hand at scan time.
- `any` is banned by lint. The escape hatch is `unknown` plus a parse function
  at the boundary — which is what the QR anti-corruption layer already is.
- The wire shape never reaches the domain. A v2 contract touches one file.
- Contracts are vendored. Changing `capture-qr.v1.json` requires the CI drift
  check against the main repo's copy.

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
  elapsed clock — always uppercase and letterspaced, which is the house
  convention (`.app-display`, `.page-title`). Condensed also fits more legible
  characters into a 150px column than a normal grotesk.
- **Geist** for body text and labels.
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

- Landscape-locked. P4: it is the only orientation that matters.
- Full-bleed preview. Controls live in the side gutters, never over the middle
  third — that is the shot being framed. Advisory text (device conditions, the
  lock rule) rides a solid strip on the top or bottom **edge** of the stage,
  which is the only thing ever drawn over the preview: the column is for what
  the operator acts on, and it has no height to spare for prose.
- **Go Live and Stop are both 5-second holds, with a progress fill.** Product
  owner's call, 2026-09-11, replacing "Go Live is a tap, Stop is
  hold-to-confirm". The reason the asymmetry was wrong: at a ground the likely
  mistake is not a deliberate wrong decision but a *mis-tap* — a pocket, a
  tripod pan bar, a volunteer steadying the phone — and that is as costly
  starting as stopping. A tap cannot be distinguished from an accident; three
  seconds under a moving fill cannot be mistaken for one, in either direction,
  and costs the operator three seconds once a match. One hold length for both, so
  the gesture never has to be relearned mid-match.
- **Press-and-hold is not always a confirmation.** The preview control is held
  too, and reads as a pair with the action below it, but it answers on the
  instant the finger lands — there the hold *is* the feature, the thing that
  stops a billed preview running unattended (§7). Never put a confirmation delay
  on it.
- Go Live enables only when *armed*: credentials parsed, camera running, audio
  above a level floor, network reachable. The pre-flight is the safety.
- **Settings and Diagnostics stay reachable in every state, live included.**
  Mid-match is exactly when somebody needs Diagnostics, and hiding it on air
  made the app least useful when it mattered most. Both screens carry a LIVE
  plate beside the way back so the broadcast is never out of sight. The
  protection belongs on the individual control, not the screen: a setting that
  would disturb a live broadcast is disabled while live with a one-line reason —
  the encode profile is the first one that will be.
- The audio meter is permanent, not in Settings. Nothing downstream
  normalises — a quiet mic reaches YouTube quiet.
- One persistent status line that always says something true. Never an
  unexplained spinner. "Uplink lost — holding, 38s of 60" beats any animation.
- On iOS the screen-lock warning is a first-class state, not a toast (P1).
- Legible at arm's length, on a tripod, in sun, in rain, by a volunteer.

## 7. Overlay preview

- The overlay comes from `/overlay/fixtures/[id]` — the **Tier A browser-source
  route**, rendered in a transparent WebView over the native preview.
- **Never reimplement the scorebug in React Native.** That creates a second
  render path and destroys the invariant that a club moving between tiers sees
  identical output. This is the highest-value prohibition in this file.
- Not the `/relay` variant — that carries the WHEP video element, and on the
  phone the camera underneath is already the picture.
- Phone runs `delayMs = 0`; the operator sees the score slightly ahead of what
  viewers see. Say it in the UI once.
- Wrap the WebView in an error boundary. An overlay crash must never take the
  live HUD with it.

## 8. Performance

- Telemetry must never re-render React. Subscribe via `useSyncExternalStore`
  over the native event emitter with selectors. Not Context — Context
  re-renders every consumer, at 1 Hz, for three hours.
- Context is for the theme only, which never changes.
- No React Query. Four endpoints behind a port with plain `fetch`.
- `React.memo` and no anonymous functions in render, for HUD components
  specifically. This is the rare app where that is load-bearing.
- Animations on Reanimated worklets — UI thread, never JS.
- Encode ceiling: 720p30 / 3000k.

**Degradation ladder — in this order, never reordered:**

1. Overlay preview sheds first (visible "preview paused — still live" state)
2. Then preview framerate
3. The encode is last, and ideally never

The operator's convenience is the cheapest thing on the device. The broadcast
is the only thing that matters.

**Thermal pressure is a device condition, not a session state.** A hot handset
sheds the overlay preview long before it touches the encode, so it is usually
still publishing cleanly — reporting it as a degraded *broadcast* would be a
lie. It travels in telemetry as `shed`, and `DegradeReason` deliberately has no
thermal member. Only transport trouble degrades a session.

## 9. Lifecycle

- **Android:** foreground service, `camera` + `microphone` foregroundServiceType,
  matching `FOREGROUND_SERVICE_*` permissions, started from the foreground.
  The persistent notification carries live status: `LIVE · 3000k · 47 min`.
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
  and it is just as easy to make here.
- Orientation gets three independent assertions: preview orientation, encoded
  orientation, rotation metadata. They fail separately (P4).
- Detox covers scan→arm→live. The failures that matter — three-hour thermals,
  backgrounding, uplink loss — are the device matrix, not Detox.

## 11. Tooling

- Expo, Expo Modules API for the engine, config plugins for the manifest and
  Info.plist entries. `expo-camera` is never installed — the engines own the
  capture session.
- EAS Build from day one. A signed build on a real handset is a prerequisite
  for the P5 spike that gates the architecture, not a step-nine nicety.
- ESLint + Prettier, one toolchain, so `eslint-plugin-boundaries` comes free.
- pnpm, pinned by `packageManager` to the main repo's version, and EAS builds
  with `corepack: true` so that pin is the only one. Default isolated linker —
  see `pnpm-workspace.yaml` for what was verified and the rule for hoisting.
- TypeScript `strict`.
- Expo Updates: check on launch only, and **never apply while a session is
  armed or live**. A phone updating at 2pm on a Saturday is a self-inflicted
  outage. OTA cannot touch the engine, so its blast radius is UI.
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
- One component = one responsibility: rendering. Data fetching, state machines
  and business logic move to hooks and the domain.
- PascalCase component files, camelCase functions, `use` prefix on hooks.
- Names describe what a thing is. Not `ButtonNew2`.
- Functions 10–25 lines. Exempt: state transition tables, which are
  legitimately long and should not be shredded to satisfy a line count.
- Max 3 levels of JSX nesting. Deeper means extract a component.
