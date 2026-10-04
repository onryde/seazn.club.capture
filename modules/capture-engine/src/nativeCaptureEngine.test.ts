import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from './CaptureEnginePort';
import { intentWire } from './intentWire';
import { createNativeCaptureEngine } from './nativeCaptureEngine';
import { FakeNativeModule } from './testing/FakeNativeModule';
import { PAIR } from './testing/pairIntent';
import vectors from './wire/snapshot-vectors.json';
import { vectorWire } from './wire/vectorWire';

const liveWire = vectorWire('live-telemetry');
const pairedWire = vectorWire('paired-after-organiser-stop');
const quiet = { onRecordLine: () => undefined };

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

  it.each([
    ['nothing', null],
    ['a malformed body', { state: { kind: 'exploded' } }],
  ])('reads idle at rest when native reports %s at construction', (_why, current) => {
    const engine = createNativeCaptureEngine(new FakeNativeModule({ current }), quiet);
    expect(engine.getSnapshot()).toEqual(AT_REST);
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

  it('notifies subscribers on each snapshot, and keeps the last good one through a malformed body', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().state.kind));
    native.emit('onSnapshot', pairedWire);
    native.emit('onSnapshot', { state: { kind: 'exploded' } });
    await flush();
    expect(seen).toEqual(['paired']);
    expect(engine.getSnapshot().state.kind).toBe('paired');
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
