import { describe, expect, it } from 'vitest';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import { scanStep, type ScanStep } from '@/domain/mode/identity';
import type { EngineStatus } from '@/domain/mode/reopen';

const A1: CodeName = { code: 'a', slot: 1, tokenTag: 't1' };
const NAMES = {
  none: NO_NAME,
  A1,
  /** Another camera position of the same code (C7). */
  A2: { ...A1, slot: 2 },
  /** A1 re-issued: the same code and slot, a new token (N2). */
  A1r: { ...A1, tokenTag: 't2' },
  B1: { ...A1, code: 'b' },
} as const satisfies Record<string, CodeName>;
type Name = keyof typeof NAMES;

/**
 * The amendment's _Identity rules in JS_, the first two rows, written out from
 * its table, never read from the function: a scan or Continue adopts the same
 * code while paired, pairs anything else (native unpairs first), resets an
 * ended engine first, and never touches a broadcast.
 */
describe('what a scan or Continue does with the engine it finds', () => {
  it.each<[EngineStatus, Name, Name, ScanStep]>([
    ['idle', 'none', 'A1', 'pair'],
    ['idle', 'B1', 'A1', 'pair'],
    ['paired', 'A1', 'A1', 'adopt'],
    ['paired', 'A1', 'A2', 'pair'],
    ['paired', 'A1', 'A1r', 'pair'],
    ['paired', 'B1', 'A1', 'pair'],
    // A pairing native cannot name, or a code the phone cannot, is never adopted.
    ['paired', 'none', 'A1', 'pair'],
    ['paired', 'none', 'none', 'pair'],
    ['stopped', 'A1', 'A1', 'resetThenPair'],
    ['stopped', 'B1', 'A1', 'resetThenPair'],
    ['failed', 'A1', 'A1', 'resetThenPair'],
    ['failed', 'none', 'A1', 'resetThenPair'],
    ['live', 'A1', 'A1', 'none'],
    ['live', 'B1', 'A1', 'none'],
  ])('%s, engine holding %s, code %s → %s', (engine, held, code, expected) => {
    expect(scanStep({ engine, held: NAMES[held], code: NAMES[code], clearing: false })).toBe(
      expected,
    );
  });

  // C4b-N1: an unpair or reset JS sent that native has not answered yet. The
  // snapshot still shows the old pairing, which is about to go: the same code
  // is not adoptable, so it is paired again, after the unpair (native applies
  // intents in order). Every other row is as without one.
  it.each<[EngineStatus, Name, Name, ScanStep]>([
    ['paired', 'A1', 'A1', 'pair'],
    ['paired', 'B1', 'A1', 'pair'],
    ['idle', 'none', 'A1', 'pair'],
    ['stopped', 'A1', 'A1', 'resetThenPair'],
    ['failed', 'A1', 'A1', 'resetThenPair'],
    ['live', 'A1', 'A1', 'none'],
  ])('%s, engine holding %s, code %s, while clearing → %s', (engine, held, code, expected) => {
    expect(scanStep({ engine, held: NAMES[held], code: NAMES[code], clearing: true })).toBe(
      expected,
    );
  });
});
