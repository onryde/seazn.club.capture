import { useCallback, useEffect, useState } from 'react';
import type { SessionState } from '@/domain/session/SessionState';
import { savedStream } from '@/hooks/savedStream';
import { usePorts } from '@/hooks/usePorts';
import { clearingUnderWay, codeStays, useUnpair } from '@/hooks/useUnpair';

type Kind = SessionState['kind'];

export type CourtExit = {
  /** Exit is on the screen: a court code, waiting (Paired). Never on air, never while arming (O5). */
  readonly offered: boolean;
  /** The Leave question is showing. Forced shut whenever Exit is not offered, so an arming engine closes it. */
  readonly open: boolean;
  /**
   * A Leave is under way: unpair sent, at most 5 s (`UNPAIR_GIVE_UP_MS`), after up to 10 s waiting out a start in flight
   * (`START_ANSWER_WAIT_MS`). The screen swallows Back for it, so leaving
   * the screen cannot end the unpair as `left` and forget a code native still holds (whole-branch review I2).
   */
  readonly leaving: boolean;
  ask(): void;
  stay(): void;
  leave(): void;
};

/**
 * Exit on a court code's waiting screen (court stream spec 2026-11-14 §6.4, O5, O12): the only way off a court, and it
 * asks first. Leave follows Home's Forget: unpair, forget the saved code once the engine is Idle, then Home. A remote Go
 * live that wins the race stands (`held`), and the code is kept; so is it when the unpair gives up with the engine not
 * Idle (`codeStays`). A refused forget is never silent (S0 R19): the engine
 * is Idle by then, so it goes Home with "couldn't save" posted there. A second Leave while one is under way is dropped by
 * `useUnpair`. The question belongs to the waiting screen: once the engine arms it closes for good, and it is not
 * still open when the match ends and the court waits again.
 */
export function useCourtExit(court: string | null, kind: Kind): CourtExit {
  const { engine, modeStore, navigation, logger, homeNews } = usePorts();
  const unpair = useUnpair();
  const [asked, setAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const offered = court !== null && kind === 'paired';
  useEffect(() => {
    if (!offered) setAsked(false);
  }, [offered]);
  const ask = useCallback(() => setAsked(true), []);
  const stay = useCallback(() => setAsked(false), []);
  const leave = useCallback(() => {
    setAsked(false);
    const code = savedStream(modeStore); // the code on screen when Leave was pressed (C4b-I2)
    if (code === null) return;
    // A clearing another caller has under way drops this one, and its callback never runs: nothing to swallow Back for.
    if (clearingUnderWay(engine)) return;
    setLeaving(true);
    unpair('forget', (outcome) => {
      setLeaving(false);
      // A Go live won the race (the broadcast stands), or native never answered with the engine still paired: the
      // code and the screen stay, with Exit (P4 review I1). A start in flight is waited out first (useUnpair).
      if (codeStays(outcome, engine)) return;
      void modeStore.forget(code).then(
        (forgot) => (forgot ? navigation.go('home') : undefined),
        () => {
          // The engine is Idle and the code is still saved: never silent (S0 R19). Home says so, and its card still
          // offers Forget (`holdsCourt`'s saved branch; the engine is Idle), so the retry is one tap.
          logger.warn('store.write-refused', { action: 'court-leave' });
          homeNews.post('store.saveFailed');
          navigation.go('home');
        },
      );
    });
  }, [engine, modeStore, navigation, logger, homeNews, unpair]);
  return { offered, open: offered && asked, leaving, ask, stay, leave };
}
