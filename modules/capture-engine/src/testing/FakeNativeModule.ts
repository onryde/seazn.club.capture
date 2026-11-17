import type { CaptureEngineNative, RecordLine, RecordTail, Subscription } from '../nativeModule';

type Events = { onSnapshot: unknown; onRecord: RecordLine; onAck: { seq: number } };
type Listener = (body: never) => void;

/**
 * A hand-written `CaptureEngineNative`: settable `current`, `tail` (its lines) and `pins` (N38), recorded calls, and `emit`.
 * Events arrive as Expo's do (review C4c I-3): queued, and delivered in order on a later macrotask,
 * to the listeners there then. Tests only: nothing in production imports it.
 */
export class FakeNativeModule implements CaptureEngineNative {
  readonly sent: Record<string, unknown>[] = [];
  readonly logged: [string, string, Record<string, unknown>][] = [];
  private readonly listeners = new Map<keyof Events, Set<Listener>>();
  private queue: (() => void)[] = [];
  /** Runs inside `tail()`, before it returns: D3's race, made deterministic. */
  duringTail: (() => void) | null = null;

  constructor(
    private readonly state: {
      current?: unknown;
      tail?: readonly RecordLine[];
      pins?: readonly string[];
    } = {},
  ) {}

  send(intent: Record<string, unknown>): void {
    this.sent.push(intent);
  }
  log(level: string, kind: string, fields: Record<string, unknown>): void {
    this.logged.push([level, kind, fields]);
  }
  current(): unknown {
    return this.state.current ?? null;
  }
  /** A `RecordTail`, as native answers; `unknown` as the module's, so a test can answer as a stale build would. */
  tail(): unknown {
    this.duringTail?.();
    const tail: RecordTail = { pins: this.state.pins ?? [], lines: this.state.tail ?? [] };
    return tail;
  }
  /** What `takePhoto` answers, and how often it was asked. Tests set the first and read the second. */
  photoAnswer: unknown = 'saved';
  photoCalls = 0;
  takePhoto(): Promise<unknown> {
    this.photoCalls += 1;
    return Promise.resolve(this.photoAnswer);
  }
  /** What `scoringLink` answers, and how often it was asked. Tests set the first and read the second. */
  scoringAnswer: unknown = { outcome: 'unavailable' };
  scoringCalls = 0;
  scoringLink(): Promise<unknown> {
    this.scoringCalls += 1;
    return Promise.resolve(this.scoringAnswer);
  }
  /** What `powerMode` answers (R5): Unrestricted by default. Tests set it. */
  powerAnswer: unknown = 'unrestricted';
  powerMode(): unknown {
    return this.powerAnswer;
  }
  addListener<E extends keyof Events>(event: E, listener: (body: Events[E]) => void): Subscription {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return { remove: () => set.delete(listener as Listener) };
  }
  /** Queues the event; it is delivered on a later macrotask, after every event queued before it. */
  emit<E extends keyof Events>(event: E, body: Events[E]): void {
    this.queue.push(() => {
      for (const listener of this.listeners.get(event) ?? [])
        (listener as (body: Events[E]) => void)(body);
    });
    if (this.queue.length === 1) setTimeout(() => this.deliver(), 0);
  }
  /** Delivers every queued event now, in order: native delivering synchronously, for one D3 test. */
  deliver(): void {
    const due = this.queue;
    this.queue = [];
    for (const run of due) run();
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}
