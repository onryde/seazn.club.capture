import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { wrapperFor } from '../../../test/renderWithPorts';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  leave,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';

// Owner ruling B (2026-11-02): Dismiss on a dead or unreadable queue asks first. One sheet names the match and the
// number of taps, says they will not reach Seazn, and offers Dismiss and Keep; Keep is the plate, first, and what the
// dim and Back mean. Each card's own button carries its match in its name, so two cards never both read "Dismiss".

const inMatch = {
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: encodeSavedCode({
    mode: 'scoring',
    raw: '',
    slot: null,
    savedAt: TEST_NOW,
    expiresAt: null,
    stream: null,
    scoring: { fixtureId: FAKE_MATCH, label: FAKE_LABEL },
  }),
  [linkKey(FAKE_MATCH)]: STORED_LINK,
};

async function homeWith(
  seed: (fakes: FakePorts) => Promise<void>,
  options: Parameters<typeof createFakePorts>[0] = {},
) {
  const fakes = createFakePorts(options);
  await seed(fakes);
  const view = render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
  await act(() => fakes.ports.modeStore.load());
  await act(async () => undefined);
  return { ...fakes, ...view };
}

const deadLeftover = (id: string, taps: number, label: string) => (fakes: FakePorts) =>
  leave(fakes, queueHolding(id, taps, { label, dead: 'LINK_REVOKED' }));
const unreadableLeftover = async (fakes: FakePorts) => {
  await leave(fakes, queueHolding('fx-bad', 1));
  fakes.queueFiles.files.set('fx-bad.json', '{ not json');
};
const leftovers = () => screen.queryAllByTestId('scoring-leftover');
const asking = () => screen.findByRole('button', { name: 'Keep' });

describe('Dismiss asks first', () => {
  it('names the match and the taps, and says they will not reach Seazn', async () => {
    await homeWith(deadLeftover('fx-old', 4, 'Match 7'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await asking();
    expect(screen.getByText('Dismiss Match 7?')).toBeTruthy();
    expect(
      screen.getByText('4 taps that were not sent will be deleted. They will not reach Seazn.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('says one tap in the singular', async () => {
    await homeWith(deadLeftover('fx-old', 1, 'Match 7'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await asking();
    expect(
      screen.getByText('1 tap that was not sent will be deleted. It will not reach Seazn.'),
    ).toBeTruthy();
  });

  it('for a queue that cannot be read, says so and names no match', async () => {
    await homeWith(unreadableLeftover);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss another match' }));
    await asking();
    expect(screen.getByText('Dismiss another match?')).toBeTruthy();
    expect(
      screen.getByText(
        "Taps that were not sent can't be read, and will be deleted. They will not reach Seazn.",
      ),
    ).toBeTruthy();
  });

  it('keeps the plate on Keep, before Dismiss', async () => {
    await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    const keep = await asking();
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(keep.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Keep keeps everything: the card, the queue and the link', async () => {
    const home = await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    fireEvent.click(await asking());
    await waitFor(() => expect(screen.queryByText('Dismiss Match 7?')).toBeNull());
    expect(leftovers()).toHaveLength(1);
    expect((await home.tapQueue.load('fx-old'))?.pending).toHaveLength(2);
    expect(home.kv.entries.has(linkKey('fx-old'))).toBe(true);
  });

  it('the dim and Back both mean Keep', async () => {
    const home = await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await asking();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Dismiss Match 7?')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await asking();
    let handled = false;
    act(() => {
      handled = home.back.press();
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByText('Dismiss Match 7?')).toBeNull());
    expect((await home.tapQueue.load('fx-old'))?.pending).toHaveLength(2);
  });

  it('Dismiss deletes what the sheet named, and only that: another match’s queue stays', async () => {
    const home = await homeWith(async (fakes) => {
      await deadLeftover('fx-old', 2, 'Match 7')(fakes);
      await deadLeftover('fx-two', 3, 'Match 8')(fakes);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 8' }));
    await asking();
    expect(screen.getByText('Dismiss Match 8?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(leftovers()).toHaveLength(1));
    expect(await home.tapQueue.load('fx-two')).toBeNull();
    expect((await home.tapQueue.load('fx-old'))?.pending).toHaveLength(2);
  });

  it('gives each card a name of its own, so two cards never both read "Dismiss"', async () => {
    await homeWith(async (fakes) => {
      await deadLeftover('fx-old', 2, 'Match 7')(fakes);
      await deadLeftover('fx-two', 3, 'Match 8')(fakes);
    });
    expect(
      screen.getAllByRole('button', { name: /^Dismiss/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Dismiss Match 7', 'Dismiss Match 8']);
    // The word on the button is still the short one.
    const [card] = leftovers();
    expect(within(card as HTMLElement).getByText('Dismiss')).toBeTruthy();
  });

  it('a second tap on the card’s Dismiss opens one sheet', async () => {
    await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    const button = screen.getByRole('button', { name: 'Dismiss Match 7' });
    fireEvent.click(button);
    fireEvent.click(button);
    await asking();
    expect(screen.getAllByText('Dismiss Match 7?')).toHaveLength(1);
  });

  it('lets a queue go at once when the sender emptied it before the question: nothing is lost to ask about', async () => {
    const home = await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    await leave(home, queueHolding('fx-old', 0, { label: 'Match 7', dead: 'LINK_REVOKED' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await waitFor(() => expect(leftovers()).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    expect(await home.tapQueue.load('fx-old')).toBeNull();
  });

  it('lets a card go at once when its queue has left the disk since Home drew it: nothing is left to lose', async () => {
    const home = await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    await home.tapQueue.remove('fx-old');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await waitFor(() => expect(leftovers()).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it('asks in the unreadable words when the disk cannot be listed to say what is there', async () => {
    const home = await homeWith(deadLeftover('fx-old', 2, 'Match 7'));
    vi.spyOn(home.ports.tapQueue, 'list').mockRejectedValue(new Error('disk gone'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Match 7' }));
    await asking();
    expect(screen.getByText('Dismiss another match?')).toBeTruthy();
  });

  it('is not asked for Forget: a saved match with nothing unsent loses nothing', async () => {
    const home = await homeWith(async () => undefined, { kvSeed: inMatch });
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByTestId('scoring-continue')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });
});

describe('the sheet, in every language', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
    ['en', en],
  ])('%s: title, body, Keep and Dismiss are the dictionary’s', async (lang, d) => {
    await homeWith(deadLeftover('fx-old', 3, 'Match 7'), { deviceLanguages: [lang] });
    const folded = (text: string) => text.replace(/ /g, ' ');
    const name = folded(
      (d as Record<string, string>)['home.scoring.dismissMatch'].replace('{match}', 'Match 7'),
    );
    fireEvent.click(screen.getByRole('button', { name }));
    await screen.findByRole('button', {
      name: (d as Record<string, string>)['home.scoring.confirm.keep'],
    });
    const title = folded(
      (d as Record<string, string>)['home.scoring.confirm.title'].replace('{match}', 'Match 7'),
    );
    expect(screen.getByText(title)).toBeTruthy();
    const body = folded(
      (d as Record<string, string>)['home.scoring.confirm.body.other'].replace('{count}', '3'),
    );
    expect(screen.getByText(body)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: (d as Record<string, string>)['home.scoring.dismiss'] }),
    ).toBeTruthy();
  });
});
