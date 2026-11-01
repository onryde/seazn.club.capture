import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gravity } from '@/domain/orientation/orientation';
import en from '@/i18n/en.json';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const scoringTile = () => screen.getByRole('button', { name: new RegExp(en['mode.scoring']) });
const topScore = (points: number) =>
  within(screen.getByTestId('half-first')).queryByText(String(points)) !== null;

/**
 * The dev twin's Home, its Remote scoring tile tapped: the pad on its own route, its match started from the Start
 * screen (owner, 2026-11-01), A. Sharma serving first.
 */
async function openPreview(): Promise<LaunchedApp> {
  const app = await launchApp({ previewScoring: true });
  fireEvent.click(scoringTile());
  await flush();
  fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' }));
  fireEvent.click(screen.getByRole('button', { name: en['scoring.start.confirm'] }));
  await flush();
  return app;
}

/** Android Back, flushed as the phone delivers it. */
async function back(app: LaunchedApp): Promise<boolean> {
  let handled = false;
  act(() => {
    handled = app.back.press();
  });
  await flush();
  return handled;
}

const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));

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
    // The samples begin not started (owner, 2026-11-01): the Start screen.
    expect(screen.getByTestId('start-screen')).toBeTruthy();
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

  it('Back returns Home, and the next visit finds the match where it was', async () => {
    const app = await openPreview();
    fireEvent.click(screen.getByTestId('half-first'));
    expect(await back(app)).toBe(true);
    expect(app.nav.current()).toBe('home');
    fireEvent.click(scoringTile());
    await flush();
    expect(topScore(1)).toBe(true);
  });

  it('Back leaves the ending prompt for Home (owner ruling 10), and the prompt is up again on the return', async () => {
    const app = await openPreview();
    press(`${en['scoring.badminton.tool.sanction']}, L. Chen`);
    press(en['scoring.sanction.disqualification']);
    press('L. Chen');
    press(en['scoring.sanction.confirm.action']);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
    expect(await back(app)).toBe(true);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
    fireEvent.click(scoringTile());
    await flush();
    expect(screen.getByTestId('ending-prompt').textContent).toContain(
      en['scoring.ending.title'].replace('{person}', 'L. Chen'),
    );
    press(en['scoring.ending.void']);
    expect(screen.queryByTestId('ending-prompt')).toBeNull();
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

const tilted = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad), z: 0 };
};

/** One reading held 400 ms, sampled every 100 ms, as the phone sends it. */
function hold(app: LaunchedApp, g: Gravity, fromMs: number) {
  act(() => {
    for (let t = 0; t <= 400; t += 100) app.motion.emit(g, fromMs + t);
  });
}

/**
 * Remote Scoring is portrait (decision record ruling 4; owner layout A): sideways at 728 × 328 its halves would get
 * about 1 dp each. Under the root layout's gate, held sideways, the turn-upright card covers the pad, locked to the
 * hands so it reads upright; turned upright, the card goes and the pad locks portrait.
 */
describe('the Remote scoring preview, held sideways', () => {
  const upright = () => screen.queryByLabelText(en['turn.upright.title']);

  it('asks for the phone upright, and locks portrait once it is', async () => {
    const app = await launchApp({ previewScoring: true, gated: true });
    hold(app, tilted(90), 0);
    await flush();
    expect(upright()).toBeNull();
    fireEvent.click(scoringTile());
    await flush();
    expect(app.nav.current()).toBe('scoringPreview');
    expect(upright()).not.toBeNull();
    expect(app.orientationLock.locks.at(-1)).toBe('landscape');
    hold(app, tilted(0), 1000);
    await flush();
    expect(upright()).toBeNull();
    expect(app.orientationLock.locks.at(-1)).toBe('portrait');
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });

  it('follows the phone again back on Home', async () => {
    const app = await launchApp({ previewScoring: true, gated: true });
    fireEvent.click(scoringTile());
    await flush();
    hold(app, tilted(0), 0);
    await flush();
    expect(app.orientationLock.locks.at(-1)).toBe('portrait');
    expect(await back(app)).toBe(true);
    expect(app.orientationLock.locks.at(-1)).toBe('free');
    hold(app, tilted(90), 1000);
    await flush();
    expect(upright()).toBeNull();
  });
});
