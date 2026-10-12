import type { CaptureEngineNative, RecordLine, Subscription } from '../nativeModule';

type Events = { onSnapshot: unknown; onRecord: RecordLine; onAck: { seq: number } };
type Listener = (body: never) => void;

/**
 * A hand-written `CaptureEngineNative`: settable `current` and `tail`, recorded calls, and `emit`.
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

  constructor(private readonly state: { current?: unknown; tail?: readonly RecordLine[] } = {}) {}

  send(intent: Record<string, unknown>): void {
    this.sent.push(intent);
  }
  log(level: string, kind: string, fields: Record<string, unknown>): void {
    this.logged.push([level, kind, fields]);
  }
  current(): unknown {
    return this.state.current ?? null;
  }
  tail(): readonly RecordLine[] {
    this.duringTail?.();
    return this.state.tail ?? [];
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
  /** What `powerUnrestricted` answers (R5): Unrestricted by default. Tests set it. */
  powerAnswer: unknown = true;
  powerUnrestricted(): unknown {
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
