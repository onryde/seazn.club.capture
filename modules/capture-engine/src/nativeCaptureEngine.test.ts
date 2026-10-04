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

/** Lets every settled promise's callbacks run. */
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

  it('D3 a line native writes while the tail is read appears exactly once, after the tail', () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}', '{"kind":"b"}'] });
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"b"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"b"}']);
  });

  it('D3 a new line written during the tail read, not yet in it, is kept after the tail', () => {
    const native = new FakeNativeModule({ tail: ['{"kind":"a"}'] });
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"c"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    expect(lines).toEqual(['{"kind":"a"}', '{"kind":"c"}']);
  });

  it('D3 with an empty tail, a line written during the read is kept once', () => {
    const native = new FakeNativeModule();
    native.duringTail = () => native.emit('onRecord', { line: '{"kind":"first"}' });
    const lines: string[] = [];
    createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    native.emit('onRecord', { line: '{"kind":"after"}' });
    expect(lines).toEqual(['{"kind":"first"}', '{"kind":"after"}']);
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

  it('notifies subscribers on each snapshot, and keeps the last good one through a malformed body', () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().state.kind));
    native.emit('onSnapshot', pairedWire);
    native.emit('onSnapshot', { state: { kind: 'exploded' } });
    expect(seen).toEqual(['paired']);
    expect(engine.getSnapshot().state.kind).toBe('paired');
  });

  it('stops notifying a subscriber once it unsubscribes', () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, quiet);
    let calls = 0;
    const unsubscribe = engine.subscribe(() => (calls += 1));
    native.emit('onSnapshot', pairedWire);
    unsubscribe();
    native.emit('onSnapshot', liveWire);
    expect([calls, engine.getSnapshot().state.kind]).toEqual([1, 'publishing']);
  });

  it('echoes native record lines, and forwards JS entries as void calls', () => {
    const native = new FakeNativeModule();
    const lines: string[] = [];
    const engine = createNativeCaptureEngine(native, { onRecordLine: (line) => lines.push(line) });
    native.emit('onRecord', { line: 'x' });
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

  it('a second engine over the same module after dispose hears each record line once', () => {
    const native = new FakeNativeModule();
    const lines: string[] = [];
    const onRecordLine = (line: string) => lines.push(line);
    createNativeCaptureEngine(native, { onRecordLine }).dispose();
    createNativeCaptureEngine(native, { onRecordLine });
    native.emit('onRecord', { line: 'x' });
    expect(lines).toEqual(['x']);
  });
});
