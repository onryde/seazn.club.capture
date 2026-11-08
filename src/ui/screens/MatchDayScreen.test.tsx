import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { renderWithPorts } from '../../../test/renderWithPorts';

// MD-2 Task 3, the dispatch's ruling 5: the route the tile opens says the day is being opened, until Task 4 lists it.
describe('MatchDayScreen, before the list (Task 4)', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ])('says the day is being opened, in %s', (lang, words) => {
    renderWithPorts(<MatchDayScreen />, { deviceLanguages: [lang] });
    expect(screen.getByText(words['matchday.loading.title'])).toBeTruthy();
    expect(screen.getByText(words['matchday.loading.body'])).toBeTruthy();
  });

  it('Back returns Home', () => {
    const view = renderWithPorts(<MatchDayScreen />);
    act(() => view.navigation.go('matchday'));
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });
});
