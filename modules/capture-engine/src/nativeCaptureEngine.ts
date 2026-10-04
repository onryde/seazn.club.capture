import type { CaptureEnginePort, EngineSnapshot } from './CaptureEnginePort';
import { intentWire } from './intentWire';
import type { CaptureEngineNative, Subscription } from './nativeModule';
import { createWireCache, toEngineSnapshot } from './snapshotWire';
import { UNREPORTED } from './unreported';

/**
 * A JS record entry on its way to native's record. Structurally `LogEntry`
 * without `atMs` (the engine module may not import `services`): native stamps
 * the time when it runs the line (RR-13).
 */
export type ForwardedEntry = {
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

export type NativeCaptureEngine = CaptureEnginePort & {
  forward(entry: ForwardedEntry): void;
  /**
   * CD8: resolves once native has acked the last intent sent. Native publishes every change the
   * intent's own input made, state or not (review C4c I-1), before the ack, so those have arrived.
   * Work the input posted in turn, such as the permission answer that pairs, can land up to a
   * tick (500 ms) later: read that by a bounded eventual poll, never at the ack. Resolves at once
   * when nothing is outstanding. Test and probe use only; the product never waits on native
   * (AGENTS §2).
   */
  settled(): Promise<void>;
  /** Numbers and sends a non-intent op that native acks (Task 27's host `script` and `readiness`). */
  sendNumbered(op: (seq: number) => void): Promise<void>;
  dispose(): void;
};

/**
 * Carry 1: the port over native's module. Snapshots are projected through the
 * snapshot wire (the last good one is kept through a malformed body), intents
 * go out through the intent wire numbered for CD8, and the record is seeded
 * from native's tail without losing or doubling a line (D3).
 */
export function createNativeCaptureEngine(
  native: CaptureEngineNative,
  deps: { onRecordLine: (line: string) => void },
): NativeCaptureEngine {
  const cache = createWireCache();
  const listeners = new Set<() => void>();
  let snapshot: EngineSnapshot = toEngineSnapshot(native.current(), cache) ?? UNREPORTED;
  const acks = createAcks();
  const subscriptions = [
    native.addListener('onSnapshot', (body) => {
      const next = toEngineSnapshot(body, cache);
      if (next === null) return;
      snapshot = next;
      for (const listener of listeners) listener();
    }),
    native.addListener('onAck', ({ seq }) => acks.acked(seq)),
    seedRecord(native, deps.onRecordLine),
  ];
  return {
    send: (intent) => acks.next((seq) => native.send({ ...intentWire(intent), seq })),
    sendNumbered: (op) => {
      acks.next(op);
      return acks.settled();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,
    forward: (entry) => native.log(entry.level, entry.event, { ...entry.fields }),
    settled: acks.settled,
    dispose: () => {
      for (const subscription of subscriptions) subscription.remove();
      acks.release();
    },
  };
}

/**
 * D3: listen first, buffer what arrives, read the tail, then hand on the tail
 * and every buffered line the tail does not already hold. A line written while
 * the tail was read is in one or the other, never both, never neither. Lines
 * are compared by text: native's carry their own `at`, so two are never equal.
 */
function seedRecord(native: CaptureEngineNative, onLine: (line: string) => void): Subscription {
  let buffer: string[] | null = [];
  const subscription = native.addListener('onRecord', ({ line }) => {
    if (buffer === null) onLine(line);
    else buffer.push(line);
  });
  const tail = native.tail();
  const early = buffer;
  buffer = null;
  tail.forEach(onLine);
  for (const line of early) if (!tail.includes(line)) onLine(line);
  return subscription;
}

/** CD8's sequence numbers: the last sent, the highest acked, and the waiters on it. */
function createAcks() {
  let sent = 0;
  let acked = 0;
  let waiters: { target: number; resolve: () => void }[] = [];
  const wake = () => {
    const due = waiters.filter((waiter) => waiter.target <= acked);
    waiters = waiters.filter((waiter) => waiter.target > acked);
    for (const waiter of due) waiter.resolve();
  };
  return {
    next: (send: (seq: number) => void) => {
      sent += 1;
      send(sent);
    },
    acked: (seq: number) => {
      acked = Math.max(acked, seq);
      wake();
    },
    settled: () =>
      sent <= acked
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ target: sent, resolve })),
    /** Dispose: nothing will be acked now, so no waiter may hang. */
    release: () => {
      acked = sent;
      wake();
    },
  };
}
