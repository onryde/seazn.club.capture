import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BadmintonSanction, BadmintonTap } from '@/domain/scoring/badmintonPad';
import {
  refusalLine,
  refusing,
  type PadLineWords,
  type PadOutcome,
} from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { viewOf, type MatchView } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import { uuidV4 } from '@/domain/scoring/tapKey';
import { browserTarget } from '@/hooks/browserTarget';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import { scoringHubOf } from '@/hooks/scoringHub';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import { usePadSheets, type PadSheetDriver, type PadSheetSnapshot } from '@/hooks/usePadSheets';
import { START_TAP, useGuardedTool, useSettle, useTaps } from '@/hooks/usePadTaps';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import type { Logger } from '@/services/logger';

/**
 * One scoring match for the pad screen (plan S2-1 Task 9): the pad as `PadScreenModel`, or the state that takes its
 * place. The hub gives the match one focused runner (`scoringHub.ts`), the runner holds its state (`scoringRunner.ts`,
 * over the pure reducer `scoringMatch.ts`), and this hook reads it with `useSyncExternalStore` and turns the scorer's
 * touches into events for it. Nothing here decides what a tap means.
 */

/** Where the update banner's first button goes: the app's own page in the store. */
export const STORE_URL = 'https://play.google.com/store/apps/details?id=com.seazn.capture';

const LOADING: RunnerSnapshot = { kind: 'loading' };
const noSubscribe = (): (() => void) => () => undefined;
const loadingSnapshot = (): RunnerSnapshot => LOADING;
const NOT_NOW: PadOutcome = refusing('notNow');

type PadFacts = Extract<MatchView, { kind: 'pad' }>;

export function useScoringMatch(fixtureId: string): ScoringMatch {
  const ports = usePorts();
  const runner = useFocus(ports, fixtureId);
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loadingSnapshot,
  );
  const view = useMemo(
    () => (snapshot.kind === 'ready' ? viewOf(snapshot.state) : null),
    [snapshot],
  );
  const pad = usePad(ports, runner, view?.kind === 'pad' ? view : null);
  return resolved(snapshot, view, pad);
}

/** The match's focused runner while this screen is mounted; none for the render before the effect has run. */
function useFocus(ports: Ports, fixtureId: string): ScoringRunner | null {
  const [runner, setRunner] = useState<ScoringRunner | null>(null);
  useEffect(() => {
    const handle = scoringHubOf(ports).focus(fixtureId);
    setRunner(handle.runner);
    return handle.release;
  }, [ports, fixtureId]);
  return runner?.fixtureId === fixtureId ? runner : null;
}

function resolved(
  snapshot: RunnerSnapshot,
  view: MatchView | null,
  pad: PadScreenModel | null,
): ScoringMatch {
  if (snapshot.kind === 'noLink') return { kind: 'linkGone' };
  if (snapshot.kind === 'unreadable') return { kind: 'unreadable', what: snapshot.what };
  if (view === null) return { kind: 'loading', offline: false };
  return view.kind === 'pad' ? (pad ?? { kind: 'loading', offline: false }) : view;
}

type Random = {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (to: Uint8Array) => Uint8Array;
};

/** Loggers that have said the runtime has no crypto: once each, however many taps follow. */
const saidNoCrypto = new WeakSet<Logger>();

/**
 * A tap's key, made when it is tapped and never changed (design §7.3): a v4 UUID, from the runtime's own
 * `randomUUID`, else sixteen of its `getRandomValues`. With neither, `Math.random` stands in (a key only has to be
 * unique, and the server keys by link too) and the record says so once: a phone like that is worth knowing about.
 */
function newTapKey(logger: Logger): string {
  const random = (globalThis as { crypto?: Random }).crypto;
  if (random?.randomUUID !== undefined) return random.randomUUID();
  const bytes = new Uint8Array(16);
  if (random?.getRandomValues !== undefined) random.getRandomValues(bytes);
  else {
    if (!saidNoCrypto.has(logger)) logger.warn('scoring.keyFallback', {});
    saidNoCrypto.add(logger);
    bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  }
  return uuidV4(bytes);
}

type Sender = {
  readonly tap: (made: BadmintonTap) => PadOutcome;
  readonly undo: (only?: 'sanction') => PadOutcome;
  readonly say: (words: PadLineWords) => void;
};

/** Hands events to the runner: what each tap came to, at once, or "not now" while there is no runner. */
function useSender(ports: Ports, runner: ScoringRunner | null): Sender {
  const send = useCallback(
    (event: (key: string, at: string) => MatchEvent): PadOutcome =>
      runner?.dispatch(event(newTapKey(ports.logger), ports.clock().toISOString())) ?? NOT_NOW,
    [runner, ports],
  );
  const tap = useCallback(
    (made: BadmintonTap) => send((key, at) => ({ kind: 'tap', tap: made, key, at })),
    [send],
  );
  const undo = useCallback(
    (only?: 'sanction') =>
      send((key, at) => ({ kind: 'undo', key, at, ...(only === undefined ? {} : { only }) })),
    [send],
  );
  const say = useCallback(
    (words: PadLineWords) => void runner?.dispatch({ kind: 'say', words }),
    [runner],
  );
  return useMemo(() => ({ tap, undo, say }), [tap, undo, say]);
}

function usePad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): PadScreenModel | null {
  const sender = useSender(ports, runner);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const settle = useSettle(sender.say);
  const driver = useMemo(
    () => ({
      rally: (side: PadSide) => sender.tap({ kind: 'rally', side }),
      undo: () => sender.undo(),
    }),
    [sender],
  );
  const taps = useTaps(driver, settle, sender.say, setFlash);
  const sheets = useSheets(sender, taps.opening, pad);
  const actions = useActions({ sender, runner, pad, taps, sheets, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  return useMemo(
    () =>
      pad === null
        ? null
        : {
            kind: 'pad',
            view: pad.view,
            sheet: sheets.view,
            line: pad.line,
            cardNote,
            flash,
            toss: pad.toss,
            actions,
          },
    [pad, sheets.view, cardNote, flash, actions],
  );
}

/** The sheets over the pad: closed at once when the link dies, since the bad-link card then shows (round 8 hardening). */
function useSheets(
  sender: Sender,
  opening: ReturnType<typeof useTaps>['opening'],
  pad: PadFacts | null,
) {
  const { tap, say } = sender;
  const driver = useMemo<PadSheetDriver>(
    () => ({
      sanction: (sanction: BadmintonSanction) => tap({ kind: 'sanction', ...sanction }),
      setScore: (first, second) => tap({ kind: 'setScore', first, second }),
    }),
    [tap],
  );
  const refuseScore = useCallback(() => say(refusalLine('scoring.refusal.invalidScore')), [say]);
  const snapshot = useMemo<PadSheetSnapshot | null>(
    () =>
      pad === null ? null : { display: pad.display, history: pad.history, card: pad.view.card },
    [pad],
  );
  const sheets = usePadSheets(driver, snapshot, opening, refuseScore);
  const dead = pad?.view.card?.kind === 'linkInvalid';
  const { open, cancel } = sheets;
  useEffect(() => {
    if (dead && open) cancel();
  }, [dead, open, cancel]);
  return sheets;
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): PadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const ending = useEnding(parts);
  const links = useLinks(parts.runner, parts.setCardNote);
  const tool = useGuardedTool(taps.secondTouch, sheets.actions.tool);
  const { tapHalf, undo } = taps;
  return useMemo(
    () => ({ home, tapHalf, undo, ...sheets.actions, tool, ...ending, ...links, ...start }),
    [home, tapHalf, undo, tool, sheets.actions, ending, links, start],
  );
}

/** The Start screen: the pick goes to the match, and Start match is a tap carrying it, through the bounce memory. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const toss = pad?.toss ?? null;
  const { tap } = sender;
  const { opening } = taps;
  const pickServer = useCallback(
    (side: PadSide) => void runner?.dispatch({ kind: 'pickServer', side }),
    [runner],
  );
  const start = useCallback(() => {
    if (toss !== null) opening(START_TAP, () => tap({ kind: 'start', server: toss }));
  }, [opening, tap, toss]);
  return useMemo(() => ({ pickServer, start }), [pickServer, start]);
}

/** The ending prompt's buttons: quiet in the bounce window of the prompt appearing, each an opening tap. */
function useEnding({ sender, pad, taps, sheets }: Parts) {
  const { tap, undo } = sender;
  const { opening } = taps;
  const { justShown } = sheets;
  const waiting = pad?.display.awaitingEnding === true ? pad.display.sanctions.at(-1) : undefined;
  const recordEnding = useCallback(() => {
    if (waiting === undefined || justShown()) return;
    opening('ending', () => tap({ kind: 'ending', side: waiting.side, person: waiting.person }));
  }, [waiting, opening, tap, justShown]);
  const voidSanction = useCallback(() => {
    if (!justShown()) opening('void', () => undo('sanction'));
  }, [opening, undo, justShown]);
  return useMemo(() => ({ recordEnding, voidSanction }), [recordEnding, voidSanction]);
}

/** The banner's buttons, through the link port. A page that would not open says so on the banner; the URL never does. */
function useLinks(runner: ScoringRunner | null, setCardNote: (note: MessageKey | null) => void) {
  const { link, hosts } = usePorts();
  const open = useCallback(
    (url: string) => {
      link.openUrl(url).then(
        () => setCardNote(null),
        () => setCardNote('scoring.card.cantOpen'),
      );
    },
    [link, setCardNote],
  );
  const update = useCallback(() => open(STORE_URL), [open]);
  const browser = useCallback(() => {
    const target = browserTarget(hosts[0] ?? '', runner?.link() ?? null);
    if (target === null) setCardNote('scoring.card.cantOpen');
    else open(target);
  }, [runner, hosts, open, setCardNote]);
  return useMemo(() => ({ update, browser }), [update, browser]);
}
