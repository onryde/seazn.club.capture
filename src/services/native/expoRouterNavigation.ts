import { router } from 'expo-router';
import { isStreamSubRoute, type NavigationPort, type Route } from '@/services/devicePorts';

type Path = '/' | '/stream' | '/stream/settings' | '/stream/diagnostics';

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
 * through here and `current()` stays true.
 */
export function createExpoRouterNavigation(initial: Route = 'home'): NavigationPort {
  let current = initial;
  return {
    current: () => current,
    go: (route) => {
      if (route === current) return;
      const from = current;
      current = route;
      if (from === 'stream' && isStreamSubRoute(route)) return router.push(PATH[route]);
      if (isStreamSubRoute(from) && route === 'stream') return router.back();
      router.replace(PATH[route]);
    },
  };
}
