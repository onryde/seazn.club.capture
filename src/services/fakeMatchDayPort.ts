import type { MatchDay, Row } from '@/domain/matchday/matchDay';
import type { OpenAnswer } from '@/domain/matchday/openWire';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import type { MatchDayPort, PortAnswer } from '@/services/matchDayPort';

const row = (fixtureId: string, home: string, away: string, at: string): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  home,
  away,
  status: 'upcoming',
  scheduledAt: new Date(at),
  summary: null,
});

/**
 * A made-up day on a laptop (AGENTS §10: every state through a fake): SAFE Open, a code scoped to Hall A, on Saturday
 * 3 October 2026 in London, the day the other fakes' clock (`TEST_NOW`, 13:00Z) is in. Court 1 is playing Ng v Brown,
 * with Patel v Okafor next; Court 2 is free.
 */
export const FAKE_DAY: MatchDay = {
  competition: { id: '2f0c8a51-6b8e-4d37-9a51-0c1e2d3f4a5b', name: 'SAFE Open' },
  scope: { kind: 'venue', label: 'Hall A' },
  day: '2026-10-03',
  tz: 'Europe/London',
  opensAt: new Date('2026-10-02T23:00:00.000Z'),
  expiresAt: new Date('2026-10-03T23:00:00.000Z'),
  canApprove: false,
  courts: [
    {
      courtId: '0e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b',
      courtName: 'Court 1',
      venueName: 'Hall A',
      state: 'playing',
      now: {
        ...row('7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'Ng', 'Brown', '2026-10-03T12:20:00.000Z'),
        status: 'inPlay',
        summary: '14-9',
      },
      next: [
        row('8c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f', 'Patel', 'Okafor', '2026-10-03T13:40:00.000Z'),
      ],
      finished: [],
    },
    {
      courtId: '1f6a7b8c-9d0e-4f1a-9b2c-4d5e6f7a8b9c',
      courtName: 'Court 2',
      venueName: 'Hall A',
      state: 'free',
      now: null,
      next: [],
      finished: [],
    },
  ],
  noCourt: [],
  online: [],
  approvals: [],
};

/** A made-up scoring link on the staging host: `dl_` and 43 base64url characters, never a real one. */
export const FAKE_OPEN_URL =
  'https://stg.seazn.club/score/dl_Fake-Open_0123456789abcdefghijklmnopqrstuvw';

export type FakeMatchDayCall = {
  readonly op: 'day' | 'open' | 'review' | 'approve';
  readonly code: SavedDayCode;
  readonly fixtureId?: string;
};

export type FakeMatchDayPort = MatchDayPort & {
  /** What every later `day` answers: `FAKE_DAY` until told otherwise. */
  answerDay(answer: PortAnswer<MatchDay>): void;
  /** What every later `open` answers: a link to `FAKE_OPEN_URL`, a badminton match, until told otherwise. */
  answerOpen(answer: PortAnswer<OpenAnswer>): void;
  /** Pends every later call until `release()`, which settles them with the answer standing then. */
  hold(): void;
  release(): void;
  /** The next call throws instead of answering, once: a port broken in a way its own code never says. */
  throwNext(): void;
  /** Every call, in order, with the code it carried. */
  readonly calls: readonly FakeMatchDayCall[];
};

const OFFLINE = { ok: false, offline: true } as const;

/** The Match Day API on a laptop: the day and the open answer what the test says; review and approve are offline. */
export function createFakeMatchDayPort(): FakeMatchDayPort {
  let day: PortAnswer<MatchDay> = { ok: true, value: FAKE_DAY };
  let open: PortAnswer<OpenAnswer> = {
    ok: true,
    value: { kind: 'link', url: FAKE_OPEN_URL, sportKey: 'badminton' },
  };
  let gate: Promise<void> | null = null;
  let lift = (): void => undefined;
  let throwing = false;
  const calls: FakeMatchDayCall[] = [];
  const answer = async <T>(call: FakeMatchDayCall, read: () => T): Promise<T> => {
    calls.push(call);
    if (gate !== null) await gate;
    if (throwing) {
      throwing = false;
      throw new Error('the Match Day port threw');
    }
    return read();
  };
  return {
    day: (code) => answer({ op: 'day', code }, () => day),
    open: (code, fixtureId) => answer({ op: 'open', code, fixtureId }, () => open),
    review: (code) => answer({ op: 'review', code }, () => OFFLINE),
    approve: (code) => answer({ op: 'approve', code }, () => OFFLINE),
    answerDay: (next) => {
      day = next;
    },
    answerOpen: (next) => {
      open = next;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        lift = resolve;
      });
    },
    release: () => {
      gate = null;
      lift();
    },
    throwNext: () => {
      throwing = true;
    },
    calls,
  };
}
