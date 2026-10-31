import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const scoringTile = () => screen.getByRole('button', { name: new RegExp(en['mode.scoring']) });
const topScore = (points: number) =>
  within(screen.getByTestId('half-first')).queryByText(String(points)) !== null;

/** The dev twin's Home, its Remote scoring tile tapped: the pad on its own route. */
async function openPreview(): Promise<LaunchedApp> {
  const app = await launchApp({ previewScoring: true });
  fireEvent.click(scoringTile());
  await flush();
  return app;
}

/**
 * S2's design preview as the app routes it (the controller's brief, 2026-10-31): Home's tile opens it, it is Home's
 * own sub-screen (no code, no mode), Back and Home return, and a broadcast still moves the phone to Live Stream.
 */
describe('the Remote scoring preview, routed', () => {
  it('opens from the tile with one move of the router, for a double tap too', async () => {
    const app = await launchApp({ previewScoring: true });
    act(() => {
      scoringTile().click();
      scoringTile().click();
    });
    await flush();
    expect(app.nav.current()).toBe('scoringPreview');
    expect(app.nav.history).toEqual(['scoringPreview']);
    expect(screen.getByTestId('half-first')).toBeTruthy();
  });

  it('stays put on a return to the foreground, the match where it was', async () => {
    const app = await openPreview();
    fireEvent.click(screen.getByTestId('half-first'));
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('scoringPreview');
    expect(topScore(1)).toBe(true);
  });

  it('Back returns Home, and the next visit starts afresh', async () => {
    const app = await openPreview();
    fireEvent.click(screen.getByTestId('half-first'));
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
    fireEvent.click(scoringTile());
    await flush();
    expect(topScore(0)).toBe(true);
  });

  it('a sheet takes Back first: the pad stays', async () => {
    const app = await openPreview();
    fireEvent.click(screen.getByRole('button', { name: en['scoring.badminton.tool.setScore'] }));
    act(() => {
      app.back.press();
    });
    await flush();
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(app.nav.current()).toBe('scoringPreview');
  });

  it('moves to Live Stream when a broadcast starts remotely, as from Home (A2)', async () => {
    const app = await launchApp({
      previewScoring: true,
      prepare: (fakes) => fakes.engine.scene('paired-ready'),
    });
    fireEvent.click(scoringTile());
    await flush();
    expect(app.nav.current()).toBe('scoringPreview');
    act(() => app.engine.scene('live'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });
});
