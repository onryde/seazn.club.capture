import { useEffect, useRef } from 'react';
import { savedCodeName, type CodeName } from '@/domain/mode/codeName';
import { forgetsSaved, tapToPairMark } from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { selectEngineStatus, selectHeldName, selectUnpairedName } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';

const nameIf = (on: boolean, snapshot: EngineSnapshot): CodeName | null =>
  on ? selectHeldName(snapshot) : null;

type Facts = ReturnType<typeof factsOf>;

/**
 * The snapshot's facts the saved-code rules read. An end over a code the server has ended (`codeEndedPending`, the
 * 401 held to the end) is `stopped` whoever ended it (ruling M-5): the code is dead, so it is forgotten like the one
 * the operator's Stop spends, and not kept for a Continue that could only re-arm a dead code. A fatal end is also
 * `failed` either way, but the forget rule is read before the mark (`forgetsSaved`, then `tapToPairMark`), so a
 * dead code is forgotten and never marked, and a fatal end over a live code is kept and marked for Continue.
 */
function factsOf(snapshot: EngineSnapshot) {
  const { state } = snapshot;
  const ended = state.kind === 'ended';
  const codeDead = snapshot.codeEndedPending;
  const operatorStopped = ended && state.reason === 'operator-stopped';
  const fatal = ended && state.reason === 'fatal-error';
  return {
    unpaired: selectUnpairedName(snapshot),
    stopped: nameIf(operatorStopped || (fatal && codeDead), snapshot),
    failed: nameIf(fatal, snapshot),
    paired: nameIf(state.kind === 'paired', snapshot),
  };
}

const keyOf = (name: CodeName | null) =>
  name === null ? null : `${name.code}/${name.slot}/${name.tokenTag}`;

/** Which ending native names, if any: the forget rule's word, as one comparable key. */
function endingOf(facts: Facts): string | null {
  const unpaired = keyOf(facts.unpaired);
  if (unpaired !== null) return `unpaired ${unpaired}`;
  const stopped = keyOf(facts.stopped);
  return stopped === null ? null : `stopped ${stopped}`;
}

/**
 * Applies native's word to what JS keeps, on every snapshot (amendment, The
 * engine port and Process death and reopen): forget the code an unasked unpair,
 * the operator's Stop or a fatal end over a code the server ended names; mark or clear `tapToPair`; and show /stream
 * while a broadcast is held, from wherever the app is. Each write is made once
 * per saved code (`acted`), so 1 Hz snapshots never queue a write each.
 *
 * An ending is about the code saved when JS first heard it (`heard`). Native
 * keeps naming it while Idle or Ended, so the same code scanned again from
 * Home is saved before native pairs it: that fresh save is a new code, and the
 * old ending never forgets it.
 */
export function useEngineFollow(): void {
  const { engine, modeStore, navigation, logger } = usePorts();
  const acted = useRef<{ code: SavedCode; did: string } | null>(null);
  const heard = useRef<{ ending: string | null; code: SavedCode | undefined }>({
    ending: null,
    code: undefined,
  });
  useEffect(() => {
    const once = (code: SavedCode, did: string, write: () => Promise<unknown>) => {
      if (acted.current?.code === code && acted.current.did === did) return;
      acted.current = { code, did };
      write().catch(() => logger.warn('store.write-refused', { action: did }));
    };
    const follow = () => {
      const snapshot = engine.getSnapshot();
      // The route rule: Settings and Diagnostics are inside /stream already (M22).
      if (selectEngineStatus(snapshot) === 'live' && navigation.current() === 'home')
        navigation.go('stream');
      const store = modeStore.getSnapshot();
      // Nothing is heard before the store loads: a cold start's ending names the code it finds.
      if (store.status !== 'ready') return;
      const code = store.saved.codes.stream;
      const facts = factsOf(snapshot);
      const ending = endingOf(facts);
      if (ending !== heard.current.ending) heard.current = { ending, code };
      if (code === undefined || code.stream === null) return;
      // An unreadable raw names nothing (NO_NAME): `sameCode` never matches a null
      // part, so no rule below can forget or mark it (M-4).
      const name = savedCodeName(code);
      if (heard.current.code === code && forgetsSaved({ saved: name, ...facts })) {
        // An unpair the operator did not ask for goes Home, to its panel (Task 29); their Stop goes Home with the card, by StreamScreen's leave (spec §5).
        // Only if this code went: one saved behind the write is a new scan, and the app follows it (C4b-I2).
        const home = facts.unpaired !== null;
        return once(code, 'forget', () =>
          modeStore
            .forget(code)
            .then((forgot) => (forgot && home ? navigation.go('home') : undefined)),
        );
      }
      const mark = tapToPairMark({ saved: name, marked: code.stream.tapToPair, ...facts });
      if (mark !== null) once(code, mark, () => modeStore.markTapToPair(mark === 'mark', code));
    };
    const offEngine = engine.subscribe(follow);
    const offStore = modeStore.subscribe(follow);
    follow();
    return () => {
      offEngine();
      offStore();
    };
  }, [engine, modeStore, navigation, logger]);
}
