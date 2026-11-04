import { describe, expect, it } from 'vitest';
import { chessSport } from '@/domain/scoring/chessSport';
import type { ChessTypes } from '@/domain/scoring/chessTypes';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import { viewAs } from '@/domain/scoring/scoringMatchView';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import { drive } from '../../../test/scoringMatchFixtures';
import { GAME, ledgerOf } from '../../../test/chessLedger';

// A sport with no serve pick (plan S2-3 Task 2): the match keeps no pick, however Start match is pressed, and an Undo of
// the start leaves the Start screen as it was. Chess is the sport; its `tossOf` is always null.

const NOW = 1_000_000;
const AT = '2026-11-04T10:00:00.000Z';
const START = { kind: 'start' } as const;

function notStarted(): MatchState<ChessTypes> {
  const opened = openMatch<ChessTypes>(
    {
      sport: chessSport,
      queue: {
        fixtureId: GAME.fixtureId,
        label: 'A. Sharma v L. Chen',
        pending: [],
        ownEventIds: [],
        dead: null,
      },
      ledger: ledgerOf([]),
      bootstrap: GAME,
      toss: null,
      judge: 'fold',
      foreground: true,
      rulesVersion: 1,
      decidedAt: null,
    },
    NOW,
  );
  return step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
}

function padOf(state: MatchState<ChessTypes>): MatchPad<ChessTypes> {
  const view = viewAs(chessSport, state);
  if (view.kind !== 'pad') throw new Error(`not a pad: ${view.kind}`);
  return view;
}

describe('a match whose sport has no serve pick', () => {
  it('shows the Start screen with nothing picked and no pick needed', () => {
    const pad = padOf(notStarted());
    expect(pad.toss).toBeNull();
    expect(pad.view.start?.needsToss).toBe(false);
  });

  it('starts with the one tap and no pick, and the match keeps none', () => {
    const { state, steps } = drive(notStarted(), [{ kind: 'tap', tap: START, key: 's1', at: AT }]);
    expect(steps[0].outcome).toEqual({ ok: true });
    expect(state.sync.queue.pending).toMatchObject([
      { key: 's1', type: 'core.start', payload: {} },
    ]);
    expect(state.toss).toBeNull();
    expect(padOf(state).view.start).toBeNull();
  });

  it('takes the start back with Undo, and the Start screen asks for no pick again', () => {
    const { state, steps } = drive(notStarted(), [
      { kind: 'tap', tap: START, key: 's1', at: AT },
      { kind: 'undo', key: 'u1', at: AT },
    ]);
    expect(steps[1].outcome).toEqual({ ok: true });
    expect(state.toss).toBeNull();
    const pad = padOf(state);
    expect(pad.toss).toBeNull();
    expect(pad.view.start?.needsToss).toBe(false);
  });

  it('refuses a second start once the first is in, as it does for any sport', () => {
    const { steps } = drive(notStarted(), [
      { kind: 'tap', tap: START, key: 's1', at: AT },
      { kind: 'tap', tap: START, key: 's2', at: AT },
    ]);
    expect(steps[1].outcome).toEqual({ ok: false, refusal: 'notNow' });
  });
});
