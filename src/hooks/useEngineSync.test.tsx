import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineIntent } from '@/engine/CaptureEnginePort';
import { useEngineSync } from '@/hooks/useEngineSync';
import { useLanguage } from '@/hooks/useLanguage';
import { usePairing } from '@/hooks/usePairing';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createStreamSettingsStore, SETTINGS_KEY } from '@/services/streamSettingsStore';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { heldReads } from '../../test/heldReads';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const code = savedStreamCode();
/** The switch saved off, as Settings writes it (v2, A4). */
const SWITCH_OFF = { [SETTINGS_KEY]: '{"v":2,"overlay":true,"side":"right","automatic":false}' };

const flush = (ms = 10) => act(() => vi.advanceTimersByTimeAsync(ms));
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const last = (fakes: FakePorts): EngineIntent | undefined => fakes.engine.intents.at(-1);

/** The shell's sync, with the operator's language pick and the pairing hook beside it. */
async function sync(fakes: FakePorts) {
  const view = renderHook(
    () => {
      useEngineSync();
      return { language: useLanguage(), pair: usePairing() };
    },
    { wrapper: wrapperFor(fakes) },
  );
  await flush();
  return view;
}

/**
 * Amendment §2, Settings, and P3 as the amendment updates it: native's copy
 * of the automatic switch (A4) and of the operator's language follows JS's.
 */
describe('useEngineSync: the automatic switch (A4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing while native already holds the saved switch', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    await sync(fakes);
    expect(fakes.engine.getSnapshot().pairing?.automatic).toBe(true);
    expect(kinds(fakes)).toEqual(['pair']);
  });

  it('tells native at once when the switch changes, and native holds it', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    await sync(fakes);
    act(() => void fakes.ports.streamSettings.set({ automatic: false }));
    expect(last(fakes)).toEqual({ kind: 'setAutomatic', on: false });
    expect(fakes.engine.getSnapshot().pairing?.automatic).toBe(false);
    // Three 1 Hz reports, each with the two equal: nothing more.
    const sent = fakes.engine.intents.length;
    await flush(3_000);
    expect(fakes.engine.intents.length).toBe(sent);
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({ event: 'intent.setAutomatic', fields: { action: 'off' } }),
    );
  });

  // A cold start's `pair` sent before the store loaded carried the default.
  it('brings native to the saved switch once the settings load', async () => {
    const fakes = createFakePorts({ kvSeed: SWITCH_OFF });
    pairCode(fakes.engine, code);
    expect(fakes.engine.getSnapshot().pairing?.automatic).toBe(true);
    await sync(fakes);
    await flush(3_000);
    expect(kinds(fakes)).toEqual(['pair', 'setAutomatic']);
    expect(last(fakes)).toEqual({ kind: 'setAutomatic', on: false });
  });

  // Before the read, the store holds the default (on): sending against it would undo native's off.
  it('sends nothing before the saved switch is read', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    act(() => fakes.engine.send({ kind: 'setAutomatic', on: false }));
    const held = heldReads(createMemoryKeyValueStore(SWITCH_OFF));
    const slow = {
      ...fakes,
      ports: {
        ...fakes.ports,
        streamSettings: createStreamSettingsStore(held.store, fakes.ports.logger),
      },
    };
    await sync(slow);
    await flush(3_000);
    expect(kinds(fakes)).toEqual(['pair', 'setAutomatic']);
    await act(async () => held.release());
    await flush(3_000);
    expect(kinds(fakes)).toEqual(['pair', 'setAutomatic']);
    expect(fakes.engine.getSnapshot().pairing?.automatic).toBe(false);
  });

  it('sends nothing with no pairing', async () => {
    const fakes = createFakePorts();
    await sync(fakes);
    act(() => void fakes.ports.streamSettings.set({ automatic: false }));
    await flush(3_000);
    expect(kinds(fakes)).toEqual([]);
  });

  // Amendment §2: the switch stays usable on air.
  it('sends the change on air too', async () => {
    const fakes = createFakePorts();
    await sync(fakes);
    act(() => fakes.engine.scene('live'));
    act(() => void fakes.ports.streamSettings.set({ automatic: false }));
    expect(last(fakes)).toEqual({ kind: 'setAutomatic', on: false });
  });

  // Native ignores `setAutomatic` in Ended, so sending there would repeat on every report.
  it('sends nothing once Ended, across reports', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    await sync(fakes);
    act(() => fakes.engine.scene('stopped'));
    expect(fakes.engine.getSnapshot().pairing).not.toBeNull();
    act(() => void fakes.ports.streamSettings.set({ automatic: false }));
    await flush(3_000);
    expect(kinds(fakes)).toEqual(['pair']);
  });

  // Question 1: a double press converges, one intent per change.
  it('sends one intent per change on a double press, ending equal', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    await sync(fakes);
    act(() => void fakes.ports.streamSettings.set({ automatic: false }));
    act(() => void fakes.ports.streamSettings.set({ automatic: true }));
    await flush(3_000);
    expect(fakes.engine.intents.slice(1)).toEqual([
      { kind: 'setAutomatic', on: false },
      { kind: 'setAutomatic', on: true },
    ]);
    expect(fakes.engine.getSnapshot().pairing?.automatic).toBe(true);
  });
});

describe('useEngineSync: the notification’s language (P3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['fr', 'es', 'nl'] as const)('tells native the pick (%s) while paired', async (lang) => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    const view = await sync(fakes);
    act(() => view.result.current.language.setLang(lang));
    await flush();
    expect(last(fakes)).toEqual({ kind: 'setLanguage', language: lang });
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({ event: 'intent.setLanguage', fields: { action: lang } }),
    );
  });

  it('sends nothing on the first render, nor for the same language again', async () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, code);
    const view = await sync(fakes);
    expect(kinds(fakes)).toEqual(['pair']);
    act(() => view.result.current.language.setLang('en'));
    await flush();
    expect(kinds(fakes)).toEqual(['pair']);
  });

  it('tells native on air too', async () => {
    const fakes = createFakePorts();
    const view = await sync(fakes);
    act(() => fakes.engine.scene('live'));
    act(() => view.result.current.language.setLang('nl'));
    await flush();
    expect(last(fakes)).toEqual({ kind: 'setLanguage', language: 'nl' });
  });

  it('sends nothing while idle', async () => {
    const fakes = createFakePorts();
    const view = await sync(fakes);
    act(() => view.result.current.language.setLang('fr'));
    await flush();
    expect(kinds(fakes)).toEqual([]);
  });

  // M11: a pick made while idle is what native holds after the pair.
  it('sends a pick back to English after a pair that carried an idle French pick', async () => {
    const fakes = createFakePorts();
    const view = await sync(fakes);
    act(() => view.result.current.language.setLang('fr'));
    await flush();
    expect(kinds(fakes)).toEqual([]);
    act(() => view.result.current.pair(code, 'new'));
    expect(last(fakes)).toMatchObject({ kind: 'pair', language: 'fr' });
    act(() => view.result.current.language.setLang('en'));
    await flush();
    expect(last(fakes)).toEqual({ kind: 'setLanguage', language: 'en' });
  });
});
