import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { SCORING_POLL_MS } from '@/hooks/useScoringHome';
import { MATCHDAY_KEYS } from '@/services/matchDayStore';
import { colour } from '@/ui/theme/tokens';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, type FakePorts } from '../../../test/fakePorts';
import { edgeOf } from '../../../test/pressState';
import { wrapperFor } from '../../../test/renderWithPorts';
import {
  FAKE_MATCH,
  LINK,
  inMatch,
  leave,
  linkKey,
  queueHolding,
  STORED_LINK,
} from '../../../test/scoringHomeFixtures';

// MD-2 Task 7: the small card Home keeps for the taps Match Day's Exit left sending (S4 design §4, owner 2026-11-07):
// "Sending 3 taps · Court 2", until they land. What it looks like on glass is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => DICTIONARY[lang][key] as string;
const ELSEWHERE = 'fake-doubles';

/** Home over fake ports: Exit's note of the courts, the queues and the links seeded first, as a launch finds them. */
async function homeWith(
  sending: Record<string, string> | null,
  seed: (fakes: FakePorts) => Promise<void> = async () => undefined,
  options: Parameters<typeof createFakePorts>[0] = {},
) {
  const fakes = createFakePorts({
    ...options,
    kvSeed: {
      ...options.kvSeed,
      [linkKey(ELSEWHERE)]: STORED_LINK,
      ...(sending === null ? {} : { [MATCHDAY_KEYS.sending]: JSON.stringify(sending) }),
    },
  });
  await seed(fakes);
  const view = render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  await act(() => vi.advanceTimersByTimeAsync(10));
  return { ...fakes, ...view };
}

const cards = () => screen.queryAllByTestId('matchday-sending');
const leftovers = () => screen.queryAllByTestId('scoring-leftover');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Home after Exit: the Sending card', () => {
  it('says "Sending 3 taps · Court 2" for taps Exit left, and not the leftover sentence for the same match', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 3, { label: 'Ng v Brown' }), LINK),
    );
    expect(cards()).toHaveLength(1);
    expect(within(cards()[0] as HTMLElement).getByText('Sending 3 taps · Court 2')).toBeTruthy();
    expect(leftovers()).toHaveLength(0);
    expect(screen.queryByText(/not sent yet/)).toBeNull();
  });

  it('says one tap in the singular', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 1), LINK),
    );
    expect(screen.getByText('Sending 1 tap · Court 2')).toBeTruthy();
  });

  it('is a quiet card: ink words on the quiet edge, nothing orange and nothing to press', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 3), LINK),
    );
    const card = cards()[0] as HTMLElement;
    expect(getComputedStyle(card).borderTopColor).toBe(edgeOf(colour.ink3));
    expect(getComputedStyle(within(card).getByText(/^Sending/)).color).toBe(edgeOf(colour.ink));
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('goes once the taps have landed, and is not drawn for an empty queue', async () => {
    const home = await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 3), LINK),
    );
    expect(cards()).toHaveLength(1);
    await act(() => home.tapQueue.save(queueHolding(ELSEWHERE, 0)));
    await act(() => vi.advanceTimersByTimeAsync(3 * SCORING_POLL_MS));
    expect(cards()).toHaveLength(0);
    expect(screen.queryByText(/Sending/)).toBeNull();
  });

  it('counts down as the queue sends', async () => {
    const home = await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 3), LINK),
    );
    await act(() => home.tapQueue.save(queueHolding(ELSEWHERE, 2)));
    await act(() => vi.advanceTimersByTimeAsync(3 * SCORING_POLL_MS));
    expect(screen.getByText('Sending 2 taps · Court 2')).toBeTruthy();
  });

  it('reads the note again when the queues read differently, not only at mount', async () => {
    const home = await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 3), LINK),
    );
    await act(() => home.ports.matchDayStore.addSending(new Map([[ELSEWHERE, 'Court 5']])));
    await act(() => home.tapQueue.save(queueHolding(ELSEWHERE, 2)));
    await act(() => vi.advanceTimersByTimeAsync(3 * SCORING_POLL_MS));
    expect(screen.getByText('Sending 2 taps · Court 5')).toBeTruthy();
  });

  it('names a match with no court by the match, and with no name either by "another match"', async () => {
    await homeWith({ [ELSEWHERE]: '' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 2, { label: 'Ng v Brown' }), LINK),
    );
    expect(screen.getByText('Sending 2 taps · Ng v Brown')).toBeTruthy();
  });

  it('a queue with no name at all', async () => {
    await homeWith({ [ELSEWHERE]: '' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 2, { label: '' }), LINK),
    );
    expect(screen.getByText(`Sending 2 taps · ${en['home.scoring.matchFallback']}`)).toBeTruthy();
  });

  it('one card for each match Exit left, in the queue’s order', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2', 'fake-three': 'Court 3' }, async (fakes) => {
      await leave(fakes, queueHolding(ELSEWHERE, 2), LINK);
      await leave(fakes, queueHolding('fake-three', 1), LINK);
    });
    expect(cards().map((card) => card.textContent)).toEqual([
      'Sending 2 taps · Court 2',
      'Sending 1 tap · Court 3',
    ]);
  });

  it('a match Exit did not list keeps the leftover card it always had', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, async (fakes) => {
      await leave(fakes, queueHolding(ELSEWHERE, 2), LINK);
      await leave(fakes, queueHolding('fake-three', 4, { label: 'Match 9' }), LINK);
    });
    expect(cards()).toHaveLength(1);
    expect(leftovers()).toHaveLength(1);
    expect(screen.getByText('4 taps from Match 9 not sent yet')).toBeTruthy();
  });

  it('taps that can never send keep their own orange card and are never said to be sending', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 2, { dead: 'LINK_REVOKED' }), LINK),
    );
    expect(cards()).toHaveLength(0);
    expect(screen.getByText(/2 taps not sent — tell the organiser/)).toBeTruthy();
  });

  it('a queue Home cannot read keeps its own card too', async () => {
    await homeWith({ [ELSEWHERE]: 'Court 2' }, async (fakes) => {
      await leave(fakes, queueHolding(ELSEWHERE, 2), LINK);
      fakes.queueFiles.files.set(`${ELSEWHERE}.json`, '{garbled');
    });
    expect(cards()).toHaveLength(0);
    expect(screen.getByText(en['home.scoring.unreadable'])).toBeTruthy();
  });

  it('the saved match keeps its Continue card and its unsent line, and gets no Sending card', async () => {
    await homeWith(
      { [FAKE_MATCH]: 'Court 1' },
      (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 3), LINK),
      { kvSeed: inMatch() },
    );
    expect(cards()).toHaveLength(0);
    expect(screen.queryByText(/Sending/)).toBeNull();
    expect(screen.getByTestId('scoring-continue')).toBeTruthy();
    expect(screen.getByText('3 taps not sent yet')).toBeTruthy();
  });

  it('with nothing noted, or a note the phone cannot read, Home is exactly as it was', async () => {
    await homeWith(null, (fakes) =>
      leave(fakes, queueHolding(ELSEWHERE, 2, { label: 'Match 7' }), LINK),
    );
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('2 taps from Match 7 not sent yet')).toBeTruthy();
  });

  it('a note that is garbled is none', async () => {
    const fakes = createFakePorts({
      kvSeed: { [linkKey(ELSEWHERE)]: STORED_LINK, [MATCHDAY_KEYS.sending]: '{nope' },
    });
    await leave(fakes, queueHolding(ELSEWHERE, 2, { label: 'Match 7' }), LINK);
    render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('2 taps from Match 7 not sent yet')).toBeTruthy();
  });

  it.each(['es', 'fr', 'nl'] as const)('reads in %s from its dictionary', async (lang) => {
    await homeWith(
      { [ELSEWHERE]: 'Court 2' },
      (fakes) => leave(fakes, queueHolding(ELSEWHERE, 3), LINK),
      { deviceLanguages: [lang] },
    );
    const said = word(lang, 'matchday.sendingCard.other')
      .replace('{count}', '3')
      .replace('{name}', 'Court 2')
      .replace(/ /g, ' ');
    expect(screen.getByText(said)).toBeTruthy();
  });
});
