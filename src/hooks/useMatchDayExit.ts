import { useCallback, useEffect, useRef, useState } from 'react';
import { courtOf, exitRecorded } from '@/domain/matchday/exit';
import { totalStake, type Stake } from '@/domain/matchday/matchDay';
import { scoringHubOf } from '@/hooks/scoringHub';
import { forgetWithCopy } from '@/hooks/useMatchDayHome';
import { unsentOf } from '@/hooks/useMatchDay';
import { cancelOpens, savedDayCode } from '@/hooks/useOpenFromMatchDay';
import { usePorts, type Ports } from '@/hooks/usePorts';

/**
 * Exit (S4 design §4; MD-2 Task 7): the question, and the leaving.
 *
 * `ask` reads what is at stake from the disk as the question is asked (the sender may have emptied a queue since the list
 * last read), and only then does `sheet` hold it: the question never shows before it knows what to say. `stay` closes it
 * and notes the moment (`note`: the screen's bounce window). `exit` never discards a tap. In order, it:
 *
 * 1. reads the stake again and records `matchday.exit {unsent}` (null: a queue could not be read);
 * 2. notes, in a key of its own, the court of each match with taps still going, so Home can say "Sending 3 taps · Court 2";
 * 3. nudges the hub to send now (it never waits for the network: Exit leaves either way);
 * 4. forgets the day code and its copy, a refused forget saying so on Home (as an ended code's does);
 * 5. lets go of the opened matches and of the match open: a match with a queue keeps its own link and queue, and the
 *    hub's sweep takes it once its queue is empty and nothing else holds it; one never tapped goes now, link and all;
 * 6. goes Home.
 *
 * Every step after the first is on its own: one that the phone refuses is recorded and the rest still go. A second
 * `exit` while one is out does nothing.
 */
export function useMatchDayExit(note: () => void = noNote): {
  readonly sheet: Stake | null;
  readonly ask: () => void;
  readonly stay: () => void;
  readonly exit: () => Promise<void>;
} {
  const ports = usePorts();
  const [sheet, setSheet] = useState<Stake | null>(null);
  const asking = useRef(false);
  const exiting = useRef(false);
  const shown = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ask = useCallback(() => {
    if (asking.current || exiting.current || shown.current) return;
    asking.current = true;
    void readStake(ports)
      .then(({ stake }) => {
        if (!mounted.current) return;
        shown.current = true;
        setSheet(stake);
      })
      .finally(() => {
        asking.current = false;
      });
  }, [ports]);
  const stay = useCallback(() => {
    // Back while Exit is leaving is ignored: Exit finishes and goes Home, and no bounce is noted for a screen it left.
    if (!shown.current || exiting.current) return;
    shown.current = false;
    setSheet(null);
    note();
  }, [note]);
  const exit = useCallback(async () => {
    if (exiting.current) return;
    exiting.current = true;
    // An open still in flight would land after Home (final review M1): it is cancelled before anything is read.
    cancelOpens(ports);
    try {
      await leave(ports);
    } finally {
      shown.current = false;
      if (mounted.current) setSheet(null);
    }
  }, [ports]);
  return { sheet, ask, stay, exit };
}

const noNote = (): void => undefined;

/** What Exit would leave behind, and per match: a count, or null for a queue the phone cannot read (`unsentOf`). */
async function readStake(
  ports: Ports,
): Promise<{ readonly stake: Stake; readonly unsent: ReadonlyMap<string, number | null> }> {
  try {
    const unsent = await unsentOf(ports);
    return { stake: totalStake(unsent), unsent };
  } catch {
    // None of the parts rejects; one that does cannot say what is waiting, so it is taps at risk, never none.
    ports.logger.warn('matchday.exit-unreadable');
    return { stake: { count: 0, unreadable: true }, unsent: new Map() };
  }
}

async function leave(ports: Ports): Promise<void> {
  const { stake, unsent } = await readStake(ports);
  ports.logger.info('matchday.exit', { unsent: exitRecorded(stake) });
  // The courts come from the day's copy, so they are noted before the copy goes. The list is let go of BEFORE the code
  // is forgotten (a death between the two leaves a code and no list, which is harmless: no token is stranded), and the
  // hub is nudged last, so its sweep sees neither the list nor the day (review I1, I2). A queue with taps keeps its link
  // by the hub's own tidy rule, so nothing is lost by clearing first.
  await noteSending(ports, unsent);
  await letGo(ports);
  await forgetDay(ports);
  scoringHubOf(ports)
    .resume()
    .catch(() => ports.logger.warn('matchday.exit-send-refused'));
  ports.navigation.go('home');
}

/** The court of every match still holding taps it can send, from the day's last copy; '' for a match on none. */
async function noteSending(
  ports: Ports,
  unsent: ReadonlyMap<string, number | null>,
): Promise<void> {
  const going = [...unsent].filter(([, count]) => count !== null && count > 0);
  if (going.length === 0) return;
  try {
    const code = savedDayCode(ports);
    const copy = code === null ? null : await ports.matchDayStore.readCache(code);
    const courts = new Map(
      going.map(([id]) => [id, copy === null ? '' : (courtOf(copy.day, id) ?? '')] as const),
    );
    await ports.matchDayStore.addSending(courts);
  } catch {
    ports.logger.warn('matchday.sending-refused');
  }
}

/** The code and its copy go. A refused forget leaves the code and says so on Home, as every refused write does (R19). */
async function forgetDay(ports: Ports): Promise<void> {
  const snapshot = ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? (snapshot.saved.codes.matchday ?? null) : null;
  if (saved === null) return;
  try {
    await forgetWithCopy(ports, saved);
  } catch {
    ports.logger.warn('store.write-refused', { action: 'forget' });
    ports.homeNews.post('store.saveFailed');
  }
}

/**
 * Match Day lets go of the matches it opened, including an id a dismissed dead-link card left (T5 c7), and the open one.
 * A match viewed and never tapped has no queue for a sweep to find, so the hub leaves it first (final review I1).
 */
async function letGo(ports: Ports): Promise<void> {
  await scoringHubOf(ports)
    .letGoOfOpened()
    .catch(() => ports.logger.warn('store.write-refused', { action: 'exit' }));
  await ports.matchDayStore
    .clearOpen()
    .catch(() => ports.logger.warn('matchday.open-clear-refused'));
}
