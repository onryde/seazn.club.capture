/**
 * Errors cross boundaries as values, not exceptions.
 *
 * The QR parser is the app's anti-corruption layer (AGENTS.md §4) and a
 * malformed scan is an ordinary outcome, not an exceptional one — an operator
 * pointing the camera at the wrong poster should produce a readable message,
 * not a stack trace.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
