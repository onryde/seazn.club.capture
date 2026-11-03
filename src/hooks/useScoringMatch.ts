import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { TAKEN, refusing, type PadLineWords, type PadOutcome } from '@/domain/scoring/padLine';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { viewAs, type MatchPad, type MatchView } from '@/domain/scoring/scoringMatchView';
import type { ScoringSport, SportTypes } from '@/domain/scoring/scoringSport';
import { uuidV4 } from '@/domain/scoring/tapKey';
import { browserTarget } from '@/hooks/browserTarget';
import type { ScoringMatch } from '@/hooks/padScreenModel';
import { scoringHubOf } from '@/hooks/scoringHub';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useUndoWindow } from '@/hooks/useUndoWindow';
import type { MessageKey } from '@/i18n/messages';
import type { Logger } from '@/services/logger';

/**
 * One scoring match for a sport's pad screen (plan S2-1 Task 9): the pad, as the sport's own hook makes it, or the state
 * that takes its place. The hub gives the match one focused runner (`scoringHub.ts`), the runner holds its state
 * (`scoringRunner.ts`, over the pure reducer `scoringMatch.ts`), and this hook reads it with `useSyncExternalStore`.
 * Nothing here decides what a tap means.
 *
 * The same for every sport (owner, 2026-11-02: "pad per sport must"): a sport's screen names its sport and its pad hook
 * (badminton's: `useBadmintonMatch`), and reads the match through that sport (`viewAs`), typed by it. The pad hook is
 * handed the pad's facts only for a match of its own sport, so a sport's taps only ever reach that sport.
 */

/** Where the update banner's first button goes: the app's own page in the store. */
export const STORE_URL = 'https://play.google.com/store/apps/details?id=com.seazn.capture';

const LOADING: RunnerSnapshot = { kind: 'loading' };
const noSubscribe = (): (() => void) => () => undefined;
const loadingSnapshot = (): RunnerSnapshot => LOADING;
const NOT_NOW: PadOutcome = refusing('notNow');

/**
 * A sport's pad hook: its screen's model from the match's pad (null while the match is not a pad: loading, or a state
 * of its own), and the runner it sends to. Called on every render, so it is the same hook every time.
 */
export type SportPadHook<S extends SportTypes, Pad> = (
  ports: Ports,
  runner: ScoringRunner | null,
  pad: MatchPad<S> | null,
) => Pad | null;

export function useScoringMatch<S extends SportTypes, Pad>(
  fixtureId: string,
  sport: ScoringSport<S>,
  usePad: SportPadHook<S, Pad>,
): ScoringMatch<Pad> {
  const ports = usePorts();
  const runner = useFocus(ports, fixtureId);
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loadingSnapshot,
  );
  const view = useMemo(
    () => (snapshot.kind === 'ready' ? viewAs(sport, snapshot.state) : null),
    [snapshot, sport],
  );
  // A decided match's Undo is open for 30 s from this phone's own deciding tap (owner, 2026-11-03: the pad's `decidedAt`,
  // dated by the reducer and kept by the hub); the sport's pad hook is handed the pad with that window applied.
  const windowed = useUndoWindow(ports, view?.kind === 'pad' ? view : null);
  const pad = usePad(ports, runner, windowed);
  return resolved(snapshot, view, pad);
}

/** The match's focused runner while this screen is mounted; none for the render before the effect has run. */
export function useFocus(ports: Ports, fixtureId: string): ScoringRunner | null {
  const [runner, setRunner] = useState<ScoringRunner | null>(null);
  useEffect(() => {
    const handle = scoringHubOf(ports).focus(fixtureId);
    setRunner(handle.runner);
    return handle.release;
  }, [ports, fixtureId]);
  return runner?.fixtureId === fixtureId ? runner : null;
}

function resolved<S extends SportTypes, Pad>(
  snapshot: RunnerSnapshot,
  view: MatchView<S> | null,
  pad: Pad | null,
): ScoringMatch<Pad> {
  if (snapshot.kind === 'noLink') return { kind: 'linkGone' };
  if (snapshot.kind === 'unreadable') return { kind: 'unreadable', what: snapshot.what };
  if (snapshot.kind === 'unsupportedSport') return snapshot;
  if (view === null) return { kind: 'loading', offline: false };
  return view.kind === 'pad' ? (pad ?? { kind: 'loading', offline: false }) : view;
}

type Random = {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (to: Uint8Array) => Uint8Array;
};

/** What expo-modules-core installs on `globalThis.expo` (its `ts-declarations/global.ts`): a native v4 UUID. */
type ExpoGlobal = { readonly uuidv4?: unknown };

/** Loggers that have said the runtime has no crypto: once each, however many taps follow. */
const saidNoCrypto = new WeakSet<Logger>();

/**
 * A tap's key, made when it is tapped and never changed (design §7.3): a v4 UUID. First the native generator
 * expo-modules-core puts on `globalThis.expo` (Android's `UUID.randomUUID`, a SecureRandom; iOS's `UUID()`), which is
 * what the phone's Hermes has, since it has no `crypto` of its own (device, 2026-11-02). Only where it is absent, the
 * runtime's own `randomUUID`, else sixteen of its `getRandomValues`. With none, `Math.random` stands in (a key only has
 * to be unique, and the server keys by link too) and the record says so once: a phone like that is worth knowing about.
 */
function newTapKey(logger: Logger): string {
  const native = nativeKey();
  if (native !== null) return native;
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

/**
 * The native generator's key, or null when it is not there, throws, or answers anything but a non-empty string: a tap
 * is never lost, nor keyed '' or `undefined`, for a native module that is not ready (review minor 5 of round 2).
 */
function nativeKey(): string | null {
  const expo = (globalThis as { expo?: ExpoGlobal }).expo;
  if (typeof expo?.uuidv4 !== 'function') return null;
  try {
    const made: unknown = (expo.uuidv4 as () => unknown)();
    return typeof made === 'string' && made !== '' ? made : null;
  } catch {
    return null;
  }
}

/**
 * What a sport's pad hook sends the match: a tap of that sport, Undo (`'ending'`: the sport's ending prompt's, taken only
 * while an ending waits), and words for the line.
 */
export type MatchSender<S extends SportTypes> = {
  readonly tap: (made: S['tap']) => PadOutcome;
  readonly undo: (only?: 'ending') => PadOutcome;
  readonly say: (words: PadLineWords) => void;
  /** The scorer's answer to the reconnect question (owner ruling 43): send the queued taps, or discard them. */
  readonly answer: (answer: 'send' | 'discard') => PadOutcome;
};

/** Hands events to the runner: what each tap came to, at once, or "not now" while there is no runner. */
export function useSender<S extends SportTypes>(
  ports: Ports,
  runner: ScoringRunner | null,
): MatchSender<S> {
  const send = useCallback(
    (event: (key: string, at: string) => MatchEvent): PadOutcome =>
      runner?.dispatch(event(newTapKey(ports.logger), ports.clock().toISOString())) ?? NOT_NOW,
    [runner, ports],
  );
  const tap = useCallback(
    (made: S['tap']) => send((key, at) => ({ kind: 'tap', tap: made, key, at })),
    [send],
  );
  const undo = useCallback(
    (only?: 'ending') =>
      send((key, at) => ({ kind: 'undo', key, at, ...(only === undefined ? {} : { only }) })),
    [send],
  );
  const say = useCallback(
    (words: PadLineWords) => void runner?.dispatch({ kind: 'say', words }),
    [runner],
  );
  const answer = useCallback(
    (made: 'send' | 'discard'): PadOutcome => {
      if (runner === null) return NOT_NOW;
      runner.dispatch({ kind: 'answerAsk', answer: made });
      return TAKEN;
    },
    [runner],
  );
  return useMemo(() => ({ tap, undo, say, answer }), [tap, undo, say, answer]);
}

/** The banner's buttons, through the link port. A page that would not open says so on the banner; the URL never does. */
export function useLinks(
  runner: ScoringRunner | null,
  setCardNote: (note: MessageKey | null) => void,
) {
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
