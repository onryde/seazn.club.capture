import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seaznQrPlan } from '@/domain/qr/seaznQr';
import type { SessionState } from '@/domain/session/SessionState';
import en from '@/i18n/en.json';
import { SCORING_SHOW_MS, SCORING_SHOW_SECONDS } from '@/hooks/useScoringLink';
import type { ScoringLinkOutcome } from '@/services/scoringLinkPort';
import { layout } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from '../../../test/fakeScoringLinkPort';
import { captureRaw } from '../../../test/fixtures/wire';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { pressIn } from '../../../test/press';
import { pathDigest } from '../../../test/qrDigest';
import { renderViewfinder } from '../../../test/renderViewfinder';

/**
 * The Remote scoring button, hook and panel through the real screen (spec §10, Q-C2): a saved code, the fake engine,
 * the fake scoring port, and the real hook mounted by the real StreamScreen. The copy is read from `en`, never typed.
 */

const OPEN = en['stream.scoring.open'];
const byId = (id: string) => screen.getByTestId(id);
const button = () => within(byId('icon-row')).getByRole('button', { name: OPEN });
const stopLive = () => screen.getByRole('button', { name: 'Hold to stop and unpair' });
const buttonNames = (row: HTMLElement) =>
  within(row)
    .getAllByRole('button')
    .map((each) => each.getAttribute('aria-label') ?? each.textContent);
const refused = (
  word: Extract<ScoringLinkOutcome, { kind: 'refused' }>['word'],
  retryAfterS: number | null = null,
): ScoringLinkOutcome => ({ kind: 'refused', word, retryAfterS });
const hidesIn = (seconds: number) =>
  en['stream.scoring.hidesIn'].replace('{seconds}', String(seconds));

type Viewfinder = Awaited<ReturnType<typeof renderViewfinder>>;
/** A tap, then the fake's already-resolved promise lands. */
const tap = (): Promise<void> => act(async () => void fireEvent.click(button()));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Remote scoring through the screen (spec §10, Q-C2)', () => {
  it('1: before air a tap asks, shows the code over the camera half (never the controls half), and hides after 10 s', async () => {
    const view = await renderViewfinder();
    expect(button()).toBeTruthy();
    await tap();
    expect(view.scoringLink.calls).toBe(1);
    const panel = byId('scoring-panel');
    expect(byId('camera-half').contains(panel)).toBe(true);
    expect(byId('controls-half').contains(panel)).toBe(false);
    expect(within(panel).getByTestId('seazn-qr')).toBeTruthy();
    // Q-C2: the controls are never covered. Go live is right there in the controls half.
    expect(
      within(byId('controls-half')).getByRole('button', {
        name: 'Go live. Press and hold for 3 seconds.',
      }),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    expect(screen.queryByTestId('seazn-qr')).toBeNull();
  });

  it('2: on air the same, and with the code up the Stop hold still works', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    await tap();
    expect(view.scoringLink.calls).toBe(1);
    const panel = byId('scoring-panel');
    expect(byId('camera-half').contains(panel)).toBe(true);
    expect(byId('controls-half').contains(panel)).toBe(false);
    pressIn(stopLive());
    expect(byId('hold-fill').dataset.holding).toBe('true');
    // The panel is still up while the hold runs: nothing about Stop closed it.
    expect(screen.queryByTestId('scoring-panel')).not.toBeNull();
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
  });

  it('3: the panel appears in the camera half and replaces nothing in the controls half', async () => {
    await renderViewfinder();
    const before = buttonNames(byId('controls-half'));
    const textBefore = byId('controls-half').textContent;
    await tap();
    expect(byId('scoring-panel')).toBeTruthy();
    expect(buttonNames(byId('controls-half'))).toEqual(before);
    expect(byId('controls-half').textContent).toBe(textBefore);
    expect(before).toContain(OPEN);
    expect(before.length).toBeGreaterThan(3);
  });

  it('4: a refusal is shown in the camera half with its sentence and no code', async () => {
    const view = await renderViewfinder();
    view.scoringLink.answerWith(refused('replaced'));
    await tap();
    const panel = byId('scoring-panel');
    expect(within(panel).getByText(en['stream.scoring.refused.replaced'])).toBeTruthy();
    expect(byId('camera-half').contains(panel)).toBe(true);
    expect(screen.queryByTestId('seazn-qr')).toBeNull();
  });

  it('5: where it is not offered: an idle engine, and the Ended frame (the positive pairs are 1 and 2)', async () => {
    await renderViewfinder({}, { engine: 'idle' });
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
    expect(screen.getByRole('button', { name: en['stream.link.settings'] })).toBeTruthy(); // the row is not empty
  });

  it('5b: the Ended frame offers no Remote scoring, though it did a moment before', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    expect(button()).toBeTruthy();
    act(() => view.engine.scene('stopped'));
    expect(screen.queryByRole('button', { name: OPEN })).toBeNull();
  });

  it('6: leaving the foreground mid-countdown hides it, and the countdown stops', async () => {
    const view = await renderViewfinder();
    await tap();
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByTestId('scoring-countdown').textContent).toBe(hidesIn(7));
    act(() => view.foreground.leave());
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
  });
});

describe('the sequence (Review Focus 3)', () => {
  it('tap, Hide, tap: the second tap asks again and the code is back', async () => {
    const view = await renderViewfinder();
    await tap();
    fireEvent.click(
      within(byId('scoring-panel')).getByRole('button', { name: en['stream.scoring.hide'] }),
    );
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    await tap();
    expect(view.scoringLink.calls).toBe(2);
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr')).toBeTruthy();
  });

  it('an answer arriving after Hide is dropped: the code never appears', async () => {
    const view = await renderViewfinder();
    view.scoringLink.hold();
    await tap();
    expect(within(byId('scoring-panel')).getByText(en['stream.scoring.asking'])).toBeTruthy();
    fireEvent.click(
      within(byId('scoring-panel')).getByRole('button', { name: en['stream.scoring.hide'] }),
    );
    await act(async () => view.scoringLink.release());
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    expect(screen.queryByTestId('seazn-qr')).toBeNull();
  });

  it('the pairing changing while the code is up takes the code down', async () => {
    const view = await renderViewfinder();
    await tap();
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr')).toBeTruthy();
    act(() => pairCode(view.engine, savedStreamCode({ raw: captureRaw({ slot: 2 }), slot: 2 })));
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
  });

  it('a rate limit, then waiting, then a tap: the sentence with its number, then the code once the wait is over', async () => {
    const view = await renderViewfinder();
    const t0 = view.ports.clock().getTime();
    view.scoringLink.answerWith(refused('rate_limited', 30));
    await tap();
    expect(
      within(byId('scoring-panel')).getByText(
        en['stream.scoring.refused.rateLimited'].replace('{seconds}', '30'),
      ),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    view.setNow(new Date(t0 + 29_000));
    await tap();
    expect(view.scoringLink.calls).toBe(1); // not asked again
    expect(
      within(byId('scoring-panel')).getByText(
        en['stream.scoring.refused.rateLimited'].replace('{seconds}', '1'),
      ),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    view.setNow(new Date(t0 + 30_000));
    view.scoringLink.answerWith({ kind: 'ok', url: FAKE_SCORING_URL });
    await tap();
    expect(view.scoringLink.calls).toBe(2);
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr')).toBeTruthy();
  });

  it('the url is in no markup the screen renders', async () => {
    const view: Viewfinder = await renderViewfinder();
    await tap();
    expect(view.container.innerHTML).not.toContain(FAKE_SCORING_SECRET);
    expect(view.container.innerHTML).not.toContain('/score/dl_');
  });
});

// B3 (owner-approved board ruling): the countdown in the bottom row, beside Hide, 10 down to 1.
describe('the countdown through the screen (B3)', () => {
  it('reads 10, 9 … 1 beside Hide, the bar shrinking by a tenth a second, and the code is gone at the tenth second', async () => {
    await renderViewfinder();
    await tap();
    const bottom = byId('scoring-bottom');
    const seen: string[] = [];
    const bars: string[] = [];
    for (let second = 0; second < SCORING_SHOW_SECONDS; second += 1) {
      seen.push(within(bottom).getByTestId('scoring-countdown').textContent ?? '');
      bars.push(getComputedStyle(within(bottom).getByTestId('scoring-bar-fill')).width);
      expect(within(bottom).getByRole('button', { name: en['stream.scoring.hide'] })).toBeTruthy();
      act(() => vi.advanceTimersByTime(1_000));
    }
    // Written from the board, not read from the code: "Hides in 10 s" down to "Hides in 1 s".
    expect(seen).toEqual(
      ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'].map((n) => `Hides in ${n} s`),
    );
    expect(bars).toEqual(['100%', '90%', '80%', '70%', '60%', '50%', '40%', '30%', '20%', '10%']);
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
  });

  it('Hide stops the count: no tick is left, and a later tap starts again from 10', async () => {
    await renderViewfinder();
    await tap();
    act(() => vi.advanceTimersByTime(4_000));
    expect(byId('scoring-countdown').textContent).toBe(hidesIn(6));
    fireEvent.click(
      within(byId('scoring-panel')).getByRole('button', { name: en['stream.scoring.hide'] }),
    );
    expect(screen.queryByTestId('scoring-countdown')).toBeNull();
    await tap();
    expect(byId('scoring-countdown').textContent).toBe(hidesIn(10));
  });
});

// B5 (owner-approved board ruling): the button is pressed in while the panel shows.
describe('the button is pressed in while the panel shows (B5)', () => {
  it('unselected, then selected from the tap until the panel goes, then unselected again', async () => {
    const view = await renderViewfinder();
    const outline = () => getComputedStyle(button()).borderTopWidth;
    expect(button().getAttribute('aria-selected')).toBe('false');
    expect(outline()).toBe(`${layout.iconBorder}px`);
    view.scoringLink.hold();
    await tap(); // asking: the panel is up
    expect(button().getAttribute('aria-selected')).toBe('true');
    expect(outline()).toBe('2px');
    await act(async () => view.scoringLink.release());
    expect(button().getAttribute('aria-selected')).toBe('true'); // shown
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(button().getAttribute('aria-selected')).toBe('false');
    expect(outline()).toBe(`${layout.iconBorder}px`);
  });

  it('is selected for a refusal too, and goes back on Hide', async () => {
    const view = await renderViewfinder();
    view.scoringLink.answerWith(refused('unavailable'));
    await tap();
    expect(byId('scoring-panel')).toBeTruthy();
    expect(button().getAttribute('aria-selected')).toBe('true');
    fireEvent.click(
      within(byId('scoring-panel')).getByRole('button', { name: en['stream.scoring.hide'] }),
    );
    expect(button().getAttribute('aria-selected')).toBe('false');
  });
});

// B6 (owner-approved board ruling): the status line is the engine's, and the panel does not override it.
describe('the status line is not overridden (B6)', () => {
  it('a reconnecting warning stays in the strip while the code is up', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('holding'));
    // R8a hides the panel when trouble is ENTERED. Here the trouble stood before the tap, so the tap is honoured.
    const warning = 'Uplink lost — holding, 38 s of 183';
    expect(within(byId('status-strip')).getByText(warning)).toBeTruthy();
    await tap();
    expect(byId('scoring-panel')).toBeTruthy();
    expect(within(byId('status-strip')).getByText(warning)).toBeTruthy();
    // And the panel says nothing of the stream: its words are its own.
    expect(within(byId('scoring-panel')).queryByText(warning)).toBeNull();
  });
});

// Review: the code on the screen is the code of the link the port ANSWERED, not merely "a code of the same size".
describe('the drawn code is the answered link’s', () => {
  const digestOf = (url: string) => pathDigest(seaznQrPlan(url).path);

  it('a tap draws the answered link, and a different answer after Hide draws that one', async () => {
    const view = await renderViewfinder();
    const other = `https://stg.seazn.club/score/dl_${'Z'.repeat(43)}`;
    expect(other).toHaveLength(FAKE_SCORING_URL.length); // same version, same modules: only the path differs
    const first = digestOf(FAKE_SCORING_URL);
    const second = digestOf(other);
    expect(second).not.toBe(first);

    await tap();
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr').dataset.digest).toBe(first);
    fireEvent.click(
      within(byId('scoring-panel')).getByRole('button', { name: en['stream.scoring.hide'] }),
    );
    view.scoringLink.answerWith({ kind: 'ok', url: other });
    await tap();
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr').dataset.digest).toBe(second);
    expect(view.scoringLink.calls).toBe(2);
  });
});

// R8a (controller ruling): the opaque panel covers the status strip, so a session ENTERING trouble takes it down.
describe('trouble takes the panel down (R8a)', () => {
  type View = Awaited<ReturnType<typeof renderViewfinder>>;
  /** `ms` after the test's clock, with the 1 s tick that re-reads it (`useClockTick`). */
  const later = (view: View, ms: number) =>
    act(() => {
      view.setNow(new Date(TEST_NOW.getTime() + ms));
      vi.advanceTimersByTime(1_000);
    });
  const state = (each: SessionState) => each;
  /** The three states the plate shows as TROUBLE: Degraded, Reconnecting, and an engine gone silent. */
  const TROUBLES: readonly (readonly [string, (view: View) => void, string])[] = [
    [
      'degraded',
      (view) =>
        act(() =>
          view.engine.forceState(
            state({ kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 }),
          ),
        ),
      en['stream.status.weakSignal'],
    ],
    [
      'reconnecting',
      (view) =>
        act(() =>
          view.engine.forceState(
            state({
              kind: 'reconnecting',
              cause: 'uplink-lost',
              holdRemainingSeconds: 30,
              holdWindowSeconds: 60,
              sinceEpochMs: 1,
            }),
          ),
        ),
      en['stream.status.holding'].replace('{remaining}', '30').replace('{window}', '60'),
    ],
    [
      'engine silent',
      (view) => {
        act(() => view.engine.suspend());
        later(view, 3_001);
      },
      en['stream.status.engineSilent'],
    ],
  ];
  const plate = () => byId('tally-plate').textContent;
  let checked = 0;

  it.each(TROUBLES.map(([name, enter, line]) => [name, enter, line] as const))(
    '%s: entering it hides a shown code and a code being asked for, and the strip’s warning is visible',
    async (name, enter, line) => {
      // shown
      const shown = await renderViewfinder();
      act(() => shown.engine.scene('live'));
      await tap();
      expect(byId('scoring-panel')).toBeTruthy();
      enter(shown);
      expect(plate(), name).toBe(en['stream.tally.trouble']);
      expect(screen.queryByTestId('scoring-panel'), name).toBeNull();
      expect(button().getAttribute('aria-selected')).toBe('false');
      expect(within(byId('status-strip')).getByText(line), name).toBeTruthy();
      shown.unmount();

      // asking: the answer that lands after the entry is dropped
      const asking = await renderViewfinder();
      act(() => asking.engine.scene('live'));
      asking.scoringLink.hold();
      await tap();
      expect(within(byId('scoring-panel')).getByText(en['stream.scoring.asking'])).toBeTruthy();
      enter(asking);
      expect(screen.queryByTestId('scoring-panel'), name).toBeNull();
      await act(async () => asking.scoringLink.release());
      expect(screen.queryByTestId('scoring-panel'), name).toBeNull();
      expect(screen.queryByTestId('seazn-qr'), name).toBeNull();
      checked += 1;
    },
  );

  it('counted three troubles, each in both legs (anti-vacuity)', () => {
    expect(TROUBLES).toHaveLength(3);
    expect(checked).toBe(3);
  });

  it('after the trouble the next tap shows the code again (the sequence)', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    await tap();
    TROUBLES[1]?.[1](view);
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    act(() => view.engine.scene('live'));
    expect(plate()).toBe(en['stream.tally.live']);
    await tap();
    expect(view.scoringLink.calls).toBe(2);
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr')).toBeTruthy();
  });

  it('the negative pair: a calm change of state (paired to live) leaves the code up', async () => {
    const view = await renderViewfinder();
    await tap();
    expect(byId('scoring-panel')).toBeTruthy();
    act(() => view.engine.scene('live'));
    expect(plate()).toBe(en['stream.tally.live']);
    expect(within(byId('scoring-panel')).getByTestId('seazn-qr')).toBeTruthy();
  });
});

describe('where the panel sits', () => {
  it('is the last child of the camera half, so it paints over the box and the strip', async () => {
    await renderViewfinder();
    await tap();
    const half = byId('camera-half');
    expect(half.lastElementChild).toBe(byId('scoring-panel'));
    expect(half.contains(byId('camera-box'))).toBe(true);
    expect(half.contains(byId('status-strip'))).toBe(true);
  });
});
