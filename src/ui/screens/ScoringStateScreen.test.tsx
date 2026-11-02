import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoringState } from '@/hooks/padScreenModel';
import { STORE_URL } from '@/hooks/useScoringMatch';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { ScoringStateScreen } from '@/ui/screens/ScoringStateScreen';
import { FAKE_MATCH, LINK, leave, linkKey, queueHolding } from '../../../test/scoringHomeFixtures';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Plan S2-1 Task 11: a match that is not a pad, for any sport: the card in the pad's place, a Back to Home, and the
// ways out the card has. Dismiss asks first when taps would be thrown away (owner ruling B, 2026-11-02); with nothing
// at stake it lets the match go at once. Every expectation is a literal or the dictionary's, never the code's.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const WORDS = { en, es, fr, nl } as const;
type Lang = keyof typeof WORDS;
type View = ReturnType<typeof renderWithPorts>;

const GONE: ScoringState = { kind: 'linkGone' };

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

type Setup = { taps?: number; link?: boolean; lang?: Lang; saved?: boolean };

/** The state on the fake phone, with the match's link and queue on its disk as the test says. */
async function show(state: ScoringState = GONE, setup: Setup = {}): Promise<View> {
  const { taps = 0, link = true, lang = 'en' } = setup;
  const view = renderWithPorts(<ScoringStateScreen fixtureId={FAKE_MATCH} state={state} />, {
    deviceLanguages: [lang],
  });
  if (link) await view.kv.set(linkKey(FAKE_MATCH), JSON.stringify(LINK));
  if (taps > 0) await leave(view, queueHolding(FAKE_MATCH, taps, { label: 'Match 4' }), null);
  act(() => view.navigation.go('scoring'));
  await settle();
  return view;
}

const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const tap = async (name: string) => {
  press(name);
  await settle();
};
const sheet = () => screen.queryByTestId('dismiss-confirm');
const queueLeft = (view: View) => view.tapQueue.load(FAKE_MATCH);

describe('the way Home', () => {
  it('has Back at the top, named Home, and it goes Home', async () => {
    const view = await show();
    await tap(en['stream.home']);
    expect(view.navigation.current()).toBe('home');
  });

  it("answers the phone's Back by going Home, the route being Home's sub-screen", async () => {
    const view = await show();
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });

  it.each(['en', 'es', 'fr', 'nl'] as const)('names it in %s', async (lang) => {
    await show(GONE, { lang });
    expect(screen.getByRole('button', { name: WORDS[lang]['stream.home'] })).toBeTruthy();
  });
});

describe('Dismiss on a link that is gone', () => {
  it('lets the match go at once when nothing is queued, and goes Home', async () => {
    const view = await show();
    await tap(en['home.scoring.dismiss']);
    expect(sheet()).toBeNull();
    expect(view.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(view.navigation.current()).toBe('home');
  });

  it('asks first when taps are queued: the match and the count, Keep before Dismiss, and nothing deleted yet', async () => {
    const view = await show(GONE, { taps: 3 });
    await tap(en['home.scoring.dismiss']);
    const asked = within(sheet() as HTMLElement);
    expect(asked.getByText('Dismiss Match 4?')).toBeTruthy();
    expect(
      asked.getByText('3 taps that were not sent will be deleted. They will not reach Seazn.'),
    ).toBeTruthy();
    expect(asked.getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep', 'Dismiss']);
    expect(await queueLeft(view)).not.toBeNull();
    expect(view.navigation.current()).toBe('scoring');
  });

  it('says one tap in the singular', async () => {
    await show(GONE, { taps: 1 });
    await tap(en['home.scoring.dismiss']);
    expect(
      screen.getByText('1 tap that was not sent will be deleted. It will not reach Seazn.'),
    ).toBeTruthy();
  });

  it('Keep closes the question and keeps the taps, the card staying', async () => {
    const view = await show(GONE, { taps: 2 });
    await tap(en['home.scoring.dismiss']);
    await tap(en['home.scoring.confirm.keep']);
    expect(sheet()).toBeNull();
    expect(await queueLeft(view)).not.toBeNull();
    expect(screen.getByTestId('scoring-state-card')).toBeTruthy();
    expect(view.navigation.current()).toBe('scoring');
  });

  it('the dim means Keep too', async () => {
    const view = await show(GONE, { taps: 2 });
    await tap(en['home.scoring.dismiss']);
    act(() => fireEvent.click(screen.getByTestId('dismiss-dim')));
    await settle();
    expect(sheet()).toBeNull();
    expect(await queueLeft(view)).not.toBeNull();
    expect(view.navigation.current()).toBe('scoring');
  });

  it("the phone's Back means Keep, and the question takes it before Home does", async () => {
    const view = await show(GONE, { taps: 2 });
    await tap(en['home.scoring.dismiss']);
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(sheet()).toBeNull();
    expect(view.navigation.current()).toBe('scoring');
    expect(await queueLeft(view)).not.toBeNull();
  });

  it('Dismiss in the question deletes the taps and the link, and goes Home', async () => {
    const view = await show(GONE, { taps: 2 });
    await tap(en['home.scoring.dismiss']);
    await tap(en['home.scoring.dismiss']);
    expect(await queueLeft(view)).toBeNull();
    expect(view.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(view.navigation.current()).toBe('home');
  });

  it('asks in the unreadable words for a queue the phone cannot read, with no match named', async () => {
    const view = await show({ kind: 'unreadable', what: 'queue' });
    view.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
    await tap(en['home.scoring.dismiss']);
    expect(screen.getByText('Dismiss another match?')).toBeTruthy();
    expect(
      screen.getByText(
        "Taps that were not sent can't be read, and will be deleted. They will not reach Seazn.",
      ),
    ).toBeTruthy();
  });

  it('asks in the language of the phone', async () => {
    await show(GONE, { taps: 2, lang: 'fr' });
    await tap(fr['home.scoring.dismiss']);
    expect(screen.getByText('Ignorer Match 4 ?'.replace(' ', ' '))).toBeTruthy();
    expect(screen.getByRole('button', { name: fr['home.scoring.confirm.keep'] })).toBeTruthy();
  });

  it('a second press while the first is being read asks once', async () => {
    const view = await show(GONE, { taps: 2 });
    const list = vi.spyOn(view.tapQueue, 'list');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en['home.scoring.dismiss'] }));
      fireEvent.click(screen.getByRole('button', { name: en['home.scoring.dismiss'] }));
    });
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('dismiss-confirm')).toHaveLength(1);
  });

  it('the question closes at once on Dismiss, while the delete is still going, and a second Dismiss deletes nothing again', async () => {
    const view = await show(GONE, { taps: 2 });
    await tap(en['home.scoring.dismiss']);
    const remove = view.tapQueue.remove.bind(view.tapQueue);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleting = vi.spyOn(view.tapQueue, 'remove').mockImplementation(async (id) => {
      await held;
      return remove(id);
    });
    const go = vi.spyOn(view.navigation, 'go');
    const dismiss = within(sheet() as HTMLElement).getByRole('button', {
      name: en['home.scoring.dismiss'],
    });
    act(() => {
      fireEvent.click(dismiss);
      fireEvent.click(dismiss);
    });
    await settle();
    expect(sheet()).toBeNull();
    expect(view.navigation.current()).toBe('scoring');
    release();
    await settle();
    expect(deleting).toHaveBeenCalledTimes(1);
    expect(go.mock.calls.filter(([route]) => route === 'home')).toHaveLength(1);
    expect(view.navigation.current()).toBe('home');
  });

  it('says so, and stays, when the disk refuses the delete', async () => {
    const view = await show();
    vi.spyOn(view.kv, 'delete').mockRejectedValue(new Error('store refused'));
    await tap(en['home.scoring.dismiss']);
    expect(screen.getByText(en['scoring.state.exitFailed'])).toBeTruthy();
    expect(view.navigation.current()).toBe('scoring');
  });

  it('can be tried again after a refusal', async () => {
    const view = await show();
    const refuse = vi.spyOn(view.kv, 'delete').mockRejectedValueOnce(new Error('store refused'));
    await tap(en['home.scoring.dismiss']);
    refuse.mockRestore();
    await tap(en['home.scoring.dismiss']);
    expect(view.navigation.current()).toBe('home');
  });
});

describe('Update and the browser', () => {
  it('Update opens the app’s page in the store', async () => {
    const view = await show({ kind: 'outdated', unsent: 2 });
    await tap(en['scoring.card.updateNeeded.update']);
    expect(view.link.opened).toEqual([STORE_URL]);
  });

  it('Score in the browser opens this match’s scoring page on the build’s host, with the link’s token', async () => {
    const view = await show({ kind: 'tooLarge' });
    await tap(en['scoring.card.updateNeeded.browser']);
    expect(view.link.opened).toEqual([`https://stg.seazn.club/score/${LINK.token}`]);
  });

  it('says it could not open the browser when the match has no link to open', async () => {
    const view = await show({ kind: 'tooLarge' }, { link: false });
    await tap(en['scoring.card.updateNeeded.browser']);
    expect(view.link.opened).toEqual([]);
    expect(screen.getByText(en['scoring.card.cantOpen'])).toBeTruthy();
  });

  it('says it could not open the store when the phone has no store, and the note leaves with the next success', async () => {
    const view = await show({ kind: 'outdated', unsent: 0 });
    view.link.refuse();
    await tap(en['scoring.card.updateNeeded.update']);
    expect(screen.getByText(en['scoring.card.cantOpen'])).toBeTruthy();
    view.link.refuse(false);
    await tap(en['scoring.card.updateNeeded.update']);
    expect(screen.queryByText(en['scoring.card.cantOpen'])).toBeNull();
  });

  it('never puts the token in anything it shows', async () => {
    await show({ kind: 'tooLarge' });
    await tap(en['scoring.card.updateNeeded.browser']);
    expect(document.body.textContent).not.toContain(LINK.token);
  });
});
