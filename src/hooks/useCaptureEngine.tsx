import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
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

/** Three missed heartbeats. A brief native hiccup should not flash a warning. */
const STALE_AFTER_MS = 3000;

/**
 * Whether the snapshot we are holding can still be trusted.
 *
 * This is the mechanism that makes returning from an iPhone lock honest. The
 * last snapshot before suspension very likely says `publishing`, and it may be
 * minutes old — continuing to render LIVE off it is the lie. A projection that
 * knows it is stale must refuse to make claims until native speaks again.
 *
 * It generalises past P1: the same signal catches a wedged native module or a
 * crashed engine, neither of which any lifecycle event would announce.
 *
 * NOTE it deliberately does NOT use `useEngineSelector(selectReportedAtMs)`.
 * That value changes on every heartbeat, so selecting it would re-render the
 * consumer once a second for three hours — exactly what AGENTS.md §8 forbids.
 * Subscribing directly and arming a timeout instead means the only renders are
 * the two transitions: fresh→stale and stale→fresh.
 */
export function useSnapshotFreshness(): boolean {
  const engine = useEngine();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      const dueInMs = engine.getSnapshot().reportedAtMs + STALE_AFTER_MS - Date.now();
      timer = setTimeout(() => setStale(true), Math.max(0, dueInMs));
    };

    const unsubscribe = engine.subscribe(() => {
      // A no-op when already false, so a quiet heartbeat costs no render.
      setStale(false);
      arm();
    });
    arm();

    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [engine]);

  return stale;
}
