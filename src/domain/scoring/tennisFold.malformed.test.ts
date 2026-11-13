import { describe, expect, it } from 'vitest';
import { foldTennis } from '@/domain/scoring/tennisFold';
import { SINGLES, ledgerOf, queuedOf, start, type Spec } from '../../../test/tennisLedger';

// S2-7 Task 9 (B1 review carry): events the server holds that the engine cannot read must never throw out of the fold, and so
// out of the hook. `foldOf` rethrows what is not an EngineError, so every kind of damage is tried here, on a ledger that is
// NOT judged (the server's own bytes, however they got there). Each is either folded around or unfoldable, never a throw.

const damaged: readonly (readonly [string, Spec])[] = [
  ['a point with no payload', { type: 'tennis.point', payload: null }],
  ['a point whose side is a number', { type: 'tennis.point', payload: { by: 7 } }],
  ['a point whose payload is a string', { type: 'tennis.point', payload: 'ent-home' }],
  ['a point by nobody on the match', { type: 'tennis.point', payload: { by: 'ent-nobody' } }],
  [
    'a point with an extra field',
    { type: 'tennis.point', payload: { by: 'ent-home', serving: 'x' } },
  ],
  ['a set score of strings', { type: 'tennis.set_summary', payload: { home: '6', away: '4' } }],
  ['a set score of nothing', { type: 'tennis.set_summary', payload: {} }],
  [
    'a set score that cannot be reached',
    { type: 'tennis.set_summary', payload: { home: 99, away: 0 } },
  ],
  [
    'a sanction of a level nobody lists',
    { type: 'tennis.sanction', payload: { by: 'ent-home', level: 'x' } },
  ],
  ['a sanction with no payload', { type: 'tennis.sanction', payload: undefined }],
  ['an award of nobody', { type: 'tennis.game.award', payload: { winner: null } }],
  ['a break of a kind nobody lists', { type: 'tennis.interruption', payload: { kind: 'x' } }],
  ['a forfeit with no reason', { type: 'core.forfeit', payload: { by: 'ent-home' } }],
  ['a forfeit with an array', { type: 'core.forfeit', payload: [] }],
  ['an abandon with no reason', { type: 'core.abandon', payload: {} }],
  ['a void of nothing', { type: 'core.void', payload: {}, voids: 99 }],
  ['an event type from another sport', { type: 'football.goal', payload: { by: 'ent-home' } }],
  ['an event with an empty type', { type: '', payload: {} }],
  ['a second start', { type: 'core.start', payload: {} }],
];

describe('a ledger the engine cannot read never throws out of the fold', () => {
  it.each(damaged)('%s, at the start and after play', (_name, spec) => {
    for (const specs of [[spec], [start(), spec], [start(), spec, spec]]) {
      const input = {
        bootstrap: SINGLES,
        ledger: ledgerOf(specs),
        queued: [],
        ownEventIds: [],
        toss: null,
      };
      const result = (() => {
        try {
          return foldTennis(input);
        } catch (error) {
          return error;
        }
      })();
      expect(result, String(result)).toHaveProperty('kind');
    }
  });

  /** A ledger whose every payload throws a TypeError of its own when read, as damaged JSON can once it is parsed. */
  const throwing = () =>
    ledgerOf([start(), { type: 'tennis.point', payload: { by: 'ent-home' } }]).map((event) => ({
      ...event,
      payload: new Proxy(
        {},
        {
          get: () => {
            throw new TypeError('damaged');
          },
          ownKeys: () => {
            throw new TypeError('damaged');
          },
        },
      ),
    }));

  it('a throw that is not the engine’s is no throw: the match is unfoldable, the detail naming the error and not its words', () => {
    const input = {
      bootstrap: SINGLES,
      ledger: throwing(),
      queued: [],
      ownEventIds: [],
      toss: null,
    };
    expect(foldTennis(input)).toEqual({
      kind: 'unfoldable',
      reason: 'ledger',
      detail: 'damaged:TypeError',
    });
  });

  it('the same with a tap of this phone queued on top (the legality walk meets the damage first), and the tap is not legal', () => {
    const input = {
      bootstrap: SINGLES,
      ledger: throwing(),
      queued: [queuedOf('tap-1', { type: 'tennis.point', payload: { by: 'ent-home' } })],
      ownEventIds: [],
      toss: null,
    };
    expect(foldTennis(input)).toEqual({
      kind: 'unfoldable',
      reason: 'ledger',
      detail: 'damaged:TypeError',
    });
  });

  it('an engine refusal is unfoldable too, its detail the engine’s code', () => {
    const input = {
      bootstrap: SINGLES,
      ledger: ledgerOf([start(), start()]),
      queued: [],
      ownEventIds: [],
      toss: null,
    };
    expect(foldTennis(input)).toEqual({
      kind: 'unfoldable',
      reason: 'ledger',
      detail: 'engine:WRONG_PHASE',
    });
  });

  it('a healthy ledger with a queued tap still folds, the tap legal (the walk guard does not swallow legal taps)', () => {
    const input = {
      bootstrap: SINGLES,
      ledger: ledgerOf([start()]),
      queued: [queuedOf('tap-1', { type: 'tennis.point', payload: { by: 'ent-home' } })],
      ownEventIds: [],
      toss: null,
    };
    expect(foldTennis(input)).toMatchObject({ kind: 'folded', legalQueued: ['tap-1'] });
  });
});
