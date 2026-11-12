import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import { dayCodeOf, type SavedDayCode } from '@/domain/mode/dayCode';
import type { SavedCode } from '@/domain/mode/savedCode';
import { askDay, forgetWithCopy, keepCopy, type Verdict } from '@/hooks/useMatchDayHome';
import { usePorts, type Ports } from '@/hooks/usePorts';

/** S4 design §5: the list reads the day again this often while it is on screen and the app is in the foreground. */
export const MATCHDAY_POLL_MS = 15_000;

/**
 * `loading`: no answer yet (the last copy, if any, shows meanwhile); `ready`: the server's day, read at `updatedAt`;
 * `offline`: no answer the phone can act on, so the last copy shows with when it was read, or nothing without one;
 * `refused`: the code has ended, been withdrawn, is unknown, or its day has not opened, and the list is going Home.
 */
export type MatchDayListState = 'loading' | 'ready' | 'offline' | 'refused';

type Shown = {
  readonly state: MatchDayListState;
  readonly day: MatchDay | null;
  readonly updatedAt: Date | null;
  readonly refusal: MatchDayRefusal | null;
  /**
   * The unsent taps of each match opened from Match Day (`matchDayStore.opened()`), read with each read of the day: a
   * count, or null for a queue the phone cannot read (its taps are at risk, as `atStake` says). A match with nothing
   * waiting is not in it. Exit (Task 7) reads the same map (`totalStake`).
   */
  readonly unsent: ReadonlyMap<string, number | null>;
};

export type MatchDayList = Shown & {
  /** Reads the day now (pull to refresh, Try again); nothing while a read is out. */
  readonly refresh: () => void;
  /** A read is out: a pull's spinner and Try again's wait show it (review M4). */
  readonly reading: boolean;
};

type SetShown = Dispatch<SetStateAction<Shown>>;
/** The saved day code, and the origin and token this build reads from it. */
type Held = { readonly saved: SavedCode; readonly code: SavedDayCode };
type Read = { readonly verdict: Verdict; readonly unsent: ReadonlyMap<string, number | null> };

const NONE_UNSENT: ReadonlyMap<string, number | null> = new Map();
const LOADING: Shown = {
  state: 'loading',
  day: null,
  updatedAt: null,
  refusal: null,
  unsent: NONE_UNSENT,
};

/**
 * Match Day's list (S4 design §5; MD-2 Task 4). The day's last copy is read first and shown at once; then the server is
 * asked, at once and every `MATCHDAY_POLL_MS` while the list is mounted and the app is in the foreground (the list is
 * replaced, never covered, when the app moves on), one read at a time. Each good answer is kept as the copy. An answer
 * that lands after the list has gone, or after its code has (Exit), changes nothing and writes nothing (Review Focus 5).
 * A code that has ended, been withdrawn or is unknown is forgotten with its copy and the list goes Home with the line;
 * one whose day has not opened goes Home saying when it opens. With no day code to list, it goes Home.
 */
export function useMatchDay(): MatchDayList {
  const { ready, held } = useHeldDay();
  const [shown, setShown] = useState<Shown>(LOADING);
  useNoDayGoesHome(ready, held);
  const primed = useLastCopy(held, setShown);
  const { ask, reading } = useAsk(held, setShown);
  usePoll(primed && held !== null, ask);
  return useMemo(() => ({ ...shown, refresh: ask, reading }), [shown, ask, reading]);
}

/** The saved day code as the store holds it now, when this build can address it. */
function useHeldDay(): { readonly ready: boolean; readonly held: Held | null } {
  const { modeStore, hosts } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const saved = snapshot.status === 'ready' ? (snapshot.saved.codes.matchday ?? null) : null;
  const held = useMemo(() => {
    const code = saved === null ? null : dayCodeOf(saved.raw, hosts);
    return saved === null || code === null ? null : { saved, code };
  }, [saved, hosts]);
  return { ready: snapshot.status === 'ready', held };
}

/** No day code to list (none saved, or none this build can address): Home, whose tile scans for one. */
function useNoDayGoesHome(ready: boolean, held: Held | null): void {
  const { navigation } = usePorts();
  const none = ready && held === null;
  useEffect(() => {
    if (none) navigation.go('home');
  }, [none, navigation]);
}

/**
 * The day's last copy for this code, read once before the first ask, so the list shows it at once and the first answer
 * always lands after it. Resolves `primed` whether or not there was one (`readCache` never rejects).
 */
function useLastCopy(held: Held | null, setShown: SetShown): boolean {
  const { matchDayStore } = usePorts();
  const [primed, setPrimed] = useState(false);
  const code = held?.code ?? null;
  useEffect(() => {
    if (code === null) return;
    void matchDayStore.readCache(code).then((copy) => {
      if (copy !== null) setShown((now) => ({ ...now, day: copy.day, updatedAt: copy.at }));
      setPrimed(true);
    });
  }, [code, matchDayStore, setShown]);
  return primed;
}

/**
 * One read of the day (and of the unsent taps) at a time; its answer counts only while the list and its code stand. A
 * read that rejects (none should: each part says it never does) reads as offline and is recorded, and the next read
 * still goes (review M3: a flag left up would stop the poll and Try again for good).
 */
function useAsk(held: Held | null, setShown: SetShown): { ask: () => void; reading: boolean } {
  const ports = usePorts();
  const flying = useRef(false);
  const [reading, setReading] = useState(false);
  const mounted = useMounted();
  const ask = useCallback(() => {
    if (held === null || flying.current) return;
    flying.current = true;
    setReading(true);
    // Review Focus 5: after the list has gone, or after Exit forgot its code, an answer changes nothing.
    const stands = () => mounted.current && stillSaved(ports, held.saved);
    void readOnce(ports, held.code)
      .then((read) => (stands() ? settle(ports, held, read, setShown) : undefined))
      .catch(() => {
        ports.logger.warn('matchday.read-failed');
        if (stands()) setShown((now) => ({ ...now, state: 'offline' }));
      })
      .finally(() => {
        flying.current = false;
        setReading(false);
      });
  }, [ports, held, mounted, setShown]);
  return { ask, reading };
}

function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Asks at once and every `MATCHDAY_POLL_MS` while `on` and in the foreground; the way back asks at once again. */
function usePoll(on: boolean, ask: () => void): void {
  const { foreground } = usePorts();
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => clearInterval(timer);
    const start = () => {
      stop();
      ask();
      timer = setInterval(ask, MATCHDAY_POLL_MS);
    };
    if (foreground.isForeground()) start();
    const offReturn = foreground.subscribe(start);
    const offLeave = foreground.subscribeBackground(stop);
    return () => {
      stop();
      offReturn();
      offLeave();
    };
  }, [on, ask, foreground]);
}

async function readOnce(ports: Ports, code: SavedDayCode): Promise<Read> {
  const [verdict, unsent] = await Promise.all([askDay(ports, code), unsentOf(ports)]);
  return { verdict, unsent };
}

/**
 * The unsent taps of each match opened from Match Day, from one listing of the tap queues, with `atStake`'s meaning: a
 * count, or null for a queue that cannot be read, whose taps are at risk (review I1: never silently nothing). A queue
 * with nothing in it is left out. With none opened, the disk is not read.
 */
async function unsentOf(ports: Ports): Promise<ReadonlyMap<string, number | null>> {
  const opened = new Set(await ports.matchDayStore.opened());
  if (opened.size === 0) return NONE_UNSENT;
  const counted = new Map<string, number | null>();
  for (const entry of await ports.tapQueue.list()) {
    const id = entry.kind === 'queue' ? entry.queue.fixtureId : entry.fixtureId;
    if (!opened.has(id)) continue;
    const unsent = entry.kind === 'queue' ? entry.queue.pending.length : null;
    if (unsent !== 0) counted.set(id, unsent);
  }
  return counted;
}

/** The store still holds this day code: a forget (Exit, or a code that ended) means it does not. */
function stillSaved(ports: Ports, saved: SavedCode): boolean {
  const snapshot = ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' && snapshot.saved.codes.matchday?.raw === saved.raw;
}

function settle(ports: Ports, held: Held, read: Read, setShown: SetShown): void {
  const { verdict, unsent } = read;
  switch (verdict.kind) {
    case 'open':
      setShown({
        state: 'ready',
        day: verdict.day,
        updatedAt: ports.clock(),
        refusal: null,
        unsent,
      });
      void keepCopy(ports, held.code, verdict.day);
      return;
    case 'offline':
      return setShown((now) => ({ ...now, state: 'offline', unsent }));
    case 'stop':
    case 'notYet':
      setShown((now) => ({ ...now, state: 'refused', refusal: verdict.refusal, unsent }));
      // Review M3: a move Home that throws (the router's own fault) is recorded, never left unhandled.
      void leaveDay(ports, held.saved, verdict).catch(() =>
        ports.logger.warn('matchday.leave-failed'),
      );
  }
}

/**
 * S4 design §4, from the list: the line is left for Home first (a forget sends the list Home by itself), then a code
 * that is over is forgotten with its copy, and the list goes Home. A forget the phone refuses says so instead, and is
 * recorded (R19). A day not open yet keeps its code.
 */
export async function leaveDay(
  ports: Ports,
  saved: SavedCode,
  verdict: Extract<Verdict, { kind: 'stop' | 'notYet' }>,
): Promise<void> {
  ports.homeNews.post(verdict.kind === 'stop' ? verdict.line : verdict.news);
  if (verdict.kind === 'stop') {
    try {
      await forgetWithCopy(ports, saved);
    } catch {
      ports.logger.warn('store.write-refused', { action: 'forget' });
      ports.homeNews.post('store.saveFailed');
    }
  }
  ports.navigation.go('home');
}
