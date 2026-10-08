import { createElement } from 'react';
import { vi } from 'vitest';
import type { SurfacePackages } from '@/services/native/nativeSurfaces';

export type VideoPackage = Awaited<ReturnType<SurfacePackages['video']>>;
type StatusListener = (payload: { status: string }) => void;

/**
 * An expo-video package with one player that records what it was told and hears `statusChange`, as
 * the real one does: `addListener` hands back a subscription, `emit` is the player changing status.
 * Shared by the native surface's own tests and the seam test that drives the viewfinder through the
 * real `createNativeSurfaces`.
 */
export function fakeVideo() {
  const listeners: StatusListener[] = [];
  const player = {
    muted: false,
    loop: true,
    status: 'loading',
    play: vi.fn(),
    pause: vi.fn(),
    addListener: vi.fn((_event: string, listener: StatusListener) => {
      listeners.push(listener);
      return { remove: vi.fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
    }),
  };
  const emit = (status: string) => {
    player.status = status;
    for (const listener of [...listeners]) listener({ status });
  };
  const useVideoPlayer = vi.fn((_source: unknown, setup?: (p: typeof player) => void) => {
    setup?.(player);
    return player;
  });
  function VideoView() {
    return createElement('div', { 'data-testid': 'video-view' });
  }
  return {
    player,
    emit,
    listeners,
    useVideoPlayer,
    pkg: { useVideoPlayer, VideoView } as unknown as VideoPackage,
  };
}
