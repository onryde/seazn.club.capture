import { describe, expect, it, vi } from 'vitest';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import type { TableTennisTypes } from '@/domain/scoring/tableTennisPad';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import { NOW, savesOf, sendsOf } from '../../../test/scoringMatchFixtures';
import { SINGLES, ledgerOf, start } from '../../../test/tableTennisLedger';

// The send's context (plan S2-5 P Task 7; the controller's ruling 4 of Batch B): a sport whose payload depends on when it
// is sent (football's Start, advanced by the time it waited in the queue) is told the runtime's clock and the bootstrap
// the match holds. Any sport serves to show the pump passes them; table tennis is the one driven here.

const QUEUE: MatchQueue = {
  fixtureId: SINGLES.fixtureId,
  label: 'A. Sharma v L. Chen',
  pending: [],
  ownEventIds: [],
  dead: null,
};

function sendWith(sport: ScoringSport<TableTennisTypes>, sentAt: number) {
  const held: MatchHeld<TableTennisTypes> = {
    sport,
    queue: QUEUE,
    ledger: ledgerOf([start()]),
    bootstrap: SINGLES,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
  };
  const opened = openMatch(held, NOW);
  const ready: MatchState<TableTennisTypes> = step(
    opened.state,
    { kind: 'fetched', events: [] },
    NOW,
  ).state;
  const tap = { kind: 'rally', side: 'first', serving: null, servingAt: null } as const;
  const made = step(ready, { kind: 'tap', tap, key: 'k-tap', at: '2026-11-04T09:00:00.000Z' }, NOW);
  const [save] = savesOf(made.effects);
  return sendsOf(step(made.state, { kind: 'saved', n: save.n }, sentAt).effects)[0];
}

describe('the pump tells the sport when it sends', () => {
  it('hands payloadForSend the step’s clock and the bootstrap the match holds', () => {
    const payloadForSend = vi.fn(tableTennisSport.payloadForSend);
    const sent = sendWith({ ...tableTennisSport, payloadForSend }, NOW + 120_500);
    expect(sent?.body.idempotency_key).toBe('k-tap');
    expect(payloadForSend).toHaveBeenCalledTimes(1);
    expect(payloadForSend.mock.calls[0]?.[3]).toEqual({ now: NOW + 120_500, bootstrap: SINGLES });
  });

  it('sends what the sport made of it, and keeps it in the queue', () => {
    const payloadForSend = vi.fn((_queued, _ledger, _copied, send: { readonly now: number }) => ({
      sentAt: send.now,
    }));
    const sent = sendWith({ ...tableTennisSport, payloadForSend }, NOW + 7_000);
    expect(sent?.body.payload).toEqual({ sentAt: NOW + 7_000 });
    expect(sent?.sent.payload).toEqual({ sentAt: NOW + 7_000 });
  });
});
