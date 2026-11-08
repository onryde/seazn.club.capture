import type { EventEnvelope } from '@seazn/engine/core';
import { doneOf } from '@/domain/scoring/cricketDone';
import { rankOfOrdinal } from '@/domain/scoring/cricketTurn';
import type {
  CricketBallTap,
  CricketEventKey,
  CricketOrdinal,
  CricketPadKey,
  CricketSide,
  CricketTap,
  CricketWicketTap,
} from '@/domain/scoring/cricketTypes';
import type { PadHistoryGroup, PadHistoryRow, PadSide, PadText } from '@/domain/scoring/padView';
import type { Seats } from '@/domain/scoring/setBasedSides';

/**
 * What a cricket event did, in the pad's words (S2-4 spec §4.7, §6; plan Task 7): the one vocabulary History and the
 * last-tap line speak. Every event a cricket ledger can hold has words, those no tap of the pad's makes included (the
 * console's scorecard lines, an organiser's lineup change or note), since History lists every scorer's events. A void is
 * never a row: it strikes the row it takes back, which then reads "Undone" (`scoring.history.undone`).
 */

type Text = PadText<CricketPadKey>;

/** The event types of the engine's cricket module (`cricket.eventSchemas`). */
export type CricketSchemaType =
  | 'cricket.toss'
  | 'cricket.ball'
  | 'cricket.superover.ball'
  | 'cricket.innings.summary'
  | 'cricket.innings.declare'
  | 'cricket.innings.close'
  | 'cricket.match.close'
  | 'cricket.interruption'
  | 'cricket.revise'
  | 'cricket.followon'
  | 'cricket.player.line'
  | 'cricket.retire'
  | 'cricket.newball'
  | 'cricket.powerplay'
  | 'cricket.review'
  | 'cricket.bowler.change';

/** The kernel's types a cricket ledger can hold besides the start and a void, which have words of their own. */
export type CricketCoreType =
  | 'core.forfeit'
  | 'core.abandon'
  | 'core.finalize'
  | 'core.note'
  | 'core.award'
  | 'core.suspend'
  | 'core.resume'
  | 'core.settle'
  | `core.lineup.${'substitution' | 'replacement' | 'position' | 'retirement' | 'entry'}`;

/** A type with words of its own: said when no tap of the pad's reads the event back (or its payload cannot be read). */
export type CricketWordedType = CricketSchemaType | CricketCoreType;

/** Each type's words. A record, so a type added to the union does not compile until it has some. */
export const EVENT_WORDS: Readonly<Record<CricketWordedType, CricketEventKey>> = {
  'cricket.toss': 'scoring.cricket.event.toss',
  'cricket.ball': 'scoring.cricket.event.ball',
  'cricket.superover.ball': 'scoring.cricket.event.superOverBall',
  'cricket.innings.summary': 'scoring.cricket.event.summary',
  'cricket.innings.declare': 'scoring.cricket.event.declare',
  'cricket.innings.close': 'scoring.cricket.event.close',
  'cricket.match.close': 'scoring.cricket.event.matchClose',
  'cricket.interruption': 'scoring.cricket.event.interruption',
  'cricket.revise': 'scoring.cricket.event.revise',
  'cricket.followon': 'scoring.cricket.event.followOn',
  'cricket.player.line': 'scoring.cricket.event.playerLine',
  'cricket.retire': 'scoring.cricket.event.retire',
  'cricket.newball': 'scoring.cricket.event.newBall',
  'cricket.powerplay': 'scoring.cricket.event.powerplay',
  'cricket.review': 'scoring.cricket.event.review',
  'cricket.bowler.change': 'scoring.cricket.event.bowlerChange',
  'core.forfeit': 'scoring.cricket.event.forfeit',
  'core.abandon': 'scoring.cricket.event.abandon',
  'core.finalize': 'scoring.cricket.event.finalize',
  'core.note': 'scoring.cricket.event.note',
  'core.award': 'scoring.cricket.event.award',
  'core.suspend': 'scoring.cricket.event.suspend',
  'core.resume': 'scoring.cricket.event.resume',
  'core.settle': 'scoring.cricket.event.settle',
  'core.lineup.substitution': 'scoring.cricket.event.lineup',
  'core.lineup.replacement': 'scoring.cricket.event.lineup',
  'core.lineup.position': 'scoring.cricket.event.lineup',
  'core.lineup.retirement': 'scoring.cricket.event.lineup',
  'core.lineup.entry': 'scoring.cricket.event.lineup',
};

const WORDED = Object.keys(EVENT_WORDS) as readonly CricketWordedType[];

/** What an event did as History says it: the tap that made it, else its type's own words. */
export type CricketDone = CricketTap | { readonly kind: 'event'; readonly type: CricketWordedType };

/** What an event did, or null for one with no row (a void, or a type no cricket ledger holds). */
export function historyDoneOf(envelope: EventEnvelope, seats: Seats): CricketDone | null {
  const did = doneOf(envelope, seats);
  if (did !== null) return did;
  const type = WORDED.find((one) => one === envelope.type);
  return type === undefined ? null : { kind: 'event', type };
}

/** What the words need: every member's name by person id, the sides' names, and the balls in an over. */
export type CricketWords = {
  readonly names: ReadonlyMap<string, string>;
  readonly sides: Readonly<Record<PadSide, CricketSide>>;
  readonly ballsPerOver: number;
};

/** A person by name, as the organiser typed it; the id itself for one no team sheet names. */
const nameOf = (words: CricketWords, id: string): string => words.names.get(id) ?? id;

/**
 * What an event did, in the last-tap line's words: the toss and its choice, the start, a ball ("Four", "3 wides", "No-ball,
 * Six", "Home Player 1 out · caught (Away Player 5)"), over totals, a retirement, a new bowler, and every other type by its
 * own words.
 */
export function doneSaid(did: CricketDone, words: CricketWords): Text {
  switch (did.kind) {
    case 'toss':
      return {
        key: `scoring.cricket.last.toss.${did.elected}`,
        vars: { name: words.sides[did.wonBy].name },
      };
    case 'start':
      return { key: 'scoring.cricket.last.start' };
    case 'ball':
      return ballSaid(did.ball, words);
    case 'summary':
      return summarySaid(did, words);
    case 'retire':
      return {
        key: `scoring.cricket.last.retire.${did.reason === 'other' ? 'plain' : did.reason}`,
        vars: { name: nameOf(words, did.person) },
      };
    case 'bowlerChange':
      return {
        key: 'scoring.cricket.last.bowlerChange',
        vars: { name: nameOf(words, did.bowler) },
      };
    case 'more':
    case 'event':
      return { key: EVENT_WORDS[did.type] };
  }
}

/** The line after an Undo took a tap back: "Undone — " and the tap in its own words. */
export const undoneSaid = (tap: CricketTap, words: CricketWords): Text => ({
  key: 'scoring.cricket.last.undone',
  vars: { what: doneSaid(tap, words) },
});

/**
 * A ball: its extra with the runs it added ("3 wides"), the runs off the bat ("2 runs", "Four" on the 4 key), the
 * dismissal, in that order and joined; a ball with none of them is a dot.
 */
function ballSaid(ball: CricketBallTap, words: CricketWords): Text {
  const parts: Text[] = [
    ...(ball.extra === null
      ? []
      : [
          { key: `scoring.cricket.ball.${ball.extra.kind}.other`, count: ball.extra.runs } as const,
        ]),
    ...batSaid(ball),
    ...(ball.wicket === null ? [] : [outSaid(ball.wicket, words)]),
  ];
  const [first, ...rest] = parts;
  if (first === undefined) return { key: 'scoring.cricket.ball.dot' };
  return rest.reduce<Text>(
    (said, next) => ({ key: 'scoring.cricket.ball.and', vars: { first: said, second: next } }),
    first,
  );
}

function batSaid(ball: CricketBallTap): readonly Text[] {
  if (ball.boundary === 4) return [{ key: 'scoring.cricket.ball.four' }];
  if (ball.boundary === 6) return [{ key: 'scoring.cricket.ball.six' }];
  return ball.bat === 0 ? [] : [{ key: 'scoring.cricket.ball.runs.other', count: ball.bat }];
}

/** "Home Player 1 out · caught (Away Player 5)": the batter, how, and the fielders a run out names thrower first. */
function outSaid(wicket: CricketWicketTap, words: CricketWords): Text {
  const kind: Text = { key: `scoring.cricket.out.kind.${wicket.kind}` };
  return {
    key: 'scoring.cricket.out',
    vars: { batter: nameOf(words, wicket.out), how: howSaid(kind, wicket, words) },
  };
}

function howSaid(kind: Text, wicket: CricketWicketTap, words: CricketWords): Text {
  const { fielder, fielderAssist } = wicket;
  if (fielder === null) return kind;
  if (fielderAssist === null) {
    return {
      key: 'scoring.cricket.out.fielder',
      vars: { how: kind, fielder: nameOf(words, fielder) },
    };
  }
  return {
    key: 'scoring.cricket.out.fielders',
    vars: { how: kind, assist: nameOf(words, fielderAssist), fielder: nameOf(words, fielder) },
  };
}

/** Over totals: the innings' running total and its overs as a scorebook writes them ("14/1 (2 ov)", "9/0 (1.5 ov)"). */
function summarySaid(
  did: Extract<CricketTap, { readonly kind: 'summary' }>,
  words: CricketWords,
): Text {
  return {
    key: 'scoring.cricket.last.summary',
    vars: {
      runs: did.runs,
      wickets: did.wickets,
      overs: oversText(did.legalBalls, words.ballsPerOver),
    },
  };
}

/** Legal balls as overs: "2" for twelve balls of six, "1.5" for eleven. */
export function oversText(legalBalls: number, ballsPerOver: number): string {
  const balls = legalBalls % ballsPerOver;
  const overs = Math.floor(legalBalls / ballsPerOver);
  return balls === 0 ? `${overs}` : `${overs}.${balls}`;
}

// ---------------------------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------------------------

/** The innings an event belongs to, and the side batting in it; null before the toss names one. */
export type CricketGroup = { readonly ordinal: CricketOrdinal; readonly batting: PadSide } | null;

/**
 * One event on the match's sheet as whoever keeps the score recorded it: what it did, the innings it belongs to, the
 * innings' score after it (a ball's or over totals'; nothing for any other event), whether this phone recorded it, whether
 * Undo took it back, and whether it is this phone's tap still on its way to the server.
 */
export type CricketHistoryEntry = {
  readonly did: CricketDone;
  readonly group: CricketGroup;
  readonly score: string | null;
  readonly own: boolean;
  readonly undone: boolean;
  readonly sending: boolean;
};

/**
 * History (view only): the events grouped by innings ("Innings 1 · Home CC", "Super over 1 · Away CC"), the latest innings
 * first, each innings' newest event first, an event Undo took back struck in its place; what came before the toss under
 * "Before play". Nothing recorded, no group.
 */
export function cricketLedgerHistory(
  entries: readonly CricketHistoryEntry[],
  words: CricketWords,
): readonly PadHistoryGroup<CricketPadKey>[] {
  const keys = [...new Set(entries.map((entry) => groupKey(entry.group)))];
  const ranked = keys.sort((a, b) => rankOf(b) - rankOf(a));
  return ranked.map((key) => {
    const rows = entries.filter((entry) => groupKey(entry.group) === key);
    return {
      heading: headingOf(rows[0]?.group ?? null, words),
      rows: [...rows].reverse().map((entry) => rowOf(entry, words)),
    };
  });
}

const BEFORE = 'before';

const groupKey = (group: CricketGroup): string => group?.ordinal ?? BEFORE;

const rankOf = (key: string): number => rankOfOrdinal(key) ?? 0;

/** An innings by its place and the side batting ("Innings 1 · Home CC", "Super over 1 · Away CC"), or before play. */
export function headingOf(group: CricketGroup, words: CricketWords): Text {
  if (group === null) return { key: 'scoring.cricket.history.before' };
  const number = Number(group.ordinal.slice(1));
  const side = words.sides[group.batting].name;
  const superOver = group.ordinal.startsWith('s');
  return {
    key: superOver ? 'scoring.cricket.history.superOver' : 'scoring.cricket.history.innings',
    vars: { number, side },
  };
}

function rowOf(entry: CricketHistoryEntry, words: CricketWords): PadHistoryRow<CricketPadKey> {
  return {
    said: doneSaid(entry.did, words),
    score: entry.score,
    by: entry.own ? 'thisPhone' : 'otherScorer',
    undone: entry.undone,
    sending: entry.sending,
  };
}
