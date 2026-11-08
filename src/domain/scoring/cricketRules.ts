import type { CricketCfg } from '@seazn/engine/sports/cricket';
import type { CricketRuleKey } from '@/domain/scoring/cricketTypes';
import type { PadRuleRow, PadText } from '@/domain/scoring/padView';

type Row = PadRuleRow<CricketRuleKey>;
type Value = PadText<CricketRuleKey>;

/**
 * The rules table's rows (S2-4 spec §4.1, the match card's format line), in order: the overs an innings (or Unlimited),
 * the balls an over, the players a side, a bowler's overs, the super over on or off, then the follow-on and reviews only
 * when the format has them (a follow-on enabled, a review allowance set), so the table says nothing the match does not
 * play. Every fact is the fixture's config as the engine reads it; `MatchCard` draws any sport's rows.
 */
export function cricketRuleRows(cfg: CricketCfg): readonly Row[] {
  const followOn = cfg.followOn?.enabled === true ? cfg.followOn : null;
  return [
    row('overs', oversOf(cfg)),
    row('over', { key: 'scoring.cricket.rules.over.value', vars: { balls: cfg.ballsPerOver } }),
    row('players', {
      key: 'scoring.cricket.rules.players.value',
      vars: { players: cfg.playersPerSide },
    }),
    row('bowler', bowlerOf(cfg)),
    row('superOver', { key: `scoring.cricket.rules.superOver.${cfg.superOver ? 'on' : 'off'}` }),
    ...(followOn === null
      ? []
      : [
          row('followOn', {
            key: 'scoring.cricket.rules.followOn.value',
            vars: { lead: followOn.lead },
          }),
        ]),
    ...(cfg.reviews === undefined
      ? []
      : [
          row('reviews', {
            key: 'scoring.cricket.rules.reviews.value',
            vars: { reviews: cfg.reviews.perInnings },
          }),
        ]),
  ];
}

/**
 * An innings' length in overs, as a scorebook writes it: whole overs ("20"), or overs and balls when the balls do not
 * make whole overs ("16.4"); Unlimited when the format has no limit.
 */
function oversOf(cfg: CricketCfg): Value {
  const { ballsPerInnings, ballsPerOver } = cfg;
  if (ballsPerInnings === null) return { key: 'scoring.cricket.rules.overs.unlimited' };
  const overs = Math.floor(ballsPerInnings / ballsPerOver);
  const balls = ballsPerInnings % ballsPerOver;
  return {
    key: 'scoring.cricket.rules.overs.value',
    vars: { overs: balls === 0 ? `${overs}` : `${overs}.${balls}` },
  };
}

/** A bowler's quota ("Up to 4 overs"), or No limit when the format sets none. */
const bowlerOf = (cfg: CricketCfg): Value =>
  cfg.maxOversPerBowler === undefined
    ? { key: 'scoring.cricket.rules.bowler.none' }
    : { key: 'scoring.cricket.rules.bowler.value.other', count: cfg.maxOversPerBowler };

type RuleName = 'overs' | 'over' | 'players' | 'bowler' | 'superOver' | 'followOn' | 'reviews';

const row = (name: RuleName, value: Value): Row => ({
  label: { key: `scoring.cricket.rules.${name}.label` },
  value,
});
