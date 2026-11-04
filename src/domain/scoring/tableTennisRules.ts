import type { PadRuleRow, PadText } from '@/domain/scoring/padView';
import type { TableTennisRecords, TableTennisRules } from '@/domain/scoring/tableTennisPad';

/** The dictionary keys the rules table's rows name: a label and a value a row. */
export type TableTennisRuleKey =
  | 'scoring.tabletennis.rules.format.label'
  | 'scoring.tabletennis.rules.bestOf'
  | 'scoring.tabletennis.rules.points.label'
  | 'scoring.tabletennis.rules.points.value'
  | 'scoring.tabletennis.rules.points.deciding'
  | 'scoring.tabletennis.rules.expedite.label'
  | 'scoring.tabletennis.rules.expedite.value'
  | 'scoring.tabletennis.rules.timeouts.label'
  | 'scoring.tabletennis.rules.timeouts.value';

type Row = PadRuleRow<TableTennisRuleKey>;
type Value = PadText<TableTennisRuleKey>;

/**
 * The rules table's rows (design §5.4; the controller's wording), in order: Format ("Best of 5"), Points (a game's
 * points and lead, and the deciding game's own target when it differs: "11, win by 2, game 5 to 15"), Expedite and
 * Timeouts. The facts of the first two are the match's config as the engine reads it (`TableTennisRules`: a hardbat match
 * says 21, never 11); the last two are the ITTF's, which the config holds only as whether the match records them
 * (`records`), so a match that does not record one has no row for it: the table says nothing the pad does not offer.
 * `MatchCard` draws any sport's rows; it knows nothing of table tennis.
 *
 * The words of Expedite ("After 10 minutes", ITTF 2.15.1: when the umpire may start it) and Timeouts ("One each",
 * ITTF 3.4.4) are copy, not a number of ours: the engine's config holds neither figure, and the pad enforces neither
 * (design §2: the umpire decides when to start Expedite, and keeps the one timeout).
 */
export function tableTennisRuleRows(
  rules: TableTennisRules,
  records: TableTennisRecords,
): readonly Row[] {
  return [
    row('format', { key: 'scoring.tabletennis.rules.bestOf', vars: { bestOf: rules.bestOf } }),
    row('points', pointsOf(rules)),
    ...(records.expedite
      ? [row('expedite', { key: 'scoring.tabletennis.rules.expedite.value' })]
      : []),
    ...(records.timeouts
      ? [row('timeouts', { key: 'scoring.tabletennis.rules.timeouts.value' })]
      : []),
  ];
}

/**
 * Each game's target in one value: said once when every game is played to the same score, else the deciding game's too.
 * A best of 1 plays its one game as the deciding game, so the target the config gives the first game is never played.
 */
function pointsOf(rules: TableTennisRules): Value {
  const { bestOf, setTo, finalSetTo, winBy } = rules;
  const first = bestOf === 1 ? finalSetTo : setTo;
  if (finalSetTo === first) {
    return { key: 'scoring.tabletennis.rules.points.value', vars: { points: first, winBy } };
  }
  return {
    key: 'scoring.tabletennis.rules.points.deciding',
    vars: { points: first, winBy, game: bestOf, deciding: finalSetTo },
  };
}

type RuleName = 'format' | 'points' | 'expedite' | 'timeouts';

const row = (name: RuleName, value: Value): Row => ({
  label: { key: `scoring.tabletennis.rules.${name}.label` },
  value,
});
