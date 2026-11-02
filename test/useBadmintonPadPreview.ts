import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { badmintonHistory } from '@/domain/scoring/badmintonHistory';
import { badmintonPad, type BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import { refusalLine, type PadLineWords } from '@/domain/scoring/padLine';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import {
  withCard,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadView,
} from '@/domain/scoring/padView';
import type { BadmintonPadActions, BadmintonPadModel } from '@/hooks/useBadmintonMatch';
import { useBackCloses } from '@/hooks/useBackCloses';
import { usePadSheets, type PadSheetView } from '@/hooks/usePadSheets';
import {
  START_TAP,
  useGuardedTool,
  useSettle,
  useTaps,
  type Opening,
  type Say,
  type SetFlash,
} from '@/hooks/usePadTaps';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import {
  createFakeBadmintonPad,
  DOUBLES_SAMPLE,
  SINGLES_SAMPLE,
  type FakeBadmintonPad,
  type FakePadSample,
} from '@/services/fakeBadmintonPad';

export type { PadSheetView } from '@/hooks/usePadSheets';

export type PreviewSample = 'singles' | 'doubles';

/**
 * What the preview row can pick: the pad itself, a state card, a sample match, the next sync status, or Start: the
 * sample's match afresh and not started, the Start screen (owner, 2026-11-01).
 */
export type PreviewChoice = 'pad' | PadStateCard['kind'] | PreviewSample | 'sync' | 'start';

export type { PadLineWords };

/** The badminton pad's actions, and the preview row's `pick`. */
export type PadPreviewActions = BadmintonPadActions & {
  readonly pick: (choice: PreviewChoice) => void;
};

/**
 * What the preview hands the screen is the real match's model (`BadmintonPadModel`, plan S2-1 Task 9), so Task 11 swaps
 * one hook for the other; `chosen` and `pick` are the preview row's own.
 */
export type BadmintonPadPreview = BadmintonPadModel & {
  readonly chosen: { readonly card: PadStateCard['kind'] | 'pad'; readonly sample: PreviewSample };
  readonly actions: PadPreviewActions;
};

const INVALID_SCORE: PadLineWords = refusalLine('scoring.refusal.invalidScore');

const SAMPLES = { singles: SINGLES_SAMPLE, doubles: DOUBLES_SAMPLE } as const;

/** The dev row's sync statuses, in order; made-up counts (the stall's two digits are the widest badge). */
const SYNC_CYCLE: readonly PadSync[] = [
  { kind: 'synced' },
  { kind: 'sending', count: 1 },
  { kind: 'offline', count: 3 },
  { kind: 'refused', count: 1 },
  { kind: 'stalled', count: 12 },
];

type Held = { readonly sample: PreviewSample; readonly pad: FakeBadmintonPad };

/**
 * The match each app keeps while it runs, keyed by its Ports (one per launch, one per test): Back leaves the preview
 * freely (owner ruling 10), and a return finds the match where it was, a disqualification's ending prompt included.
 * Preview state only; S2's real pad reads the engine, which keeps the match itself.
 */
const kept = new WeakMap<Ports, Held>();

/**
 * The badminton pad's fake model, for the pad's screen tests (`padPreviewHarness.tsx`; it was the S2 design preview until
 * plan S2-1 Task 11 put the real route in its place), on a fake that keeps simple counters (`fakeBadmintonPad.ts`): no
 * engine, no network, no code. The match lives in the fake; this hook holds what is on screen over it (a sheet, what the line
 * says) and turns the scorer's taps into the fake's calls. A rally or an Undo repeated within the bounce window
 * (`bounce.ts`) counts once, and says so. Back closes a sheet, and otherwise returns Home, the ending prompt included.
 */
export function useBadmintonPadPreview(): BadmintonPadPreview {
  const { pad, sample, startSample } = usePreviewPad();
  const snapshot = useSyncExternalStore(pad.subscribe, pad.snapshot);
  const [line, say] = useState<PadLineWords>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const settle = useSettle(say);
  const taps = useTaps(pad, settle, say, setFlash);
  const refuseScore = useCallback(() => say(INVALID_SCORE), []);
  const sheetSnapshot = useMemo(
    () => ({
      display: snapshot.display,
      card: snapshot.card,
      history: badmintonHistory(snapshot.history, snapshot.display.sides),
    }),
    [snapshot],
  );
  const sheets = usePadSheets(pad, sheetSnapshot, taps.opening, refuseScore);
  const starting = useStart(pad, taps.opening);
  const clears = { say, setCardNote, setFlash, clearToss: starting.clearToss };
  const pick = usePick(pad, sample, startSample, sheets.cancel, clears);
  const actions = usePreviewActions({ pad, taps, sheets, starting, pick, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  const view = useMemo(
    () => withCard(badmintonPad(snapshot.display, snapshot.sync), snapshot.card),
    [snapshot],
  );
  const chosen = { card: snapshot.card?.kind ?? 'pad', sample } as const;
  const { toss } = starting;
  return { kind: 'pad', view, sheet: sheets.view, line, cardNote, flash, toss, chosen, actions };
}

/** What the screen's actions are built from. */
type ActionParts = {
  readonly pad: FakeBadmintonPad;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof usePadSheets>;
  readonly starting: ReturnType<typeof useStart>;
  readonly pick: (choice: PreviewChoice) => void;
  readonly setCardNote: (note: MessageKey | null) => void;
};

/** Every action the screen sends: Home, the taps, the ending's and the banner's buttons, the sheets, Start, a pick. */
function usePreviewActions(parts: ActionParts): PadPreviewActions {
  const { pad, taps, sheets, starting, pick, setCardNote } = parts;
  const home = useBackToHome();
  const others = useEndingAndCard(pad, taps.opening, setCardNote, sheets.justShown);
  const tool = useGuardedTool(taps.secondTouch, sheets.actions.tool);
  const { tapHalf, undo } = taps;
  return useMemo(
    () => ({ home, tapHalf, undo, ...others, ...sheets.actions, tool, ...starting.actions, pick }),
    [home, tapHalf, undo, others, sheets.actions, tool, starting.actions, pick],
  );
}

/**
 * The app's kept match, or a singles match afresh; picking a sample starts its match afresh, and Start (`fresh`) starts
 * it not started, with no one else's taps.
 */
function usePreviewPad() {
  const ports = usePorts();
  const [held, setHeld] = useState(() => keptFor(ports));
  const startSample = useCallback(
    (sample: PreviewSample, fresh = false) => {
      const match: FakePadSample = fresh ? { ...SAMPLES[sample], others: [] } : SAMPLES[sample];
      const next = { sample, pad: createFakeBadmintonPad(match) };
      kept.set(ports, next);
      setHeld(next);
    },
    [ports],
  );
  return { pad: held.pad, sample: held.sample, startSample };
}

function keptFor(ports: Ports): Held {
  const found = kept.get(ports);
  if (found !== undefined) return found;
  const fresh: Held = { sample: 'singles', pad: createFakeBadmintonPad(SINGLES_SAMPLE) };
  kept.set(ports, fresh);
  return fresh;
}

/**
 * The Start screen (owner, 2026-11-01, option A): the side picked to serve first, then Start match, a tap, which
 * records it through the taps' bounce memory (`useTaps`' `opening`). The pick goes once the match starts, so an Undo
 * back to the Start screen finds none, and with a pick from the preview row. A second Start finds the match started
 * and does nothing, however close behind the first.
 */
function useStart(pad: FakeBadmintonPad, opening: Opening) {
  const [toss, setToss] = useState<PadSide | null>(null);
  const pickServer = useCallback((side: PadSide) => setToss(side), []);
  const clearToss = useCallback(() => setToss(null), []);
  const start = useCallback(() => {
    if (toss === null || pad.snapshot().display.phase !== 'notStarted') return;
    if (opening(START_TAP, () => pad.start(toss))) setToss(null);
  }, [pad, opening, toss]);
  const actions = useMemo(() => ({ pickServer, start }), [pickServer, start]);
  return { toss, clearToss, actions };
}

/**
 * The ending prompt's two buttons: quiet in the bounce window of the prompt appearing (`usePadSheets`' `justShown`),
 * and each an opening tap (`useTaps`): the prompt leaves with it, and a second touch on what was under it counts once.
 */
function useEndingAndCard(
  pad: FakeBadmintonPad,
  opening: Opening,
  setCardNote: (note: MessageKey | null) => void,
  justShown: () => boolean,
) {
  const recordEnding = useCallback(() => {
    if (!justShown()) opening('ending', () => pad.recordEnding());
  }, [pad, opening, justShown]);
  const voidSanction = useCallback(() => {
    if (!justShown()) opening('void', () => pad.voidSanction());
  }, [pad, opening, justShown]);
  const update = useCallback(() => setCardNote('scoring.card.cantOpen'), [setCardNote]);
  return useMemo(
    () => ({ recordEnding, voidSanction, update, browser: update }),
    [recordEnding, voidSanction, update],
  );
}

/** What a pick from the preview row clears: the line, the banner's note, a flash still showing, and the Start pick. */
type Clears = {
  readonly say: Say;
  readonly setCardNote: (note: MessageKey | null) => void;
  readonly setFlash: SetFlash;
  readonly clearToss: () => void;
};

/**
 * The preview row: a card over the same match, a sample afresh, or the next sync status. A pick is no tap: it closes
 * a sheet and clears what the last tap left on screen, its flash included, so the new state never flashes.
 */
function usePick(
  pad: FakeBadmintonPad,
  sample: PreviewSample,
  startSample: (sample: PreviewSample, fresh?: boolean) => void,
  closeSheet: () => void,
  { say, setCardNote, setFlash, clearToss }: Clears,
) {
  return useCallback(
    (choice: PreviewChoice) => {
      closeSheet();
      say(null);
      setCardNote(null);
      setFlash(null);
      clearToss();
      if (choice === 'sync') return pad.setSync(nextSync(pad.snapshot().sync));
      if (choice === 'start') return startSample(sample, true);
      if (choice === 'singles' || choice === 'doubles') return startSample(choice);
      pad.preview(cardOf(choice));
    },
    [pad, sample, startSample, closeSheet, say, setCardNote, setFlash, clearToss],
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
