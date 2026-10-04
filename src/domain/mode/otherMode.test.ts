import { describe, expect, it } from 'vitest';
import type { Mode } from '@/domain/mode/Mode';
import { asksBeforeOpening } from '@/domain/mode/otherMode';
import type { EngineStatus } from '@/domain/mode/reopen';

/**
 * A7: another mode while paired asks first. Live, Home is hidden (other modes
 * stay blocked as today); idle or ended, nothing is held. Written out.
 */
const ROWS: readonly (readonly [Mode, EngineStatus, boolean])[] = [
  ['scoring', 'idle', false],
  ['scoring', 'paired', true],
  ['scoring', 'live', false],
  ['scoring', 'stopped', false],
  ['scoring', 'failed', false],
  ['dashboard', 'idle', false],
  ['dashboard', 'paired', true],
  ['dashboard', 'live', false],
  ['dashboard', 'stopped', false],
  ['dashboard', 'failed', false],
  // A stream code while paired is the identity rules' (scanStep), never this sheet.
  ['stream', 'paired', false],
];

describe('asksBeforeOpening (A7)', () => {
  it('checks eleven rows (PV12: zero is a failure)', () => {
    expect(ROWS).toHaveLength(11);
  });

  it.each(ROWS)('opening %s while %s asks first: %s', (mode, engine, asks) => {
    expect(asksBeforeOpening(mode, engine)).toBe(asks);
  });
});
