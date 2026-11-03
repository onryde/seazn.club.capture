import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { ScoringMatchScreen } from '@/ui/screens/ScoringMatchScreen';
import { createFakePorts, timerClock } from '../../../test/fakePorts';
import { FAKE_MATCH, LINK } from '../../../test/scoringHomeFixtures';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A table with no row for any sport: the runtime scores badminton, this build draws no screen for it. Owner ruling 38
// (2026-11-02): never another sport's pad; the operator is told, as for a sport the build does not score.
vi.mock('@/ui/screens/scoringScreens', () => ({ screenFor: () => null }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ScoringMatchScreen: a sport with no screen of its own', () => {
  it('says the phone cannot score that sport yet, naming it, with the browser as the way out', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await saveScoringLink(fakes.kv, FAKE_MATCH, LINK, 'stg.seazn.club', 'badminton');
    const view = renderWithPorts(<ScoringMatchScreen fixtureId={FAKE_MATCH} />, {
      clock: timerClock,
      kvSeed: Object.fromEntries(fakes.kv.entries),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText(en['scoring.state.unsupported.title'])).toBeTruthy();
    expect(screen.getByText('Sport: badminton')).toBeTruthy();
    expect(screen.queryByTestId('pad-content')).toBeNull();
    expect(
      screen.getByRole('button', { name: en['scoring.card.updateNeeded.browser'] }),
    ).toBeTruthy();
    view.unmount();
  });
});
