import { describe, expect, it } from 'vitest';
import type { EngineIntent, PairIntent } from './CaptureEnginePort';
import { intentWire } from './intentWire';
import { PAIR } from './testing/pairIntent';

/** Every intent kind, so the compiler refuses a kind the table below forgets. */
const KINDS: Readonly<Record<EngineIntent['kind'], true>> = {
  pair: true,
  start: true,
  stop: true,
  unpair: true,
  reset: true,
  setAutomatic: true,
  setLanguage: true,
  switchCamera: true,
};

const OTHERS = [
  [{ kind: 'start' }, { kind: 'start' }],
  [{ kind: 'stop' }, { kind: 'stop' }],
  [{ kind: 'unpair' }, { kind: 'unpair' }],
  [{ kind: 'reset' }, { kind: 'reset' }],
  [{ kind: 'switchCamera' }, { kind: 'switchCamera' }],
  [
    { kind: 'setAutomatic', on: false },
    { kind: 'setAutomatic', on: false },
  ],
  [
    { kind: 'setLanguage', language: 'nl' },
    { kind: 'setLanguage', language: 'nl' },
  ],
] as const;

describe('the intents as native reads them (Task 11)', () => {
  it('sends pair with every field PairMapping reads, the venue zone included (carry T25), and nothing else', () => {
    expect(intentWire(PAIR)).toEqual({
      kind: 'pair',
      code: 'fx42hmnp7k2q',
      slot: 1,
      token: 'tok-9f3c2a7e5b1d4680ab',
      codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q',
      heartbeatUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
      startUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
      venueTimezone: 'Europe/London',
      language: 'fr',
      automatic: false,
      claim: 'resume',
      environment: 'staging',
    });
  });

  // W28: the scan's round line rides the pair with the match label it was read with, or neither does.
  it('sends the round line and its match when the intent carries them, and neither key when it does not', () => {
    const staged = intentWire({
      ...PAIR,
      stageLabel: 'Open · QF',
      stageMatch: 'Example Town v Sample CC',
    });
    expect(staged).toMatchObject({
      stageLabel: 'Open · QF',
      stageMatch: 'Example Town v Sample CC',
    });
    const keys = Object.keys(intentWire(PAIR));
    expect(keys).not.toContain('stageLabel');
    expect(keys).not.toContain('stageMatch');
    // One without the other is no stage: native seeds both or neither, and so does the wire.
    for (const half of [{ stageLabel: 'Open · QF' }, { stageMatch: 'Example Town v Sample CC' }]) {
      const lone = Object.keys(intentWire({ ...PAIR, ...half }));
      expect(lone).not.toContain('stageLabel');
      expect(lone).not.toContain('stageMatch');
    }
  });

  it('drops a field the intent should not carry, whatever a caller added', () => {
    const extra = { ...PAIR, cred: { streamKey: 'fake-key-0000' } } as PairIntent;
    expect(Object.keys(intentWire(extra))).not.toContain('cred');
    const stop = { kind: 'stop', cred: 'fake-key-0000' } as unknown as EngineIntent;
    expect(intentWire(stop)).toEqual({ kind: 'stop' });
  });

  // The table's size, so a kind dropped from it reds here rather than going untested (PV12).
  it('covers all 8 intent kinds: pair above, the other 7 below', () => {
    const kinds = ['pair', ...OTHERS.map(([intent]) => intent.kind)];
    expect(kinds.sort()).toEqual(Object.keys(KINDS).sort());
    expect(kinds).toHaveLength(8);
  });

  it.each(OTHERS)('sends %o as %o', (intent, wire) => {
    expect(intentWire(intent)).toEqual(wire);
  });
});
