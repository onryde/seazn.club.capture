import { afterEach, describe, expect, it } from 'vitest';
import { describeEngineContract } from '../../../test/engineContract';
import { startHostEngine, type HostEngine } from '../../../test/hostEngine';
import { SERVER_END } from '../../../test/serverScript';
import type { LastEnd, Readiness } from '@/domain/session/Pairing';
import { createScoringLinkPort, scoringSecret } from '@/services/scoringLinkPort';
import { KIT_CODE_A } from './contract/engineScenarios';
import { toEngineSnapshot } from './snapshotWire';
import { UNREPORTED } from './unreported';
import serverBodies from './wire/server-bodies.json';
import { vectorWire } from './wire/vectorWire';

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

/** The host's own link, from the contract-checked vector the host answers with (never typed here). */
const HOST_LINK = (() => {
  const url = serverBodies.bodies.find((body) => body.name === 'host/scoring-link-ok')?.body.url;
  if (typeof url !== 'string') throw new Error('host/scoring-link-ok names no url');
  return url;
})();

describe('the scoring link over the real Kotlin core (JVM host)', () => {
  let host: HostEngine | null = null;
  afterEach(async () => {
    await host?.dispose();
    host = null;
  });
  const paired = async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    return host;
  };

  it('resolves the link to the caller that asked, as the module would', async () => {
    const h = await paired();
    expect(scoringSecret(HOST_LINK)).toHaveLength(46);
    await expect(h.scoringLink()).resolves.toEqual({ outcome: 'ok', url: HOST_LINK });
  });

  it('the real port over the real core: ok, the secret protected, and in no record line, snapshot or request', async () => {
    const h = await paired();
    const protectedSecrets: string[] = [];
    const port = createScoringLinkPort(() => h.scoringLink(), {
      protect: (secret) => protectedSecrets.push(secret),
      host: 'stg.seazn.club',
    });
    await expect(port.request()).resolves.toEqual({ kind: 'ok', url: HOST_LINK });
    await h.settle!();
    const secret = scoringSecret(HOST_LINK);
    expect(protectedSecrets).toEqual([secret]);
    expect(h.record.join('\n')).not.toContain(secret);
    expect(JSON.stringify(h.engine.getSnapshot())).not.toContain(secret);
    expect(JSON.stringify(h.requests)).not.toContain(secret);
    // Anti-vacuity: there were lines, and the tap reached the server.
    expect(h.record.length).toBeGreaterThan(0);
    expect(h.requests.some((request) => request.path === 'scoring-link')).toBe(true);
  });

  it('a refusal then a success (the sequence)', async () => {
    const h = await paired();
    h.script('scoring-link', 409, { code: 'replaced', message: 'm' });
    const refused = await h.scoringLink();
    expect(refused).toStrictEqual({ outcome: 'replaced' });
    h.script('scoring-link', 200, { url: HOST_LINK });
    await expect(h.scoringLink()).resolves.toEqual({ outcome: 'ok', url: HOST_LINK });
  });

  it('a 429 with no Retry-After header is rate_limited with no retryAfterS', async () => {
    const h = await paired();
    h.script('scoring-link', 429, { code: 'rate_limited', message: 'm' });
    const answer = await h.scoringLink();
    expect(answer).toStrictEqual({ outcome: 'rate_limited' });
    expect(answer).not.toHaveProperty('retryAfterS');
  });

  it('with no pairing: unavailable, and no request is sent', async () => {
    host = await startHostEngine();
    await expect(host.scoringLink()).resolves.toStrictEqual({ outcome: 'unavailable' });
    expect(host.requests.some((request) => request.path === 'scoring-link')).toBe(false);
  });

  it('two calls in flight each resolve their own', async () => {
    const h = await paired();
    const answers = await Promise.all([h.scoringLink(), h.scoringLink()]);
    expect(answers).toEqual([
      { outcome: 'ok', url: HOST_LINK },
      { outcome: 'ok', url: HOST_LINK },
    ]);
    expect(h.requests.filter((request) => request.path === 'scoring-link')).toHaveLength(2);
  });
});

/** The harness's own guards: a host that dies or hangs fails a scenario, never stalls the run. */
describe('the host harness', () => {
  let host: HostEngine | null = null;
  afterEach(async () => {
    await host?.dispose();
    host = null;
  });

  // Review C4c M-7: a row per check, each on its own host, so no row holds most of the 30 s budget.
  // Review C4c round 1, minor 5: the rows are the engine's own ready keys, never a list typed here,
  // and they are the keys the snapshot wire reads from native's idle vector, with at least one.
  const checks = Object.keys(UNREPORTED.ready) as (keyof Readiness)[];
  it('sweeps every readiness check the engine reads from native', () => {
    const read = toEngineSnapshot(vectorWire('idle'))?.ready;
    expect(checks.length).toBeGreaterThan(0);
    expect(checks).toEqual(Object.keys(read ?? {}));
  });

  it.each(checks)('sets the %s check both ways, as the snapshot reads it', async (check) => {
    const started = await startHostEngine();
    host = started;
    started.engine.send(KIT_CODE_A);
    await started.settle!();
    const seen: boolean[] = [];
    for (const value of [false, true]) {
      await started.ready({ [check]: value });
      seen.push(started.engine.getSnapshot().ready[check]);
    }
    expect(seen).toEqual([false, true]);
  });

  // Review C4c M-4 and the gap hunt's CD7: a JS entry crosses to native's record and comes back.
  it("CD7 a JS entry forwarded to native's record comes back as its line, and the claim beat carried the pair", async () => {
    const started = await startHostEngine();
    host = started;
    started.engine.send(KIT_CODE_A);
    await started.settle!();
    expect(started.requests.find((request) => request.path === 'beat')?.body).toMatchObject({
      code: KIT_CODE_A.code,
      slot: KIT_CODE_A.slot,
      claim: 'new',
    });
    started.engine.forward({ level: 'warn', event: 'intent.stop', fields: { count: 3 } });
    await expect
      .poll(
        () =>
          started.record
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .find((line) => line.kind === 'intent.stop'),
        { timeout: 3_000, interval: 50 },
      )
      .toMatchObject({ kind: 'intent.stop', level: 'warn', count: 3 });
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
