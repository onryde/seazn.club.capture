import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { UpdateBanner } from '@/ui/components/UpdateBanner';
import { colour } from '@/ui/theme/tokens';
import { edgeOf, fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const banner = () => screen.getByTestId('update-banner');
const update = () => screen.getByRole('button', { name: en['scoring.card.updateNeeded.update'] });
const browser = () => screen.getByRole('button', { name: en['scoring.card.updateNeeded.browser'] });

type Show = {
  unsent?: number;
  note?: string | null;
  onUpdate?: () => void;
  onBrowser?: () => void;
};
function show({ unsent = 0, note = null, onUpdate = vi.fn(), onBrowser = vi.fn() }: Show = {}) {
  return renderWithPorts(
    <UpdateBanner unsent={unsent} note={note} onUpdate={onUpdate} onBrowser={onBrowser} />,
  );
}

/** Owner ruling 8: the sentence, the way on (Update, Score in the browser) and the taps still held. */
describe('UpdateBanner', () => {
  it('says the sentence, then Update and Score in the browser, on a caution edge, politely', () => {
    show();
    expect(banner().textContent).toBe(
      en['scoring.card.updateNeeded.body'] +
        en['scoring.card.updateNeeded.update'] +
        en['scoring.card.updateNeeded.browser'],
    );
    expect(getComputedStyle(banner()).borderLeftColor).toBe(edgeOf(colour.caution));
    expect(banner().getAttribute('aria-live')).toBe('polite');
  });

  it.each([
    [1, en['scoring.card.updateNeeded.unsent.one'].replace('{count}', '1')],
    [4, en['scoring.card.updateNeeded.unsent.other'].replace('{count}', '4')],
  ])('counts %i tap(s) an update still holds, under the sentence', (unsent, line) => {
    show({ unsent });
    expect(banner().textContent?.startsWith(en['scoring.card.updateNeeded.body'] + line)).toBe(
      true,
    );
  });

  it('says no count when every tap is sent (the first test’s whole text has none)', () => {
    show({ unsent: 0 });
    expect(screen.queryByText(/not sent/)).toBeNull();
  });

  it('runs each button’s own action, once a tap', () => {
    const onUpdate = vi.fn();
    const onBrowser = vi.fn();
    show({ unsent: 2, onUpdate, onBrowser });
    fireEvent.click(update());
    expect([onUpdate.mock.calls.length, onBrowser.mock.calls.length]).toEqual([1, 0]);
    fireEvent.click(browser());
    expect([onUpdate.mock.calls.length, onBrowser.mock.calls.length]).toEqual([1, 1]);
  });

  it('gives Update the lime plate and Score in the browser the outline, as the pad’s tools', () => {
    show();
    expect(getComputedStyle(update()).backgroundColor).toBe(fillOf(colour.lime));
    expect(getComputedStyle(browser()).backgroundColor).not.toBe(fillOf(colour.lime));
  });

  it('says the note under the buttons', () => {
    show({ note: en['scoring.preview.noop'] });
    expect(banner().textContent?.endsWith(en['scoring.preview.noop'])).toBe(true);
  });

  it('says it in Spanish', () => {
    renderWithPorts(
      <UpdateBanner unsent={0} note={null} onUpdate={vi.fn()} onBrowser={vi.fn()} />,
      {
        deviceLanguages: ['es'],
      },
    );
    expect(screen.getByText(es['scoring.card.updateNeeded.body'])).toBeTruthy();
    expect(
      screen.getByRole('button', { name: es['scoring.card.updateNeeded.browser'] }),
    ).toBeTruthy();
  });
});
