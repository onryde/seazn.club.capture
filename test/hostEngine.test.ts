import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOST_BINARY, startHostEngine } from './hostEngine';

// The harness guards that need no JVM, so the domain project runs them on every push.
describe('the host harness, without a host', () => {
  it('says how to build the host when its binary is missing', async () => {
    await expect(startHostEngine(`${HOST_BINARY}-missing`)).rejects.toThrow(
      'build the host first: (cd modules/capture-engine/android/core && ./gradlew :host:installDist)',
    );
  });

  // Review C4c M-3: a host that says ready and then never acks the start-up readiness is a JVM left
  // running unless the start-up lets it go. This one ignores its stdin, so only the kill ends it.
  it('lets go of a host that never acks its start-up readiness: the start rejects and the process is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-mute-'));
    const pidFile = join(dir, 'pid');
    const binary = join(dir, 'host');
    writeFileSync(
      binary,
      [
        '#!/bin/sh',
        `echo $$ > '${pidFile}'`,
        `printf '%s\\n' '{"ev":"ready","current":null,"tail":[]}'`,
        'exec sleep 30',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    let pid: number | null = null;
    try {
      await expect(startHostEngine(binary)).rejects.toThrow(
        'no ack for seq 1 in 5000 ms (readiness)',
      );
      pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/);
    } finally {
      if (pid !== null) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone, as it should be.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
