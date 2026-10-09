# S1 Plan D2: design follow-up 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One implementer per task (model opus), one reviewer pass per task, in the order below. Every task leaves `pnpm check` green.

**Goal:** Ship slice D2 of Plan D (spec §4) as one PR, or two if review prefers §4.1 + §4.2 apart from §4.3 + §4.4 + §4.5 (spec §4 preamble):

- §4.1: the phone's score preview is removed, from the WebView to the snapshot field.
- §4.2: "What viewers see" becomes the first rung of the degradation ladder.
- §4.3: "What viewers see" is a tap with a bounded view.
- §4.4: the match info is redrawn to C2.
- §4.5: the screen dims after 30 s idle while paired and waiting.

**Architecture:**

- **§4.1 removal.** The removal goes all the way through, because nothing else reads the overlay:
  - the WebView surface and its guard;
  - the stage hooks;
  - the Settings switch and the stored field (wire v2 → v3);
  - two captions;
  - the snapshot's two `overlayUrl` fields (Kotlin `Projection`/`SnapshotWire`, TS `snapshotWire`);
  - the readers that parsed it (Kotlin `Bodies`, TS `parseWaitingFields`);
  - native's `overlay-refused` record line.

  The server still sends `overlayUrl`. Both readers now ignore it the way they ignore any field they do not use, and the shared vectors prove it.

- **§4.2 ladder.** The ladder word is renamed `viewer-feed` end to end. The rung itself is TS-only: `selectShedding` (`shed !== null`, unchanged) closes and disables What viewers see.
- **§4.3 the view.** Its rule is a pure reducer, `src/domain/session/viewerCheck.ts` (event in, state out, no timers). `src/hooks/useViewerCheck.ts` owns the timers and replaces `usePeek.ts`.
  - It is drawn by a new `ViewerCover` over the camera box only.
  - `ViewerPeek` becomes a plain tap.
  - `useViewerFeed` keeps its delivery rule and loses the 60 s patience. Its retries shrink to one quiet retry at 2 s.
- **§4.4 C2.** C2 changes the label model to one string per side, at one type size, at most 2 lines each.
  - Each side gets a 3 dp bar.
  - A decorative "v" sits in a 14 dp margin.
  - The worst-case reserve goes from 142 to 154. The mechanism of measuring the label stays.
- **§4.5 idle dim.** It is a new `ScreenPort` over `expo-brightness`'s window brightness.
  - A pure rule `idleDim.ts` decides when to dim.
  - `useIdleDim.ts` owns the timer.
  - A `TouchWake` wrapper on the stream layout's root resets it on any touch.

**Tech Stack:**

- Expo SDK 57, React Native 0.86.3, TypeScript `strict`.
- vitest 5 projects `domain` (node), `ui` (jsdom + react-native-web) and `types`.
- `@testing-library/react`.
- Kotlin core: JDK 17, `allWarningsAsErrors`, run by `./gradlew test`.
- New dependency: `expo-brightness` (`~57.0.1`, Expo's pin in `node_modules/expo/bundledNativeModules.json:30`).
- Removed dependency: `react-native-webview`.

**Spec:** `docs/specs/2026-10-09-s1-plan-d-design.md`: §0, §1 (R1–R4, R8–R11), §4 (all of slice D2), §6 (the D2 column and the mutations), §7 and §8. This plan implements §4 exactly. Where it adds something §4 does not name, the addition is under _Plan decisions_.

**Sources, in authority order:** the spec, then AGENTS.md, then this plan's _Plan decisions_. A subagent's report carries no owner authority (AGENTS §13).

## Plan decisions

These are the controller's, not the owner's. Each can be overruled in review.

- **PD1: `ViewerPeek` keeps its own `Pressable`; it is not drawn through `Button`.** Spec §4.3 says "a plain tap through `Button`". `Button` is the lime plate with `minWidth: 200` (`src/ui/components/Button.tsx`), and the peek cell is 110 dp (`scoringFit.test.ts`: `peekCell = 110`), so it cannot be drawn there. The tap is plain: `onPress`, no `useHeldPress`, no delay. The selected outline copies `IconButton`'s `aria-selected` pattern.
- **PD2: the readers stop parsing `overlayUrl`; they do not just stop projecting it.** Spec §4.1 asks for removal "if nothing else reads it". Once the snapshot field goes, the parsed `WaitingFields.overlayUrl` and `BroadcastDescriptor.overlayUrl` have no reader left, so they go too, and so do `Bodies.foreignOverlay`, `BridgeCore.refusedOverlay` and the `overlay-refused` record kind. The `env` parameters on `Bodies.waiting` / `Bodies.code` / `Bodies.beat` / `HttpAnswers.heartbeat` stay:
  - removing them touches every call site and test for no change in behaviour;
  - `Bodies.scoringLink` still reads `env`;
  - K2 does not warn on an unused parameter (verified in a scratch build of the core, 2026-10-09).
- **PD3: `expo-brightness` is installed, but its manifest permission is blocked.** Prebuild's legacy auto-plugins apply `expo-brightness`'s plugin to any autolinked copy (`@expo/prebuild-config` `withDefaultPlugins.js:185`). That plugin adds `android.permission.WRITE_SETTINGS` (`plugin/build/withBrightness.js`). We only set the window brightness, which needs no permission (spec §4.5: "never the system setting"), so `app.json` gets `android.blockedPermissions: ["android.permission.WRITE_SETTINGS"]`.
- **PD4: AGENTS §7 is rewritten.** Its subject, the phone's overlay preview, is gone. The prohibition on a second scorebug render path is kept. Spec §4 rewrites §6, §8 and §9 and does not mention §7, but leaving a section that describes a removed WebView would make the rules file lie.
- **PD5: the C2 measurement records the capacity, not the staging names.** Spec §4.4 asks the plan to record which of the §5.2 staging fixtures' doubles names wrap. §5.2 names orgs and divisions, not players, so the names are unknown here. Task 12 measures:
  - characters per row at 494 dp and at 640 × 360;
  - which of the shared label fixtures wrap.

  Wrapping on the real staging names is D3 row 10/12's to read.

- **PD6: one log line per view state, and the time to the first frame.** These are `viewer.check {state}` and `viewer.firstFrame {ms}`. They are the evidence for spec §8's first risk (HLS start inside 5 s), which D3 reads back from the record.

## Global Constraints

Every task's requirements include this section.

- **Repo and branch.** Run each command in its own shell call, prefixed with `cd /Users/ashokhein/github/seazn.club.capture &&` (or the worktree's absolute path, if a worktree is in use). The cwd resets between calls (AGENTS §13).
- **How "Run:" executes.** "Run: `<cmd>`" means `mkdir -p /tmp/seazn-d2 && cd <repo> && <cmd> > /tmp/seazn-d2/out.txt 2>&1; echo "EXIT=$?"`, then read `/tmp/seazn-d2/out.txt`. Exit codes come from a redirect, never a pipe.
- **Exact counts.** When a test count matters, use `pnpm vitest run --reporter=json --outputFile=/tmp/seazn-d2/r.json <files>` and read `numTotalTests` and `numFailedTests`. `rtk` summaries can print `PASS(0) FAIL(0)` for a suite that failed to collect.
- **Kotlin.** "Run gradle" means `cd <repo>/modules/capture-engine/android/core && ./gradlew test --no-daemon --console=plain > /tmp/seazn-d2/gradle.out 2>&1; echo "EXIT=$?"`. That is the CI command from `.github/workflows/kotlin-core.yml`. `JAVA_HOME` is already JDK 17; do not override it.
- **The gate.** `pnpm check` = typecheck + lint + `prettier --check src app modules test` + vitest. It must exit 0 at the end of every task. Run `pnpm prettier --check <file>` on every doc or config file touched outside those folders.
- **Git safety.** Never `git stash`. Restore a mutation from a `cp` backup, never `git checkout <file>`.
- **Mutations.** Every mutation named in a task is made once, watched failing, and restored from a `cp` backup. The step records the failing test's name.
- **Expected values.** No expected value comes from the code under test. Copy comes from the dictionaries, numbers from the spec's table or arithmetic written out in the test (AGENTS §10).
- **Theme.** StyleSheet and tokens only. No colour literal, no inline style object. HUD components use `React.memo` and no anonymous functions in render (AGENTS §5, §8).
- **Copy.** New English copy gets es, fr and nl in the same change, and each of those three dictionaries gets `"_review": "pending translation review"` as its first key (docs/i18n-glossary.md, _Translation review_). Task 15 runs the review pass that clears the markers; CI's `pnpm i18n:release-check` refuses a marked dictionary. French puts U+00A0 (written ` ` in the JSON) before `:`.
- **Native builds.** No EAS, ever (AGENTS §11). Tasks 3 and 13 change native dependencies, so they need a fresh `pnpm expo prebuild -p android --no-install` and a local build. Prebuild rewrites `package.json` scripts: revert that hunk after every prebuild, and never commit it.
- **Out of scope** (spec §7): orientation A, N23 copy, Diagnostics additions, a real preview-framerate shed, server push, iOS lifecycle work, the prd playback host.
- **Do not touch:**
  - the D1 lane's files: `contracts/`, `test/fixtures/contracts/`, `scripts/` contract tooling;
  - `docs/specs/`;
  - `PairingKeeper.kt` and the foreground service.
- **Commits.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on the D2 branch the orchestrator names, never on `main`.

## Review Focus

Five places a green suite could still be wrong. Each has a test in its owning task:

1. **A tap never extends the view.** A tap while open closes it. Task 7's reducer row and Task 9's screen test both pin "second tap closes, view never restarts". Mutation: the reducer lets a tap extend `showing`.
2. **The dim never fires outside paired-and-waiting.** Task 14's rule table, and its hook test going paired → armed while idle. Mutation: `shouldDim` returns true for `armed`.
3. **The shed rung closes and disables.** Task 9's test patches `shed` mid-view: the cover goes, and the peek reads "Phone hot" disabled. Mutation: drop `input.shed` from `useViewerCheck`'s `blocked`.
4. **C2's 2-line cap is what makes the worst case 88.** Task 11's `MatchLabel.test.tsx` asserts `numberOfLines` of 2 per side. Task 10's reserve tables pin 316.4 × 178 at 804 × 332. Mutation: lift the per-side cap (`labelSideLines: 4`); the worst-case row at the owner geometry must fail.
5. **A v2 settings record survives the upgrade.** Task 2 reads `{"v":2,"overlay":false,"side":"left","automatic":false}` back as `{side: 'left', automatic: false}`, and the next save writes v3.

---

## Task 1: The stage draws no score preview

**Files:**

- Delete:
  - `src/ui/components/OverlayPreview.tsx`
  - `src/ui/components/OverlayPreview.test.tsx`
  - `src/hooks/useStageOverlay.ts`
  - `src/hooks/useOverlayAttempt.ts`
  - `src/services/overlayGuard.ts`
  - `src/services/overlayGuard.test.ts`
  - `src/domain/credentials/overlayNavigation.ts`
  - `src/domain/credentials/overlayNavigation.test.ts`
- Modify:
  - `src/services/surfaces.ts`
  - `src/services/native/nativeSurfaces.tsx`
  - `src/services/native/nativeSurfaces.test.tsx`
  - `test/fakeSurfaces.ts`
  - `test/fakeSurfaces.test.ts`
  - `src/domain/session/previewUrls.ts`
  - `src/domain/session/previewUrls.test.ts`
  - `src/hooks/engineSelectors.ts`
  - `src/hooks/engineSelectors.test.ts`
  - `src/hooks/advisory.ts`
  - `src/hooks/advisory.test.ts`
  - `src/hooks/statusKey.ts` (LineTier docstring only)
  - `src/ui/components/StreamStage.tsx`
  - `src/ui/screens/StreamScreen.tsx`
  - `src/ui/components/ErrorBoundary.tsx` (comment only)
  - `src/ui/components/RootBoundary.tsx` (comment only)
  - `src/i18n/{en,es,fr,nl}.json`
  - `src/ui/theme/stripTextFit.test.ts`
  - `src/ui/components/Hud.test.tsx`
  - `src/ui/components/PreviewBoundary.test.tsx`
  - `src/ui/components/RootBoundary.test.tsx`
  - `src/ui/screens/StreamScreen.{layout,paired,onAir,memo,locales}.test.tsx`
- Create: `src/ui/screens/StreamScreen.noPreview.test.tsx`

**Interfaces:**

- Consumes: `selectShedding`, `selectCharging`, `selectKeepOpen` (`src/hooks/advisory.ts`).
- Produces:
  - `Surfaces = { Preview, Video }`.
  - `topAdvisory({ shed, charging, keepOpen }): 'keepOpen' | 'shed' | 'notCharging' | null`.
  - `StageProps` without `overlayOn` and `paired`.

- [ ] **Step 1: Write the failing test** `src/ui/screens/StreamScreen.noPreview.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { createNativeSurfaces } from '@/services/native/nativeSurfaces';
import { createFakeSurfaces } from '../../../test/fakeSurfaces';
import { renderViewfinder } from '../../../test/renderViewfinder';

/**
 * D2 §4.1 (R1, owner 2026-10-08, "Ok remove"): the phone draws no score. The surfaces port has no overlay, native or
 * fake, and the stage says nothing of one, paired or on air, in each of the four languages.
 */
describe('the stage draws no score preview (D2 §4.1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('has no overlay surface: the port is the preview and the viewers’ video, native and fake alike', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(Object.keys(createNativeSurfaces({ logger })).sort()).toEqual(['Preview', 'Video']);
    const fake = createFakeSurfaces();
    expect('Overlay' in fake).toBe(false);
  });

  it.each(['en', 'es', 'fr', 'nl'] as const)(
    '%s: no overlay element and no score caption, paired or on air',
    async (lang) => {
      const view = await renderViewfinder({ deviceLanguages: [lang] });
      expect(screen.queryByTestId('overlay')).toBeNull();
      act(() => view.engine.scene('live'));
      expect(screen.queryByTestId('overlay')).toBeNull();
      // The two captions went with the preview: their English keys are gone from every dictionary.
      expect('stream.advisory.scoreAhead' in en).toBe(false);
      expect('stream.advisory.overlayFailed' in en).toBe(false);
    },
  );
});
```

The logger literal must satisfy `Logger` from `src/services/logger.ts`. If `Logger` has members beyond the four levels, build it with `createLogger({ record: createRingRecord(), now: () => 0 })` instead.

- [ ] **Step 2: Run it to see it fail.** Run: `pnpm vitest run src/ui/screens/StreamScreen.noPreview.test.tsx`. Expected: FAIL. `Object.keys(...)` includes `Overlay`, and the two keys are still in `en.json`.

- [ ] **Step 3: Delete the overlay's own files.**

```bash
git rm src/ui/components/OverlayPreview.tsx src/ui/components/OverlayPreview.test.tsx \
  src/hooks/useStageOverlay.ts src/hooks/useOverlayAttempt.ts \
  src/services/overlayGuard.ts src/services/overlayGuard.test.ts \
  src/domain/credentials/overlayNavigation.ts src/domain/credentials/overlayNavigation.test.ts
```

- [ ] **Step 4: Shrink the surfaces port.** In `src/services/surfaces.ts`:
  - delete `export type OverlayProps = ...`;
  - delete the `readonly Overlay: FunctionComponent<OverlayProps>;` member;
  - change the doc line "Screens never import react-native-webview or expo-video" to "Screens never import expo-video".

  The interface becomes:

```ts
export interface Surfaces {
  readonly Preview: FunctionComponent<PreviewProps>;
  readonly Video: FunctionComponent<VideoProps>;
}
```

- [ ] **Step 5: Remove the WebView from `src/services/native/nativeSurfaces.tsx`.** Delete:
  - the `import type { WebViewProps } from 'react-native-webview';` line;
  - the `overlayGuard` import block;
  - `OverlayProps` from the surfaces import;
  - `type WebViewPackage`;
  - the `webview` member of `SurfacePackages` and of `INSTALLED`;
  - `LOCKDOWN`;
  - `ConfinedProps`;
  - `ConfinedWebView`;
  - `OverlayStageProps`;
  - `OverlayStage`;
  - `NativeOverlay`;
  - the `clear` style.

  Then make three edits:
  - In the `SurfacePackages` doc, replace "Where the two native packages come from. Both are loaded…" with "Where the native packages come from. Each is loaded on first draw, not at launch (m3): expo-video's native half throws on import when the binary lacks it, and a static import here would take the whole app down at boot instead of one surface."
  - The kind union and the lazy packages become:

```ts
const unavailable = (kind: 'video' | 'preview') => () =>
  logger.warn('surface.unavailable', { kind });
const video = lazyPackage(packages.video, unavailable('video'));
const preview = lazyPackage(packages.preview, unavailable('preview'));
```

- The return becomes `return { Preview: NativePreview, Video: NativeVideo };`.
- Remove `useMemo` from the react import only if nothing else uses it. `MutedVideo` does, so it stays.
- The `createNativeSurfaces` doc becomes "The surfaces port on a phone. `surface.unavailable` is logged once per missing package."

- [ ] **Step 6: Update `src/services/native/nativeSurfaces.test.tsx`.**
  - Delete the whole `describe('the native overlay, confined to its own origin (I1)')` block.
  - In `describe('a native package missing from the binary (m3)')`:
    - delete the tests named `loads each package once, however many overlays are drawn`, `reports the overlay failed, once per overlay, and says why once` and `reports nothing for an overlay taken down before its package turned out missing`;
    - in `loads nothing until a surface is drawn` and `degrades the same way through the real loaders, with both packages absent`, delete every `webview` loader and `Overlay` render;
    - keep their video and preview assertions;
    - rename the second test to `degrades the same way through the real loaders, with the video package absent`.
  - Add to the same describe:

```tsx
it('loads the video package once, however many videos are drawn', async () => {
  const video = vi.fn(async () => {
    throw new Error('ExpoVideo is not in this binary');
  });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const surfaces = createNativeSurfaces({
    logger,
    packages: { video, preview: async () => null },
  });
  const { Video } = surfaces;
  render(
    <>
      <Video url="https://video.example/a.m3u8" playing />
      <Video url="https://video.example/b.m3u8" playing />
    </>,
  );
  await act(async () => {});
  expect(video).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith('surface.unavailable', { kind: 'video' });
});
```

Use the file's existing imports (`render`, `act`, `vi`). If it builds loggers through a local helper, use that helper instead of the literal.

- [ ] **Step 7: Shrink the fake surfaces.** In `test/fakeSurfaces.ts`:
  - delete `failOverlay` and `crashOverlay` from `FakeSurfaces`;
  - delete the `reportFailure` and `crashing` variables;
  - delete the `Overlay` function, the `Overlay` member and the `failOverlay` / `crashOverlay` members of the returned object;
  - drop `OverlayProps` from the import;
  - change the comment on `Video`'s status effect to "Held only while this Video is on screen: a torn-down player reports nothing."

  In `test/fakeSurfaces.test.ts`, delete every test that renders `Overlay` or calls `failOverlay` / `crashOverlay`.

- [ ] **Step 8: Drop `overlayPreviewUrl`.** In `src/domain/session/previewUrls.ts`, delete `overlayPreviewUrl` and its doc. Keep `withQueryParam`, `PEEK_BANDWIDTH_MBPS` and `peekPlaybackUrl`; if `withQueryParam` is not exported and only `overlayPreviewUrl` used it, keep it for `peekPlaybackUrl`. In `previewUrls.test.ts`, delete the `overlayPreviewUrl` describe.

- [ ] **Step 9: Drop the overlay selectors.** In `src/hooks/engineSelectors.ts`, delete:
  - `selectOverlayUrl` and its doc (lines 68–70);
  - `selectOverlayKnown` and its doc (lines 71–78);
  - `selectHasPairing` and its doc (line 117 on). Its only reader was `useStageOverlay`. Confirm with `git grep -n selectHasPairing -- src test app` before deleting: only `engineSelectors.ts` and `engineSelectors.test.ts` may remain.

  In `engineSelectors.test.ts`, delete the rows and describes for the three selectors.

- [ ] **Step 10: The captions without the preview.** Replace the top of `src/hooks/advisory.ts`, down to and including `topAdvisory`, with:

```ts
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { MessageKey } from '@/i18n/messages';

export type Advisory = 'keepOpen' | 'shed' | 'notCharging';

export const ADVISORY_KEY: Readonly<Record<Advisory, MessageKey>> = {
  keepOpen: 'stream.advisory.keepOpen',
  shed: 'stream.advisory.shed',
  notCharging: 'stream.advisory.notCharging',
};

/**
 * The status strip's one caption (D17). Device conditions go here, never in the status line (AGENTS §8). Keep the app
 * open outranks them all (CD18): leaving the app is what would end the capture. Heat is next, then not charging. The
 * score-ahead and preview-failed captions went with the score preview (D2 §4.1).
 */
export function topAdvisory(input: {
  shed: boolean;
  charging: boolean | null;
  /** CD18: a held pairing on a phone that would not survive the background (`selectKeepOpen`). */
  keepOpen: boolean;
}): Advisory | null {
  if (input.keepOpen) return 'keepOpen';
  if (input.shed) return 'shed';
  if (input.charging === false) return 'notCharging';
  return null;
}
```

In `src/hooks/advisory.test.ts`:

- replace the `topAdvisory` describe with the block below;
- delete every assertion on `overlayFailed` or `scoreAhead`;
- keep the `selectShedding` table and the English `shed` copy assertion (Task 5 changes that copy).

```ts
describe('topAdvisory (D17, CD18, D2 §4.1)', () => {
  const calm = { shed: false, charging: true, keepOpen: false } as const;
  it.each([
    ['nothing up', calm, null],
    ['charging unknown', { ...calm, charging: null }, null],
    ['not charging', { ...calm, charging: false }, 'notCharging'],
    ['shed', { ...calm, shed: true }, 'shed'],
    ['shed over not charging', { ...calm, shed: true, charging: false }, 'shed'],
    ['keep open over all', { shed: true, charging: false, keepOpen: true }, 'keepOpen'],
  ] as const)('%s', (_name, input, expected) => {
    expect(topAdvisory(input)).toBe(expected);
  });

  it('has three captions, each with its key', () => {
    expect(Object.keys(ADVISORY_KEY).sort()).toEqual(['keepOpen', 'notCharging', 'shed']);
  });
});
```

- [ ] **Step 11: The stage without the overlay.** In `src/ui/components/StreamStage.tsx`:
  - imports:
    - delete `useStageOverlay` and `OverlayPreview`;
    - import `selectShedding` from `@/hooks/advisory` next to `selectCharging` and `selectKeepOpen`;
  - `StageProps`: delete `paired` and `overlayOn` with their docs;
  - in `StreamStage`, replace the lines from `const overlay = useStageOverlay(...)` to the end of the `topAdvisory({...})` call with:

```tsx
const shed = useEngineSelector(selectShedding);
const charging = useEngineSelector(selectCharging);
const keepOpen = useEngineSelector(selectKeepOpen);
const advisory = topAdvisory({ shed, charging, keepOpen });
```

- render `<CameraBox size={box} peek={props.peek} />`;
- `CameraBoxProps` keeps `size` and `peek` only;
- delete the `<OverlayPreview … />` line;
- in the `{/* CD19 … */}` comment, drop "the overlay keeps its own boundary (AGENTS §7)";
- in the `StreamStage` and `CameraBox` docs, replace "the overlay preview and the peek" with "the viewers' video".

In `src/ui/screens/StreamScreen.tsx`, delete the `paired={…}` and `overlayOn={settings.overlay}` props.

- [ ] **Step 12: The two captions leave the dictionaries.** Delete the `stream.advisory.overlayFailed` and `stream.advisory.scoreAhead` lines from `src/i18n/en.json`, `es.json`, `fr.json` and `nl.json`. In `src/hooks/statusKey.ts`, in the `LineTier` doc, change "an advisory caption (Not charging, heat, keep the app open, Score ahead, a failed preview)" to "an advisory caption (Not charging, heat, keep the app open)".

- [ ] **Step 13: The fit ratchet loses two captions.** In `src/ui/theme/stripTextFit.test.ts`:
  - delete `'stream.advisory.overlayFailed',` from `OVER_NARROW.en`;
  - change the count test's title to `'measures 42 status strings and 3 captions in each of the four languages, and every glyph is in the font'`;
  - its caption `.toHaveLength(5)` becomes `.toHaveLength(3)`;
  - `expect(REALISTIC).toHaveLength(4 * 47)` becomes `4 * 45`;
  - `expect(ROWS).toHaveLength(4 * 47 + 4 * 2)` becomes `4 * 45 + 4 * 2`;
  - in the 298 dp test, the comment becomes `// 56 strings: 9 en, 16 es, 16 fr, 15 nl.`, `.toHaveLength(57)` becomes `.toHaveLength(56)`, and the per-language lengths become `[9, 16, 16, 15]`;
  - the widest caption stays `'nl stream.advisory.keepOpen'`.

- [ ] **Step 14: Sweep the remaining tests.** Run `git grep -n -E "overlayFailed|scoreAhead|failOverlay|crashOverlay|OverlayPreview|useStageOverlay|overlay\.none|overlay\.failed|overlay\.crashed|overlay\.blocked" -- src test app`. For each hit:
  - delete the test that is about the overlay or a removed caption, for example `Hud.test.tsx`'s rows over the five advisories (now three) and `StreamScreen.paired.test.tsx`'s "Score ahead" tests;
  - in a list of advisories, delete the two entries, for example `ADVISORIES` in `StreamScreen.layout.test.tsx`;
  - keep tests whose subject is something else, and delete only their overlay lines;
  - `PreviewBoundary.test.tsx:63` (`streamSettings.set({overlay:false})`) stays until Task 2.

  Also update the overlay sentence in the comments of `ErrorBoundary.tsx` and `RootBoundary.tsx`:
  - in `ErrorBoundary.tsx`, "Around the overlay WebView (§7) it keeps an overlay crash from taking the…" becomes "Around a surface it keeps that surface's crash from taking the…";
  - drop "— around the overlay, nothing at all (AGENTS §7)";
  - in `RootBoundary.tsx`, drop the overlay clause.

  Re-run the grep: the only hits allowed are this plan, `docs/`, and `_FINDINGS.md`.

- [ ] **Step 15: Run the task's tests.** Run: `pnpm vitest run src/ui/screens/StreamScreen.noPreview.test.tsx src/hooks/advisory.test.ts src/ui/theme/stripTextFit.test.ts src/services/native/nativeSurfaces.test.tsx test/fakeSurfaces.test.ts`. Expected: PASS.

- [ ] **Step 16: Mutation.** Copy `src/hooks/advisory.ts` to `/tmp/seazn-d2/advisory.ts.bak`. Swap the `shed` and `notCharging` lines in `topAdvisory`. Run `pnpm vitest run src/hooks/advisory.test.ts`. Expected: FAIL on `shed over not charging`. Restore with `cp`.

- [ ] **Step 17: The gate.** Run: `pnpm check`. Expected: EXIT=0. `SettingsScreen` still reads `settings.overlay`; that field goes in Task 2.

- [ ] **Step 18: Commit.**

```bash
git add -A src test app
git commit -m "refactor(stream): the stage draws no score preview (D2 §4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Stream settings v3, and Settings without the switch

**Files:**

- Modify:
  - `src/services/streamSettingsStore.ts`
  - `src/services/streamSettingsStore.test.ts`
  - `src/ui/screens/SettingsScreen.tsx`
  - `src/ui/screens/SettingsScreen.test.tsx`
  - `src/ui/screens/SettingsScreen.memo.test.tsx`
  - `src/ui/theme/settingsFit.test.ts`
  - `src/hooks/useStreamSettings.test.tsx`
  - `src/hooks/usePorts.tsx` (doc line)
  - `test/renderViewfinder.tsx`
  - `src/ui/components/PreviewBoundary.test.tsx`
  - every caller of `renderViewfinder(…, { overlay: false })`
  - `src/i18n/{en,es,fr,nl}.json`
- Delete: `test/overlayOff.ts`

**Interfaces:**

- Produces: `StreamSettings = { side: ControlSide; automatic: boolean }`. The stored record is `{"v":3,"side":…,"automatic":…}`. The reader accepts v3, v2 and v1.

- [ ] **Step 1: Write the failing tests.** Append to `src/services/streamSettingsStore.test.ts`, using the file's existing imports and helpers. `createMemoryKeyValueStore` is from `@/services/KeyValueStore`; `createLogger` and `createRingRecord` are used as in `test/fakePorts.ts`.

```ts
describe('wire v3: the score preview is gone from the record (D2 §4.1)', () => {
  const storeOver = (seed: Record<string, string>) => {
    const kv = createMemoryKeyValueStore(seed);
    const record = createRingRecord();
    const store = createStreamSettingsStore(kv, createLogger({ record, now: () => 0 }));
    return { kv, record, store };
  };

  it('reads a v2 record from before the upgrade, keeping its side and automatic and dropping its overlay', async () => {
    const { store, record } = storeOver({
      [SETTINGS_KEY]: '{"v":2,"overlay":false,"side":"left","automatic":false}',
    });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
    expect(record.lines()).toEqual([]);
  });

  it('reads a v1 record: its side kept, automatic on by default, its overlay dropped', async () => {
    const { store } = storeOver({ [SETTINGS_KEY]: '{"v":1,"overlay":true,"side":"left"}' });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'left', automatic: true });
  });

  it('writes v3 on the next save, with no overlay in it', async () => {
    const { store, kv } = storeOver({
      [SETTINGS_KEY]: '{"v":2,"overlay":true,"side":"right","automatic":true}',
    });
    await store.load();
    await store.set({ side: 'left' });
    expect(JSON.parse((await kv.get(SETTINGS_KEY)) ?? 'null')).toEqual({
      v: 3,
      side: 'left',
      automatic: true,
    });
  });

  it('reads its own v3 back, and a v3 that names an overlay is still read (an extra field is not a reason to refuse)', async () => {
    for (const text of [
      '{"v":3,"side":"left","automatic":false}',
      '{"v":3,"overlay":true,"side":"left","automatic":false}',
    ]) {
      const { store } = storeOver({ [SETTINGS_KEY]: text });
      await store.load();
      expect(store.getSnapshot()).toEqual({ side: 'left', automatic: false });
    }
  });

  it.each([
    ['a v2 with no side', '{"v":2,"overlay":true,"automatic":true}'],
    ['a v3 with no automatic', '{"v":3,"side":"left"}'],
    ['a v4', '{"v":4,"side":"left","automatic":true}'],
    ['not JSON', 'side=left'],
  ])('falls back to the defaults for %s, and says so', async (_name, text) => {
    const { store, record } = storeOver({ [SETTINGS_KEY]: text });
    await store.load();
    expect(store.getSnapshot()).toEqual({ side: 'right', automatic: true });
    expect(record.lines().join('\n')).toContain('settings.unreadable');
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Run: `pnpm vitest run src/services/streamSettingsStore.test.ts`. Expected: FAIL. The snapshots carry `overlay`, and the save writes `v: 2`.

- [ ] **Step 3: Implement v3.** In `src/services/streamSettingsStore.ts`, `StreamSettings`, `DEFAULT_STREAM_SETTINGS`, `encode` and `decode` become:

```ts
export type StreamSettings = {
  readonly side: ControlSide;
  readonly automatic: boolean;
};

export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
  side: 'right',
  automatic: true,
};
```

```ts
function encode({ side, automatic }: StreamSettings): string {
  return JSON.stringify({ v: 3, side, automatic });
}
```

```ts
/**
 * v3 whole. A v2 record has the score preview's `overlay` too, which is dropped (D2 §4.1), and a v1 record has no
 * `automatic` (on, its default), so an operator's side and automatic survive the upgrade. Anything else is
 * unreadable. A v1 or v2 record is read whatever its `overlay` says, but it must still have one, so a record that
 * never was v1 or v2 is not taken for one.
 */
function decode(text: string): StreamSettings | null {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const { v, overlay, side, automatic } = data as Record<string, unknown>;
    if (side !== 'left' && side !== 'right') return null;
    if (v === 3) return typeof automatic === 'boolean' ? { side, automatic } : null;
    if (typeof overlay !== 'boolean') return null;
    if (v === 1) return { side, automatic: DEFAULT_STREAM_SETTINGS.automatic };
    if (v === 2 && typeof automatic === 'boolean') return { side, automatic };
    return null;
  } catch {
    return null;
  }
}
```

In the type's doc, keep the `automatic` sentence and drop nothing else. Then delete or rewrite every older test in `streamSettingsStore.test.ts` that expects `overlay` in a snapshot or `v: 2` in a write. Their subjects (load once, serial saves, refused write, refused read) stay, with expectations shaped `{ side, automatic }` and `v: 3`.

- [ ] **Step 4: Settings without the switch.** In `src/ui/screens/SettingsScreen.tsx`:
  - delete `toggleOverlay`;
  - delete the `ChoiceRow` for `settings.overlay.label` and the `Text` for `settings.overlay.hint`;
  - in the doc comment, drop "score preview" wherever it names the switch.

  Delete `settings.overlay.label` and `settings.overlay.hint` from the four dictionaries. In `src/ui/theme/settingsFit.test.ts:714`, the list `['settings.overlay.label', 'settings.automatic.label']` becomes `['settings.automatic.label']`. Fix any count in that test that follows from the list's length. In `src/hooks/usePorts.tsx`, the `streamSettings` doc becomes `/** Controls left or right, and automatic start (spec §4 Settings, D23, A4). */`.

- [ ] **Step 5: The Settings test asserts the switch is gone, in four languages.** Add to `src/ui/screens/SettingsScreen.test.tsx`, using its `renderSettings` helper and imports:

```tsx
describe('Settings has no score preview control (D2 §4.1)', () => {
  it.each(LANGS)(
    '%s: the automatic switch is the only switch, and no copy names a score preview',
    (lang) => {
      renderSettings({ deviceLanguages: [lang] });
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(screen.queryByText('Score preview')).toBeNull();
      expect(screen.queryByText('Vista previa del marcador')).toBeNull();
      expect(screen.queryByText('Aperçu du score')).toBeNull();
      expect(screen.queryByText('Scorevoorbeeld')).toBeNull();
    },
  );
});
```

`ChoiceRow`'s role: before writing this, read `src/ui/components/ChoiceRow.tsx`. If its role is `switch`, use `getAllByRole('switch')`. The literal strings are the four removed `settings.overlay.label` values, copied here because the dictionaries no longer hold them. Delete every older Settings test that toggles the overlay: in `SettingsScreen.test.tsx` and `SettingsScreen.memo.test.tsx`, run `git grep -n overlay` on both files.

- [ ] **Step 6: The test helper loses its overlay option.** In `test/renderViewfinder.tsx`:
  - delete the `OVERLAY_OFF_SEED` import;
  - delete the `overlay` member of `Setup` with its doc;
  - delete the `overlay` destructure;
  - delete the `...(overlay === false ? OVERLAY_OFF_SEED : {}),` line.

  Then `git rm test/overlayOff.ts`. Run `git grep -n "overlay: false\|overlay:false\|OVERLAY_OFF" -- src test` and remove the option from each caller: `{ overlay: false }` becomes `{}`, and an options object left empty is dropped. In `src/ui/components/PreviewBoundary.test.tsx:63`, delete the `streamSettings.set({ overlay: false })` call. If the test needed it to keep the status line out of a caption, use `quiet: true` on its `renderViewfinder`. In `src/hooks/useStreamSettings.test.tsx`, rewrite every `overlay` expectation to the `{ side, automatic }` shape.

- [ ] **Step 7: Run the task's tests.** Run: `pnpm vitest run src/services/streamSettingsStore.test.ts src/ui/screens/SettingsScreen.test.tsx src/ui/screens/SettingsScreen.memo.test.tsx src/hooks/useStreamSettings.test.tsx src/ui/theme/settingsFit.test.ts`. Expected: PASS.

- [ ] **Step 8: Mutation.** Back up `streamSettingsStore.ts` with `cp`. Change `if (v === 2 && typeof automatic === 'boolean') return { side, automatic };` to `return null` for v2. Run the store test. Expected: FAIL on `reads a v2 record from before the upgrade…`. Restore.

- [ ] **Step 9: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 10: Commit.**

```bash
git add -A src test
git commit -m "feat(settings): stream settings v3 without the score preview; a v2 record survives (D2 §4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Remove `react-native-webview`

**Files:**

- Modify:
  - `package.json`
  - `pnpm-lock.yaml` (by pnpm)
  - `src/ui/screens/SettingsScreen.tsx` (`LICENCES`)
  - `src/ui/screens/SettingsScreen.test.tsx:181`
  - `eslint.config.mjs` (comment only)
- Create: `test/dependencies.test.ts`

**Interfaces:**

- Produces: a dependency set without `react-native-webview`. Native change: this needs a prebuild and a native build (AGENTS §13, class 5).

- [ ] **Step 1: Prove nothing imports it.** Run: `git grep -n "react-native-webview" -- src app modules test`. Expected: only `src/ui/screens/SettingsScreen.tsx` (`LICENCES`) and `SettingsScreen.test.tsx:181`. Outside the code, `eslint.config.mjs:21` and the comment in `pnpm-workspace.yaml` also match. If anything imports it, stop and report: Task 1 left a user behind.

- [ ] **Step 2: Write the failing test** `test/dependencies.test.ts` (the `domain` project picks up `test/**/*.test.ts`):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** D2 §4.1: the score preview was the WebView's only user, so the native dependency went with it. */
describe('native dependencies', () => {
  it('carries no WebView', () => {
    expect(Object.keys(pkg.dependencies)).not.toContain('react-native-webview');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('react-native-webview');
  });
});
```

- [ ] **Step 3: Run it to see it fail.** Run: `pnpm vitest run test/dependencies.test.ts`. Expected: FAIL.

- [ ] **Step 4: Remove it.** Run: `pnpm remove react-native-webview`. Then:
  - delete `{ name: 'react-native-webview', licence: 'MIT' },` from `LICENCES` in `SettingsScreen.tsx`;
  - delete the `react-native-webview — MIT` assertion in `SettingsScreen.test.tsx:181`, and fix any licence count there to one fewer;
  - in `eslint.config.mjs`, keep `'react-native-webview'` in `UI_NATIVE_IMPORTS`, and replace its comment with `// No longer installed (D2 §4.1). The ban stays: the scorebug is never drawn on the phone (AGENTS §7).`

  Leave `pnpm-workspace.yaml`'s comment: it records what was verified on the day, not what is installed.

- [ ] **Step 5: Check what autolinks.** Run: `pnpm expo-modules-autolinking search --platform android > /tmp/seazn-d2/autolink.txt 2>&1; echo EXIT=$?`. If the CLI is not on the path, use `pnpm exec expo-modules-autolinking search --platform android`. Expected: `react-native-webview` absent. Record the output's module list in the task report.

- [ ] **Step 6: Run the tests.** Run: `pnpm vitest run test/dependencies.test.ts src/ui/screens/SettingsScreen.test.tsx`. Expected: PASS.

- [ ] **Step 7: Native build, local.** Run each in its own call:
  1. `pnpm expo prebuild -p android --no-install`
  2. `git diff --stat package.json`, then revert prebuild's `scripts` hunk by hand or with `git checkout -p package.json`, keeping the dependency removal.
  3. `cd android && ./gradlew assembleDebug`

  Expected: BUILD SUCCESSFUL. The APK is installed and checked on the device in D3. This task does not need the phone.

- [ ] **Step 8: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 9: Commit.**

```bash
git add package.json pnpm-lock.yaml src test eslint.config.mjs
git commit -m "build: remove react-native-webview, the score preview's only dependency (D2 §4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: The overlay URL leaves the wire readers (Kotlin and TS)

**Files:**

- Kotlin main, under `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/`:
  - `core/Answers.kt`
  - `core/Pairing.kt`
  - `core/Snapshot.kt`
  - `core/Projection.kt`
  - `core/Hosts.kt` (comment)
  - `core/Pairings.kt` (comment)
  - `adapter/SnapshotWire.kt`
  - `adapter/Bodies.kt`
  - `adapter/BridgeCore.kt`
  - `adapter/Http.kt` (comment)
- Kotlin tests, under `…/src/test/kotlin/com/seazn/capture/engine/`:
  - `core/Configs.kt`
  - `core/ProjectionPairedTest.kt`
  - `core/ScrubParityTest.kt`
  - `adapter/SnapshotWireTest.kt`
  - `adapter/BodiesTest.kt`
  - `adapter/HttpTest.kt`
  - `adapter/BridgeCoreTest.kt`
- Shared vectors:
  - `modules/capture-engine/src/wire/snapshot-vectors.json`
  - `modules/capture-engine/src/wire/waiting-vectors.json`
  - `modules/capture-engine/src/wire/session-vectors.json`
  - `modules/capture-engine/src/scrub/allow-list.json`
- TS:
  - `src/domain/session/Pairing.ts`
  - `modules/capture-engine/src/snapshotWire.ts`
  - `modules/capture-engine/src/snapshotWire.test.ts`
  - `modules/capture-engine/src/FakeCaptureEngine.ts`
  - `modules/capture-engine/src/absentCaptureEngine.ts`
  - `modules/capture-engine/src/waitingVectors.test.ts`
  - `src/domain/credentials/waitingFields.ts`
  - `src/domain/credentials/waitingFields.test.ts`
  - `src/services/fetchCodePort.ts`
  - `src/services/fetchCodePort.test.ts`
  - `src/services/fakeCodePort.ts`
  - `src/services/fakeCodePort.test.ts`
  - `src/services/scrubParity.test.ts`
  - `src/domain/mode/savedCode.test.ts`
  - `src/hooks/pairIntentWire.test.ts`
  - every other TS fixture the typecheck names

**Interfaces:**

- Produces:
  - Kotlin `WaitingFields(label, venueTimezone, scheduledStartEpochS, autoAllowed, destinationName, pollSeconds, stageLabel, stageFor)`;
  - `BroadcastDescriptor` and `BroadcastView` without `overlayUrl`;
  - TS `PairingInfo`, `BroadcastInfo` and `WaitingFields` (credentials) without `overlayUrl`;
  - `parseWaitingFields(input, host)`, unchanged in signature.
- The snapshot crosses no `overlayUrl`. The record has no `overlay-refused` kind (84 kinds).

- [ ] **Step 1: The shared vectors first (the failing tests).** Write `/tmp/seazn-d2/drop-overlay.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';

const root = '/Users/ashokhein/github/seazn.club.capture/modules/capture-engine/src/wire';
const read = (name) => JSON.parse(readFileSync(`${root}/${name}`, 'utf8'));
const write = (name, data) =>
  writeFileSync(`${root}/${name}`, `${JSON.stringify(data, null, 2)}\n`);
const without = (object) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'overlayUrl'));

// waiting-vectors: the server still sends overlayUrl (fields keep it); no reader returns it (expected loses it).
const waiting = read('waiting-vectors.json');
const GONE = new Set([
  "staging's overlay shape, a query string with a key (final review I-2, 2026-10-05): kept whole",
  'a foreign overlay is dropped, the rest kept (the Seazn-host rule)',
]);
waiting.cases = waiting.cases
  .filter((row) => !GONE.has(row.why))
  .map((row) => {
    if (row.why !== 'overlayUrl not a string') {
      return row.expected === null ? row : { ...row, expected: without(row.expected) };
    }
    const { overlayUrl: _ignored, state: _state, ...fields } = row.fields;
    return {
      ...row,
      why: 'an overlayUrl of any shape is not read: the phone ignores it (D2 §4.1)',
      expected: { ...fields, scheduledStart: null, stageLabel: null },
    };
  });
waiting.about = waiting.about.replace(
  " an overlayUrl off the build's Seazn host is dropped alone.",
  " overlayUrl is the descriptor's and neither reader returns it, whatever its value (D2 §4.1).",
);
write('waiting-vectors.json', waiting);

// session-vectors: the base keeps sending overlayUrl; the decisive answer no longer carries it.
const session = read('session-vectors.json');
session.cases = session.cases
  .filter((row) => row.why !== 'a production build keeps an overlay on the production Seazn host')
  .map((row) => ({ ...row, expected: without(row.expected) }));
write('session-vectors.json', session);
```

Then run: `node /tmp/seazn-d2/drop-overlay.mjs && pnpm prettier --write modules/capture-engine/src/wire/waiting-vectors.json modules/capture-engine/src/wire/session-vectors.json`.

Check the rewritten row by printing it:

```bash
node -e "const v=require('./modules/capture-engine/src/wire/waiting-vectors.json');console.log(JSON.stringify(v.cases.find(r=>r.why.startsWith('an overlayUrl of any shape')),null,1))"
```

Its `expected` must hold `code`, `label`, `venueTimezone`, `scheduledStart: null`, `autoAllowed`, `destinationName: null`, `pollSeconds: 10`, `heartbeatUrl`, `startUrl` and `stageLabel: null`, with the values from its `fields`, and no `overlayUrl`. If the row's `fields` carry keys outside that list (Kotlin reads only `label..pollSeconds`, TS also `code`, `heartbeatUrl` and `startUrl`), remove them from `expected` by hand. Compare with any readable row's `expected`.

Then edit `snapshot-vectors.json` by hand. Prettier's layout of that file is not `JSON.stringify`'s, so a rewrite would reformat it. The edits:

- line 122 (`pairingBase`): delete `"overlayUrl": "https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q",`;
- line 130 (`broadcastBase`): delete the same line;
- line 187: delete `"overlayUrl": null`, and remove the trailing comma from the line before it;
- lines 282–286: `"name": "armed-gate-open-no-overlay"` becomes `"name": "armed-gate-open"`, `"pairing": { "overlayUrl": null },` is deleted, and `"broadcast": { "cause": "operator", "overlayUrl": null },` becomes `"broadcast": { "cause": "operator" },`;
- `"about"`: if it mentions the overlay, delete that sentence.

Run `pnpm prettier --write modules/capture-engine/src/wire/snapshot-vectors.json`.

In `modules/capture-engine/src/scrub/allow-list.json`, delete the `"overlay-refused": …` line under `kinds`. Keep `"publicUrl": ["url", "playbackUrl", "overlayUrl"]`: the server's descriptor still carries the field, and a log of its body must still scrub it.

- [ ] **Step 2: Pin the new counts in the tests.** Each count comes from the vector file's rows, not from a reader:
  - `modules/capture-engine/src/waitingVectors.test.ts`: the title becomes `"sweeps 41 of the file's 43 rows, readable and unreadable both"`, and the three lengths become `43`, `41` and `18`. The rewritten row moved from unreadable to readable, so the null count drops by one. The two deleted rows were readable.
  - `src/services/scrubParity.test.ts:66-68`: `85` becomes `84` in the title and the assertion.
  - Kotlin `core/ScrubParityTest.kt:78`: `assertEquals(85, kinds.size)` becomes `assertEquals(84, kinds.size)`.
  - Kotlin `adapter/BodiesTest.kt`:
    - in `the waiting fields, every shared case`, the comment becomes `// The file's rows: 43, of which 3 are JS's alone (PV12: a truncated file cannot pass).`, then `assertEquals(43, cases.length())` and `assertEquals(40, read)`;
    - in `the session shape, every shared case`, use `assertEquals(44, cases.length())` and `mapOf("open" to 7, …)`, with the other five counts unchanged.

- [ ] **Step 3: Run both suites to see them fail.**
  - Run: `pnpm vitest run modules/capture-engine/src/waitingVectors.test.ts modules/capture-engine/src/snapshotWire.test.ts src/services/scrubParity.test.ts`. Expected: FAIL. TS still returns `overlayUrl`, and the snapshot reader still requires it.
  - Run gradle. Expected: FAIL in `BodiesTest`, `SnapshotWireTest` and `ScrubParityTest`.

- [ ] **Step 4: Kotlin main.**
  - `core/Answers.kt`: delete `val overlayUrl: String?,` from `BroadcastDescriptor`.
  - `core/Pairing.kt`: delete `val overlayUrl: String?,` from `WaitingFields`.
  - `core/Snapshot.kt`: delete `val overlayUrl: String?,` from `BroadcastView`.
  - `core/Projection.kt:49`: delete `overlayUrl = broadcast.overlayUrl,`.
  - `adapter/SnapshotWire.kt`: delete `"overlayUrl" to w.overlayUrl,` (55) and `"overlayUrl" to view.overlayUrl,` (67).
  - `adapter/Bodies.kt`:
    - `WAITING_KEYS` becomes `listOf("label", "autoAllowed", "pollSeconds", "venueTimezone", "scheduledStart", "destinationName")`.
    - In `read`, delete `val overlay = …` and `val seazn = …`. Make `optionals` `listOf("venueTimezone" to zone, "scheduledStart" to start, "destinationName" to destination)`. The return becomes:

```kotlin
    return WaitingRead(WaitingFields(label, zone.orNull() ?: "", start.orNull(), auto, destination.orNull(), poll, stage, stage?.let { label }), null)
```

    - In the KDoc of `waiting`, replace "; an overlay off the build's Seazn host is dropped alone." with ". `overlayUrl` is not read: the phone draws no score (D2 §4.1), and a field nothing reads is never a reason to refuse an answer."
    - Delete `foreignOverlay` with its KDoc.
    - In `broadcast(...)`, delete the `overlayUrl = …` line.

- `adapter/BridgeCore.kt`:
  - delete `overlayRefusedSaid` with its KDoc (60–61) and `overlayRefusedSaid = false` (310);
  - delete `refusedOverlay` with its KDoc (427–439);
  - the `FetchCode` branch becomes:

```kotlin
      is Command.FetchCode ->
        ask({ HttpRequests.code(command) }) { report(HttpAnswers.code(command.requestId, it, command.environment)) }
```

    - and `beat` becomes:

```kotlin
  /** The environment is read here, on the scheduler thread, for the answer that comes back on any thread. */
  private fun beat(command: Command.PostHeartbeat) {
    val env = engine.phase.pairing?.request?.environment ?: Environment.STAGING
    ask({ HttpRequests.heartbeat(command) }) { report(HttpAnswers.heartbeat(command.beatId, it, env)) }
  }
```

    - if `RecordEntry` or `guarded` lose their last use, delete the now-unused import or field; the compiler fails on an unused import only if a lint says so, so read the file.

- `adapter/Http.kt:102`: the KDoc becomes `/** [env] is the pairing's. No waiting field is read by it since the overlay went (D2 §4.1); kept so every reader takes the pairing's environment alike. */`.
- `core/Hosts.kt:44`: the KDoc becomes `/** \`heartbeatUrl\`, \`startUrl\` and \`codeUrl\`: https on the build's Seazn host. */`.
- `core/Pairings.kt:378`: delete ", its overlay was never known".

- [ ] **Step 5: Kotlin tests.**
  - `core/Configs.kt:51` and `:95`: delete the `overlayUrl = "https://stg.seazn.club/overlay/fixtures/fx-42",` lines.
  - `core/ProjectionPairedTest.kt:122`: delete the `overlayUrl = …,` line.
  - `adapter/SnapshotWireTest.kt`:
    - in the comment at 20–21, delete "The overlay sits on the staging Seazn host.";
    - delete `private val overlay = …`;
    - `waiting(...)` becomes `Configs.waiting(pollSeconds = pollSeconds, destinationName = destinationName)`;
    - delete `overlayUrl = overlay,` from `broadcast`;
    - the case becomes:

```kotlin
      // I1: the gate about to open (notReady null).
      "armed-gate-open" to {
        val snapshot =
          bare(SnapshotState.Armed(Cause.OPERATOR, notReady = null), 1_790_000_005_500)
            .copy(pairing = pairing, broadcast = broadcast.copy(cause = Cause.OPERATOR), ready = allReady, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.3, survivesBackground = true), clean)
      },
```

    - delete the `"pairing.waiting.overlayUrl"` and `"broadcast.overlayUrl"` entries from `crosses`.

- `adapter/BodiesTest.kt`:
  - in the waiting-vectors loop, delete `if (e.isNull("overlayUrl")) null else e.getString("overlayUrl"),`;
  - at 206, `WaitingFields(...)` loses its sixth argument: `WaitingFields("Example Town v Sample CC", "Europe/London", 1_790_003_600, true, "YouTube · Example Town CC", 10)`;
  - delete the tests `a foreign overlay on the session shape is dropped…` and `final I-2 an overlay off the build's Seazn host is foreign…` with their KDoc, and add:

```kotlin
  /** D2 §4.1: the session shape's `overlayUrl` is not read. Any value, or none, opens the same broadcast. */
  @Test
  fun `the session shape's overlayUrl is not read - any value opens the same broadcast`() {
    val same = decisive(Bodies.code(200, base, null, Environment.STAGING))
    for (value in listOf<Any>("https://evil.example/overlay", 42, JSONObject.NULL, false)) {
      assertEquals(same, decisive(Bodies.code(200, JSONObject(base).put("overlayUrl", value).toString(), null, Environment.STAGING)), "$value")
    }
    assertEquals(same, decisive(Bodies.code(200, JSONObject(base).apply { remove("overlayUrl") }.toString(), null, Environment.STAGING)), "absent")
  }
```

    - in `decisive`, delete `"overlayUrl" to answer.descriptor.overlayUrl,`;
    - in `I-2b staging's real waiting beat parses whole…`, rename it to `` `I-2b staging's real waiting beat parses whole - its label, start in seconds, destination and poll` ``, keep the seven-key set assertion (the captured body still has seven keys), and delete the `stg.getString("overlayUrl")` line;
    - in `I-2b one unreadable waiting field…`, delete `"overlayUrl" to 42,` and change `assertEquals(7, …)` to `assertEquals(6, …, "every waiting field")`. Replace the last three lines (from `// An overlay off the Seazn host…`) with:

```kotlin
    // D2 §4.1: an overlayUrl of any shape is not a waiting field, so it never makes the fields unreadable.
    for (value in listOf<Any?>(42, "https://evil.example/o", null)) {
      val read = assertNotNull(answeredBeat(200, stgWith("overlayUrl", value)).reply)
      assertEquals(null to stg.getString("label"), read.waitingUnreadable to read.waiting?.label, "$value")
    }
```

- `adapter/HttpTest.kt`:
  - delete the test `` `a beat is read against the pairing's environment - an overlay off its Seazn host is dropped` `` and `const val OVERLAY` (515);
  - in `carry 17 …`, replace the two comment lines before `val open` with `// The pairing's environment reaches Bodies; both environments open the same session shape.`;
  - delete the `assertTrue(… overlayUrl != null …)` line and `assertNull(opened.waiting?.overlayUrl)`.
- `adapter/BridgeCoreTest.kt`:
  - delete the four tests from the KDoc at 191 through the end of `final I-2 no overlay, or Seazn's own, writes no overlay-refused line` (about 275);
  - in the I-2b test's KDoc, "start, destination, overlay and poll are the server's, the overlay's query and key whole" becomes "start, destination and poll are the server's";
  - delete `assertEquals(stg.getString("overlayUrl"), known["overlayUrl"])`;
  - the last line becomes `assertEquals(emptyList(), kinds().filter { it == "waiting-unreadable" })`.
- `adapter/PairWire.kt:45`, `BodiesTest.kt:867` (`beat(...)`) and `host/ScriptedServer.kt:151` stay: they build the server's bodies, which still carry the field.

- [ ] **Step 6: Run gradle.** Expected: EXIT=0, BUILD SUCCESSFUL. Run `rtk proxy grep -rn -i overlay modules/capture-engine/android/core/src`. The only hits allowed are:
  - `SessionRecord.kt`'s `PUBLIC_URL_KEYS` and its comment;
  - `Vocabulary.kt`'s `ShedStep` and its score-updates comment (Task 5 renames `ShedStep`);
  - `DeviceReadings.kt` (Task 5);
  - the server-body builders named in Step 5;
  - the `ShedStep.OVERLAY_PREVIEW` test lines (Task 5).

- [ ] **Step 7: TS.**
  - `src/domain/session/Pairing.ts`: delete `readonly overlayUrl: string | null;` from `PairingInfo` (40) and from `BroadcastInfo` (51). Line 11's comment, "How the overlay learns a score", describes `scoreUpdates`, which still echoes the server's word; change it to `/** How the web overlay learns a score (S1 decision 8), echoed in the broadcast. */`.
  - `modules/capture-engine/src/snapshotWire.ts`:
    - in `toPairing`, the destructure becomes `const { destinationName, pollSeconds, stageLabel } = value;`, the check becomes `if (!textOrNull(destinationName)) return undefined;`, and `overlayUrl,` goes from the result;
    - in `toBroadcast`, the destructure loses `overlayUrl`, the check becomes `if (!isNumber(maxDurationMinutes) || !isFlag(srtOffered)) return undefined;`, and `overlayUrl,` goes from the result.
  - `FakeCaptureEngine.ts`: delete `overlayUrl: …` at 219 and `overlayUrl: pairing.overlayUrl,` at 228. `absentCaptureEngine.ts:17`: delete `overlayUrl: null,`.
  - `src/domain/credentials/waitingFields.ts`:
    - delete the type member;
    - in `parseWaitingFields`, delete the `const overlayUrl = …` line and the result's `overlayUrl:` line;
    - the BAD check becomes `if (scheduledStart === BAD || destinationName === BAD) return null;`;
    - in the doc, "A foreign overlay is dropped and the rest kept, as Bodies.waiting does in Kotlin;" becomes "`overlayUrl` is not read (D2 §4.1), as in Bodies.waiting;".
  - `src/services/fetchCodePort.ts`:
    - delete `type Read`; `type Verdict = Result<WaitingFields, Refusal>;`;
    - `readFields` ends `return ok(fields);` after the code-mismatch check;
    - `settle` becomes:

```ts
/** A refusal is said in the record, never silent (recurring failure class 3). */
function settle(verdict: Verdict, logger: Logger): Result<WaitingFields, CodeError> {
  if (verdict.ok) return ok(verdict.value);
  const { error, status, problem } = verdict.error;
  logger.warn('code.error', { kind: error.kind, status, ...(problem ? { problem } : {}) });
  return err(error);
}
```

- `src/services/fakeCodePort.ts:28`: delete the `overlayUrl` line.

- [ ] **Step 8: TS tests.**
  - `snapshotWire.test.ts`:
    - delete `overlayUrl` from the `PAIRING` (23) and `BROADCAST` (34) fixtures and from line 77;
    - the case key becomes `'armed-gate-open'`, with `pairing: PAIRING` and `broadcast: { ...BROADCAST, cause: 'operator' }`;
    - replace the test at 273–290 with:

```ts
// Final review I-2: the pair intent carries no waiting fields, so a pairing has no label until the first answer.
it('reads a pairing before its first answer, its label empty', () => {
  const before = readSnapshot({ ...paired, pairing: { ...paired.pairing, label: '' } });
  expect(before.pairing).toMatchObject({ label: '' });
});
```

    Use the reader function and the `paired` fixture name the original test used; read lines 270–290 first and keep them.

- `fetchCodePort.test.ts`:
  - delete `overlayUrl` from the `waiting` fixture (19) and from `prod` (190);
  - `refuses a beat URL off the build host whole, and drops a foreign overlay with a line` becomes `refuses a beat URL off the build host whole`, keeping only its first `foreignBeat` assertion;
  - replace `says nothing in the record for a clean answer, an overlay null included` with:

```ts
it('does not read an overlayUrl: a foreign one, a number or null answers whole, with nothing in the record (D2 §4.1)', async () => {
  for (const overlayUrl of ['https://evil.example/o', 42, null]) {
    const view = portOver(answering(respond(200, waiting({ overlayUrl }))));
    const read = await view.ask();
    expect(read).toMatchObject({ ok: true });
    expect(read.ok && 'overlayUrl' in read.value).toBe(false);
    expect(view.record.lines()).toEqual([]);
  }
});
```

- `waitingFields.test.ts`: delete `overlayUrl` from the fixture (19) and from the key list (44), and delete any overlay-specific test.
- `fakeCodePort.test.ts:53`, `savedCode.test.ts:26`, `pairIntentWire.test.ts:47`: delete the `overlayUrl` line. A saved code from before this change still reads: the reader ignores the extra key. `savedCode.test.ts` gets the row:

```ts
it('reads a code saved before D2, whose waiting fields still name an overlay (D2 §4.1)', () => {
  const saved = encodeSavedCode(SAVED);
  const old = JSON.parse(saved) as Record<string, Record<string, unknown>>;
  const withOverlay = JSON.stringify({
    ...old,
    fields: { ...old.fields, overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture' },
  });
  expect(decodeSavedCode(withOverlay)).toEqual(decodeSavedCode(saved));
});
```

    Use the file's own fixture name for `SAVED` and its real encode and decode function names. Read the file first: if the waiting fields sit under a key other than `fields`, use that key.

- Run `pnpm typecheck`. Every remaining error is an `overlayUrl` property in a test fixture: delete it.

- [ ] **Step 9: Run the TS tests.** Run: `pnpm vitest run modules/capture-engine/src src/domain/credentials src/services/fetchCodePort.test.ts src/services/fakeCodePort.test.ts src/services/scrubParity.test.ts src/domain/mode/savedCode.test.ts src/hooks/pairIntentWire.test.ts`. Expected: PASS.

- [ ] **Step 10: Residue.** Run `git grep -n -i "overlayUrl" -- src modules app test`. The only hits allowed are:
  - the server-body inputs in `modules/capture-engine/src/wire/*.json` (`fields`, `base`, `server-bodies.json`, `scripted-probe.json`, `host-vectors.json`'s about text);
  - `scrub` (`allow-list.json` `publicUrl`, `scrub.ts` `PUBLIC_URL_KEYS`, `scrub/vectors.json`);
  - test inputs that send the field to prove it is ignored.

- [ ] **Step 11: Mutation.** Back up `waitingFields.ts` with `cp`. Re-add the line `if (input.overlayUrl !== undefined && input.overlayUrl !== null && typeof input.overlayUrl !== 'string') return null;` before the return. Run `pnpm vitest run modules/capture-engine/src/waitingVectors.test.ts`. Expected: FAIL on `an overlayUrl of any shape is not read…`. Restore.

- [ ] **Step 12: The gate.** Run `pnpm check` (EXIT=0) and gradle (EXIT=0).

- [ ] **Step 13: Commit.**

```bash
git add -A src modules test
git commit -m "refactor(engine): the snapshot and the readers carry no overlay URL; native's overlay-refused line goes (D2 §4.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: The ladder's first rung is `viewer-feed`, and its copy

**Files:**

- Modify:
  - Kotlin `core/Vocabulary.kt:47-51`
  - Kotlin `adapter/DeviceReadings.kt:83-88`
  - Kotlin tests: `core/VocabularyTest.kt:32`, `core/SessionMachineDeviceTest.kt:127,130`, `adapter/DeviceReadingsTest.kt:121`, `adapter/SnapshotWireTest.kt:61-62`
  - `modules/capture-engine/src/wire/snapshot-vectors.json` (lines 42, 425)
  - `modules/capture-engine/src/snapshotWire.ts:58`
  - `modules/capture-engine/src/FakeCaptureEngine.ts:401-406`
  - `modules/capture-engine/src/FakeCaptureEngine.test.ts:479`
  - `src/domain/session/SessionState.ts:63-98`
  - `src/hooks/engineSelectors.test-d.ts:57`
  - `src/hooks/advisory.ts` (doc)
  - `src/hooks/advisory.test.ts`
  - `src/i18n/{en,es,fr,nl}.json`
  - `src/i18n/budgets.test.ts`
  - `src/ui/theme/scoringFit.test.ts`
  - `src/ui/theme/controlsFit.test.ts`

**Interfaces:**

- Produces: `ShedStep = 'viewer-feed' | 'preview-framerate' | 'encode'` and `SHED_ORDER`. The new key is `stream.peek.hot`, and `stream.advisory.shed` gets new copy.

- [ ] **Step 1: The failing type test.** In `src/hooks/engineSelectors.test-d.ts:57`, the line becomes `expectTypeOf<ShedStep>().toEqualTypeOf<'viewer-feed' | 'preview-framerate' | 'encode'>();`. In `modules/capture-engine/src/FakeCaptureEngine.test.ts:479`, `.toBe('overlay-preview')` becomes `.toBe('viewer-feed')`. In Kotlin `core/VocabularyTest.kt:32`, the list becomes `listOf("viewer-feed", "preview-framerate", "encode")`.

- [ ] **Step 2: The failing copy test.** In `src/hooks/advisory.test.ts`, the English shed copy assertion becomes `expect(en['stream.advisory.shed']).toBe('Phone hot — viewer check off, still live');`. In `src/i18n/budgets.test.ts`, replace the `[/^stream\.peek\.unavailable$/, 24],` row with `[/^stream\.peek\.(unavailable|hot)$/, 24],`.

- [ ] **Step 3: Run them to see them fail.** Run: `pnpm vitest run src/hooks/engineSelectors.test-d.ts modules/capture-engine/src/FakeCaptureEngine.test.ts src/hooks/advisory.test.ts src/i18n/budgets.test.ts`. Expected: FAIL. Run gradle. Expected: FAIL in `VocabularyTest`.

- [ ] **Step 4: Rename, Kotlin.** In `core/Vocabulary.kt`:

```kotlin
/**
 * The degradation ladder (AGENTS §8), in order, never reordered. Step 1 is What viewers see, which the app closes and
 * disables (D2 §4.2). Steps 2 and 3 are reported only: no native code lowers the frame rate or the encode (_FINDINGS
 * N24).
 */
enum class ShedStep(override val wire: String) : Wire {
  VIEWER_FEED("viewer-feed"),
  PREVIEW_FRAMERATE("preview-framerate"),
  ENCODE("encode"),
}
```

In `adapter/DeviceReadings.kt`, the KDoc becomes `/** CD20, D2 §4.2: moderate sheds What viewers see, severe the preview frame rate, critical and worse the encode. */`, and `2 -> ShedStep.VIEWER_FEED`. Make the same rename in `SessionMachineDeviceTest.kt:127,130`, `DeviceReadingsTest.kt:121` and `SnapshotWireTest.kt:61-62`.

- [ ] **Step 5: Rename, TS and vectors.** In `snapshot-vectors.json`:
  - line 42 becomes `"shed": ["viewer-feed", "preview-framerate", "encode"],`;
  - line 425 becomes `"shed": "viewer-feed",`.

  In `snapshotWire.ts:58`, `shed: new Set(['viewer-feed', 'preview-framerate', 'encode']),`. In `FakeCaptureEngine.ts`'s `'shed'` scene, `shed: 'viewer-feed',`. In `src/domain/session/SessionState.ts`:

```ts
/**
 * The degradation ladder, in order, never reordered (AGENTS §8). Step 1 closes and disables What viewers see (D2 §4.2);
 * steps 2 and 3 are reported only (_FINDINGS N24). The operator's convenience is the cheapest thing on the device.
 */
export type ShedStep = 'viewer-feed' | 'preview-framerate' | 'encode';

export const SHED_ORDER: readonly ShedStep[] = ['viewer-feed', 'preview-framerate', 'encode'];
```

In the `DegradeReason` doc (63–70), "it sheds the operator's overlay preview long before it touches the encode" becomes "it closes What viewers see long before it touches the encode". In `src/hooks/advisory.ts`, the `selectShedding` doc becomes `/** Any step down the ladder closes What viewers see: the ladder only goes down, so step 2 or 3 means step 1 too (D2 §4.2). */`, and the `topAdvisory` doc's "Heat is next" sentence becomes "Heat is next: it has closed What viewers see (the ladder's first rung, D2 §4.2) while the broadcast is fine." Run `git grep -n "overlay-preview\|OVERLAY_PREVIEW" -- src modules`. Expected: no hits.

- [ ] **Step 6: The copy, four locales.** Replace `stream.advisory.shed` and add `stream.peek.hot` after `stream.peek.unavailable`:

| key                    | en                                         | es                                                      | fr                                                  | nl                                                 |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `stream.advisory.shed` | `Phone hot — viewer check off, still live` | `Móvil caliente: vista del público apagada, en directo` | `Téléphone chaud : vue du public coupée, en direct` | `Telefoon heet: kijkersbeeld uit, nog steeds live` |
| `stream.peek.hot`      | `Phone hot`                                | `Móvil caliente`                                        | `Téléphone chaud`                                   | `Telefoon heet`                                    |

Add `"_review": "pending translation review"` as the first key of `es.json`, `fr.json` and `nl.json`, unless a marker is already there.

Widths, measured on 2026-10-09 with `test/fontMetrics.ts` (Geist 500 at 12, the caption role):

| key                    | en    | es    | fr    | nl    | 298 dp line | 101 dp cell                        |
| ---------------------- | ----- | ----- | ----- | ----- | ----------- | ---------------------------------- |
| `stream.advisory.shed` | 220.3 | 294.5 | 283.4 | 266.1 | all fit     | —                                  |
| `stream.peek.hot`      | 58.0  | 79.7  | 97.3  | 78.9  | —           | all one line (fr has 3.7 to spare) |

None of the four shed captions joins `OVER_NARROW`, so `stripTextFit.test.ts` needs no edit. If it fails, the fonts differ from these measurements: report it.

- [ ] **Step 7: The peek cell holds the new reason.**
  - `src/ui/theme/controlsFit.test.ts`, in `holds()`: make the reason a list, and keep `LEAST` at 101.

```ts
const reasons = ['stream.peek.unavailable', 'stream.peek.hot'].map(
  (key) => (dictionary as Dictionary)[key] ?? '',
);
return (
  wordsOf(label).every((word) => peekLabelWidth(word) <= cell - padding) &&
  reasons.every((reason) => wordsOf(reason).every((word) => unitWidth(word) <= cell)) &&
  linesOf(label, cell - padding, peekLabelWidth) <= layout.peekLabelLines &&
  reasons.every((reason) => linesOf(reason, cell, unitWidth) <= layout.peekReasonLines)
);
```

- `src/ui/theme/scoringFit.test.ts`: add after the 16-row test:

```ts
it('the heat reason (D2 §4.2) is one line in the 110 dp cell in every language: 58.0, 79.7, 97.3 and 78.9 dp', () => {
  const widths = LANGUAGES.map(([, dictionary]) => unitWidth(dictionary['stream.peek.hot'] ?? ''));
  expect(widths.map((each) => Math.round(each * 10) / 10)).toEqual([58.0, 79.7, 97.3, 78.9]);
  for (const [, dictionary] of LANGUAGES)
    expect(linesOf(dictionary['stream.peek.hot'] ?? '', peekCell(640), unitWidth)).toBe(1);
});
```

- [ ] **Step 8: Run.** Run: `pnpm vitest run src/hooks src/i18n src/ui/theme modules/capture-engine/src`. Expected: PASS. Run gradle. Expected: EXIT=0.

- [ ] **Step 9: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 10: Commit.**

```bash
git add -A src modules
git commit -m "feat(ladder): the first rung is What viewers see (viewer-feed), with its heat copy (D2 §4.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: The viewers' feed: one quiet retry, no first-window patience

**Files:**

- Modify:
  - `src/domain/session/viewerFeed.ts`
  - `src/domain/session/viewerFeed.test.ts`
  - `src/hooks/useViewerFeed.ts`
  - `src/hooks/useViewerFeed.test.tsx`

**Interfaces:**

- Produces:
  - `FeedInput` without `patienceOver`;
  - `PLAYER_RETRY_MS = [2_000]`;
  - `FIRST_WINDOW_PATIENCE_MS` deleted;
  - `useViewerFeed(pressed, mounted)`, unchanged in signature.

- [ ] **Step 1: The failing domain test.** In `src/domain/session/viewerFeed.test.ts`, delete every row's `patienceOver` field and the rows whose only difference is `patienceOver: true`. Add:

```ts
// D2 §4.3: the view's own 5 s countdown is the patience now. Before the first window the layer waits, however long.
it('waits for the first window with no patience of its own', () => {
  expect(
    viewerFeed({
      kind: 'publishing',
      hasUrl: true,
      delivery: 'unknown',
      everDelivered: false,
      playerFailed: false,
    }),
  ).toBe('waiting');
});
```

- [ ] **Step 2: The failing hook test.** In `src/hooks/useViewerFeed.test.tsx`:
  - delete every test about the 60 s patience: search `FIRST_WINDOW_PATIENCE_MS` and `patience`;
  - change the retry-ladder tests to the one-rung schedule, using the file's existing helpers. A failed player is remounted once after 2 s, and a second failure gives up (`unavailable`):

```tsx
it('retries a failed player once, quietly, after 2 s, and gives up on the second failure (D2 §4.3)', async () => {
  expect(PLAYER_RETRY_MS).toEqual([2_000]);
  // Arrange as the file's own retry tests do: live, delivered, the peek mounted, one Video on screen.
  // 1st failure: no remount before 2 s, one at 2 s.
  // 2nd failure: no remount at any later time, and the feed reads `unavailable`.
});
```

Fill this body from the file's existing `D6` retry test. Copy its arrangement and replace the three-rung expectations with:

```tsx
act(() => surfaces.videoStatus('failed'));
act(() => vi.advanceTimersByTime(1_999));
expect(surfaces.videoMounts()).toBe(1);
act(() => vi.advanceTimersByTime(1));
expect(surfaces.videoMounts()).toBe(2);
act(() => surfaces.videoStatus('failed'));
act(() => vi.advanceTimersByTime(60_000));
expect(surfaces.videoMounts()).toBe(2);
```

plus the file's existing assertion that the layer then shows the unavailable line. `usePeek` is still the press source in this task: Task 9 replaces it.

- [ ] **Step 3: Run them to see them fail.** Run: `pnpm vitest run src/domain/session/viewerFeed.test.ts src/hooks/useViewerFeed.test.tsx`. Expected: FAIL. `patienceOver` is a required field (a typecheck error surfaces as a failed collection), and the schedule is three rungs.

- [ ] **Step 4: Implement.** In `src/domain/session/viewerFeed.ts`:
  - delete `FIRST_WINDOW_PATIENCE_MS` and its doc;
  - delete `patienceOver` from `FeedInput`;
  - the last line of `viewerFeed` becomes `return 'waiting';`;
  - add to the function's doc: "Before the first window it waits; the view's own countdown says when that is too long (D2 §4.3)."

  In `src/hooks/useViewerFeed.ts`:

```ts
/** D2 §4.3: one quiet retry inside the view's 5 s loading window, then the player is given up on (D6). */
export const PLAYER_RETRY_MS: readonly number[] = [2_000];
```

- drop `FIRST_WINDOW_PATIENCE_MS` from the import;
- in `useFirstWindow`, delete `patienceOver`, `setPatienceOver`, the `setPatienceOver(false)` line and the whole third `useEffect` (the patience timer);
- its return becomes `return { everDelivered };`, and its doc drops "and whether the 60 s patience for the first one is over" and the timeout sentence;
- `useViewerFeed`'s doc drops "whether the patience for the first one has run out";
- `live` is now unused in `useFirstWindow`: delete it.

- [ ] **Step 5: Run.** Run: `pnpm vitest run src/domain/session/viewerFeed.test.ts src/hooks/useViewerFeed.test.tsx`. Expected: PASS.

- [ ] **Step 6: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 7: Commit.**

```bash
git add src
git commit -m "refactor(peek): one quiet retry at 2 s, and no first-window patience (D2 §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The view's rule, a pure reducer

**Files:**

- Create:
  - `src/domain/session/viewerCheck.ts`
  - `src/domain/session/viewerCheck.test.ts`

**Interfaces:**

- Produces:
  - `LOADING_MS = 5_000`, `SHOWING_MS = 20_000`, `NOT_READY_MS = 3_000`;
  - `type ViewerCheck = { kind: 'idle' } | { kind: 'loading' | 'showing' | 'notReady'; until: number }`;
  - `type ViewerEvent = tap | firstFrame | deadline | close`;
  - `IDLE`;
  - `viewerCheck(state, event): ViewerCheck`.

- [ ] **Step 1: Write the failing test** `src/domain/session/viewerCheck.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  IDLE,
  LOADING_MS,
  NOT_READY_MS,
  SHOWING_MS,
  viewerCheck,
  type ViewerCheck,
  type ViewerEvent,
} from '@/domain/session/viewerCheck';

const T = 1_000_000;
const loading: ViewerCheck = { kind: 'loading', until: T + 5_000 };
const showing: ViewerCheck = { kind: 'showing', until: T + 3_000 + 20_000 };
const notReady: ViewerCheck = { kind: 'notReady', until: T + 5_000 + 3_000 };

/** Spec §4.3's diagram, row by row. Every number is the spec's: 5 s, 20 s from the first frame, 3 s. */
describe('What viewers see, the rule (D2 §4.3, R2, R10)', () => {
  it('has the spec’s three times', () => {
    expect([LOADING_MS, SHOWING_MS, NOT_READY_MS]).toEqual([5_000, 20_000, 3_000]);
  });

  it.each<[string, ViewerCheck, ViewerEvent, ViewerCheck]>([
    ['idle, a tap: loading for 5 s', IDLE, { kind: 'tap', at: T }, loading],
    [
      'loading, the first frame: showing for 20 s from it',
      loading,
      { kind: 'firstFrame', at: T + 3_000 },
      showing,
    ],
    [
      'loading, the 5 s are up with no frame: not ready for 3 s',
      loading,
      { kind: 'deadline', at: T + 5_000 },
      notReady,
    ],
    ['showing, the 20 s are up: idle', showing, { kind: 'deadline', at: T + 23_000 }, IDLE],
    ['not ready, the 3 s are up: idle', notReady, { kind: 'deadline', at: T + 8_000 }, IDLE],
    ['loading, a tap: idle', loading, { kind: 'tap', at: T + 1_000 }, IDLE],
    ['showing, a tap: idle, never a longer view', showing, { kind: 'tap', at: T + 10_000 }, IDLE],
    ['not ready, a tap: idle', notReady, { kind: 'tap', at: T + 6_000 }, IDLE],
    [
      'loading, closed (shed, off air, the scoring panel, no URL): idle',
      loading,
      { kind: 'close' },
      IDLE,
    ],
    ['showing, closed: idle', showing, { kind: 'close' }, IDLE],
    ['not ready, closed: idle', notReady, { kind: 'close' }, IDLE],
    ['idle, closed: idle', IDLE, { kind: 'close' }, IDLE],
  ])('%s', (_name, state, event, next) => {
    expect(viewerCheck(state, event)).toEqual(next);
  });

  it.each<[string, ViewerCheck, ViewerEvent]>([
    [
      'a second first frame while showing does not restart the 20 s',
      showing,
      { kind: 'firstFrame', at: T + 15_000 },
    ],
    [
      'a deadline before its time changes nothing (loading)',
      loading,
      { kind: 'deadline', at: T + 4_999 },
    ],
    [
      'a deadline before its time changes nothing (showing)',
      showing,
      { kind: 'deadline', at: T + 22_999 },
    ],
    [
      'a stale frame on the not-ready line changes nothing',
      notReady,
      { kind: 'firstFrame', at: T + 6_000 },
    ],
    ['a frame or a deadline while idle changes nothing', IDLE, { kind: 'deadline', at: T }],
    ['a frame while idle changes nothing', IDLE, { kind: 'firstFrame', at: T }],
  ])('%s', (_name, state, event) => {
    expect(viewerCheck(state, event)).toBe(state);
  });

  it('a tap after closing opens a new view from that tap: a view cannot be extended, only begun again', () => {
    const closed = viewerCheck(showing, { kind: 'tap', at: T + 10_000 });
    expect(closed).toEqual(IDLE);
    expect(viewerCheck(closed, { kind: 'tap', at: T + 10_500 })).toEqual({
      kind: 'loading',
      until: T + 15_500,
    });
  });

  it('bounds a view at 25 s of player time with a picture, and 8 s without one (spec §4.3)', () => {
    let state = viewerCheck(IDLE, { kind: 'tap', at: T });
    state = viewerCheck(state, { kind: 'firstFrame', at: T + 4_999 });
    expect(state.kind === 'showing' && state.until - T).toBe(24_999);
    let none = viewerCheck(IDLE, { kind: 'tap', at: T });
    none = viewerCheck(none, { kind: 'deadline', at: T + 5_000 });
    expect(none.kind === 'notReady' && none.until - T).toBe(8_000);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** Run: `pnpm vitest run src/domain/session/viewerCheck.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/domain/session/viewerCheck.ts`:

```ts
/**
 * What viewers see as a rule (D2 §4.3, R2, R10): event in, state out, no timers. The hook owns the timers and reads
 * the time; this decides only what follows what. It is the view's, not the session's: native owns the session
 * (AGENTS §2), and nothing here is read by the machine, the snapshot or the heartbeat.
 *
 *   idle --tap--> loading (5 s)
 *   loading --first frame--> showing (20 s, counted from the frame)
 *   loading --5 s, no frame--> notReady (3 s) --> idle
 *   showing --20 s--> idle
 *   any open --tap--> idle: a tap never extends a view, so a phone cannot be left playing
 *   any --close (shed, off air, the scoring panel, no playback URL, the background)--> idle
 */

/** The countdown while the player has no picture yet. */
export const LOADING_MS = 5_000;
/** The view, counted from its first frame, not from the tap. */
export const SHOWING_MS = 20_000;
/** The honest line when no picture came: shown this long, then the view closes. */
export const NOT_READY_MS = 3_000;

export type ViewerCheck =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' | 'showing' | 'notReady'; readonly until: number };

export type ViewerEvent =
  | { readonly kind: 'tap'; readonly at: number }
  | { readonly kind: 'firstFrame'; readonly at: number }
  | { readonly kind: 'deadline'; readonly at: number }
  | { readonly kind: 'close' };

export const IDLE: ViewerCheck = { kind: 'idle' };

export function viewerCheck(state: ViewerCheck, event: ViewerEvent): ViewerCheck {
  switch (event.kind) {
    case 'close':
      return IDLE;
    case 'tap':
      return state.kind === 'idle' ? { kind: 'loading', until: event.at + LOADING_MS } : IDLE;
    case 'firstFrame':
      return state.kind === 'loading' ? { kind: 'showing', until: event.at + SHOWING_MS } : state;
    case 'deadline':
      return deadline(state, event.at);
  }
}

/** A timer firing at `at`. One that fires early, or for a view already gone, changes nothing. */
function deadline(state: ViewerCheck, at: number): ViewerCheck {
  if (state.kind === 'idle' || at < state.until) return state;
  return state.kind === 'loading' ? { kind: 'notReady', until: at + NOT_READY_MS } : IDLE;
}
```

- [ ] **Step 4: Run.** Run: `pnpm vitest run src/domain/session/viewerCheck.test.ts`. Expected: PASS.

- [ ] **Step 5: Mutation (Review Focus 1).** Back up the file with `cp`. Change the `tap` case to `return state.kind === 'idle' ? … : state.kind === 'showing' ? { kind: 'showing', until: event.at + SHOWING_MS } : IDLE;`. Run the test. Expected: FAIL on `showing, a tap: idle, never a longer view`. Restore.

- [ ] **Step 6: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 7: Commit.**

```bash
git add src/domain/session/viewerCheck.ts src/domain/session/viewerCheck.test.ts
git commit -m "feat(peek): What viewers see as a pure rule: 5 s, 20 s from the first frame, 3 s (D2 §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: `useViewerCheck`, the hook that owns the view's timers

**Files:**

- Create:
  - `src/hooks/useViewerCheck.ts`
  - `src/hooks/useViewerCheck.test.tsx`

**Interfaces:**

- Consumes: `viewerCheck`, `IDLE` (Task 7); `usePorts()` (`clock`, `foreground`, `logger`); `useTurnCardShowing()`.
- Produces:

```ts
export type ViewerCheckView = {
  readonly kind: ViewerCheck['kind'];
  toggle(): void;
  close(): void;
  firstFrame(): void;
};
export function useViewerCheck(input: {
  available: boolean;
  shed: boolean;
  scoringOpen: boolean;
  hideScoring: () => void;
}): ViewerCheckView;
```

- [ ] **Step 1: Write the failing test** `src/hooks/useViewerCheck.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewerCheck } from '@/hooks/useViewerCheck';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

type Input = Parameters<typeof useViewerCheck>[0];
const OPEN: Input = { available: true, shed: false, scoringOpen: false, hideScoring: () => {} };

function mount(input: Input = OPEN, fakes: FakePorts = createFakePorts()) {
  const view = renderHook((props: Input) => useViewerCheck(props), {
    initialProps: input,
    wrapper: wrapperFor(fakes),
  });
  return { ...view, fakes };
}

describe('useViewerCheck (D2 §4.3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens on a tap, shows 20 s from the first frame, then closes by itself', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.firstFrame());
    expect(result.current.kind).toBe('showing');
    act(() => vi.advanceTimersByTime(19_999));
    expect(result.current.kind).toBe('showing');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('idle');
  });

  it('with no frame in 5 s, says so for 3 s and closes', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.kind).toBe('notReady');
    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current.kind).toBe('notReady');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.kind).toBe('idle');
  });

  it('a second tap closes it, and a third begins a new view; no tap ever lengthens one', () => {
    const { result } = mount();
    act(() => result.current.toggle());
    act(() => result.current.firstFrame());
    act(() => vi.advanceTimersByTime(10_000));
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('loading');
  });

  it.each<[string, Partial<Input>]>([
    ['the ladder sheds', { shed: true }],
    ['it leaves live, or the playback URL goes', { available: false }],
    ['the Remote scoring panel opens', { scoringOpen: true }],
  ])('closes when %s, and a tap then opens nothing while it stands', (_name, change) => {
    const { result, rerender } = mount();
    act(() => result.current.toggle());
    rerender({ ...OPEN, ...change });
    expect(result.current.kind).toBe('idle');
    if (change.scoringOpen === true) return; // a tap with the panel up is the next test's
    act(() => result.current.toggle());
    expect(result.current.kind).toBe('idle');
  });

  it('a tap with the scoring panel up takes the panel down and opens: one cover at a time', () => {
    const hideScoring = vi.fn();
    const { result } = mount({ ...OPEN, scoringOpen: true, hideScoring });
    act(() => result.current.toggle());
    expect(hideScoring).toHaveBeenCalledTimes(1);
    expect(result.current.kind).toBe('loading');
  });

  it('closes when the app leaves the foreground, and stays closed on return', () => {
    const { result, fakes } = mount();
    act(() => result.current.toggle());
    act(() => fakes.foreground.leave());
    expect(result.current.kind).toBe('idle');
    act(() => fakes.foreground.fire());
    expect(result.current.kind).toBe('idle');
  });

  it('leaves no timer behind after an unmount mid-view', () => {
    const { result, unmount } = mount();
    act(() => result.current.toggle());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes each state, and the time from tap to first frame, to the record (spec §8, the HLS risk)', () => {
    const { result, fakes } = mount();
    act(() => result.current.toggle());
    act(() => result.current.firstFrame());
    const lines = readRecord(fakes.record).filter((entry) => entry.event.startsWith('viewer.'));
    expect(lines.map((entry) => [entry.event, entry.fields])).toEqual([
      ['viewer.check', { state: 'loading' }],
      ['viewer.firstFrame', { ms: 0 }],
      ['viewer.check', { state: 'showing' }],
    ]);
  });
});
```

The fake clock is frozen at `TEST_NOW`, so the time to the first frame reads 0. The arithmetic is the reducer's, tested in Task 7.

- [ ] **Step 2: Run it to see it fail.** Run: `pnpm vitest run src/hooks/useViewerCheck.test.tsx`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/hooks/useViewerCheck.ts`:

```ts
import { useCallback, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import {
  IDLE,
  viewerCheck,
  type ViewerCheck,
  type ViewerEvent,
} from '@/domain/session/viewerCheck';
import { usePorts } from '@/hooks/usePorts';
import { useTurnCardShowing } from '@/hooks/useTurnCard';
import type { Logger } from '@/services/logger';

export type ViewerCheckView = {
  readonly kind: ViewerCheck['kind'];
  /** The peek cell's tap: opens from idle, closes an open view (never extends it). */
  toggle(): void;
  /** The cover's own tap, and Hide. */
  close(): void;
  /** The player showed its first picture. */
  firstFrame(): void;
};

type Input = {
  /** On air with a viewer picture (`useViewfinder`'s `peekable`). */
  readonly available: boolean;
  /** Any step down the ladder: the first rung is this view (D2 §4.2). */
  readonly shed: boolean;
  /** The Remote scoring panel is up: one cover at a time (D2 §4.3). */
  readonly scoringOpen: boolean;
  /** Takes the scoring panel down when this view opens. Stable (`useScoringLink`'s `hide`). */
  readonly hideScoring: () => void;
};

const CLOSE: ViewerEvent = { kind: 'close' };

/**
 * What viewers see (D2 §4.3): `viewerCheck` decides, this owns the timers and the reasons to close. The view closes
 * on a shed, off air or with no playback URL (`available`), when the scoring panel opens, while the turn card covers
 * the stage (ruling N4) and when the app leaves the foreground (ruling M5). It never re-opens by itself.
 */
export function useViewerCheck(input: Input): ViewerCheckView {
  const { clock, foreground, logger } = usePorts();
  const turnCard = useTurnCardShowing();
  const [state, dispatch] = useReducer(viewerCheck, IDLE);
  const blocked = !input.available || input.shed || turnCard;
  useDeadline(state, dispatch, clock);
  useCloseWhen(blocked || input.scoringOpen, dispatch);
  useEffect(() => foreground.subscribeBackground(() => dispatch(CLOSE)), [foreground]);
  useStateLines(state.kind, logger);
  const toggle = useToggle(state.kind, blocked, input.hideScoring, dispatch, clock);
  const firstFrame = useFirstFrame(state.kind, dispatch, clock, logger);
  const close = useCallback(() => dispatch(CLOSE), []);
  // M7: the same object until the kind changes, so the memoised stage and column skip.
  return useMemo(
    () => ({ kind: state.kind, toggle, close, firstFrame }),
    [state.kind, toggle, close, firstFrame],
  );
}

/** One timer for the open state's deadline, cleared with it. The deadline is the state's own `until`. */
function useDeadline(state: ViewerCheck, dispatch: Dispatch<ViewerEvent>, clock: () => Date) {
  useEffect(() => {
    if (state.kind === 'idle') return undefined;
    const { until } = state;
    const wait = Math.max(0, until - clock().getTime());
    const timer = setTimeout(() => dispatch({ kind: 'deadline', at: until }), wait);
    return () => clearTimeout(timer);
  }, [state, dispatch, clock]);
}

function useCloseWhen(closed: boolean, dispatch: Dispatch<ViewerEvent>) {
  useEffect(() => {
    if (closed) dispatch(CLOSE);
  }, [closed, dispatch]);
}

/** Opening takes the scoring panel down first (one cover at a time); a blocked view opens nothing. */
function useToggle(
  kind: ViewerCheck['kind'],
  blocked: boolean,
  hideScoring: () => void,
  dispatch: Dispatch<ViewerEvent>,
  clock: () => Date,
) {
  const latest = useRef({ kind, blocked });
  useEffect(() => {
    latest.current = { kind, blocked };
  });
  return useCallback(() => {
    const now = latest.current;
    if (now.kind === 'idle') {
      if (now.blocked) return;
      hideScoring();
    }
    dispatch({ kind: 'tap', at: clock().getTime() });
  }, [hideScoring, dispatch, clock]);
}

/** PD6: the time from the tap to the first picture, for spec §8's HLS risk. The tap's time is held only while loading. */
function useFirstFrame(
  kind: ViewerCheck['kind'],
  dispatch: Dispatch<ViewerEvent>,
  clock: () => Date,
  logger: Logger,
) {
  const tappedAt = useRef<number | null>(null);
  useEffect(() => {
    if (kind === 'loading') tappedAt.current ??= clock().getTime();
    else if (kind !== 'showing') tappedAt.current = null;
  }, [kind, clock]);
  return useCallback(() => {
    const at = clock().getTime();
    if (tappedAt.current !== null) {
      logger.info('viewer.firstFrame', { ms: at - tappedAt.current });
      tappedAt.current = null;
    }
    dispatch({ kind: 'firstFrame', at });
  }, [dispatch, clock, logger]);
}

/** PD6: one line each time the view's state changes, after the first (a mount at idle is not news). */
function useStateLines(kind: ViewerCheck['kind'], logger: Logger) {
  const before = useRef(kind);
  useEffect(() => {
    if (before.current === kind) return;
    before.current = kind;
    logger.info('viewer.check', { state: kind });
  }, [kind, logger]);
}
```

The record test's expected order is `loading`, `firstFrame`, `showing`. The first-frame line is written in the handler, before React commits `showing`, so that order is real.

- [ ] **Step 4: Run.** Run: `pnpm vitest run src/hooks/useViewerCheck.test.tsx`. Expected: PASS. If the record test shows the lines in another order, the hook is wrong, not the test: the handler runs before the commit.

- [ ] **Step 5: Mutation (Review Focus 3).** Back up with `cp`. Change `const blocked = !input.available || input.shed || turnCard;` to `const blocked = !input.available || turnCard;`. Run. Expected: FAIL on `closes when the ladder sheds…`. Restore.

- [ ] **Step 6: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 7: Commit.**

```bash
git add src/hooks/useViewerCheck.ts src/hooks/useViewerCheck.test.tsx
git commit -m "feat(peek): useViewerCheck owns the view's timers and the reasons it closes (D2 §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: The cover, the tap, and one cover at a time

**Files:**

- Create:
  - `src/ui/components/ViewerCover.tsx`
  - `src/ui/screens/StreamScreen.viewer.test.tsx`
  - `src/ui/theme/viewerCoverFit.test.ts`
- Modify:
  - `src/ui/components/StreamStage.tsx`
  - `src/ui/components/StreamColumn.tsx`
  - `src/ui/components/StreamColumn.test.tsx`
  - `src/ui/components/ViewerPeek.tsx`
  - `src/ui/components/ViewerPeek.test.tsx` (rewritten)
  - `src/ui/components/StageVideo.tsx`
  - `src/ui/screens/StreamScreen.tsx`
  - `src/hooks/useViewfinder.ts`
  - `src/hooks/useViewerFeed.test.tsx`
  - `src/i18n/{en,es,fr,nl}.json`
  - `src/i18n/budgets.test.ts`
  - `src/ui/screens/StreamScreen.layout.test.tsx` (peek press helpers)
- Delete: `src/hooks/usePeek.ts`

**Interfaces:**

- Consumes: `useViewerCheck` (Task 8), `useViewerFeed(pressed, mounted)` (Task 6), `selectShedding`.
- Produces:
  - `Viewfinder.shed: boolean`;
  - `StageProps.viewer: ViewerCheckView`;
  - `ColumnProps.viewer: ViewerCheckView`;
  - `ViewerPeek` props `{ disabled, reason, open, onPress }`;
  - `StageVideo` props `{ url, attempt, onStatus }`.

- [ ] **Step 1: The copy.** Add after `stream.peek.hot` in the four dictionaries, change `stream.peek.hint` and `stream.peek.loading`, and keep `stream.peek.label` and `stream.peek.unavailable`:

| key                    | en                                                     | es                                                        | fr                                                     | nl                                                      |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `stream.peek.hint`     | `Tap to see what viewers see for 20 seconds`           | `Toca para ver 20 segundos lo que ve el público`          | `Touchez pour voir 20 secondes ce que voit le public`  | `Tik om 20 seconden te zien wat kijkers zien`           |
| `stream.peek.loading`  | `Waiting for the picture · {seconds} s`                | `Esperando la imagen · {seconds} s`                       | `En attente de l'image · {seconds} s`                  | `Wachten op beeld · {seconds} s`                        |
| `stream.peek.honest`   | `What viewers see · no scoreboard yet`                 | `Lo que ve el público · aún sin marcador`                 | `Ce que voit le public · pas encore de score`          | `Wat kijkers zien · nog geen scorebord`                 |
| `stream.peek.closesIn` | `Closes in {seconds} s`                                | `Se cierra en {seconds} s`                                | `Se ferme dans {seconds} s`                            | `Sluit over {seconds} s`                                |
| `stream.peek.notReady` | `Viewers don't have a picture yet — try again shortly` | `El público aún no tiene imagen: inténtalo en un momento` | `Le public n'a pas encore d'image : réessayez bientôt` | `Kijkers hebben nog geen beeld: probeer het zo opnieuw` |
| `stream.peek.hide`     | `Hide`                                                 | `Ocultar`                                                 | `Masquer`                                              | `Verbergen`                                             |

In `src/i18n/budgets.test.ts`, after the `stream.peek.loading` row, add:

```ts
  // D2 §4.3: the cover's honest line, its countdown, the not-ready line and its Hide.
  [/^stream\.peek\.honest$/, 44],
  [/^stream\.peek\.closesIn$/, 24],
  [/^stream\.peek\.notReady$/, 56],
  [/^stream\.peek\.hide$/, 14],
```

The longest, with `{seconds}` at its widest 300: `stream.peek.loading` fr, 39 characters (budget 44); `honest` fr, 43 (44); `notReady` es, 55 (56). Keep the `_review` markers on es, fr and nl.

- [ ] **Step 2: The cover fit test (failing until the copy exists).** Create `src/ui/theme/viewerCoverFit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

/**
 * D2 §4.3: the cover's lines fit the camera box. The narrowest box any window gets is 316.4 dp wide (804 × 332 before
 * the label is measured, C2's worst case: 178 × 16/9, Task 10); 640 × 360's is 330. The honest line and the countdown
 * are one line of `metricUnit` each, inside `space.sm` either side; the loading and not-ready lines are `body`, at most
 * three lines, inside `space.md` either side. Widths are the shipped fonts' (no kerning).
 */
const BOX = 316.4;
const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
const unit = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);
const body = (text: string) => geist400.width(text, typeScale.body.fontSize);
const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
const fill = (text: string) => text.replace('{seconds}', '20');

function linesOf(text: string, width: number, measure: (text: string) => number): number {
  let lines = 1;
  let current = '';
  for (const piece of text.split(' ')) {
    const next = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || measure(next) <= width) current = next;
    else {
      lines += 1;
      current = piece;
    }
  }
  return lines;
}

describe('the viewer cover’s lines fit the narrowest camera box (D2 §4.3)', () => {
  it.each(LANGUAGES)('%s: the honest line and the countdown are one line each', (_lang, d) => {
    const room = BOX - 2 * space.sm;
    expect(unit(d['stream.peek.honest'])).toBeLessThanOrEqual(room);
    expect(unit(fill(d['stream.peek.closesIn']))).toBeLessThanOrEqual(room);
  });

  it.each(LANGUAGES)(
    '%s: the loading and not-ready lines are at most 3 lines of body',
    (_lang, d) => {
      const room = BOX - 2 * space.md;
      expect(linesOf(fill(d['stream.peek.loading']), room, body)).toBeLessThanOrEqual(3);
      expect(linesOf(d['stream.peek.notReady'], room, body)).toBeLessThanOrEqual(3);
    },
  );

  it('the widest honest line is the French, 238.5 dp, inside 300.4 (anti-vacuity)', () => {
    const widths = LANGUAGES.map(([, d]) => Math.round(unit(d['stream.peek.honest']) * 10) / 10);
    expect(widths).toEqual([213.1, 219.3, 238.5, 214.2]);
  });
});
```

- [ ] **Step 3: Rewrite `src/ui/components/ViewerPeek.test.tsx`:**

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { ViewerPeek } from '@/ui/components/ViewerPeek';
import { renderWithPorts } from '../../../test/renderWithPorts';

const peek = () => screen.getByRole('button', { name: en['stream.peek.label'] });

/** D2 §4.3, PD1: a plain tap. No hold, no delay; a disabled control says why. */
describe('ViewerPeek', () => {
  it('answers a tap with one press, and holds nothing', () => {
    const onPress = vi.fn();
    renderWithPorts(<ViewerPeek disabled={false} reason={null} open={false} onPress={onPress} />);
    fireEvent.click(peek());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads selected while the view is open, and not while it is closed', () => {
    const { rerender } = renderWithPorts(
      <ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />,
    );
    expect(peek().getAttribute('aria-selected')).toBe('false');
    rerender(<ViewerPeek disabled={false} reason={null} open onPress={vi.fn()} />);
    expect(peek().getAttribute('aria-selected')).toBe('true');
  });

  it('is disabled with its reason, and a tap then does nothing', () => {
    const onPress = vi.fn();
    renderWithPorts(
      <ViewerPeek disabled reason={en['stream.peek.hot']} open={false} onPress={onPress} />,
    );
    fireEvent.click(peek());
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
  });

  it('tells a screen reader what a tap does', () => {
    renderWithPorts(<ViewerPeek disabled={false} reason={null} open={false} onPress={vi.fn()} />);
    // accessibilityHint reaches TalkBack only; react-native-web drops it, so the dictionary is the assertion.
    expect(en['stream.peek.hint']).toBe('Tap to see what viewers see for 20 seconds');
  });
});
```

- [ ] **Step 4: The screen test** `src/ui/screens/StreamScreen.viewer.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { renderViewfinder } from '../../../test/renderViewfinder';

const peek = (label = en['stream.peek.label']) => screen.getByRole('button', { name: label });
const cover = () => screen.queryByTestId('viewer-cover');
const video = () => screen.queryByTestId('viewer-video');
const fill = (text: string, seconds: number) => text.replace('{seconds}', String(seconds));

async function onAir(options: Parameters<typeof renderViewfinder>[0] = {}) {
  const view = await renderViewfinder(options, { quiet: true });
  act(() => view.engine.scene('live'));
  return view;
}

describe('What viewers see on the viewfinder (D2 §4.3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a tap: a 5 s countdown, the picture with its honest line, 20 s from the first frame, then closed and unmounted', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    expect(cover()).not.toBeNull();
    expect(screen.getByText(fill(en['stream.peek.loading'], 5))).toBeTruthy();
    expect(screen.getByText(en['stream.peek.honest'])).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText(fill(en['stream.peek.loading'], 4))).toBeTruthy();
    act(() => view.surfaces.videoStatus('ready'));
    expect(screen.getByText(fill(en['stream.peek.closesIn'], 20))).toBeTruthy();
    expect(screen.getByText(en['stream.peek.honest'])).toBeTruthy();
    act(() => vi.advanceTimersByTime(19_999));
    expect(video()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(cover()).toBeNull();
    expect(video()).toBeNull();
  });

  it('no picture in 5 s: the honest not-ready line for 3 s, then closed', async () => {
    await onAir();
    fireEvent.click(peek());
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText(en['stream.peek.notReady'])).toBeTruthy();
    expect(video()).toBeNull();
    act(() => vi.advanceTimersByTime(3_000));
    expect(cover()).toBeNull();
  });

  it('a second tap on the peek closes it, and a tap on the cover does too; neither restarts it', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.surfaces.videoStatus('ready'));
    act(() => vi.advanceTimersByTime(10_000));
    fireEvent.click(peek());
    expect(cover()).toBeNull();
    fireEvent.click(peek());
    fireEvent.click(screen.getByRole('button', { name: en['stream.peek.hide'] }));
    expect(cover()).toBeNull();
  });

  it('one cover at a time: Remote scoring closes the view, and the view closes the panel', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    fireEvent.click(screen.getByRole('button', { name: en['stream.scoring.open'] }));
    expect(cover()).toBeNull();
    fireEvent.click(peek());
    expect(cover()).not.toBeNull();
    expect(screen.queryByText(en['stream.scoring.title'])).toBeNull();
    expect(view.scoringLink.calls).toBe(1);
  });

  it('the ladder sheds mid-view: the cover goes, and the peek is disabled with its reason (D2 §4.2)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.engine.patch({ shed: 'viewer-feed' }));
    expect(cover()).toBeNull();
    expect(peek().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
    fireEvent.click(peek());
    expect(cover()).toBeNull();
  });

  it('a later step down the ladder sheds the first rung too (step 3, encode)', async () => {
    const view = await onAir();
    act(() => view.engine.patch({ shed: 'encode' }));
    expect(peek().getAttribute('aria-disabled')).toBe('true');
  });

  it('the app leaves the foreground mid-view: closed, the player unmounted', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.surfaces.videoStatus('ready'));
    act(() => view.foreground.leave());
    expect(cover()).toBeNull();
    expect(video()).toBeNull();
  });

  it('leaving live mid-view closes it (no playback URL off air)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.engine.forceState({ kind: 'paired' }));
    expect(cover()).toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the honest line and the countdown in the operator’s language',
    async (lang, d) => {
      const view = await onAir({ deviceLanguages: [lang] });
      fireEvent.click(peek(d['stream.peek.label']));
      act(() => view.surfaces.videoStatus('ready'));
      expect(screen.getByText(d['stream.peek.honest'])).toBeTruthy();
      expect(screen.getByText(fill(d['stream.peek.closesIn'], 20))).toBeTruthy();
    },
  );
});
```

`view.scoringLink.calls` is the fake's counter (`test/fakeScoringLinkPort.ts`). If the disabled state is exposed as `disabled` rather than `aria-disabled` on react-native-web 0.21, assert the attribute that `src/ui/components/HoldAction.test.tsx` uses for a disabled control.

- [ ] **Step 5: Run them to see them fail.** Run: `pnpm vitest run src/ui/screens/StreamScreen.viewer.test.tsx src/ui/components/ViewerPeek.test.tsx src/ui/theme/viewerCoverFit.test.ts src/i18n`. Expected: FAIL. The new props do not exist, there is no cover, and a press still holds.

- [ ] **Step 6: `ViewerPeek` becomes a tap.** Replace `src/ui/components/ViewerPeek.tsx`:

```tsx
import { memo } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type ViewerPeekProps = {
  /** Nothing to play, or the ladder shed it (D2 §4.2): a tap does nothing. */
  readonly disabled: boolean;
  /** Why it is off, said at the control. */
  readonly reason: string | null;
  /** The view is open: the control reads selected, and a tap closes it. */
  readonly open: boolean;
  readonly onPress: () => void;
};

/**
 * What viewers see (D2 §4.3): a plain tap, never held. Its protection against a billed preview left running is that the
 * view closes by itself, 20 s after its first frame or 3 s after saying there is no picture; a tap never extends it
 * (AGENTS §6). Set in `actionSecondary`, as a pair with the action below it. Not `Button`: the lime plate's 200 dp
 * minimum does not fit the 110 dp cell (PD1). Selected while open, as IconButton says it (B5).
 */
export const ViewerPeek = memo(function ViewerPeek(props: ViewerPeekProps) {
  const { t } = useT();
  const { disabled, reason, open } = props;
  return (
    <View style={styles.zone}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('stream.peek.label')}
        accessibilityHint={t('stream.peek.hint')}
        aria-selected={open}
        disabled={disabled}
        onPress={props.onPress}
        style={disabled ? offPeek : open ? openPeek : peekStyle}
      >
        <Text variant="actionSecondary" style={disabled ? styles.labelOff : null}>
          {t('stream.peek.label')}
        </Text>
      </Pressable>
      {reason === null ? null : <Text variant="metricUnit">{reason}</Text>}
    </View>
  );
});

function peekStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedPeek : styles.peek;
}

const styles = StyleSheet.create({
  zone: { gap: space.xs },
  peek: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  pressed: { borderColor: colour.ink },
  open: { borderWidth: layout.iconBorderOn, borderColor: colour.lime },
  off: { borderColor: colour.rule },
  labelOff: { color: colour.ink3 },
});

const pressedPeek = [styles.peek, styles.pressed];
const openPeek = [styles.peek, styles.open];
const offPeek = [styles.peek, styles.off];
```

`layout.iconBorderOn` is `IconButton`'s selected border width. Confirm the token name in `IconButton.tsx:60`.

- [ ] **Step 7: `StageVideo` is just the player.** Replace `src/ui/components/StageVideo.tsx`:

```tsx
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { peekPlaybackUrl } from '@/domain/session/previewUrls';
import { usePorts } from '@/hooks/usePorts';
import type { VideoStatus } from '@/services/surfaces';

type StageVideoProps = {
  /** The descriptor's playback URL; the view's bandwidth hint is added here. It goes to the player only. */
  readonly url: string;
  /** The player's remount key: a retry is a fresh player. */
  readonly attempt: number;
  readonly onStatus: (status: VideoStatus) => void;
};

/**
 * The delivered picture, muted, fetched live, never cached (D37): the Video surface owns all three. It takes no touch:
 * the cover over it does. Mounted only while the view is open and the feed is playing, so closing the view stops the
 * download (D2 §4.3). The lines over it are the cover's.
 */
export const StageVideo = memo(function StageVideo({ url, attempt, onStatus }: StageVideoProps) {
  const { surfaces } = usePorts();
  const { Video } = surfaces;
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Video key={attempt} url={peekPlaybackUrl(url)} playing onStatus={onStatus} />
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({ fill: { ...StyleSheet.absoluteFill } });
```

- [ ] **Step 8: The cover.** Create `src/ui/components/ViewerCover.tsx`:

```tsx
import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LOADING_MS, SHOWING_MS, type ViewerCheck } from '@/domain/session/viewerCheck';
import { selectPlaybackUrl } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import type { ViewerFeed } from '@/hooks/useViewerFeed';
import type { VideoStatus } from '@/services/surfaces';
import { StageVideo } from '@/ui/components/StageVideo';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

type Open = Exclude<ViewerCheck['kind'], 'idle'>;

type ViewerCoverProps = {
  readonly kind: Open;
  readonly feed: ViewerFeed;
  readonly onClose: () => void;
  readonly onFirstFrame: () => void;
};

/**
 * What viewers see, over the camera box only (D2 §4.3): the status strip stays visible, and Stop is never covered. One
 * tap anywhere on it closes it (its accessible name is Hide). While loading and showing it carries the honest line, no
 * scoreboard yet: there is no compositor, so the viewers' picture has no score on it. Never blank: a line says what is
 * happening whenever there is no picture.
 */
export const ViewerCover = memo(function ViewerCover(props: ViewerCoverProps) {
  const { t } = useT();
  return (
    <Pressable
      testID="viewer-cover"
      accessibilityRole="button"
      accessibilityLabel={t('stream.peek.hide')}
      onPress={props.onClose}
      style={styles.cover}
    >
      {props.kind === 'notReady' ? (
        <CentreLine text={t('stream.peek.notReady')} />
      ) : (
        <ViewerPicture kind={props.kind} feed={props.feed} onFirstFrame={props.onFirstFrame} />
      )}
    </Pressable>
  );
});

type PictureProps = {
  readonly kind: 'loading' | 'showing';
  readonly feed: ViewerFeed;
  readonly onFirstFrame: () => void;
};

const ViewerPicture = memo(function ViewerPicture({ kind, feed, onFirstFrame }: PictureProps) {
  const { t } = useT();
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const report = feed.onStatus;
  const onStatus = useCallback(
    (status: VideoStatus) => {
      report(status);
      if (status === 'ready') onFirstFrame();
    },
    [report, onFirstFrame],
  );
  const playing = feed.feed === 'playing' && playbackUrl !== null;
  return (
    <>
      {playing ? <StageVideo url={playbackUrl} attempt={feed.attempt} onStatus={onStatus} /> : null}
      {kind === 'loading' ? <Countdown total={LOADING_MS} line="stream.peek.loading" /> : null}
      {kind === 'showing' && !playing ? <CentreLine text={t('stream.peek.unavailable')} /> : null}
      <View style={styles.honest}>
        <Text variant="metricUnit" numberOfLines={1} style={styles.ink}>
          {t('stream.peek.honest')}
        </Text>
      </View>
      {kind === 'showing' ? <Countdown total={SHOWING_MS} line="stream.peek.closesIn" /> : null}
    </>
  );
});

type CountdownProps = {
  readonly total: number;
  readonly line: 'stream.peek.loading' | 'stream.peek.closesIn';
};

/** Whole seconds down from the phase's length, one tick a second. Its own state, so only it re-renders (AGENTS §8). */
const Countdown = memo(function Countdown({ total, line }: CountdownProps) {
  const { t } = useT();
  const seconds = useSecondsLeft(total / 1000);
  const text = t(line, { seconds });
  return line === 'stream.peek.loading' ? (
    <CentreLine text={text} />
  ) : (
    <View style={styles.closesIn}>
      <Text variant="metricUnit" style={styles.count}>
        {text}
      </Text>
    </View>
  );
});

/** Never shows 0: the hook's timer closes the phase as the last second ends. */
function useSecondsLeft(from: number): number {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    const tick = setInterval(() => setLeft((was) => Math.max(1, was - 1)), 1000);
    return () => clearInterval(tick);
  }, []);
  return left;
}

const CentreLine = memo(function CentreLine({ text }: { readonly text: string }) {
  return (
    <View style={styles.centre}>
      <Text variant="body" style={styles.line}>
        {text}
      </Text>
    </View>
  );
});

// RN 0.86 types only `absoluteFill`; `absoluteFillObject` is gone.
const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, backgroundColor: colour.stage },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
    backgroundColor: colour.ground,
  },
  line: { textAlign: 'center' },
  honest: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colour.ground,
  },
  ink: { color: colour.ink },
  closesIn: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colour.ground,
  },
  count: { color: colour.ink, fontVariant: ['tabular-nums'] },
});
```

A `Countdown` keyed by phase restarts when the phase changes, because loading and showing render different elements. `CentreLine`'s `text` prop is a string, so memo skips on equal strings.

- [ ] **Step 9: The stage.** In `src/ui/components/StreamStage.tsx`:
  - replace `import type { Peek } from '@/hooks/usePeek';` with `import type { ViewerCheckView } from '@/hooks/useViewerCheck';`;
  - delete the `StageVideo` and `selectPlaybackUrl` imports;
  - add `import { ViewerCover } from '@/ui/components/ViewerCover';`;
  - `StageProps.peek` becomes `readonly viewer: ViewerCheckView;`, with the doc `/** What viewers see (D2 §4.3): open over the camera box, or idle. */`;
  - render `<CameraBox size={box} viewer={props.viewer} />`;
  - `CameraBox` becomes:

```tsx
type CameraBoxProps = {
  /** Null until the half is measured. */
  readonly size: BoxSize | null;
  readonly viewer: ViewerCheckView;
};

/**
 * The shot. Its own memo, so a status line that changes every second re-renders the strip beneath it and never the
 * preview or the viewers' video (M7, AGENTS §8). The viewers' feed is read here for the whole broadcast, so its first
 * window is timed from the start of live, whether or not the view is open; its player exists only while it is.
 */
const CameraBox = memo(function CameraBox({ size, viewer }: CameraBoxProps) {
  const { surfaces } = usePorts();
  const open = viewer.kind !== 'idle';
  const viewers = useViewerFeed(open, open);
  const sized = useSizedStyle(size);
  const { Preview } = surfaces;
  return (
    <View testID="camera-box" style={[styles.box, sized ?? styles.unmeasured]}>
      {/* CD19: the preview alone, in its own boundary. */}
      <PreviewBoundary>
        <Preview />
      </PreviewBoundary>
      {viewer.kind === 'idle' ? null : (
        <ViewerCover
          kind={viewer.kind}
          feed={viewers}
          onClose={viewer.close}
          onFirstFrame={viewer.firstFrame}
        />
      )}
    </View>
  );
});
```

- in the `StreamStage` doc, "Nothing is drawn over the shot but the viewers' video" now reads "…but What viewers see (the camera box only)", and "the Remote scoring panel (spec §10), which covers the whole half, strip included" stays as written.

- [ ] **Step 10: The column.** In `src/ui/components/StreamColumn.tsx`:
  - the import becomes `import type { ViewerCheckView } from '@/hooks/useViewerCheck';`;
  - `ColumnProps.peek` becomes `readonly viewer: ViewerCheckView;`;
  - in `StreamColumn`, `const { view, viewer } = props;`;
  - the `IconRow` props become `peekable={view.peekable} shed={view.shed} open={viewer.kind !== 'idle'} onPeek={viewer.toggle}`, replacing `peekable` and `peek`;
  - `PeekProps` and `ColumnPeek` become:

```tsx
type PeekProps = {
  readonly onAir: boolean;
  readonly peekable: boolean;
  /** The ladder's first rung (D2 §4.2): any step down disables the view, with its reason. */
  readonly shed: boolean;
  readonly open: boolean;
  readonly onPeek: () => void;
};

/**
 * What viewers see, on air only, and the row's remaining width. Off, with its reason, when the phone is hot (D2 §4.2)
 * or there is no picture (carry 13). Primitives and a stable handler, so memo skips (M7).
 */
const ColumnPeek = memo(function ColumnPeek({ onAir, peekable, shed, open, onPeek }: PeekProps) {
  const { t } = useT();
  if (!onAir) return null;
  const reason = shed ? t('stream.peek.hot') : peekable ? null : t('stream.peek.unavailable');
  return (
    <View testID="peek-cell" style={styles.peekCell}>
      <ViewerPeek disabled={shed || !peekable} reason={reason} open={open} onPress={onPeek} />
    </View>
  );
});
```

- `IconRow` passes `<ColumnPeek onAir={props.onAir} peekable={props.peekable} shed={props.shed} open={props.open} onPeek={props.onPeek} />`.

In `src/ui/components/StreamColumn.test.tsx`:

- replace the `Peek` import and `PEEK` with:

```tsx
import type { ViewerCheckView } from '@/hooks/useViewerCheck';
const VIEWER: ViewerCheckView = {
  kind: 'idle',
  toggle: vi.fn(),
  close: vi.fn(),
  firstFrame: vi.fn(),
};
```

- change every `peek={PEEK}` to `viewer={VIEWER}`;
- add `shed: false,` to `viewOf`'s base;
- add:

```tsx
describe('the peek cell’s reasons (D2 §4.2, carry 13)', () => {
  it('says the phone is hot when the ladder shed, ahead of no picture', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: false,
      shed: true,
    });
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
    expect(screen.getByText('Phone hot')).toBeTruthy();
    expect(screen.queryByText('No viewer picture')).toBeNull();
  });

  it('says there is no viewer picture on air with no playback URL', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: false,
    });
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
    expect(screen.getByText('No viewer picture')).toBeTruthy();
  });
});
```

`plate: 'live'` must be a `TallyPlate` member. Check `src/hooks/useViewfinder.ts`'s import of `TallyPlate` and use the member the file's other on-air rows use.

- [ ] **Step 11: The viewfinder carries the shed.** In `src/hooks/useViewfinder.ts`:
  - import `selectShedding` from `@/hooks/advisory`;
  - add to `Viewfinder`, after `peekable`, `/** The ladder shed (D2 §4.2): What viewers see is closed and disabled. */ readonly shed: boolean;`;
  - in `useViewfinder`, `const shed = useEngineSelector(selectShedding);`, passed into `project({ …, shed })` and added to the `useMemo` deps;
  - `ProjectInput` gains `readonly shed: boolean;`;
  - `project` returns `shed: input.shed,` after `peekable`.

- [ ] **Step 12: The screen.** In `src/ui/screens/StreamScreen.tsx`:
  - delete the `usePeek` import;
  - add `import { useViewerCheck } from '@/hooks/useViewerCheck';`;
  - the body becomes:

```tsx
export function StreamScreen() {
  const leave = useStreamLeave();
  const view = useViewfinder();
  const { settings } = useStreamSettings();
  useEndedToHome(leave.leaveWith);
  const links = useStreamLinks();
  const scoring = useScoringLink(view.plate === 'trouble');
  const scoringOpen = scoring.view.kind !== 'hidden';
  // D2 §4.3: one cover at a time. Opening the view takes the panel down; the panel opening closes the view.
  const viewer = useViewerCheck({
    available: view.peekable,
    shed: view.shed,
    scoringOpen,
    hideScoring: scoring.hide,
  });
  const line = useColumnLine(view, leave.blocked);
  return (
    <View testID="viewfinder" style={settings.side === 'left' ? styles.mirrored : styles.halves}>
      <StreamStage
        line={line.text}
        lineTier={line.tier}
        viewer={viewer}
        scoring={scoring.view}
        scoringSecondsLeft={scoring.secondsLeft}
        onHideScoring={scoring.hide}
      />
      <StreamColumn
        view={view}
        viewer={viewer}
        canLeave={leave.canLeave}
        onHome={leave.leave}
        onSettings={links.settings}
        onScoringLink={scoring.open}
        scoringOpen={scoringOpen}
      />
    </View>
  );
}
```

Then `git rm src/hooks/usePeek.ts`.

- [ ] **Step 13: Re-point the old peek tests.**
  - In `src/hooks/useViewerFeed.test.tsx`, replace every `usePeek` and `pressIn` / `pressOut` drive with a tap on the peek button (`fireEvent.click`). A warm-player test (the player kept 30 s after release) is deleted: there is no warm (D2 §4.3).
  - In `src/ui/screens/StreamScreen.layout.test.tsx`, `pressIn(peek())` becomes `fireEvent.click(peek())`. Its "keeps the overlay and What viewers see inside the narrower box" test keeps its viewers'-video half: the cover (`viewer-cover`) has the camera box's size.
  - Run `git grep -n "usePeek\|PEEK_WARM_MS\|pressIn(peek\|onPressIn={peek" -- src test`. Expected: no hits.

- [ ] **Step 14: Run.** Run: `pnpm vitest run src/ui src/hooks src/i18n`. Expected: PASS.

- [ ] **Step 15: Mutations.**
  1. In `ColumnPeek`, change `disabled={shed || !peekable}` to `disabled={!peekable}`. Run `StreamScreen.viewer.test.tsx`. Expected: FAIL on `the ladder sheds mid-view…` (the final tap opens the cover). Restore.
  2. In `useViewerCheck`'s `useToggle`, delete the `hideScoring();` line. Expected: FAIL on `one cover at a time…`. Restore.

- [ ] **Step 16: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 17: Commit.**

```bash
git add -A src
git commit -m "feat(peek): What viewers see is a tap with a bounded view, one cover at a time, closed by heat (D2 §4.2, §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: C2's reserve: the worst label is 4 × 22 = 88

**Files:**

- Modify:
  - `src/ui/theme/tokens.ts`
  - `src/ui/theme/cameraBox.ts`
  - `src/ui/theme/cameraBox.test.ts`
  - `src/ui/theme/viewfinderFit.test.ts`
  - `src/ui/screens/StreamScreen.layout.test.tsx`

**Interfaces:**

- Produces: `STRIP_RESERVE = 154`. `stripReserve(0)` = 154; `stripReserve(h > 0)` = 66 + h, unchanged.

- [ ] **Step 1: The failing tests, from the spec's table** (spec §4.4: worst 88, reserve 154; 804 × 332 worst 316.4 × 178; 44 dp unchanged at 394.7 × 222).
  - In `src/ui/theme/cameraBox.test.ts`:
    - `LABELS`' third row becomes `['4 lines', layout.labelLinesMax * typeScale.label.lineHeight, 88],`;
    - `'is 88, 110 and 142 for one, two and four lines…'` becomes `'is 88, 110 and 154 for one, two and four lines, written out by hand'` with `.toEqual([88, 110, 154])`;
    - the `STRIP_RESERVE` test becomes `it('is 154: the strip at its worst, C2's four lines at 22, with the round line's room in it', …)` with `expect(STRIP_RESERVE).toBe(16 + 16 + 6 + 88 + 6 + 22); expect(STRIP_RESERVE).toBe(154);`;
    - change the comment above it to "the label at most 4 lines of 22 (88: C2, two lines a side, D2 §4.4)";
    - in the three worst-case `it.each` rows, `142` becomes `154`;
    - `'the worst case is the four lines…'` becomes `expect(stripReserve(88)).toBe(STRIP_RESERVE); expect(STRIP_RESERVE).toBe(FIXED + 88);`;
    - the "taller than the worst case" rows become `['100 dp, a label past the four lines', 100, 166]` and `['120 dp, a label at a large system text size', 120, 186]`, with `expect(height).toBeGreaterThan(88);`;
    - the sweep becomes `for (let height = 1; height <= 88; height += 1)` and `expect(checked).toBe(88);`;
    - in `TABLE`, the four `4 lines` rows become:

```ts
    ['640 x 360, 4 lines', 330, 360, 88, 330, 185.625],
    ['804 x 332, 4 lines', 494, 332, 88, 316.4444444, 178],
    ['804 x 360, 4 lines', 494, 360, 88, 366.2222222, 206],
    ['915 x 412, 4 lines', 605, 412, 88, 458.6666667, 258],
```

    with the comment's "1, 2 and 4 lines of label reserve 88, 110 and 142" changed to "… 88, 110 and 154".

- In `src/ui/theme/viewfinderFit.test.ts`:
  - `LABEL` becomes `const LABEL = layout.labelLinesMax * typeScale.label.lineHeight; // C2 (D2 §4.4): 4 lines at 22, two a side`, and its comment above loses the regular/long sentence;
  - the first test becomes `'the strip is 154 at its worst: 2 × 8 + 16 + 88 + 22 + 2 × 6 (C2, D2 §4.4)'` with `.toEqual([16, 88, 22])` and `.toBe(154)`;
  - in the round-line test, `withoutStage` is `132` and `STRIP_RESERVE` is `154`, and the title becomes `'the round line is in the reserve: 154 dp, 22 over the 132 the strip would be without it (option B, R1)'`.
- In `src/ui/screens/StreamScreen.layout.test.tsx`:
  - `SCREENS` becomes:

```ts
const SCREENS = [
  [640, 360, 330, 330, 185.625],
  [800, 360, 490, 366.2222222, 206],
  [804, 360, 494, 366.2222222, 206],
  [804, 332, 494, 316.4444444, 178],
  [844, 390, 534, 419.5555556, 236],
  [915, 412, 605, 458.6666667, 258],
] as const;
```

    - in that test, `size.height + 142` becomes `size.height + 154`, and the comments that say 142 say 154;
    - `const RESERVE = 142;` becomes `const RESERVE = 154; // C2 (D2 §4.4): 2 × 8 + 16 + 88 + 22 + 2 × 6`;
    - the "before the label is measured" rows become:

```ts
    [640, 360, 330, 185.625, 174.375],
    [804, 332, 316.4444444, 178, 154],
    [804, 360, 366.2222222, 206, 154],
    [915, 412, 458.6666667, 258, 154],
```

      with the title's `142` changed to `154`;
    - `TABLE`'s `'4 long lines', 76` rows become `'4 lines', 88` with boxes `330, 185.625` / `316.4444444, 178` / `366.2222222, 206` / `458.6666667, 258`;
    - `SEQUENCES[0]`'s long box becomes `{ width: 316.4444444, height: 178 }`, and in the sequence `height: 76` becomes `height: 88`;
    - in `roundLineIn`'s `ROWS`, every `76` label becomes `88` with strip `154` (`[640, 360, 88, 174.375]`, `[804, 332, 88, 154]`, `[800, 360, 88, 154]`, `[915, 412, 88, 154]`);
    - `'does not yield to a label of any height (22, 44, 57, 76 dp)'` becomes `(22, 44, 57, 88 dp)` with `[22, 44, 57, 88]`;
    - line 873's comment "the strip's 142 leaves a box 218 tall, 387.6 wide" is rewritten with 154, and its numbers if the test asserts them: for a 480 half at 360 that is 206 tall, 366.2 wide.

The CASES-driven "label stays inside its reserved lines" describe (1263+) is Task 11's.

- [ ] **Step 2: Run them to see them fail.** Run: `pnpm vitest run src/ui/theme/cameraBox.test.ts src/ui/theme/viewfinderFit.test.ts src/ui/screens/StreamScreen.layout.test.tsx`. Expected: FAIL. The reserve is still 142.

- [ ] **Step 3: Implement.**
  - In `src/ui/theme/cameraBox.ts`:

```ts
/**
 * The label at its worst, whatever the width (C2, D2 §4.4): two sides of at most 2 lines each, at the one `label` size,
 * 4 × 22 = 88. A label that does not split into sides is one row of at most 2 lines, so never the worst.
 */
const WORST_LABEL = layout.labelLinesMax * typeScale.label.lineHeight;
```

    In the `stripReserve` doc, "the larger of the label's two size rules" becomes "C2's four lines at 22".

- In `src/ui/theme/tokens.ts`, replace the `labelLinesMax` / `labelLinesRegular` pair with:

```ts
  /** Lines the strip reserves for the label: C2's two sides of at most `labelSideLines` each (D2 §4.4). */
  labelLinesMax: 4,
  /** C2: each side wraps to at most 2 lines and ends in an ellipsis beyond that. */
  labelSideLines: 2,
  /** C2: the left margin the decorative v sits in, outside both rows. */
  labelMargin: 14,
  /** C2: each side's bar, at its row's left edge. */
  labelBar: 3,
  /** C2: the gap between a side's bar and its names. */
  labelBarGap: 5,
```

`labelLinesRegular` has three readers: `cameraBox.ts` (rewritten above), `viewfinderFit.test.ts` (Step 1) and `MatchLabel` (none). Confirm with `git grep -n labelLinesRegular` that no reader is left.

- [ ] **Step 4: Run.** Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Mutation (Review Focus 4, the reserve half).** Back up `tokens.ts` with `cp`. Set `labelLinesMax: 3`. Run `pnpm vitest run src/ui/theme/cameraBox.test.ts`. Expected: FAIL on `804 x 332, 4 lines` (the box would be 355.6 × 200). Restore.

- [ ] **Step 6: The gate.** Run: `pnpm check`. Expected: EXIT=0. `labelLong` is still used by `MatchLabel` until Task 11, so the type role stays for now.

- [ ] **Step 7: Commit.**

```bash
git add src/ui
git commit -m "feat(strip): C2's reserve, the worst label is 4 × 22 = 88 and the strip 154 (D2 §4.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: C2's drawing: a bar a side, a margin v, one size

**Files:**

- Modify:
  - `src/domain/session/matchLabel.ts`
  - `src/domain/session/matchLabel.test.ts`
  - `test/fixtures/matchLabelCases.ts`
  - `src/ui/components/MatchLabel.tsx`
  - `src/ui/components/MatchLabel.test.tsx`
  - `src/ui/components/StageLine.tsx`
  - `src/ui/components/StageLine.test.tsx`
  - `src/ui/theme/type.ts`
  - `src/ui/screens/StreamScreen.layout.test.tsx` (the label-lines describe, 1263+)

**Interfaces:**

- Produces:
  - `type MatchLabel = { kind: 'block'; text: string } | { kind: 'sides'; a: string; b: string }`;
  - `splitMatchLabel(label)`;
  - `SIDES`, `PARTNERS`.
- Removed: `labelSize`, `LONG_LINE_OVER`, `LabelPart`, the `labelLong` type role.

- [ ] **Step 1: The fixture, C2's shapes.** Replace `test/fixtures/matchLabelCases.ts`:

```ts
/**
 * The match label's shapes under C2 (D2 §4.4): one string per side, partners joined by " / " as typed (an empty
 * partner dropped), or one block when the label has no two sides. Every expectation is written out by hand from the
 * spec's rule text, never read from the module under test. Shared by the domain test, the component's test and the
 * layout test.
 */
export const CASES = [
  ['short singles', 'Ana Ruiz v Bea Lima', { kind: 'sides', a: 'Ana Ruiz', b: 'Bea Lima' }],
  [
    'long singles',
    'Alexandra Konstantinopoulou v Maria Fernanda Albuquerque',
    { kind: 'sides', a: 'Alexandra Konstantinopoulou', b: 'Maria Fernanda Albuquerque' },
  ],
  [
    'doubles',
    'Ana Ruiz / Bea Lima v Cai Wen / Dee Roy',
    { kind: 'sides', a: 'Ana Ruiz / Bea Lima', b: 'Cai Wen / Dee Roy' },
  ],
  [
    'long doubles',
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    {
      kind: 'sides',
      a: 'Alexandra Konstantinopoulou / Bea Lima',
      b: 'Cai Wen / Maria Fernanda Albuquerque Santos',
    },
  ],
  ['Match {n}', 'Match 4', { kind: 'block', text: 'Match 4' }],
  ['two " v "', 'Ana v Bea v Cai', { kind: 'sides', a: 'Ana', b: 'Bea v Cai' }],
  [
    'the 200-char maximum',
    `${'A'.repeat(98)} v ${'B'.repeat(99)}`,
    { kind: 'sides', a: 'A'.repeat(98), b: 'B'.repeat(99) },
  ],
  [
    'partners on one side only',
    'Ana Ruiz v Cai Wen / Dee Roy',
    { kind: 'sides', a: 'Ana Ruiz', b: 'Cai Wen / Dee Roy' },
  ],
  [
    'three partners on a side',
    'Ana / Bea / Cai v Dee Roy',
    { kind: 'sides', a: 'Ana / Bea / Cai', b: 'Dee Roy' },
  ],
  ['an empty partner dropped', 'Ana /  / Bea v Cai', { kind: 'sides', a: 'Ana / Bea', b: 'Cai' }],
  ['an empty side is one block', ' v Bea', { kind: 'block', text: 'v Bea' }],
  ['an empty label', '', { kind: 'block', text: '' }],
  [
    'a team name with emoji',
    'Ana Ruiz v Los Volantes de Sevilla 🏸🏸',
    { kind: 'sides', a: 'Ana Ruiz', b: 'Los Volantes de Sevilla 🏸🏸' },
  ],
] as const;
```

The empty-side row: `' v Bea'.indexOf(' v ')` is 0, so side A is `''`. A label with an empty side is one block of the trimmed label, which is `'v Bea'`.

- [ ] **Step 2: The failing domain test.** Replace `src/domain/session/matchLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitMatchLabel } from '@/domain/session/matchLabel';
import { CASES } from '../../../test/fixtures/matchLabelCases';

describe('splitMatchLabel (C2, D2 §4.4)', () => {
  it.each(CASES)('%s', (_name, label, shape) => {
    expect(splitMatchLabel(label)).toEqual(shape);
  });

  it('has thirteen cases, both shapes among them (anti-vacuity)', () => {
    expect(CASES).toHaveLength(13);
    expect(CASES.filter(([, , shape]) => shape.kind === 'block')).toHaveLength(3);
  });
});
```

- [ ] **Step 3: The failing component test.** Replace `src/ui/components/MatchLabel.test.tsx`:

```tsx
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { layout } from '@/ui/theme/tokens';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { pairCode } from '../../../test/pairCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

function renderLabel(label: string) {
  const view = renderWithPorts(<MatchLabel />);
  act(() => {
    pairCode(view.engine, savedStreamCode());
    view.engine.setPairing({ label });
  });
  return view;
}

/** What a line may take: react-native-web renders `numberOfLines` as `-webkit-line-clamp` (1 renders as nowrap). */
const linesAllowed = (line: Element) => {
  const style = getComputedStyle(line);
  return style.whiteSpace === 'nowrap'
    ? 1
    : Number(style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp'));
};

describe('MatchLabel, C2 (D2 §4.4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('two sides: a row each with a bar, lime first and lilac second, and one decorative v', () => {
    renderLabel('Ana Ruiz v Bea Lima');
    const rows = screen.getAllByTestId('match-label-line');
    expect(rows.map((row) => row.textContent)).toEqual(['Ana Ruiz', 'Bea Lima']);
    const bars = screen.getAllByTestId('match-label-bar');
    expect(bars.map((bar) => bar.dataset.side)).toEqual(['first', 'second']);
    expect(screen.getAllByTestId('match-label-v')).toHaveLength(1);
  });

  it('caps each side at 2 lines, ending in an ellipsis (Review Focus 4)', () => {
    renderLabel(
      'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    );
    for (const row of screen.getAllByTestId('match-label-line')) {
      expect(linesAllowed(row)).toBe(layout.labelSideLines);
      expect(layout.labelSideLines).toBe(2);
    }
  });

  it('one side only: one row, no bar and no v', () => {
    renderLabel('Match 4');
    expect(screen.getAllByTestId('match-label-line').map((row) => row.textContent)).toEqual([
      'Match 4',
    ]);
    expect(screen.queryAllByTestId('match-label-bar')).toHaveLength(0);
    expect(screen.queryByTestId('match-label-v')).toBeNull();
  });

  it('doubles: each side in full, partners joined by " / "', () => {
    renderLabel('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy');
    expect(screen.getAllByTestId('match-label-line').map((row) => row.textContent)).toEqual([
      'Ana Ruiz / Bea Lima',
      'Cai Wen / Dee Roy',
    ]);
  });

  it('an empty label draws nothing', () => {
    renderLabel('');
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  it('reads the label once, whole, to a screen reader; the v is hidden from it', () => {
    renderLabel('Ana Ruiz v Bea Lima');
    expect(screen.getByTestId('match-label').getAttribute('aria-label')).toBe(
      'Ana Ruiz v Bea Lima',
    );
    expect(screen.getByTestId('match-label-v').getAttribute('aria-hidden')).toBe('true');
  });

  it.each(CASES)('%s: at most 4 lines in all, 2 a side, one size', (_name, label, shape) => {
    renderLabel(label);
    if (shape.kind === 'block' && shape.text === '') return;
    const root = screen.getByTestId('match-label');
    const lines = [...root.querySelectorAll('[data-testid="match-label-line"]')];
    expect(lines).toHaveLength(shape.kind === 'sides' ? 2 : 1);
    expect(lines.reduce((sum, line) => sum + linesAllowed(line), 0)).toBeLessThanOrEqual(4);
    expect(new Set(lines.map((line) => getComputedStyle(line).fontSize))).toEqual(
      new Set(['20px']),
    );
    within(root);
  });
});
```

Before writing the `linesAllowed` helper, read how `StreamScreen.layout.test.tsx` defines its own `linesAllowed`, and use that one: export it from a shared test helper if it is local. The above is the shape. Read `renderLabel`'s pairing helpers from the old `MatchLabel.test.tsx` before replacing it, and keep its way of putting a label on the engine if it differs.

- [ ] **Step 4: Run them to see them fail.** Run: `pnpm vitest run src/domain/session/matchLabel.test.ts src/ui/components/MatchLabel.test.tsx`. Expected: FAIL. The shapes differ, and there are no bars.

- [ ] **Step 5: The domain.** Replace `src/domain/session/matchLabel.ts`:

```ts
/**
 * The match label as the viewfinder's status strip shows it (spec §2, C2: D2 §4.4). The descriptor carries one joined
 * string, `"{side A} v {side B}"` or `"Match {n}"`; there are no side or partner fields, so the split is here. C2 draws
 * one size, so there is no size rule.
 */

/** Sides split on the first of these. */
export const SIDES = ' v ';
/** Partners within a side split on every one of these, and are joined by it again. */
export const PARTNERS = ' / ';

export type MatchLabel =
  | { readonly kind: 'block'; readonly text: string }
  | { readonly kind: 'sides'; readonly a: string; readonly b: string };

/** A side's names in full (C2: doubles names are not cut short), partners joined by `" / "`, an empty piece dropped. */
function side(text: string): string {
  return text
    .split(PARTNERS)
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .join(PARTNERS);
}

/**
 * Split on the first `" v "`. A label with none, or with nothing on one side of it, is one block: a side is never
 * shown empty, and a block draws as one row with no bar and no v.
 */
export function splitMatchLabel(label: string): MatchLabel {
  const at = label.indexOf(SIDES);
  const a = at < 0 ? '' : side(label.slice(0, at));
  const b = at < 0 ? '' : side(label.slice(at + SIDES.length));
  if (a === '' || b === '') return { kind: 'block', text: label.trim() };
  return { kind: 'sides', a, b };
}
```

- [ ] **Step 6: The component.** Replace `SplitLabel`, `Lines`, the marker and the styles in `src/ui/components/MatchLabel.tsx`. Keep `MatchLabel` and the height-reporting refs as they are.

```tsx
import { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { SIDES, splitMatchLabel } from '@/domain/session/matchLabel';
import { selectLabel } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import { colour, layout } from '@/ui/theme/tokens';

/**
 * The match label, C2 (D2 §4.4): one row per side, each with a 3 dp bar at its left edge (lime for the first side,
 * lilac for the second), the names in Barlow Condensed 600, mixed case, as typed, at one size, at most 2 lines a side
 * and an ellipsis beyond. A small v in ink2 sits in a fixed left margin outside both rows, centred between them. It
 * is decorative: a screen reader reads the label once, as typed. A label with no two sides is one row, no bar, no v.
 * Nothing at all until the label is known, or when it is empty.
 *
 * `onLayoutHeight` (R-F5) tells the stage how tall the label came out, which is how the picture is sized from this
 * match (`stripReserve`): the height after each layout, and 0 when the label goes or changes.
 */
export function MatchLabel({ onLayoutHeight }: { onLayoutHeight?: (height: number) => void }) {
  const label = useEngineSelector(selectLabel);
  // Keyed on its text: a label that changes in place is a new label, so the old one's height goes with it.
  return label === null || label.trim() === '' ? null : (
    <SplitLabel key={label} label={label} onLayoutHeight={onLayoutHeight} />
  );
}

function SplitLabel({
  label,
  onLayoutHeight,
}: {
  label: string;
  onLayoutHeight?: (height: number) => void;
}) {
  const latest = useRef(onLayoutHeight);
  useEffect(() => {
    latest.current = onLayoutHeight;
  });
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => latest.current?.(event.nativeEvent.layout.height),
    [],
  );
  useEffect(() => () => latest.current?.(0), []);
  const split = splitMatchLabel(label);
  return (
    // One accessible stop that reads the whole label as typed (review M4).
    <View {...marker(split.kind)} accessible accessibilityLabel={label} onLayout={onLayout}>
      {split.kind === 'block' ? <Name text={split.text} /> : <Sides a={split.a} b={split.b} />}
    </View>
  );
}

const Sides = memo(function Sides({ a, b }: { readonly a: string; readonly b: string }) {
  return (
    <View style={styles.sides}>
      <View style={styles.margin}>
        {/* The label's own separator, the server's word: decorative, so hidden from a screen reader. */}
        <Text variant="metricUnit" style={styles.v} aria-hidden testID="match-label-v">
          {SIDES.trim()}
        </Text>
      </View>
      <View style={styles.rows}>
        <SideRow text={a} side="first" />
        <SideRow text={b} side="second" />
      </View>
    </View>
  );
});

const SideRow = memo(function SideRow({
  text,
  side,
}: {
  readonly text: string;
  readonly side: 'first' | 'second';
}) {
  return (
    <View style={styles.row}>
      <View {...barMarker(side)} style={side === 'first' ? firstBar : secondBar} />
      <Name text={text} />
    </View>
  );
});

/** One side, or the block: one size, at most 2 lines, an ellipsis beyond (C2). */
const Name = memo(function Name({ text }: { readonly text: string }) {
  return (
    <Text
      variant="label"
      numberOfLines={layout.labelSideLines}
      style={styles.name}
      testID="match-label-line"
    >
      {text}
    </Text>
  );
});

/**
 * The test markers. react-native-web renders `dataSet` as `data-*` attributes, which tests read; native ignores it.
 * React Native's own types leave `dataSet` out, hence the casts.
 */
const marker = (kind: string) => ({ testID: 'match-label', dataSet: { kind } }) as ViewProps;
const barMarker = (side: string) => ({ testID: 'match-label-bar', dataSet: { side } }) as ViewProps;

const styles = StyleSheet.create({
  sides: { flexDirection: 'row' },
  // The v's margin: fixed, outside both rows, the v centred between them.
  margin: { width: layout.labelMargin, justifyContent: 'center' },
  v: { color: colour.ink2 },
  rows: { flex: 1 },
  row: { flexDirection: 'row', gap: layout.labelBarGap },
  bar: { width: layout.labelBar },
  barFirst: { backgroundColor: colour.lime },
  barSecond: { backgroundColor: colour.ink3 },
  name: { flex: 1 },
});

const firstBar = [styles.bar, styles.barFirst];
const secondBar = [styles.bar, styles.barSecond];
```

The `Text` component must pass `aria-hidden` through. Read `src/ui/components/Text.tsx`: if its props type does not take `aria-hidden`, use `importantForAccessibility="no-hide-descendants"` with `accessibilityElementsHidden`, the props the file already allows, and change the test's assertion to the attribute react-native-web renders for them. The `{...marker(…)}` spread on a `View` is the existing pattern.

- [ ] **Step 7: The round line in lime caps.** In `src/ui/components/StageLine.tsx`:

```tsx
import { StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';

/**
 * The round line (spec §2): the server's text, one line, never translated or built here. C2 (D2 §4.4): lime and caps,
 * at its existing role and slot, so the strip's fixed 66 dp is unchanged.
 */
export function StageLine({ text }: { text: string }) {
  return (
    <Text variant="metricUnit" numberOfLines={1} style={styles.round} testID="stage-line">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({ round: { color: colour.lime, textTransform: 'uppercase' } });
```

In `StageLine.test.tsx`, any colour assertion becomes lime (`colour.lime`), and add `expect(getComputedStyle(screen.getByTestId('stage-line')).textTransform).toBe('uppercase');`. The text content stays the server's, unchanged. jsdom reports the CSS, not the drawn caps.

- [ ] **Step 8: Drop the long size.** In `src/ui/theme/type.ts`, delete the `labelLong` role. Run `git grep -n "labelLong\|labelSize\|LONG_LINE_OVER\|LabelPart" -- src test`. Expected: only the layout test's describe, fixed next.

- [ ] **Step 9: The layout test's label-lines describe.** In `src/ui/screens/StreamScreen.layout.test.tsx`, replace the describe at 1263+ (`the match label stays inside its reserved lines`) with:

```tsx
/** C2 (D2 §4.4): every label the family holds is at most 4 lines, 2 a side, at the one 22 dp line. */
describe('the match label stays inside its reserved lines (C2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  let seen = 0;

  it.each(CASES)('%s: at most 4 lines, 88 dp', async (_name, label, shape) => {
    await renderViewfinder({}, { prepare: (fakes) => fakes.engine.setPairing({ label }) });
    if (shape.kind === 'block' && shape.text === '') {
      expect(within(byId('status-strip')).queryByTestId('match-label')).toBeNull();
      seen += 1;
      return;
    }
    const root = within(byId('status-strip')).getByTestId('match-label');
    const lines = [...root.querySelectorAll('[data-testid="match-label-line"]')];
    const allowed = lines.reduce((sum, line) => sum + linesAllowed(line), 0);
    expect(allowed).toBeLessThanOrEqual(4);
    expect(
      allowed * parseFloat(getComputedStyle(lines[0] as Element).lineHeight),
    ).toBeLessThanOrEqual(88);
    seen += 1;
  });

  it('swept all thirteen labels (anti-vacuity)', () => {
    expect(CASES).toHaveLength(13);
    expect(seen).toBe(13);
  });
});
```

- [ ] **Step 10: Run.** Run: `pnpm vitest run src/domain/session/matchLabel.test.ts src/ui/components/MatchLabel.test.tsx src/ui/components/StageLine.test.tsx src/ui/screens/StreamScreen.layout.test.tsx src/ui/theme`. Expected: PASS.

- [ ] **Step 11: Mutation (Review Focus 4, the cap).** Back up `tokens.ts` with `cp`. Set `labelSideLines: 4`. Run `pnpm vitest run src/ui/components/MatchLabel.test.tsx src/ui/screens/StreamScreen.layout.test.tsx`. Expected: FAIL on `caps each side at 2 lines…` and on `long doubles: at most 4 lines, 88 dp` (8 lines allowed). Restore.

- [ ] **Step 12: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 13: Commit.**

```bash
git add -A src test
git commit -m "feat(strip): match info C2, a bar a side, a margin v, one size and two lines a side (D2 §4.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: C2 measured: what a row holds at 494 dp and at 640 × 360

**Files:**

- Create: `src/ui/theme/matchLabelFit.test.ts`

**Interfaces:**

- Consumes: `layout.labelMargin`, `labelBar`, `labelBarGap`, `stripPadH` (Task 10); `CASES` (Task 11); `test/fontMetrics.ts`.

- [ ] **Step 1: Write the measurement** `src/ui/theme/matchLabelFit.test.ts`. The widths were measured on 2026-10-09 with the shipped Barlow Condensed 600 at 20, no kerning, and are pinned as measured:

```ts
import { describe, expect, it } from 'vitest';
import { layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

/**
 * C2 (D2 §4.4), measured: a side's row is the camera half less the strip's padding, the v's margin, the bar and its
 * gap. The owner's phone's half is 494 (804 less the 310 controls half); 640 × 360's is 330. Widths are the shipped
 * font's advances, which over-state a phone's slightly (no kerning). Real names on staging are D3's to read (PD5).
 */
const barlow600 = loadFont('barlow-condensed-600');
const width = (text: string) => barlow600.width(text, typeScale.label.fontSize);
const rowWidth = (half: number) =>
  half - 2 * layout.stripPadH - layout.labelMargin - layout.labelBar - layout.labelBarGap;
const fits = (char: string, row: number) => {
  let count = 0;
  while (width(char.repeat(count + 1)) <= row) count += 1;
  return count;
};

function linesOf(text: string, room: number): number {
  let lines = 1;
  let current = '';
  for (const piece of text.split(' ')) {
    const next = current === '' ? piece : `${current} ${piece}`;
    if (current === '' || width(next) <= room) current = next;
    else {
      lines += 1;
      current = piece;
    }
  }
  return lines;
}

describe('a C2 side’s row, measured (D2 §4.4)', () => {
  it('is 440 dp on the owner’s phone (a 494 half) and 276 at 640 × 360 (a 330 half): about 22 dp under the old line', () => {
    expect(rowWidth(494)).toBe(440);
    expect(rowWidth(330)).toBe(276);
    expect(layout.labelMargin + layout.labelBar + layout.labelBarGap).toBe(22);
  });

  it('holds 50 n, 40 M or 33 W on one line at 494, and 31, 25 or 20 at 640 × 360', () => {
    expect(['n', 'M', 'W'].map((char) => fits(char, rowWidth(494)))).toEqual([50, 40, 33]);
    expect(['n', 'M', 'W'].map((char) => fits(char, rowWidth(330)))).toEqual([31, 25, 20]);
  });

  it.each([
    ['Ana Ruiz', 1, 1],
    ['Alexandra Konstantinopoulou', 1, 1],
    ['Ana Ruiz / Bea Lima', 1, 1],
    ['Alexandra Konstantinopoulou / Bea Lima', 1, 2],
    ['Cai Wen / Maria Fernanda Albuquerque Santos', 1, 2],
  ] as const)('“%s” is %i line(s) at 494 and %i at 640 × 360', (side, at494, at640) => {
    expect([linesOf(side, rowWidth(494)), linesOf(side, rowWidth(330))]).toEqual([at494, at640]);
  });

  it('so the long doubles label is 2 × 22 = 44 on the owner’s phone, the 394.7 × 222 picture, and 4 × 22 = 88 at 640', () => {
    const lines = (half: number) =>
      linesOf('Alexandra Konstantinopoulou / Bea Lima', rowWidth(half)) +
      linesOf('Cai Wen / Maria Fernanda Albuquerque Santos', rowWidth(half));
    expect(lines(494) * typeScale.label.lineHeight).toBe(44);
    expect(lines(330) * typeScale.label.lineHeight).toBe(88);
  });
});
```

- [ ] **Step 2: Run.** Run: `pnpm vitest run src/ui/theme/matchLabelFit.test.ts`. Expected: PASS. A failing number means the fonts or the tokens differ from 2026-10-09's. Report it rather than re-pin: the spec's reserve table rests on these.

- [ ] **Step 3: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 4: Commit.**

```bash
git add src/ui/theme/matchLabelFit.test.ts
git commit -m "test(strip): C2 rows measured at 494 dp and 640 × 360 (D2 §4.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: `ScreenPort` over `expo-brightness`

**Files:**

- Modify:
  - `package.json`
  - `pnpm-lock.yaml` (by `pnpm expo install`)
  - `app.json`
  - `src/services/devicePorts.ts`
  - `src/hooks/usePorts.tsx`
  - `src/hooks/nativePorts.ts`
  - `test/fakePorts.ts`
  - `test/fakePorts.test.ts`
- Create:
  - `src/services/native/nativeScreen.ts`
  - `src/services/native/nativeScreen.test.ts`

**Interfaces:**

- Produces:
  - `interface ScreenPort { dim(): void; restore(): void }`;
  - `Ports.screen: ScreenPort`;
  - `createNativeScreen({ logger, os, load? })`;
  - `DIM_BRIGHTNESS = 0.1`;
  - `FakePorts.screen: FakeScreen` (`calls`, `dimmed`).

- [ ] **Step 1: Install, at Expo's pin.** Run each in its own call:
  1. `pnpm expo install expo-brightness`. Expected: `expo-brightness` `~57.0.1` in `package.json` (`node_modules/expo/bundledNativeModules.json:30`).
  2. `git diff app.json`. If `expo install` added `"expo-brightness"` to `plugins`, remove it (PD3).
  3. Read `node_modules/expo-brightness/package.json`. Expected `peerDependencies`: `expo` and `react-native` only, no other native package (AGENTS §13, class 4). Record it in the report.

  Add to `app.json`'s `android` object, after `"predictiveBackGestureEnabled": false`:

```json
      "blockedPermissions": ["android.permission.WRITE_SETTINGS"]
```

This is PD3. Prebuild's legacy auto-plugin adds that permission for any autolinked `expo-brightness`. We set only the window's brightness, which needs none. Run `pnpm prettier --check app.json`.

- [ ] **Step 2: The failing tests.** Create `src/services/native/nativeScreen.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createNativeScreen, DIM_BRIGHTNESS } from '@/services/native/nativeScreen';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function brightness() {
  return {
    getBrightnessAsync: vi.fn(async () => 0.8),
    setBrightnessAsync: vi.fn(async (_value: number) => undefined),
    restoreSystemBrightnessAsync: vi.fn(async () => undefined),
  };
}

describe('the screen port over expo-brightness (D2 §4.5, R8)', () => {
  it('dims the window to 0.1, never the system setting, and restores the system’s on Android', async () => {
    const module = brightness();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    expect(DIM_BRIGHTNESS).toBe(0.1);
    screen.dim();
    await flush();
    expect(module.setBrightnessAsync).toHaveBeenCalledExactlyOnceWith(0.1);
    screen.restore();
    await flush();
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  it('puts back the brightness it found on iOS, where restoring the system’s does nothing', async () => {
    const module = brightness();
    const screen = createNativeScreen({ logger, os: 'ios', load: async () => module });
    screen.dim();
    await flush();
    screen.restore();
    await flush();
    expect(module.setBrightnessAsync.mock.calls).toEqual([[0.1], [0.8]]);
    expect(module.restoreSystemBrightnessAsync).not.toHaveBeenCalled();
  });

  it('is idempotent: dim twice is one dim, restore twice is one restore, restore first is nothing', async () => {
    const module = brightness();
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.restore();
    screen.dim();
    screen.dim();
    await flush();
    screen.restore();
    screen.restore();
    await flush();
    expect(module.setBrightnessAsync).toHaveBeenCalledTimes(1);
    expect(module.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
  });

  it('a missing native module is said once and never throws (a guarded port)', async () => {
    const warn = vi.fn();
    const screen = createNativeScreen({
      logger: { ...logger, warn },
      os: 'android',
      load: async () => {
        throw new Error("Cannot find native module 'ExpoBrightness'");
      },
    });
    expect(() => {
      screen.dim();
      screen.restore();
      screen.dim();
    }).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledExactlyOnceWith('screen.unavailable');
  });

  it('runs its calls in order: a restore never lands before the dim it follows', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const module = {
      getBrightnessAsync: async () => 0.8,
      setBrightnessAsync: (value: number) =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push(`set ${value}`);
            resolve();
          };
        }),
      restoreSystemBrightnessAsync: async () => {
        order.push('restore');
      },
    };
    const screen = createNativeScreen({ logger, os: 'android', load: async () => module });
    screen.dim();
    screen.restore();
    await flush();
    release();
    await flush();
    expect(order).toEqual(['set 0.1', 'restore']);
  });
});
```

Match the logger literal to `Logger`, as in Task 1 Step 1.

In `test/fakePorts.test.ts`, add:

```ts
it('records the screen port’s calls, and whether it is dimmed', () => {
  const fakes = createFakePorts();
  fakes.screen.dim();
  fakes.screen.restore();
  expect(fakes.screen.calls).toEqual(['dim', 'restore']);
  expect(fakes.screen.dimmed).toBe(false);
  expect(fakes.ports.screen).toBe(fakes.screen);
});
```

- [ ] **Step 3: Run them to see them fail.** Run: `pnpm vitest run src/services/native/nativeScreen.test.ts test/fakePorts.test.ts`. Expected: FAIL (module not found, no `screen`).

- [ ] **Step 4: The port.** Append to `src/services/devicePorts.ts`:

```ts
/**
 * The app window's own brightness (D2 §4.5, R8), never the system setting. `dim` and `restore` are intents: each
 * returns at once, does nothing when already in that state, and never throws, so a phone without the module only
 * stays bright.
 */
export interface ScreenPort {
  dim(): void;
  restore(): void;
}
```

Create `src/services/native/nativeScreen.ts`:

```ts
import type { ScreenPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/** R8 (spec §4.5, _rec_): the window's brightness while dimmed. */
export const DIM_BRIGHTNESS = 0.1;

/** The three calls this port makes. */
type Brightness = {
  getBrightnessAsync(): Promise<number>;
  setBrightnessAsync(value: number): Promise<void>;
  restoreSystemBrightnessAsync(): Promise<void>;
};

/**
 * expo-brightness, loaded on first use: a binary without its native half throws on import, and a static import would
 * take the app down at boot instead of only leaving the screen bright (as `useKeepAwake` does). Calls run one at a
 * time, in order, so a restore never lands before the dim it follows. On Android, restore hands the window back to the
 * system's brightness; on iOS that call does nothing, so the brightness found before dimming is put back.
 */
export function createNativeScreen(deps: {
  readonly logger: Logger;
  readonly os: string;
  readonly load?: () => Promise<Brightness>;
}): ScreenPort {
  const load = deps.load ?? (() => import('expo-brightness'));
  let dimmed = false;
  let found: number | null = null;
  let warned = false;
  let queue: Promise<void> = Promise.resolve();
  const run = (step: (module: Brightness) => Promise<void>) => {
    queue = queue
      .then(load)
      .then(step)
      .catch(() => {
        if (warned) return;
        warned = true;
        deps.logger.warn('screen.unavailable');
      });
  };
  return {
    dim: () => {
      if (dimmed) return;
      dimmed = true;
      run(async (module) => {
        found = await module.getBrightnessAsync();
        await module.setBrightnessAsync(DIM_BRIGHTNESS);
      });
    },
    restore: () => {
      if (!dimmed) return;
      dimmed = false;
      run((module) =>
        deps.os === 'android'
          ? module.restoreSystemBrightnessAsync()
          : module.setBrightnessAsync(found ?? 1),
      );
    },
  };
}
```

In `src/hooks/usePorts.tsx`, add `ScreenPort` to the `devicePorts` import, and after `foreground` add:

```ts
  /** The window's brightness: dimmed while paired and idle (D2 §4.5). */
  readonly screen: ScreenPort;
```

In `src/hooks/nativePorts.ts`, import `Platform` from `react-native` and `createNativeScreen` from `@/services/native/nativeScreen`, and after `foreground: createNativeForeground(),` add:

```ts
    screen: createNativeScreen({ logger, os: Platform.OS }),
```

In `test/fakePorts.ts`:

- add `ScreenPort` to the `devicePorts` import;
- add `readonly screen: FakeScreen;` to `FakePorts`;
- add `screen: fakeScreen(),` to `fakes`;
- add:

```ts
export type FakeScreen = ScreenPort & {
  /** Every call, in order. */
  readonly calls: readonly ('dim' | 'restore')[];
  readonly dimmed: boolean;
};

function fakeScreen(): FakeScreen {
  const calls: ('dim' | 'restore')[] = [];
  let dimmed = false;
  return {
    calls,
    dim: () => {
      calls.push('dim');
      dimmed = true;
    },
    restore: () => {
      calls.push('restore');
      dimmed = false;
    },
    get dimmed() {
      return dimmed;
    },
  };
}
```

- [ ] **Step 5: Run.** Run: `pnpm vitest run src/services/native/nativeScreen.test.ts test/fakePorts.test.ts`. Expected: PASS.

- [ ] **Step 6: Native build, local (needs a prebuild).** Run each in its own call:
  1. `pnpm expo prebuild -p android --no-install`
  2. Revert prebuild's `package.json` scripts hunk.
  3. `rtk proxy grep -n "WRITE_SETTINGS" android/app/src/main/AndroidManifest.xml`. Expected: either no hit, or a `tools:node="remove"` line. The permission is not requested.
  4. `cd android && ./gradlew assembleDebug`. Expected: BUILD SUCCESSFUL.
  5. `pnpm expo-modules-autolinking search --platform android > /tmp/seazn-d2/autolink.txt 2>&1`. Expected: `expo-brightness` is listed, and no other new module. Record it.

- [ ] **Step 7: The gate.** Run: `pnpm check`. Expected: EXIT=0. Lint: `src/services/native/` may import `expo-*`; screens still may not (`UI_NATIVE_IMPORTS`).

- [ ] **Step 8: Commit.**

```bash
git add package.json pnpm-lock.yaml app.json src test
git commit -m "feat(screen): a ScreenPort over the window's brightness, expo-brightness without WRITE_SETTINGS (D2 §4.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: The idle dim: the rule, the hook, the touch, and keep-awake's missing test

**Files:**

- Create:
  - `src/domain/session/idleDim.ts`
  - `src/domain/session/idleDim.test.ts`
  - `src/hooks/useIdleDim.ts`
  - `src/hooks/useIdleDim.test.tsx`
  - `src/ui/components/TouchWake.tsx`
  - `src/ui/components/TouchWake.test.tsx`
  - `src/hooks/useKeepAwake.test.tsx`
- Modify: `app/stream/_layout.tsx`

**Interfaces:**

- Consumes: `ScreenPort` (Task 13), `selectStateKind`, `ForegroundPort`.
- Produces:
  - `IDLE_DIM_MS = 30_000`;
  - `shouldDim(kind, idleMs): boolean`;
  - `useIdleDim(): () => void` (the touch handler);
  - `<TouchWake>`.

- [ ] **Step 1: The rule's failing test** `src/domain/session/idleDim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import type { SessionState } from '@/domain/session/SessionState';

type Kind = SessionState['kind'];
const ALL: readonly Kind[] = [
  'idle',
  'pairing',
  'paired',
  'arming',
  'armed',
  'connecting',
  'publishing',
  'degraded',
  'reconnecting',
  'ended',
];

/** R8 (spec §4.5): only while paired and waiting, after 30 s with no touch. Never armed or live: the tally must read. */
describe('shouldDim', () => {
  it('waits 30 s', () => {
    expect(IDLE_DIM_MS).toBe(30_000);
  });

  it('dims paired after 30 s idle, and not a millisecond before', () => {
    expect(shouldDim('paired', 30_000)).toBe(true);
    expect(shouldDim('paired', 29_999)).toBe(false);
    expect(shouldDim('paired', 0)).toBe(false);
  });

  it.each(ALL.filter((kind) => kind !== 'paired'))('never dims %s, however long idle', (kind) => {
    expect(shouldDim(kind, 3_600_000)).toBe(false);
  });

  it('covers every state kind (anti-vacuity)', () => {
    expect(ALL).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** Run: `pnpm vitest run src/domain/session/idleDim.test.ts`. Expected: FAIL.

- [ ] **Step 3: The rule** `src/domain/session/idleDim.ts`:

```ts
import type { SessionState } from '@/domain/session/SessionState';

/** R8 (spec §4.5): no touch for this long while paired and waiting, and the window dims. */
export const IDLE_DIM_MS = 30_000;

/**
 * Whether the app's window should be dim (D2 §4.5, R4, R8): only while paired and waiting for Go live, after
 * `IDLE_DIM_MS` with no touch. Never armed, live, pairing or ended: the operator must read the tally on air
 * (AGENTS §6, "Red means ON AIR"). The one guard: the hook asks this and nothing else.
 */
export function shouldDim(kind: SessionState['kind'], idleMs: number): boolean {
  return kind === 'paired' && idleMs >= IDLE_DIM_MS;
}
```

Run the test. Expected: PASS.

- [ ] **Step 4: The hook's failing test** `src/hooks/useIdleDim.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleDim } from '@/hooks/useIdleDim';
import { createFakePorts } from '../../test/fakePorts';
import { pairCode } from '../../test/pairCode';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

function mount(paired = true, strict = false) {
  const fakes = createFakePorts();
  if (paired) pairCode(fakes.engine, savedStreamCode());
  const view = renderHook(() => useIdleDim(), {
    wrapper: wrapperFor(fakes),
    reactStrictMode: strict,
  });
  return { ...view, fakes };
}

describe('useIdleDim (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dims after 30 s paired with no touch, and a touch restores it and starts the 30 s again', () => {
    const { result, fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => result.current());
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it.each([
    ['armed', 'armed-not-ready'],
    ['live', 'live'],
    ['ended', 'fatal'],
  ] as const)(
    'restores at once when the engine goes %s, and never dims there (Review Focus 2)',
    (_kind, scene) => {
      const { fakes } = mount();
      act(() => fakes.engine.scene('paired-ready'));
      act(() => vi.advanceTimersByTime(30_000));
      expect(fakes.screen.dimmed).toBe(true);
      act(() => fakes.engine.scene(scene));
      expect(fakes.screen.dimmed).toBe(false);
      act(() => vi.advanceTimersByTime(600_000));
      expect(fakes.screen.dimmed).toBe(false);
    },
  );

  it('restores on unpair', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => fakes.engine.forceState({ kind: 'idle' }));
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('restores when the app leaves the foreground, and counts 30 s afresh on return', () => {
    const { fakes } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => fakes.foreground.leave());
    expect(fakes.screen.dimmed).toBe(false);
    act(() => fakes.foreground.fire());
    act(() => vi.advanceTimersByTime(29_999));
    expect(fakes.screen.dimmed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(fakes.screen.dimmed).toBe(true);
  });

  it('restores when it unmounts: leaving Live Stream', () => {
    const { fakes, unmount } = mount();
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    unmount();
    expect(fakes.screen.dimmed).toBe(false);
  });

  it('never dims an idle engine (no pairing), however long', () => {
    const { fakes } = mount(false);
    act(() => vi.advanceTimersByTime(600_000));
    expect(fakes.screen.calls).toEqual([]);
  });

  it('ends dimmed once under StrictMode’s double effects, and restores once on a touch', () => {
    const { result, fakes } = mount(true, true);
    act(() => fakes.engine.scene('paired-ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(fakes.screen.dimmed).toBe(true);
    act(() => result.current());
    expect(fakes.screen.dimmed).toBe(false);
  });
});
```

`'armed-not-ready'`, `'live'`, `'fatal'` and `'paired-ready'` are in `FAKE_SCENES`. `'fatal'` is `ended`.

- [ ] **Step 5: Run it to see it fail.** Run: `pnpm vitest run src/hooks/useIdleDim.test.tsx`. Expected: FAIL (module not found).

- [ ] **Step 6: The hook** `src/hooks/useIdleDim.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * The idle dim (D2 §4.5, R4, R8): the window dims after 30 s with no touch while paired and waiting, and comes back on
 * any touch, on arming or going live, on unpairing, when the app leaves the foreground and when Live Stream unmounts.
 * The idle timer runs whatever the state; `shouldDim` alone decides, so there is one guard (AGENTS §10). The returned
 * handler is the touch: the stream layout's root calls it on every touch it sees (`TouchWake`). Keep-awake is
 * separate and unchanged (`useKeepAwake`): this only lowers the brightness of a screen that stays on.
 */
export function useIdleDim(): () => void {
  const { screen, foreground } = usePorts();
  const kind = useEngineSelector(selectStateKind);
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const touched = useCallback(() => {
    stop();
    setIdle(false);
    timer.current = setTimeout(() => {
      timer.current = null;
      setIdle(true);
    }, IDLE_DIM_MS);
  }, [stop]);
  const dim = shouldDim(kind, idle ? IDLE_DIM_MS : 0);
  useEffect(() => {
    if (!dim) return undefined;
    screen.dim();
    return () => screen.restore();
  }, [dim, screen]);
  useEffect(() => {
    touched();
    return stop;
  }, [touched, stop]);
  useEffect(
    () =>
      foreground.subscribeBackground(() => {
        stop();
        setIdle(false);
      }),
    [foreground, stop],
  );
  useEffect(() => foreground.subscribe(touched), [foreground, touched]);
  return touched;
}
```

Run the hook test. Expected: PASS.

- [ ] **Step 7: Mutation (Review Focus 2).** Back up `idleDim.ts` with `cp`. Change the body to `return (kind === 'paired' || kind === 'armed') && idleMs >= IDLE_DIM_MS;`. Run `pnpm vitest run src/domain/session/idleDim.test.ts src/hooks/useIdleDim.test.tsx`. Expected: FAIL on `never dims armed…` and on `restores at once when the engine goes armed…`. Restore.

- [ ] **Step 8: The touch.** `src/ui/components/TouchWake.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchWake } from '@/ui/components/TouchWake';
import { pairCode } from '../../../test/pairCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('TouchWake (D2 §4.5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a touch anywhere inside wakes a dimmed screen, and the child still gets the touch', () => {
    const onPress = vi.fn();
    const view = renderWithPorts(
      <TouchWake>
        <Text onPress={onPress} testID="child">
          child
        </Text>
      </TouchWake>,
    );
    act(() => {
      pairCode(view.engine, savedStreamCode());
      view.engine.scene('paired-ready');
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(view.screen.dimmed).toBe(true);
    fireEvent.mouseDown(screen.getByTestId('child'));
    fireEvent.mouseUp(screen.getByTestId('child'));
    fireEvent.click(screen.getByTestId('child'));
    expect(view.screen.dimmed).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

`src/ui/components/TouchWake.tsx`:

```tsx
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIdleDim } from '@/hooks/useIdleDim';

/**
 * The Live Stream route's root (D2 §4.5): every touch in the route, Settings included, restarts the idle dim's 30 s
 * and wakes a dimmed screen. The capture phase sees the touch first and always answers false, so it never takes the
 * touch from the control under the finger.
 */
export function TouchWake({ children }: { children: ReactNode }) {
  const touched = useIdleDim();
  const capture = useCallback(() => {
    touched();
    return false;
  }, [touched]);
  return (
    <View style={styles.root} onStartShouldSetResponderCapture={capture}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
```

If react-native-web 0.21's responder system does not run `onStartShouldSetResponderCapture` for `mouseDown` in jsdom, the test fails. In that case use `fireEvent.touchStart` / `touchEnd` with a `touches: [{ clientX: 0, clientY: 0 }]` init. Do not change the component: the capture handler is what the phone runs. Whether a native-stack screen's touch reaches it on the phone is device-only (D3 row 12: "a touch wakes it").

- [ ] **Step 9: Wire it into the stream layout.** `app/stream/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { TouchWake } from '@/ui/components/TouchWake';

const SCREEN_OPTIONS = { headerShown: false, animation: 'none', gestureEnabled: false } as const;

/**
 * Live Stream's own stack: S1's Settings (its Diagnostics card with it) lives here, so it stays reachable on air
 * (AGENTS §6) while leaving the mode does not. The screen stays on for as long as the engine holds a session, and
 * while paired and waiting it dims after 30 s with no touch anywhere in the route (D2 §4.5).
 */
export default function StreamLayout() {
  useKeepAwake();
  return (
    <TouchWake>
      <Stack screenOptions={SCREEN_OPTIONS} />
    </TouchWake>
  );
}
```

If `routedApp.drift.test.ts` or `test/routedApp.tsx` mirrors this layout, mirror the change there: read both. Dim only in Live Stream: no other layout mounts `TouchWake` or `useIdleDim`. Confirm with `git grep -n "useIdleDim\|TouchWake" -- app src`.

- [ ] **Step 10: Keep-awake's missing test** `src/hooks/useKeepAwake.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { createFakePorts } from '../../test/fakePorts';
import { pairCode } from '../../test/pairCode';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { wrapperFor } from '../../test/renderWithPorts';

const keepAwake = vi.hoisted(() => ({
  activateKeepAwakeAsync: vi.fn(async (_tag?: string) => undefined),
  deactivateKeepAwake: vi.fn(async (_tag?: string) => undefined),
}));
vi.mock('expo-keep-awake', () => keepAwake);

const settle = () => act(async () => {});

/** Spec §4.5: keep-awake is unchanged: on for every state but idle and ended. It never had a test. */
describe('useKeepAwake', () => {
  beforeEach(() => {
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('is off while idle', async () => {
    const fakes = createFakePorts();
    renderHook(() => useKeepAwake(), { wrapper: wrapperFor(fakes) });
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['paired', 'paired-ready'],
    ['armed', 'armed-not-ready'],
    ['live', 'live'],
  ] as const)('is on while %s', async (_kind, scene) => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, savedStreamCode());
    renderHook(() => useKeepAwake(), { wrapper: wrapperFor(fakes) });
    act(() => fakes.engine.scene(scene));
    await settle();
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('seazn-capture-session');
  });

  it('turns off when the session ends', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, savedStreamCode());
    renderHook(() => useKeepAwake(), { wrapper: wrapperFor(fakes) });
    act(() => fakes.engine.scene('live'));
    await settle();
    act(() => fakes.engine.scene('fatal'));
    await settle();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith('seazn-capture-session');
  });
});
```

- [ ] **Step 11: Run.** Run: `pnpm vitest run src/domain/session/idleDim.test.ts src/hooks/useIdleDim.test.tsx src/ui/components/TouchWake.test.tsx src/hooks/useKeepAwake.test.tsx`. Expected: PASS. Mutation: in `useKeepAwake.ts` change `stateKind !== 'ended'` to `true`. Expected: FAIL on `turns off when the session ends`. Restore with `cp`.

- [ ] **Step 12: The gate.** Run: `pnpm check`. Expected: EXIT=0.

- [ ] **Step 13: Commit.**

```bash
git add -A src app test
git commit -m "feat(stream): dim the window after 30 s idle while paired and waiting; keep-awake gets its test (D2 §4.5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Rules, findings and the translation review

**Files:**

- Modify:
  - `AGENTS.md` (§6, §7, §8, §9, §11)
  - `_FINDINGS.md` (N24)
  - `docs/i18n-glossary.md`
  - `src/i18n/{es,fr,nl}.json` (markers)

**Interfaces:** none (docs and copy review).

- [ ] **Step 1: AGENTS §6.** Make these edits:
  - In the viewfinder bullet, "an advisory caption (Not charging, heat, keep the app open, Score ahead, a failed preview) beats only a _routine_ line" becomes "an advisory caption (Not charging, heat, keep the app open) beats only a _routine_ line".
  - "before air a phone warning (Not charging, keep the app open, heat, a failed preview, Score ahead) beats the destination line" becomes "before air a phone warning (Not charging, keep the app open, heat) beats the destination line".
  - "Nothing is drawn over the camera box but the overlay, the _What viewers see_ video and, on the operator's tap, the Remote scoring panel" becomes "Nothing is drawn over the camera box but the _What viewers see_ video and, on the operator's tap, the Remote scoring panel, one at a time (D2 §4.3)".
  - Replace the whole **Press-and-hold is not always a confirmation.** bullet with the spec's text, verbatim:

```markdown
- **What viewers see is a tap.** Its protection against a billed preview left
  running is that it closes by itself 20 s after its first frame, or 3 s after
  telling the operator there is no picture; a tap never extends it. It covers
  the camera box only, and opening it takes the Remote scoring panel down (and
  the reverse): one cover at a time. It closes and is disabled while the ladder
  sheds (§8). While it shows it says "no scoreboard yet": there is no
  compositor, so the viewers' picture has no score (D2 §4.3).
```

- [ ] **Step 2: AGENTS §7 (PD4).** Replace the section body, keeping its heading renamed:

```markdown
## 7. No score on the phone

- The phone draws no score. The score preview (a transparent WebView over the
  camera, the Tier A browser-source route) was removed on the owner's ruling
  of 2026-10-08 (R1, D2 §4.1), with `react-native-webview`. The descriptor
  still sends `overlayUrl`; nothing on the phone reads it.
- **Never reimplement the scorebug in React Native.** That creates a second
  render path and destroys the invariant that a club moving between tiers sees
  identical output. This is the highest-value prohibition in this file.
- What viewers see shows the delivered picture, which has no score until the
  compositor exists; it says so on screen.
```

Then check §2, §3 and §11 for the words "overlay" or "WebView": `rtk proxy grep -n -i "overlay\|webview" AGENTS.md`. Any hit that describes the phone's preview as current is rewritten in the same spirit. Hits about the web's overlay, the compositor or Tier A stay.

- [ ] **Step 3: AGENTS §8.** Replace the **Degradation ladder** list and the thermal paragraph's first rung:

```markdown
**Degradation ladder — in this order, never reordered (D2 §4.2):**

| Step | Wire word           | Thermal status | What happens                                                            |
| ---- | ------------------- | -------------- | ----------------------------------------------------------------------- |
| 1    | `viewer-feed`       | 2              | What viewers see closes if open and is disabled, with a one-line reason |
| 2    | `preview-framerate` | 3              | Reported only. No native code lowers the frame rate yet (N24)           |
| 3    | `encode`            | 4, 5, 6        | Reported only. The encode is last, and ideally never                    |

The ladder only goes down: a shed of step 2 or 3 means step 1 too.
```

In the thermal paragraph, "A hot handset sheds the overlay preview long before it touches the encode" becomes "A hot handset closes What viewers see long before it touches the encode". Keep "The operator's convenience is the cheapest thing on the device. The broadcast is the only thing that matters."

- [ ] **Step 4: AGENTS §9 and §11.** In §9, after the Android bullet, add the spec's text:

```markdown
- While paired and waiting, the screen is kept on and dimmed after 30 s idle;
  this is the default path for a remote Go live. The foreground service and wake
  lock are the Android fallback when the phone is locked anyway (R4, D2 §4.5).
  The dim is the window's own brightness, never the system setting, and never
  when armed or live.
```

In §11, "`expo-sensors` and `expo-screen-orientation` for the orientation gate" becomes "`expo-sensors` and `expo-screen-orientation` for the orientation gate; `expo-brightness` for the idle dim (the window's brightness only: its `WRITE_SETTINGS` permission is blocked in `app.json`)".

- [ ] **Step 5: `_FINDINGS.md` N24.** Insert after N23, before `## P5 device spike (Android)`:

```markdown
### N24 — The degradation ladder's steps 2 and 3 have nothing behind them

**Status:** open · known gap, recorded on purpose (D2 §4.2)
**Where:** capture app · `ShedStep` (`Vocabulary.kt`, `SessionState.ts`) · `DeviceReadings.shed` · AGENTS §8

Native reads the thermal status and names a ladder step: 2 is `viewer-feed`, 3 `preview-framerate`, 4 to 6 `encode`
(CD20). Only step 1 has an actor: the app closes and disables What viewers see on any shed. Nothing lowers the preview's
frame rate at step 3, and nothing touches the encode at step 4 and above; both are reported in the snapshot and the
session record, and that is all. This was true before Plan D, hidden while step 1 (then the score preview) was the only
step ever exercised. Building a real preview-framerate shed is out of Plan D's scope (spec §7). Until it exists, a phone
at thermal status 3 or higher is protected only by what step 1 saved and by the OS's own throttling. D3 row 13 proves
step 1 on a debug build; nothing can prove steps 2 and 3, because there is nothing to observe.
```

- [ ] **Step 6: The translation review (clears the markers).** For every string added or changed in Tasks 5 and 9 (`stream.advisory.shed`, `stream.peek.hot`, `.hint`, `.loading`, `.honest`, `.closesIn`, `.notReady`, `.hide`), check es, fr and nl against en:
  - where and how it renders: the strip's caption, the peek cell's reason, the cover;
  - its budget (`budgets.test.ts`);
  - its width (`stripTextFit`, `scoringFit`, `controlsFit`, `viewerCoverFit`);
  - the glossary's terms (_What viewers see_: _Lo que ve el público_, _Ce que voit le public_, _Wat kijkers zien_);
  - French spacing.

  Correct any string. Remove `"_review": "pending translation review"` from es, fr and nl. Add to `docs/i18n-glossary.md`'s table:

| en                                                  | es                | fr                  | nl                 | note                                                                                                                |
| --------------------------------------------------- | ----------------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Phone hot (the ladder's reason)                     | Móvil caliente    | Téléphone chaud     | Telefoon heet      | The phone, not the heat grade: es and fr agree with the phone (_caliente, chaud_), unlike Diagnostics' Heat grades. |
| viewer check (the shed caption's name for the view) | vista del público | vue du public       | kijkersbeeld       | The caption's short name for What viewers see; the control keeps its full label.                                    |
| no scoreboard yet                                   | aún sin marcador  | pas encore de score | nog geen scorebord | Said while What viewers see shows: the delivered picture has no score until the compositor exists.                  |

Run: `pnpm i18n:release-check`. Expected: EXIT=0. Run: `pnpm vitest run src/i18n src/ui/theme`. Expected: PASS, because a corrected string still fits.

- [ ] **Step 7: Format the docs.** Run: `pnpm prettier --write AGENTS.md _FINDINGS.md docs/i18n-glossary.md`, then `pnpm prettier --check AGENTS.md _FINDINGS.md docs/i18n-glossary.md app.json`. Expected: EXIT=0.

- [ ] **Step 8: Commit.**

```bash
git add AGENTS.md _FINDINGS.md docs/i18n-glossary.md src/i18n
git commit -m "docs(rules): AGENTS §6-§9 and §11 for D2; N24, the ladder's report-only steps; translation review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Full verification, and the device-only claims for D3

**Files:** none changed, unless a check fails. A failure goes back to its task's implementer; this task does not patch.

- [ ] **Step 1: The gate, with its exit code.**

```bash
mkdir -p /tmp/seazn-d2 && cd /Users/ashokhein/github/seazn.club.capture && pnpm check > /tmp/seazn-d2/check.out 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. Then get the count:

```bash
cd /Users/ashokhein/github/seazn.club.capture && pnpm vitest run --reporter=json --outputFile=/tmp/seazn-d2/r.json > /tmp/seazn-d2/vitest.out 2>&1; echo "EXIT=$?"; node -e "const r=require('/tmp/seazn-d2/r.json');console.log(r.numTotalTests, r.numPassedTests, r.numFailedTests, r.numPendingTests)"
```

Record the four numbers. `numFailedTests` must be 0.

- [ ] **Step 2: The Kotlin core.**

```bash
cd /Users/ashokhein/github/seazn.club.capture/modules/capture-engine/android/core && ./gradlew test --no-daemon --console=plain > /tmp/seazn-d2/gradle.out 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` and `BUILD SUCCESSFUL`. Record the test count from `build/test-results/test/*.xml`:

```bash
cd /Users/ashokhein/github/seazn.club.capture/modules/capture-engine/android/core && cat build/test-results/test/*.xml | rtk proxy grep -o 'tests="[0-9]*"' | awk -F'"' '{s+=$2} END {print s}'
```

- [ ] **Step 3: Prettier on everything touched outside the gate's folders.**

```bash
cd /Users/ashokhein/github/seazn.club.capture && pnpm prettier --check AGENTS.md _FINDINGS.md docs/i18n-glossary.md app.json package.json docs/superpowers/plans/2026-10-09-s1-plan-d2-design-followup-2.md > /tmp/seazn-d2/prettier.out 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. Also `pnpm i18n:release-check` → `EXIT=0`.

- [ ] **Step 4: Residue sweeps.** Each must list only the allowed hits:
  - `git grep -n -i "overlay-preview\|OVERLAY_PREVIEW\|usePeek\|PEEK_WARM_MS\|FIRST_WINDOW_PATIENCE_MS\|labelLong\|labelSize\|LONG_LINE_OVER\|scoreAhead\|overlayFailed\|settings\.overlay" -- src app modules test`: no hits.
  - `git grep -n "react-native-webview" -- src app modules test package.json`: only `eslint.config.mjs`'s ban, which is outside these paths.
  - `git grep -n -i "overlayUrl" -- src app modules test`: only Task 4 Step 10's allowed list.

- [ ] **Step 5: The native build is current.** Tasks 3 and 13 changed native dependencies (AGENTS §13, class 5). Confirm the last prebuild was after Task 13 and `./gradlew assembleDebug` passed then. Confirm `git diff main -- package.json` shows only the dependency changes (no `expo run:*` scripts from prebuild).

- [ ] **Step 6: The device-only claims, handed to D3.** jsdom cannot see them (AGENTS §10). Copy this list into the D2 PR description and into D3's run sheet.

  **D3 row 12, Part 2 on the device** (owner taps; the agent reads screenshots; 804 × 332 and 640 × 360 via `wm size`; en and the longest locale, es or fr):

  1. **What viewers see.**
     - A tap shows the 5 s countdown, then the picture, then it closes at 20 s from the first frame.
     - The player is gone after close: no download continues. Read the record's `viewer.check` lines and the data counter.
     - `viewer.firstFrame {ms}` is recorded for each tap. Spec §8's HLS risk: if most taps reach notReady, the countdown length goes back to the owner with these numbers.
     - The not-ready path: a tap early in a broadcast, before Cloudflare has a segment, shows the honest line for 3 s.
     - Opening Remote scoring closes it, and the reverse.
     - The honest line "no scoreboard yet" is legible over the picture at arm's length.
     - The cover never covers the status strip or Stop.
  2. **The peek is a plain tap on the phone.** There is no press delay, and a tap on the cover closes it (react-native-web cannot show Fabric's press handling).
  3. **C2 at 804 × 332 and 640 × 360.**
     - The bars' hues: lime first, lilac second.
     - The margin v in ink2, centred between the rows.
     - The round line in lime caps.
     - A long doubles label: each side at most 2 lines with an ellipsis.
     - The picture's size matches the arithmetic: 394.7 × 222 for a one-line-a-side label, 316.4 × 178 before measurement or for 2 + 2 lines.
     - Real staging names (§5.2's divisions): which doubles sides wrap (PD5).
  4. **The idle dim.**
     - Paired and untouched, the window dims at 30 s to 0.1.
     - A touch anywhere wakes it, Settings included, and the control under the finger still acts.
     - Arming or a console Go live restores it at once.
     - Backgrounding and returning restores it.
     - It never dims armed or live.
     - Spec §8 risk: if the owner's handset ignores the window brightness under its power mode, the fallback is a dark scrim (_rec_), raised to the owner, not built here.
  5. **No `WRITE_SETTINGS` prompt or permission** in the installed app's permission list (Android settings → app info).
  6. **No WebView in the installed app:** the stage shows no score layer, and Settings has no Score preview switch.
  7. **Settings carried over:** install the D2 build over a pre-D2 build that had Controls on the Left and automatic off. Both survive (v2 → v3).

  **D3 row 13, the thermal rung** (debug build, scripted): with a `thermal` status forced to 2, What viewers see closes if open and is disabled with "Phone hot". The strip's caption reads "Phone hot — viewer check off, still live". With status 3 and 4 the same holds (the ladder only goes down), and nothing else on screen changes (N24: steps 2 and 3 are report-only).

- [ ] **Step 7: The report.** Final message under 15 lines:
  - the vitest numbers (total / passed / failed / pending);
  - the Kotlin test count and exit code;
  - the prettier and `i18n:release-check` exit codes;
  - the residue sweeps' results;
  - any deviation from this plan, with the file:line;
  - the device-only list's path in the PR.

  No file contents.

---

## Self-review

Checked against spec §4 on 2026-10-09, before handing this plan over.

- **Spec coverage.** Each spec point maps to tasks:
  - §4.1 (the WebView, the stage hooks, the switch and stored field, the captions, the snapshot fields, the dependency) → Tasks 1–4.
  - §4.2 (rename, the TS rung, the copy, N24) → Tasks 5, 9 and 15.
  - §4.3 (reducer, hook, cover, tap, one cover at a time, honest copy, one quiet retry, no patience, the AGENTS §6 text) → Tasks 6–9 and 15.
  - §4.4 (reserve 154, the drawing, the round line, the measurement) → Tasks 10–12.
  - §4.5 (ScreenPort, rule, hook, touch, keep-awake test, the AGENTS §9 text) → Tasks 13, 14 and 15.
  - §6's D2 mutations → the named Mutation steps.
  - §5.1 rows 12 and 13 → Task 16 Step 6.
- **Not mapped here.** §4.4's "record which staging doubles names wrap" needs the names, which §5.2 does not give. Task 12 records capacity instead, and D3 reads the names (PD5).
- **Deviations from the spec's words.**
  - PD1: the peek is not drawn through `Button`, whose 200 dp minimum does not fit the 110 dp cell.
  - Two additions §4 does not name: PD3, blocking `WRITE_SETTINGS`, and PD4, the AGENTS §7 rewrite.
- **Spec facts checked in the code.**
  - `useViewfinder.ts:155` (`peekable`): correct.
  - `DeviceReadings.kt:84-88`: correct.
  - `SessionState.ts:96-98`: correct.
  - `engineSelectors.test-d.ts:57`: correct.
  - `useKeepAwake.ts:27-29`: correct.
  - `Vocabulary.kt:47`: this is the enum's header line. Its first member, `OVERLAY_PREVIEW`, is at :48.
- **Order.** Each task leaves `pnpm check` green:
  - Task 1 keeps `StreamSettings.overlay` until Task 2 removes its last reader.
  - Task 4 changes both wire readers and all three vector files in one commit.
  - Task 10 changes the reserve before Task 11 removes `labelLong`.
- **Expected values.**
  - Every number comes from the spec's table or from arithmetic written in the test: 154, 316.4 × 178, the 5/20/3 s and 0.1.
  - The font widths, 440/276 and 50/40/33, were measured on 2026-10-09 and are pinned as measured. If one changes, it is reported, never re-pinned.
- **Names.** Every symbol, file and scene used exists at HEAD `ada2ffd`: `FAKE_SCENES` `paired-ready`, `armed-not-ready`, `live` and `fatal`; `foreground.leave`/`fire`; `selectShedding`; `layout.iconBorderOn`. Two exceptions, each of which the implementer reads before writing:
  - Task 11's `linesAllowed` helper;
  - `ChoiceRow`'s ARIA role.
