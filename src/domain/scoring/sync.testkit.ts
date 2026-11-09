import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import { onAnswer, type SyncState } from '@/domain/scoring/sync';
import type { AppendAnswer, LedgerEvent } from '@/domain/scoring/wire';

/** The caller's clock, in ms: only its differences matter. */
export const NOW = 1_000_000;

export const tap = (key: string, overrides: Partial<QueuedEvent> = {}): QueuedEvent => ({
  key,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  rulesVersion: 2,
  createdAt: '2026-11-02T10:00:00.000Z',
  attempts: 0,
  ...overrides,
});

export const A = tap('key-a');
export const B = tap('key-b', {
  payload: { wonBy: 'ent-away' },
  createdAt: '2026-11-02T10:00:05.000Z',
});
export const C = tap('key-c', { type: 'core.void', payload: { event_id: 'ev-2' } });

export const ev = (seq: number, overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `ev-${seq}`,
  seq,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  recordedAt: `2026-11-02T09:00:0${seq}.000Z`,
  voids: null,
  deviceLinkId: 'link-other',
  ...overrides,
});

export const queueOf = (
  pending: readonly QueuedEvent[],
  overrides: Partial<MatchQueue> = {},
): MatchQueue => ({
  fixtureId: 'fixture-1',
  label: 'Match 4',
  pending,
  ownEventIds: [],
  dead: null,
  ...overrides,
});

/** Mid-send by default: the head, A, is on its way (the unit tests do not need its attempts to say so). */
export const stateOf = (overrides: Partial<SyncState> = {}): SyncState => ({
  tip: 4,
  ledger: [ev(1), ev(2), ev(3), ev(4)],
  queue: queueOf([A, B]),
  rulesVersion: 2,
  engineEpoch: 2,
  status: 'sending',
  inFlight: 'key-a',
  notBefore: 0,
  conflictPasses: 0,
  rulesPasses: 0,
  hold: null,
  decidedProbe: null,
  revalidateOwed: false,
  rulesRetryAt: null,
  rulesSaid: null,
  refusedRun: null,
  ...overrides,
});

/** Nothing on its way: what a state is between an answer and the next send. */
export const restingOf = (overrides: Partial<SyncState> = {}): SyncState =>
  stateOf({ status: 'idle', inFlight: null, ...overrides });

export const accepted = (seq: number, eventId: string, rulesVersion = 2): AppendAnswer => ({
  kind: 'accepted',
  seq,
  eventId,
  rulesVersion,
});

export const refusal = (code: string, status = 422): AppendAnswer => ({
  kind: 'refused',
  status,
  code,
});

export const answer = (state: SyncState, sent: QueuedEvent, said: AppendAnswer, now = NOW) =>
  onAnswer(state, sent, said, now);
