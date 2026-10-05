import { describe, expect, it } from 'vitest';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import { continueCard } from '@/domain/mode/continueCard';
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
