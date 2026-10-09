import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { EngineIntent } from '@/engine/CaptureEnginePort';
import { sampleWaiting } from '@/services/fakeCodePort';
import { pairIntentFor, usePairing } from '@/hooks/usePairing';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { captureRaw, FIXTURE_TOKEN } from '../../test/fixtures/wire';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const CODE_URL = 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q';
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const pairLines = (fakes: FakePorts) =>
  readRecord(fakes.record)
    .filter((entry) => entry.event === 'intent.pair')
    .map((entry) => entry.fields);

function pairer(fakes: FakePorts) {
  return renderHook(() => usePairing(), { wrapper: wrapperFor(fakes) });
}

/** The same code at another camera position (C7). */
const slotTwo = (): SavedCode => savedStreamCode({ raw: captureRaw({ slot: 2 }), slot: 2 });

describe('pairIntentFor', () => {
  it('builds the exact pair intent from the QR and the saved stream part', () => {
    const facts = {
      language: 'fr',
      automatic: false,
      environment: 'production',
      claim: 'resume',
    } as const;
    expect(pairIntentFor(savedStreamCode(), facts)).toEqual({
      kind: 'pair',
      code: 'fx42hmnp7k2q',
      slot: 1,
      token: 'tok-9f3c2a7e5b1d4680ab',
      codeUrl: CODE_URL,
      heartbeatUrl: `${CODE_URL}/beats`,
      startUrl: `${CODE_URL}/start`,
      venueTimezone: 'Europe/London',
      language: 'fr',
      automatic: false,
      environment: 'production',
      claim: 'resume',
    } satisfies EngineIntent);
  });

  // W28: the scan's round line rides the pair with the match label it was read with (the waiting label).
  it('carries the saved stage as the intent’s round line and its match, and omits both keys without one', () => {
    const facts = {
      language: 'en',
      automatic: true,
      environment: 'staging',
      claim: 'new',
    } as const;
    const withStage = savedStreamCode({
      stream: {
        waiting: sampleWaiting({
          label: 'A v B',
          stage: { label: 'Open · Grupo A · Ronda 2', kind: 'plain_round' },
        }),
        codeUrl: CODE_URL,
        tapToPair: false,
      },
    });
    const staged = pairIntentFor(withStage, facts);
    expect(staged).toMatchObject({ stageLabel: 'Open · Grupo A · Ronda 2', stageMatch: 'A v B' });
    const bare = pairIntentFor(savedStreamCode(), facts);
    expect(bare).not.toBeNull();
    expect(Object.keys(bare ?? {})).not.toContain('stageLabel');
    expect(Object.keys(bare ?? {})).not.toContain('stageMatch');
  });

  it.each<[string, SavedCode]>([
    ['no stream part', savedStreamCode({ stream: null })],
    ['a QR that no longer reads', savedStreamCode({ raw: 'not a capture code' })],
  ])('gives no intent for a code with %s', (_, saved) => {
    const facts = {
      language: 'en',
      automatic: true,
      environment: 'staging',
      claim: 'new',
    } as const;
    expect(pairIntentFor(saved, facts)).toBeNull();
  });
});

/** The amendment's Identity rules in JS, through the hook and the fake engine. */
describe('usePairing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pairs an idle engine with the build’s environment, the language and the settings', () => {
    const fakes = createFakePorts();
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'new'));
    expect(fakes.engine.intents).toEqual([
      expect.objectContaining({
        kind: 'pair',
        code: 'fx42hmnp7k2q',
        slot: 1,
        language: 'en',
        automatic: true,
        environment: 'staging',
        claim: 'new',
      }),
    ]);
    expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
  });

  // Four questions (4): the current language and the operator's automatic switch ride along.
  it('carries the current language and the automatic setting', async () => {
    const fakes = createFakePorts({ deviceLanguages: ['fr'] });
    await act(() => fakes.ports.streamSettings.set({ automatic: false }));
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'new'));
    expect(fakes.engine.intents.at(-1)).toMatchObject({ language: 'fr', automatic: false });
  });

  it('sends nothing when the same code is already paired (a second call adopts)', () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, savedStreamCode());
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'new'));
    act(() => result.current(savedStreamCode(), 'new'));
    expect(kinds(fakes)).toEqual(['pair']);
    expect(pairLines(fakes)).toEqual([
      { action: 'adopt', claim: 'new', slot: 1 },
      { action: 'adopt', claim: 'new', slot: 1 },
    ]);
  });

  it('pairs another slot of the same code over the first', () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, slotTwo());
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'new'));
    expect(kinds(fakes)).toEqual(['pair', 'pair']);
    expect(fakes.engine.getSnapshot().pairing?.slot).toBe(1);
  });

  it.each(['stopped', 'fatal'] as const)(
    'resets a %s engine, then pairs, in that order',
    (scene) => {
      const fakes = createFakePorts();
      fakes.engine.scene(scene);
      const { result } = pairer(fakes);
      act(() => result.current(savedStreamCode(), 'new'));
      expect(kinds(fakes)).toEqual(['reset', 'pair']);
      expect(fakes.engine.getSnapshot().state.kind).toBe('paired');
    },
  );

  it('never touches a broadcast', () => {
    const fakes = createFakePorts();
    fakes.engine.scene('live');
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'new'));
    expect(kinds(fakes)).toEqual([]);
    expect(pairLines(fakes)).toEqual([{ action: 'none', claim: 'new', slot: 1 }]);
  });

  it('sends nothing for a code it cannot use, and records it', () => {
    const fakes = createFakePorts();
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode({ stream: null }), 'new'));
    expect(kinds(fakes)).toEqual([]);
    expect(readRecord(fakes.record).map((entry) => entry.event)).toEqual(['stream.unusable-code']);
  });

  it('records the step, the claim and the slot, never the token', () => {
    const fakes = createFakePorts();
    const { result } = pairer(fakes);
    act(() => result.current(savedStreamCode(), 'resume'));
    expect(pairLines(fakes)).toEqual([{ action: 'pair', claim: 'resume', slot: 1 }]);
    expect(fakes.record.lines().join('\n')).not.toContain(FIXTURE_TOKEN);
  });
});
