import { describe, expect, it } from 'vitest';
import { footballSport } from '@/domain/scoring/footballSport';
import type { FootballTypes } from '@/domain/scoring/footballTypes';
import type { MatchQueue } from '@/domain/scoring/queue';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchHeld, MatchState } from '@/domain/scoring/scoringMatchState';
import { savesOf, sendsOf } from '../../../test/scoringMatchFixtures';
import {
  at,
  clock,
  eventId,
  ledgerOf,
  MATCH,
  start,
  sub,
  voiding,
  type Spec,
} from '../../../test/footballLedger';

// Ruling 154, review M1, through the match runtime: a sub that joins a stoppage is queued with the stoppage's stamp and
// its own reading beside it (the runtime copies the sport's `reading` onto the queued tap, never into the payload), so
// when the sub it joined is undone before this one goes, the send carries the sub's own minute. Literals throughout.

const T = Date.parse('2026-11-07T14:30:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const QUEUE: MatchQueue = {
  fixtureId: MATCH.fixtureId,
  label: 'Home FC v Away FC',
  pending: [],
  ownEventIds: [],
  dead: null,
};

/** Another phone's sub at 10:00, the stoppage this phone's sub joins. */
const THEIRS: readonly Spec[] = [
  start(),
  clock(true, at('H1', 0)),
  sub({ by: 'A', off: 'A-p8', on: 'A-p14', at: at('H1', 600) }),
];

function ready(specs: readonly Spec[]): MatchState<FootballTypes> {
  const held: MatchHeld<FootballTypes> = {
    sport: footballSport,
    queue: QUEUE,
    ledger: ledgerOf(specs),
    bootstrap: MATCH,
    toss: null,
    judge: 'fold',
    foreground: true,
    rulesVersion: 1,
    decidedAt: null,
  };
  return step(openMatch(held, T).state, { kind: 'fetched', events: [] }, T).state;
}

const JOINED = {
  kind: 'sub',
  side: 'first',
  off: 'H-p7',
  on: 'H-p13',
  stamp: at('H1', 700),
} as const;

describe('a joined sub in the queue (ruling 154, review M1)', () => {
  it('is queued at the stoppage’s stamp, with its own reading beside the payload', () => {
    const made = step(ready(THEIRS), { kind: 'tap', tap: JOINED, key: 'k-sub', at: iso(T) }, T);
    expect(made.state.sync.queue.pending).toEqual([
      expect.objectContaining({
        key: 'k-sub',
        type: 'football.sub',
        payload: { by: 'ent-home', off: 'H-p7', on: 'H-p13', at: at('H1', 600) },
        reading: at('H1', 700),
      }),
    ]);
  });

  it('is sent at its own reading when the sub it joined was undone before it went', () => {
    const made = step(ready(THEIRS), { kind: 'tap', tap: JOINED, key: 'k-sub', at: iso(T) }, T);
    const events = ledgerOf([...THEIRS, voiding(eventId(3))]).slice(THEIRS.length);
    const read = step(made.state, { kind: 'fetched', events }, T + 1_000);
    const [save] = savesOf(made.effects);
    const saved = step(read.state, { kind: 'saved', n: save!.n }, T + 1_000);
    const [send] = sendsOf([...read.effects, ...saved.effects]);
    expect(send?.body.payload).toEqual({
      by: 'ent-home',
      off: 'H-p7',
      on: 'H-p13',
      at: at('H1', 700),
    });
  });
});
