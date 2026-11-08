import { doneSaid, undoneSaid, type CricketWords } from '@/domain/scoring/cricketHistory';
import { cricketResultWords } from '@/domain/scoring/cricketResult';
import { cricketRuleRows } from '@/domain/scoring/cricketRules';
import type { CricketDisplay, CricketPadKey } from '@/domain/scoring/cricketTypes';
import {
  withCard,
  type PadHalf,
  type PadLastTap,
  type PadSide,
  type PadStateCard,
  type PadSync,
  type PadTally,
  type PadView,
} from '@/domain/scoring/padView';
import { padMarks } from '@/domain/scoring/setBasedPad';

/**
 * Cricket on the pad (S2-4 spec §5; plan Task 7): the kit's view of a cricket match. Cricket is not scored by tapping a
 * side's half: its screen draws its own board in the halves' place (Task 8), so the halves only carry the sides' names and
 * their latest innings, with no tap. Every fact is the display's, which is the engine's fold: the pad only says it. The
 * toss and the setup are the screen's own steps, so there is no Start screen here (`start` null), and no tools yet: the
 * keys are the screen's.
 */

const SYNCED: PadSync = { kind: 'synced' };

const RESULT_RECORDED: PadStateCard = { kind: 'resultRecorded', undoLeft: null };

/** The match is decided: the engine has a result, which the organiser may have finalized. */
export const cricketDecided = (display: CricketDisplay): boolean => display.stage === 'decided';

/** The match has not started: the toss or the setup before Start. */
export const cricketNotStarted = (display: CricketDisplay): boolean =>
  display.stage === 'toss' || display.stage === 'setup';

/**
 * The innings as Home's Finished card writes them, in the order they were played: runs/wickets each, joined ("25/3 ·
 * 25/4"). Numbers only; the main innings, since a super over's are the result's words. Empty before an innings is played.
 */
export function cricketResultLine(display: CricketDisplay): string {
  return display.state.innings.map((one) => `${one.runs}/${one.wickets}`).join(' · ');
}

/** What the words need, from the display: the players' names, the sides' and the balls in an over. */
export function wordsOf(display: CricketDisplay): CricketWords {
  const players = [...display.players.first, ...display.players.second];
  return {
    names: new Map(players.map((one) => [one.id, one.name])),
    sides: display.sides,
    ballsPerOver: display.cfg.ballsPerOver,
  };
}

/**
 * The pad for a cricket match: the sides' halves, the rules for Match details, the result in words in the strip once one
 * stands, the last tap with the one Undo, and a recorded result's card. `sync` is the transport's word, not the match's.
 */
export function cricketPad(
  display: CricketDisplay,
  sync: PadSync = SYNCED,
): PadView<CricketPadKey> {
  const view: PadView<CricketPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: tallyOf(display),
    details: { context: display.context, rules: cricketRuleRows(display.cfg) },
    start: null,
    strip: [
      {
        slot: 'note',
        text: display.result === null ? null : cricketResultWords(display.result, display.sides),
      },
    ],
    lastTap: lastTapOf(display),
    sync,
    tools: [],
    card: null,
  };
  return withCard(view, cricketDecided(display) ? RESULT_RECORDED : null);
}

/** A side's latest innings, runs/wickets ("25/3"), or nothing before it has batted. */
function scoreOf(display: CricketDisplay, side: PadSide): string {
  const batted = display.state.innings.filter((one) => sideOf(one.battingSide) === side);
  const last = batted[batted.length - 1];
  return last === undefined ? '' : `${last.runs}/${last.wickets}`;
}

const sideOf = (side: 'home' | 'away'): PadSide => (side === 'home' ? 'first' : 'second');

function half(display: CricketDisplay, side: PadSide): PadHalf<CricketPadKey> {
  return {
    side,
    label: display.sides[side].name,
    value: scoreOf(display, side),
    periods: null,
    sub: null,
    marks: padMarks(null, null),
    serving: null,
    plate: null,
    action: null,
    // The lime follows the side batting now.
    bar: display.innings?.batting === side ? 'lit' : 'dim',
    hint: { key: 'scoring.pad.tap' },
    tappable: false,
  };
}

/** The header says nothing (the board shows the score); a screen reader hears the innings now, or that there is none yet. */
function tallyOf(display: CricketDisplay): PadTally<CricketPadKey> {
  const { innings } = display;
  if (innings === null) {
    return { shown: '', said: { key: 'scoring.cricket.tallyNone' } };
  }
  return {
    shown: '',
    said: {
      key: 'scoring.cricket.tallySaid',
      vars: { score: `${innings.runs}/${innings.wickets}` },
    },
  };
}

/** What the last tap did, and the one Undo while this phone has a standing tap of its own. */
function lastTapOf(display: CricketDisplay): PadLastTap<CricketPadKey> | null {
  const did = display.lastTap;
  if (did === null) return null;
  const words = wordsOf(display);
  if (did.kind === 'undone') return { text: undoneSaid(did.tap, words), undo: false };
  return { text: doneSaid(did, words), undo: display.undoable };
}
