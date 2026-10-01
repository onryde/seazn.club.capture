import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the turn card covers the app (spec §5). The root layout's gate
 * provides it around the whole stack, so a screen deep in the stack learns it
 * without a prop through every route.
 *
 * Context, not a port: it never ticks (AGENTS §8). It changes when the phone
 * is turned, a few times a match at most, never with telemetry.
 */
const TurnCardContext = createContext(false);

export function TurnCardProvider({ showing, children }: { showing: boolean; children: ReactNode }) {
  return <TurnCardContext.Provider value={showing}>{children}</TurnCardContext.Provider>;
}

/**
 * Ruling N4: while the card shows, nothing under it acts. A hold in progress
 * is abandoned and the peek dropped, because the card covers the controls and
 * the operator cannot see what they are holding. Outside the gate (a test
 * rendering one screen) there is no card.
 */
export function useTurnCardShowing(): boolean {
  return useContext(TurnCardContext);
}
