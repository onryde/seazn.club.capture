import type { GameTime } from '@seazn/engine/core';
import type { FootballCfg } from '@seazn/engine/sports/football';
import { clockText, matchTime, minuteText } from '@/domain/scoring/footballClock';
import {
  playerLabel,
  playerMark,
  type FootballCardWord,
  type FootballDone,
  type FootballMarker,
  type FootballOutcomeWord,
  type FootballPadKey,
  type FootballPeriodWord,
  type FootballPlayer,
} from '@/domain/scoring/footballTypes';
import type { PadHistoryGroup, PadSide, PadText, PadVar } from '@/domain/scoring/padView';
import { setBasedHistory } from '@/domain/scoring/setBasedHistory';

/**
 * Football's words for what an event did (S2-5 design §6.7), and History (S2 ruling 21; view only), which says every
 * event in the last-tap line's words: "Goal · Riverside · #10 Silva 41'", "Sub · Northgate · #8 off, #14 on 61'". The
 * minute is the match's (`minuteText`, ruling 109); a clock event says the clock's face instead.
 */

type Text = PadText<FootballPadKey>;

/** What the words need of the match: the teams' names as typed, top first, and the config the minutes are counted in. */
export type FootballWords = {
  readonly names: Readonly<Record<PadSide, string>>;
  readonly cfg: FootballCfg;
};

/**
 * One entry on the match's sheet: what it did, the period it was recorded in (its word), the goals after it, top first,
 * whether this phone recorded it, whether Undo took it back, and whether it is this phone's tap still on its way.
 */
export type FootballHistoryEntry = {
  readonly did: FootballDone;
  readonly period: FootballPeriodWord;
  readonly after: Readonly<Record<PadSide, number>>;
  readonly own: boolean;
  readonly undone: boolean;
  readonly sending: boolean;
};

/** The periods in the order they are played (H1 and Q1, H2 and Q2 never meet in one match). */
const PERIOD_ORDER: readonly FootballPeriodWord[] = [
  'H1',
  'Q1',
  'H2',
  'Q2',
  'Q3',
  'Q4',
  'ET_H1',
  'ET_H2',
  'shootout',
];

/**
 * History: the entries grouped by period under its word, the latest period first, each period's newest entry first, an
 * entry Undo took back struck in its place. The score after each goal, top first; no other row has one. The grouping is
 * the set-based sports' (`setBasedHistory`), periods for games.
 */
export function footballHistory(
  entries: readonly FootballHistoryEntry[],
  words: FootballWords,
): readonly PadHistoryGroup<FootballPadKey>[] {
  const games = entries.map(({ period, ...entry }) => ({
    ...entry,
    game: PERIOD_ORDER.indexOf(period),
  }));
  return setBasedHistory<FootballDone, FootballPadKey>(games, {
    heading: (game) => ({ key: `scoring.football.period.${PERIOD_ORDER[game] ?? 'H1'}` }),
    said: (did) => doneSaid(words, did),
    scored: (did) => did.kind === 'goal',
  });
}

/** Each engine phase a pad event is recorded in, as its period's word; the first quarter is the engine's H1. */
const PERIOD_WORD: Readonly<Record<string, FootballPeriodWord>> = {
  H1: 'H1',
  H2: 'H2',
  Q2: 'Q2',
  Q3: 'Q3',
  Q4: 'Q4',
  ET_H1: 'ET_H1',
  ET_H2: 'ET_H2',
  SHOOTOUT: 'shootout',
};

/** An engine phase's period word under `cfg`: H1 is the first quarter in a match of quarters. Null before and after play. */
export function periodWordOf(phase: string, cfg: FootballCfg): FootballPeriodWord | null {
  if (phase === 'H1' && cfg.halves === 4) return 'Q1';
  return PERIOD_WORD[phase] ?? null;
}

/**
 * What an event did, in the last-tap line's words: History says every event the same way. A goal names the team it
 * counts for (an own goal too, then "own goal" and who put it in); a substitution names both players in the least room.
 */
export function doneSaid(words: FootballWords, did: FootballDone): Text {
  switch (did.kind) {
    case 'start':
      return { key: 'scoring.football.last.start' };
    case 'clock':
      return clockSaid(words, did);
    case 'clockCorrect':
      return correctedSaid(words, did);
    case 'goal':
      return goalSaid(words, did);
    case 'card':
      return cardSaid(words, did);
    case 'sub':
      return subSaid(words, did);
    case 'period':
      return periodSaid(words, did);
    case 'penaltyMiss':
    case 'shot':
      return outcomeSaid(words, did);
    case 'sinBin':
    case 'sinBinEnd':
      return binSaid(words, did);
    case 'kick':
      return kickSaid(words, did);
  }
}

type Done<K extends FootballDone['kind']> = Extract<FootballDone, { kind: K }>;

/** Start or Pause, with the clock's face it was recorded at. */
const clockSaid = (words: FootballWords, did: Done<'clock'>): Text => ({
  key: did.running ? 'scoring.football.last.clockStart' : 'scoring.football.last.clockPause',
  vars: { at: faceAt(words.cfg, did.at) },
});

/** A correction of the clock, with the face it was recorded at: "Clock corrected · 2:00" (fix round 2). */
const correctedSaid = (words: FootballWords, did: Done<'clockCorrect'>): Text => ({
  key: 'scoring.football.last.clockCorrected',
  vars: { at: faceAt(words.cfg, did.at) },
});

/** A goal names the team it counts for: an own goal says so, and names who put it in (a player of the other team). */
function goalSaid(words: FootballWords, did: Done<'goal'>): Text {
  const word = did.ownGoal ? 'ownGoal' : did.penalty ? 'penaltyGoal' : 'goal';
  return {
    key: `scoring.football.last.${word}`,
    vars: { team: words.names[did.side], who: who(did.scorer), at: minuteAt(words.cfg, did.at) },
  };
}

function cardSaid(words: FootballWords, did: Done<'card'>): Text {
  return {
    key: 'scoring.football.last.card',
    vars: {
      card: cardText(did.color),
      team: words.names[did.side],
      who: who(did.person),
      at: minuteAt(words.cfg, did.at),
    },
  };
}

/** A substitution names both players in the least room: "#8 off, #14 on"; a concussion one says so (ruling 155). */
function subSaid(words: FootballWords, did: Done<'sub'>): Text {
  return {
    key:
      did.concussion === true ? 'scoring.football.last.concussionSub' : 'scoring.football.last.sub',
    vars: {
      team: words.names[did.side],
      off: playerMark(did.off),
      on: playerMark(did.on),
      at: minuteAt(words.cfg, did.at),
    },
  };
}

const periodSaid = (words: FootballWords, did: Done<'period'>): Text => ({
  key: 'scoring.football.last.period',
  vars: { end: markerText(did.marker), at: minuteAt(words.cfg, did.at) },
});

function outcomeSaid(words: FootballWords, did: Done<'penaltyMiss' | 'shot'>): Text {
  return {
    key: `scoring.football.last.${did.kind}`,
    vars: {
      team: words.names[did.side],
      who: who(did.taker),
      outcome: outcomeText(did.outcome),
      at: minuteAt(words.cfg, did.at),
    },
  };
}

const binSaid = (words: FootballWords, did: Done<'sinBin' | 'sinBinEnd'>): Text => ({
  key: `scoring.football.last.${did.kind}`,
  vars: { team: words.names[did.side], who: who(did.person), at: minuteAt(words.cfg, did.at) },
});

/** A shootout kick: no minute, the kicks are not played on the clock. */
const kickSaid = (words: FootballWords, did: Done<'kick'>): Text => ({
  key: `scoring.football.last.${did.scored ? 'kickScored' : 'kickMissed'}`,
  vars: { team: words.names[did.side], who: who(did.person) },
});

/** The line after an Undo took an event back: "Undone — " and the event in its own words. */
export const undoneSaid = (words: FootballWords, did: FootballDone): Text => ({
  key: 'scoring.football.last.undone',
  vars: { what: doneSaid(words, did) },
});

/** The player a line names, after its separator, or nothing when nobody was named. */
const who = (player: FootballPlayer | null): string =>
  player === null ? '' : ` · ${playerLabel(player)}`;

/** The minute an event was recorded in, after a space ("41'", "90+3'"), or nothing for an event with no stamp. */
const minuteAt = (cfg: FootballCfg, at: GameTime | null): string =>
  at === null ? '' : ` ${minuteText(matchTime(at, cfg))}`;

/** The clock's face a clock event was recorded at ("45:00"), after its separator, or nothing with no stamp. */
const faceAt = (cfg: FootballCfg, at: GameTime | null): string =>
  at === null ? '' : ` · ${clockText(matchTime(at, cfg))}`;

const CARDS: readonly FootballCardWord[] = ['yellow', 'second_yellow', 'red'];
const OUTCOMES: readonly FootballOutcomeWord[] = ['saved', 'missed', 'post', 'blocked', 'scored'];
const MARKERS: readonly FootballMarker[] = ['HT', 'FT', 'QT', '3QT', 'ET_HT', 'ET_FT'];

/** The engine's word as the dictionary's, or the engine's word itself for one this build has no words for. */
function wordOf<W extends string>(
  known: readonly W[],
  word: string,
  keyOf: (known: W) => FootballPadKey,
): PadVar<FootballPadKey> {
  const found = known.find((candidate) => candidate === word);
  return found === undefined ? word : { key: keyOf(found) };
}

const cardText = (color: string) => wordOf(CARDS, color, (card) => `scoring.football.card.${card}`);
const outcomeText = (outcome: string) =>
  wordOf(OUTCOMES, outcome, (known) => `scoring.football.outcome.${known}`);
const markerText = (marker: string) =>
  wordOf(MARKERS, marker, (known) => `scoring.football.end.${known}`);
