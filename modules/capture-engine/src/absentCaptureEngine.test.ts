import { describe, expect, it } from 'vitest';
import { createAbsentCaptureEngine } from './absentCaptureEngine';
import type { EngineIntent } from './CaptureEnginePort';
import { PAIR } from './testing/pairIntent';

const NOW = 1_790_000_000_000;

/** Every intent but `pair`, one of each kind. */
const OTHERS: readonly EngineIntent[] = [
  { kind: 'start' },
  { kind: 'stop' },
  { kind: 'unpair' },
  { kind: 'reset' },
  { kind: 'setAutomatic', on: false },
  { kind: 'setLanguage', language: 'nl' },
  { kind: 'switchCamera' },
];

describe('the absent engine (CD23: no native module, iOS in S1)', () => {
  it('is idle, ends a pair fatal-error naming that code, and resets to idle', () => {
    const engine = createAbsentCaptureEngine(() => NOW);
    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
    engine.send(PAIR);
    const ended = engine.getSnapshot();
    expect(ended.state).toEqual({ kind: 'ended', reason: 'fatal-error', durationMs: null });
    // The fixture token's tag, as `wire/token-tag-vectors.json` pins it.
    expect([ended.pairing?.code, ended.pairing?.slot, ended.pairing?.tokenTag]).toEqual([
      'fx42hmnp7k2q',
      1,
      'b24bb97b',
    ]);
    expect(ended.broadcast).toBeNull();
    engine.send({ kind: 'start' });
    expect(engine.getSnapshot().state.kind).toBe('ended');
    engine.send({ kind: 'reset' });
    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
    expect(engine.getSnapshot().pairing).toBeNull();
  });

  it('M5 a pair while ended is ignored: it stays ended, still naming the first code', () => {
    const engine = createAbsentCaptureEngine(() => NOW);
    engine.send(PAIR);
    engine.send({ ...PAIR, code: '0123456789ab', slot: 2 });
    expect(engine.getSnapshot().pairing?.code).toBe('fx42hmnp7k2q');
  });

  // The table's size, so a kind dropped from it reds here (PV12).
  it('ignores each of the 7 other intents from idle, and all but reset once ended', () => {
    expect(new Set(OTHERS.map((intent) => intent.kind)).size).toBe(7);
    const engine = createAbsentCaptureEngine(() => NOW);
    let changes = 0;
    engine.subscribe(() => (changes += 1));
    const idle = engine.getSnapshot();
    for (const intent of OTHERS) engine.send(intent);
    expect([changes, engine.getSnapshot()]).toEqual([0, idle]);
    engine.send(PAIR);
    const ended = engine.getSnapshot();
    for (const intent of OTHERS.filter((other) => other.kind !== 'reset')) engine.send(intent);
    expect([changes, engine.getSnapshot()]).toEqual([1, ended]);
    engine.send({ kind: 'reset' });
    expect([changes, engine.getSnapshot().state]).toEqual([2, { kind: 'idle' }]);
  });

  it('a pair after the reset is heard again, naming the new code', () => {
    const engine = createAbsentCaptureEngine(() => NOW);
    engine.send(PAIR);
    engine.send({ kind: 'reset' });
    engine.send({ ...PAIR, code: '0123456789ab', slot: 2 });
    expect([engine.getSnapshot().state.kind, engine.getSnapshot().pairing?.code]).toEqual([
      'ended',
      '0123456789ab',
    ]);
  });

  it('never carries the token in its snapshot', () => {
    const engine = createAbsentCaptureEngine(() => NOW);
    engine.send(PAIR);
    expect(JSON.stringify(engine.getSnapshot())).not.toContain(PAIR.token);
  });
});
