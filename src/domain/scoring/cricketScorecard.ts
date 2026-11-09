import type { CricketInningsCard } from '@seazn/engine/sports/cricket';
import { wordsOf } from '@/domain/scoring/cricketPad';
import { superOverNumber } from '@/domain/scoring/cricketTurn';
import type { CricketDisplay, CricketPadKey } from '@/domain/scoring/cricketTypes';
import type { PadText } from '@/domain/scoring/padView';

/**
 * The scorecard under Match details (S2-4 spec §6; plan Task 18): every innings played, in the order it was played, with
 * its batting (how each batter is out, runs and balls faced), who has not batted, the extras, the bowling (O-M-R-W) and
 * the fall of wickets. Every figure is the engine scorecard's (`deriveCricketScorecard`, through the fold, which is
 * `display.scorecard`), never a sum of the phone's. An innings scored in over totals has its total and nothing of the
 * player lines, since the engine has none to give.
 */

type Text = PadText<CricketPadKey>;

export type ScorecardBatter = {
  readonly name: string;
  /** "not out", "bowled · b Smith", "caught (Jones) · b Smith", "run out (Jones)". */
  readonly how: Text;
  /** "12 (8)": runs and the balls faced. */
  readonly score: Text;
};

export type ScorecardBowler = { readonly name: string; readonly figures: string };

export type ScorecardInnings = {
  readonly title: Text;
  readonly total: Text;
  readonly batting: readonly ScorecardBatter[];
  readonly didNotBat: Text | null;
  readonly extras: Text | null;
  readonly bowling: readonly ScorecardBowler[];
  /** One text a wicket, "1-12 (Smith, 2.3 ov)". */
  readonly fall: readonly Text[];
};

/** The innings played so far, main innings then super overs (the engine's order); none before a ball or total. */
export function scorecardView(display: CricketDisplay): readonly ScorecardInnings[] {
  const names = wordsOf(display).names;
  const nameOf = (id: string): string => names.get(id) ?? id;
  const sides = new Map([
    [display.sides.first.entrantId, display.sides.first.name],
    [display.sides.second.entrantId, display.sides.second.name],
  ]);
  const side = (id: string): string => sides.get(id) ?? id;
  const cards = display.scorecard.innings;
  return cards.map((card, index) => {
    // History numbers a super over from 1, two innings each (T19 D12); the engine numbers every innings in the order played.
    const number = card.isSuperOver
      ? superOverNumber(cards.slice(0, index).filter((one) => one.isSuperOver).length)
      : card.number;
    return inningsOf(card, number, nameOf, side);
  });
}

type NameOf = (id: string) => string;

/** What a figure the engine does not know is drawn as (a maiden count a line ledger did not give): never a nought. */
const NOT_KNOWN = '–';

function inningsOf(
  card: CricketInningsCard,
  number: number,
  nameOf: NameOf,
  side: (id: string) => string,
): ScorecardInnings {
  return {
    title: {
      key: card.isSuperOver
        ? 'scoring.cricket.history.superOver'
        : 'scoring.cricket.history.innings',
      vars: { number, side: side(card.side) },
    },
    total: {
      key: card.declared ? 'scoring.cricket.card.declared' : 'scoring.cricket.card.total',
      vars: { runs: card.total.runs, wickets: card.total.wickets, overs: card.total.overs },
    },
    batting: card.batting.map((line) => batterOf(line, nameOf)),
    didNotBat: didNotBatOf(card.didNotBat, nameOf),
    extras: extrasOf(card.extras),
    bowling: card.bowling.map((line) => ({
      name: nameOf(line.person),
      figures: `${line.overs}-${line.maidens ?? NOT_KNOWN}-${line.runs}-${line.wickets}`,
    })),
    fall: card.fallOfWickets.map((fall) => ({
      key: 'scoring.cricket.card.fall',
      vars: { wicket: fall.wicket, runs: fall.runs, batter: nameOf(fall.batter), over: fall.over },
    })),
  };
}

function batterOf(line: CricketInningsCard['batting'][number], nameOf: NameOf): ScorecardBatter {
  return {
    name: nameOf(line.person),
    how: howOut(line.dismissal, nameOf),
    score: { key: 'scoring.cricket.card.score', vars: { runs: line.runs, balls: line.balls } },
  };
}

type Dismissal = CricketInningsCard['batting'][number]['dismissal'];

/** How out, as a scorebook writes it: the kind, the fielders a catch or run out names, then the bowler credited. */
function howOut(dismissal: Dismissal, nameOf: NameOf): Text {
  if (dismissal.kind === 'not_out') return { key: 'scoring.cricket.card.notOut' };
  if (dismissal.kind === 'out_unknown') return { key: 'scoring.cricket.card.out' };
  const kind: Text = { key: `scoring.cricket.out.kind.${dismissal.kind}` };
  const how = withFielders(kind, dismissal, nameOf);
  return dismissal.bowler === null
    ? how
    : { key: 'scoring.cricket.card.bowledBy', vars: { how, bowler: nameOf(dismissal.bowler) } };
}

/** "caught (Jones)", "run out (Jones/Smith)" — the thrower first, as History says it. */
function withFielders(
  kind: Text,
  { fielder, fielderAssist }: { fielder: string | null; fielderAssist: string | null },
  nameOf: NameOf,
): Text {
  if (fielder === null) return kind;
  if (fielderAssist === null) {
    return { key: 'scoring.cricket.out.fielder', vars: { how: kind, fielder: nameOf(fielder) } };
  }
  return {
    key: 'scoring.cricket.out.fielders',
    vars: { how: kind, assist: nameOf(fielderAssist), fielder: nameOf(fielder) },
  };
}

function didNotBatOf(ids: readonly string[], nameOf: NameOf): Text | null {
  if (ids.length === 0) return null;
  return { key: 'scoring.cricket.card.didNotBat', vars: { names: ids.map(nameOf).join(', ') } };
}

/** The extras and their kinds; a penalty is named only when one was awarded. */
function extrasOf(extras: CricketInningsCard['extras']): Text | null {
  if (extras === null) return null;
  const vars = {
    total: extras.total,
    wides: extras.wides,
    noBalls: extras.noBalls,
    byes: extras.byes,
    legByes: extras.legByes,
  };
  return extras.penalties === 0
    ? { key: 'scoring.cricket.card.extras', vars }
    : { key: 'scoring.cricket.card.extrasPen', vars: { ...vars, penalties: extras.penalties } };
}
