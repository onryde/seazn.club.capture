import type { EventEnvelope } from '@seazn/engine/core';
import { badminton, tabletennis, type SetBasedModule } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import {
  foldOf,
  foldSetBased,
  voidedIn,
  voidsAgain,
  type SetBasedEvents,
  type SetBasedFolding,
  type SetBasedKit,
} from '@/domain/scoring/setBasedFold';
import { setBasedRefusalOf } from '@/domain/scoring/setBasedEngine';
import type { Bootstrap, LedgerEvent } from '@/domain/scoring/wire';
import {
  AWAY,
  HOME,
  SINGLES as BADMINTON_SINGLES,
  ledgerOf as badmintonLedgerOf,
  queuedOf as badmintonQueuedOf,
} from '../../../test/badmintonLedger';
import {
  SINGLES as TABLETENNIS_SINGLES,
  ledgerOf as tableTennisLedgerOf,
  queuedOf as tableTennisQueuedOf,
} from '../../../test/tableTennisLedger';

// The fold the set-based sports share (lifted from badminton's, plan S2-2 fix round 1). It is driven here through a plain
// kit for each of the two engine modules, with made-up words for what an event did, so what is asserted is the shared
// part only: the stream, the legal queued taps, each event's facts, and what a void takes back.

type Case = {
  readonly name: string;
  readonly module: SetBasedModule;
  readonly sport: 'badminton' | 'tabletennis';
  readonly bootstrap: Bootstrap;
  readonly ledgerOf: (specs: readonly Spec[]) => LedgerEvent[];
  readonly queuedOf: (key: string, spec: Spec) => QueuedEvent;
  /** The points a game is played to, and the games that win the match: the sport's own (BWF 21, best of 3; ITTF 11, best of 5). */
  readonly gameTo: number;
  readonly gamesToWin: number;
};

type Spec = { readonly type: string; readonly payload: unknown; readonly voids?: number };

const CASES: readonly Case[] = [
  {
    name: 'badminton',
    module: badminton,
    sport: 'badminton',
    bootstrap: BADMINTON_SINGLES,
    ledgerOf: badmintonLedgerOf,
    queuedOf: badmintonQueuedOf,
    gameTo: 21,
    gamesToWin: 2,
  },
  {
    name: 'table tennis',
    module: tabletennis,
    sport: 'tabletennis',
    bootstrap: TABLETENNIS_SINGLES,
    ledgerOf: tableTennisLedgerOf,
    queuedOf: tableTennisQueuedOf,
    gameTo: 11,
    gamesToWin: 3,
  },
];

describe.each(CASES)('foldSetBased ($name)', (sportCase) => {
  const { module, sport, bootstrap } = sportCase;
  const RALLY = `${sport}.rally`;
  const SUMMARY = `${sport}.game.summary`;
  const events: SetBasedEvents = { module, rally: RALLY, summary: SUMMARY };

  const begin = (): Spec => ({ type: 'core.start', payload: {} });
  const point = (winner: 'H' | 'A', serving?: 'H' | 'A'): Spec => ({
    type: RALLY,
    payload: {
      wonBy: winner === 'H' ? HOME : AWAY,
      ...(serving === undefined ? {} : { serving: serving === 'H' ? HOME : AWAY }),
    },
  });
  const undo = (seq: number): Spec => ({
    type: 'core.void',
    payload: { event_id: `ev-${seq}` },
    voids: seq,
  });

  /** A kit that says what an event is called, judges an append by the engine alone, and records every question asked. */
  function kitOf(
    refuse: (next: EventEnvelope) => boolean = () => false,
    asked: { before: number; type: string }[] = [],
  ): SetBasedKit<string> {
    return {
      ...events,
      mayAppend: (match, before, next) => {
        asked.push({ before: before.length, type: next.type });
        return !refuse(next) && setBasedRefusalOf(module, match.engine, [...before, next]) === null;
      },
      doneOf: (envelope) => (envelope.type === 'core.void' ? null : envelope.type),
    };
  }

  function fold(
    specs: readonly Spec[],
    more: {
      readonly kit?: SetBasedKit<string>;
      readonly queued?: readonly QueuedEvent[];
      readonly own?: readonly string[];
      readonly toss?: 'first' | 'second' | null;
      readonly bootstrap?: Bootstrap;
    } = {},
  ) {
    const input: SportFoldInput = {
      bootstrap: more.bootstrap ?? bootstrap,
      ledger: sportCase.ledgerOf(specs as never),
      queued: more.queued ?? [],
      ownEventIds: more.own ?? [],
      toss: more.toss ?? null,
    };
    return foldSetBased(more.kit ?? kitOf(), input);
  }

  const folded = (...args: Parameters<typeof fold>): SetBasedFolding<string> => {
    const result = fold(...args);
    if (typeof result === 'string') throw new Error(`did not fold: ${result}`);
    return result;
  };

  describe('when it cannot fold', () => {
    it('says the sides, for a seat with no entrant yet', () => {
      const waiting: Bootstrap = { ...bootstrap, sides: { ...bootstrap.sides, away: null } };
      expect(fold([], { bootstrap: waiting })).toBe('sides');
    });

    it('says the config, for a config the engine’s schema refuses', () => {
      expect(fold([], { bootstrap: { ...bootstrap, cfg: 'garbled' } })).toBe('cfg');
    });

    it('says the ledger, for one the engine will not replay', () => {
      expect(fold([point('H')])).toBe('ledger');
    });
  });

  describe('the stream', () => {
    it('is the ledger and then the legal queued taps, numbered on from the last seq', () => {
      const queued = [sportCase.queuedOf('k1', point('A')), sportCase.queuedOf('k2', point('H'))];
      const { stream } = folded([begin(), point('H', 'H')], { queued });
      expect(stream.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 3, 4]);
      expect(stream.legal).toEqual(['k1', 'k2']);
      expect(stream.entries.map((entry) => [entry.sending, entry.own])).toEqual([
        [false, false],
        [false, false],
        [true, true],
        [true, true],
      ]);
    });

    it('marks the ledger events this phone recorded as its own', () => {
      const { stream } = folded([begin(), point('H', 'H')], { own: ['ev-2'] });
      expect(stream.entries.map((entry) => entry.own)).toEqual([false, true]);
    });

    it('judges each queued tap on the ledger and the legal taps before it, and skips an illegal one', () => {
      const asked: { before: number; type: string }[] = [];
      const kit = kitOf((next) => next.id === 'queued:k-bad', asked);
      const queued = [
        sportCase.queuedOf('k-bad', point('A')),
        sportCase.queuedOf('k-ok', point('H')),
      ];
      const { stream } = folded([begin(), point('H', 'H')], { kit, queued });
      expect(asked).toEqual([
        { before: 2, type: RALLY },
        { before: 2, type: RALLY },
      ]);
      expect(stream.legal).toEqual(['k-ok']);
      expect(stream.envelopes).toHaveLength(3);
    });

    it('lets the engine refuse a tap when the kit does not: a point before the start', () => {
      const queued = [sportCase.queuedOf('k', point('H', 'H'))];
      const { stream } = folded([], { queued });
      expect(stream.legal).toEqual([]);
    });

    it('takes no queued taps and shows the ledger alone when there are none', () => {
      const { stream } = folded([begin()]);
      expect(stream.legal).toEqual([]);
      expect(stream.envelopes).toHaveLength(1);
    });
  });

  describe('undo', () => {
    it('is offered on this phone’s last event, and not behind another scorer’s', () => {
      const ledger = [begin(), point('H', 'H'), point('A')];
      expect(folded(ledger, { own: ['ev-2', 'ev-3'] }).undoable).toBe(true);
      expect(folded(ledger, { own: ['ev-2'] }).undoable).toBe(false);
    });

    it('is not offered for a queued tap the kit dropped', () => {
      const kit = kitOf((next) => next.type === RALLY);
      const queued = [sportCase.queuedOf('k', point('H', 'H'))];
      expect(folded([begin()], { kit, queued, own: ['ev-1'] }).undoable).toBe(true);
      expect(folded([begin()], { kit, queued }).undoable).toBe(false);
    });
  });

  describe('what the fold says of each event', () => {
    it('gives a rally its game and the points after it, and the game or the match it won', () => {
      const first = Array.from({ length: sportCase.gameTo }, () => point('H'));
      const { folded: result } = folded([begin(), point('H', 'H'), ...first.slice(1)]);
      const facts = [...result.facts.values()];
      expect(facts.at(-1)).toMatchObject({
        game: 1,
        after: { first: sportCase.gameTo, second: 0 },
        won: 'game',
      });
      expect(facts[1]).toMatchObject({ game: 1, after: { first: 1, second: 0 }, won: 'none' });
    });

    it('says a rally won the match, not only the game, when it decides it', () => {
      const games = sportCase.gamesToWin * sportCase.gameTo;
      const all = [
        begin(),
        point('H', 'H'),
        ...Array.from({ length: games - 1 }, () => point('H')),
      ];
      const result = folded(all);
      const won = result.stream.envelopes.map(
        (envelope) => result.folded.facts.get(envelope.id)?.won,
      );
      expect(won.at(-1)).toBe('match');
      expect(won.at(-2)).toBe('none');
      expect(won.filter((one) => one === 'game')).toHaveLength(sportCase.gamesToWin - 1);
    });

    // A card is in both sports' ledgers; it is no rally, so it sits in the game under way, or the next one between games.
    const card = (person?: string): Spec => ({
      type: `${sport}.sanction`,
      payload: { by: HOME, level: 'warning', ...(person === undefined ? {} : { person }) },
    });
    const wonGame = (): Spec[] => Array.from({ length: sportCase.gameTo - 1 }, () => point('H'));

    it('puts an event that is no rally in the game under way, at the points it stands at', () => {
      const result = folded([begin(), point('H', 'H'), point('A'), card()]);
      expect(result.folded.facts.get('ev-4')).toMatchObject({
        game: 1,
        after: { first: 1, second: 1 },
        won: 'none',
      });
    });

    it('puts an event that is no rally between games in the next game, at nothing', () => {
      const result = folded([begin(), point('H', 'H'), ...wonGame(), card()]);
      expect(result.folded.state.sets[0]?.closed).toBe(true);
      const last = result.stream.envelopes.at(-1)!;
      expect(result.folded.facts.get(last.id)).toMatchObject({
        game: 2,
        after: { first: 0, second: 0 },
        won: 'none',
      });
    });

    // A game recorded whole closes the game it scored: its score is that game's, not the next one's.
    it('puts a game recorded whole in the game it scored, at its score, and the next event in the next game', () => {
      const whole: Spec = { type: SUMMARY, payload: { home: sportCase.gameTo, away: 7 } };
      const result = folded([begin(), whole, card()]);
      expect(result.folded.facts.get('ev-2')).toMatchObject({
        game: 1,
        after: { first: sportCase.gameTo, second: 7 },
        won: 'none',
      });
      expect(result.folded.facts.get('ev-3')).toMatchObject({
        game: 2,
        after: { first: 0, second: 0 },
      });
    });

    it('names the person of the latest sanction standing then, and none before any', () => {
      const result = folded([begin(), point('H', 'H'), card('p-sharma'), point('A')]);
      expect(result.folded.facts.get('ev-2')?.sanctionedPerson).toBeNull();
      expect(result.folded.facts.get('ev-3')?.sanctionedPerson).toBe('p-sharma');
      expect(result.folded.facts.get('ev-4')?.sanctionedPerson).toBe('p-sharma');
    });
  });

  describe('what each event did, and what a void takes back', () => {
    it('keeps the words of an event the pad has some for and drops the others', () => {
      const { recorded } = folded([begin(), point('H', 'H'), undo(2)]);
      expect([...recorded.keys()]).toEqual(['ev-1', 'ev-2']);
      expect(recorded.get('ev-2')?.did).toBe(RALLY);
    });

    it('keeps the score a voided rally left, from a fold of the stream up to it', () => {
      const result = folded([begin(), point('H', 'H'), point('A'), undo(2)]);
      expect(result.folded.state.sets[0]).toMatchObject({ home: 0, away: 1 });
      expect(result.recorded.get('ev-2')?.facts).toMatchObject({
        game: 1,
        after: { first: 1, second: 0 },
      });
    });

    it('hands the start’s server from the first rally still standing, never one a void took back', () => {
      const seen: (string | null)[] = [];
      const kit: SetBasedKit<string> = {
        ...kitOf(),
        doneOf: (envelope, _facts, _names, startServer) => {
          if (envelope.type === 'core.start') seen.push(startServer);
          return envelope.type;
        },
      };
      // Home's first rally named home as the server; it was taken back, and away's, which names away, stands.
      folded([begin(), point('H', 'H'), undo(2), point('A', 'A')], { kit });
      expect(seen).toEqual(['second']);
    });

    it('hands the start’s server to the kit: the first standing rally’s, else this phone’s pick', () => {
      const seen: (string | null)[] = [];
      const kit: SetBasedKit<string> = {
        ...kitOf(),
        doneOf: (envelope, _facts, _names, startServer) => {
          if (envelope.type === 'core.start') seen.push(startServer);
          return envelope.type;
        },
      };
      folded([begin(), point('A', 'A')], { kit });
      folded([begin()], { kit, toss: 'second' });
      folded([begin()], { kit });
      expect(seen).toEqual(['second', 'second', null]);
    });

    // Fix round 1: a rally names the server of ITS game. When game 1 was entered whole by Set score, the first standing
    // rally is game 2's, and its server is the other side's first server, not the match's: name nobody.
    it('hands the start no server when game 1 was entered by a set score: the first rally is game 2’s', () => {
      const seen: (string | null)[] = [];
      const kit: SetBasedKit<string> = {
        ...kitOf(),
        doneOf: (envelope, _facts, _names, startServer) => {
          if (envelope.type === 'core.start') seen.push(startServer);
          return envelope.type;
        },
      };
      const gameOne: Spec = { type: SUMMARY, payload: { home: sportCase.gameTo, away: 3 } };
      folded([begin(), gameOne, point('H', 'H')], { kit });
      folded([begin(), gameOne, point('H', 'H')], { kit, toss: 'second' });
      expect(seen).toEqual([null, null]);
    });

    it('still hands the start the server a game 1 rally names, once the set score for game 1 was undone', () => {
      const seen: (string | null)[] = [];
      const kit: SetBasedKit<string> = {
        ...kitOf(),
        doneOf: (envelope, _facts, _names, startServer) => {
          if (envelope.type === 'core.start') seen.push(startServer);
          return envelope.type;
        },
      };
      const gameOne: Spec = { type: SUMMARY, payload: { home: sportCase.gameTo, away: 3 } };
      folded([begin(), gameOne, undo(2), point('H', 'A')], { kit });
      expect(seen).toEqual(['second']);
    });
  });

  describe('the serve', () => {
    it('is the engine’s, and this phone’s pick only until a rally names one', () => {
      const pick = folded([begin()], { toss: 'second' });
      expect(pick.serve.side).toBeNull();
      expect(pick.picked).toBe('second');
      const named = folded([begin(), point('H', 'H')], { toss: 'second' });
      expect(named.serve.side).toBe('home');
      expect(named.picked).toBeNull();
    });
  });

  describe('the helpers', () => {
    it('lists the events a void takes back, and a repeat of such a void', () => {
      const envelopes = folded([begin(), point('H', 'H'), undo(2)]).stream.envelopes;
      expect([...voidedIn(envelopes)]).toEqual(['ev-2']);
      expect(voidedIn([])).toEqual(new Set());
      const again = { ...envelopes[2]!, id: 'ev-4', seq: 4 };
      expect(voidsAgain(envelopes, again)).toBe(true);
      expect(voidsAgain(envelopes.slice(0, 2), again)).toBe(false);
      expect(voidsAgain(envelopes, envelopes[1]!)).toBe(false);
    });

    it('folds a prefix on its own: null for a stream the engine will not replay', () => {
      const envelopes = folded([begin(), point('H', 'H')]).stream.envelopes;
      const match = folded([begin()]).match.engine;
      expect(foldOf(events, match, envelopes)?.state.phase).toBe('live');
      expect(foldOf(events, match, envelopes.slice(1))).toBeNull();
    });
  });

  it('answers the same for the same input, and changes none of it', () => {
    const ledger = Object.freeze(
      sportCase.ledgerOf([begin(), point('H', 'H'), point('A')] as never),
    );
    const queued = Object.freeze([sportCase.queuedOf('k', point('H'))]);
    const input: SportFoldInput = Object.freeze({
      bootstrap,
      ledger,
      queued,
      ownEventIds: Object.freeze(['ev-2']),
      toss: null,
    });
    const before = JSON.stringify(input);
    expect(foldSetBased(kitOf(), input)).toEqual(foldSetBased(kitOf(), input));
    expect(JSON.stringify(input)).toBe(before);
  });
});
