import { useMemo, useSyncExternalStore } from 'react';
import type { ScoringState } from '@/hooks/padScreenModel';
import type { RunnerSnapshot } from '@/hooks/scoringRunner';
import { usePorts } from '@/hooks/usePorts';
import { useFocus } from '@/hooks/useScoringMatch';

/**
 * Which sport's screen a saved match is drawn by (plan S2-1 Task 11; owner ruling 38, 2026-11-02: pad per sport), or the
 * state that stands in its place before any sport is known: the first read, no link, a file the phone cannot read, a
 * sport this build does not score. The answer is the runner's own (it opens the match as the sport its link was kept with:
 * `scoringLinkStore`), so the route asks nobody else and reads no link of its own.
 */
export type SportPick = { readonly kind: 'sport'; readonly sportKey: string } | ScoringState;

const LOADING: SportPick = { kind: 'loading', offline: false };
const noSubscribe = (): (() => void) => () => undefined;

function pickOf(snapshot: RunnerSnapshot): SportPick {
  switch (snapshot.kind) {
    case 'ready':
      return { kind: 'sport', sportKey: snapshot.state.sport.key };
    case 'noLink':
      return { kind: 'linkGone' };
    case 'unreadable':
      return { kind: 'unreadable', what: snapshot.what };
    case 'unsupportedSport':
      return snapshot;
    case 'loading':
      return LOADING;
  }
}

/**
 * Focuses the match (as its pad does; a match has one runner and focus is counted) and answers the pick. The runner
 * publishes after every tap, so the pick keeps its identity while it says the same thing: the route's screen is not
 * drawn again for a rally.
 */
export function useScoringSport(fixtureId: string): SportPick {
  const ports = usePorts();
  const runner = useFocus(ports, fixtureId);
  const read = useMemo(() => {
    let last: SportPick = LOADING;
    return () => {
      const next = runner === null ? LOADING : pickOf(runner.snapshot());
      if (JSON.stringify(next) !== JSON.stringify(last)) last = next;
      return last;
    };
  }, [runner]);
  return useSyncExternalStore(runner?.subscribe ?? noSubscribe, read);
}
