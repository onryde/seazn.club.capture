import { describe, expect, it } from 'vitest';
import { descriptorOrigin, seaznHosts } from '@/services/seaznHosts';

describe('seaznHosts', () => {
  it('uses production only when the build says production', () => {
    expect(seaznHosts('production')).toEqual(['seazn.club']);
  });

  it.each([undefined, '', 'staging', 'PRODUCTION '])('uses staging for %j', (env) => {
    expect(seaznHosts(env)).toEqual(['stg.seazn.club']);
  });
});

describe('descriptorOrigin', () => {
  it('asks staging for descriptors unless explicitly production', () => {
    expect(descriptorOrigin(undefined)).toBe('https://stg.seazn.club');
    expect(descriptorOrigin('production')).toBe('https://seazn.club');
  });

  it.each(['', 'staging', 'PRODUCTION '])('asks staging for %j', (env) => {
    expect(descriptorOrigin(env)).toBe('https://stg.seazn.club');
  });
});
