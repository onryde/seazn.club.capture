import { EngineError, type EventEnvelope, type FoldableModule } from '@seazn/engine/core';
import { describe, expect, it } from 'vitest';
import { engineRefusalOf } from '@/domain/scoring/engineRefusal';

/**
 * The engine's word on one new event (S2-4 plan Task 4, preflight D6), as the server judges an append: strict from the
 * last event's seq, everything before it replayed. Any sport's: the module is a parameter, so these tests drive a module
 * of their own whose `apply` answers what each case needs, and the cricket and football folds pass their own.
 */

type Seen = { readonly strict: readonly boolean[] };

/** A module whose every event is applied by `judge`, which is told whether the fold judges it strictly. */
const moduleOf = (judge: (strict: boolean) => void): FoldableModule<unknown, Seen> => ({
  init: () => ({ strict: [] }),
  apply: (state, _event, ctx) => {
    const strict = ctx?.strict ?? true;
    judge(strict);
    return { strict: [...state.strict, strict] };
  },
  outcome: () => null,
});

const MATCH = {
  fixtureId: 'fx-1',
  cfg: {},
  lineups: {
    home: { entrantId: 'ent-home', slots: [] },
    away: { entrantId: 'ent-away', slots: [] },
  },
};

const event = (seq: number): EventEnvelope => ({
  id: `ev-${seq}`,
  fixtureId: 'fx-1',
  seq,
  type: 'test.event',
  payload: {},
  recordedAt: '2026-11-08T10:00:00.000Z',
  recordedBy: null,
});

const refusing = (error: unknown) =>
  moduleOf((strict) => {
    if (strict) throw error;
  });

describe('engineRefusalOf', () => {
  it('has no word for no event at all', () => {
    expect(engineRefusalOf(refusing(new Error('never')), MATCH, [])).toBeNull();
  });

  it('takes an event the engine takes', () => {
    expect(
      engineRefusalOf(
        moduleOf(() => undefined),
        MATCH,
        [event(1), event(2)],
      ),
    ).toBeNull();
  });

  it('judges only the last event strictly: the ones before it are replayed', () => {
    const strictness: boolean[] = [];
    engineRefusalOf(
      moduleOf((strict) => void strictness.push(strict)),
      MATCH,
      [event(1), event(2), event(3)],
    );
    expect(strictness).toStrictEqual([false, false, true]);
  });

  it('names the engine’s code, and no reason when its data names none', () => {
    const error = new EngineError('INVALID_EVENT', 'batter is not in the lineup', { batter: 'x' });
    expect(engineRefusalOf(refusing(error), MATCH, [event(1)])).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: null,
    });
  });

  it('it reads the reason its data names', () => {
    const error = new EngineError('INVALID_EVENT', 'cap', {
      by: 'ent-home',
      reason: 'sub-cap-reached',
    });
    expect(engineRefusalOf(refusing(error), MATCH, [event(1)])).toStrictEqual({
      code: 'INVALID_EVENT',
      reason: 'sub-cap-reached',
    });
  });

  it('a reason that is not text is none', () => {
    const error = new EngineError('WRONG_PHASE', 'not live', { reason: 7 });
    expect(engineRefusalOf(refusing(error), MATCH, [event(1)])).toStrictEqual({
      code: 'WRONG_PHASE',
      reason: null,
    });
  });

  it('engineRefusalOf rethrows an error that is not the engine’s', () => {
    const fault = new TypeError('the module fell over');
    expect(() => engineRefusalOf(refusing(fault), MATCH, [event(1)])).toThrow(fault);
  });
});
