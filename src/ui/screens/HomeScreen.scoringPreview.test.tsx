import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const home = renderWithPorts(<HomeScreen />, options);
  await act(() => home.ports.modeStore.load());
  return home;
}

const scoringTile = () => screen.getByRole('button', { name: new RegExp(en['mode.scoring']) });

/**
 * The S2 design preview (the controller's brief, 2026-10-31): the Remote scoring tile opens the pad on a fake in the
 * dev twin only, with no code. The store build keeps "Coming soon". `previewScoring` is the build's own word
 * (`extra.appVariant`, appConfig.test.ts), false on the fake ports by default.
 */
describe('Home: the Remote scoring preview', () => {
  it('in the store build, the tile is coming soon and takes no tap', async () => {
    const home = await renderHome();
    expect(scoringTile().getAttribute('aria-disabled')).toBe('true');
    expect(within(scoringTile()).getByText(en['home.tile.comingSoon'])).toBeTruthy();
    expect(screen.queryByText(en['home.tile.scoring.preview'])).toBeNull();
    act(() => scoringTile().click());
    expect(home.navigation.current()).toBe('home');
    expect(home.scanner.scans).toBe(0);
  });

  it('in the dev twin, the tile says preview and opens the pad, with no scan', async () => {
    const home = await renderHome({ previewScoring: true });
    expect(scoringTile().getAttribute('aria-disabled')).not.toBe('true');
    expect(within(scoringTile()).getByText(en['home.tile.scoring.preview'])).toBeTruthy();
    expect(screen.getAllByText(en['home.tile.comingSoon'])).toHaveLength(1);
    act(() => scoringTile().click());
    expect(home.navigation.current()).toBe('scoringPreview');
    expect(home.scanner.scans).toBe(0);
  });

  it('not while a scan is in flight: its outcome is Home’s', async () => {
    const home = await renderHome({ previewScoring: true });
    const finish = home.scanner.deferNext();
    act(() => liveStream().click());
    act(() => scoringTile().click());
    expect(home.navigation.current()).toBe('home');
    await act(async () => finish({ outcome: 'cancelled' }));
    act(() => scoringTile().click());
    expect(home.navigation.current()).toBe('scoringPreview');
  });

  it('says it in French', async () => {
    await renderHome({ previewScoring: true, deviceLanguages: ['fr'] });
    expect(screen.getByText(fr['home.tile.scoring.preview'])).toBeTruthy();
  });
});

const liveStream = () => screen.getByRole('button', { name: new RegExp(en['mode.stream']) });
