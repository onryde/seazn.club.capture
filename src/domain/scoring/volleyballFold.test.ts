import type { SetBasedServeContext, SetBasedServeUnknown } from '@seazn/engine/sports/setbased';
import { describe, expect, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import { foldVolleyball, needsAnchor } from '@/domain/scoring/volleyballFold';
import type { VolleyballDisplay } from '@/domain/scoring/volleyballTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  BEACH,
  INDOOR,
  judgedLedgerOf,
  queuedOf,
  rally,
  sanction,
  start,
  sub,
  summary,
  timeout,
  voiding,
  wholeSet,
  type Spec,
} from '../../../test/volleyballLedger';

// S2-6 Task 4 (ruling 175, 179, 180, 186; spec §4–§5): the pad's display is the server's ledger folded through
// @seazn/engine with this phone's legal queued taps on top. Every expected value is written out from FIVB's rules (12.2.2
// side-out, 7.1 first service of sets 2-4 alternates and the deciding set is tossed afresh) and the spec, never computed
// by the fold. Top half = home. Ledgers go through the real engine (`judgedLedgerOf`), so none is one a server refuses.

function fold(
  specs: readonly Spec[],
  more: {
    readonly queued?: readonly QueuedEvent[];
    readonly toss?: PadSide | null;
    readonly bootstrap?: Bootstrap;
  } = {},
) {
  const bootstrap = more.bootstrap ?? INDOOR;
  const input: SportFoldInput = {
    bootstrap,
    ledger: judgedLedgerOf(bootstrap, specs),
    queued: more.queued ?? [],
    ownEventIds: [],
    toss: more.toss ?? null,
  };
  return foldVolleyball(input);
}

function folded(...args: Parameters<typeof fold>) {
  const result = fold(...args);
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result;
}

const display = (...args: Parameters<typeof fold>): VolleyballDisplay => folded(...args).display;

/** One set to `to` for `winner`, nothing for the other; the first set's first rally names the first server. */
const wonSet = (winner: 'H' | 'A', serving?: 'H' | 'A', to = 25): Spec[] => [
  rally({ wonBy: winner, ...(serving === undefined ? {} : { serving }) }),
  ...Array.from({ length: to - 1 }, () => rally({ wonBy: winner })),
];

/** Home takes set 1 and 3, away sets 2 and 4: two sets all, the deciding set to come. */
const TWO_ALL: Spec[] = [
  start(),
  ...wonSet('H', 'H'),
  ...wonSet('A'),
  ...wonSet('H'),
  ...wonSet('A'),
];

const ZERO = { first: 0, second: 0 };

/** The beach pair's serving player on a rally: the engine checks it against the declared order. */
const withServer = (spec: Spec, at: number): Spec =>
  at === 0 ? rally({ wonBy: 'H', serving: 'H', server: 'h1' }) : spec;

describe('foldVolleyball: before the start', () => {
  it('opens an indoor match nobody has started: set 1 of 5, to 25, no serve, nothing to undo', () => {
    const result = folded([]);
    expect(result.display).toEqual({
      sides: {
        first: { players: ['Falcons'] },
        second: { players: ['Herons'] },
      },
      context: {
        competition: 'Spring League 2026',
        division: 'Open',
        round: 'Round 1',
        match: 'Match 2',
        sides: ['Falcons', 'Herons'],
      },
      points: ZERO,
      finished: [],
      set: 1,
      target: 25,
      rules: { bestOf: 5, setTo: 25, finalSetTo: 15, winBy: 2, scoreBound: 45 },
      phase: 'notStarted',
      beach: false,
      serving: null,
      serverPicked: false,
      serverPerson: null,
      serverPersonId: null,
      anchorNeeded: false,
      scoreEvents: 0,
      note: null,
      counts: { first: { timeouts: 0, subs: 0 }, second: { timeouts: 0, subs: 0 } },
      caps: { timeouts: 2, subs: 6 },
      heaviest: { first: null, second: null },
      records: { timeouts: true, sanctions: true, substitutions: true },
      lastTap: null,
      undoable: false,
    } satisfies VolleyballDisplay);
    expect(result.legalQueued).toEqual([]);
  });

  it('a seat with no entrant, or a config the engine refuses, does not fold', () => {
    const noAway = { ...INDOOR, sides: { home: INDOOR.sides.home, away: null } };
    expect(foldVolleyball({ ...base(INDOOR), bootstrap: noAway })).toEqual({
      kind: 'unfoldable',
      reason: 'sides',
    });
    expect(
      foldVolleyball({ ...base(INDOOR), bootstrap: { ...INDOOR, cfg: { bestOf: 'x' } } }),
    ).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });
});

function base(bootstrap: Bootstrap): SportFoldInput {
  return { bootstrap, ledger: [], queued: [], ownEventIds: [], toss: null };
}

describe('foldVolleyball: the serve (FIVB 12.2.2, 7.1)', () => {
  it('shows this phone’s Start pick before the first rally, and says it is a pick', () => {
    const shown = display([start()], { toss: 'second' });
    expect([shown.serving, shown.serverPicked, shown.anchorNeeded]).toEqual([
      'second',
      true,
      false,
    ]);
  });

  it('side-out: the side that wins a rally serves the next', () => {
    const afterFirst = display([start(), rally({ wonBy: 'H', serving: 'H' })]);
    expect([afterFirst.serving, afterFirst.serverPicked]).toEqual(['first', false]);
    const afterSecond = display([
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      rally({ wonBy: 'A' }),
    ]);
    expect(afterSecond.serving).toBe('second');
    expect(afterSecond.points).toEqual({ first: 1, second: 1 });
  });

  it('the first service of set 2 alternates: set 1 opened with home, so set 2 opens with away, set 3 with home', () => {
    const set2 = display([start(), ...wonSet('H', 'H')]);
    expect([set2.set, set2.points, set2.serving, set2.phase]).toEqual([
      2,
      ZERO,
      'second',
      'betweenGames',
    ]);
    const set3 = display([start(), ...wonSet('H', 'H'), ...wonSet('A')]);
    expect([set3.set, set3.serving]).toEqual([3, 'first']);
  });

  it('the deciding set is tossed afresh: at 0-0 of set 5 the pad asks, and names nobody', () => {
    const toss = display(TWO_ALL);
    expect([toss.set, toss.target, toss.points, toss.serving, toss.anchorNeeded]).toEqual([
      5,
      15,
      ZERO,
      null,
      true,
    ]);
    expect(toss.finished).toHaveLength(4);
  });

  it('a rally that names the first server answers the toss: the question goes and side-out takes over', () => {
    const answered = display([...TWO_ALL, rally({ wonBy: 'A', serving: 'A' })]);
    expect([answered.anchorNeeded, answered.serving, answered.points]).toEqual([
      false,
      'second',
      { first: 0, second: 1 },
    ]);
  });

  it('a rally with no answer also ends the question: the winner serves next', () => {
    const co = display([...TWO_ALL, rally({ wonBy: 'H' })]);
    expect([co.anchorNeeded, co.serving]).toEqual([false, 'first']);
  });

  it('Undo of the rally that carried the toss brings the question back', () => {
    const rallySeq = TWO_ALL.length + 1;
    const back = display([...TWO_ALL, rally({ wonBy: 'A', serving: 'A' }), voiding(rallySeq)]);
    expect([back.anchorNeeded, back.serving, back.points]).toEqual([true, null, ZERO]);
  });

  it('a match started elsewhere with nobody named asks at 0-0, and this phone’s Start pick stands in once given', () => {
    const asked = display([start()]);
    expect([asked.anchorNeeded, asked.serving]).toEqual([true, null]);
    expect(display([start()], { toss: 'first' }).anchorNeeded).toBe(false);
  });

  it('a queued rally that answers the toss is seen at once', () => {
    const queued = [queuedOf('q1', rally({ wonBy: 'A', serving: 'A' }))];
    const shown = display(TWO_ALL, { queued });
    expect([shown.anchorNeeded, shown.serving]).toEqual([false, 'second']);
  });
});

const rallies24 = (): Spec[] => Array.from({ length: 24 }, () => rally({ wonBy: 'H' }));

describe('foldVolleyball: timeouts, per set (ruling 175)', () => {
  const live = [start(), rally({ wonBy: 'H', serving: 'H' })];

  it('counts each side’s timeouts in the set under way', () => {
    const shown = display([...live, timeout('H'), timeout('A'), timeout('H')]);
    expect(shown.counts).toEqual({
      first: { timeouts: 2, subs: 0 },
      second: { timeouts: 1, subs: 0 },
    });
  });

  it('a new set starts again from none: the engine counts a match, the phone a set', () => {
    const shown = display([...live, timeout('H'), ...wonSet('H').slice(1), timeout('A')]);
    expect(shown.set).toBe(2);
    expect(shown.counts).toEqual({
      first: { timeouts: 0, subs: 0 },
      second: { timeouts: 1, subs: 0 },
    });
  });

  it('a timeout after a set closes and before the next set’s first rally belongs to the next set', () => {
    const closed = [start(), ...wonSet('H', 'H'), timeout('A')];
    expect(display(closed).counts.second.timeouts).toBe(1);
    // ...and the set after it, once its first rally stands, still counts it (it is that set's).
    expect(display([...closed, rally({ wonBy: 'A' })]).counts.second.timeouts).toBe(1);
  });

  it('Undo of a set-2 timeout taken at 0-0 restores set 2’s count', () => {
    const upTo = [start(), ...wonSet('H', 'H')];
    const timeoutSeq = upTo.length + 1;
    expect(display([...upTo, timeout('A')]).counts.second.timeouts).toBe(1);
    expect(display([...upTo, timeout('A'), voiding(timeoutSeq)]).counts.second.timeouts).toBe(0);
  });

  it('Undo of the set-closing rally takes the timeout recorded between sets back into the earlier set (M4)', () => {
    // seq: start 1, rally 2, set-1 timeout 3, rallies 4..27 (27 closes set 1 at 25), between-sets timeout 28.
    const setOne = [start(), rally({ wonBy: 'H', serving: 'H' }), timeout('A'), ...rallies24()];
    const closing = setOne.length;
    const closed = [...setOne, timeout('A')];
    const before = display(closed);
    expect([before.set, before.counts.second.timeouts]).toEqual([2, 1]);
    const after = display([...closed, voiding(closing)]);
    expect([after.set, after.counts.second.timeouts]).toEqual([1, 2]);
  });

  it('a timeout still waiting in the queue counts (the phone is offline)', () => {
    const shown = display(live, { queued: [queuedOf('q1', timeout('A'))] });
    expect(shown.counts.second.timeouts).toBe(1);
  });

  it('never refuses a third: the count passes the number and the pad only shows it', () => {
    const shown = display([...live, timeout('H'), timeout('H'), timeout('H')]);
    expect(shown.counts.first.timeouts).toBe(3);
  });
});

describe('foldVolleyball: substitutions, per set (indoor)', () => {
  const live = [start(), rally({ wonBy: 'H', serving: 'H' })];

  it('counts a side’s subs in the set, and starts again from none in the next', () => {
    const inSet1 = display([...live, sub('H', { off: 'h1', on: 'h7' }), sub('H'), sub('A')]);
    expect([inSet1.counts.first.subs, inSet1.counts.second.subs]).toEqual([2, 1]);
    const inSet2 = display([
      ...live,
      sub('H', { off: 'h1', on: 'h7' }),
      ...wonSet('H').slice(1),
      sub('H', { off: 'h2', on: 'h1' }),
    ]);
    expect([inSet2.set, inSet2.counts.first.subs]).toEqual([2, 1]);
  });

  it('a sub the engine would refuse is skipped, not counted: beach records none', () => {
    const queued = [queuedOf('q1', sub('H', { off: 'h1', on: 'h2' }))];
    const result = folded([start(), rally({ wonBy: 'H', serving: 'H' })], {
      bootstrap: BEACH,
      queued,
    });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.counts.first.subs).toBe(0);
  });
});

describe('foldVolleyball: a variant', () => {
  it('beach: pairs, one timeout, no subs, to 21 and the deciding set to 15', () => {
    const shown = display([], { bootstrap: BEACH });
    expect([shown.beach, shown.caps, shown.records.substitutions]).toEqual([
      true,
      { timeouts: 1, subs: 0 },
      false,
    ]);
    expect([shown.rules.bestOf, shown.target, shown.rules.finalSetTo]).toEqual([3, 21, 15]);
  });

  it('indoor: two timeouts and six subs a set', () => {
    expect(display([]).caps).toEqual({ timeouts: 2, subs: 6 });
  });
});

describe('foldVolleyball: the beach server, from the pair order (ruling 173, 188)', () => {
  const beachRally = [start(), rally({ wonBy: 'H', serving: 'H', server: 'h1' })];

  it('names the serving player the engine names: the first of the pair serves first', () => {
    const named = display(beachRally, { bootstrap: BEACH });
    expect([named.serving, named.serverPersonId, named.serverPerson]).toEqual([
      'first',
      'h1',
      'Sand / Surf h1',
    ]);
  });

  it('a beach side is its pair’s two players; an indoor side is its team, never the roster', () => {
    expect(display([], { bootstrap: BEACH }).sides).toEqual({
      first: { players: ['Sand / Surf h1', 'Sand / Surf h2'] },
      second: { players: ['Dune / Tide a1', 'Dune / Tide a2'] },
    });
    expect(display([]).sides.first.players).toEqual(['Falcons']);
  });

  it('indoor names the serving side only, even when its sheet carries a pair order', () => {
    const indoorPairs = { ...INDOOR, sides: BEACH.sides };
    const shown = display(beachRally, { bootstrap: indoorPairs });
    expect([shown.serving, shown.serverPersonId, shown.serverPerson]).toEqual([
      'first',
      null,
      null,
    ]);
    const plain = display([start(), rally({ wonBy: 'H', serving: 'H' })]);
    expect([plain.serverPersonId, plain.serverPerson]).toEqual([null, null]);
  });

  it('names nobody for a side that lists more than its pair: a reserve row could make the phone and the web disagree', () => {
    const { home } = BEACH.sides;
    if (home === null) throw new Error('seed has a home side');
    const reserve = { personId: 'h-res', pairOrder: null, slot: 'bench' as const, orderNo: 3 };
    const withReserve = {
      ...BEACH,
      sides: { ...BEACH.sides, home: { ...home, lineup: [...home.lineup, reserve] } },
    };
    const shown = display(beachRally, { bootstrap: withReserve });
    expect([shown.serving, shown.serverPersonId]).toEqual(['first', null]);
  });

  it('a deciding-set toss names no server: the engine names nobody there', () => {
    // Set 1 to home, set 2 to away on beach: one set all, the deciding (3rd) set is tossed afresh.
    const oneAll = [
      start(),
      ...wonSet('H', 'H', 21).map(withServer),
      ...wonSet('A', undefined, 21),
    ];
    const toss = display(
      oneAll.map((spec, at) => (at === 0 ? spec : spec)),
      {
        bootstrap: BEACH,
      },
    );
    expect([toss.set, toss.serving, toss.serverPersonId, toss.anchorNeeded]).toEqual([
      3,
      null,
      null,
      true,
    ]);
  });
});

describe('foldVolleyball: the sanction in the set (ruling 187; a per-set walk)', () => {
  const live = [start(), rally({ wonBy: 'H', serving: 'H' })];

  it('shows each side’s heaviest sanction of the set', () => {
    const shown = display([
      ...live,
      sanction('H', 'warning'),
      sanction('H', 'penalty'),
      sanction('A', 'warning'),
    ]);
    expect(shown.heaviest).toEqual({ first: 'penalty', second: 'warning' });
  });

  it('a lighter one after a heavier one does not lower it', () => {
    const shown = display([...live, sanction('H', 'expulsion'), sanction('H', 'warning')]);
    expect(shown.heaviest.first).toBe('expulsion');
  });

  it('a new set starts with none, and one given there is that set’s', () => {
    const set2 = [...live, sanction('H', 'penalty'), ...wonSet('H').slice(1)];
    expect(display(set2).heaviest).toEqual({ first: null, second: null });
    expect(display([...set2, sanction('A', 'expulsion')]).heaviest).toEqual({
      first: null,
      second: 'expulsion',
    });
  });

  it('an undone sanction is not counted', () => {
    const seq = live.length + 1;
    expect(display([...live, sanction('H', 'penalty'), voiding(seq)]).heaviest.first).toBeNull();
  });

  it('never touches the score (the engine keeps the sanction off it)', () => {
    expect(display([...live, sanction('A', 'penalty')]).points).toEqual({ first: 1, second: 0 });
  });
});

describe('foldVolleyball: the score and the set score', () => {
  it('counts rallies and set scores as the score events, undone ones not', () => {
    const specs = [start(), rally({ wonBy: 'H', serving: 'H' }), rally({ wonBy: 'A' })];
    expect(display(specs).scoreEvents).toBe(2);
    expect(display([...specs, voiding(3)]).scoreEvents).toBe(1);
    expect(display([...specs, timeout('H')]).scoreEvents).toBe(2);
  });

  it('a queued rally is a score event', () => {
    const shown = display([start()], { queued: [queuedOf('q1', rally({ wonBy: 'H' }))] });
    expect(shown.scoreEvents).toBe(1);
  });

  it('a set score given so far shows as the score, and a set recorded whole closes it; each counts', () => {
    const sofar = display([start(), summary(20, 18)]);
    expect([sofar.points, sofar.finished.length, sofar.scoreEvents]).toEqual([
      { first: 20, second: 18 },
      0,
      1,
    ]);
    const whole = display([start(), wholeSet(25, 20)]);
    expect([whole.finished.length, whole.scoreEvents, whole.set]).toEqual([1, 1, 2]);
  });

  it('level in the endgame says what the next point means, and not before', () => {
    const toDeuce = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      ...Array.from({ length: 23 }, () => rally({ wonBy: 'H' })),
    ];
    // 24-0 is not level; take 24-24.
    const level = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      ...Array.from({ length: 23 }, () => rally({ wonBy: 'H' })),
      ...Array.from({ length: 24 }, () => rally({ wonBy: 'A' })),
    ];
    expect(display(toDeuce).note).toBeNull();
    expect(display(level).note).toBe('setting');
  });
});

describe('foldVolleyball: a match decided', () => {
  it('three sets to none ends it, the last set’s score stays up and nothing is due', () => {
    const shown = display([start(), ...wonSet('H', 'H'), ...wonSet('H'), ...wonSet('H')]);
    expect([shown.phase, shown.finished.length, shown.set, shown.anchorNeeded]).toEqual([
      'decided',
      3,
      3,
      false,
    ]);
    expect(shown.points).toEqual({ first: 25, second: 0 });
  });
});

describe('foldVolleyball: the last tap, and Undo', () => {
  it('names the last record, and what Undo took back', () => {
    const live = [start(), rally({ wonBy: 'H', serving: 'H' })];
    expect(display(live).lastTap).toEqual({
      kind: 'rally',
      side: 'first',
      won: 'none',
      set: 1,
      toss: null,
    });
    expect(display([...live, timeout('A'), voiding(3)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'timeout', side: 'second' },
    });
  });

  it('is offered Undo for a tap of this phone’s own, never for the ledger’s', () => {
    expect(display([start()]).undoable).toBe(false);
    expect(display([start()], { queued: [queuedOf('q1', rally({ wonBy: 'H' }))] }).undoable).toBe(
      true,
    );
  });
});

describe('foldVolleyball: which queued taps are still legal', () => {
  it('takes the ones the engine takes and skips one it refuses, judging the rest without it', () => {
    const queued = [
      queuedOf('q1', rally({ wonBy: 'H' })),
      queuedOf('q2', { type: 'volleyball.rally', payload: { wonBy: 'someone-else' } }),
      queuedOf('q3', rally({ wonBy: 'A' })),
    ];
    const result = folded([start()], { queued });
    expect(result.legalQueued).toEqual(['q1', 'q3']);
    expect(result.display.points).toEqual({ first: 1, second: 1 });
  });

  it('refuses a second undo of the same event, as the web does', () => {
    const queued = [queuedOf('q1', voiding(2)), queuedOf('q2', voiding(2))];
    const result = folded([start(), rally({ wonBy: 'H' })], { queued });
    expect(result.legalQueued).toEqual(['q1']);
  });
});

describe('foldVolleyball: a second call', () => {
  it('folds the same input to the same display, twice over', () => {
    const specs = [...TWO_ALL, rally({ wonBy: 'A', serving: 'A' })];
    expect(display(specs)).toEqual(display(specs));
  });
});

describe('needsAnchor: the engine’s reasons it names nobody', () => {
  const unknown = (why: SetBasedServeUnknown): SetBasedServeContext => ({
    servingSide: null,
    side: null,
    serverPersonId: null,
    serveOrderKnown: false,
    unknownBecause: why,
  });
  // Every reason the engine has (a `Record` fails to compile if one is missing): a declaration fills a gap (the deciding
  // set's toss included), not a dispute (`recorded-disagrees`) nor a mismatch (`ledger-mismatch`) that no event fixes.
  const NEEDED: Readonly<Record<SetBasedServeUnknown, boolean>> = {
    undeclared: true,
    'score-jumped': true,
    'alternation-disputed': true,
    'deciding-set-toss': true,
    'match-over': true,
    'recorded-disagrees': false,
    'ledger-mismatch': false,
  };

  it.each(Object.entries(NEEDED))('%s: %s', (why, needed) => {
    expect(needsAnchor(unknown(why as SetBasedServeUnknown), true, false)).toBe(needed);
  });

  it('needs none when the engine names the server, the match is not live, or this phone’s pick is shown', () => {
    const named: SetBasedServeContext = {
      servingSide: 'ent-home',
      side: 'home',
      serverPersonId: null,
      serveOrderKnown: true,
    };
    expect(needsAnchor(named, true, false)).toBe(false);
    expect(needsAnchor(unknown('undeclared'), false, false)).toBe(false);
    expect(needsAnchor(unknown('undeclared'), true, true)).toBe(false);
  });
});
