import { act, render, screen, type RenderResult } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';
import { useReopenGate } from '@/hooks/useReopenGate';
import type { NavigationPort, Route } from '@/services/devicePorts';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import { createFakePorts, type FakePorts } from './fakePorts';
import { wrapperFor } from './renderWithPorts';

export type RoutedNavigation = NavigationPort & {
  readonly history: readonly Route[];
  subscribe(onMove: () => void): () => void;
};

/** Navigation that re-renders the app on every move, as Expo Router's stack does. */
function routedNavigation(): RoutedNavigation {
  let current: Route = 'home';
  const history: Route[] = [];
  const listeners = new Set<() => void>();
  return {
    history,
    current: () => current,
    go: (route) => {
      if (route === current) return;
      current = route;
      history.push(route);
      for (const listener of listeners) listener();
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
 */
function RoutedApp({ nav }: { nav: RoutedNavigation }) {
  useReopenGate(true);
  const route = useSyncExternalStore(nav.subscribe, nav.current);
  return (
    <>
      {route === 'home' ? <HomeScreen /> : <StreamScreen />}
      {route === 'streamSettings' ? <SettingsScreen /> : null}
      {route === 'streamDiagnostics' ? <DiagnosticsScreen /> : null}
    </>
  );
}

export type LaunchedApp = FakePorts & RenderResult & { readonly nav: RoutedNavigation };

type Launch = {
  readonly kvSeed?: Record<string, string>;
  /** Runs before the first render: an engine native already holds, say. */
  readonly prepare?: (fakes: FakePorts) => void;
};

/**
 * The whole app on the fake ports, under fake timers, launched and left until
 * the reopen gate has decided. Moves go through `nav`, never `fakes.navigation`.
 */
export async function launchApp({ kvSeed, prepare }: Launch = {}): Promise<LaunchedApp> {
  const nav = routedNavigation();
  const fakes = createFakePorts({ navigation: nav, kvSeed });
  prepare?.(fakes);
  const rendered = render(<RoutedApp nav={nav} />, { wrapper: wrapperFor(fakes) });
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
