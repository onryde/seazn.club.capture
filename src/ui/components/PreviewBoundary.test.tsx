import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { crashPreviewUntilShown, disarmPreviewCrash } from '@/ui/components/PreviewBoundary';
import { readRecord } from '../../../test/fakePorts';
import { renderViewfinder } from '../../../test/renderViewfinder';

// test/setup-ui.ts does not silence React's error log; each crash below would print it.
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errors.mockRestore();
  disarmPreviewCrash(); // review C7 M-11: the dev crash is module state; a case that arms it never leaks it
});

const live = (lang?: 'es' | 'fr' | 'nl') =>
  renderViewfinder(lang ? { deviceLanguages: [lang] } : {}, {
    prepare: (fakes) => {
      fakes.engine.scene('live');
      fakes.surfaces.crashPreview();
    },
  });

/**
 * The text as Testing Library reads a node: its default normalizer folds every run of whitespace,
 * French's no-break space before a colon included, while a string matcher is compared as given.
 */
const read = (text: string) => text.replace(/\s+/g, ' ');

/** The Stop hold's accessible name while on air, as StreamScreen.onAir.test.tsx finds it. */
const STOP = en['stream.action.stopUnpairLabel'];

const crashes = (view: Awaited<ReturnType<typeof live>>) =>
  readRecord(view.record).filter((entry) => entry.event === 'preview.crashed');

it('CD19 a preview crash shows the caption and keeps the column: plate, line and Stop', async () => {
  const view = await live();
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(screen.getByTestId('tally-plate')).toBeTruthy();
  expect(screen.getByText(en['stream.status.live'])).toBeTruthy();
  expect(screen.getByRole('button', { name: STOP })).toBeTruthy();
  expect(screen.queryByText('Something broke')).toBeNull();
  expect(crashes(view)).toEqual([expect.objectContaining({ fields: { count: 1 } })]);
});

it('I4 Show preview brings the preview back; a second crash shows the caption again, counted', async () => {
  const view = await live();
  act(() => view.surfaces.restorePreview());
  fireEvent.click(screen.getByText(en['stream.preview.show']));
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(screen.queryByText(en['stream.preview.stopped'])).toBeNull();
  act(() => view.surfaces.crashPreview());
  // A re-render that reaches the throwing preview. `engine.scene('live')` does not: the stage is
  // memoised and nothing it reads changes, so the boundary and Preview never render again. Turning
  // the score preview off changes the stage's own props, and so the boundary's children.
  await act(() => view.ports.streamSettings.set({ overlay: false }));
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(crashes(view).map((entry) => entry.fields)).toEqual([{ count: 1 }, { count: 2 }]);
});

it.each([
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const)('the caption and the button read in %s', async (_lang, dictionary) => {
  await live(_lang);
  expect(screen.getByText(read(dictionary['stream.preview.stopped']))).toBeTruthy();
  expect(screen.getByText(read(dictionary['stream.preview.show']))).toBeTruthy();
});

// PV41: the dev crash throws on every render while armed. React 19 renders the root again,
// synchronously, after an error; a throw on one render alone would recover there, and never reach
// the boundary, so nothing would show and nothing would be counted.
it('PV41 the dev crash reaches the boundary: the caption, a counted line, and Show preview restores', async () => {
  const view = await renderViewfinder({}, { prepare: (fakes) => fakes.engine.scene('live') });
  expect(screen.getByTestId('preview')).toBeTruthy();
  act(() => crashPreviewUntilShown());
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(screen.queryByTestId('preview')).toBeNull();
  expect(screen.getByTestId('tally-plate')).toBeTruthy();
  expect(crashes(view).map((entry) => entry.fields)).toEqual([{ count: 1 }]);
  fireEvent.click(screen.getByText(en['stream.preview.show']));
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(screen.queryByText(en['stream.preview.stopped'])).toBeNull();
  expect(crashes(view)).toHaveLength(1);
});

it('PV41 with dev tools off the dev crash is not mounted, and stays armed until a Show preview', async () => {
  const view = await renderViewfinder({ devTools: false });
  act(() => crashPreviewUntilShown());
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(crashes(view)).toEqual([]);
  cleanup();
  // Armed still: the next viewfinder with dev tools crashes as it mounts, until Show preview.
  const next = await renderViewfinder();
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(crashes(next).map((entry) => entry.fields)).toEqual([{ count: 1 }]);
  fireEvent.click(screen.getByText(en['stream.preview.show']));
  expect(screen.getByTestId('preview')).toBeTruthy();
});

// Review C7 M-11: the dev crash is module state, so a case that arms it and ends must not leak it into the
// next. These two run in this order (vitest runs a file's cases in sequence): the first arms it and ends
// armed; the second starts with the preview showing, which it would not if the first's crash leaked.
it('M-11 (1 of 2) a case may end with the dev crash armed', async () => {
  await renderViewfinder({ devTools: false });
  act(() => crashPreviewUntilShown());
  expect(screen.getByTestId('preview')).toBeTruthy();
});

it('M-11 (2 of 2) the next case starts with the dev crash disarmed', async () => {
  const view = await renderViewfinder();
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(screen.queryByText(en['stream.preview.stopped'])).toBeNull();
  expect(crashes(view)).toEqual([]);
});

it('M-11 disarming leaves the next viewfinder with dev tools uncrashed', async () => {
  act(() => crashPreviewUntilShown());
  disarmPreviewCrash();
  const view = await renderViewfinder();
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(crashes(view)).toEqual([]);
});
