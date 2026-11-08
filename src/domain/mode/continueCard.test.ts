import { describe, expect, it } from 'vitest';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import { continueCard, dayHasEnded, matchDayCard } from '@/domain/mode/continueCard';
import type { MatchDay } from '@/domain/matchday/matchDay';
import type { EngineStatus } from '@/domain/mode/reopen';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_CODE, FIXTURE_TOKEN_TAG } from '../../../test/fixtures/wire';

const saved = savedStreamCode();
/** The fixture's own name, written out: its code, slot 1, and its token's pinned tag. */
const SAVED_NAME: CodeName = { code: FIXTURE_CODE, slot: 1, tokenTag: FIXTURE_TOKEN_TAG };
/** Another camera position of the same match: another code to the identity rules (C7). */
const OTHER_SLOT: CodeName = { ...SAVED_NAME, slot: 2 };

/** Amendment §2, Home: what the Continue card says, by the engine and the saved code. */
describe('continueCard', () => {
  it('says a paired code is paired, with the pairing’s label', () => {
    expect(
      continueCard({
        pairing: false,
        saved,
        engine: 'paired',
        held: SAVED_NAME,
        heldLabel: 'Seazn XI v Real CC',
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'paired', label: 'Seazn XI v Real CC' });
  });

  // While Pairing, native's label is not answered yet: the saved waiting fields name it.
  it.each([null, ''])('falls back to the saved waiting label when the pairing’s is %j', (label) => {
    expect(
      continueCard({
        pairing: false,
        saved,
        engine: 'paired',
        held: SAVED_NAME,
        heldLabel: label,
        validTill: null,
      }),
    ).toEqual({ kind: 'paired', label: 'Seazn XI v Fake CC' });
  });

  it('says a code with an expiry is saved, with its slot and the time', () => {
    expect(
      continueCard({
        pairing: false,
        saved,
        engine: 'idle',
        held: NO_NAME,
        heldLabel: null,
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40' });
  });

  // CD39 (A1): `exp` is optional, so the card says the slot alone.
  it('says a code with no expiry is saved, with its slot alone', () => {
    const noExp = savedStreamCode({ expiresAt: null, slot: 3 });
    expect(
      continueCard({
        pairing: false,
        saved: noExp,
        engine: 'idle',
        held: NO_NAME,
        heldLabel: null,
        validTill: null,
      }),
    ).toEqual({ kind: 'saved', slot: 3, validTill: null });
  });

  it('reads a pairing of another code as saved: the card is about the saved one', () => {
    expect(
      continueCard({
        pairing: false,
        saved,
        engine: 'paired',
        held: OTHER_SLOT,
        heldLabel: 'Seazn XI v Real CC',
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40' });
  });

  // Review C5 I-4: Pairing is not Paired. The card says Pairing until native has paired.
  it('says a pairing of the saved code is pairing, never paired', () => {
    expect(
      continueCard({
        pairing: true,
        saved,
        engine: 'paired',
        held: SAVED_NAME,
        heldLabel: 'Seazn XI v Real CC',
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'pairing' });
  });

  it('reads a pairing of another code as saved', () => {
    expect(
      continueCard({
        pairing: true,
        saved,
        engine: 'paired',
        held: OTHER_SLOT,
        heldLabel: null,
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40' });
  });

  /** Every engine status but paired reads as saved, even naming the saved code (PV12: counted). */
  const NOT_PAIRED: readonly EngineStatus[] = ['idle', 'live', 'stopped', 'failed'];
  it('sweeps the four statuses that are not paired', () => {
    expect(NOT_PAIRED).toHaveLength(4);
  });
  it.each(NOT_PAIRED)('reads %s on the saved code as saved', (engine) => {
    expect(
      continueCard({
        pairing: false,
        saved,
        engine,
        held: SAVED_NAME,
        heldLabel: 'X',
        validTill: '18:40',
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40' });
  });
});

/** A made-up day, in the shape `parseDay` hands on: a code scoped to one venue of SAFE Open. */
const DAY: MatchDay = {
  competition: { id: '2f0c8a51-6b8e-4d37-9a51-0c1e2d3f4a5b', name: 'SAFE Open' },
  scope: { kind: 'venue', label: 'Hall A' },
  day: '2026-11-07',
  tz: 'Europe/London',
  opensAt: new Date('2026-11-07T00:00:00.000Z'),
  expiresAt: new Date('2026-11-08T00:00:00.000Z'),
  canApprove: false,
  courts: [],
  noCourt: [],
  online: [],
  approvals: [],
};
const DURING = new Date('2026-11-07T10:42:00.000Z');

/** S4 design §4: "Match Day · {competition} · {scope}", from the day's last good copy. */
// S4 design §3: the code expires at the end of its day; the server answers MD_ENDED from that instant (the contract).
describe('dayHasEnded', () => {
  it('ends at its expiry, not a millisecond before', () => {
    const expiresAt = new Date('2026-11-08T00:00:00.000Z');
    expect(dayHasEnded({ expiresAt }, new Date('2026-11-07T23:59:59.999Z'))).toBe(false);
    expect(dayHasEnded({ expiresAt }, expiresAt)).toBe(true);
    expect(dayHasEnded({ expiresAt }, new Date('2026-11-09T00:00:00.000Z'))).toBe(true);
  });
});

describe('matchDayCard', () => {
  it('names the competition and the code’s scope', () => {
    expect(matchDayCard({ day: DAY }, DURING)).toEqual({
      kind: 'matchday',
      competition: 'SAFE Open',
      scope: 'Hall A',
    });
  });

  it.each(['venue', 'courts'] as const)('names a %s scope by its label', (kind) => {
    const day = { ...DAY, scope: { kind, label: 'Court 1, Court 2' } };
    expect(matchDayCard({ day }, DURING)).toEqual({
      kind: 'matchday',
      competition: 'SAFE Open',
      scope: 'Court 1, Court 2',
    });
  });

  // The contract: a whole-competition code's label is the competition's own name, so it is said once.
  it('names a whole-competition code by the competition alone', () => {
    const day = { ...DAY, scope: { kind: 'competition' as const, label: 'SAFE Open' } };
    expect(matchDayCard({ day }, DURING)).toEqual({
      kind: 'matchday',
      competition: 'SAFE Open',
      scope: null,
    });
  });

  // A code saved before its day opened has never been answered with a day: no names to say.
  it('is no card before there is a copy of the day', () => {
    expect(matchDayCard(null, DURING)).toBeNull();
  });

  // The contract: from expires_at the code answers MD_ENDED, so the tile says "Match Day ended" and forgets it.
  it('is no card from the day’s end, and a card a moment before it', () => {
    const end = DAY.expiresAt.getTime();
    expect(matchDayCard({ day: DAY }, new Date(end))).toBeNull();
    expect(matchDayCard({ day: DAY }, new Date(end + 60_000))).toBeNull();
    expect(matchDayCard({ day: DAY }, new Date(end - 1))).not.toBeNull();
  });
});
