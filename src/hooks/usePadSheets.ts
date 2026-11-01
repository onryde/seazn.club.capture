import { useCallback, useMemo, useState } from 'react';
import { isBounce } from '@/domain/scoring/bounce';
import { badmintonHistory } from '@/domain/scoring/badmintonHistory';
import {
  badmintonDetails,
  parseBadmintonTool,
  sideNames,
  type BadmintonDisplay,
  type BadmintonPadKey,
} from '@/domain/scoring/badmintonPad';
import {
  chooseSanction,
  sanctionSheet,
  startSanction,
  type SanctionSheet,
  type SanctionStep,
} from '@/domain/scoring/badmintonSanction';
import type { PadHistoryGroup, PadMatchDetails } from '@/domain/scoring/padView';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { usePorts } from '@/hooks/usePorts';
import type { FakeBadmintonPad, FakeOutcome, FakePadSnapshot } from '@/services/fakeBadmintonPad';

/**
 * What is over the pad: a sanction's step, the Set score fields, a disqualification's ending prompt, Match details
 * (where the match sits and its rules: owner ruling 15, then 2026-11-01), or its History (owner ruling 21), a cover the
 * full height of the pad.
 */
export type PadSheetView =
  | { readonly kind: 'sanction'; readonly sheet: SanctionSheet }
  | {
      readonly kind: 'setScore';
      /** The game it sets, the one the strip names (the controller's call, 2026-10-31): "Set score · Game 2". */
      readonly game: number;
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
    }
  | { readonly kind: 'ending'; readonly person: string }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<BadmintonPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<BadmintonPadKey>[] };

type Sheet =
  | { readonly kind: 'sanction'; readonly step: SanctionStep }
  | { readonly kind: 'setScore' }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };

/** Says what a tap came to (`useBadmintonPadPreview`'s `settle`); `refuse` says a refusal of its own. */
type Settle = (outcome: FakeOutcome) => void;

/**
 * The sheet over the badminton preview's pad: a tool, Match details or History opens one, a sanction's steps move
 * through it, Cancel, Close and Back close it. A second Match details or History tap opens nothing more: one Back
 * still closes it. The ending prompt is not a sheet the scorer opens: it shows for as long as a disqualification waits,
 * on the pad (none under a card). History is view only: it reads the sheet and records nothing. A sanction's step and
 * the ending prompt take no choice in the bounce window of appearing (`justShown`).
 */
export function usePadSheets(
  pad: FakeBadmintonPad,
  snapshot: FakePadSnapshot,
  settle: Settle,
  refuseScore: () => void,
) {
  const { display } = snapshot;
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const tool = useCallback((id: string) => setSheet(sheetFor(id)), []);
  const details = useCallback(() => setSheet(DETAILS), []);
  const history = useCallback(() => setSheet(HISTORY), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(sheet, view));
  const choose = useCallback(
    (id: string) => {
      if (sheet?.kind !== 'sanction' || justShown()) return;
      const move = chooseSanction(sheet.step, id, display.sides);
      if (move.kind === 'step') return setSheet({ kind: 'sanction', step: move.step });
      setSheet(null);
      settle(pad.sanction(move.sanction));
    },
    [sheet, display.sides, pad, settle, justShown],
  );
  const saveScore = useSaveScore(pad, settle, refuseScore, cancel);
  const actions = useMemo(
    () => ({ tool, details, history, choose, cancel, saveScore }),
    [tool, details, history, choose, cancel, saveScore],
  );
  return { open: sheet !== null, cancel, actions, view, justShown };
}

/**
 * The step on screen a double tap can reach, by name: a sanction's level, person or confirm, or the ending prompt,
 * one step wherever it comes from (the confirm, an Undo of the ending, a return to the pad). None for the rest.
 */
function guardedStep(sheet: Sheet, view: PadSheetView | null): string | null {
  if (view?.kind === 'ending') return 'ending';
  return view?.kind === 'sanction' && sheet?.kind === 'sanction' ? sheet.step.step : null;
}

/**
 * Whether a tap now falls in the bounce window (`bounce.ts`) of the guarded step on screen appearing (the
 * coordinator's ruling, 2026-11-01). The second tap of a double tap on one step's button lands on the next step's, on
 * the same bottom edge, and ending a match is the costliest mistake on the pad: such a tap does nothing and says
 * nothing (the step still waits; the line is behind the dim). A step's time is the render it first shows in.
 */
function useJustShown(step: string | null): () => boolean {
  const { clock } = usePorts();
  const [shown, setShown] = useState(() => ({ step, at: clock().getTime() }));
  if (shown.step !== step) setShown({ step, at: clock().getTime() });
  return useCallback(
    () => shown.step !== null && isBounce(clock().getTime() - shown.at),
    [shown, clock],
  );
}

/** Set score's two fields as typed: a field that is not a whole number is refused, as the pad refuses a bad score. */
function useSaveScore(
  pad: FakeBadmintonPad,
  settle: Settle,
  refuse: () => void,
  close: () => void,
) {
  return useCallback(
    (first: string, second: string) => {
      close();
      const points = [parseWholeNumber(first), parseWholeNumber(second)] as const;
      if (points[0] === null || points[1] === null) return refuse();
      settle(pad.setScore(points[0], points[1]));
    },
    [pad, settle, refuse, close],
  );
}

function sheetFor(id: string): Sheet {
  const parsed = parseBadmintonTool(id);
  if (parsed === null) return null;
  return parsed.kind === 'sanction'
    ? { kind: 'sanction', step: startSanction(parsed.side) }
    : { kind: 'setScore' };
}

function sheetView(sheet: Sheet, { display, history, card }: FakePadSnapshot): PadSheetView | null {
  // Under a card the pad takes no tap (`withCard`): the ending prompt goes with the tools while the ending waits, and is
  // back on the pad (hardening, 2026-11-01). Match details and History still open under the card.
  if (display.awaitingEnding && card === null) {
    return { kind: 'ending', person: disqualified(display) };
  }
  if (sheet === null) return null;
  if (sheet.kind === 'history') {
    return { kind: 'history', groups: badmintonHistory(history, display.sides) };
  }
  if (sheet.kind === 'sanction') {
    return { kind: 'sanction', sheet: sanctionSheet(sheet.step, display.sides) };
  }
  if (sheet.kind === 'details') return { kind: 'details', details: badmintonDetails(display) };
  return {
    kind: 'setScore',
    game: display.game,
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    points: [display.points.first, display.points.second],
  };
}

/** The person whose disqualification waits for its ending: the last sanction recorded. */
function disqualified(display: BadmintonDisplay): string {
  return display.sanctions[display.sanctions.length - 1]?.person ?? '';
}
