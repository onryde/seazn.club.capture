import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadAsk } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { AskSheet } from '@/ui/components/AskSheet';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The reconnect question's sheet (owner ruling 43, 2026-11-02): how many were scored elsewhere, the score without the
// phone's taps, and two answers. Nothing on the pad closes it: the dim takes no tap. Colour and how it sits over the pad
// are the device check's.

const ASK: PadAsk = {
  foreign: 3,
  queued: 2,
  score: [
    { label: 'A. Sharma', value: '11' },
    { label: 'L. Chen', value: '9' },
  ],
};

type Dictionary = Readonly<Record<string, string>>;
const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;

const render = (over: Partial<Parameters<typeof AskSheet>[0]> = {}, language = 'en') =>
  renderWithPorts(<AskSheet ask={ASK} onSend={vi.fn()} onDiscard={vi.fn()} {...over} />, {
    deviceLanguages: [language],
  });

describe('AskSheet', () => {
  it('says how many were scored elsewhere, in the plural, and how many taps wait', () => {
    render();
    expect(screen.getByText(en['scoring.ask.title.other'].replace('{count}', '3'))).toBeTruthy();
    expect(screen.getByText(en['scoring.ask.body.other'].replace('{count}', '2'))).toBeTruthy();
  });

  it('says it in the singular for one event and one tap', () => {
    render({ ask: { ...ASK, foreign: 1, queued: 1 } });
    expect(screen.getByText(en['scoring.ask.title.one'].replace('{count}', '1'))).toBeTruthy();
    expect(screen.getByText(en['scoring.ask.body.one'].replace('{count}', '1'))).toBeTruthy();
  });

  it('shows the server’s score, each side by its name, and reads it once to a screen reader', () => {
    render();
    const score = screen.getByTestId('ask-score');
    expect(score.textContent).toContain('A. Sharma');
    expect(screen.getByTestId('ask-score-first').textContent).toBe('11');
    expect(screen.getByTestId('ask-score-second').textContent).toBe('9');
    expect(score.getAttribute('aria-label')).toBe(
      `${en['scoring.ask.score']}. A. Sharma 11, L. Chen 9`,
    );
    expect(screen.getByText(en['scoring.ask.score'])).toBeTruthy();
  });

  it('offers Send my taps and Discard them, each its own answer, and no third', () => {
    const onSend = vi.fn();
    const onDiscard = vi.fn();
    render({ onSend, onDiscard });
    expect(screen.getAllByRole('button')).toHaveLength(2);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.ask.send'] })));
    expect([onSend.mock.calls.length, onDiscard.mock.calls.length]).toEqual([1, 0]);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.ask.discard'] })));
    expect([onSend.mock.calls.length, onDiscard.mock.calls.length]).toEqual([1, 1]);
  });

  it('takes no tap on the dim, and is modal to a screen reader', () => {
    const onSend = vi.fn();
    const onDiscard = vi.fn();
    render({ onSend, onDiscard });
    act(() => fireEvent.click(screen.getByTestId('ask-dim')));
    expect([onSend.mock.calls.length, onDiscard.mock.calls.length]).toEqual([0, 0]);
    expect(screen.getByTestId('ask-dim').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('ask-sheet').getAttribute('aria-modal')).toBe('true');
  });

  it('draws the score in the LED lime and the sides in cream: the board’s own colours, never red', () => {
    render();
    expect(getComputedStyle(screen.getByTestId('ask-score-first')).color).toBe(edgeOf(colour.lime));
    expect(getComputedStyle(screen.getByTestId('ask-score-first')).color).not.toBe(
      edgeOf(colour.live),
    );
  });

  it.each(LANGUAGES)('%s: every word is its dictionary’s', (lang, words: Dictionary) => {
    render({}, lang);
    expect(screen.getByRole('button', { name: words['scoring.ask.send'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: words['scoring.ask.discard'] })).toBeTruthy();
    expect(
      screen.getByText(words['scoring.ask.title.other']!.replace('{count}', '3')),
    ).toBeTruthy();
    expect(screen.getByText(words['scoring.ask.score']!)).toBeTruthy();
  });
});
