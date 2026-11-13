import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const home = renderWithPorts(<HomeScreen />, options);
  await act(() => home.ports.modeStore.load());
  return home;
}

const scoringTile = () => screen.getByRole('button', { name: new RegExp(en['mode.scoring']) });
const liveStream = () => screen.getByRole('button', { name: new RegExp(en['mode.stream']) });

/** Remote Scoring is a built mode (plan S2-1 Task 10): its tile scans in every build and says which code opens it. */
describe('Home: the Remote Scoring tile', () => {
  it('takes a tap and scans', async () => {
    const home = await renderHome();
    expect(scoringTile().getAttribute('aria-disabled')).not.toBe('true');
    act(() => scoringTile().click());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    expect(home.navigation.current()).toBe('home');
  });

  // MD-2 Task 1: Match Day is built too, so no tile is left coming soon.
  it('says which code opens it, and no tile is coming soon', async () => {
    await renderHome();
    expect(within(scoringTile()).getByText(en['home.tile.scoring.hint'])).toBeTruthy();
    expect(screen.queryByText(en['home.tile.comingSoon'])).toBeNull();
  });

  it('not while a scan is in flight: the one scan is Home’s', async () => {
    const home = await renderHome();
    const finish = home.scanner.deferNext();
    fireEvent.click(liveStream());
    fireEvent.click(scoringTile());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    await act(async () => finish({ outcome: 'cancelled' }));
  });

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ])('says it in %s', async (lang, dictionary) => {
    await renderHome({ deviceLanguages: [lang] });
    expect(screen.getByText(dictionary['home.tile.scoring.hint'])).toBeTruthy();
  });
});
