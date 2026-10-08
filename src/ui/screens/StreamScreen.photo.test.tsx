import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { PHOTO_NOTICE_MS } from '@/hooks/usePhoto';
import { PHOTO_DEADLINE_MS, createPhotoPort } from '@/services/photoPort';
import { colour } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { renderViewfinder } from '../../../test/renderViewfinder';

const shutter = () => screen.getByRole('button', { name: en['stream.photo.label'] });

/** Which token a Text painted: the `paintOf` of the layout test, so a colour is compared as jsdom resolves it. */
const TOKEN = StyleSheet.create({
  caution: { color: colour.caution },
});

function inkOf(style: TextStyle): string {
  const reference = render(
    <Text testID="ink-reference" style={style}>
      x
    </Text>,
  );
  const painted = getComputedStyle(reference.getByTestId('ink-reference')).color;
  reference.unmount();
  return painted;
}

describe('Take photo in the icon row (spec §8, R3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('M18 a tap saves, says so in the gap above the row for 3 s, and sits nowhere over the camera', async () => {
    const view = await renderViewfinder();
    await act(async () => fireEvent.click(shutter()));
    expect(view.photo.calls).toBe(1);
    const note = screen.getByTestId('photo-notice');
    expect(note.textContent).toBe(en['stream.photo.saved']);
    expect(within(screen.getByTestId('controls-gap')).getByTestId('photo-notice')).toBe(note);
    expect(within(screen.getByTestId('camera-box')).queryByTestId('photo-notice')).toBeNull();
    act(() => vi.advanceTimersByTime(PHOTO_NOTICE_MS));
    expect(screen.queryByTestId('photo-notice')).toBeNull();
  });

  it('M20 a failure is said in caution, not lime', async () => {
    const view = await renderViewfinder();
    view.photo.answerWith('failed');
    await act(async () => fireEvent.click(shutter()));
    const note = screen.getByTestId('photo-notice');
    expect(note.textContent).toBe(en['stream.photo.failed']);
    expect(getComputedStyle(note).color).toBe(inkOf(TOKEN.caution));
    expect(colour.caution).not.toBe(colour.lime);
  });

  it('a tap while a photo is saving does nothing, on the screen too', async () => {
    const view = await renderViewfinder();
    view.photo.hold();
    await act(async () => fireEvent.click(shutter()));
    await act(async () => fireEvent.click(shutter()));
    expect(view.photo.calls).toBe(1);
    expect(screen.queryByTestId('photo-notice')).toBeNull();
    await act(async () => view.photo.release('saved'));
    expect(screen.getByTestId('photo-notice').textContent).toBe(en['stream.photo.saved']);
  });

  it('native never answering is a failed photo at 4 s, through the real port, hook and screen', async () => {
    // The seam, driven through its real producer and consumer: the port is the production one over a call that never settles.
    await renderViewfinder({ photo: createPhotoPort(() => new Promise(() => undefined)) });
    await act(async () => fireEvent.click(shutter()));
    await act(() => vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS - 1));
    expect(screen.queryByTestId('photo-notice')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByTestId('photo-notice').textContent).toBe(en['stream.photo.failed']);
  });

  // The module's own word, from the fake module the production port reads, to the line: saved is saved, and every
  // other thing the module could say is a failed photo.
  const ANSWERS = [
    ['saved', 'stream.photo.saved'],
    ['failed', 'stream.photo.failed'],
    ['busy', 'stream.photo.failed'],
    [null, 'stream.photo.failed'],
  ] as const;
  let answered = 0;

  it.each(ANSWERS)(
    'the module answering %j is said as %s, through the real port, hook and screen',
    async (answer, key) => {
      const module = new FakeNativeModule();
      module.photoAnswer = answer;
      await renderViewfinder({ photo: createPhotoPort(() => module.takePhoto()) });
      await act(async () => fireEvent.click(shutter()));
      expect(module.photoCalls).toBe(1);
      expect(screen.getByTestId('photo-notice').textContent).toBe(en[key]);
      answered += 1;
    },
  );

  it('answered all four words (anti-vacuity)', () => {
    expect(ANSWERS).toHaveLength(4);
    expect(answered).toBe(4);
  });

  it('M19 the gap keeps a line of height for the line, at the bottom, in a live region (production style)', async () => {
    await renderViewfinder();
    const gap = screen.getByTestId('controls-gap');
    // The production style, read from the rendered gap: deleting it from StreamColumn reds this, not a test constant.
    expect(getComputedStyle(gap).minHeight).toBe(`${typeScale.metricUnit.lineHeight}px`);
    expect(getComputedStyle(gap).justifyContent).toBe('flex-end');
    expect(gap.getAttribute('aria-live')).toBe('polite');
    expect(typeScale.metricUnit.lineHeight).toBe(16);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('reads in %s', async (code, dictionary) => {
    const view = await renderViewfinder({ deviceLanguages: [code] });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: dictionary['stream.photo.label'] })),
    );
    expect(view.photo.calls).toBe(1);
    expect(screen.getByTestId('photo-notice').textContent).toBe(dictionary['stream.photo.saved']);
  });
});
