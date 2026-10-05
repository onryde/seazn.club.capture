import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from './CaptureEnginePort';
import { intentWire } from './intentWire';
import { MALFORMED_LOG_MS, createNativeCaptureEngine } from './nativeCaptureEngine';
import { FakeNativeModule } from './testing/FakeNativeModule';
import { PAIR } from './testing/pairIntent';
import allowList from './scrub/allow-list.json';
import vectors from './wire/snapshot-vectors.json';
import { vectorWire } from './wire/vectorWire';

const liveWire = vectorWire('live-telemetry');
const pairedWire = vectorWire('paired-after-organiser-stop');
const quiet = { onRecordLine: () => undefined };
/** The line a malformed snapshot is recorded by (review C4c I-4): the allow-list's kind and key. */
const MALFORMED = (count: number) => ['warn', 'engine.malformed-snapshot', { count }];

/** Lets the fake deliver every event queued so far (a macrotask), and every promise callback run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Idle at rest, as a JS reload reads it before native has said anything: written by hand. */
const AT_REST: EngineSnapshot = {
  state: { kind: 'idle' },
  telemetry: vectors.telemetryBase as EngineSnapshot['telemetry'],
  pairing: null,
  broadcast: null,
  ready: { camera: false, sound: false, network: false, held: false },
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
  camera: null,
  reportedAtMs: 0,
  survivesBackground: false,
};

// Review C4c round 1, minor 2: the D3 and I-3 tests mean something only while the fake delivers as
// Expo does, on a later macrotask. A fake that delivers inside `emit` would pass them vacuously.
describe('the fake native module', () => {
  it('delivers an event on a later macrotask, never inside emit', async () => {
    const native = new FakeNativeModule();
    const heard: number[] = [];
    native.addListener('onAck', ({ seq }) => heard.push(seq));
    native.emit('onAck', { seq: 1 });
    native.emit('onAck', { seq: 2 });
    expect(heard).toEqual([]);
    await flush();
    expect(heard).toEqual([1, 2]);
  });
});

describe('the native engine (carry 1)', () => {
  it("Review Focus 2 reports native's state from construction, and seeds the record from its tail", () => {
    const native = new FakeNativeModule({
      current: liveWire,
      tail: ['{"at":"…","kind":"paired"}'],
    });
    const lines: string[] = [];
    const engine = createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    expect(engine.getSnapshot().state.kind).toBe('publishing');
    expect(lines).toEqual(['{"at":"…","kind":"paired"}']);
  });

  // Review C4c I-4: a malformed body is counted and recorded; nothing at all is not malformed.
  it.each([
    ['nothing', null, []],
    ['a malformed body', { state: { kind: 'exploded' } }, [MALFORMED(1)]],
  ])('reads idle at rest when native reports %s at construction', (_why, current, logged) => {
    const native = new FakeNativeModule({ current });
    const engine = createNativeCaptureEngine(native, quiet);
    expect(engine.getSnapshot()).toEqual(AT_REST);
    expect(native.logged).toEqual(logged);
  });

  it('I-4 counts every malformed snapshot, and records the count at most once a minute', async () => {
    const native = new FakeNativeModule({ current: pairedWire });
    let at = 1_000;
    const engine = createNativeCaptureEngine(native, { ...quiet, now: () => at });
    const malformed = async (atMs: number) => {
      at = atMs;
      native.emit('onSnapshot', { ...liveWire, state: { kind: 'exploded' } });
      await flush();
    };
    await malformed(1_000);
    expect(native.logged).toEqual([MALFORMED(1)]);
    await malformed(31_000);
    await malformed(1_000 + MALFORMED_LOG_MS - 1);
    expect(native.logged).toEqual([MALFORMED(1)]);
    await malformed(1_000 + MALFORMED_LOG_MS);
    expect(native.logged).toEqual([MALFORMED(1), MALFORMED(4)]);
    // A good body is never counted, and the last good snapshot stood throughout.
    expect(engine.getSnapshot().state.kind).toBe('paired');
    at = 1_000 + 3 * MALFORMED_LOG_MS;
    native.emit('onSnapshot', liveWire);
    await flush();
    await malformed(1_000 + 3 * MALFORMED_LOG_MS);
    expect(native.logged).toEqual([MALFORMED(1), MALFORMED(4), MALFORMED(5)]);
  });

  // Review C4c I-4 and Task 31's CD17: a refused body still proves native is reporting. The last
  // good facts stand, with the time it arrived; silence is native saying nothing at all.
  it('I-4 keeps a counted drop from reading as silence, and leaves real silence alone', async () => {
    const native = new FakeNativeModule({ current: pairedWire });
    let at = 1_000;
    const engine = createNativeCaptureEngine(native, { ...quiet, now: () => at });
    const heard: number[] = [];
    engine.subscribe(() => heard.push(engine.getSnapshot().reportedAtMs));
    at = 9_000;
    native.emit('onSnapshot', { ...liveWire, state: { kind: 'exploded' } });
    await flush();
    expect(heard).toEqual([9_000]);
    expect(engine.getSnapshot().state.kind).toBe('paired');
    expect(native.logged).toEqual([MALFORMED(1)]);
    // Nothing at all arrives: the time stands, so the age climbs.
    at = 20_000;
    await flush();
    expect(heard).toEqual([9_000]);
    expect(engine.getSnapshot().reportedAtMs).toBe(9_000);
  });

  // C4c carry (b): M16 routes a JS line by the kind native reports when it is written, read at once
  // from `current()`, ahead of the snapshot event Expo has queued; the JS snapshot's when unreadable.
  it.each([
    ['paired', pairedWire, 'paired'],
    ['nothing yet', null, 'idle'],
    ['a malformed body', { state: { kind: 'exploded' } }, 'idle'],
  ])('reads the kind native reports now: %s', (_why, current, kind) => {
    const shared: { current?: unknown } = { current: null };
    const native = new FakeNativeModule(shared);
    const engine = createNativeCaptureEngine(native, quiet);
    shared.current = current;
    expect(engine.getSnapshot().state.kind).toBe('idle');
    expect(engine.currentKind()).toBe(kind);
  });

  // Review C5 m-5: the routing read runs inside every log call, so a bridge that throws reads as
  // the JS snapshot's kind, never as a throw out of the logger.
  it('reads the JS snapshot’s kind when native’s current() throws', () => {
    const native = new FakeNativeModule({ current: pairedWire });
    const engine = createNativeCaptureEngine(native, quiet);
    expect(engine.getSnapshot().state.kind).toBe('paired');
    native.current = () => {
      throw new Error('the module is gone');
    };
    expect(engine.currentKind()).toBe('paired');
  });

  // Review C4c round 1, minor 3: between lines the logged count is a floor, so dispose writes the rest.
  it('I-4 a burst of malformed snapshots then dispose records the full count, once', async () => {
    const native = new FakeNativeModule({ current: pairedWire });
    const engine = createNativeCaptureEngine(native, { ...quiet, now: () => 1_000 });
    for (let i = 0; i < 100; i += 1) native.emit('onSnapshot', { state: { kind: 'exploded' } });
    await flush();
    expect(native.logged).toEqual([MALFORMED(1)]);
    engine.dispose();
    expect(native.logged).toEqual([MALFORMED(1), MALFORMED(100)]);
  });

  it.each([
    ['no snapshot was malformed', 0, []],
    ['every malformed snapshot is already in a line', 1, [MALFORMED(1)]],
  ])('I-4 dispose writes no malformed line when %s', async (_why, bursts, logged) => {
    const native = new FakeNativeModule({ current: pairedWire });
    const engine = createNativeCaptureEngine(native, { ...quiet, now: () => 1_000 });
    for (let i = 0; i < bursts; i += 1) native.emit('onSnapshot', { state: { kind: 'exploded' } });
    await flush();
    engine.dispose();
    expect(native.logged).toEqual(logged);
  });

  it("I-4 the malformed line's kind and key are on the record's allow-list, so native keeps them", () => {
    const [, kind, fields] = MALFORMED(1) as [string, string, Record<string, unknown>];
    expect([Object.keys(allowList.kinds).includes(kind), Object.keys(fields)]).toEqual([
      true,
      ['count'],
    ]);
    expect(allowList.plain).toContain('count');
  });

  it('M-9 a body whose telemetry has no heartbeat is kept out, into the same count', async () => {
    const native = new FakeNativeModule({ current: pairedWire });
    const engine = createNativeCaptureEngine(native, quiet);
    const { heartbeat: _gone, ...telemetry } = liveWire.telemetry as Record<string, unknown>;
    native.emit('onSnapshot', { ...liveWire, telemetry });
    await flush();
    expect([engine.getSnapshot().state.kind, native.logged]).toEqual(['paired', [MALFORMED(1)]]);
  });

  // Review C4c I-3: Expo queues an event to the JS thread, so a line written as the tail is read
  // reaches the listener after the engine is built, while it is already in the tail it seeded.
  it('D3 I-3 a tail line whose event arrives after construction appears once, after the tail', async () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}', '{"kind":"b"}'] });
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"b"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"b"}']);
    await flush();
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"b"}']);
  });

  it('D3 I-3 drops only the tail lines that arrive first: the first new line, and every line after it, is kept', async () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}', '{"kind":"b"}'] });
    native.duringTail = () => {
      native.emit('onRecord', { line: '{"kind":"a"}' });
      native.emit('onRecord', { line: '{"kind":"b"}' });
      native.emit('onRecord', { line: '{"kind":"c"}' });
    };
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    await flush();
    // Past the tail every line is new: one equal to a tail line is a new line written the same way.
    native.emit('onRecord', { line: '{"kind":"b"}' });
    await flush();
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"b"}', '{"kind":"c"}', '{"kind":"b"}']);
  });

  it('D3 a new line written during the tail read, not yet in it, is kept after the tail', async () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}'] });
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"c"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    await flush();
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"c"}']);
  });

  it('D3 with an empty tail, a line written during the read is kept once', async () => {
    const native = new FakeNativeModule();
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"first"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    native.emit('onRecord', { line: '{"kind":"after"}' });
    await flush();
    expect(lines).toEqual(['{"kind":"first"}', '{"kind":"after"}']);
  });

  it('D3 a line native delivers while the tail is still being read waits for the tail, and is kept once', () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}', '{"kind":"b"}'] });
    native.duringTail = () => {
      native.emit('onRecord', { line: '{"kind":"b"}' });
      native.emit('onRecord', { line: '{"kind":"c"}' });
      native.deliver();
    };
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"b"}', '{"kind":"c"}']);
  });

  it('sends intents as void calls through the intent wire, numbered, and never waits on native', () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    expect(engine.send(PAIR)).toBeUndefined();
    engine.send({ kind: 'start' });
    expect(native.sent).toEqual([
      { ...intentWire(PAIR), seq: 1 },
      { kind: 'start', seq: 2 },
    ]);
  });

  it('CD8 settled() waits for the ack of the last intent sent, not for any snapshot', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    await engine.settled();
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    let done = false;
    void engine.settled().then(() => (done = true));
    native.emit('onSnapshot', pairedWire);
    native.emit('onAck', { seq: 1 });
    await flush();
    expect(done).toBe(false);
    native.emit('onAck', { seq: 2 });
    await flush();
    expect(done).toBe(true);
  });

  it('CD8 two waiters on the same seq both resolve, and an ack that skips ahead settles both', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    const settled: string[] = [];
    void engine.settled().then(() => settled.push('first'));
    void engine.settled().then(() => settled.push('second'));
    native.emit('onAck', { seq: 2 });
    await flush();
    expect(settled).toEqual(['first', 'second']);
  });

  it('CD8 an older ack heard after a newer one never makes a settled engine wait again', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    native.emit('onAck', { seq: 2 });
    native.emit('onAck', { seq: 1 });
    await flush();
    let done = false;
    void engine.settled().then(() => (done = true));
    await flush();
    expect(done).toBe(true);
  });

  it('numbers an op that is not an intent in the same sequence, and resolves on its ack', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    engine.send({ kind: 'stop' });
    const numbered: number[] = [];
    let done = false;
    void engine.sendNumbered((seq) => numbered.push(seq)).then(() => (done = true));
    engine.send({ kind: 'reset' });
    expect(numbered).toEqual([2]);
    expect(native.sent.map((sent) => sent.seq)).toEqual([1, 3]);
    native.emit('onAck', { seq: 1 });
    await flush();
    expect(done).toBe(false);
    native.emit('onAck', { seq: 2 });
    await flush();
    expect(done).toBe(true);
  });

  // Task 31 (review C4c I-4): a malformed body notifies too, with the last good facts and its own
  // arrival time, so CD17 never reads a counted drift as silence.
  it('notifies subscribers on each snapshot, and keeps the last good one through a malformed body', async () => {
    const native = new FakeNativeModule();
    let at = 5_000;
    const engine = createNativeCaptureEngine(native, { ...quiet, now: () => at });
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().state.kind));
    native.emit('onSnapshot', pairedWire);
    await flush();
    const good = engine.getSnapshot();
    at = 6_000;
    native.emit('onSnapshot', { state: { kind: 'exploded' } });
    await flush();
    expect(seen).toEqual(['paired', 'paired']);
    expect(engine.getSnapshot()).toEqual({ ...good, reportedAtMs: 6_000 });
  });

  it('stops notifying a subscriber once it unsubscribes', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    let calls = 0;
    const unsubscribe = engine.subscribe(() => (calls += 1));
    native.emit('onSnapshot', pairedWire);
    await flush();
    unsubscribe();
    native.emit('onSnapshot', liveWire);
    await flush();
    expect([calls, engine.getSnapshot().state.kind]).toEqual([1, 'publishing']);
  });

  it('echoes native record lines, and forwards JS entries as void calls', async () => {
    const native = new FakeNativeModule();
    const lines: string[] = [];
    const engine = createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    native.emit('onRecord', { line: 'x' });
    await flush();
    engine.forward({ level: 'warn', event: 'intent.stop', fields: { count: 3 } });
    expect(lines).toEqual(['x']);
    expect(native.logged).toEqual([['warn', 'intent.stop', { count: 3 }]]);
  });

  it('dispose removes every listener and resolves a waiter, so nothing hangs', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    expect(native.listenerCount()).toBe(3);
    engine.send({ kind: 'stop' });
    const waiting = engine.settled();
    engine.dispose();
    await waiting;
    expect(native.listenerCount()).toBe(0);
  });

  it('a second engine over the same module after dispose hears each record line once', async () => {
    const native = new FakeNativeModule();
    const lines: string[] = [];
    const onRecordLine = (line: string) => lines.push(line);
    createNativeCaptureEngine(native, { onRecordLine }).dispose();
    createNativeCaptureEngine(native, { onRecordLine });
    native.emit('onRecord', { line: 'x' });
    await flush();
    expect(lines).toEqual(['x']);
  });
});
