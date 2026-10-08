import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lang } from '@/i18n/language';
import { STORE_KEYS } from '@/services/modeStore';
import { font } from '@/ui/theme/tokens';
import {
  CODE,
  comesBefore,
  DICTIONARIES,
  endedRegion,
  holdStopAfterLive,
  scanAndGoLive,
  stopBeforeLiveOver401,
  textsIn,
} from '../../../test/endedFlow';
import { flush, launchApp, scanFromHome, type LaunchedApp } from '../../../test/routedApp';

const liveStreamTile = () => screen.getByRole('button', { name: /Live Stream/ });
const ok = () => screen.getByRole('button', { name: 'OK' });
const region = () => {
  const found = endedRegion();
  if (found === null) throw new Error('no Stream ended region on screen');
  return found;
};
const STATUS = 'Tap a mode, then scan its code.';

/** Scan, go live, and have the phone's own Stop end it: Home, with the card. */
async function stopAfterLive(app: LaunchedApp): Promise<void> {
  await scanAndGoLive(app);
  await holdStopAfterLive();
  expect(app.nav.current()).toBe('home');
}

/** The broadcast ends on its own: a fatal error after it went live. */
async function failAfterLive(app: LaunchedApp): Promise<void> {
  await scanAndGoLive(app);
  act(() => app.engine.scene('fatal'));
  await flush();
  expect(app.nav.current()).toBe('home');
}

/**
 * Spec §5: the Stream ended card on Home, above the tiles. These read what it says and when it goes; where the
 * viewfinder leaves from, and what it sends, is StreamScreen.ended.test.tsx's. `0:12:34` is the fake's declared
 * time on air (`ON_AIR_MS`, 754 s) through `formatElapsed`.
 */
describe('Home: the Stream ended card (spec §5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows after the phone’s Stop, above the tiles: the title, the time, how it ended, what to do next, and OK', async () => {
    const app = await launchApp();
    expect(endedRegion()).toBeNull();
    await stopAfterLive(app);
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'On air 0:12:34',
      'You stopped the broadcast.',
      'Scan the code again for the next broadcast',
      'OK',
    ]);
    expect(region().querySelectorAll('button')).toHaveLength(1);
    // Under the status line, above the tiles (portrait; Task 7 lays out landscape).
    expect(comesBefore(screen.getByText(STATUS), region())).toBe(true);
    expect(comesBefore(region(), liveStreamTile())).toBe(true);
    // The code is spent and forgotten: there is no Continue card to confuse the card with.
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
  });

  it('sets the title, the time, the reason and the hint in the board’s faces', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    const face = (text: string) => getComputedStyle(screen.getByText(text)).fontFamily;
    expect(face('Stream ended')).toBe(font.displayBold);
    expect(face('On air 0:12:34')).toBe(font.numeric);
    expect(face('You stopped the broadcast.')).toBe(font.bodyMedium);
    expect(face('Scan the code again for the next broadcast')).toBe(font.bodyMedium);
  });

  it('is cleared by OK, and stays cleared', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    expect(region()).toBeTruthy();
    fireEvent.click(ok());
    expect(endedRegion()).toBeNull();
    await flush(2_000);
    expect(endedRegion()).toBeNull();
    expect(app.ports.endedNotice.getSnapshot()).toBeNull();
    // Positive pair: Home itself is still there, tiles and all.
    expect(liveStreamTile()).toBeTruthy();
  });

  it('shows a fatal end’s reason with no scan-again line, above the Continue card for the code it kept', async () => {
    const app = await launchApp();
    await failAfterLive(app);
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'On air 0:12:34',
      'Something failed. Your code is kept.',
      'OK',
    ]);
    expect(screen.queryByText('Scan the code again for the next broadcast')).toBeNull();
    // The line is true: the kept code's Continue card is there, between the card and the tiles.
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(comesBefore(screen.getByText(STATUS), region())).toBe(true);
    expect(comesBefore(region(), cont)).toBe(true);
    expect(comesBefore(cont, liveStreamTile())).toBe(true);
    // And it is kept on disk too, not only offered: the positive pair of the dead-code test below (ruling M-5).
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(true);
  });

  it.each([
    [3_723_000, 'On air 1:02:03'],
    // M5: a session that ended inside its first second did go live.
    [0, 'On air 0:00:00'],
  ])('reads the time on air native reports, %i ms as %s', async (durationMs, line) => {
    const app = await launchApp();
    await scanFromHome(app, CODE);
    act(() => app.engine.scene('live'));
    await flush();
    act(() => app.engine.forceState({ kind: 'ended', reason: 'operator-stopped', durationMs }));
    await flush();
    expect(textsIn(region())[1]).toBe(line);
    expect(screen.queryByText('Never went live')).toBeNull();
  });

  it('says it never went live, with no time on air, for a session that did not', async () => {
    const app = await launchApp();
    await scanFromHome(app, CODE);
    act(() => app.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'Never went live',
      'Something failed. Your code is kept.',
      'OK',
    ]);
    expect(screen.queryByText(/^On air/)).toBeNull();
    expect(screen.queryByText('Scan the code again for the next broadcast')).toBeNull();
  });

  // F14 a: the Stop of a broadcast held past a 401. The code is dead, so no scan-again line; the existing
  // "code ended" body says why. Its positive pair is the first test, where the same line is present.
  it('says the code has ended, and not to scan it again, after a Stop over a 401', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    act(() => app.engine.hear({ word: 'code-ended' }));
    expect(app.engine.getSnapshot().codeEndedPending).toBe(true);
    await holdStopAfterLive();
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'On air 0:12:34',
      'You stopped the broadcast.',
      'This code has ended. Scan the new one.',
      'OK',
    ]);
    expect(screen.queryByText('Scan the code again for the next broadcast')).toBeNull();
  });

  it('says the code has ended, and not that it is kept, after a fatal end over a 401', async () => {
    const app = await launchApp();
    await scanAndGoLive(app);
    act(() => app.engine.hear({ word: 'code-ended' }));
    act(() => app.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: 754_000 }));
    await flush();
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'On air 0:12:34',
      'Something failed.',
      'This code has ended. Scan the new one.',
      'OK',
    ]);
    expect(screen.queryByText(/Your code is kept/)).toBeNull();
    // Ruling M-5: the code is as dead as after the operator's Stop, so it is forgotten and nothing offers to
    // re-arm it beside "Scan the new one". The tiles are there, so this is Home and not a blank screen.
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(liveStreamTile()).toBeTruthy();
  });

  // D7, M-4: the Stop of a broadcast that never went live is only "stay on the viewfinder" while the pairing
  // survives it. Held past a 401 it does not, so this is an Ended like any other: never went live, the Stop's
  // reason, the code-ended line in place of scan-again, and the dead code gone with no Continue.
  it('says never went live and that the code has ended, after a Stop over a 401 before the first frame', async () => {
    const app = await launchApp();
    await stopBeforeLiveOver401(app);
    expect(app.nav.current()).toBe('home');
    expect(textsIn(region())).toEqual([
      'Stream ended',
      'Never went live',
      'You stopped the broadcast.',
      'This code has ended. Scan the new one.',
      'OK',
    ]);
    expect(screen.queryByText(/^On air/)).toBeNull();
    expect(screen.queryByText('Scan the code again for the next broadcast')).toBeNull();
    expect(app.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});

/**
 * Sequence: the card is one broadcast's. A new broadcast brings its own, whether or not OK was pressed in
 * between; a new scan, a Continue and a restart each take the last one away.
 */
describe('Home: the card across broadcasts (spec §5: OK, a new scan or a restart clears it)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SECOND_BROADCAST = 61_000;

  /** The second broadcast: scan the code again, go live, and have the engine end it after 61 s. */
  async function secondBroadcast(app: LaunchedApp): Promise<void> {
    await scanFromHome(app, CODE);
    expect(app.nav.current()).toBe('stream');
    act(() => app.engine.scene('live'));
    await flush();
    act(() =>
      app.engine.forceState({
        kind: 'ended',
        reason: 'operator-stopped',
        durationMs: SECOND_BROADCAST,
      }),
    );
    await flush();
    expect(app.nav.current()).toBe('home');
  }

  it('shows a fresh card for a second broadcast after OK, not the old one', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    fireEvent.click(ok());
    expect(endedRegion()).toBeNull();
    await secondBroadcast(app);
    // 61 s is 0 h 01 min 01 s, worked by hand.
    expect(textsIn(region())[1]).toBe('On air 0:01:01');
    expect(screen.queryByText('On air 0:12:34')).toBeNull();
    expect(screen.getAllByRole('region', { name: 'Stream ended' })).toHaveLength(1);
  });

  it('shows a fresh card for a second broadcast whether or not OK was pressed in between', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    expect(textsIn(region())[1]).toBe('On air 0:12:34');
    await secondBroadcast(app);
    expect(textsIn(region())[1]).toBe('On air 0:01:01');
    expect(screen.queryByText('On air 0:12:34')).toBeNull();
    expect(screen.getAllByRole('region', { name: 'Stream ended' })).toHaveLength(1);
  });

  it('is cleared by a new scan, at the tap', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    expect(region()).toBeTruthy();
    app.scanner.queue({ outcome: 'cancelled' });
    fireEvent.click(liveStreamTile());
    await flush();
    expect(endedRegion()).toBeNull();
    expect(app.ports.endedNotice.getSnapshot()).toBeNull();
    expect(app.scanner.scans).toBe(2);
  });

  it('is cleared by a restart: it is in memory only', async () => {
    const app = await launchApp();
    await stopAfterLive(app);
    expect(region()).toBeTruthy();
    const seed = Object.fromEntries(app.kv.entries);
    cleanup();
    const restarted = await launchApp({ kvSeed: seed });
    expect(restarted.nav.current()).toBe('home');
    expect(screen.getByText(STATUS)).toBeTruthy();
    expect(endedRegion()).toBeNull();
    expect(restarted.ports.endedNotice.getSnapshot()).toBeNull();
  });

  // F14 b, D16: after a fatal end the code is kept, and Continue re-pairs it. That is a new broadcast, so the
  // card goes; when the operator comes back Home the card does not.
  it('is cleared by Continue, which re-pairs the code the fatal end kept', async () => {
    const app = await launchApp();
    await failAfterLive(app);
    expect(region()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await flush(200);
    expect(app.nav.current()).toBe('stream');
    expect(app.engine.intents.at(-1)?.kind).toBe('pair');
    expect(app.engine.getSnapshot().state.kind).toBe('paired');
    // Paired, so the viewfinder can be left.
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(endedRegion()).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});

const LANGS = ['en', 'es', 'fr', 'nl'] as const;

/**
 * The card's two new words as the plan's Copy table has them (docs/superpowers/plans/2026-10-06-s1-design-pr-a.md,
 * `home.ended.title` and `home.ended.ok`), typed here and not read from the dictionaries: the sweep below reads
 * them from the dictionaries, so a wrong word in one of them passes it (review I-1: es had "OK", the table says
 * "Aceptar", Android's own button word).
 */
const COPY_TABLE: Readonly<Record<(typeof LANGS)[number], { title: string; ok: string }>> = {
  en: { title: 'Stream ended', ok: 'OK' },
  es: { title: 'Emisión terminada', ok: 'Aceptar' },
  fr: { title: 'Direct terminé', ok: 'OK' },
  nl: { title: 'Stream beëindigd', ok: 'OK' },
};

describe('Home: the card’s title and OK are the Copy table’s words, in every language', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pins every language the app has', () => {
    expect(Object.keys(COPY_TABLE).sort()).toEqual(Object.keys(DICTIONARIES).sort());
    expect(LANGS).toHaveLength(4);
  });

  it.each(LANGS)('%s: the dictionaries say the table’s words', (lang) => {
    expect(DICTIONARIES[lang]['home.ended.title']).toBe(COPY_TABLE[lang].title);
    expect(DICTIONARIES[lang]['home.ended.ok']).toBe(COPY_TABLE[lang].ok);
  });

  it.each(LANGS)(
    '%s: the card names its region and its button by them, and the button clears it',
    async (lang) => {
      const app = await launchApp({ kvSeed: { [STORE_KEYS.lang]: lang } });
      await scanAndGoLive(app, lang);
      await holdStopAfterLive(lang);
      const { title, ok } = COPY_TABLE[lang];
      const named = screen.getByRole('region', { name: title });
      expect(textsIn(named)[0]).toBe(title);
      expect(textsIn(named).at(-1)).toBe(ok);
      fireEvent.click(within(named).getByRole('button', { name: ok }));
      await flush();
      expect(screen.queryByRole('region', { name: title })).toBeNull();
    },
  );
});

/**
 * The card in every language, from the dictionaries and not through `t()` (AGENTS §10). Each variant is a way the
 * card's lines differ: the four of `endedLines`. The language is the operator's saved pick.
 */
describe('Home: the Stream ended card reads in every language', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Variant = {
    readonly name: string;
    readonly lines: readonly string[];
    readonly arrive: (app: LaunchedApp, lang: Lang) => Promise<void>;
  };
  const VARIANTS: readonly Variant[] = [
    {
      name: 'a Stop after live',
      lines: ['stream.status.endedOperator', 'stream.ended.scanAgain'],
      arrive: async (app, lang) => {
        await scanAndGoLive(app, lang);
        await holdStopAfterLive(lang);
      },
    },
    {
      name: 'a fatal end',
      lines: ['stream.status.endedFatal'],
      arrive: async (app, lang) => {
        await scanAndGoLive(app, lang);
        act(() => app.engine.scene('fatal'));
        await flush();
      },
    },
    {
      name: 'a Stop over a 401',
      lines: ['stream.status.endedOperator', 'panel.codeEnded.body'],
      arrive: async (app, lang) => {
        await scanAndGoLive(app, lang);
        act(() => app.engine.hear({ word: 'code-ended' }));
        await holdStopAfterLive(lang);
      },
    },
    {
      name: 'a fatal end over a 401',
      lines: ['home.ended.failed', 'panel.codeEnded.body'],
      arrive: async (app, lang) => {
        await scanAndGoLive(app, lang);
        act(() => app.engine.hear({ word: 'code-ended' }));
        act(() =>
          app.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: 754_000 }),
        );
        await flush();
      },
    },
  ];
  const CASES = LANGS.flatMap((lang) =>
    VARIANTS.map((variant) => [lang, variant.name, variant] as const),
  );

  it('sweeps four variants in four languages', () => {
    expect(VARIANTS).toHaveLength(4);
    expect(CASES).toHaveLength(16);
  });

  it.each(CASES)('%s: %s', async (lang, _name, variant) => {
    const app = await launchApp({ kvSeed: { [STORE_KEYS.lang]: lang } });
    await variant.arrive(app, lang);
    expect(app.nav.current()).toBe('home');
    const say = (key: string) => DICTIONARIES[lang][key] ?? '';
    const title = say('home.ended.title');
    // The region is named by the language's title, and its texts are the dictionary's own.
    const named = screen.getByRole('region', { name: title });
    // Time on air through the dictionary's template; formatElapsed is the language-free H:MM:SS.
    const onAir = say('stream.ended.duration').replace('{duration}', '0:12:34');
    expect(textsIn(named)).toEqual([title, onAir, ...variant.lines.map(say), say('home.ended.ok')]);
    for (const text of textsIn(named)) expect(text).not.toMatch(/\b(home|stream|panel)\.[a-z]+/);
  });
});
