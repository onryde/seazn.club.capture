import { POLL_MS, resubscribeWaitMs } from '@/domain/scoring/liveBackoff';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import type { Ports } from '@/hooks/usePorts';

/**
 * The one owner of a focused match's Realtime channel (plan S2-1 Task 9; the Task 8 review). A ping is only ever a
 * reason to read the ledger, so every ping, every `onUp` (a join or a rejoin: the pings in the gap were lost) and every
 * poll is a `read` for the match, which the runner folds into one fetch at a time.
 *
 * - The channel is joined with a fresh grant each time: the port never renews one, and the library retries an expired
 *   token forever. A drop, or no grant at all, is answered by polling every 15 s and by joining again with a new grant
 *   after a wait that grows to five minutes (`resubscribeWaitMs`), so a grant refused every time cannot loop hot.
 * - A channel that comes back by itself (`onUp`) cancels the wait and the polling, and its failures are forgotten.
 * - In the background it is closed and nothing polls; the return joins again. Stopped, nothing it started runs again.
 *
 * Only a focused runner has one. A headless sender never calls this: a second subscription would close the first.
 */
export type LivePorts = Pick<Ports, 'scoring' | 'realtime' | 'foreground'>;
export type LiveRunner = Pick<ScoringRunner, 'fixtureId' | 'link' | 'dispatch'>;

function createPoll(read: () => void) {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    on: (): void => {
      if (timer === null) timer = setInterval(read, POLL_MS);
    },
    off: (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

function createWait(fire: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    pending: (): boolean => timer !== null,
    start: (ms: number): void => {
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, ms);
    },
    cancel: (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export function startLive(ports: LivePorts, runner: LiveRunner): () => void {
  let round = 0;
  let failures = 0;
  let leave: (() => void) | null = null;
  const read = (): void => void runner.dispatch({ kind: 'read' });
  const poll = createPoll(read);
  const wait = createWait(() => void join());

  const close = (): void => {
    leave?.();
    leave = null;
  };
  /** Down, or no grant: poll, and join again after a wait, longer each time one is needed. */
  const down = (): void => {
    poll.on();
    if (wait.pending()) return;
    wait.start(resubscribeWaitMs(failures));
    failures += 1;
  };
  const up = (): void => {
    failures = 0;
    wait.cancel();
    poll.off();
    read();
  };
  const join = async (): Promise<void> => {
    const link = runner.link();
    if (link === null || !ports.foreground.isForeground()) return;
    const mine = (round += 1);
    close();
    const grant = await ports.scoring.realtimeToken(link, runner.fixtureId);
    if (mine !== round) return;
    if (grant === null) return down();
    leave = ports.realtime.subscribe(grant, { onPing: read, onUp: up, onDown: down });
  };
  const away = (): void => {
    round += 1;
    close();
    poll.off();
    wait.cancel();
  };

  const listening = [
    ports.foreground.subscribe(() => void join()),
    ports.foreground.subscribeBackground(away),
  ];
  void join();
  return () => {
    away();
    listening.forEach((unsubscribe) => unsubscribe());
  };
}
