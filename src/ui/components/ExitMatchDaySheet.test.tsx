import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { ExitMatchDaySheet } from '@/ui/components/ExitMatchDaySheet';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// MD-2 Task 7: Exit's question (S4 design §4). The words are the dictionaries'; the spec's two sentences are quoted here
// in English because they are the spec's. How it looks on glass is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => DICTIONARY[lang][key] as string;

function show(stake: { count: number; unreadable: boolean }, lang: Lang = 'en') {
  const onStay = vi.fn();
  const onExit = vi.fn();
  const view = renderWithPorts(
    <ExitMatchDaySheet stake={stake} onStay={onStay} onExit={onExit} />,
    { deviceLanguages: [lang] },
  );
  return { ...view, onStay, onExit };
}

describe('Exit’s question says what leaving costs', () => {
  it('nothing unsent: "Exit Match Day? You\'ll need to scan again."', () => {
    show({ count: 0, unreadable: false });
    expect(screen.getByText('Exit Match Day?')).toBeTruthy();
    expect(screen.getByText("You'll need to scan again.")).toBeTruthy();
    expect(screen.queryByText(/still sending/)).toBeNull();
  });

  it('3 unsent: "3 taps still sending — they\'ll keep sending."', () => {
    show({ count: 3, unreadable: false });
    expect(screen.getByText("3 taps still sending — they'll keep sending.")).toBeTruthy();
    expect(screen.queryByText("You'll need to scan again.")).toBeNull();
  });

  it('1 unsent says it in the singular', () => {
    show({ count: 1, unreadable: false });
    expect(screen.getByText("1 tap still sending — it'll keep sending.")).toBeTruthy();
  });

  it('a queue it cannot read is taps at risk, never the plain body, whatever the count', () => {
    show({ count: 0, unreadable: true });
    expect(screen.getByText(en['matchday.exit.bodyAtRisk'])).toBeTruthy();
    expect(screen.queryByText(en['matchday.exit.body'])).toBeNull();
  });

  it.each(['en', 'es', 'fr', 'nl'] as const)('says it in %s from its dictionary', (lang) => {
    show({ count: 3, unreadable: false }, lang);
    expect(screen.getByText(word(lang, 'matchday.exit.title').replace(/ /g, ' '))).toBeTruthy();
    expect(
      screen.getByText(
        word(lang, 'matchday.exit.bodySending.other').replace('{count}', '3').replace(/ /g, ' '),
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: word(lang, 'matchday.exit.stay') })).toBeTruthy();
    expect(screen.getByRole('button', { name: word(lang, 'matchday.exit.confirm') })).toBeTruthy();
  });
});

describe('Exit’s buttons', () => {
  it('Stay is the lime plate and comes first; Exit is the outline after it', () => {
    show({ count: 0, unreadable: false });
    const buttons = screen.getAllByRole('button');
    const names = buttons.map((one) => one.getAttribute('aria-label') ?? one.textContent);
    expect(names.filter((name) => name === 'Stay' || name === 'Exit')).toEqual(['Stay', 'Exit']);
    const stay = screen.getByRole('button', { name: 'Stay' });
    expect(getComputedStyle(stay).backgroundColor).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(screen.getByRole('button', { name: 'Exit' })).backgroundColor).not.toBe(
      edgeOf(colour.lime),
    );
  });

  it('Stay and the dim each call onStay once, and never onExit', () => {
    const view = show({ count: 0, unreadable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    fireEvent.click(screen.getByTestId('exit-dim'));
    expect(view.onStay).toHaveBeenCalledTimes(2);
    expect(view.onExit).not.toHaveBeenCalled();
  });

  it('Exit calls onExit once, and never onStay', () => {
    const view = show({ count: 0, unreadable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(view.onExit).toHaveBeenCalledTimes(1);
    expect(view.onStay).not.toHaveBeenCalled();
  });

  it('is a modal sheet, and its dim is hidden from a screen reader', () => {
    show({ count: 0, unreadable: false });
    expect(screen.getByTestId('exit-confirm').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('exit-dim').getAttribute('aria-hidden')).toBe('true');
  });
});
