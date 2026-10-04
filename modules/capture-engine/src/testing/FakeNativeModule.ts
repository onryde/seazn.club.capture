import type { CaptureEngineNative, Subscription } from '../nativeModule';

type Events = { onSnapshot: unknown; onRecord: { line: string }; onAck: { seq: number } };
type Listener = (body: never) => void;

/**
 * A hand-written `CaptureEngineNative`: settable `current` and `tail`, recorded calls, and `emit`.
 * Tests only: nothing in production imports it.
 */
export class FakeNativeModule implements CaptureEngineNative {
  readonly sent: Record<string, unknown>[] = [];
  readonly logged: [string, string, Record<string, unknown>][] = [];
  private readonly listeners = new Map<keyof Events, Set<Listener>>();
  /** Runs inside `tail()`, before it returns: D3's race, made deterministic. */
  duringTail: (() => void) | null = null;

  constructor(private readonly state: { current?: unknown; tail?: readonly string[] } = {}) {}

  send(intent: Record<string, unknown>): void {
    this.sent.push(intent);
  }
  log(level: string, kind: string, fields: Record<string, unknown>): void {
    this.logged.push([level, kind, fields]);
  }
  current(): unknown {
    return this.state.current ?? null;
  }
  tail(): readonly string[] {
    this.duringTail?.();
    return this.state.tail ?? [];
  }
  addListener<E extends keyof Events>(event: E, listener: (body: Events[E]) => void): Subscription {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(event, set);
    return { remove: () => set.delete(listener as Listener) };
  }
  emit<E extends keyof Events>(event: E, body: Events[E]): void {
    for (const listener of this.listeners.get(event) ?? [])
      (listener as (body: Events[E]) => void)(body);
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}
