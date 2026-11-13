import type { ApprovalReview, Approved } from '@/domain/matchday/approvalWire';
import type { Called, CallPreview, Candidates, Uncalled } from '@/domain/matchday/callWire';
import type { ApprovalKind, MatchDay, Row } from '@/domain/matchday/matchDay';
import type { OpenAnswer } from '@/domain/matchday/openWire';
import type { SavedDayCode } from '@/domain/mode/dayCode';
import type { CallAnswer, MatchDayPort, PortAnswer } from '@/services/matchDayPort';

const row = (fixtureId: string, home: string, away: string, at: string): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home,
  away,
  homeSlot: null,
  awaySlot: null,
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
  canCall: false,
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

/** A made-up Swiss stage and the proposal the fake's tests read: Round 4, the server's rows in its order, a bye last. */
export const FAKE_STAGE = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const FAKE_HASH = 'fake-proposal-hash-0001';
export const FAKE_REVIEW: ApprovalReview = {
  kind: 'swiss',
  stageId: FAKE_STAGE,
  divisionName: "Men's singles",
  round: 4,
  rows: [
    { label: 'R4 1', home: 'Ng', away: 'Brown' },
    { label: 'R4 2', home: 'Patel', away: 'Okafor' },
    { label: 'R4 3', home: 'Kim', away: null },
  ],
  hash: FAKE_HASH,
  ties: false,
};

/** A made-up quiet preview: nothing is pushed, no rule is bent. */
export const FAKE_QUIET_PREVIEW: CallPreview = { shifts: [], warnings: [] };

export type FakeMatchDayCall = {
  readonly op: 'day' | 'open' | 'review' | 'approve' | 'candidates' | 'preview' | 'call' | 'undo';
  /** The call routes: the court asked about, or called onto. */
  readonly courtId?: string;
  readonly code: SavedDayCode;
  readonly fixtureId?: string;
  /** Review and approve: the kind and stage asked for. */
  readonly kind?: ApprovalKind;
  readonly stageId?: string;
  /** Approve: the hash and round it handed back. */
  readonly hash?: string;
  readonly round?: number | null;
};

export type FakeMatchDayPort = MatchDayPort & {
  /** What every later `day` answers: `FAKE_DAY` until told otherwise. */
  /** Several answers are handed out in order, the last one standing (a read that must see the day change). */
  answerDay(...answers: PortAnswer<MatchDay>[]): void;
  /** What every later `open` answers: a link to `FAKE_OPEN_URL`, a badminton match, until told otherwise. */
  answerOpen(answer: PortAnswer<OpenAnswer>): void;
  /**
   * What the next reviews answer, in order; the last one stands for every later review. With none given, offline, as
   * before. A fresh call replaces the whole list.
   */
  answerReview(...answers: PortAnswer<ApprovalReview>[]): void;
  /** The same for approves. */
  answerApprove(...answers: PortAnswer<Approved>[]): void;
  /**
   * What the next candidate reads, previews, calls and undos answer, in order; the last one stands for every later one.
   * With none given, offline, as review and approve are. A fresh call replaces the whole list.
   */
  answerCandidates(...answers: CallAnswer<Candidates>[]): void;
  answerPreview(...answers: CallAnswer<CallPreview>[]): void;
  answerCall(...answers: CallAnswer<Called>[]): void;
  answerUndo(...answers: CallAnswer<Uncalled>[]): void;
  /** Pends every later call until `release()`, which settles them with the answer standing then. */
  hold(): void;
  release(): void;
  /** The next call throws instead of answering, once: a port broken in a way its own code never says. */
  throwNext(): void;
  /** Every call, in order, with the code it carried. */
  readonly calls: readonly FakeMatchDayCall[];
};

const OFFLINE = { ok: false, offline: true } as const;

/** A list of answers handed out in order, the last one standing; `none` when nothing was said. */
function sequence<T>(none: T): { say(answers: T[]): void; next(): T } {
  let held: T[] = [];
  return {
    say: (answers) => {
      held = [...answers];
    },
    next: () => (held.length > 1 ? (held.shift() as T) : (held[0] ?? none)),
  };
}

/**
 * The Match Day API on a laptop: the day and the open answer what the test says; review and approve are offline until
 * told otherwise.
 */
export function createFakeMatchDayPort(): FakeMatchDayPort {
  const days = sequence<PortAnswer<MatchDay>>({ ok: true, value: FAKE_DAY });
  let open: PortAnswer<OpenAnswer> = {
    ok: true,
    value: { kind: 'link', url: FAKE_OPEN_URL, sportKey: 'badminton' },
  };
  let gate: Promise<void> | null = null;
  let lift = (): void => undefined;
  let throwing = false;
  const reviews = sequence<PortAnswer<ApprovalReview>>(OFFLINE);
  const approves = sequence<PortAnswer<Approved>>(OFFLINE);
  const candidates = sequence<CallAnswer<Candidates>>(OFFLINE);
  const previews = sequence<CallAnswer<CallPreview>>(OFFLINE);
  const callAnswers = sequence<CallAnswer<Called>>(OFFLINE);
  const undos = sequence<CallAnswer<Uncalled>>(OFFLINE);
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
    day: (code) => answer({ op: 'day', code }, () => days.next()),
    open: (code, fixtureId) => answer({ op: 'open', code, fixtureId }, () => open),
    review: (code, kind, stageId) =>
      answer({ op: 'review', code, kind, stageId }, () => reviews.next()),
    approve: (code, kind, stageId, hash, round) =>
      answer({ op: 'approve', code, kind, stageId, hash, round }, () => approves.next()),
    candidates: (code, courtId) =>
      answer({ op: 'candidates', code, courtId }, () => candidates.next()),
    previewCall: (code, fixtureId, courtId) =>
      answer({ op: 'preview', code, fixtureId, courtId }, () => previews.next()),
    call: (code, fixtureId, courtId) =>
      answer({ op: 'call', code, fixtureId, courtId }, () => callAnswers.next()),
    undoCall: (code, fixtureId) => answer({ op: 'undo', code, fixtureId }, () => undos.next()),
    answerCandidates: (...answers) => candidates.say(answers),
    answerPreview: (...answers) => previews.say(answers),
    answerCall: (...answers) => callAnswers.say(answers),
    answerUndo: (...answers) => undos.say(answers),
    answerReview: (...answers) => reviews.say(answers),
    answerApprove: (...answers) => approves.say(answers),
    answerDay: (...answers) => days.say(answers),
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
