import { afterEach, describe, expect, it } from 'vitest';
import { describeEngineContract } from '../../../test/engineContract';
import { startHostEngine, type HostEngine } from '../../../test/hostEngine';
import { SERVER_END } from '../../../test/serverScript';
import type { LastEnd } from '@/domain/session/Pairing';
import { KIT_CODE_A } from './contract/engineScenarios';

// Every scenario, server words included: the host's ScriptedServer answers them (Task 21).
describeEngineContract('the bridge over the real Kotlin core (JVM host)', startHostEngine);

/**
 * Review C4c I-2: the kit's on-air set holds `connecting`, so a platform that never connects passes
 * it. On the host, the connect lands 100 ms after the start and frames advance every 500 ms, so a
 * started broadcast reads publishing well within 3 s: one that never does is not on air.
 */
const PUBLISHING_MS = 3_000;
const publishes = (host: HostEngine) =>
  expect
    .poll(() => host.engine.getSnapshot().state.kind, { timeout: PUBLISHING_MS, interval: 50 })
    .toBe('publishing');

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
    await publishes(host);
    await host.say({ word: 'over', lastEnd });
    await host.settle!();
    const { state, lastEnd: seen } = host.engine.getSnapshot();
    expect([state.kind, seen]).toEqual(['paired', lastEnd]);
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

  it('I-2 a start settles on air, and reads publishing within 3 s', async () => {
    const started = await startHostEngine();
    host = started;
    started.engine.send(KIT_CODE_A);
    await started.settle!();
    started.engine.send({ kind: 'start' });
    await started.settle!();
    expect(['connecting', 'publishing']).toContain(started.engine.getSnapshot().state.kind);
    await publishes(started);
  });

  // Review C4c I-1: native publishes an input's own field changes with it, state or not.
  it("I-1 reads the pair's readiness and pairing once it settles, with no tick to wait for", async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    const { state, ready, pairing } = host.engine.getSnapshot();
    expect([state.kind, ready, pairing?.code]).toEqual([
      'paired',
      { camera: true, sound: true, network: true, held: true },
      KIT_CODE_A.code,
    ]);
  });

  it("I-1 reads setAutomatic(false) at the intent's own ack, though the state stays paired", async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    const before = host.engine.getSnapshot().pairing?.automatic;
    host.engine.send({ kind: 'setAutomatic', on: false });
    await host.engine.settled();
    const { state, pairing } = host.engine.getSnapshot();
    expect([before, state.kind, pairing?.automatic]).toEqual([true, 'paired', false]);
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
