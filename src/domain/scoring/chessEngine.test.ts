import { describe, expect, it } from 'vitest';
import {
  chessCfg,
  chessRefusalOf,
  readChessCfg,
  type ChessEngineMatch,
} from '@/domain/scoring/chessEngine';
import { envelopeOf, lineupOf } from '@/domain/scoring/setBasedEngine';
import { GAME, ledgerOf, pairing, result, start } from '../../../test/chessLedger';

// The engine as the fold and the fake server reach it (plan S2-3 Task 1): the config through the engine's schema and the
// server's word on one new event. The words are the engine's own codes.

const { home, away } = GAME.sides;
if (home === null || away === null) throw new Error('the fixture has two sides');
const match = (cfg: unknown = {}): ChessEngineMatch => ({
  fixtureId: GAME.fixtureId,
  cfg: chessCfg(cfg),
  lineups: { home: lineupOf(home), away: lineupOf(away) },
});
const envelopes = (specs: Parameters<typeof ledgerOf>[0]) =>
  ledgerOf(specs).map((event) => envelopeOf(GAME.fixtureId, event));

describe('chessRefusalOf', () => {
  it('has no word for no event at all', () => {
    expect(chessRefusalOf(match(), [])).toBeNull();
  });

  it('takes a result after the start, and names the engine’s code for one before it', () => {
    expect(chessRefusalOf(match(), envelopes([start(), result('H')]))).toBeNull();
    expect(chessRefusalOf(match(), envelopes([result('H')]))).toBe('WRONG_PHASE');
  });

  it('judges only the last event: what came before is replayed, not judged again', () => {
    expect(chessRefusalOf(match(), envelopes([start(), result('H'), pairing('A')]))).toBe(
      'ALREADY_DECIDED',
    );
  });

  it('judges the append as the server does: strict, so a method that contradicts the winner is refused', () => {
    expect(chessRefusalOf(match(), envelopes([start(), result(null, 'checkmate')]))).toBe(
      'RESULT_METHOD_CONTRADICTS_WINNER',
    );
  });
});

describe('readChessCfg', () => {
  it('fills the engine’s defaults into a config the organiser left empty', () => {
    expect(readChessCfg({})).toMatchObject({ colors: true });
  });

  it('is nothing for a config the schema refuses', () => {
    expect(readChessCfg({ colors: 'sometimes' })).toBeNull();
  });
});
