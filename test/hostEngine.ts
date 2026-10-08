import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Readiness } from '@/domain/session/Pairing';
import { createNativeCaptureEngine, type NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import type { CaptureEngineNative, RecordLine, Subscription } from '@/engine/nativeModule';
import type { EngineUnderTest } from './engineContract';
import { scriptFor } from './serverScript';

/** Task 21's JVM host, as `./gradlew :host:installDist` lays it out. */
export const HOST_BINARY = fileURLToPath(
  new URL(
    '../modules/capture-engine/android/core/host/build/install/host/bin/host',
    import.meta.url,
  ),
);

/** PV28: a send is read once the host is quiet, within 2 s, or the scenario fails. */
const QUIET_MS = 2_000;
/** A say waits for the next beat (5 s, BeatCadence's floor) and the chain it starts. */
const SAY_MS = 10_000;
/** A ready waits two meter periods and quiet (review C4a N-3); the first also waits for the JVM. */
const READY_MS = 5_000;
/** `dispose`: how long a host has to leave after `exit` before it is killed. */
const EXIT_MS = 2_000;
/** A scoring-link call: native's own bound is 16 s with a real network, the host answers from its script at once. */
const SCORING_MS = 5_000;

type Events = { onSnapshot: unknown; onRecord: RecordLine; onAck: { seq: number } };
type Listener = (body: never) => void;

/** One line the host writes (Task 21's protocol). */
type HostLine =
  | { ev: 'ready'; current: unknown; tail: RecordLine[] }
  | { ev: 'snapshot'; body: unknown }
  | { ev: 'record'; line: string; seq: number }
  | { ev: 'ack'; seq: number }
  | { ev: 'request'; path: string; body: unknown }
  | { ev: 'scoringLink'; call: number; answer: unknown };

export type HostEngine = EngineUnderTest & {
  /** The bridge itself, so a test can wait on the intent's own ack (CD8) rather than on quiet. */
  readonly engine: NativeCaptureEngine;
  /** The bodies the engine sent, by path: never a URL or the Bearer (Task 21). */
  readonly requests: readonly { readonly path: string; readonly body: unknown }[];
  /** The record lines native wrote, as the JS ring would hold them. */
  readonly record: readonly string[];
  /** The host's process id, for a test that makes it die or hang. */
  readonly pid: number;
  /**
   * Spec §10: asks the host's core for the scoring link and resolves what native would resolve. Bounded: a host
   * that never answers rejects with `no scoring-link answer`, never stalls the run.
   */
  scoringLink(): Promise<unknown>;
  /**
   * Scripts the next answer on [path] (an unnumbered `script` op, as `say` writes a refusal at `start`): the
   * server's [status] and [body]. It is read by the host's script table before the next call on [path].
   */
  script(path: string, status: number, body: unknown): void;
};

/** `CaptureEngineNative` over the host's stdin and stdout: what the Expo module is on a phone. */
class HostModule implements CaptureEngineNative {
  private readonly listeners = new Map<keyof Events, Set<Listener>>();
  /** The scoring-link calls in flight, by the number the host's answer carries back: concurrent asks never cross. */
  private readonly asked = new Map<number, (answer: unknown) => void>();
  private nextCall = 1;

  constructor(
    private readonly write: (op: Record<string, unknown>) => void,
    private readonly state: { current: unknown; tail: readonly RecordLine[] },
  ) {}

  send(intent: Record<string, unknown>): void {
    const { seq, ...wire } = intent;
    this.write({ op: 'send', seq, intent: wire });
  }
  log(level: string, kind: string, fields: Record<string, unknown>): void {
    this.write({ op: 'log', level, kind, fields });
  }
  current(): unknown {
    return this.state.current;
  }
  tail(): readonly RecordLine[] {
    return this.state.tail;
  }
  /** The JVM host has no camera and no gallery: a photo is never taken through it, so asking is loud. */
  takePhoto(): Promise<unknown> {
    return Promise.reject(new Error('the host has no camera'));
  }
  scoringLink(): Promise<unknown> {
    const call = this.nextCall++;
    return new Promise((resolve) => {
      this.asked.set(call, resolve);
      this.write({ op: 'scoringLink', call });
    });
  }
  /** The host's answer to [call]; one for a call nobody asked (or already answered) is dropped. */
  answered(call: number, answer: unknown): void {
    const resolve = this.asked.get(call);
    this.asked.delete(call);
    resolve?.(answer);
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
}

/**
 * Native's readiness as the host's `readiness` line: the mic silenced by a call or given back (spec §4: no
 * level makes sound not ready, so the system's word is the contract's only way), a pose.
 */
function readinessLine(ready: Partial<Readiness>): Record<string, unknown> {
  return {
    ...(ready.camera === undefined ? {} : { camera: ready.camera }),
    ...(ready.sound === undefined ? {} : { micSilenced: !ready.sound }),
    ...(ready.held === undefined ? {} : { pose: ready.held ? 'left' : 'not-held' }),
    ...(ready.network === undefined ? {} : { network: ready.network }),
  };
}

/**
 * Spawns the JVM host and runs the real JS bridge over it (Task 26's native engine): the kit drives
 * the real Kotlin core, server words included. A send settles once the host is quiet (PV28), a say
 * once its answer has been heard and the host is quiet, a ready once the meter has judged it (N-3).
 * Nothing it writes to the test output carries a token: the made-up tokens reach stdin only, the
 * host's stderr is not read, and a request event carries a body, never the Bearer.
 */
export async function startHostEngine(binary: string = HOST_BINARY): Promise<HostEngine> {
  if (!existsSync(binary)) {
    throw new Error(
      'build the host first: (cd modules/capture-engine/android/core && ./gradlew :host:installDist)',
    );
  }
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const pid = child.pid;
  if (pid === undefined) throw new Error(`the host did not start: ${binary}`);

  let lastSeq = 0;
  const write = (op: Record<string, unknown>) => {
    if (typeof op.seq === 'number') lastSeq = op.seq;
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(op)}\n`);
  };

  /** Rejects once the host has gone, or wrote what is not its protocol: every wait races it. */
  let fail: (error: Error) => void = () => undefined;
  const trouble = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  trouble.catch(() => undefined);
  child.once('exit', (code, signal) => fail(new Error(`the host exited (${code ?? signal})`)));
  child.once('error', (error) => fail(error));

  const bounded = async <T>(work: Promise<T>, ms: number, why: () => string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(why())), ms);
    });
    try {
      return await Promise.race([work, trouble, late]);
    } finally {
      clearTimeout(timer);
    }
  };

  const state: { current: unknown; tail: readonly RecordLine[] } = { current: null, tail: [] };
  const native = new HostModule(write, state);
  const requests: { path: string; body: unknown }[] = [];
  let started: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  createInterface({ input: child.stdout }).on('line', (text) => {
    let line: HostLine;
    try {
      line = JSON.parse(text) as HostLine;
    } catch {
      fail(new Error('the host wrote a line that is not NDJSON'));
      return;
    }
    switch (line.ev) {
      case 'ready':
        state.current = line.current;
        state.tail = line.tail;
        started();
        return;
      case 'snapshot':
        state.current = line.body;
        native.emit('onSnapshot', line.body);
        return;
      case 'record':
        native.emit('onRecord', { seq: line.seq, line: line.line });
        return;
      case 'ack':
        native.emit('onAck', { seq: line.seq });
        return;
      case 'request':
        requests.push({ path: line.path, body: line.body });
        return;
      case 'scoringLink':
        native.answered(line.call, line.answer);
        return;
      default:
        fail(
          new Error(`the host wrote an event it has no name for: ${(line as { ev: string }).ev}`),
        );
    }
  });

  const exit = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    write({ op: 'exit' });
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, EXIT_MS))]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await closed;
    }
  };

  try {
    await bounded(ready, READY_MS, () => 'the host wrote no ready line');
  } catch (error) {
    await exit();
    throw error;
  }
  const record: string[] = [];
  const engine = createNativeCaptureEngine(native, { onRecordLine: (line) => record.push(line) });
  const numbered = (op: Record<string, unknown>, ms: number) =>
    bounded(
      engine.sendNumbered((seq) => write({ ...op, seq })),
      ms,
      () => `no ack for seq ${lastSeq} in ${ms} ms (${String(op.op)})`,
    );
  // The host's phone is ready once the meter has read it. A host that never acks it is let go here,
  // as one with no ready line is (review C4c M-3). Sound is ready at the host's first reading, whatever
  // its level (spec §4), before this ack: the wait is the host-alive check, not a readiness one.
  try {
    await numbered({ op: 'readiness' }, READY_MS);
  } catch (error) {
    engine.dispose();
    await exit();
    throw error;
  }

  return {
    engine,
    requests,
    record,
    pid,
    scoringLink: () => bounded(native.scoringLink(), SCORING_MS, () => 'no scoring-link answer'),
    script: (path, status, body) => write({ op: 'script', path, status, body }),
    say: async (words) => {
      const script = scriptFor(words);
      // A refusal is heard at the next operator start, whose own settle waits for its answer (PV28).
      if (script.path === 'start') write({ op: 'script', ...script });
      else await numbered({ op: 'script', ...script }, SAY_MS);
    },
    ready: (partial) => numbered({ op: 'readiness', ...readinessLine(partial) }, READY_MS),
    settle: () =>
      bounded(
        engine.settled().then(() => engine.sendNumbered((seq) => write({ op: 'quiet', seq }))),
        QUIET_MS,
        () => `not quiet within ${QUIET_MS} ms of seq ${lastSeq} (PV28)`,
      ),
    dispose: async () => {
      engine.dispose();
      await exit();
    },
  };
}
