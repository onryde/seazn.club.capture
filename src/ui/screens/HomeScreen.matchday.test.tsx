import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import type { FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { renderWithPorts } from '../../../test/renderWithPorts';

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const home = renderWithPorts(<HomeScreen />, options);
  await act(() => home.ports.modeStore.load());
  return home;
}

const matchDayTile = () => screen.getByRole('button', { name: new RegExp(en['mode.matchday']) });
const liveStreamTile = () => screen.getByRole('button', { name: new RegExp(en['mode.stream']) });
const COMING_SOON = 'Match Day is coming soon.';

/** Nothing of the day code is kept: no saved code, no active mode, and the token in no stored value. */
function keptNothing(home: FakePorts): void {
  expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
  expect(home.kv.entries.has(STORE_KEYS.active)).toBe(false);
  const stored = [...home.kv.entries.values()];
  expect(stored.some((value) => value.includes(FIXTURE_DAY_TOKEN))).toBe(false);
}

/**
 * MD-2 Task 1: Match Day is a built mode, so its tile scans and says which code opens it. Its list is built in Tasks 3
 * and 4; until then a day code is named and told Match Day is coming soon, and nothing of it is kept, so no token is
 * stored for a mode that cannot open yet.
 */
describe('Home: the Match Day tile', () => {
  it('takes a tap and scans', async () => {
    const home = await renderHome();
    expect(matchDayTile().getAttribute('aria-disabled')).not.toBe('true');
    act(() => matchDayTile().click());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    expect(home.navigation.current()).toBe('home');
  });

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ])('says what it does and which code opens it in %s', async (lang, dictionary) => {
    await renderHome({ deviceLanguages: [lang] });
    const tile = screen.getByRole('button', { name: new RegExp(dictionary['mode.matchday']) });
    expect(within(tile).getByText(dictionary['home.tile.matchday.purpose'])).toBeTruthy();
    expect(within(tile).getByText(dictionary['home.tile.matchday.hint'])).toBeTruthy();
  });

  it('a day code scanned from it is named and told Match Day is coming soon, and nothing is kept', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(matchDayTile());
    await screen.findByText('This is a Match Day code');
    expect(screen.getByText(COMING_SOON)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Match Day' })).toBeNull();
    await act(async () => undefined);
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
  });

  // Question 1: Scan again scans from the Match Day tile, and the same code says the same again.
  it('scans again from the panel, and the same code is named again', async () => {
    const home = await renderHome();
    home.scanner.queue(
      { outcome: 'scanned', raw: dayLink() },
      { outcome: 'scanned', raw: dayLink() },
    );
    fireEvent.click(matchDayTile());
    await screen.findByText(COMING_SOON);
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(home.scanner.scans).toBe(2));
    await screen.findByText(COMING_SOON);
    keptNothing(home);
  });

  // A7 asks before another mode unpairs Live Stream. A day code opens nothing yet, so nothing is asked or sent.
  it('asks nothing and unpairs nothing while Live Stream is paired', async () => {
    const stream = savedStreamCode();
    const home = await renderHome({
      kvSeed: {
        [STORE_KEYS.active]: 'stream',
        [STORE_KEYS.code('stream')]: encodeSavedCode(stream),
      },
    });
    pairCode(home.engine, stream);
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(matchDayTile());
    await screen.findByText(COMING_SOON);
    expect(screen.queryByRole('button', { name: 'Unpair & open' })).toBeNull();
    expect(home.engine.intents.map((intent) => intent.kind)).toEqual(['pair']);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream');
    expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
  });

  // Decision record ruling 2, both ways round.
  it('a day code scanned from another tile is named, and Open says Match Day is coming soon', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(liveStreamTile());
    await screen.findByText('This is a Match Day code');
    expect(screen.queryByText(COMING_SOON)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Match Day' }));
    await screen.findByText(COMING_SOON);
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
  });

  it('a scoring code scanned from it offers to switch', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://stg.seazn.club/score/abc123' });
    fireEvent.click(matchDayTile());
    await screen.findByText('This is a Remote Scoring code');
    expect(screen.getByRole('button', { name: 'Open Remote Scoring' })).toBeTruthy();
    expect(home.navigation.current()).toBe('home');
  });

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ])('names the day code and says it is coming soon in %s', async (lang, dictionary) => {
    const home = await renderHome({ deviceLanguages: [lang] });
    const mode = dictionary['mode.matchday'];
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(mode) }));
    await screen.findByText(dictionary['panel.comingSoon.title'].replace('{mode}', mode));
    const body = dictionary['panel.comingSoon.body'].replace('{mode}', mode);
    expect(screen.getByText(body)).toBeTruthy();
  });
});
