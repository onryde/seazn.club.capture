import { router } from 'expo-router';
import type { NavigationPort, Route } from '@/services/devicePorts';

const PATH: Readonly<Record<Route, '/' | '/stream'>> = { home: '/', stream: '/stream' };

/**
 * `replace`, never `push`: there is no back stack between modes. Back inside
 * a mode is handled by that mode's leave rule, and swipe-back is off.
 */
export function createExpoRouterNavigation(initial: Route = 'home'): NavigationPort {
  let current = initial;
  return {
    current: () => current,
    go: (route) => {
      if (route === current) return;
      current = route;
      router.replace(PATH[route]);
    },
  };
}
