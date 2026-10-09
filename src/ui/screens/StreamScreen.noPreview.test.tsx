import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { createFakeSurfaces } from '../../../test/fakeSurfaces';
import { renderViewfinder } from '../../../test/renderViewfinder';

const DICTIONARIES = { en, es, fr, nl } as const;

/**
 * The two captions as they read before D2, copied here because the dictionaries no longer hold them: Score ahead, then
 * the failed preview.
 */
const REMOVED_COPY = {
  en: [
    'You see the score slightly ahead of viewers',
    'Score preview failed — the broadcast is not affected',
  ],
  es: [
    'Ves el marcador un poco antes que el público',
    'Falló la vista previa del marcador: la emisión sigue',
  ],
  fr: [
    'Vous voyez le score un peu avant le public',
    'Aperçu du score en panne\u00a0: le direct continue',
  ],
  nl: [
    'Je ziet de score iets eerder dan de kijkers',
    'Scorevoorbeeld mislukt: de stream loopt door',
  ],
} as const;

/** Every test id drawn inside the camera box, in document order. */
const drawnInBox = () =>
  Array.from(screen.getByTestId('camera-box').querySelectorAll('[data-testid]')).map((element) =>
    element.getAttribute('data-testid'),
  );

/**
 * D2 §4.1 (R1, owner 2026-10-08, "Ok remove"): the phone draws no score. The surfaces port has no overlay, and the
 * stage says nothing of one, paired or on air, in each of the four languages. The native port's own shape is pinned in
 * nativeSurfaces.test.tsx: a UI test never loads a native service (eslint.config.mjs).
 */
describe('the stage draws no score preview (D2 §4.1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('has no overlay surface: the port is the preview and the viewers’ video', async () => {
    expect('Overlay' in createFakeSurfaces()).toBe(false);
    const view = await renderViewfinder();
    expect('Overlay' in view.ports.surfaces).toBe(false);
    expect(['Preview', 'Video'].every((name) => name in view.ports.surfaces)).toBe(true);
  });

  it.each(['en', 'es', 'fr', 'nl'] as const)(
    '%s: the box draws the preview alone and the strip says no score caption, paired or on air',
    async (lang) => {
      // A quiet phone: before D2 a paired one said Score ahead in the strip's one line.
      const view = await renderViewfinder({ deviceLanguages: [lang] }, { quiet: true });
      const said = () => screen.getByTestId('status-strip').textContent ?? '';
      expect(drawnInBox()).toEqual(['preview']);
      for (const copy of REMOVED_COPY[lang]) expect(said()).not.toContain(copy);
      act(() => view.engine.scene('live'));
      expect(drawnInBox()).toEqual(['preview']);
      expect(within(screen.getByTestId('camera-half')).queryByTestId('overlay')).toBeNull();
      for (const copy of REMOVED_COPY[lang]) expect(said()).not.toContain(copy);
      // The two captions went with the preview: their keys are gone from this language's dictionary.
      const dictionary: Record<string, string> = DICTIONARIES[lang];
      expect('stream.advisory.scoreAhead' in dictionary).toBe(false);
      expect('stream.advisory.overlayFailed' in dictionary).toBe(false);
    },
  );
});
