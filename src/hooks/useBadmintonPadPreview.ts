import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  badmintonPad,
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
import {
  withCard,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadView,
} from '@/domain/scoring/padView';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { useBackCloses } from '@/hooks/useBackCloses';
import { usePorts } from '@/hooks/usePorts';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import {
  createFakeBadmintonPad,
  DOUBLES_SAMPLE,
  SINGLES_SAMPLE,
  type FakeBadmintonPad,
  type FakeOutcome,
  type FakeRefusal,
} from '@/services/fakeBadmintonPad';

export type PreviewSample = 'singles' | 'doubles';

/** What the preview row can pick: the pad itself, a state card, a sample match, or the next sync status. */
export type PreviewChoice = 'pad' | PadStateCard['kind'] | PreviewSample | 'sync';

/** What is over the pad: a sanction's step, the Set score fields, or a disqualification's ending prompt. */
export type PadSheetView =
  | { readonly kind: 'sanction'; readonly sheet: SanctionSheet }
  | {
      readonly kind: 'setScore';
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
    }
  | { readonly kind: 'ending'; readonly person: string };

export type PadPreviewActions = {
  readonly home: () => void;
  readonly tapHalf: (side: PadSide) => void;
  readonly undo: () => void;
  readonly tool: (id: string) => void;
  readonly choose: (id: string) => void;
  readonly cancel: () => void;
  readonly saveScore: (first: string, second: string) => void;
  readonly recordEnding: () => void;
  readonly voidSanction: () => void;
  readonly pick: (choice: PreviewChoice) => void;
};

export type BadmintonPadPreview = {
  readonly view: PadView<BadmintonPadKey>;
  readonly sheet: PadSheetView | null;
  /** The last tap's refusal, said in place of its sentence; cleared by the next tap that is recorded. */
  readonly refusal: MessageKey | null;
  readonly chosen: { readonly card: PadStateCard['kind'] | 'pad'; readonly sample: PreviewSample };
  readonly actions: PadPreviewActions;
};

type Sheet =
  { readonly kind: 'sanction'; readonly step: SanctionStep } | { readonly kind: 'setScore' } | null;
type SetRefusal = (refusal: MessageKey | null) => void;

/**
 * One physical tap read twice (a bouncing courtside tap, a handler fired twice): the same half within this window is
 * refused, and said, never silently eaten. The web pad's `DOUBLE_SUBMIT_WINDOW_MS` and its reasoning
 * (`apps/web/src/components/v2/scorepad/use-pad-pipeline.ts`, R7-42): a scorer cannot deliberately tap twice in under
 * ~250 ms, and two real rallies are seconds apart. A tap on the other half is a different action and always counts.
 */
export const DOUBLE_TAP_MS = 250;

const REFUSAL: Readonly<Record<FakeRefusal | 'doubleTap', MessageKey>> = {
  notNow: 'scoring.refusal.notNow',
  invalidScore: 'scoring.refusal.invalidScore',
  nothingToUndo: 'scoring.refusal.nothingToUndo',
  doubleTap: 'scoring.refusal.doubleTap',
};

const SAMPLES = { singles: SINGLES_SAMPLE, doubles: DOUBLES_SAMPLE } as const;

/** The dev row's sync statuses, in order; made-up counts. */
const SYNC_CYCLE: readonly PadSync[] = [
  { kind: 'synced' },
  { kind: 'sending', count: 1 },
  { kind: 'offline', count: 3 },
  { kind: 'refused', count: 1 },
];

/** Back while a disqualification waits for its ending: held, as a match left between the two is in neither state. */
const holdBack = (): void => undefined;

/**
 * The S2 design preview of the badminton pad, on a fake that keeps simple counters (`fakeBadmintonPad.ts`): no engine,
 * no network, no code. The pad's state lives in the fake; this hook holds only what is on screen over it (a sheet, a
 * refusal) and turns the scorer's taps into the fake's calls. Back closes a sheet, is held by the ending prompt, and
 * otherwise returns Home. Leaving drops the fake: the preview opens afresh.
 */
export function useBadmintonPadPreview(): BadmintonPadPreview {
  const { pad, sample, startSample } = usePreviewPad();
  const snapshot = useSyncExternalStore(pad.subscribe, pad.snapshot);
  const [refusal, setRefusal] = useState<MessageKey | null>(null);
  const settle = useSettle(setRefusal);
  const sheets = useSheets(pad, snapshot.display, settle, setRefusal);
  const tapHalf = useRallyTap(pad, settle, setRefusal);
  const others = usePadActions(pad, settle);
  const pick = usePick(pad, startSample, sheets.cancel, setRefusal);
  const home = useBackToHome();
  useBackCloses(sheets.open, sheets.cancel);
  useBackCloses(snapshot.display.awaitingEnding, holdBack);
  const view = useMemo(
    () => withCard(badmintonPad(snapshot.display, snapshot.sync), snapshot.card),
    [snapshot],
  );
  const actions = useMemo(
    () => ({ home, tapHalf, ...others, ...sheets.actions, pick }),
    [home, tapHalf, others, sheets.actions, pick],
  );
  const chosen = { card: snapshot.card?.kind ?? 'pad', sample } as const;
  return { view, sheet: sheets.view, refusal, chosen, actions };
}

/** The fake, one per sample: picking a sample starts its match afresh. */
function usePreviewPad() {
  const [held, setHeld] = useState(() => ({
    sample: 'singles' as PreviewSample,
    pad: createFakeBadmintonPad(SINGLES_SAMPLE),
  }));
  const startSample = useCallback(
    (sample: PreviewSample) => setHeld({ sample, pad: createFakeBadmintonPad(SAMPLES[sample]) }),
    [],
  );
  return { pad: held.pad, sample: held.sample, startSample };
}

/** A recorded tap clears the last refusal; a refused one says why. True when it was recorded. */
function useSettle(setRefusal: SetRefusal): (outcome: FakeOutcome) => boolean {
  return useCallback(
    (outcome: FakeOutcome) => {
      setRefusal(outcome.ok ? null : REFUSAL[outcome.refusal]);
      return outcome.ok;
    },
    [setRefusal],
  );
}

/** A tap on a half gives that side the rally, unless it is the same half again within `DOUBLE_TAP_MS`. */
function useRallyTap(
  pad: FakeBadmintonPad,
  settle: (outcome: FakeOutcome) => boolean,
  setRefusal: SetRefusal,
): (side: PadSide) => void {
  const { clock } = usePorts();
  const last = useRef<{ readonly side: PadSide; readonly at: number } | null>(null);
  return useCallback(
    (side: PadSide) => {
      const at = clock().getTime();
      const prior = last.current;
      if (prior !== null && prior.side === side && at - prior.at < DOUBLE_TAP_MS) {
        setRefusal(REFUSAL.doubleTap);
        return;
      }
      if (settle(pad.rally(side))) last.current = { side, at };
    },
    [clock, pad, settle, setRefusal],
  );
}

function usePadActions(pad: FakeBadmintonPad, settle: (outcome: FakeOutcome) => boolean) {
  const undo = useCallback(() => void settle(pad.undo()), [pad, settle]);
  const recordEnding = useCallback(() => void settle(pad.recordEnding()), [pad, settle]);
  const voidSanction = useCallback(() => void settle(pad.voidSanction()), [pad, settle]);
  return useMemo(() => ({ undo, recordEnding, voidSanction }), [undo, recordEnding, voidSanction]);
}

/** The sheet over the pad: a tool opens one, a sanction's steps move through it, Cancel and Back close it. */
function useSheets(
  pad: FakeBadmintonPad,
  display: BadmintonDisplay,
  settle: (outcome: FakeOutcome) => boolean,
  setRefusal: SetRefusal,
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
  const saveScore = useSaveScore(pad, settle, setRefusal, cancel);
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
  settle: (outcome: FakeOutcome) => boolean,
  setRefusal: SetRefusal,
  close: () => void,
) {
  return useCallback(
    (first: string, second: string) => {
      close();
      const points = [parseWholeNumber(first), parseWholeNumber(second)] as const;
      if (points[0] === null || points[1] === null) return setRefusal(REFUSAL.invalidScore);
      settle(pad.setScore(points[0], points[1]));
    },
    [pad, settle, setRefusal, close],
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

/** The preview row: a card over the same match, a sample afresh, or the next sync status. */
function usePick(
  pad: FakeBadmintonPad,
  startSample: (sample: PreviewSample) => void,
  closeSheet: () => void,
  setRefusal: SetRefusal,
) {
  return useCallback(
    (choice: PreviewChoice) => {
      closeSheet();
      setRefusal(null);
      if (choice === 'sync') return pad.setSync(nextSync(pad.snapshot().sync));
      if (choice === 'singles' || choice === 'doubles') return startSample(choice);
      pad.preview(cardOf(choice));
    },
    [pad, startSample, closeSheet, setRefusal],
  );
}

function nextSync(now: PadSync): PadSync {
  const at = SYNC_CYCLE.findIndex((each) => each.kind === now.kind);
  return SYNC_CYCLE[(at + 1) % SYNC_CYCLE.length] ?? SYNC_CYCLE[0] ?? now;
}

/** A card for the preview; the update card holds two made-up unsent taps. */
function cardOf(choice: 'pad' | PadStateCard['kind']): PadStateCard | null {
  if (choice === 'pad') return null;
  return choice === 'updateNeeded' ? { kind: 'updateNeeded', unsent: 2 } : { kind: choice };
}
