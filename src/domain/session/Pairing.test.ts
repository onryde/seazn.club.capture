import { describe, expect, it } from 'vitest';
import { firstNotReady, NOT_READY_ORDER, type Readiness } from '@/domain/session/Pairing';

const READY: Readiness = { camera: true, sound: true, network: true, held: true };

/**
 * The amendment's _Readiness_ table (A11) lists camera, sound, network, held,
 * and native (Readiness.kt) reports the first that fails in that order. The
 * rows are copied from the amendment, never read from NOT_READY_ORDER.
 */
describe('the first readiness check that fails (A11)', () => {
  it('is none when every check passes', () => {
    expect(firstNotReady(READY)).toBeNull();
  });

  it('is the camera when every check fails', () => {
    expect(firstNotReady({ camera: false, sound: false, network: false, held: false })).toBe(
      'camera',
    );
  });

  it('is sound before held when both fail', () => {
    expect(firstNotReady({ ...READY, sound: false, held: false })).toBe('sound');
  });

  it('is network before held when both fail', () => {
    expect(firstNotReady({ ...READY, network: false, held: false })).toBe('network');
  });

  it('is held when only held fails', () => {
    expect(firstNotReady({ ...READY, held: false })).toBe('held');
  });

  it('orders the four as the amendment lists them', () => {
    expect(NOT_READY_ORDER).toEqual(['camera', 'sound', 'network', 'held']);
  });
});
