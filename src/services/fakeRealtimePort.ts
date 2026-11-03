import type { RealtimeHandlers, RealtimePort } from '@/services/realtimePort';
import type { RealtimeGrant } from '@/services/scoringPort';

/** One `subscribe`, as the fake saw it. `open` goes false at its unsubscribe, or when another subscribe replaces it. */
export type FakeSubscription = { readonly grant: RealtimeGrant; readonly open: boolean };

/**
 * The Realtime port on a laptop (plan S2-1 Task 8). It keeps the real port's rules, which the hook leans on: one
 * subscription at a time, nothing said from inside `subscribe`, a change said once, nothing after the unsubscribe. The
 * controls act on the current subscription and are nothing when there is none.
 *
 * A subscription starts neither up nor down, as the real one does before its channel is joined: `restore()` is the
 * join, `drop()` the channel lost (or one that never joined), `ping()` another scorer's tap. Grants are kept whole,
 * which a test needs to tell a fresh one from the expired; give it made-up values only.
 */
export type FakeRealtimePort = RealtimePort & {
  ping(): void;
  drop(): void;
  restore(): void;
  readonly subscriptions: readonly FakeSubscription[];
};

type Entry = {
  readonly grant: RealtimeGrant;
  readonly handlers: RealtimeHandlers;
  open: boolean;
  state: 'connecting' | 'up' | 'down';
};

export function createFakeRealtimePort(): FakeRealtimePort {
  const entries: Entry[] = [];
  const current = (): Entry | null => {
    const latest = entries[entries.length - 1];
    return latest?.open === true ? latest : null;
  };
  const move = (next: 'up' | 'down'): void => {
    const entry = current();
    if (entry === null || entry.state === next) return;
    entry.state = next;
    if (next === 'up') entry.handlers.onUp();
    else entry.handlers.onDown();
  };
  return {
    subscribe: (grant, handlers) => {
      const before = current();
      if (before !== null) before.open = false;
      const entry: Entry = { grant, handlers, open: true, state: 'connecting' };
      entries.push(entry);
      return () => {
        entry.open = false;
      };
    },
    ping: () => current()?.handlers.onPing(),
    drop: () => move('down'),
    restore: () => move('up'),
    get subscriptions() {
      return entries.map(({ grant, open }) => ({ grant, open }));
    },
  };
}
