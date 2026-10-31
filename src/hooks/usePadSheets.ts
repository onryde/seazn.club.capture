import { useCallback, useMemo, useState } from 'react';
import {
  parseBadmintonTool,
  sideNames,
  type BadmintonDisplay,
} from '@/domain/scoring/badmintonPad';
import {
  chooseSanction,
  sanctionSheet,
  startSanction,
  type SanctionSheet,
  type SanctionStep,
} from '@/domain/scoring/badmintonSanction';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import type { FakeBadmintonPad, FakeOutcome } from '@/services/fakeBadmintonPad';

/** What is over the pad: a sanction's step, the Set score fields, or a disqualification's ending prompt. */
export type PadSheetView =
  | { readonly kind: 'sanction'; readonly sheet: SanctionSheet }
  | {
      readonly kind: 'setScore';
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
    }
  | { readonly kind: 'ending'; readonly person: string };

type Sheet =
  { readonly kind: 'sanction'; readonly step: SanctionStep } | { readonly kind: 'setScore' } | null;

/** Says what a tap came to (`useBadmintonPadPreview`'s `settle`); `refuse` says a refusal of its own. */
type Settle = (outcome: FakeOutcome) => void;

/**
 * The sheet over the badminton preview's pad: a tool opens one, a sanction's steps move through it, Cancel and Back
 * close it. The ending prompt is not a sheet the scorer opens: it shows for as long as a disqualification waits.
 */
export function usePadSheets(
  pad: FakeBadmintonPad,
  display: BadmintonDisplay,
  settle: Settle,
  refuseScore: () => void,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const tool = useCallback((id: string) => setSheet(sheetFor(id)), []);
  const choose = useCallback(
    (id: string) => {
      if (sheet?.kind !== 'sanction') return;
      const move = chooseSanction(sheet.step, id, display.sides);
      if (move.kind === 'step') return setSheet({ kind: 'sanction', step: move.step });
      setSheet(null);
      settle(pad.sanction(move.sanction));
    },
    [sheet, display.sides, pad, settle],
  );
  const saveScore = useSaveScore(pad, settle, refuseScore, cancel);
  const actions = useMemo(
    () => ({ tool, choose, cancel, saveScore }),
    [tool, choose, cancel, saveScore],
  );
  const view = useMemo(() => sheetView(sheet, display), [sheet, display]);
  return { open: sheet !== null, cancel, actions, view };
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

function sheetView(sheet: Sheet, display: BadmintonDisplay): PadSheetView | null {
  if (display.awaitingEnding) return { kind: 'ending', person: disqualified(display) };
  if (sheet === null) return null;
  if (sheet.kind === 'sanction') {
    return { kind: 'sanction', sheet: sanctionSheet(sheet.step, display.sides) };
  }
  return {
    kind: 'setScore',
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    points: [display.points.first, display.points.second],
  };
}

/** The person whose disqualification waits for its ending: the last sanction recorded. */
function disqualified(display: BadmintonDisplay): string {
  return display.sanctions[display.sanctions.length - 1]?.person ?? '';
}
