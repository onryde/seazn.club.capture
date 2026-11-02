import { act, render, screen, type RenderResult } from '@testing-library/react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { vi } from 'vitest';
import { useEngineFollow } from '@/hooks/useEngineFollow';
import { useEngineSync } from '@/hooks/useEngineSync';
import { useProtectCode } from '@/hooks/useProtectCode';
import { routeTarget, useOrientationGate } from '@/hooks/useOrientationGate';
import { useReopenGate } from '@/hooks/useReopenGate';
import { useScoringBackground } from '@/hooks/useScoringBackground';
import { useScoringFixture } from '@/hooks/useScoringFixture';
import { usePorts } from '@/hooks/usePorts';
import type { Route } from '@/services/devicePorts';
import {
  createExpoRouterNavigation,
  type Path,
  type RouterMoves,
} from '@/services/native/expoRouterNavigation';
import { OrientationGate } from '@/ui/components/OrientationGate';
import { BadmintonPadPreviewScreen } from '@/ui/screens/BadmintonPadPreviewScreen';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { ScoringMatchScreen } from '@/ui/screens/ScoringMatchScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { quietDevice } from './quietDevice';
import { wrapperFor } from './renderWithPorts';

/**
 * Expo Router's root Stack, as far as the app can tell: a stack of paths moved
 * by `push`, `back` and `replace`. The ports talk to it through the production
 * adapter, so the adapter's cached route and the Stack can disagree, as on the
 * phone. `current()` and `history` are what the Stack shows, not the cache.
 */
export type RouterDouble = RouterMoves & {
  current(): Route;
  /** The top of the Stack as Expo Router's `usePathname()` reads it. */
  path(): Path;
  readonly history: readonly Route[];
  subscribe(onMove: () => void): () => void;
  /**
   * A fresh root Stack starts at its first route: Expo Router clears a
   * navigator's state on unmount and builds its initial state on mount
   * (`expo-router/build/react-navigation/core/useNavigationBuilder.js:496-501`,
   * `:309-323`), and `index` sorts first.
   */
  mounted(): void;
};

const ROUTE_OF: Readonly<Record<Path, Route>> = {
  '/': 'home',
  '/stream': 'stream',
  '/stream/settings': 'streamSettings',
  '/stream-settings': 'homeSettings',
  '/scoring': 'scoring',
};

function routerDouble(): RouterDouble {
  let stack: Path[] = ['/'];
  const history: Route[] = [];
  const listeners = new Set<() => void>();
  const path = (): Path => stack[stack.length - 1] ?? '/';
  const top = (): Route => ROUTE_OF[path()];
  const moved = (next: Path[]) => {
    stack = next;
    history.push(top());
    for (const listener of listeners) listener();
  };
  return {
    history,
    current: top,
    path,
    push: (path) => moved([...stack, path]),
    back: () => moved(stack.slice(0, -1)),
    replace: (path) => moved([...stack.slice(0, -1), path]),
    mounted: () => {
      stack = ['/'];
    },
    subscribe: (onMove) => {
      listeners.add(onMove);
      return () => {
        listeners.delete(onMove);
      };
    },
  };
}

/**
 * The app as the root layout composes it: the reopen gate, then one screen per
 * route, with Settings over a viewfinder that stays mounted, and Stream Settings
 * from Home and the Remote scoring preview each on its own (R2, P8; S2).
 * `extra` renders beside the screens, as part of the app. A remount (Try again
 * after a crash) starts the Stack afresh at Home, as Expo Router's does.
 * `gated` puts the screens under the root layout's orientation gate, read from the
 * Stack's path as `app/_layout.tsx` reads `usePathname()`.
 */
function RoutedApp({
  nav,
  extra,
  gated,
}: {
  nav: RouterDouble;
  extra?: ReactNode;
  gated: boolean;
}) {
  useState(nav.mounted);
  useReopenGate(true);
  useEngineFollow();
  useEngineSync();
  useProtectCode();
  useScoringBackground();
  const route = useSyncExternalStore(nav.subscribe, nav.current);
  const screens = <Screens route={route} />;
  return (
    <>
      {gated ? <Gated nav={nav}>{screens}</Gated> : screens}
      {extra}
    </>
  );
}

function Screens({ route }: { route: Route }) {
  return (
    <>
      {route === 'home' ? <HomeScreen /> : null}
      {route === 'homeSettings' ? <SettingsScreen from="home" /> : null}
      {route === 'scoring' ? <ScoringRouted /> : null}
      {route === 'stream' || route === 'streamSettings' ? <StreamScreen /> : null}
      {route === 'streamSettings' ? <SettingsScreen /> : null}
    </>
  );
}

/**
 * `app/scoring/index.tsx` by hand (the drift test pins the route file's own returns): the saved match, else the dev
 * twin's preview, else nothing: the route's Redirect has no router here, and the test says so by finding the screen gone.
 */
function ScoringRouted() {
  const fixtureId = useScoringFixture();
  const { previewScoring } = usePorts();
  if (fixtureId !== null) return <ScoringMatchScreen fixtureId={fixtureId} />;
  return previewScoring ? <BadmintonPadPreviewScreen /> : null;
}

/** The root layout's gate (`app/_layout.tsx`): the route's target, the hook's card over the screens. */
function Gated({ nav, children }: { nav: RouterDouble; children: ReactNode }) {
  const path = useSyncExternalStore(nav.subscribe, nav.path);
  const { card } = useOrientationGate(routeTarget(path));
  return <OrientationGate card={card}>{children}</OrientationGate>;
}

export type LaunchedApp = FakePorts & RenderResult & { readonly nav: RouterDouble };

type Launch = {
  readonly kvSeed?: Record<string, string>;
  /** The dev twin's Remote scoring preview (`Ports.previewScoring`); off, as in the store build, by default. */
  readonly previewScoring?: boolean;
  /** Runs before the first render: an engine native already holds, say. */
  readonly prepare?: (fakes: FakePorts) => void;
  /** Awaited before the first render: a queue file already on the disk, say, which a sync `prepare` cannot write. */
  readonly seed?: (fakes: FakePorts) => Promise<void>;
  readonly extra?: ReactNode;
  /** The phone has nothing to warn about, so no caption takes the strip's line from a routine status: see `quietDevice.ts`. */
  readonly quiet?: boolean;
  /** Wraps the whole app, as the root layout's error boundary does. */
  readonly around?: (app: ReactNode, fakes: FakePorts) => ReactNode;
  /** The screens under the root layout's orientation gate; off by default, as the gate has its own tests. */
  readonly gated?: boolean;
};

/**
 * The whole app on the fake ports, under fake timers, launched and left until
 * the reopen gate has decided. The ports navigate through the production
 * adapter over `nav`; read the screen from `nav`, never `fakes.navigation`.
 */
export async function launchApp(launch: Launch = {}): Promise<LaunchedApp> {
  const {
    kvSeed,
    prepare,
    seed,
    extra,
    around,
    quiet = false,
    previewScoring = false,
    gated = false,
  } = launch;
  const nav = routerDouble();
  const fakes = createFakePorts({
    navigation: createExpoRouterNavigation(nav),
    kvSeed,
    previewScoring,
  });
  if (quiet) quietDevice(fakes.engine);
  prepare?.(fakes);
  await seed?.(fakes);
  const app = <RoutedApp nav={nav} extra={extra} gated={gated} />;
  const ui = around === undefined ? app : around(app, fakes);
  const rendered = render(ui, { wrapper: wrapperFor(fakes) });
  await flush();
  return { ...fakes, ...rendered, nav };
}

/** Lets timers, promises and effects run, as a moment on the phone does. */
export const flush = (ms = 50) => act(() => vi.advanceTimersByTimeAsync(ms));

/** A code scanned from Home's Live Stream tile: checked, saved and opened. */
export async function scanFromHome(app: LaunchedApp, raw: string): Promise<void> {
  app.scanner.queue({ outcome: 'scanned', raw });
  act(() => screen.getByRole('button', { name: /Live Stream/ }).click());
  await flush(200);
}

/** The phone going to the background and back, as the operator pockets it. */
export async function backgroundAndBack(app: LaunchedApp): Promise<void> {
  act(() => app.foreground.leave());
  act(() => app.foreground.fire());
  await flush();
}

export const intentKinds = (app: FakePorts) => app.engine.intents.map((intent) => intent.kind);
