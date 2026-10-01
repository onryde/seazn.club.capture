import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { CaptureEnginePort, EngineSnapshot } from '@/engine/CaptureEnginePort';

/**
 * The only bridge between native session state and React (AGENTS.md §8).
 *
 * The *instance* lives in context because it never changes — putting it there
 * costs no re-renders. The *state* never goes in context: at 1 Hz for three
 * hours that would re-render every consumer roughly ten thousand times, which
 * is the exact failure this hook exists to avoid.
 */
const EngineContext = createContext<CaptureEnginePort | null>(null);

export function EngineProvider({
  engine,
  children,
}: {
  engine: CaptureEnginePort;
  children: ReactNode;
}) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): CaptureEnginePort {
  const engine = useContext(EngineContext);
  if (engine === null) {
    throw new Error('useEngine must be used inside an EngineProvider');
  }
  return engine;
}

/**
 * Subscribe to one narrow slice of engine state.
 *
 * The selector MUST return a primitive or a stable reference. Returning a fresh
 * object or array re-renders on every tick — `useSyncExternalStore` compares by
 * identity — which reintroduces the problem selectors are here to solve. Select
 * the number you need, not the object it lives in.
 */
export function useEngineSelector<T>(selector: (snapshot: EngineSnapshot) => T): T {
  const engine = useEngine();
  const getSnapshot = useCallback(() => selector(engine.getSnapshot()), [engine, selector]);
  return useSyncExternalStore(engine.subscribe, getSnapshot);
}
