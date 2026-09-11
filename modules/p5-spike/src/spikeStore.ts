import { useSyncExternalStore } from 'react';
import P5Spike, { type SpikeEvent, type SpikeSample } from './P5SpikeModule';

/**
 * Native events into React without re-rendering the tree at 1 Hz (AGENTS.md §8).
 * This matters for the spike's numbers too: a screen that re-renders every
 * second is JS load the shipping app would not carry.
 */
export type SpikeState = {
  readonly sample: SpikeSample | null;
  readonly lastEvent: SpikeEvent | null;
  readonly overlayUrl: string | null;
  readonly playbackUrl: string | null;
};

let state: SpikeState = { sample: null, lastEvent: null, overlayUrl: null, playbackUrl: null };
const listeners = new Set<() => void>();

function set(next: Partial<SpikeState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

P5Spike.addListener('onSample', (sample) => set({ sample }));
P5Spike.addListener('onEvent', (event) =>
  set(
    event.kind === 'armed'
      ? { lastEvent: event, overlayUrl: String(event.overlayUrl), playbackUrl: String(event.playbackUrl) }
      : { lastEvent: event },
  ),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpike<T>(select: (current: SpikeState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
