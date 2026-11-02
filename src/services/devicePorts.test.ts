import { describe, expect, it } from 'vitest';
import { isHomeSubRoute, isStreamSubRoute, type Route } from '@/services/devicePorts';

/**
 * Which screens Back gives to Home and the reopen gate leaves alone (R2, P8; plan S2-1 Task 10). Remote Scoring is one:
 * it holds no broadcast, so Back goes Home freely (ruling 10) and a return to the foreground stays on the pad.
 */
describe('the routes', () => {
  it.each<[Route, boolean, boolean]>([
    ['home', false, false],
    ['stream', false, false],
    ['streamSettings', true, false],
    ['homeSettings', false, true],
    ['scoring', false, true],
  ])('%s: a Live Stream sub-screen %s, a Home sub-screen %s', (route, stream, home) => {
    expect([isStreamSubRoute(route), isHomeSubRoute(route)]).toEqual([stream, home]);
  });
});
