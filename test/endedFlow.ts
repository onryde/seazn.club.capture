import { act, screen } from '@testing-library/react';
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
export async function holdControl(name: string): Promise<void> {
  pressIn(screen.getByRole('button', { name }));
  await flush(HOLD_MS);
  await flush();
}

/** The Stop of a broadcast that went live: it says it unpairs too. */
export const holdStopAfterLive = (lang: Lang = 'en') =>
  holdControl(DICTIONARIES[lang]['stream.action.stopUnpairLabel'] ?? '');
