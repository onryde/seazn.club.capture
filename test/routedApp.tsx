import { act, render, screen, type RenderResult } from '@testing-library/react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { vi } from 'vitest';
import { useReopenGate } from '@/hooks/useReopenGate';
import type { Route } from '@/services/devicePorts';
import {
  createExpoRouterNavigation,
  type Path,
  type RouterMoves,
} from '@/services/native/expoRouterNavigation';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { wrapperFor } from './renderWithPorts';

/**
 * Expo Router's root Stack, as far as the app can tell: a stack of paths moved
 * by `push`, `back` and `replace`. The ports talk to it through the production
 * adapter, so the adapter's cached route and the Stack can disagree, as on the
 * phone. `current()` and `history` are what the Stack shows, not the cache.
 */
export type RouterDouble = RouterMoves & {
  current(): Route;
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
  '/stream/diagnostics': 'streamDiagnostics',
};

function routerDouble(): RouterDouble {
  let stack: Path[] = ['/'];
  const history: Route[] = [];
  const listeners = new Set<() => void>();
  const top = (): Route => ROUTE_OF[stack[stack.length - 1] ?? '/'];
  const moved = (next: Path[]) => {
    stack = next;
    history.push(top());
    for (const listener of listeners) listener();
  };
  return {
    history,
    current: top,
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
 * route, with Settings and Diagnostics over a viewfinder that stays mounted.
 * `extra` renders beside the screens, as part of the app. A remount (Try again
 * after a crash) starts the Stack afresh at Home, as Expo Router's does.
 */
function RoutedApp({ nav, extra }: { nav: RouterDouble; extra?: ReactNode }) {
  useState(nav.mounted);
  useReopenGate(true);
  const route = useSyncExternalStore(nav.subscribe, nav.current);
  return (
    <>
      {route === 'home' ? <HomeScreen /> : <StreamScreen />}
      {route === 'streamSettings' ? <SettingsScreen /> : null}
      {route === 'streamDiagnostics' ? <DiagnosticsScreen /> : null}
      {extra}
    </>
  );
}

export type LaunchedApp = FakePorts & RenderResult & { readonly nav: RouterDouble };

type Launch = {
  readonly kvSeed?: Record<string, string>;
  /** Runs before the first render: an engine native already holds, say. */
  readonly prepare?: (fakes: FakePorts) => void;
  readonly extra?: ReactNode;
  /** Wraps the whole app, as the root layout's error boundary does. */
  readonly around?: (app: ReactNode, fakes: FakePorts) => ReactNode;
};

/**
 * The whole app on the fake ports, under fake timers, launched and left until
 * the reopen gate has decided. The ports navigate through the production
 * adapter over `nav`; read the screen from `nav`, never `fakes.navigation`.
 */
export async function launchApp(launch: Launch = {}): Promise<LaunchedApp> {
  const { kvSeed, prepare, extra, around } = launch;
  const nav = routerDouble();
  const fakes = createFakePorts({ navigation: createExpoRouterNavigation(nav), kvSeed });
  prepare?.(fakes);
  const app = <RoutedApp nav={nav} extra={extra} />;
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
