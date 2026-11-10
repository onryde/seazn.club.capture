import type { CricketInningsCard } from '@seazn/engine/sports/cricket';
import type { CricketDisplay, CricketPadKey } from '@/domain/scoring/cricketTypes';
import type { PadText } from '@/domain/scoring/padView';

/**
 * A decided match's summary (T19 fix 10): for each main innings, in batting order, the batting side's top bat, the other
 * side's best bowler and the extras, all off the engine's scorecard already folded (`display.scorecard`); no figure is
 * summed here. Super overs are left out: the deciding contest is already on the board. The web's overlay `highlights`
 * rule was not found in the engine package, so the tie order is the brief's own and is pinned in the tests.
 */
export type TopBat = { readonly name: string; readonly runs: number; readonly balls: number };
export type BestBowl = {
  readonly name: string;
  readonly wickets: number;
  readonly runs: number;
  readonly overs: string;
};
export type InningsHighlights = {
  readonly top: TopBat | null;
  readonly best: BestBowl | null;
  readonly extras: PadText<CricketPadKey> | null;
};
export type SummaryBlock = InningsHighlights & { readonly team: string };

/** The highest scorer who faced a ball: most runs, then fewer balls, then batting order. */
function topOf(card: CricketInningsCard, nameOf: (id: string) => string): TopBat | null {
  const faced = card.batting.filter((line) => line.balls > 0);
  const top = [...faced].sort(
    (a, b) => b.runs - a.runs || a.balls - b.balls || a.order - b.order,
  )[0];
  return top === undefined ? null : { name: nameOf(top.person), runs: top.runs, balls: top.balls };
}

/**
 * The best bowler of those who bowled a ball. Most wickets; when the best took some, then fewer runs, then fewer balls;
 * when nobody took a wicket, the lower economy (runs a legal ball, compared by cross-multiplying), then the more balls
 * bowled; either way then the card's order (T19 fix 11).
 */
function bestOf(card: CricketInningsCard, nameOf: (id: string) => string): BestBowl | null {
  const bowled = card.bowling.filter((line) => line.legalBalls > 0);
  const wicketless = bowled.every((line) => line.wickets === 0);
  const best = [...bowled].sort((a, b) =>
    wicketless
      ? a.runs * b.legalBalls - b.runs * a.legalBalls || b.legalBalls - a.legalBalls
      : b.wickets - a.wickets || a.runs - b.runs || a.legalBalls - b.legalBalls,
  )[0];
  return best === undefined
    ? null
    : { name: nameOf(best.person), wickets: best.wickets, runs: best.runs, overs: best.overs };
}

export function inningsHighlights(
  card: CricketInningsCard,
  nameOf: (id: string) => string,
): InningsHighlights {
  return { top: topOf(card, nameOf), best: bestOf(card, nameOf), extras: extrasShown(card.extras) };
}

/** The blocks of a decided match; none before it is decided. */
export function summaryOf(
  display: CricketDisplay,
  names: ReadonlyMap<string, string>,
): readonly SummaryBlock[] | null {
  if (display.stage !== 'decided') return null;
  const nameOf = (id: string) => names.get(id) ?? id;
  const sides = new Map([
    [display.sides.first.entrantId, display.sides.first.name],
    [display.sides.second.entrantId, display.sides.second.name],
  ]);
  return display.scorecard.innings
    .filter((card) => !card.isSuperOver)
    .map((card) => ({
      team: sides.get(card.side) ?? card.side,
      ...inningsHighlights(card, nameOf),
    }));
}

/** The summary's extras: all zero reads just the total (T19 fix 11); otherwise the card's own line. */
function extrasShown(extras: CricketInningsCard['extras']): PadText<CricketPadKey> | null {
  if (extras?.total === 0) {
    return { key: 'scoring.cricket.board.summary.extrasNone', vars: { total: 0 } };
  }
  return extrasOf(extras);
}

/** The extras and their kinds; a penalty is named only when one was awarded. */
export function extrasOf(extras: CricketInningsCard['extras']): PadText<CricketPadKey> | null {
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
