import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { useHome, type HomePanel } from '@/hooks/useHome';
import { UNPAIR_GIVE_UP_MS } from '@/hooks/useUnpair';
import type { Lang } from '@/i18n/language';
import { STORE_KEYS } from '@/services/modeStore';
import { CodePanel } from '@/ui/components/CodePanel';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, type FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { holdIntents } from '../../../test/holdIntents';
import { pairCode } from '../../../test/pairCode';
import { refusingStore } from '../../../test/refusingStore';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

// HomeScreen's wiring is driven through a stubbed `useHome` in one test; every
// other test runs the real hook (a passthrough spy).
vi.mock('@/hooks/useHome', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useHome')>();
  return { ...real, useHome: vi.fn(real.useHome) };
});

const stream = savedStreamCode();
const inStream = {
  [STORE_KEYS.active]: 'stream',
  [STORE_KEYS.code('stream')]: encodeSavedCode(stream),
};
/** A made-up Remote Scoring code, as `recognise` reads one (recognise.test.ts). */
const scoring = {
  mode: 'scoring',
  raw: 'https://stg.seazn.club/score/abc_123-XYZ',
  token: 'abc_123-XYZ',
} as const satisfies ModeCode;
const SAVE_FAILED = "Couldn't save on this phone. Try again.";

const flush = (ms = 10) => act(() => vi.advanceTimersByTimeAsync(ms));
const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const saved = (fakes: FakePorts) => {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.saved : null;
};

/**
 * Home's hook over fake ports with the stream code saved and, when `paired`,
 * native holding it. In S1 a scoring code reaches `openCode` only through
 * `openFromPanel` (CD41): `scanOutcome` answers "coming soon" for it.
 */
async function home(options: { paired: boolean; fakes?: FakePorts }) {
  const fakes = options.fakes ?? createFakePorts({ kvSeed: inStream });
  if (options.paired) pairCode(fakes.engine, stream);
  const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  return { ...fakes, hook };
}
const view = (h: Awaited<ReturnType<typeof home>>) => h.hook.result.current.view;
const actions = (h: Awaited<ReturnType<typeof home>>) => h.hook.result.current.actions;
const openScoring = async (h: Awaited<ReturnType<typeof home>>) => {
  act(() => actions(h).openFromPanel(scoring));
  await flush();
};

/** A7: another mode while paired asks first, and its confirm unpairs and forgets. */
describe('Home: another mode while paired (A7)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks first, and unpairs nothing yet', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    expect(view(h).panel).toEqual({ kind: 'unpairConfirm', tapped: 'scoring', code: scoring });
    expect(kinds(h)).toEqual(['pair']);
    expect(saved(h)?.active).toBe('stream');
  });

  it('unpairs, forgets the stream code, then opens the other mode on Confirm', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => actions(h).confirmUnpair());
    await flush();
    expect(kinds(h)).toEqual(['pair', 'unpair']);
    expect(view(h).panel).toBeNull();
    expect(saved(h)?.codes.stream).toBeUndefined();
    expect(saved(h)?.active).toBe('scoring');
    expect(h.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    expect(readRecord(h.record)).toContainEqual(
      expect.objectContaining({ event: 'intent.unpair', fields: { action: 'otherMode' } }),
    );
  });

  // Question 1: a second press finds the sheet closed, and `useUnpair` drops a second unpair.
  it('unpairs once for a double Confirm', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => {
      actions(h).confirmUnpair();
      actions(h).confirmUnpair();
    });
    await flush();
    expect(kinds(h)).toEqual(['pair', 'unpair']);
  });

  // R19: a refused forget is never silent, and the other mode does not open.
  it('says so when the phone refuses to forget, and opens nothing', async () => {
    const fakes = createFakePorts({
      modeStore: refusingStore(inStream, (key) => key === STORE_KEYS.code('stream')),
    });
    const h = await home({ paired: true, fakes });
    await openScoring(h);
    act(() => actions(h).confirmUnpair());
    await flush();
    expect(view(h).statusText).toBe(SAVE_FAILED);
    expect(readRecord(h.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'forget' } }),
    );
    expect(saved(h)?.codes.scoring).toBeUndefined();
    expect(saved(h)?.active).toBe('stream');
  });

  it('sends nothing on Cancel, and keeps the stream code', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => actions(h).cancelUnpair());
    await flush();
    expect(view(h).panel).toBeNull();
    expect(kinds(h)).toEqual(['pair']);
    expect(saved(h)?.codes.stream).toBeDefined();
    expect(saved(h)?.codes.scoring).toBeUndefined();
  });

  // Android Back closes a panel (`useBackCloses`); on the sheet that is Cancel (review C5 I-3).
  it('sends nothing on Back, and keeps the stream code', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => actions(h).closePanel());
    await flush();
    expect(view(h).panel).toBeNull();
    expect(kinds(h)).toEqual(['pair']);
    expect(saved(h)?.codes.stream).toBeDefined();
    expect(saved(h)?.codes.scoring).toBeUndefined();
  });

  // The engine leaves Paired under the sheet: it closes as Cancel, and Task 29's panel says why.
  it('closes as Cancel when native unpairs under it, and says why', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => h.engine.hear({ word: 'replaced' }));
    await flush();
    expect(view(h).panel).toEqual({ kind: 'unpaired', tapped: 'stream', reason: 'replaced' });
    expect(kinds(h)).toEqual(['pair']);
    expect(saved(h)?.codes.scoring).toBeUndefined();
  });

  it('closes when a Go live leaves Paired under it', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    act(() => h.engine.hear({ word: 'go-live', cause: 'organiser' }));
    await flush();
    expect(view(h).panel).toBeNull();
    expect(saved(h)?.codes.scoring).toBeUndefined();
  });

  // A Go live raced the confirm: native ignores the unpair, the broadcast stands.
  it('keeps the stream code and opens nothing when a Go live races the confirm', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    const held = holdIntents(h.engine, ['unpair']);
    act(() => actions(h).confirmUnpair());
    // The sheet closes on the press itself, before native has answered.
    expect(h.engine.getSnapshot().state.kind).toBe('paired');
    expect(view(h).panel).toBeNull();
    act(() => h.engine.hear({ word: 'go-live', cause: 'organiser' }));
    act(() => held.release());
    await flush();
    expect(h.engine.getSnapshot().state.kind).not.toBe('idle');
    expect(saved(h)?.codes.stream).toBeDefined();
    expect(saved(h)?.codes.scoring).toBeUndefined();
    expect(saved(h)?.active).toBe('stream');
  });

  // Review C5 m-1, CD26: native never answers, so the unpair is given up. The operator asked, so
  // the stream code is forgotten (an engine still paired is then an orphan, cleared at the next
  // settle); the other mode is asked for again, since the phone is still paired.
  it('forgets the stream code when native never answers the unpair', async () => {
    const h = await home({ paired: true });
    await openScoring(h);
    const held = holdIntents(h.engine, ['unpair']);
    act(() => actions(h).confirmUnpair());
    await flush(UNPAIR_GIVE_UP_MS - 20);
    expect(saved(h)?.codes.stream).toBeDefined();
    await flush(40);
    expect(held.held()).toEqual(['unpair']);
    expect(h.engine.getSnapshot().state.kind).toBe('paired');
    expect(saved(h)?.codes.stream).toBeUndefined();
    expect(saved(h)?.codes.scoring).toBeUndefined();
    expect(view(h).panel).toEqual({ kind: 'unpairConfirm', tapped: 'scoring', code: scoring });
  });

  it('opens the other mode at once with nothing paired', async () => {
    const h = await home({ paired: false });
    await openScoring(h);
    expect(view(h).panel).toBeNull();
    expect(kinds(h)).toEqual([]);
    expect(saved(h)?.active).toBe('scoring');
  });
});

const SHEET: HomePanel = { kind: 'unpairConfirm', tapped: 'scoring', code: scoring };
const panelHandlers = () => ({
  onOpen: vi.fn(),
  onScanAgain: vi.fn(),
  onClose: vi.fn(),
  onTryAgain: vi.fn(),
  onConfirmUnpair: vi.fn(),
  onCancelUnpair: vi.fn(),
});

/**
 * The sheet's words (copy table, Task 30), in the operator's language, with the
 * mode named. Remote Scoring only: `ModeCode` has no Dashboard code before S2.
 */
describe('the unpair sheet', () => {
  it.each<[Lang, HomePanel, string, string, string]>([
    [
      'en',
      SHEET,
      'This phone is paired for streaming. Opening Remote Scoring unpairs it.',
      'Unpair & open',
      'Cancel',
    ],
    [
      'es',
      SHEET,
      'Este móvil está vinculado para emitir. Abrir Anotación remota lo desvincula.',
      'Desvincular y abrir',
      'Cancelar',
    ],
    [
      'nl',
      SHEET,
      'Deze telefoon is gekoppeld om te streamen. Scoren op afstand openen ontkoppelt hem.',
      'Ontkoppelen en openen',
      'Annuleren',
    ],
    [
      'fr',
      SHEET,
      'Ce téléphone est associé pour diffuser. Ouvrir Score à distance le dissocie.',
      'Dissocier et ouvrir',
      'Annuler',
    ],
  ])('says it in %s', (lang, outcome, body, confirm, cancel) => {
    const h = panelHandlers();
    renderWithPorts(<CodePanel outcome={outcome} time={null} {...h} />, {
      deviceLanguages: [lang],
    });
    expect(screen.getByText(body)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: confirm }));
    expect([h.onConfirmUnpair.mock.calls.length, h.onOpen.mock.calls.length]).toEqual([1, 0]);
    const answers = screen.getAllByRole('button', { name: cancel });
    expect(answers).toHaveLength(2);
    for (const answer of answers) fireEvent.click(answer);
    expect(h.onCancelUnpair).toHaveBeenCalledTimes(2);
    expect(h.onClose).not.toHaveBeenCalled();
  });
});

/**
 * Review C5 I-3: the sheet has the spec's two answers and no others: no Scan
 * again and no Close. The dim means Cancel, under Cancel's own name.
 */
describe('the unpair sheet’s answers', () => {
  it('offers Unpair & open and Cancel only, the dim first', () => {
    renderWithPorts(<CodePanel outcome={SHEET} time={null} {...panelHandlers()} />);
    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Cancel', 'Unpair & open', 'Cancel']);
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('cancels on the dim, and closes nothing', () => {
    const h = panelHandlers();
    renderWithPorts(<CodePanel outcome={SHEET} time={null} {...h} />);
    // The dim and the sheet's own Cancel, in that order (the dim is drawn first, under the sheet).
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels).toHaveLength(2);
    const [dim] = cancels;
    if (dim === undefined) throw new Error('the dim is a button');
    fireEvent.click(dim);
    expect(h.onCancelUnpair).toHaveBeenCalledTimes(1);
    expect([h.onClose, h.onScanAgain, h.onConfirmUnpair].map((f) => f.mock.calls.length)).toEqual([
      0, 0, 0,
    ]);
  });

  // The other panels keep theirs: the dim closes, and Scan again scans.
  it('leaves a settled panel its Close and Scan again', () => {
    const h = panelHandlers();
    const panel: HomePanel = { kind: 'unpaired', tapped: 'stream', reason: 'replaced' };
    renderWithPorts(<CodePanel outcome={panel} time={null} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect([h.onClose, h.onScanAgain, h.onCancelUnpair].map((f) => f.mock.calls.length)).toEqual([
      1, 1, 0,
    ]);
  });
});

/** HomeScreen hands the sheet's two buttons to Home's two actions. */
describe('HomeScreen’s unpair sheet', () => {
  it('wires Unpair & open and Cancel to their actions', () => {
    const stubbed = {
      view: {
        statusText: 'Tap a mode, then scan its code.',
        panel: SHEET,
        panelTime: null,
        continueCode: null,
        continueCopy: null,
      },
      actions: {
        tapTile: vi.fn(),
        scanAgain: vi.fn(),
        openFromPanel: vi.fn(),
        closePanel: vi.fn(),
        retryCheck: vi.fn(),
        continueStream: vi.fn(),
        forgetStream: vi.fn(),
        useRaw: vi.fn(),
        confirmUnpair: vi.fn(),
        cancelUnpair: vi.fn(),
      },
    };
    const real = vi.mocked(useHome).getMockImplementation();
    if (real === undefined) throw new Error('the passthrough spy has its implementation');
    vi.mocked(useHome).mockImplementation(() => stubbed);
    try {
      renderWithPorts(<HomeScreen />);
      fireEvent.click(screen.getByRole('button', { name: 'Unpair & open' }));
      expect(stubbed.actions.confirmUnpair).toHaveBeenCalledTimes(1);
      const [dim, cancel] = screen.getAllByRole('button', { name: 'Cancel' });
      if (dim === undefined || cancel === undefined) throw new Error('the dim and Cancel');
      fireEvent.click(cancel);
      fireEvent.click(dim);
      expect(stubbed.actions.cancelUnpair).toHaveBeenCalledTimes(2);
      expect(stubbed.actions.closePanel).not.toHaveBeenCalled();
      expect(stubbed.actions.openFromPanel).not.toHaveBeenCalled();
    } finally {
      vi.mocked(useHome).mockImplementation(real);
    }
  });
});
