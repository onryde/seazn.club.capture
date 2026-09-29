import { describe, expect, it } from 'vitest';
import { createScanFlight } from '@/services/scanFlight';

describe('scanFlight', () => {
  it('is down until a scan begins, and down again once it ends', () => {
    const flight = createScanFlight();
    expect(flight.active()).toBe(false);
    expect(flight.begin()).toBe(true);
    expect(flight.active()).toBe(true);
    flight.end();
    expect(flight.active()).toBe(false);
  });

  it('refuses a second scan while one is in flight, and takes the next after it ends', () => {
    const flight = createScanFlight();
    flight.begin();
    expect(flight.begin()).toBe(false);
    expect(flight.active()).toBe(true);
    flight.end();
    expect(flight.begin()).toBe(true);
  });
});
