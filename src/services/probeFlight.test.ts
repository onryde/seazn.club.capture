import { describe, expect, it } from 'vitest';
import { createProbeFlight } from '@/services/probeFlight';

describe('the probe flight', () => {
  it('is down until a run begins, up through it, and down again once it ends', () => {
    const flight = createProbeFlight();
    expect(flight.active()).toBe(false);
    flight.begin();
    expect(flight.active()).toBe(true);
    flight.end();
    expect(flight.active()).toBe(false);
  });

  it('flies again for a second run', () => {
    const flight = createProbeFlight();
    flight.begin();
    flight.end();
    flight.begin();
    expect(flight.active()).toBe(true);
  });

  it('is its own flag in each set of ports', () => {
    const first = createProbeFlight();
    first.begin();
    expect(createProbeFlight().active()).toBe(false);
  });
});
