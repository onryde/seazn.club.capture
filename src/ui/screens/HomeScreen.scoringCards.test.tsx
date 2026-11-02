import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { STORE_KEYS } from '@/services/modeStore';
import { colour } from '@/ui/theme/tokens';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { edgeOf } from '../../../test/pressState';
import { wrapperFor } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  leave,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';

// Plan S2-1 Task 10, Home's Remote Scoring cards (design §5, §6.3, ruling 29): the saved match with what is unsent, and
// every other match whose taps are still queued. A live queue is only counted (it is still sending); a queue that can
// never send, or cannot be read, is told to the organiser and can be dismissed. Nothing else discards a tap.

const savedMatch = (fixtureId = FAKE_MATCH, label = FAKE_LABEL): string =>
  encodeSavedCode({
    mode: 'scoring',
    raw: '',
    slot: null,
    savedAt: TEST_NOW,
    expiresAt: null,
    stream: null,
    scoring: { fixtureId, label },
  });
const inMatch = (fixtureId = FAKE_MATCH, label = FAKE_LABEL) => ({
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: savedMatch(fixtureId, label),
  [linkKey(fixtureId)]: STORED_LINK,
});

/** Home over fake ports: the disk and the store seeded first, as a launch finds them. */
async function homeWith(
  seed: (fakes: FakePorts) => Promise<void> = async () => undefined,
  options: Parameters<typeof createFakePorts>[0] = {},
) {
  const fakes = createFakePorts(options);
  await seed(fakes);
  const view = render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  await act(async () => undefined);
  return { ...fakes, ...view };
}

const continueCard = () => screen.queryByTestId('scoring-continue');
const leftovers = () => screen.queryAllByTestId('scoring-leftover');
const button = (name: string) => screen.getByRole('button', { name });

/**
 * Dismiss asks first (owner ruling B, 2026-11-02): the card's button, named for its match, then the sheet's own Dismiss.
 * `match` is the name the card shows, or `another match` for a queue that never learned one.
 */
async function dismissThrough(card: HTMLElement | null, match: string): Promise<void> {
  const scope = card === null ? screen : within(card);
  fireEvent.click(scope.getByRole('button', { name: `Dismiss ${match}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
}

describe('the saved match on Home', () => {
  it('names the match and offers Continue and Forget when nothing is unsent', async () => {
    await homeWith(async () => undefined, { kvSeed: inMatch() });
    const card = continueCard();
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Continue Remote Scoring')).toBeTruthy();
    expect(within(card as HTMLElement).getByText(FAKE_LABEL)).toBeTruthy();
    expect(within(card as HTMLElement).queryByText(/not sent/)).toBeNull();
    expect(button('Continue')).toBeTruthy();
    expect(button('Forget')).toBeTruthy();
  });

  it('Continue makes the mode active and opens the pad', async () => {
    const home = await homeWith(async () => undefined, {
      kvSeed: { ...inMatch(), [STORE_KEYS.active]: 'stream' },
    });
    fireEvent.click(button('Continue'));
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
  });

  it('a double Continue goes once', async () => {
    const home = await homeWith(async () => undefined, { kvSeed: inMatch() });
    act(() => {
      button('Continue').click();
      button('Continue').click();
    });
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.navigation.history).toEqual(['scoring']);
  });

  it.each([
    [1, '1 tap not sent yet'],
    [3, '3 taps not sent yet'],
  ])('counts %s unsent tap(s) that are still sending, and offers no Forget', async (taps, line) => {
    await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, taps)), {
      kvSeed: inMatch(),
    });
    expect(within(continueCard() as HTMLElement).getByText(line)).toBeTruthy();
    expect(button('Continue')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  });

  it('a queue that can never send says so and offers Dismiss, which lets the match go with its code', async () => {
    const home = await homeWith(
      (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' })),
      { kvSeed: inMatch() },
    );
    expect(
      within(continueCard() as HTMLElement).getByText('2 taps not sent — tell the organiser'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    await dismissThrough(continueCard(), 'Match 4');
    await waitFor(() => expect(continueCard()).toBeNull());
    expect(await home.tapQueue.load(FAKE_MATCH)).toBeNull();
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('a queue that cannot be read says so and offers Dismiss', async () => {
    const home = await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 1));
        fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
      },
      { kvSeed: inMatch() },
    );
    expect(
      within(continueCard() as HTMLElement).getByText(
        "Some unsent taps can't be read — tell the organiser",
      ),
    ).toBeTruthy();
    await dismissThrough(continueCard(), 'Match 4');
    await waitFor(() => expect(continueCard()).toBeNull());
    expect([...home.queueFiles.files.keys()]).toEqual([]);
  });

  it('Forget lets a match with nothing unsent go: its code, link and files', async () => {
    const home = await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, 0)), {
      kvSeed: inMatch(),
    });
    fireEvent.click(button('Forget'));
    await waitFor(() => expect(continueCard()).toBeNull());
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(home.navigation.current()).toBe('home');
    expect(screen.getByText('Tap a mode, then scan its code.')).toBeTruthy();
  });

  it('a Forget the phone refuses is never silent, and the card stays', async () => {
    const home = await homeWith(async () => undefined, { kvSeed: inMatch() });
    vi.spyOn(home.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    fireEvent.click(button('Forget'));
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(continueCard()).not.toBeNull();
  });

  it('Continue while Live Stream holds a pairing asks first (A7), and Confirm unpairs, forgets the stream code and opens the pad', async () => {
    const stream = savedStreamCode();
    const home = await homeWith(async (fakes) => pairCode(fakes.engine, stream), {
      kvSeed: {
        ...inMatch(),
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(stream),
      },
    });
    fireEvent.click(
      within(continueCard() as HTMLElement).getByRole('button', { name: 'Continue' }),
    );
    await screen.findByText(
      'This phone is paired for streaming. Opening Remote Scoring unpairs it.',
    );
    expect(home.navigation.current()).toBe('home');
    fireEvent.click(button(en['sheet.unpair.confirm']));
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    // The link the match was saved under is still the one it reads with.
    expect(JSON.parse(home.kv.entries.get(linkKey(FAKE_MATCH)) ?? 'null')).toEqual({
      ...LINK,
      sportKey: 'badminton',
    });
  });
});

describe('other matches’ taps on Home', () => {
  it('counts the taps of a match still sending, and offers nothing to do with them', async () => {
    await homeWith(async (fakes) => leave(fakes, queueHolding('fx-old', 4, { label: 'Match 7' })));
    const [card] = leftovers();
    expect(within(card as HTMLElement).getByText('4 taps from Match 7 not sent yet')).toBeTruthy();
    expect(within(card as HTMLElement).queryByRole('button')).toBeNull();
    expect(continueCard()).toBeNull();
  });

  it('says one tap in the singular', async () => {
    await homeWith(async (fakes) => leave(fakes, queueHolding('fx-old', 1, { label: 'Match 7' })));
    expect(screen.getByText('1 tap from Match 7 not sent yet')).toBeTruthy();
  });

  it('names no match it was never told the name of: another match', async () => {
    await homeWith(async (fakes) => leave(fakes, queueHolding('fx-old', 2, { label: '' })));
    expect(screen.getByText('2 taps from another match not sent yet')).toBeTruthy();
  });

  it('a queue that can never send names its match, says so, and Dismiss deletes it', async () => {
    const home = await homeWith((fakes) =>
      leave(fakes, queueHolding('fx-old', 4, { label: 'Match 7', dead: 'finalized' })),
    );
    const [card] = leftovers();
    expect(within(card as HTMLElement).getByText('Match 7')).toBeTruthy();
    expect(
      within(card as HTMLElement).getByText('4 taps not sent — tell the organiser'),
    ).toBeTruthy();
    await dismissThrough(card as HTMLElement, 'Match 7');
    await waitFor(() => expect(leftovers()).toHaveLength(0));
    expect(await home.tapQueue.load('fx-old')).toBeNull();
    expect(home.kv.entries.has(linkKey('fx-old'))).toBe(false);
  });

  it('a queue that cannot be read says so, and Dismiss deletes its files', async () => {
    const home = await homeWith(async (fakes) => {
      await leave(fakes, queueHolding('fx-old', 1));
      fakes.queueFiles.files.set('fx-old.json', '{ not json');
    });
    expect(screen.getByText("Some unsent taps can't be read — tell the organiser")).toBeTruthy();
    await dismissThrough(leftovers()[0] ?? null, 'another match');
    await waitFor(() => expect(leftovers()).toHaveLength(0));
    expect([...home.queueFiles.files.keys()]).toEqual([]);
  });

  it('shows no card for a queue with nothing in it, dead or not', async () => {
    await homeWith(async (fakes) => {
      await leave(fakes, queueHolding('fx-a', 0));
      await leave(fakes, queueHolding('fx-b', 0, { dead: 'LINK_REVOKED' }));
    });
    expect(leftovers()).toHaveLength(0);
  });

  it('shows the saved match and a leftover together, the leftover without a Dismiss while it is sending', async () => {
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7' }));
      },
      { kvSeed: inMatch() },
    );
    expect(continueCard()).not.toBeNull();
    expect(leftovers()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  });

  it('reads the disk again on a return to the foreground', async () => {
    const home = await homeWith();
    expect(leftovers()).toHaveLength(0);
    await leave(home, queueHolding('fx-old', 2, { label: 'Match 7' }));
    act(() => home.foreground.leave());
    act(() => home.foreground.fire());
    await screen.findByText('2 taps from Match 7 not sent yet');
  });

  it('a disk that cannot list shows no card and does not throw', async () => {
    const fakes = createFakePorts();
    fakes.queueFiles.failNext('names');
    render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    await act(async () => undefined);
    expect(leftovers()).toHaveLength(0);
    expect(screen.getByText('Tap a mode, then scan its code.')).toBeTruthy();
  });
});

describe('what a card does not touch', () => {
  it('a Dismiss on another match leaves the saved match, its code and its link alone', async () => {
    const home = await homeWith(
      (fakes) =>
        leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7', dead: 'LINK_REVOKED' })),
      { kvSeed: inMatch() },
    );
    const [card] = leftovers();
    await dismissThrough(card as HTMLElement, 'Match 7');
    await waitFor(() => expect(leftovers()).toHaveLength(0));
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(true);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    expect(continueCard()).not.toBeNull();
  });

  it('a Continue the phone refuses is never silent, and the pad does not open', async () => {
    const home = await homeWith(async () => undefined, { kvSeed: inMatch() });
    vi.spyOn(home.kv, 'set').mockRejectedValue(new Error('keystore locked'));
    fireEvent.click(button('Continue'));
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(home.navigation.history).not.toContain('scoring');
  });

  it('a saved match the organiser never named has no empty line under its title', async () => {
    await homeWith(async () => undefined, { kvSeed: inMatch(FAKE_MATCH, '') });
    const title = within(continueCard() as HTMLElement).getByText('Continue Remote Scoring');
    expect(title.parentElement?.children).toHaveLength(1);
  });
});

describe('the disk Home reads', () => {
  it('a list that fails is recorded and never raised', async () => {
    const raised: unknown[] = [];
    const collect = (reason: unknown) => raised.push(reason);
    process.on('unhandledRejection', collect);
    try {
      const fakes = createFakePorts();
      vi.spyOn(fakes.tapQueue, 'list').mockRejectedValue(new Error('disk gone'));
      render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
      await act(() => fakes.ports.modeStore.load());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(raised).toEqual([]);
      expect(readRecord(fakes.record)).toContainEqual(
        expect.objectContaining({ event: 'scoring.home-list-refused' }),
      );
    } finally {
      process.off('unhandledRejection', collect);
    }
  });

  it('is not read again and again for a queue that can never send: only a queue that is sending changes', async () => {
    vi.useFakeTimers();
    try {
      const fakes = createFakePorts({ kvSeed: inMatch() });
      await leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' }));
      render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
      await act(() => fakes.ports.modeStore.load());
      await act(() => vi.advanceTimersByTimeAsync(10));
      const list = vi.spyOn(fakes.tapQueue, 'list');
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(list).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the gear (owner ruling A, 2026-11-02: keep the gear, but not beside a failure)', () => {
  const gear = () => screen.queryByRole('button', { name: 'Stream settings' });

  it('shows with no card above the tiles', async () => {
    await homeWith();
    expect(gear()).not.toBeNull();
  });

  it('stays while the saved match is fine, with taps still sending or none', async () => {
    const quiet = await homeWith(async () => undefined, { kvSeed: inMatch() });
    expect(continueCard()).not.toBeNull();
    expect(gear()).not.toBeNull();
    quiet.unmount();
    await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, 3)), { kvSeed: inMatch() });
    expect(gear()).not.toBeNull();
  });

  it('stays for a leftover that is still sending', async () => {
    await homeWith(async (fakes) => leave(fakes, queueHolding('fx-old', 2)));
    expect(leftovers()).toHaveLength(1);
    expect(gear()).not.toBeNull();
  });

  it('hides while the saved match cannot send, and while it cannot be read', async () => {
    const dead = await homeWith(
      (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' })),
      { kvSeed: inMatch() },
    );
    expect(gear()).toBeNull();
    dead.unmount();
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 1));
        fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
      },
      { kvSeed: inMatch() },
    );
    expect(gear()).toBeNull();
  });

  it('hides for a leftover that cannot send or be read', async () => {
    const dead = await homeWith((fakes) =>
      leave(fakes, queueHolding('fx-old', 2, { dead: 'LINK_REVOKED' })),
    );
    expect(gear()).toBeNull();
    dead.unmount();
    await homeWith(async (fakes) => {
      await leave(fakes, queueHolding('fx-old', 1));
      fakes.queueFiles.files.set('fx-old.json', '{ not json');
    });
    expect(gear()).toBeNull();
  });

  it('comes back when the failing card is dismissed', async () => {
    await homeWith((fakes) =>
      leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7', dead: 'LINK_REVOKED' })),
    );
    expect(gear()).toBeNull();
    await dismissThrough(leftovers()[0] ?? null, 'Match 7');
    await waitFor(() => expect(gear()).not.toBeNull());
  });
});

describe('the cards on landscape Home', () => {
  afterEach(restoreWindowSize);
  const style = (element: Element) => getComputedStyle(element);

  it('are one row each: the words take what the buttons leave, and wrap inside it', async () => {
    setWindowSize(844, 390);
    await homeWith(
      (fakes) =>
        leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7', dead: 'LINK_REVOKED' })),
      { kvSeed: inMatch() },
    );
    for (const card of [continueCard(), leftovers()[0]] as HTMLElement[]) {
      expect(style(card).flexDirection).toBe('row');
      const words = card.firstElementChild as HTMLElement;
      expect([style(words).flexGrow, style(words).minWidth]).toEqual(['1', '0px']);
    }
  });

  it('keep the board’s paddings, 10 above and below, 16 at the start and 12 at the end', async () => {
    setWindowSize(844, 390);
    await homeWith(async (fakes) => leave(fakes, queueHolding('fx-old', 2)));
    const card = leftovers()[0] as HTMLElement;
    expect([
      style(card).paddingTop,
      style(card).paddingBottom,
      style(card).paddingLeft,
      style(card).paddingRight,
    ]).toEqual(['10px', '10px', '16px', '12px']);
  });
});

describe('the words, in every language', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
    ['en', en],
  ])(
    '%s: a leftover that is still sending, one that is dead, one unreadable, the Continue card',
    async (lang, d) => {
      await homeWith(
        async (fakes) => {
          await leave(fakes, queueHolding(FAKE_MATCH, 3));
          await leave(fakes, queueHolding('fx-a', 2, { label: 'Match 7' }));
          await leave(fakes, queueHolding('fx-b', 1, { label: 'Match 8', dead: 'gone' }));
          await leave(fakes, queueHolding('fx-c', 1));
          fakes.queueFiles.files.set('fx-c.json', '{ not json');
        },
        { kvSeed: inMatch(), deviceLanguages: [lang] },
      );
      // The matcher folds a no-break space to a plain one, as the DOM text it reads has been folded (i18n.md).
      const folded = (text: string) => text.replace(/\u00a0/g, ' ');
      const said = (key: string, vars: Record<string, string | number> = {}) =>
        Object.entries(vars).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, String(value)),
          folded((d as Record<string, string>)[key] ?? ''),
        );
      expect(screen.getByText(said('home.scoring.unsent.other', { count: 3 }))).toBeTruthy();
      expect(
        screen.getByText(said('home.scoring.elsewhere.other', { count: 2, match: 'Match 7' })),
      ).toBeTruthy();
      expect(screen.getByText(said('home.scoring.deadHere.one', { count: 1 }))).toBeTruthy();
      expect(screen.getByText(said('home.scoring.unreadable'))).toBeTruthy();
      // Two Dismiss buttons, each named for its match, the unreadable one for "another match".
      const dismissNames = screen
        .getAllByRole('button', {
          name: new RegExp(said('home.scoring.dismissMatch', { match: '.*' })),
        })
        .map((button) => button.getAttribute('aria-label'));
      expect(dismissNames).toEqual([
        said('home.scoring.dismissMatch', { match: 'Match 8' }),
        said('home.scoring.dismissMatch', {
          match: said('home.scoring.matchFallback'),
        }),
      ]);
    },
  );
});

describe('a leftover that sends while Home is open', () => {
  it('counts down as the background sender sends, and goes when the queue is empty', async () => {
    vi.useFakeTimers();
    try {
      const fakes = createFakePorts({
        kvSeed: { [linkKey('fake-singles')]: STORED_LINK },
      });
      await leave(fakes, queueHolding('fake-singles', 2, { label: 'Match 7' }), LINK);
      render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
      await act(() => fakes.ports.modeStore.load());
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(screen.getByText('2 taps from Match 7 not sent yet')).toBeTruthy();
      // The root's background sender is not mounted here: send the queue as it would, then let Home's poll see it.
      const { scoringHubOf } = await import('@/hooks/scoringHub');
      await act(async () => {
        await scoringHubOf(fakes.ports).resume();
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByText(/not sent yet/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// What the cards look like, as far as jsdom can say (colour and wrapping; how it reads on the phone is the device's).
describe('how the cards are drawn', () => {
  const edge = (el: HTMLElement) => getComputedStyle(el).borderTopColor;

  it('the saved match with live taps has a lime edge, ink words, and nothing orange', async () => {
    await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, 3)), { kvSeed: inMatch() });
    const card = continueCard() as HTMLElement;
    expect(edge(card)).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(within(card).getByText('Continue Remote Scoring')).color).toBe(
      edgeOf(colour.ink),
    );
    expect(getComputedStyle(within(card).getByText('3 taps not sent yet')).color).toBe(
      edgeOf(colour.ink),
    );
  });

  it('a saved match that can never send has an orange edge and an orange sentence, never red', async () => {
    await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' })), {
      kvSeed: inMatch(),
    });
    const card = continueCard() as HTMLElement;
    expect(edge(card)).toBe(edgeOf(colour.caution));
    expect(
      getComputedStyle(within(card).getByText('2 taps not sent — tell the organiser')).color,
    ).toBe(edgeOf(colour.caution));
  });

  it('another match still sending has a quiet edge; one that cannot send has an orange one', async () => {
    await homeWith(async (fakes) => {
      await leave(fakes, queueHolding('fx-old', 4, { label: 'Match 7' }));
      await leave(fakes, queueHolding('fx-dead', 2, { label: 'Match 8', dead: 'LINK_REVOKED' }));
    });
    const cards = leftovers();
    const quiet = cards.find((card) => within(card).queryByText(/Match 7/) !== null);
    const failing = cards.find((card) => within(card).queryByText('Match 8') !== null);
    expect(cards).toHaveLength(2);
    expect(edge(quiet as HTMLElement)).toBe(edgeOf(colour.ink3));
    expect(edge(failing as HTMLElement)).toBe(edgeOf(colour.caution));
    expect(getComputedStyle(within(failing as HTMLElement).getByText('Match 8')).color).toBe(
      edgeOf(colour.ink),
    );
  });

  it('the buttons wrap under each other when the card is too narrow for both', async () => {
    await homeWith(async () => undefined, { kvSeed: inMatch() });
    const actions = within(continueCard() as HTMLElement).getByTestId('scoring-actions');
    expect(getComputedStyle(actions).flexWrap).toBe('wrap');
  });
});
