import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { scoringHubOf } from '@/hooks/scoringHub';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { STORE_KEYS } from '@/services/modeStore';
import { colour, layout } from '@/ui/theme/tokens';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { DECIDED_MATCH, GAME_ONE_21_15 } from '../../../test/badmintonLedger';
import { createFakePorts, readRecord, type FakePorts } from '../../../test/fakePorts';
import {
  DECIDED_3_0,
  GAME_ONE_11_7,
  SINGLES as TABLE_TENNIS_SINGLES,
  ledgerOf as tableTennisLedgerOf,
  type Spec as TableTennisSpec,
} from '../../../test/tableTennisLedger';
import { pressIn, pressOut } from '../../../test/press';
import { edgeOf, fillOf } from '../../../test/pressState';
import { wrapperFor } from '../../../test/renderWithPorts';
import { restoreWindowSize, setWindowSize } from '../../../test/windowSize';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  inMatch,
  leave,
  leaveHistory,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';

// Home's card for a match that is over (owner ruling 41, 2026-11-02: "after match decided and click back button, it shows
// continue and forgot, if match is decided then can we say continue or close?", then "Ok"): once every tap of this phone
// has reached the server the card says Finished with the final score and offers Close, which lets the match go with no
// question, since nothing is lost. Tapping the card opens the match. While taps are unsent it keeps the count and no
// Close. Forget is for a match with nothing to say, Continue for one in play. What the phone cannot read of the match, it
// does not guess.

const SCORE = '21–15, 21–18';
const FINISHED = `Finished · ${SCORE}`;

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

/** The match over, every tap sent: what a pad leaves after the last tap was accepted. */
async function overOnDisk(fakes: FakePorts, taps = 0): Promise<void> {
  await leave(fakes, queueHolding(FAKE_MATCH, taps));
  await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
}

const card = () => screen.getByTestId('scoring-continue');
const closeButton = () => screen.getByRole('button', { name: `Close ${FAKE_LABEL}` });
/** The words of the card, which are its body: a press target that opens the match. */
const body = () => within(card()).getByRole('button', { name: new RegExp(`^${FINISHED}`) });

describe('a finished match on Home', () => {
  it('says Finished with the final score and the match, and offers Close alone', async () => {
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(within(card()).getByText(FINISHED)).toBeTruthy();
    expect(within(card()).getByText(FAKE_LABEL)).toBeTruthy();
    expect(within(card()).queryByText('Continue Remote Scoring')).toBeNull();
    const names = within(card())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual([`${FINISHED}${FAKE_LABEL}`, `Close ${FAKE_LABEL}`]);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  });

  it('draws the word Close, the match in its name for a screen reader', async () => {
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(closeButton().textContent).toBe('Close');
  });

  it('says only Finished for a match the organiser finalized before any game was over', async () => {
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leaveHistory(fakes, FAKE_MATCH, [], { status: 'finalized' });
      },
      { kvSeed: inMatch() },
    );
    expect(within(card()).getByText('Finished')).toBeTruthy();
    expect(closeButton()).toBeTruthy();
  });

  it('shows the games a finalized match had, though its ledger folds to a match still in play', async () => {
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15, { status: 'finalized' });
      },
      { kvSeed: inMatch() },
    );
    expect(within(card()).getByText('Finished · 21–15')).toBeTruthy();
  });

  it('needs no queue file: another scorer may have taken the match to its end', async () => {
    await homeWith(
      async (fakes) => {
        await fakes.kv.set(linkKey(FAKE_MATCH), JSON.stringify({ ...LINK_RECORD }));
        await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
      },
      { kvSeed: inMatch() },
    );
    expect(within(card()).getByText(FINISHED)).toBeTruthy();
  });

  it('Close lets the match go at once, with no question: its code, link and files', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    fireEvent.click(closeButton());
    await waitFor(() => expect(screen.queryByTestId('scoring-continue')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect([...home.queueFiles.files.keys()]).toEqual([]);
    expect(home.navigation.history).toEqual([]);
    expect(screen.getByText('Tap a mode, then scan its code.')).toBeTruthy();
  });

  it('a second tap on Close, before the first has settled, closes it once and says nothing is wrong', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    act(() => {
      closeButton().click();
      closeButton().click();
    });
    await waitFor(() => expect(screen.queryByTestId('scoring-continue')).toBeNull());
    await act(async () => undefined);
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect([...home.queueFiles.files.keys()]).toEqual([]);
    expect(readRecord(home.record).filter((line) => line.event === 'store.write-refused')).toEqual(
      [],
    );
    expect(screen.queryByText("Couldn't save on this phone. Try again.")).toBeNull();
  });

  it('a Close the phone refuses is never silent, and the card stays', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    vi.spyOn(home.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    fireEvent.click(closeButton());
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(screen.queryByTestId('scoring-continue')).not.toBeNull();
  });

  it('a Close the phone refused can be tried again, and then goes', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    const refuse = vi.spyOn(home.kv, 'delete').mockRejectedValueOnce(new Error('keystore locked'));
    fireEvent.click(closeButton());
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(refuse).toHaveBeenCalledTimes(1);
    fireEvent.click(closeButton());
    await waitFor(() => expect(screen.queryByTestId('scoring-continue')).toBeNull());
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('asks first when a tap has appeared since the card was drawn: taps are never lost by closing', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    await leave(home, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }));
    fireEvent.click(closeButton());
    await screen.findByText('Dismiss Match 4?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(true);
    expect((await home.tapQueue.load(FAKE_MATCH))?.pending).toHaveLength(2);
  });

  it('tapping the card opens the match, once however fast it is tapped', async () => {
    const home = await homeWith(overOnDisk, {
      kvSeed: { ...inMatch(), [STORE_KEYS.active]: 'stream' },
    });
    act(() => {
      body().click();
      body().click();
    });
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.navigation.history).toEqual(['scoring']);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(true);
  });

  it('is still finished when the app is killed and reopened after the decision', async () => {
    const first = await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(within(card()).getByText(FINISHED)).toBeTruthy();
    first.unmount();
    const reopened = createFakePorts({
      tapQueue: createTapQueueStore({ files: first.queueFiles, logger: first.ports.logger }),
      kvSeed: Object.fromEntries(first.kv.entries),
    });
    render(<HomeScreen />, { wrapper: wrapperFor(reopened) });
    await act(() => reopened.ports.modeStore.load());
    await act(async () => undefined);
    expect(within(card()).getByText(FINISHED)).toBeTruthy();
    expect(closeButton()).toBeTruthy();
  });

  it('stays beside the Settings gear: a finished match is not a failing one', async () => {
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeNull();
  });
});

describe('a decided match whose taps are not all sent', () => {
  it('shows the count, Continue and no Close, and no Forget: nothing is let go while a tap is out', async () => {
    await homeWith((fakes) => overOnDisk(fakes, 2), { kvSeed: inMatch() });
    expect(within(card()).getByText('2 taps not sent yet')).toBeTruthy();
    expect(within(card()).getByText('Continue Remote Scoring')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    expect(screen.queryByText(/Finished/)).toBeNull();
  });

  it('becomes Finished with Close once the server has them all', async () => {
    const home = await homeWith((fakes) => overOnDisk(fakes, 2), { kvSeed: inMatch() });
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    await leave(home, queueHolding(FAKE_MATCH, 0));
    act(() => home.foreground.leave());
    act(() => home.foreground.fire());
    await screen.findByText(FINISHED);
    expect(closeButton()).toBeTruthy();
    expect(screen.queryByText(/not sent yet/)).toBeNull();
  });

  it('turns Finished when only the match’s own history says so: no queue file moved', async () => {
    const home = await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
      },
      { kvSeed: inMatch() },
    );
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    expect(screen.queryByText(/Finished/)).toBeNull();
    await leaveHistory(home, FAKE_MATCH, DECIDED_MATCH);
    act(() => home.foreground.leave());
    act(() => home.foreground.fire());
    await screen.findByText(FINISHED);
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    expect(closeButton()).toBeTruthy();
  });

  it('is still a dead card with Dismiss when its taps can never go, finished or not', async () => {
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' }));
        await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
      },
      { kvSeed: inMatch() },
    );
    expect(within(card()).getByText('2 taps not sent — tell the organiser')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss Match 4' })).toBeTruthy();
  });
});

// A decision made just before leaving the pad lands in the ledger and boot cache after Home has first looked, since the
// pad's unmount does not wait for the runner's last writes. Home reads again once the hub says the runner that was
// saving the match has stopped (`ScoringHub.settled`; the hub's own tests hold a real runner's save to prove the
// signal, here it is held by hand).
describe('a pad just left', () => {
  it('reads as Continue while the runner is still writing the decision, and Finished once it has stopped', async () => {
    let stopped: () => void = () => undefined;
    const stopping = new Promise<void>((resolve) => (stopped = resolve));
    const home = await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
        vi.spyOn(scoringHubOf(fakes.ports), 'settled').mockReturnValue(stopping);
      },
      { kvSeed: inMatch() },
    );
    expect(screen.queryByText(/Finished/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    // The runner's last write lands, then it has stopped.
    await leaveHistory(home, FAKE_MATCH, DECIDED_MATCH);
    await act(async () => stopped());
    await screen.findByText(FINISHED);
    expect(closeButton()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });
});

describe('a match that is not known to be over', () => {
  it('in play with every tap sent is Continue and Forget, as before', async () => {
    await homeWith(
      async (fakes) => {
        await leave(fakes, queueHolding(FAKE_MATCH, 0));
        await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
      },
      { kvSeed: inMatch() },
    );
    expect(within(card()).getByText('Continue Remote Scoring')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
  });

  it('scanned and never opened, with nothing cached to say, is Continue and Forget', async () => {
    await homeWith((fakes) => leave(fakes, queueHolding(FAKE_MATCH, 0)), { kvSeed: inMatch() });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeTruthy();
    expect(screen.queryByText(/Finished/)).toBeNull();
  });

  it('whose ledger cannot be read is Continue: it is not guessed to be over', async () => {
    await homeWith(
      async (fakes) => {
        await overOnDisk(fakes);
        fakes.queueFiles.files.set(`${FAKE_MATCH}.ledger.json`, '{ not json');
      },
      { kvSeed: inMatch() },
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
  });

  it('whose queue file is garbled says so and offers Dismiss, never Close', async () => {
    await homeWith(
      async (fakes) => {
        await overOnDisk(fakes);
        fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
      },
      { kvSeed: inMatch() },
    );
    expect(
      within(card()).getByText("Some unsent taps can't be read — tell the organiser"),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    expect(screen.queryByText(/Finished/)).toBeNull();
  });

  it('a disk read that throws is recorded and leaves Continue, not a guessed Finished', async () => {
    const fakes = createFakePorts({ kvSeed: inMatch() });
    await overOnDisk(fakes);
    vi.spyOn(fakes.tapQueue, 'loadLedger').mockRejectedValue(new Error('disk gone'));
    render(<HomeScreen />, { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(readRecord(fakes.record).map((line) => line.event)).toContain(
      'scoring.home-finish-refused',
    );
  });
});

describe('how the finished card is drawn', () => {
  afterEach(restoreWindowSize);

  it('has a lime edge, and the score in the LED lime: the scoreboard’s final', async () => {
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(getComputedStyle(card()).borderTopColor).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(within(card()).getByText(FINISHED)).color).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(within(card()).getByText(FAKE_LABEL)).color).toBe(edgeOf(colour.ink));
  });

  it('keeps the words a full touch target tall upright, a one-line score included', async () => {
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(getComputedStyle(body()).minHeight).toBe(`${layout.touch}px`);
  });

  it('paints the words pressed with the press fill and puts the card back on release, whichever way it lies', async () => {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ] as const) {
      setWindowSize(width, height);
      const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
      const rest = getComputedStyle(body()).backgroundColor;
      pressIn(body());
      expect(getComputedStyle(body()).backgroundColor).toBe(fillOf(colour.pressFill));
      pressOut(body());
      expect(getComputedStyle(body()).backgroundColor).toBe(rest);
      home.unmount();
    }
  });

  it('is one row on landscape Home, Close beside the words, which take what it leaves', async () => {
    setWindowSize(844, 390);
    await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(getComputedStyle(card()).flexDirection).toBe('row');
    const words = body();
    expect([getComputedStyle(words).flexGrow, getComputedStyle(words).minWidth]).toEqual([
      '1',
      '0px',
    ]);
    expect(closeButton()).toBeTruthy();
  });
});

describe('the words, in every language', () => {
  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
    ['en', en],
  ])('%s: Finished with the score, Close and its name for a screen reader', async (lang, d) => {
    await homeWith(overOnDisk, { kvSeed: inMatch(), deviceLanguages: [lang] });
    // The matcher folds a no-break space to a plain one, as the DOM text it reads has been folded (i18n.md).
    const folded = (text: string) => text.replace(/ /g, ' ');
    const said = (key: string, vars: Record<string, string> = {}) =>
      Object.entries(vars).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, value),
        (d as Record<string, string>)[key] ?? '',
      );
    expect(
      screen.getByText(folded(said('home.scoring.finishedScore', { score: SCORE }))),
    ).toBeTruthy();
    const close = screen.getByRole('button', {
      name: said('home.scoring.closeMatch', { match: FAKE_LABEL }),
    });
    expect(close.textContent).toBe(said('home.scoring.close'));
  });

  it('a language switch re-reads the same card in the new words', async () => {
    const home = await homeWith(overOnDisk, { kvSeed: inMatch() });
    expect(within(card()).getByText(FINISHED)).toBeTruthy();
    home.unmount();
    await homeWith(
      async (fakes) => {
        await overOnDisk(fakes);
      },
      { kvSeed: inMatch(), deviceLanguages: ['nl'] },
    );
    expect(screen.getByText(`${nl['home.scoring.finished']} · ${SCORE}`)).toBeTruthy();
  });
});

// Plan S2-2 Task 8 (review finding 3): Home reads a match it does not open, through the sport the saved link names
// (`readFinish` -> `sport.resultLine`). A table tennis match is read with table tennis's fold and words, not badminton's.
describe('a table tennis match on Home', () => {
  /** A table tennis match left on the phone: its link naming the sport, its ledger and bootstrap as the pad left them. */
  async function tableTennisOnDisk(fakes: FakePorts, specs: readonly TableTennisSpec[]) {
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await fakes.kv.set(
      linkKey(FAKE_MATCH),
      JSON.stringify({ ...LINK_RECORD, sportKey: 'tabletennis' }),
    );
    await fakes.tapQueue.saveLedger(FAKE_MATCH, tableTennisLedgerOf(specs));
    await fakes.tapQueue.saveBoot(FAKE_MATCH, {
      bootstrap: { ...TABLE_TENNIS_SINGLES, fixtureId: FAKE_MATCH },
      toss: null,
    });
  }

  it('says Finished with every game over, in table tennis’s scores, and offers Close alone', async () => {
    await homeWith((fakes) => tableTennisOnDisk(fakes, DECIDED_3_0), { kvSeed: inMatch() });
    expect(within(card()).getByText('Finished · 11–0, 11–0, 11–0')).toBeTruthy();
    expect(within(card()).queryByText('Continue Remote Scoring')).toBeNull();
    expect(closeButton()).toBeTruthy();
  });

  it('says Continue for a match still in play, whatever games are over', async () => {
    await homeWith((fakes) => tableTennisOnDisk(fakes, GAME_ONE_11_7), { kvSeed: inMatch() });
    expect(within(card()).getByText('Continue Remote Scoring')).toBeTruthy();
    expect(within(card()).queryByText(/^Finished/)).toBeNull();
  });
});

const LINK_RECORD = {
  origin: 'https://stg.seazn.club',
  token: 'dl_madeUpTokenForHomeTests01',
  sportKey: 'badminton',
};
