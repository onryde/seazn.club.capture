import { describe, expect, it } from 'vitest';
import { seaznEnvironment, seaznHosts, seaznOrigin } from '@/services/seaznHosts';

describe('seaznHosts', () => {
  it('uses production only when the build says production', () => {
    expect(seaznHosts('production')).toEqual(['seazn.club']);
  });

  it.each([undefined, '', 'staging', 'PRODUCTION '])('uses staging for %j', (env) => {
    expect(seaznHosts(env)).toEqual(['stg.seazn.club']);
  });
});

describe('seaznOrigin', () => {
  it('asks staging for codes unless explicitly production', () => {
    expect(seaznOrigin(undefined)).toBe('https://stg.seazn.club');
    expect(seaznOrigin('production')).toBe('https://seazn.club');
  });

  it.each(['', 'staging', 'PRODUCTION '])('asks staging for %j', (env) => {
    expect(seaznOrigin(env)).toBe('https://stg.seazn.club');
  });
});

describe('seaznEnvironment (CD36)', () => {
  it('names production only when the build says production', () => {
    expect(seaznEnvironment('production')).toBe('production');
  });

  it.each([undefined, '', 'staging', 'PRODUCTION '])('names staging for %j', (env) => {
    expect(seaznEnvironment(env)).toBe('staging');
  });
});
