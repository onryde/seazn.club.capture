import { tokenTag } from '@/domain/credentials/tokenTag';
import type { Readiness } from '@/domain/session/Pairing';
import type { EngineIntent, EngineSnapshot, PairIntent } from '../CaptureEnginePort';
import type { ServerSays } from './serverSays';

/** How a scenario drives an engine: the port's own intents, the server's words, native's readiness. */
export type ScenarioKit = {
  send(intent: EngineIntent): Promise<void>;
  /** Sends every intent before waiting once: what a fast double tap or a scan racing a Stop does (PV33). */
  sendTogether(intents: readonly EngineIntent[]): Promise<void>;
  say(words: ServerSays): Promise<void>;
  /**
   * Sets native's readiness and resolves once the engine has judged it. An
   * engine with a sound meter (the JVM host, Task 27) resolves only after the
   * readiness record line that names the change, or after two meter periods:
   * never on its scheduler having nothing due, since the meter applies a level
   * 300–800 ms later and the sound debounce needs two readings (review C4a N-3).
   */
  ready(ready: Partial<Readiness>): Promise<void>;
  snapshot(): EngineSnapshot;
};

export type Scenario = {
  readonly name: string;
  /** Needs the server's words: run on the fake and the JVM host, and on a phone only with Task 34's scripted server. */
  readonly needsServer: boolean;
  run(kit: ScenarioKit): Promise<void>;
};

const ORIGIN = 'https://stg.seazn.club';

/** Schema-valid made-up codes (capture-qr.v2), with the D3 URLs a scan builds for them. */
const pairIntent = (code: string, slot: number, token: string): PairIntent => {
  const codeUrl = `${ORIGIN}/api/v1/capture/codes/${code}`;
  return {
    kind: 'pair',
    code,
    slot,
    token,
    codeUrl,
    heartbeatUrl: `${codeUrl}/beats`,
    startUrl: `${codeUrl}/start`,
    venueTimezone: 'Europe/London',
    language: 'en',
    automatic: true,
    claim: 'new',
    environment: 'staging',
  };
};

/** Two made-up codes: A pairs first, B is another code on another slot. */
export const KIT_CODE_A = pairIntent('ka0000000001', 1, 'tok-kit-a-000000000000');
export const KIT_CODE_B = pairIntent('kb0000000002', 2, 'tok-kit-b-000000000000');

const ON_AIR: ReadonlySet<string> = new Set([
  'connecting',
  'publishing',
  'degraded',
  'reconnecting',
]);

const nameOf = (intent: PairIntent) => ({
  code: intent.code,
  slot: intent.slot,
  tokenTag: tokenTag(intent.token),
});

const named = (snapshot: EngineSnapshot) =>
  snapshot.pairing === null
    ? null
    : {
        code: snapshot.pairing.code,
        slot: snapshot.pairing.slot,
        tokenTag: snapshot.pairing.tokenTag,
      };

/** JSON with every object's keys sorted, so the bridge's key order cannot fail a scenario. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** Throws with what was seen. Names and kinds only: a token is never in a message. */
function same(seen: unknown, wanted: unknown, what: string): void {
  if (canonical(seen) !== canonical(wanted)) {
    throw new Error(`${what}: saw ${canonical(seen)}, wanted ${canonical(wanted)}`);
  }
}

function onAir(kit: ScenarioKit, what: string): void {
  const { kind } = kit.snapshot().state;
  if (!ON_AIR.has(kind)) throw new Error(`${what}: saw ${kind}, wanted a broadcast on air`);
}

const kind = (kit: ScenarioKit) => kit.snapshot().state.kind;

/**
 * The engine contract after the stable code (amendment, The engine port and
 * plan B's core): what JS may rely on from any `CaptureEnginePort`. It drives
 * the engine through the port's own intents, the server's words and native's
 * readiness, and reads only `snapshot()`: never a fake's test hooks.
 */
export const ENGINE_SCENARIOS: readonly Scenario[] = [
  {
    name: 'pairs from idle, named by code, slot and token tag; a second pair for it changes nothing',
    needsServer: false,
    run: async (kit) => {
      same(kind(kit), 'idle', 'before');
      await kit.send(KIT_CODE_A);
      same(kind(kit), 'paired', 'after pair');
      same(named(kit.snapshot()), nameOf(KIT_CODE_A), 'the name');
      await kit.send(KIT_CODE_A);
      same(kind(kit), 'paired', 'after a second pair');
      same(named(kit.snapshot()), nameOf(KIT_CODE_A), 'the name, kept');
    },
  },
  {
    name: 'pairs another code over a pairing, and holds the new name',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send(KIT_CODE_B);
      same(kind(kit), 'paired', 'after the second code');
      same(named(kit.snapshot()), nameOf(KIT_CODE_B), 'the new name');
    },
  },
  {
    name: "goes on air from paired on the operator's start; a start from idle does nothing",
    needsServer: false,
    run: async (kit) => {
      await kit.send({ kind: 'start' });
      same(kind(kit), 'idle', 'a start from idle');
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'start' });
      onAir(kit, 'after start');
      same(kit.snapshot().broadcast?.cause, 'operator', 'the cause');
    },
  },
  {
    name: "goes on air on the organiser's Go live, with no intent",
    needsServer: true,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.say({ word: 'go-live', cause: 'organiser' });
      onAir(kit, 'after go-live');
      same(kit.snapshot().broadcast?.cause, 'organiser', 'the cause');
    },
  },
  {
    name: 'holds a Go live in armed until the phone is ready, then goes on air',
    needsServer: true,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.ready({ held: false });
      await kit.say({ word: 'go-live', cause: 'automatic' });
      same(
        kit.snapshot().state,
        { kind: 'armed', cause: 'automatic', notReady: 'held' },
        'not held',
      );
      await kit.ready({ held: true });
      onAir(kit, 'once held');
      same(kit.snapshot().broadcast?.cause, 'automatic', 'the cause');
    },
  },
  {
    name: 'stops a broadcast operator-stopped, still naming the pairing; a stop while paired does nothing',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'stop' });
      same(kind(kit), 'paired', 'a stop while paired');
      await kit.send({ kind: 'start' });
      await kit.send({ kind: 'stop' });
      const { state } = kit.snapshot();
      same(state.kind === 'ended' ? state.reason : state.kind, 'operator-stopped', 'ended');
      same(named(kit.snapshot()), nameOf(KIT_CODE_A), 'still named');
    },
  },
  {
    name: 'unpairs from paired to idle, naming nothing; an unpair while a broadcast is held does nothing',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'start' });
      await kit.send({ kind: 'unpair' });
      onAir(kit, 'an unpair on air');
      await kit.send({ kind: 'stop' });
      await kit.send({ kind: 'reset' });
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'unpair' });
      same(kind(kit), 'idle', 'after unpair');
      same(named(kit.snapshot()), null, 'no name');
      same(kit.snapshot().unpaired, null, 'an unpair the operator asked for says no reason');
    },
  },
  {
    name: 'takeover: a replaced answer unpairs to idle, naming the code and the reason',
    needsServer: true,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.say({ word: 'replaced' });
      same(kind(kit), 'idle', 'after replaced');
      same(kit.snapshot().unpaired, { reason: 'replaced', ...nameOf(KIT_CODE_A) }, 'unpaired');
    },
  },
  {
    name: 'rejoin: a live answer while paired goes on air, caused by the rejoin',
    needsServer: true,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.say({ word: 'live' });
      onAir(kit, 'after live');
      same(kit.snapshot().broadcast?.cause, 'rejoin', 'the cause');
    },
  },
  {
    name: "an organiser's stop returns to paired with its last end, and Ended is never shown",
    needsServer: true,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.say({ word: 'go-live', cause: 'organiser' });
      await kit.say({ word: 'over', lastEnd: 'stopped-by-organiser' });
      same(kind(kit), 'paired', 'after over');
      same(kit.snapshot().lastEnd, 'stopped-by-organiser', 'the last end');
      same(kit.snapshot().broadcast, null, 'no broadcast');
    },
  },
  {
    name: 'resets only from ended; a pair in ended is ignored; reset then pair pairs',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'reset' });
      same(kind(kit), 'paired', 'a reset while paired');
      await kit.send({ kind: 'start' });
      await kit.send({ kind: 'stop' });
      await kit.send(KIT_CODE_B);
      same(kind(kit), 'ended', 'a pair in ended');
      await kit.send({ kind: 'reset' });
      same([kind(kit), named(kit.snapshot())], ['idle', null], 'after reset');
      await kit.send(KIT_CODE_B);
      same(named(kit.snapshot()), nameOf(KIT_CODE_B), 'paired again');
    },
  },
  {
    name: 'carry 27: a stop is answered — the broadcast is ended once the engine has settled',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'start' });
      await kit.send({ kind: 'stop' });
      same(kind(kit), 'ended', 'stop answered within one settle');
    },
  },
  {
    // Review C4c M-1: the first half cannot see order (a pair for B is ignored while A is held, before
    // the stop or after it), so only the reset then the pair is named as taken in order.
    name: 'carry 28: a pair sent with a stop is ignored while A is held, and the stop ends A; a reset then a pair are taken in order',
    needsServer: false,
    run: async (kit) => {
      await kit.send(KIT_CODE_A);
      await kit.send({ kind: 'start' });
      await kit.sendTogether([{ kind: 'stop' }, KIT_CODE_B]);
      same(kind(kit), 'ended', 'the stop ended the broadcast');
      same(named(kit.snapshot()), nameOf(KIT_CODE_A), 'still A, named');
      await kit.sendTogether([{ kind: 'reset' }, KIT_CODE_B]);
      same(
        [kind(kit), named(kit.snapshot())],
        ['paired', nameOf(KIT_CODE_B)],
        'reset then pair, in order (Identity rules)',
      );
    },
  },
];
