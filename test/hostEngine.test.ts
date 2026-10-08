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

  /**
   * A stub host on node (its shebang is this very node): ready, an ack for each readiness op by its seq, and for the
   * scoring link whatever [behaviour] says. It writes its pid to [pidFile], so a test can see the process is gone.
   */
  function stubHost(dir: string, behaviour: 'reverse' | 'silent', pidFile: string): string {
    const binary = join(dir, 'host');
    writeFileSync(
      binary,
      [
        `#!${process.execPath}`,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        `const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');`,
        `out({ ev: 'ready', current: null, tail: [] });`,
        `let held = null;`,
        `require('node:readline').createInterface({ input: process.stdin }).on('line', (text) => {`,
        `  const op = JSON.parse(text);`,
        `  if (op.op === 'readiness' || op.op === 'quiet') out({ ev: 'ack', seq: op.seq });`,
        `  if (op.op === 'exit') process.exit(0);`,
        // A script op is echoed as a request event, so the harness's own write can be read back.
        `  if (op.op === 'script') out({ ev: 'request', path: op.path, body: op });`,
        `  if (op.op === 'scoringLink' && ${JSON.stringify(behaviour)} === 'reverse') {`,
        `    const answer = (call) => out({ ev: 'scoringLink', call, answer: { outcome: 'replaced', call } });`,
        // The first call is held; the second is answered before it.
        `    if (held === null) held = op.call;`,
        `    else { answer(op.call); answer(held); held = null; }`,
        `  }`,
        `});`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    return binary;
  }

  it('resolves each scoring-link call to the answer that names it, whatever order the host answers in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-reverse-'));
    const pidFile = join(dir, 'pid');
    const host = await startHostEngine(stubHost(dir, 'reverse', pidFile));
    try {
      const answers = await Promise.all([host.scoringLink(), host.scoringLink()]);
      // The host answered call 2 first: each promise still has its own call's answer, not the arrival order's.
      expect(answers).toEqual([
        { outcome: 'replaced', call: 1 },
        { outcome: 'replaced', call: 2 },
      ]);
    } finally {
      await host.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('writes a script op with no seq, so the host does not wait for its path’s next answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-script-'));
    const host = await startHostEngine(stubHost(dir, 'silent', join(dir, 'pid')));
    try {
      host.script('scoring-link', 409, { code: 'replaced', message: 'm' });
      await expect.poll(() => host.requests.length, { timeout: 3_000 }).toBe(1);
      expect(host.requests[0]).toEqual({
        path: 'scoring-link',
        body: {
          op: 'script',
          path: 'scoring-link',
          status: 409,
          body: { code: 'replaced', message: 'm' },
        },
      });
    } finally {
      await host.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('rejects a scoring-link call the host never answers, within its budget, and the process is gone after dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-silent-'));
    const pidFile = join(dir, 'pid');
    const host = await startHostEngine(stubHost(dir, 'silent', pidFile));
    let pid: number | null = null;
    try {
      pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(pid).toBeGreaterThan(0);
      await expect(host.scoringLink()).rejects.toThrow('no scoring-link answer');
    } finally {
      await host.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
    expect(() => process.kill(pid as number, 0)).toThrow(/ESRCH/);
  }, 15_000);
});
