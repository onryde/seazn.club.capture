import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import { tennisDetails, tennisPad } from '@/domain/scoring/tennisPad';
import { padOf } from '@/domain/scoring/tennisPad.testkit';
import { tennisRuleRows } from '@/domain/scoring/tennisRules';
import type { TennisPadKey } from '@/domain/scoring/tennisTypes';
import type { MessageKey } from '@/i18n/messages';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  FAST4_CFG,
  GRAND_SLAM_CFG,
  SINGLES,
  abandon,
  forfeit,
  point,
  points,
  sanction,
  start,
  toss,
  summary,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 6 (rulings 219, 221-223, 225, 228, 230): the pad drawn from a display. Every display is the real engine's fold of a
// literal ledger; every expected call, note and score is written out from the ITF rules and the spec. The side on top is home.

const T = 'scoring.tennis.';
const HOME_NAME = 'Ana Ruiz';
const AWAY_NAME = 'Bea Lund';
const SIX_ALL = 'HAHAHAHAHAHA';
const slot = (view: PadView<TennisPadKey>, name: string) =>
  view.strip.find((one) => one.slot === name);

// A compile-time claim: every key the pad names is a dictionary key.
const asMessages = (view: PadView<TennisPadKey>): PadView<MessageKey> => view;

describe('the halves', () => {
  it('show the game’s call large, the names as typed and take a tap while the match is on', () => {
    const view = padOf([start(), ...points('HH')]);
    expect(asMessages(view)).toBe(view);
    expect(view.halves.map((half) => [half.side, half.label, half.value, half.tappable])).toEqual([
      ['first', HOME_NAME, '30', true],
      ['second', AWAY_NAME, '0', true],
    ]);
    expect(view.halves[0].hint).toEqual({ key: `${T}hint` });
  });

  it('name both partners of a doubles side with " / " between, and the server only on the serving half (ruling 235)', () => {
    const view = padOf([start()], { bootstrap: DOUBLES });
    expect(view.halves[0].label).toBe('Ruiz / Vega h1 / Ruiz / Vega h2');
    expect(view.halves[0].server).toEqual({
      key: 'scoring.tennis.serverPerson',
      vars: { person: 'Ruiz / Vega h1' },
    });
    expect(view.halves[1].server).toBeNull();
  });

  it('name no server in singles, in a tie-break or while the order is undeclared: the plate stands alone', () => {
    expect(padOf([start()]).halves.map((half) => half.server)).toEqual([null, null]);
    const tiebreak = padOf([start(), ...gamesOf('HAHAHAHAHAHA')], { bootstrap: DOUBLES });
    expect(tiebreak.halves.map((half) => half.server)).toEqual([null, null]);
    expect(tiebreak.halves.map((half) => half.serving !== null)).toContain(true);
  });

  it('read AD for the side that has it and 40 for the other, and back to 40-40', () => {
    const ad = padOf([start(), ...points('HAHAHAH')]);
    expect(ad.halves.map((half) => half.value)).toEqual(['AD', '40']);
    const back = padOf([start(), ...points('HAHAHAHA')]);
    expect(back.halves.map((half) => half.value)).toEqual(['40', '40']);
  });

  it('read a breaker’s points as numbers', () => {
    const view = padOf([start(), ...gamesOf(SIX_ALL), ...points('HHA')]);
    expect(view.halves.map((half) => half.value)).toEqual(['2', '1']);
  });

  it('take no tap before the start, once decided, once ended and while a default waits', () => {
    const taps = (specs: Parameters<typeof padOf>[0]) =>
      padOf(specs).halves.map((half) => half.tappable);
    expect(taps([])).toEqual([false, false]);
    expect(taps([start(), ...gamesOf('HHHHHHHHHHHH')])).toEqual([false, false]);
    expect(taps([start(), point('H'), forfeit('A', 'retired')])).toEqual([false, false]);
    expect(taps([start(), sanction('A', 'default')])).toEqual([false, false]);
  });
});

describe('the serve ball', () => {
  const plates = (view: PadView<TennisPadKey>) => view.halves.map((half) => half.serving);
  const plate = { shown: { key: `${T}serving` }, said: { key: `${T}serving` } };

  it('is on the first side before any point (ruling 216) and lights its bar', () => {
    const view = padOf([start()]);
    expect(plates(view)).toEqual([plate, null]);
    expect(view.halves.map((half) => half.bar)).toEqual(['lit', 'dim']);
  });

  it('moves to the other side after a game, as the engine rotates it', () => {
    const view = padOf([start(), ...gamesOf('H')]);
    expect(plates(view)).toEqual([null, plate]);
    expect(view.halves.map((half) => half.bar)).toEqual(['dim', 'lit']);
  });

  it('is on neither side when the engine cannot name the server (a set score with an odd number of games, F1)', () => {
    const view = padOf([start(), summary(6, 3)]);
    expect(plates(view)).toEqual([null, null]);
    expect(view.halves.map((half) => half.bar)).toEqual(['dim', 'dim']);
  });

  it('is on neither side once the match is decided: the winner carries WON in its place (ruling 239)', () => {
    const won = { shown: { key: `${T}board.won` }, said: { key: `${T}board.won` } };
    expect(plates(padOf([start(), ...gamesOf('HHHHHHHHHHHH')]))).toEqual([won, null]);
  });

  it('is on neither side before the start', () => {
    expect(plates(padOf([]))).toEqual([null, null]);
  });
});

describe('the card at a half’s corner', () => {
  const marks = (specs: Parameters<typeof padOf>[0]) =>
    padOf(specs).halves.map((half) => half.marks);
  const word = (key: string) => ({ key: `${T}level.${key}` });

  it('is the yellow caution for a warning, said as the level', () => {
    const [first, second] = marks([start(), sanction('H', 'warning')]);
    expect(first).toEqual({ clock: false, cards: ['caution'], said: [word('warning')] });
    expect(second).toEqual({ clock: false, cards: [], said: [] });
  });

  it('is the red dismissal for a point penalty and for a game penalty', () => {
    expect(marks([start(), sanction('A', 'point_penalty')])[1]).toEqual({
      clock: false,
      cards: ['dismissal'],
      said: [word('pointPenalty')],
    });
    expect(marks([start(), sanction('H', 'game_penalty')])[0]).toEqual({
      clock: false,
      cards: ['dismissal'],
      said: [word('gamePenalty')],
    });
  });

  it('is the red dismissal for a default the organiser recorded on the web', () => {
    expect(marks([start(), sanction('H', 'default')])[0]).toEqual({
      clock: false,
      cards: ['dismissal'],
      said: [word('default')],
    });
  });

  it('shows the heaviest of the set’s violations only', () => {
    const [first] = marks([start(), sanction('H', 'game_penalty'), sanction('H', 'warning')]);
    expect(first.said).toEqual([word('gamePenalty')]);
  });

  it('is gone in the next set (the card is the set’s)', () => {
    const [first] = marks([start(), sanction('H', 'warning'), ...gamesOf('HHHHHH')]);
    expect(first.cards).toEqual([]);
  });
});

describe('the strip', () => {
  const texts = (view: PadView<TennisPadKey>) => view.strip.map((item) => [item.slot, item.text]);

  it('reads "Set 1 of 3" with nothing else at the start of a match', () => {
    expect(texts(padOf([start()]))).toEqual([
      ['set', { key: `${T}setOf`, vars: { set: 1, bestOf: 3 } }],
      ['note', null],
      ['ends', null],
    ]);
  });

  it('reads the set under way: "Set 2 of 3" after a set', () => {
    expect(slot(padOf([start(), ...gamesOf('HHHHHH')]), 'set')?.text).toEqual({
      key: `${T}setOf`,
      vars: { set: 2, bestOf: 3 },
    });
  });

  it('reads Deuce at 40-40 in an ad game, and nothing at advantage (the half shows AD)', () => {
    expect(slot(padOf([start(), ...points('HAHAHA')]), 'note')?.text).toEqual({
      key: `${T}note.deuce`,
    });
    expect(slot(padOf([start(), ...points('HAHAHAH')]), 'note')?.text).toBeNull();
  });

  it('reads Deciding point at 40-40 in a no-ad game, never Deuce', () => {
    const bootstrap = withCfg(SINGLES, FAST4_CFG);
    expect(slot(padOf([start(), ...points('HAHAHA')], { bootstrap }), 'note')?.text).toEqual({
      key: `${T}note.decidingPoint`,
    });
  });

  it('reads Tie-break in a tie-break, with no deuce note', () => {
    const view = padOf([start(), ...gamesOf(SIX_ALL)]);
    expect(slot(view, 'note')?.text).toEqual({ key: `${T}breaker.tiebreak` });
  });

  it('reads Tie-break at 3-3 in Fast4 (ruling 222: the config’s games-all)', () => {
    const bootstrap = withCfg(SINGLES, FAST4_CFG);
    const view = padOf([start(), ...gamesOf('HAHAHA')], { bootstrap });
    expect(slot(view, 'note')?.text).toEqual({ key: `${T}breaker.tiebreak` });
  });

  it('reads Match tie-break for the doubles decider', () => {
    const bootstrap = withCfg(DOUBLES, DOUBLES_NOAD_CFG);
    const view = padOf([start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA')], { bootstrap });
    expect(slot(view, 'note')?.text).toEqual({ key: `${T}breaker.matchTiebreak` });
  });

  it('reads Tie-break at 6-6 of a Grand Slam’s fifth set (the tie-break to 10)', () => {
    const bootstrap = withCfg(SINGLES, GRAND_SLAM_CFG);
    const sets = [
      ...gamesOf('HHHHHH'),
      ...gamesOf('HHHHHH'),
      ...gamesOf('AAAAAA'),
      ...gamesOf('AAAAAA'),
    ];
    const view = padOf([start(), ...sets, ...gamesOf(SIX_ALL)], { bootstrap });
    expect(slot(view, 'set')?.text).toEqual({ key: `${T}setOf`, vars: { set: 5, bestOf: 5 } });
    expect(slot(view, 'note')?.text).toEqual({ key: `${T}breaker.tiebreak` });
  });

  it('reads Change ends after the first game and not after the second (ITF rule 27)', () => {
    expect(slot(padOf([start(), ...gamesOf('H')]), 'ends')?.text).toEqual({
      key: `${T}endsChange`,
    });
    expect(slot(padOf([start(), ...gamesOf('HA')]), 'ends')?.text).toBeNull();
  });

  it('keeps three slots, set, note, ends, in that order, so nothing moves while the match goes', () => {
    for (const specs of [[start()], [start(), ...gamesOf('H')], [start(), ...gamesOf(SIX_ALL)]])
      expect(padOf(specs).strip.map((item) => item.slot)).toEqual(['set', 'note', 'ends']);
  });

  it('says a default is waiting for the organiser, over the note slot, in two lines', () => {
    const view = padOf([start(), sanction('A', 'default')]);
    expect(view.strip.map((item) => item.slot)).toEqual(['set', 'note']);
    expect(slot(view, 'note')).toEqual({
      slot: 'note',
      text: { key: `${T}endingPending` },
      lines: 2,
    });
  });
});

describe('the match’s end', () => {
  const ended = (specs: Parameters<typeof padOf>[0]) => padOf(specs);

  it('names a retirement and its side on the card and the strip, never "Drawn"', () => {
    const view = ended([start(), ...gamesOf('H'), forfeit('A', 'retired')]);
    const title = {
      key: `${T}ending.by`,
      vars: { ending: { key: `${T}ending.retired` }, side: AWAY_NAME },
    };
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null, title });
    expect(slot(view, 'note')).toEqual({ slot: 'note', text: title, lines: 2 });
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
    expect(view.tools).toEqual([]);
  });

  it('names a default (disqualified), a walkover and a withdrawal against their side', () => {
    const by = (kind: string, side: string) => ({
      key: `${T}ending.by`,
      vars: { ending: { key: `${T}ending.${kind}` }, side },
    });
    expect(ended([start(), forfeit('H', 'disqualified')]).card).toMatchObject({
      title: by('defaulted', HOME_NAME),
    });
    expect(ended([start(), forfeit('A', 'walkover')]).card).toMatchObject({
      title: by('walkover', AWAY_NAME),
    });
    expect(ended([start(), forfeit('A', 'withdrew')]).card).toMatchObject({
      title: by('withdrew', AWAY_NAME),
    });
  });

  it('names an abandon, and a walkover by both, with no side', () => {
    expect(ended([start(), point('H'), abandon('rain')]).card).toMatchObject({
      title: { key: `${T}ending.abandoned` },
    });
    const both = { type: 'core.forfeit', payload: { by: 'both', reason: 'walkover' } };
    expect(ended([start(), both]).card).toMatchObject({ title: { key: `${T}ending.walkover` } });
  });

  it('heads a match won on court with the winner and the sets as the engine writes them', () => {
    const six = ['6–0', '6–0'];
    const view = ended([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(view.card).toEqual({
      kind: 'resultRecorded',
      undoLeft: null,
      title: { key: `${T}result`, vars: { side: HOME_NAME, sets: six.join(' ') } },
    });
    expect(slot(view, 'note')?.text).toBeNull();
    expect(slot(view, 'ends')?.text).toBeNull();
  });

  it('writes a tie-break set "7–6(5)" in the result', () => {
    const view = ended([
      start(),
      ...gamesOf(SIX_ALL),
      ...points('HAHAHAHAHAHH'),
      ...gamesOf('HHHHHH'),
    ]);
    expect(view.card).toMatchObject({
      title: { key: `${T}result`, vars: { side: HOME_NAME, sets: '7–6(5) 6–0' } },
    });
  });

  it('writes a match tie-break "[10–0]" in the result', () => {
    const bootstrap = withCfg(DOUBLES, DOUBLES_NOAD_CFG);
    const specs = [start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA'), ...points('HHHHHHHHHH')];
    expect(padOf(specs, { bootstrap }).card).toMatchObject({
      title: { key: `${T}result`, vars: { sets: '6–0 0–6 [10–0]' } },
    });
  });

  it('names no result while the match is on', () => {
    expect(padOf([start(), point('H')]).card).toBeNull();
  });
});

describe('the Start screen and the match details', () => {
  it('asks who serves first before the start (ruling 233): the names, no tools, four slots reserved', () => {
    const view = padOf([]);
    expect(view.start?.ask).toEqual({ key: `${T}start.ask` });
    expect(view.start?.needsToss).toBe(true);
    expect(view.start?.sides.map((side) => side.label)).toEqual([HOME_NAME, AWAY_NAME]);
    expect(view.tools).toEqual([]);
    expect(view.toolSlots).toBe(4);
  });

  it('has no Start screen once the match has started', () => {
    expect(padOf([start()]).start).toBeNull();
  });

  it('gives the match’s context and its rules rows', () => {
    const shown = display([start()]);
    expect(tennisDetails(shown)).toEqual({
      context: shown.context,
      rules: tennisRuleRows(shown.cfg),
    });
    expect(tennisPad(shown).details).toEqual(tennisDetails(shown));
  });

  it('shows the format of the match’s own config: Grand Slam says best of 5', () => {
    const bootstrap = withCfg(SINGLES, GRAND_SLAM_CFG);
    const rules = padOf([], { bootstrap }).details.rules;
    expect(rules[0]).toEqual({
      label: { key: `${T}rules.format.label` },
      value: { key: `${T}rules.bestOf`, vars: { bestOf: 5 } },
    });
  });
});

describe('the tally and the tools', () => {
  it('tallies the sets won, top first, and says them with the names', () => {
    const view = padOf([start(), ...gamesOf('HHHHHH')]);
    expect(view.tally).toEqual({
      shown: '1:0',
      said: {
        key: `${T}setsTally`,
        vars: { first: HOME_NAME, firstGames: 1, second: AWAY_NAME, secondGames: 0 },
      },
    });
  });

  it('divides the tool row into four slots until the match has a point, then three (ruling 241)', () => {
    expect(padOf([start()]).toolSlots).toBe(4);
    for (const specs of [
      [start(), point('H')],
      [start(), ...gamesOf(SIX_ALL)],
    ])
      expect(padOf(specs).toolSlots).toBe(3);
  });

  it('gives the pad the same tools as the tool row', () => {
    expect(padOf([start()]).tools.map((tool) => tool.id)).toEqual([
      'violation',
      'break',
      'award',
      'setScore',
    ]);
  });
});

describe('the Start screen (ruling 233)', () => {
  it('asks who serves first, with the two names top first and no plate, when no toss is held', () => {
    const view = padOf([]);
    expect(view.start).toEqual({
      ask: { key: `${T}start.ask` },
      needsToss: true,
      sides: [
        { side: 'first', label: 'Ana Ruiz', plate: null },
        { side: 'second', label: 'Bea Lund', plate: null },
      ],
    });
  });

  it('does not ask again once a toss is held: Start match is ready and the tossed side carries the plate', () => {
    const view = padOf([toss('A')]);
    expect(view.start?.needsToss).toBe(false);
    expect(view.start?.sides.map((side) => side.plate)).toEqual([null, { key: `${T}serving` }]);
  });

  it('is none once the match has started', () => {
    expect(padOf([toss('A'), start()]).start).toBeNull();
  });
});
