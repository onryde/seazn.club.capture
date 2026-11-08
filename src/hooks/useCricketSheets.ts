import { useCallback, useMemo, useState } from 'react';
import type { CricketPadKey } from '@/domain/scoring/cricketTypes';
import type { PadHistoryGroup, PadMatchDetails } from '@/domain/scoring/padView';
import {
  askedView,
  staleByAsk,
  useJustShown,
  type AskFacts,
  type AskView,
} from '@/hooks/usePadSheetParts';
import type { Arm } from '@/hooks/usePadTaps';

/**
 * The sheets over the cricket pad (S2-4 plan Task 8): Match details, History, and the reconnect question over them both.
 * Read only for now: the setup, the extras, the wicket steps, the over's end and More are Tasks 10 to 15's, each a sheet
 * added here. Chess's twin is `useChessSheets`; what the sports share (the bounce window of a sheet appearing, the
 * question) is `usePadSheetParts`.
 */

/** What the sheets are drawn from: Match details and History as the pad has them, and the question over the pad. */
export type CricketSheetSnapshot = AskFacts & {
  readonly details: PadMatchDetails<CricketPadKey>;
  readonly history: readonly PadHistoryGroup<CricketPadKey>[];
};

/** What is over the pad. */
export type CricketSheetView =
  | { readonly kind: 'details'; readonly details: PadMatchDetails<CricketPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<CricketPadKey>[] }
  | AskView;

type Sheet =
  { readonly kind: 'details' } | { readonly kind: 'history' } | { readonly kind: 'discard' } | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

/** The name a sheet's close has in the bounce memory. */
const CLOSE_TAP = 'close';

/**
 * The sheet over the cricket pad. Match details and History open from the top bar; Close, the dim and Back close them.
 * `arm` is the taps' (`useTaps`): every close by touch (`dismiss`) opens the bounce window without making a tap, so the
 * second touch of a double tap on Close cannot reach what was under it.
 */
export function useCricketSheets(snapshot: CricketSheetSnapshot | null, arm: Arm) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(view));
  // No match to put a sheet over, or the question over it: no sheet stays open behind it.
  if (sheet !== null && (snapshot === null || staleByAsk(sheet.kind, snapshot))) setSheet(null);
  const details = useCallback(() => setSheet(DETAILS), []);
  const history = useCallback(() => setSheet(HISTORY), []);
  const dismiss = useCallback(() => {
    if (justShown()) return;
    arm(CLOSE_TAP);
    cancel();
  }, [justShown, arm, cancel]);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing.
  const askDiscard = useCallback(() => {
    if (snapshot !== null && !justShown()) setSheet(DISCARD);
  }, [snapshot, justShown]);
  const actions = useMemo(
    () => ({ details, history, dismiss, askDiscard }),
    [details, history, dismiss, askDiscard],
  );
  return { open: sheet !== null, cancel, actions, view, justShown };
}

/**
 * The step on screen a double tap can reach, by name: Match details (whose dim takes the second touch on its icon), the
 * question and its confirm. Not History: its one button is not under its icon.
 */
function guardedStep(view: CricketSheetView | null): string | null {
  return view === null || view.kind === 'history' ? null : view.kind;
}

function sheetView(sheet: Sheet, snapshot: CricketSheetSnapshot | null): CricketSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands, and its confirm over it.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'details':
      return { kind: 'details', details: snapshot.details };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}
