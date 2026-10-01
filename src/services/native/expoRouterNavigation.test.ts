import { beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({ router }));

import { createExpoRouterNavigation } from '@/services/native/expoRouterNavigation';

describe('the Expo Router adapter (D19)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces between modes: there is no back stack between them', () => {
    const navigation = createExpoRouterNavigation();
    navigation.go('stream');
    expect(router.replace).toHaveBeenCalledWith('/stream');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pushes Settings over the viewfinder, so the camera stays mounted', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamSettings');
    expect(router.push).toHaveBeenCalledWith('/stream/settings');
    expect(navigation.current()).toBe('streamSettings');
  });

  it('pushes Diagnostics over the viewfinder too', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamDiagnostics');
    expect(router.push).toHaveBeenCalledWith('/stream/diagnostics');
    expect(navigation.current()).toBe('streamDiagnostics');
  });

  it('goes back to the viewfinder rather than stacking a second one', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamDiagnostics');
    navigation.go('stream');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(navigation.current()).toBe('stream');
  });

  it('ignores a repeated move, in and out', () => {
    const navigation = createExpoRouterNavigation('stream');
    navigation.go('streamSettings');
    navigation.go('streamSettings');
    navigation.go('stream');
    navigation.go('stream');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  // Leaving the mode from a sub-screen (the reopen gate sending Home) is a
  // move between modes: replaced, never popped.
  it('replaces from a sub-screen to Home', () => {
    const navigation = createExpoRouterNavigation('streamSettings');
    navigation.go('home');
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
    expect(navigation.current()).toBe('home');
  });

  it('never pushes a sub-screen from Home', () => {
    const navigation = createExpoRouterNavigation('home');
    navigation.go('streamSettings');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/stream/settings');
  });

  // Review M8: `current()` names a screen only once the router has moved to it.
  // A sub-route named with no sub-screen mounted would give Back away on air.
  it.each([
    ['push', 'stream', 'streamSettings'],
    ['back', 'streamDiagnostics', 'stream'],
    ['replace', 'stream', 'home'],
  ] as const)(
    'keeps the route it was on when %s throws, and lets the fault through',
    (call, from, to) => {
      const navigation = createExpoRouterNavigation(from);
      router[call].mockImplementationOnce(() => {
        throw new Error('navigator not ready');
      });
      expect(() => navigation.go(to)).toThrow('navigator not ready');
      expect(navigation.current()).toBe(from);
      navigation.go(to);
      expect(navigation.current()).toBe(to);
      expect(router[call]).toHaveBeenCalledTimes(2);
    },
  );
});
