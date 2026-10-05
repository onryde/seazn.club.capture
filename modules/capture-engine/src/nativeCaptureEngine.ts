import type { SessionState } from '@/domain/session/SessionState';
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
  /**
   * Numbers and sends a non-intent op that native acks (Task 27's host `script` and `readiness`).
   * Resolves once native has acked the last seq sent, which may be a later one than this op's own
   * (review C4c): it waits for everything outstanding, never for its own ack alone.
   */
  sendNumbered(op: (seq: number) => void): Promise<void>;
  /**
   * C4c carry (b): the kind native reports now, read at once from `current()`, ahead of the
   * snapshot event Expo has queued for JS. The JS snapshot's kind when native has written nothing
   * readable. Read by M16's record routing only, once per JS line.
   */
  currentKind(): SessionState['kind'];
  dispose(): void;
};

/** Review C4c I-4: a malformed snapshot's line goes to the record at most once in this many ms. */
export const MALFORMED_LOG_MS = 60_000;

/**
 * Carry 1: the port over native's module. Snapshots are projected through the
 * snapshot wire (the last good one is kept through a malformed body, which is
 * counted and recorded), intents go out through the intent wire numbered for
 * CD8, and the record is seeded from native's tail without losing or doubling
 * a line (D3).
 */
export function createNativeCaptureEngine(
  native: CaptureEngineNative,
  deps: { onRecordLine: (line: string) => void; now?: () => number },
): NativeCaptureEngine {
  const cache = createWireCache();
  const listeners = new Set<() => void>();
  const now = deps.now ?? Date.now;
  const malformed = malformedLines(native, now);
  const read = (body: unknown): EngineSnapshot | null => {
    const next = toEngineSnapshot(body, cache);
    if (next === null) malformed.refused();
    return next;
  };
  // Nothing at all is a native that has not reported yet, not a malformed body.
  const current = native.current();
  let snapshot: EngineSnapshot = (current == null ? null : read(current)) ?? UNREPORTED;
  const acks = createAcks();
  const subscriptions = [
    native.addListener('onSnapshot', (body) => {
      // Review C4c I-4 and CD17: a refused body still proves native is reporting, so the last good
      // facts stand with the time it arrived. Silence is native saying nothing at all; a drift the
      // record counts must never read as "Engine not responding".
      snapshot = read(body) ?? { ...snapshot, reportedAtMs: now() };
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
    currentKind: () => {
      let body: unknown;
      try {
        body = native.current();
      } catch {
        // Review C5 m-5: this runs inside every log call; a throw must not reach the logger.
        return snapshot.state.kind;
      }
      const now = body == null ? null : toEngineSnapshot(body, cache);
      return (now ?? snapshot).state.kind;
    },
    forward: (entry) => native.log(entry.level, entry.event, { ...entry.fields }),
    settled: acks.settled,
    dispose: () => {
      for (const subscription of subscriptions) subscription.remove();
      acks.release();
      malformed.flush();
    },
  };
}

/**
 * D3: listen first, read the tail, hand it on, then hand on what arrives. Expo
 * queues an event to the JS thread (review C4c I-3), so the event for a line
 * written before the tail was read can arrive after it: events come in the
 * order native wrote them, so arriving lines the tail holds are dropped until
 * the first it does not, and every line after that is new. Lines are compared
 * by text, so until Task 33's record seq a genuine new line whose text equals
 * a tail line, arriving before any line the tail lacks, is dropped too: native's
 * lines carry their own `at`, to the millisecond, which makes that rare, not
 * impossible (review C4c round 1, minor 1). Task 33's seq replaces the text. A
 * line delivered while the tail is still being read waits for it, and passes
 * the same check.
 */
function seedRecord(native: CaptureEngineNative, onLine: (line: string) => void): Subscription {
  let early: string[] | null = [];
  /** The tail's lines, while arriving lines may still repeat them; null once one has not. */
  let seeded: ReadonlySet<string> | null = null;
  const arrived = (line: string) => {
    if (seeded !== null && seeded.has(line)) return;
    seeded = null;
    onLine(line);
  };
  const subscription = native.addListener('onRecord', ({ line }) => {
    if (early === null) arrived(line);
    else early.push(line);
  });
  const tail = native.tail();
  const during = early;
  early = null;
  seeded = new Set(tail);
  tail.forEach(onLine);
  during.forEach(arrived);
  return subscription;
}

/**
 * Review C4c I-4: counts every snapshot the wire refused, and records the count
 * so far through native's record, at most one line a [MALFORMED_LOG_MS]: once
 * Task 31's watchdog lands, a wire drift must not read as an engine that has
 * stopped answering. Between lines the last logged count is a floor, not the
 * total; `flush` (at dispose) writes the total when drops came since the last
 * line, so the record ends on the full count.
 */
function malformedLines(
  native: CaptureEngineNative,
  now: () => number,
): { refused(): void; flush(): void } {
  let count = 0;
  let logged = 0;
  let loggedAtMs: number | null = null;
  const line = (atMs: number | null) => {
    loggedAtMs = atMs;
    logged = count;
    native.log('warn', 'engine.malformed-snapshot', { count });
  };
  return {
    refused: () => {
      count += 1;
      const atMs = now();
      if (loggedAtMs !== null && atMs - loggedAtMs < MALFORMED_LOG_MS) return;
      line(atMs);
    },
    flush: () => {
      if (count > logged) line(loggedAtMs);
    },
  };
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
