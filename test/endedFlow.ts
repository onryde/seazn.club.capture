import { act, screen } from '@testing-library/react';
import { expect } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import type { Lang } from '@/i18n/language';
import nl from '@/i18n/nl.json';
import { captureRaw, epochSeconds } from './fixtures/wire';
import { TEST_NOW } from './fakePorts';
import { pressIn } from './press';
import { flush, type LaunchedApp } from './routedApp';

/** The copy a language shows, read from its dictionary and never through `t()` (AGENTS §10). */
export const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  en,
  es,
  fr,
  nl,
};

/** A code good for two hours of the ports' clock, so no test of the card trips on an expiry. */
export const CODE = captureRaw({ exp: epochSeconds(new Date(TEST_NOW.getTime() + 2 * 3600_000)) });

/** The card's region, by the name its title gives it (`home.ended.title`, English). */
export const endedRegion = () => screen.queryByRole('region', { name: 'Stream ended' });

/** Every text the element shows, in document order, one entry per text node. */
export function textsIn(element: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    texts.push(node.textContent ?? '');
  }
  return texts;
}

/** Whether `first` comes before `second` in the document. */
export const comesBefore = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** Scan the code from Home's Live Stream tile, then the fake reports it on air (`ON_AIR_MS`, 0:12:34). */
export async function scanAndGoLive(app: LaunchedApp, lang: Lang = 'en'): Promise<void> {
  app.scanner.queue({ outcome: 'scanned', raw: CODE });
  const tile = new RegExp(DICTIONARIES[lang]['mode.stream'] ?? '');
  act(() => screen.getByRole('button', { name: tile }).click());
  await flush(200);
  act(() => app.engine.scene('live'));
  await flush();
}

/** Hold the named control for its full time and let what follows run, as a thumb does. */
export async function holdControl(name: string | RegExp): Promise<void> {
  pressIn(screen.getByRole('button', { name }));
  await flush(HOLD_MS);
  await flush();
}

/** The Stop of a broadcast that went live: it says it unpairs too. */
export const holdStopAfterLive = (lang: Lang = 'en') =>
  holdControl(DICTIONARIES[lang]['stream.action.stopUnpairLabel'] ?? '');

/**
 * A Stop before the first frame over a 401 (D7): scan, the organiser's Go live with the camera not ready (Armed,
 * never live), the server says the code has ended (deferred to the Stop, so `codeEndedPending`), and the operator
 * stops. The fake's `stop` is native's: held past a 401 the Stop ends the pairing (Ended, never live) and does not
 * go back to Paired. The label is read by its start, whichever way it says what a Stop does.
 */
export async function stopBeforeLiveOver401(app: LaunchedApp): Promise<void> {
  app.scanner.queue({ outcome: 'scanned', raw: CODE });
  act(() => screen.getByRole('button', { name: /Live Stream/ }).click());
  await flush(200);
  act(() => app.engine.setReady({ camera: false }));
  act(() => app.engine.hear({ word: 'go-live', cause: 'organiser' }));
  await flush();
  expect(app.engine.getSnapshot().state.kind).toBe('armed');
  act(() => app.engine.hear({ word: 'code-ended' }));
  expect(app.engine.getSnapshot().codeEndedPending).toBe(true);
  await holdControl(/^Hold to stop/);
}
