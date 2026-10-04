import { afterEach, describe, expect, it } from 'vitest';
import { describeEngineContract } from '../../../test/engineContract';
import { startHostEngine, type HostEngine } from '../../../test/hostEngine';
import { SERVER_END } from '../../../test/serverScript';
import type { LastEnd } from '@/domain/session/Pairing';
import { KIT_CODE_A } from './contract/engineScenarios';

// Every scenario, server words included: the host's ScriptedServer answers them (Task 21).
describeEngineContract('the bridge over the real Kotlin core (JVM host)', startHostEngine);

/**
 * The script's `endReason` for each last end, read back through the real core (LastEnd.of is
 * native's): a scenario that says one of them is then told the end native would report.
 */
describe('the server script, read back by the real core', () => {
  const ends = Object.keys(SERVER_END) as LastEnd[];
  let host: HostEngine | null = null;
  afterEach(async () => {
    await host?.dispose();
    host = null;
  });

  it('sweeps the 7 ends the server says', () => {
    expect(ends).toHaveLength(7);
  });

  it.each(ends)('an over the script says for %s ends the broadcast as that', async (lastEnd) => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    host.engine.send({ kind: 'start' });
    await host.settle!();
    const onAir = ['connecting', 'publishing'].includes(host.engine.getSnapshot().state.kind);
    await host.say({ word: 'over', lastEnd });
    await host.settle!();
    const { state, lastEnd: seen } = host.engine.getSnapshot();
    expect([onAir, state.kind, seen]).toEqual([true, 'paired', lastEnd]);
  });
});

/** The harness's own guards: a host that dies or hangs fails a scenario, never stalls the run. */
describe('the host harness', () => {
  let host: HostEngine | null = null;
  afterEach(async () => {
    await host?.dispose();
    host = null;
  });

  it("sets each of native's four readiness checks both ways, as the snapshot reads them (4 rows)", async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    const checks = ['camera', 'sound', 'network', 'held'] as const;
    const seen: string[] = [];
    for (const check of checks) {
      for (const value of [false, true]) {
        await host.ready({ [check]: value });
        seen.push(`${check}:${String(host.engine.getSnapshot().ready[check])}`);
      }
    }
    expect(seen).toEqual(checks.flatMap((check) => [`${check}:false`, `${check}:true`]));
  });

  it('hears a scripted refusal at the next operator start, not at once', async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    await host.say({ word: 'refused', refusal: 'no_credit' });
    await host.settle!();
    const before = host.engine.getSnapshot().refusal;
    host.engine.send({ kind: 'start' });
    await host.settle!();
    const { state, refusal } = host.engine.getSnapshot();
    expect([before, state.kind, refusal]).toEqual([null, 'paired', 'no_credit']);
  });

  it('rejects the settle with the exit when the host dies mid-scenario, not on a timeout', async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    process.kill(host.pid, 'SIGKILL');
    await expect(host.settle!()).rejects.toThrow(/^the host exited \(SIGKILL\)$/);
  });

  it('kills a host that ignores exit, within its 2 s', async () => {
    host = await startHostEngine();
    const { pid } = host;
    process.kill(pid, 'SIGSTOP');
    const at = Date.now();
    await host.dispose();
    host = null;
    expect(Date.now() - at).toBeLessThan(4_000);
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  });
});
