import { describe, expect, it } from 'vitest';
import { badmintonEventFor } from '@/domain/scoring/badmintonEvents';
import type { BadmintonDisplay, BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { Bootstrap, BootstrapSide } from '@/domain/scoring/wire';

// Plan S2-1 Task 7 (design §7.3): what each pad tap is on the wire. The top half is `home`, the bottom `away`; a rally is
// `badminton.rally {wonBy}`, and the match's first rally names the toss side's entrant as `serving`; Start is
// `core.start {}`; a sanction `badminton.sanction {by, level, person}`; Set score `badminton.game.summary {home, away,
// partial: true}`; a disqualification's ending `core.forfeit {by, reason: 'disqualified'}`, and nothing else ends a
// match from this pad (a device link gets 403 for a settle, an abandon or any other forfeit).

function side(entrantId: string, players: readonly [string, string][]): BootstrapSide {
  return {
    entrantId,
    name: players.map(([, name]) => name).join(' / '),
    kind: players.length > 1 ? 'pair' : 'individual',
    members: players.map(([personId, fullName]) => ({ personId, fullName })),
    lineup: players.map(([personId], i) => ({
      personId,
      pairOrder: players.length > 1 ? i + 1 : null,
    })),
  };
}

const BOOTSTRAP: Bootstrap = {
  fixtureId: 'fx-1',
  linkId: 'link-phone',
  sportKey: 'badminton',
  moduleVersion: '1.0.0',
  cfg: {},
  rulesVersion: 1,
  epochRequired: 2,
  screen: 'pad',
  viewOnlyReason: null,
  context: { competition: 'Spring Open 2026', division: null, round: null, match: 'Match 4' },
  sides: {
    home: side('ent-home', [
      ['p-sharma', 'A. Sharma'],
      ['p-iyer', 'R. Iyer'],
    ]),
    away: side('ent-away', [
      ['p-chen', 'L. Chen'],
      ['p-wong', 'M. Wong'],
    ]),
  },
  lastSeq: 0,
  status: 'in_play',
};

/** Doubles, started, before the match's first rally. */
const PRE: BadmintonDisplay = {
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
  context: {
    competition: 'Spring Open 2026',
    division: null,
    round: null,
    match: 'Match 4',
    sides: ['A. Sharma / R. Iyer', 'L. Chen / M. Wong'],
  },
  points: { first: 0, second: 0 },
  finished: [],
  server: 'second',
  court: 'right',
  game: 1,
  rules: { bestOf: 3, points: 21, winBy: 2, cap: 30, intervalPoint: 11 },
  phase: 'pre',
  sanctions: [],
  lastTap: { kind: 'start', server: 'second' },
  undoable: true,
  awaitingEnding: false,
};

const LIVE: BadmintonDisplay = {
  ...PRE,
  points: { first: 3, second: 1 },
  server: 'first',
  court: 'left',
  phase: 'live',
  lastTap: { kind: 'rally', side: 'first', won: 'none', game: 1 },
};

/** L. Chen disqualified at 3-1, the ending not yet recorded. */
const AWAITING: BadmintonDisplay = {
  ...LIVE,
  sanctions: [
    { side: 'first', level: 'warning', person: 'R. Iyer' },
    { side: 'second', level: 'disqualification', person: 'L. Chen' },
  ],
  lastTap: { kind: 'sanction', side: 'second', level: 'disqualification', person: 'L. Chen' },
  awaitingEnding: true,
};

const eventFor = (
  tap: BadmintonTap,
  display: BadmintonDisplay = LIVE,
  toss: 'first' | 'second' | null = null,
) => badmintonEventFor(tap, { bootstrap: BOOTSTRAP, display, toss });

describe('badmintonEventFor: the start and the rallies', () => {
  it('starts the match with an empty core.start: the toss travels on the first rally', () => {
    expect(eventFor({ kind: 'start', server: 'second' }, { ...PRE, phase: 'notStarted' })).toEqual({
      type: 'core.start',
      payload: {},
    });
  });

  it('gives the top half’s rally to home and the bottom half’s to away', () => {
    expect(eventFor({ kind: 'rally', side: 'first' })).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
    });
    expect(eventFor({ kind: 'rally', side: 'second' })).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-away' },
    });
  });

  it('names the toss side as serving on the match’s first rally, whichever side wins it', () => {
    expect(eventFor({ kind: 'rally', side: 'first' }, PRE, 'second')).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home', serving: 'ent-away' },
    });
    expect(eventFor({ kind: 'rally', side: 'second' }, PRE, 'first')).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-away', serving: 'ent-home' },
    });
  });

  it('names no server on any later rally: the second of the match, or a later game’s first', () => {
    expect(eventFor({ kind: 'rally', side: 'first' }, LIVE, 'second')).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
    });
    const between: BadmintonDisplay = { ...LIVE, phase: 'betweenGames', game: 2 };
    expect(eventFor({ kind: 'rally', side: 'second' }, between, 'second')).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-away' },
    });
  });

  // An empty input: a match started elsewhere, or a phone that lost its pick, has no toss. The rally says nothing of
  // the server rather than make one up; the engine knows it from the rally's winner after that.
  it('names no server on the first rally when this phone holds no toss', () => {
    expect(eventFor({ kind: 'rally', side: 'first' }, PRE, null)).toEqual({
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
    });
  });
});

describe('badmintonEventFor: sanctions and the set score', () => {
  it('records a sanction against the side, naming the person by the id the bootstrap gave', () => {
    expect(
      eventFor({ kind: 'sanction', side: 'second', level: 'penalty', person: 'M. Wong' }),
    ).toEqual({
      type: 'badminton.sanction',
      payload: { by: 'ent-away', level: 'penalty', person: 'p-wong' },
    });
  });

  it('records nothing for a person who does not play for that side', () => {
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'L. Chen' }),
    ).toBeNull();
    expect(
      eventFor({ kind: 'sanction', side: 'first', level: 'warning', person: 'Nobody' }),
    ).toBeNull();
  });

  it('sets the game’s points top first as home and away, a partial summary', () => {
    expect(eventFor({ kind: 'setScore', first: 9, second: 4 }, PRE)).toEqual({
      type: 'badminton.game.summary',
      payload: { home: 9, away: 4, partial: true },
    });
  });
});

describe('badmintonEventFor: the ending, and nothing else that ends a match', () => {
  it('records a disqualification’s ending as a forfeit by the side disqualified', () => {
    expect(eventFor({ kind: 'ending', side: 'second', person: 'L. Chen' }, AWAITING)).toEqual({
      type: 'core.forfeit',
      payload: { by: 'ent-away', reason: 'disqualified' },
    });
  });

  // The engine takes a forfeit by either side after a disqualification: a mistaken side would hand the match to the
  // side disqualified. The pad's ending is the waiting disqualification's, or nothing.
  it('records nothing for an ending naming the other side', () => {
    expect(eventFor({ kind: 'ending', side: 'first', person: 'A. Sharma' }, AWAITING)).toBeNull();
  });

  it('records nothing for an ending with no disqualification waiting', () => {
    expect(eventFor({ kind: 'ending', side: 'second', person: 'L. Chen' }, LIVE)).toBeNull();
    const warned: BadmintonDisplay = {
      ...LIVE,
      sanctions: [{ side: 'second', level: 'warning', person: 'L. Chen' }],
      awaitingEnding: true,
    };
    expect(eventFor({ kind: 'ending', side: 'second', person: 'L. Chen' }, warned)).toBeNull();
  });

  // A second call: the ending is already recorded, so the disqualification no longer waits for one.
  it('records nothing once the ending is recorded', () => {
    const ended: BadmintonDisplay = { ...AWAITING, phase: 'decided', awaitingEnding: false };
    expect(eventFor({ kind: 'ending', side: 'second', person: 'L. Chen' }, ended)).toBeNull();
  });

  // Task 9 additions: the pad never emits core.settle or core.abandon, and core.forfeit only as a disqualification's
  // ending. Every tap the pad can make, at every point a match can be at, one type each.
  it('never emits a settle or an abandon, and a forfeit only as a disqualification’s ending', () => {
    const taps: readonly BadmintonTap[] = [
      { kind: 'start', server: 'first' },
      { kind: 'rally', side: 'first' },
      { kind: 'rally', side: 'second' },
      { kind: 'sanction', side: 'first', level: 'disqualification', person: 'A. Sharma' },
      { kind: 'sanction', side: 'second', level: 'warning', person: 'L. Chen' },
      { kind: 'setScore', first: 1, second: 0 },
      { kind: 'ending', side: 'first', person: 'A. Sharma' },
      { kind: 'ending', side: 'second', person: 'L. Chen' },
    ];
    const seen = [PRE, LIVE, AWAITING].flatMap((display) =>
      taps.map((tap) => {
        const made = eventFor(tap, display, 'first');
        return made === null ? null : [made.type, display === AWAITING, tap.kind];
      }),
    );
    const types = new Set(seen.flatMap((made) => (made === null ? [] : [made[0]])));
    expect([...types].sort()).toEqual([
      'badminton.game.summary',
      'badminton.rally',
      'badminton.sanction',
      'core.forfeit',
      'core.start',
    ]);
    expect(seen.filter((made) => made?.[0] === 'core.forfeit')).toEqual([
      ['core.forfeit', true, 'ending'],
    ]);
  });
});

describe('badmintonEventFor: a match with an empty seat', () => {
  it('records nothing for a side the bootstrap has no entrant for', () => {
    const bye: Bootstrap = { ...BOOTSTRAP, sides: { ...BOOTSTRAP.sides, away: null } };
    expect(
      badmintonEventFor(
        { kind: 'rally', side: 'second' },
        { bootstrap: bye, display: LIVE, toss: null },
      ),
    ).toBeNull();
    expect(
      badmintonEventFor(
        { kind: 'rally', side: 'first' },
        { bootstrap: bye, display: PRE, toss: 'second' },
      ),
    ).toBeNull();
  });
});
