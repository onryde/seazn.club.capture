import { describe, expect, it } from 'vitest';
import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import { decodeSavedCode, encodeSavedCode } from '@/domain/mode/savedCode';
import type { Claim } from '@/engine/CaptureEnginePort';
import { intentWire } from '@/engine/intentWire';
import vectors from '@/engine/wire/pair-intent-vectors.json';
import { pairIntentFor } from '@/hooks/usePairing';
import { createFetchCodePort } from '@/services/fetchCodePort';
import type { FetchResponse } from '@/services/httpAsk';
import { createLogger } from '@/services/logger';
import { seaznEnvironment, seaznOrigin } from '@/services/seaznHosts';
import { createRingRecord } from '@/services/sessionRecord';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { captureRaw } from '../../test/fixtures/wire';

/**
 * Carry T25 (the C4b gap hunt): one pair, end to end on the JS side. The QR is checked and saved
 * through the real fetch code port on the build's own origin (`seaznOrigin`, as `nativePorts.ts`
 * builds it), then `pairIntentFor`, then `intentWire`. The result must be the shared vector's wire
 * exactly, which `PairIntentVectorsTest.kt` reads through `PairMapping` into a request whose
 * `problems()` is empty: Pairing.kt holds `codeUrl` to the code's own URL with no trailing slash.
 */
type Input = {
  /** `EXPO_PUBLIC_SEAZN_ENV`, as the build reads it. */
  readonly env: string;
  readonly qr: { readonly code: string; readonly slot: number; readonly tok: string };
  /** The server's answer to the scan's `GET code` (capture-descriptor.v1, a waiting code). */
  readonly answer: Record<string, unknown>;
  readonly facts: { readonly language: string; readonly automatic: boolean; readonly claim: Claim };
  /**
   * The cold-start re-pair pairs from the code read back from the store, not the one in hand
   * (review C4c M-5): it goes through the store's own encode and decode first.
   */
  readonly fromStore: boolean;
};

const waiting = (code: string, zone: string, beats: string, start: string) => ({
  state: 'waiting',
  code,
  label: 'Example Town v Sample CC',
  venueTimezone: zone,
  autoAllowed: true,
  destinationName: null,
  overlayUrl: null,
  pollSeconds: 60,
  heartbeatUrl: beats,
  startUrl: start,
});

const INPUTS: Readonly<Record<string, Input>> = {
  'staging, a scan': {
    env: 'staging',
    qr: { code: 'fx42hmnp7k2q', slot: 1, tok: 'tok-9f3c2a7e5b1d4680ab' },
    answer: waiting(
      'fx42hmnp7k2q',
      'Europe/London',
      'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
      'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
    ),
    facts: { language: 'en', automatic: true, claim: 'new' },
    fromStore: false,
  },
  'production, the cold-start re-pair': {
    env: 'production',
    qr: { code: '0123456789ab', slot: 2, tok: 'zZ09zZ09zZ09zZ09zZ09zZ' },
    answer: waiting(
      '0123456789ab',
      'Europe/Amsterdam',
      'https://seazn.club/api/v1/capture/codes/0123456789ab/beats',
      'https://seazn.club/api/v1/capture/codes/0123456789ab/start',
    ),
    facts: { language: 'nl', automatic: false, claim: 'resume' },
    fromStore: true,
  },
};

const ok = (body: unknown): FetchResponse => ({
  status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

/** What Home saves after a 200, then the intent the bridge sends for it. */
async function wireFor({
  env,
  qr,
  answer,
  facts,
  fromStore,
}: Input): Promise<Record<string, unknown>> {
  const urls: string[] = [];
  const port = createFetchCodePort({
    origin: seaznOrigin(env),
    fetch: async (url) => {
      urls.push(url);
      return ok(answer);
    },
    logger: createLogger({ record: createRingRecord(), now: () => 0 }),
  });
  const raw = captureRaw(qr);
  const code = parseStreamCodeText(raw);
  if (!code.ok) throw new Error(`the fixture QR must parse: ${code.error.kind}`);
  const checked = await port.check(code.value);
  if (!checked.ok) throw new Error(`the fixture answer must be read: ${checked.error.kind}`);
  const saved = savedStreamCode({
    raw,
    slot: qr.slot,
    stream: { waiting: checked.value, codeUrl: port.codeUrl(code.value.code), tapToPair: false },
  });
  const used = fromStore ? decodeSavedCode(encodeSavedCode(saved)) : saved;
  if (used === null) throw new Error('the saved fixture must read back from the store');
  const intent = pairIntentFor(used, { ...facts, environment: seaznEnvironment(env) });
  if (intent === null) throw new Error('the saved fixture must be usable');
  // The scan asked the code's own URL, with only the slot after it.
  expect(urls).toEqual([`${intent.codeUrl}?slot=${qr.slot}`]);
  return intentWire(intent);
}

describe('carry T25: a scanned code reaches native as the pair the core accepts', () => {
  // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('folds both of the 2 shared rows, one per environment', () => {
    expect(vectors.intents.map((row) => row.name).sort()).toEqual(Object.keys(INPUTS).sort());
    expect(new Set(vectors.intents.map((row) => row.wire.environment))).toEqual(
      new Set(['staging', 'production']),
    );
  });

  it.each(vectors.intents.map((row) => [row.name, row.wire] as const))(
    '%s: the intent wire is the shared row, codeUrl exactly',
    async (name, wire) => {
      const input = INPUTS[name];
      if (input === undefined) throw new Error(`no input for ${name}`);
      expect(await wireFor(input)).toEqual(wire);
    },
  );
});
