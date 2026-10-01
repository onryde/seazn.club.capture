import { describe, expect, it } from 'vitest';
import { createHomeIntent } from '@/services/homeIntent';

describe('the scan-another hand-off (D24)', () => {
  it('has nothing to take at first', () => {
    expect(createHomeIntent().takeScan()).toBe(false);
  });

  it('is taken exactly once, however often it was asked', () => {
    const intent = createHomeIntent();
    intent.requestScan();
    intent.requestScan();
    expect(intent.takeScan()).toBe(true);
    expect(intent.takeScan()).toBe(false);
  });

  it('can be asked again once taken', () => {
    const intent = createHomeIntent();
    intent.requestScan();
    intent.takeScan();
    intent.requestScan();
    expect(intent.takeScan()).toBe(true);
  });
});
