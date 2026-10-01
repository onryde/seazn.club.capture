import { isStreamSubRoute, type NavigationPort, type Route } from '@/services/devicePorts';

export type Path = '/' | '/stream' | '/stream/settings' | '/stream/diagnostics';

/** The three moves this adapter makes: Expo Router's `router` in production, a double in tests. */
export type RouterMoves = {
  push(path: Path): void;
  back(): void;
  replace(path: Path): void;
};

const PATH: Readonly<Record<Route, Path>> = {
  home: '/',
  stream: '/stream',
  streamSettings: '/stream/settings',
  streamDiagnostics: '/stream/diagnostics',
};

/**
 * Between modes, `replace`: there is no back stack between them. Inside Live
 * Stream, Settings and Diagnostics are pushed over the viewfinder and popped
 * back to it (D19), so the camera is never remounted mid-match. Back inside a
 * mode is handled by that mode, and swipe-back is off, so every move comes
 * through here and `current()` stays true. The port outlives the root Stack:
 * when the Stack remounts, Expo Router starts it at its first route
 * (`useNavigationBuilder.js:496-501` clears the state on unmount, `:309-323`
 * builds the initial state on mount), so `restart` returns to `initial`.
 */
export function createExpoRouterNavigation(
  router: RouterMoves,
  initial: Route = 'home',
): NavigationPort {
  let current = initial;
  return {
    current: () => current,
    go: (route) => {
      if (route === current) return;
      move(router, current, route);
      // Review M8: only once the router has moved. A throw leaves `current()`
      // on the screen still showing, and is not swallowed.
      current = route;
    },
    restart: () => {
      current = initial;
    },
  };
}

function move(router: RouterMoves, from: Route, route: Route): void {
  if (from === 'stream' && isStreamSubRoute(route)) return router.push(PATH[route]);
  if (isStreamSubRoute(from) && route === 'stream') return router.back();
  router.replace(PATH[route]);
}
