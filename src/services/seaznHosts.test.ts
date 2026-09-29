import { describe, expect, it } from 'vitest';
import { seaznHosts } from '@/services/seaznHosts';

describe('seaznHosts', () => {
  it('uses production only when the build says production', () => {
    expect(seaznHosts('production')).toEqual(['seazn.club']);
  });

  it.each([undefined, '', 'staging', 'PRODUCTION '])('uses staging for %j', (env) => {
    expect(seaznHosts(env)).toEqual(['stg.seazn.club']);
  });
});
