import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScoringState } from '@/hooks/padScreenModel';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { ScoringStateCard } from '@/ui/components/ScoringStateCard';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Plan S2-1 Task 11, the states that stand in the pad's place (design §4 step 3, §8): every one is said in words, with
// the way out it has, never a blank or a spinner with no reason. Copy is read from the dictionaries, by key, in the
// four languages; the sentences themselves are in en.json.

const WORDS = { en, es, fr, nl } as const;
type Lang = keyof typeof WORDS;
const LANGS: readonly Lang[] = ['en', 'es', 'fr', 'nl'];

type Button = 'update' | 'browser' | 'dismiss';

type Case = {
  readonly name: string;
  readonly state: ScoringState;
  /** The dictionary's keys for the card's title and sentence. */
  readonly title: keyof typeof en;
  readonly body: keyof typeof en;
  readonly edge: string;
  readonly buttons: readonly Button[];
};

const CASES: readonly Case[] = [
  {
    name: 'loading',
    state: { kind: 'loading', offline: false },
    title: 'scoring.state.loading.title',
    body: 'scoring.state.loading.body',
    edge: colour.ink3,
    buttons: [],
  },
  {
    name: 'loading, offline',
    state: { kind: 'loading', offline: true },
    title: 'scoring.state.offline.title',
    body: 'scoring.state.offline.body',
    edge: colour.caution,
    buttons: [],
  },
  {
    name: 'link gone',
    state: { kind: 'linkGone' },
    title: 'scoring.state.linkGone.title',
    body: 'scoring.state.linkGone.body',
    edge: colour.caution,
    buttons: ['dismiss'],
  },
  {
    name: 'unreadable queue',
    state: { kind: 'unreadable', what: 'queue' },
    title: 'scoring.state.unreadableQueue.title',
    body: 'scoring.state.unreadableQueue.body',
    edge: colour.caution,
    buttons: ['dismiss'],
  },
  {
    name: 'unreadable link',
    state: { kind: 'unreadable', what: 'link' },
    title: 'scoring.state.unreadableLink.title',
    body: 'scoring.state.unreadableLink.body',
    edge: colour.caution,
    buttons: [],
  },
  {
    name: 'unsupported sport',
    state: { kind: 'unsupportedSport', sportKey: 'tennis' },
    title: 'scoring.state.unsupported.title',
    body: 'scoring.state.unsupported.body',
    edge: colour.caution,
    buttons: ['browser'],
  },
  {
    name: 'too large',
    state: { kind: 'tooLarge' },
    title: 'scoring.state.tooLarge.title',
    body: 'scoring.state.tooLarge.body',
    edge: colour.caution,
    buttons: ['browser'],
  },
  {
    name: 'unfoldable, a missing player',
    state: { kind: 'unfoldable', reason: 'sides' },
    title: 'scoring.state.sides.title',
    body: 'scoring.state.sides.body',
    edge: colour.caution,
    buttons: [],
  },
  {
    name: 'unfoldable, rules the phone cannot read',
    state: { kind: 'unfoldable', reason: 'cfg' },
    title: 'scoring.state.cfg.title',
    body: 'scoring.state.cfg.body',
    edge: colour.caution,
    buttons: ['browser'],
  },
  {
    name: 'unfoldable, a record the engine refuses',
    state: { kind: 'unfoldable', reason: 'ledger' },
    title: 'scoring.state.ledger.title',
    body: 'scoring.state.ledger.body',
    edge: colour.caution,
    buttons: ['browser'],
  },
  {
    name: 'outdated',
    state: { kind: 'outdated', unsent: 0 },
    title: 'scoring.state.outdated.title',
    body: 'scoring.card.updateNeeded.body',
    edge: colour.caution,
    buttons: ['update', 'browser'],
  },
];

const BUTTON_KEY: Readonly<Record<Button, keyof typeof en>> = {
  update: 'scoring.card.updateNeeded.update',
  browser: 'scoring.card.updateNeeded.browser',
  dismiss: 'home.scoring.dismiss',
};

function draw(
  state: ScoringState,
  over: { lang?: Lang; note?: string | null } = {},
): { onUpdate: () => void; onBrowser: () => void; onDismiss: () => void } {
  const handlers = { onUpdate: vi.fn(), onBrowser: vi.fn(), onDismiss: vi.fn() };
  renderWithPorts(<ScoringStateCard state={state} note={over.note ?? null} {...handlers} />, {
    deviceLanguages: [over.lang ?? 'en'],
  });
  return handlers;
}

const card = () => screen.getByTestId('scoring-state-card');
const buttonNames = () => screen.queryAllByRole('button').map((b) => b.textContent);

describe.each(LANGS)('ScoringStateCard in %s', (lang) => {
  const words = WORDS[lang];

  it.each(CASES)('says $name: a title, a sentence, and exactly the buttons it has', (one) => {
    draw(one.state, { lang });
    expect(within(card()).getByRole('heading').textContent).toBe(words[one.title]);
    expect(within(card()).getByText(words[one.body])).toBeTruthy();
    expect(buttonNames()).toEqual(one.buttons.map((button) => words[BUTTON_KEY[button]]));
  });
});

describe('ScoringStateCard', () => {
  it.each(CASES)('marks $name with its edge, and says it politely', (one) => {
    draw(one.state);
    expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(one.edge));
    expect(card().getAttribute('aria-live')).toBe('polite');
  });

  it('names the sport a build does not score, as the match says it, under the sentence', () => {
    draw({ kind: 'unsupportedSport', sportKey: 'tennis' });
    expect(screen.getByText('Sport: tennis')).toBeTruthy();
  });

  it('says nothing of a sport for any other state', () => {
    draw({ kind: 'tooLarge' });
    expect(screen.queryByText(/Sport:/)).toBeNull();
  });

  it('counts the taps an update leaves unsent, one and many, and says nothing for none', () => {
    draw({ kind: 'outdated', unsent: 1 });
    expect(screen.getByText('1 tap not sent yet. It sends after the update.')).toBeTruthy();
  });

  it('counts many taps in the plural', () => {
    draw({ kind: 'outdated', unsent: 3 });
    expect(screen.getByText('3 taps not sent yet. They send after the update.')).toBeTruthy();
  });

  it('draws no count when the update leaves none unsent', () => {
    draw({ kind: 'outdated', unsent: 0 });
    expect(screen.queryByText(/not sent yet/)).toBeNull();
  });

  it('draws a button’s note under the buttons, and none when there is none', () => {
    draw({ kind: 'tooLarge' }, { note: en['scoring.card.cantOpen'] });
    expect(screen.getByText(en['scoring.card.cantOpen'])).toBeTruthy();
  });

  it('presses each button once, and only its own callback', () => {
    const handlers = draw({ kind: 'outdated', unsent: 2 });
    act(() =>
      fireEvent.click(screen.getByRole('button', { name: en['scoring.card.updateNeeded.update'] })),
    );
    expect(
      [handlers.onUpdate, handlers.onBrowser, handlers.onDismiss].map(
        (f) => vi.mocked(f).mock.calls.length,
      ),
    ).toEqual([1, 0, 0]);
    act(() =>
      fireEvent.click(
        screen.getByRole('button', { name: en['scoring.card.updateNeeded.browser'] }),
      ),
    );
    expect(
      [handlers.onUpdate, handlers.onBrowser, handlers.onDismiss].map(
        (f) => vi.mocked(f).mock.calls.length,
      ),
    ).toEqual([1, 1, 0]);
  });

  it('presses Dismiss for a link that is gone', () => {
    const handlers = draw({ kind: 'linkGone' });
    act(() => fireEvent.click(screen.getByRole('button', { name: en['home.scoring.dismiss'] })));
    expect(vi.mocked(handlers.onDismiss)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handlers.onUpdate)).not.toHaveBeenCalled();
  });
});
