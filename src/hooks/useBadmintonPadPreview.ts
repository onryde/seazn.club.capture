import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { badmintonPad, type BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import { isBounce } from '@/domain/scoring/bounce';
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
  type FakeRefusal,
} from '@/services/fakeBadmintonPad';

export type { PadSheetView } from '@/hooks/usePadSheets';

export type PreviewSample = 'singles' | 'doubles';

/** What the preview row can pick: the pad itself, a state card, a sample match, or the next sync status. */
export type PreviewChoice = 'pad' | PadStateCard['kind'] | PreviewSample | 'sync';

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
  readonly pick: (choice: PreviewChoice) => void;
};

export type BadmintonPadPreview = {
  readonly view: PadView<BadmintonPadKey>;
  readonly sheet: PadSheetView | null;
  readonly line: PadLineWords;
  /** What the update banner's buttons said: the preview opens no store and no browser. */
  readonly cardNote: MessageKey | null;
  readonly chosen: { readonly card: PadStateCard['kind'] | 'pad'; readonly sample: PreviewSample };
  readonly actions: PadPreviewActions;
};

type Say = (words: PadLineWords) => void;

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
  const settle = useSettle(say);
  const refuseScore = useCallback(() => say(INVALID_SCORE), []);
  const sheets = usePadSheets(pad, snapshot.display, settle, refuseScore);
  const taps = useTaps(pad, settle, say);
  const others = useEndingAndCard(pad, settle, setCardNote);
  const pick = usePick(pad, startSample, sheets.cancel, say, setCardNote);
  const home = useBackToHome();
  useBackCloses(sheets.open, sheets.cancel);
  const view = useMemo(
    () => withCard(badmintonPad(snapshot.display, snapshot.sync), snapshot.card),
    [snapshot],
  );
  const actions = useMemo(
    () => ({ home, ...taps, ...others, ...sheets.actions, pick }),
    [home, taps, others, sheets.actions, pick],
  );
  const chosen = { card: snapshot.card?.kind ?? 'pad', sample } as const;
  return { view, sheet: sheets.view, line, cardNote, chosen, actions };
}

/** The app's kept match, or a singles match afresh; picking a sample starts its match afresh. */
function usePreviewPad() {
  const ports = usePorts();
  const [held, setHeld] = useState(() => keptFor(ports));
  const startSample = useCallback(
    (sample: PreviewSample) => {
      const next = { sample, pad: createFakeBadmintonPad(SAMPLES[sample]) };
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

/**
 * A tap on a half and Undo: each counts once for a repeat within the bounce window (`bounce.ts`) of its own last
 * recorded tap, and the line says "Counted once" under the sentence of the tap that counted. A rally on the other half
 * is a different tap and always counts.
 */
function useTaps(pad: FakeBadmintonPad, settle: (outcome: FakeOutcome) => void, say: Say) {
  const { clock } = usePorts();
  const last = useRef<{ readonly tap: string; readonly at: number } | null>(null);
  const once = useCallback(
    (tap: string, make: () => FakeOutcome) => {
      const at = clock().getTime();
      const prior = last.current;
      if (prior !== null && prior.tap === tap && isBounce(at - prior.at)) return say(COUNTED_ONCE);
      const outcome = make();
      settle(outcome);
      if (outcome.ok) last.current = { tap, at };
    },
    [clock, settle, say],
  );
  const tapHalf = useCallback((side: PadSide) => once(side, () => pad.rally(side)), [once, pad]);
  const undo = useCallback(() => once('undo', () => pad.undo()), [once, pad]);
  return useMemo(() => ({ tapHalf, undo }), [tapHalf, undo]);
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

/** The preview row: a card over the same match, a sample afresh, or the next sync status. */
function usePick(
  pad: FakeBadmintonPad,
  startSample: (sample: PreviewSample) => void,
  closeSheet: () => void,
  say: Say,
  setCardNote: (note: MessageKey | null) => void,
) {
  return useCallback(
    (choice: PreviewChoice) => {
      closeSheet();
      say(null);
      setCardNote(null);
      if (choice === 'sync') return pad.setSync(nextSync(pad.snapshot().sync));
      if (choice === 'singles' || choice === 'doubles') return startSample(choice);
      pad.preview(cardOf(choice));
    },
    [pad, startSample, closeSheet, say, setCardNote],
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
