import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { badmintonPad, type BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import { isBounce } from '@/domain/scoring/bounce';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import {
  withCard,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadView,
} from '@/domain/scoring/padView';
import { useBackCloses } from '@/hooks/useBackCloses';
import { usePadSheets, type PadSheetView } from '@/hooks/usePadSheets';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import {
  createFakeBadmintonPad,
  DOUBLES_SAMPLE,
  SINGLES_SAMPLE,
  type FakeBadmintonPad,
  type FakeOutcome,
  type FakePadSample,
  type FakeRefusal,
} from '@/services/fakeBadmintonPad';

export type { PadSheetView } from '@/hooks/usePadSheets';

export type PreviewSample = 'singles' | 'doubles';

/**
 * What the preview row can pick: the pad itself, a state card, a sample match, the next sync status, or Start: the
 * sample's match afresh and not started, the Start screen (owner, 2026-11-01).
 */
export type PreviewChoice = 'pad' | PadStateCard['kind'] | PreviewSample | 'sync' | 'start';

/**
 * What the last-tap line says beside the last tap's sentence: a refusal (in caution, in the sentence's place: the tap
 * did not count) or a note (under the sentence, which stays: a bounced repeat that counted once).
 */
export type PadLineWords =
  | { readonly kind: 'refusal'; readonly key: MessageKey }
  | { readonly kind: 'note'; readonly key: MessageKey }
  | null;

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
  /** The update banner's two buttons: in the preview they open nothing, and say so on the banner. */
  readonly update: () => void;
  readonly browser: () => void;
  /** Match details (owner ruling 15, then 2026-11-01): where the match sits and its rules, in a sheet over the pad. */
  readonly details: () => void;
  /** History (owner ruling 21): every entry on the sheet, newest first, in a cover over the pad; view only. */
  readonly history: () => void;
  /** The Start screen (owner, 2026-11-01, option A): who serves first, picked; then Start match, a tap. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  readonly pick: (choice: PreviewChoice) => void;
};

export type BadmintonPadPreview = {
  readonly view: PadView<BadmintonPadKey>;
  readonly sheet: PadSheetView | null;
  readonly line: PadLineWords;
  /** What the update banner's buttons said: the preview opens no store and no browser. */
  readonly cardNote: MessageKey | null;
  /** The last tap on a half that counted, for its flash (owner ruling 14; `flashCue`). */
  readonly flash: HalfFlash;
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly chosen: { readonly card: PadStateCard['kind'] | 'pad'; readonly sample: PreviewSample };
  readonly actions: PadPreviewActions;
};

type Say = (words: PadLineWords) => void;
type SetFlash = (flash: HalfFlash) => void;

const REFUSAL: Readonly<Record<FakeRefusal, MessageKey>> = {
  notNow: 'scoring.refusal.notNow',
  invalidScore: 'scoring.refusal.invalidScore',
  nothingToUndo: 'scoring.refusal.nothingToUndo',
};
const COUNTED_ONCE: PadLineWords = { kind: 'note', key: 'scoring.pad.countedOnce' };
const INVALID_SCORE: PadLineWords = { kind: 'refusal', key: REFUSAL.invalidScore };

const SAMPLES = { singles: SINGLES_SAMPLE, doubles: DOUBLES_SAMPLE } as const;

/** The dev row's sync statuses, in order; made-up counts. */
const SYNC_CYCLE: readonly PadSync[] = [
  { kind: 'synced' },
  { kind: 'sending', count: 1 },
  { kind: 'offline', count: 3 },
  { kind: 'refused', count: 1 },
];

type Held = { readonly sample: PreviewSample; readonly pad: FakeBadmintonPad };

/**
 * The match each app keeps while it runs, keyed by its Ports (one per launch, one per test): Back leaves the preview
 * freely (owner ruling 10), and a return finds the match where it was, a disqualification's ending prompt included.
 * Preview state only; S2's real pad reads the engine, which keeps the match itself.
 */
const kept = new WeakMap<Ports, Held>();

/**
 * The S2 design preview of the badminton pad, on a fake that keeps simple counters (`fakeBadmintonPad.ts`): no engine,
 * no network, no code. The match lives in the fake; this hook holds what is on screen over it (a sheet, what the line
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
  const refuseScore = useCallback(() => say(INVALID_SCORE), []);
  const sheets = usePadSheets(pad, snapshot, settle, refuseScore);
  const taps = useTaps(pad, settle, say, setFlash);
  const others = useEndingAndCard(pad, settle, setCardNote);
  const starting = useStart(pad, taps.start);
  const tool = useGuardedTool(taps.afterStart, sheets.actions.tool);
  const { clearToss } = starting;
  const pick = usePick(pad, sample, startSample, sheets.cancel, {
    say,
    setCardNote,
    setFlash,
    clearToss,
  });
  const home = useBackToHome();
  useBackCloses(sheets.open, sheets.cancel);
  const view = useMemo(
    () => withCard(badmintonPad(snapshot.display, snapshot.sync), snapshot.card),
    [snapshot],
  );
  const actions = useMemo(
    () => ({
      home,
      tapHalf: taps.tapHalf,
      undo: taps.undo,
      ...others,
      ...sheets.actions,
      tool,
      ...starting.actions,
      pick,
    }),
    [home, taps.tapHalf, taps.undo, others, sheets.actions, tool, starting.actions, pick],
  );
  const chosen = { card: snapshot.card?.kind ?? 'pad', sample } as const;
  const { toss } = starting;
  return { view, sheet: sheets.view, line, cardNote, flash, toss, chosen, actions };
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

/** A recorded tap clears what the line said; a refused one says why. */
function useSettle(say: Say): (outcome: FakeOutcome) => void {
  return useCallback(
    (outcome: FakeOutcome) =>
      say(outcome.ok ? null : { kind: 'refusal', key: REFUSAL[outcome.refusal] }),
    [say],
  );
}

/** Start match's tap in the bounce memory: within its window every tap of the pad is its second tap. */
const START_TAP = 'start';

/**
 * A tap on a half and Undo: each counts once for a repeat within the bounce window (`bounce.ts`) of its own last
 * recorded tap, and the line says "Counted once" under the sentence of the tap that counted. A rally on the other half
 * is a different tap and always counts. A tap on a half that counted is the half's flash, numbered on from the last
 * one (owner ruling 14); a bounce or a refusal flashes nothing. Start match opens the window for every tap: the second
 * tap of a fast double tap on it lands on the pad that took the Start screen's place, a half, Undo or a tool
 * (hardening, 2026-11-01), and is counted once with it; a tool then opens nothing (`afterStart`).
 */
function useTaps(
  pad: FakeBadmintonPad,
  settle: (outcome: FakeOutcome) => void,
  say: Say,
  setFlash: SetFlash,
) {
  const { clock } = usePorts();
  const last = useRef<{ readonly tap: string; readonly at: number } | null>(null);
  const flashes = useRef(0);
  const once = useCallback(
    (tap: string, make: () => FakeOutcome): boolean => {
      const at = clock().getTime();
      const prior = last.current;
      const repeat = prior !== null && (prior.tap === tap || prior.tap === START_TAP);
      if (repeat && isBounce(at - prior.at)) {
        say(COUNTED_ONCE);
        return false;
      }
      const outcome = make();
      settle(outcome);
      if (outcome.ok) last.current = { tap, at };
      return outcome.ok;
    },
    [clock, settle, say],
  );
  const tapHalf = useCallback(
    (side: PadSide) => {
      if (!once(side, () => pad.rally(side))) return;
      flashes.current += 1;
      setFlash({ side, seq: flashes.current });
    },
    [once, pad, setFlash],
  );
  const undo = useCallback(() => void once('undo', () => pad.undo()), [once, pad]);
  const start = useCallback(
    (server: PadSide) => once(START_TAP, () => pad.start(server)),
    [once, pad],
  );
  const afterStart = useCallback((): boolean => {
    const prior = last.current;
    if (prior?.tap !== START_TAP || !isBounce(clock().getTime() - prior.at)) return false;
    say(COUNTED_ONCE);
    return true;
  }, [clock, say]);
  return useMemo(() => ({ tapHalf, undo, start, afterStart }), [tapHalf, undo, start, afterStart]);
}

/** A tool's sheet, unless the tap is Start match's second (`useTaps`'s `afterStart`): then it opens nothing. */
function useGuardedTool(afterStart: () => boolean, open: (id: string) => void) {
  return useCallback(
    (id: string) => {
      if (!afterStart()) open(id);
    },
    [afterStart, open],
  );
}

/**
 * The Start screen (owner, 2026-11-01, option A): the side picked to serve first, then Start match, a tap, which
 * records it through the taps' bounce memory (`useTaps`'s `start`). The pick goes once the match starts, so an Undo
 * back to the Start screen finds none, and with a pick from the preview row. A second Start finds the match started
 * and does nothing, however close behind the first.
 */
function useStart(pad: FakeBadmintonPad, record: (server: PadSide) => boolean) {
  const [toss, setToss] = useState<PadSide | null>(null);
  const pickServer = useCallback((side: PadSide) => setToss(side), []);
  const clearToss = useCallback(() => setToss(null), []);
  const start = useCallback(() => {
    if (toss === null || pad.snapshot().display.phase !== 'notStarted') return;
    if (record(toss)) setToss(null);
  }, [pad, record, toss]);
  const actions = useMemo(() => ({ pickServer, start }), [pickServer, start]);
  return { toss, clearToss, actions };
}

function useEndingAndCard(
  pad: FakeBadmintonPad,
  settle: (outcome: FakeOutcome) => void,
  setCardNote: (note: MessageKey | null) => void,
) {
  const recordEnding = useCallback(() => settle(pad.recordEnding()), [pad, settle]);
  const voidSanction = useCallback(() => settle(pad.voidSanction()), [pad, settle]);
  const update = useCallback(() => setCardNote('scoring.preview.noop'), [setCardNote]);
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
