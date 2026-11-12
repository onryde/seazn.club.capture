import {
  withCard,
  type PadFoot,
  type PadHalf,
  type PadLastTap,
  type PadMatchDetails,
  type PadPeriods,
  type PadServing,
  type PadSide,
  type PadStripItem,
  type PadSync,
  type PadText,
  type PadView,
} from '@/domain/scoring/padView';
import {
  gamesWon,
  padMarks,
  playedSaid,
  playedScore,
  resultCardOf,
  setBasedStart,
  setBasedTally,
  type PadCardMark,
} from '@/domain/scoring/setBasedPad';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { doneSaid, levelWord, personWord } from '@/domain/scoring/volleyballHistory';
import { volleyballRuleRows } from '@/domain/scoring/volleyballRules';
import { takesTaps, volleyballTools } from '@/domain/scoring/volleyballTools';
import type {
  VolleyballDisplay,
  VolleyballPadKey,
  VolleyballSanctionLevel,
  VolleyballSet,
  VolleyballUndoneTap,
} from '@/domain/scoring/volleyballTypes';

/**
 * Volleyball on the pad (S2-6 Task 6; spec §5, layout A, the owner's ruling 178): the view that draws a
 * `VolleyballDisplay`. Whoever keeps the score (the engine, through `foldVolleyball`) decides every field; the pad only
 * draws them. Functions only: the types are `volleyballTypes`, the tools `volleyballTools`, the words of History
 * `volleyballHistory`.
 */

type Text = PadText<VolleyballPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

/** The words a set-based pad names alike, in volleyball's own namespace (`setBasedPad`). */
const WORDS = {
  setsSaid: 'scoring.volleyball.setsSaid.other',
  setsTally: 'scoring.volleyball.setsTally',
  hint: 'scoring.volleyball.hint',
  startAsk: 'scoring.volleyball.start.ask',
} as const;

/**
 * The pad for a volleyball match: the first side on top, the second below, each with its finished sets' scores, the serving
 * plate on the serving side (beach: the server's name), the heaviest sanction of the set as a card and the side's timeouts
 * and subs at the foot; the set of how many, its target and one note in the strip; and in the tool row Set score while it
 * is offered, Timeout, Sub (indoor) and More. A decided match is the recorded result's card over the final score. Before
 * the match starts, the Start screen's question in the halves' place, and no tools.
 */
export function volleyballPad(
  display: VolleyballDisplay,
  sync: PadSync = SYNCED,
): PadView<VolleyballPadKey> {
  const view: PadView<VolleyballPadKey> = {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: setBasedTally(WORDS.setsTally, display.sides, gamesWon(display.finished)),
    details: volleyballDetails(display),
    start: setBasedStart(WORDS.startAsk, display.sides, display.phase),
    strip: strip(display),
    lastTap: lastTap(display),
    sync,
    tools: volleyballTools(display),
    card: null,
  };
  return withCard(view, resultCardOf(display.phase));
}

/** The match's context and its rules, for MatchCard: the Start screen, the Not started card and the Match details sheet. */
export function volleyballDetails(display: VolleyballDisplay): PadMatchDetails<VolleyballPadKey> {
  return {
    context: display.context,
    rules: volleyballRuleRows(display.rules, display.records, display.caps),
  };
}

function half(display: VolleyballDisplay, side: PadSide): PadHalf<VolleyballPadKey> {
  const plate = takesTaps(display) && display.serving === side ? serving() : null;
  return {
    side,
    label: sideNames(display.sides[side]),
    value: String(display.points[side]),
    periods: periods(display.finished, side),
    // Beach names the server (ruling 173): indoor, and a beach pair with no order declared, name the side only.
    sub: plate === null ? null : serverPerson(display),
    marks: padMarks(sanctionCard(display, side), null),
    serving: plate,
    plate: null,
    action: null,
    // The bar follows the plate: the serving side's is lit, neither while the engine names no server.
    bar: plate === null ? 'dim' : 'lit',
    foot: foot(display, side),
    hint: { key: WORDS.hint },
    tappable: takesTaps(display),
  };
}

/** The side's score in each set over, its wins marked, said "Sets: 25, 21". None in set 1. */
function periods(
  finished: readonly VolleyballSet[],
  side: PadSide,
): PadPeriods<VolleyballPadKey> | null {
  if (finished.length === 0) return null;
  return {
    scores: finished.map((set) => playedScore(set, side)),
    said: [playedSaid<VolleyballPadKey>(WORDS.setsSaid, finished, side)],
  };
}

/** The plate's "Serving", said the same: volleyball has no serve number to say. */
function serving(): PadServing<VolleyballPadKey> {
  return {
    shown: { key: 'scoring.volleyball.serving' },
    said: { key: 'scoring.volleyball.serving' },
  };
}

/** The beach server the engine names (ruling 173), by name; else nobody: the plate names the side. */
function serverPerson(display: VolleyballDisplay): Text | null {
  if (display.serverPersonId === null || display.serverPerson === null) return null;
  return { key: 'scoring.volleyball.serverPerson', vars: { person: display.serverPerson } };
}

// ---------------------------------------------------------------------------------------------------------------
// The foot: timeouts and subs in the set (ruling 175)
// ---------------------------------------------------------------------------------------------------------------

/**
 * With this many sets finished the bottom row holds this many boxes beside "Tap", and the labelled counts no longer fit
 * the slot at 320 dp in every language (volleyballFit.test.ts): the counts drop their labels ("2/2 · 6/6", timeouts then
 * subs, as the tool row's order) and the half's name still speaks them in full.
 */
const SHORT_FOOT_FROM = 3;
const LABELLED_FOOT = 'scoring.volleyball.foot.indoor';
const SHORT_FOOT = 'scoring.volleyball.foot.indoorShort';

/**
 * "T/O 1 of 2 · Subs 4 of 6" (beach: "T/O 0 of 1"), and `caution` once either count has reached FIVB's number: it never
 * refuses the next one, it shows it (ruling 175). None before the start, once the match is decided, or in a match that
 * records no timeouts. Numbers alone ("2/2 · 6/6") from the third finished set, or once a count is past its number
 * ("3/2 · 12/6" is wider than the slot: review M3).
 */
function foot(display: VolleyballDisplay, side: PadSide): PadFoot<VolleyballPadKey> | null {
  if (!takesTaps(display) || !display.records.timeouts) return null;
  const { counts, caps } = display;
  const mine = counts[side];
  const timeouts = { timeouts: mine.timeouts, timeoutCap: caps.timeouts };
  const caution = mine.timeouts >= caps.timeouts || (caps.subs > 0 && mine.subs >= caps.subs);
  if (display.beach) {
    // The beach half's bottom-left slot holds the server's name: the counts take a line of their own.
    return {
      text: { key: 'scoring.volleyball.foot.beach', vars: timeouts },
      said: { key: 'scoring.volleyball.foot.beachSaid', vars: timeouts },
      place: 'line',
      caution,
    };
  }
  const vars = { ...timeouts, subs: mine.subs, subCap: caps.subs };
  const over = mine.timeouts > caps.timeouts || (caps.subs > 0 && mine.subs > caps.subs);
  return {
    text: {
      key: over || display.finished.length >= SHORT_FOOT_FROM ? SHORT_FOOT : LABELLED_FOOT,
      vars,
    },
    said: { key: 'scoring.volleyball.foot.indoorSaid', vars },
    place: 'slot',
    caution,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------------------------------------------

/** "Set 2 of 5", "to 25" and one note at the right (Win by 2, or the golden point), nothing once decided. */
function strip(display: VolleyballDisplay): readonly PadStripItem<VolleyballPadKey>[] {
  const decided = display.phase === 'decided';
  return [
    {
      slot: 'set',
      text: {
        key: 'scoring.volleyball.setOf',
        vars: { set: display.set, bestOf: display.rules.bestOf },
      },
    },
    {
      slot: 'target',
      text: decided ? null : { key: 'scoring.volleyball.target', vars: { target: display.target } },
    },
    { slot: 'note', text: decided ? null : noteOf(display) },
  ];
}

function noteOf(display: VolleyballDisplay): Text | null {
  if (display.note === 'setting') {
    return { key: 'scoring.volleyball.note.setting', vars: { winBy: display.rules.winBy } };
  }
  return display.note === 'goldenPoint' ? { key: 'scoring.volleyball.note.goldenPoint' } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The card in a half's corner
// ---------------------------------------------------------------------------------------------------------------

/** A warning is the yellow card; a penalty and anything heavier the red (spec §5). Typed over every level the engine lists. */
const CARDS = {
  warning: ['caution'],
  penalty: ['dismissal'],
  expulsion: ['dismissal'],
  disqualification: ['dismissal'],
} as const satisfies Readonly<
  Record<VolleyballSanctionLevel, readonly ('caution' | 'dismissal')[]>
>;

/** The side's heaviest sanction of the set as a card, or none; its name is what a screen reader hears of it. */
function sanctionCard(
  display: VolleyballDisplay,
  side: PadSide,
): PadCardMark<VolleyballPadKey> | null {
  const level = display.heaviest[side];
  return level === null ? null : { cards: CARDS[level], said: levelWord(level) };
}

// ---------------------------------------------------------------------------------------------------------------
// The last tap
// ---------------------------------------------------------------------------------------------------------------

/** The last tap's line; none before the start, when there is no match on the pad to speak of. */
function lastTap(display: VolleyballDisplay): PadLastTap<VolleyballPadKey> | null {
  if (display.phase === 'notStarted' || display.lastTap === null) return null;
  const { lastTap: tap, sides } = display;
  return {
    text: tap.kind === 'undone' ? undoneSaid(sides, tap.tap) : doneSaid(sides, tap),
    undo: display.undoable,
  };
}

/** What Undo took back, in the last-tap line's words ("Point undone — Falcons"). */
function undoneSaid(sides: VolleyballDisplay['sides'], tap: VolleyballUndoneTap): Text {
  if (tap.kind === 'setScore') return { key: 'scoring.volleyball.undone.setScore' };
  const side = sideNames(sides[tap.side]);
  switch (tap.kind) {
    case 'rally':
      return { key: 'scoring.volleyball.undone.rally', vars: { side } };
    case 'timeout':
      return { key: 'scoring.volleyball.undone.timeout', vars: { side } };
    case 'sub':
      return { key: 'scoring.volleyball.undone.sub', vars: { side } };
    case 'sanction':
      return {
        key: 'scoring.volleyball.undone.sanction',
        vars: {
          level: levelWord(tap.level),
          person: tap.person === null ? side : personWord(tap.person),
        },
      };
  }
}

/**
 * The last-tap line while the toss answer is held (ruling 180): "Next point: {side} serving", until the next point carries
 * it. The rest of the view is as it was, and Undo stays for this phone's last real tap. Only while the pad still needs the
 * answer (`anchorNeeded`) and under no card.
 */
export function withHeldServing(
  view: PadView<VolleyballPadKey>,
  held: PadSide | null,
  display: VolleyballDisplay,
): PadView<VolleyballPadKey> {
  if (held === null || !display.anchorNeeded || view.card !== null) return view;
  const text: Text = {
    key: 'scoring.volleyball.held',
    vars: { side: sideNames(display.sides[held]) },
  };
  return { ...view, lastTap: { text, undo: view.lastTap?.undo ?? false } };
}

/** The toss sheet's title: "Who serves first in set 5?" (ruling 180). */
export const volleyballServingTitle = (set: number): Text => ({
  key: 'scoring.volleyball.sheet.serving',
  vars: { set },
});
