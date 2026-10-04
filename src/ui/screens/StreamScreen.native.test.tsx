import { act, getDefaultNormalizer, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { TEST_NOW } from '../../../test/fakePorts';
import { renderViewfinder } from '../../../test/renderViewfinder';

type View = Awaited<ReturnType<typeof renderViewfinder>>;
const dictionaries = { es, fr, nl } as const;
/** The plate as rendered: its text is the dictionary's, upper-cased by style, not by text. */
const plate = () => screen.getByTestId('tally-plate').textContent;
/** Copy from the dictionaries, written out where a test reads the screen. */
const SILENT = 'Engine not responding — check the phone';
const KEEP_OPEN = 'Keep the app open — capture stops in the background';
const NOT_CHARGING = 'Not charging — plug in for a long match';

/** `ms` after the test's clock, with the 1 s tick that re-reads it (`useClockTick`). */
function later(view: View, ms: number) {
  act(() => {
    view.setNow(new Date(TEST_NOW.getTime() + ms));
    vi.advanceTimersByTime(1_000);
  });
}

/** CD17: native reports at 1 Hz from Pairing on; three seconds without one is news (P2). */
describe('CD17: an engine that goes quiet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a live broadcast whose engine goes quiet reads TROUBLE and says why, and recovers on the next report', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    act(() => view.engine.suspend());
    later(view, 3_001);
    expect(plate()).toBe(en['stream.tally.trouble']);
    expect(screen.getByText(en['stream.status.engineSilent'])).toBeTruthy();
    expect(en['stream.status.engineSilent']).toBe(SILENT);
    act(() => view.engine.scene('live'));
    expect(plate()).toBe(en['stream.tally.live']);
    expect(screen.queryByText(SILENT)).toBeNull();
  });

  it('a paired engine that goes quiet says so too', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.suspend());
    later(view, 3_001);
    expect(plate()).toBe('Trouble');
    expect(screen.getByText(SILENT)).toBeTruthy();
  });

  // The negative pair: the same clock, with native reporting, is no news.
  it('an engine that keeps reporting is never silent', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    for (const ms of [1_000, 2_000, 3_001, 5_000]) later(view, ms);
    expect(plate()).toBe('Live');
    expect(screen.queryByText(SILENT)).toBeNull();
  });

  it('waits the full three seconds', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    act(() => view.engine.suspend());
    later(view, 3_000);
    expect(plate()).toBe('Live');
    expect(screen.queryByText(SILENT)).toBeNull();
  });

  // Ended holds nothing: a quiet engine there is native at rest, not news.
  it('says nothing once the broadcast has ended', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    act(() => view.engine.suspend());
    later(view, 60_000);
    expect(plate()).toBe('Ended');
    expect(screen.queryByText(SILENT)).toBeNull();
  });

  it.each(['es', 'fr', 'nl'] as const)('the silent line reads in %s', async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene('live'));
    act(() => view.engine.suspend());
    later(view, 3_001);
    // Exact, the French no-break space before the colon included (glossary, Typography).
    const exact = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };
    expect(screen.getByText(dictionaries[lang]['stream.status.engineSilent'], exact)).toBeTruthy();
    expect(plate()).toBe(dictionaries[lang]['stream.tally.trouble']);
  });
});

/** CD18: a held pairing on a phone that would not survive the background says keep it open. */
describe('CD18: keep the app open', () => {
  it('a paired phone that would not survive the background says keep the app open', async () => {
    const view = await renderViewfinder();
    expect(screen.queryByText(KEEP_OPEN)).toBeNull();
    expect(screen.getByText(NOT_CHARGING)).toBeTruthy();
    act(() => view.engine.setSurvivesBackground(false));
    expect(screen.getByText(en['stream.advisory.keepOpen'])).toBeTruthy();
    expect(en['stream.advisory.keepOpen']).toBe(KEEP_OPEN);
    // One caption at a time: keep-open outranks not charging (topAdvisory).
    expect(screen.queryByText(NOT_CHARGING)).toBeNull();
  });

  it('says it on air too, and stops once the service runs', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    act(() => view.engine.setSurvivesBackground(false));
    expect(screen.getByText(KEEP_OPEN)).toBeTruthy();
    act(() => view.engine.setSurvivesBackground(true));
    expect(screen.queryByText(KEEP_OPEN)).toBeNull();
  });

  it('says nothing once ended', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('stopped'));
    act(() => view.engine.setSurvivesBackground(false));
    expect(screen.queryByText(KEEP_OPEN)).toBeNull();
  });
});
