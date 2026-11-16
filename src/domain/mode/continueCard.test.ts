import { describe, expect, it } from 'vitest';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import { continueCard, dayHasEnded } from '@/domain/mode/continueCard';
import type { EngineStatus } from '@/domain/mode/reopen';
import { savedCourtCode, savedStreamCode } from '../../../test/fixtures/savedStream';
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'paired', label: 'Seazn XI v Real CC', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'paired', label: 'Seazn XI v Fake CC', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'saved', slot: 3, validTill: null, court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'pairing', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40', court: null });
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
        heldCourt: null,
      }),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40', court: null });
  });
});

// Court stream (spec 2026-11-14 §6.5): a court code's card names the court. The held court counts only when the engine
// holds THIS saved code; a cold start, with the engine Idle, reads the court from the saved waiting fields.
describe('continueCard on a court code', () => {
  const court = savedCourtCode('Court 2');
  const input = (change: Partial<Parameters<typeof continueCard>[0]>) => ({
    pairing: false,
    saved: court,
    engine: 'idle' as EngineStatus,
    held: NO_NAME,
    heldLabel: null,
    heldCourt: null,
    validTill: '18:40',
    ...change,
  });

  it('names the court from the saved waiting fields when the engine is Idle (a cold start)', () => {
    expect(continueCard(input({}))).toEqual({
      kind: 'saved',
      slot: 1,
      validTill: '18:40',
      court: 'Court 2',
    });
  });

  it('names the court the engine holds when it is paired to this code', () => {
    expect(
      continueCard(
        input({ engine: 'paired', held: SAVED_NAME, heldLabel: 'A v B', heldCourt: 'Court 3' }),
      ),
    ).toEqual({ kind: 'paired', label: 'A v B', court: 'Court 3' });
  });

  it('falls back to the saved court when the held pairing has none yet', () => {
    expect(
      continueCard(input({ engine: 'paired', held: SAVED_NAME, heldCourt: null })),
    ).toMatchObject({
      kind: 'paired',
      court: 'Court 2',
    });
  });

  it('names the court while pairing', () => {
    expect(
      continueCard(
        input({ pairing: true, engine: 'paired', held: SAVED_NAME, heldCourt: 'Court 2' }),
      ),
    ).toEqual({ kind: 'pairing', court: 'Court 2' });
  });

  // An empty input: a saved code with no waiting fields has no court to name.
  it('has no court for a saved code with no waiting fields', () => {
    expect(continueCard(input({ saved: { ...court, stream: null } }))).toMatchObject({
      court: null,
    });
  });

  // Four questions (4): another code's court never titles this card.
  it('another code’s court never titles this card', () => {
    expect(
      continueCard(
        input({ saved, engine: 'paired', held: OTHER_SLOT, heldLabel: 'X', heldCourt: 'Court 5' }),
      ),
    ).toEqual({ kind: 'saved', slot: 1, validTill: '18:40', court: null });
  });

  it('is a fixture code’s card, unchanged', () => {
    expect(
      continueCard(
        input({ saved, engine: 'paired', held: SAVED_NAME, heldLabel: 'A v B', heldCourt: null }),
      ),
    ).toEqual({ kind: 'paired', label: 'A v B', court: null });
  });
});

// S4 design §3: the code expires at the end of its day; the server answers MD_ENDED from that instant (the contract).
describe('dayHasEnded', () => {
  it('ends at its expiry, not a millisecond before', () => {
    const expiresAt = new Date('2026-11-08T00:00:00.000Z');
    expect(dayHasEnded({ expiresAt }, new Date('2026-11-07T23:59:59.999Z'))).toBe(false);
    expect(dayHasEnded({ expiresAt }, expiresAt)).toBe(true);
    expect(dayHasEnded({ expiresAt }, new Date('2026-11-09T00:00:00.000Z'))).toBe(true);
  });
});
