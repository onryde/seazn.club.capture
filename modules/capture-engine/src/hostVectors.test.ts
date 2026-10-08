import { describe, expect, it } from 'vitest';
import { httpsHost } from '@/domain/credentials/wire';
import { seaznHosts } from '@/services/seaznHosts';
import vectors from './wire/host-vectors.json';

const seazn = vectors.rows.filter((row) => row.role === 'seazn');

describe('one Seazn-host rule in two languages', () => {
  // The Seazn rows only, so a truncated file or a mislabelled role cannot pass by sweeping nothing (PV12).
  it('sweeps all 15 Seazn rows', () => {
    expect(seazn).toHaveLength(15);
  });

  it.each(seazn.map((row) => [row.url, row.env, row.ok] as const))(
    '%s on %s is %s, as Hosts.kt says',
    (url, env, ok) => {
      expect(httpsHost(url) === seaznHosts(env)[0]).toBe(ok);
    },
  );
});
