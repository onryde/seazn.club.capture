import { useEffect, useState } from 'react';

export type OptionalModule<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly module: T }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Load a native-backed module without letting its absence take the app down.
 *
 * Expo Go ships a fixed set of native modules. Importing one it does not have
 * throws at module load — before React renders, so no error boundary can catch
 * it — and the app dies with "Cannot find native module". A camera app must
 * never crash because an optional *preview* is unavailable: the broadcast is
 * the point, and peeking is a convenience.
 *
 * So both previews load their module dynamically and say so plainly when it is
 * missing. In a development build they simply light up.
 *
 * `load` must be a module-level function: a new closure each render would
 * re-run the effect forever.
 */
export function useOptionalNativeModule<T>(load: () => Promise<T>): OptionalModule<T> {
  const [state, setState] = useState<OptionalModule<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((module) => {
        if (!cancelled) setState({ status: 'ready', module });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return state;
}
