import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import nl from '@/i18n/nl.json';
import { PadStateCard, type TitledCard } from '@/ui/components/PadStateCard';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const card = () => screen.getByTestId('pad-card');

describe('PadStateCard', () => {
  it.each([
    [{ kind: 'notStarted' }, 'notStarted', 'body', colour.ink3],
    [{ kind: 'viewOnly' }, 'viewOnly', 'body', colour.ink3],
    [{ kind: 'carriedForward' }, 'carriedForward', 'body', colour.ink3],
    [{ kind: 'linkInvalid' }, 'linkInvalid', 'body', colour.caution],
  ] as const)(
    'says %j in the web pad’s words, with its edge',
    (state: TitledCard, name, body, tone) => {
      renderWithPorts(<PadStateCard card={state} />);
      const title = en[`scoring.card.${name}.title`];
      const sentence = en[`scoring.card.${name}.${body}` as keyof typeof en];
      expect(card().textContent).toBe(title + sentence);
      expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(tone));
      expect(card().getAttribute('aria-live')).toBe('polite');
    },
  );

  // Task 8d (device check, 2026-11-04). A decided match whose result the web has carried forward is not finalized: the
  // card says what the web says (`scorepad.refusal.carriedForward`, without its "Not recorded" lead), in each language,
  // and never "finalised". The words are written out here, not read from the dictionary under test.
  describe('for a result carried forward', () => {
    const WORDS = [
      [
        'en',
        'Result carried forward',
        'This result has already moved the competition on. Ask the organiser to correct it.',
        'finalised',
      ],
      [
        'es',
        'Resultado ya trasladado',
        'Este resultado ya ha hecho avanzar la competición. Pide al organizador que lo corrija.',
        'cerrado',
      ],
      [
        'fr',
        'Résultat déjà pris en compte',
        "Ce résultat a déjà fait avancer la compétition. Demandez à l'organisateur de le corriger.",
        'validé',
      ],
      [
        'nl',
        'Uitslag al doorgeschoven',
        'Deze uitslag heeft de competitie al verder gezet. Vraag de organisator om het te corrigeren.',
        'definitief',
      ],
    ] as const;

    it.each(WORDS)(
      'says it in %s, and not what a finalized match says',
      (lang, title, body, lock) => {
        renderWithPorts(<PadStateCard card={{ kind: 'carriedForward' }} />, {
          deviceLanguages: [lang],
        });
        expect(card().textContent).toBe(title + body);
        expect(card().textContent).not.toContain(lock);
      },
    );

    it('is a card of its own words, the title above the sentence, with no Undo and no countdown', () => {
      renderWithPorts(<PadStateCard card={{ kind: 'carriedForward' }} />);
      expect([...card().children].map((child) => child.textContent)).toEqual([
        WORDS[0][1],
        WORDS[0][2],
      ]);
      expect(screen.queryByText(en['scoring.pad.undo'])).toBeNull();
      expect(screen.queryByTestId('pad-card-countdown')).toBeNull();
    });
  });

  // Owner, 2026-11-03: a decided match keeps Undo for 45 s, and the card counts the seconds down.
  const said = () => screen.getByTestId('pad-card-said');
  const countdown = () => screen.getByTestId('pad-card-countdown');
  const OPEN = en['scoring.card.resultRecorded.title'] + en['scoring.card.resultRecorded.bodyOpen'];
  const CLOSED =
    en['scoring.card.resultRecorded.title'] + en['scoring.card.resultRecorded.bodyClosed'];
  const counted = (left: number) =>
    en['scoring.card.resultRecorded.undoCountdown'].replace('{seconds}', String(left));

  it.each([45, 17, 1])('says how long Undo stays open on a recorded result: %i s', (left) => {
    renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: left }} />);
    expect(card().textContent).toBe(OPEN + counted(left));
    expect(countdown().textContent).toBe(counted(left));
    expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(colour.lime));
  });

  it('says nothing of Undo once its window is closed, and has no countdown', () => {
    renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: null }} />);
    expect(card().textContent).toBe(CLOSED);
    expect(card().textContent).not.toContain(en['scoring.pad.undo']);
    expect(screen.queryByTestId('pad-card-countdown')).toBeNull();
  });

  // A card whose digits change every second under a polite live region would be read out forty-five times. Its title and its
  // sentence are the live region, said once when the card appears; the digits are outside it, read by a swipe, and the
  // card itself is not a live region. Whether TalkBack and VoiceOver say it so is the device check's.
  describe('for a screen reader', () => {
    it('says the title and the sentence in a polite live region, and the digits in none', () => {
      renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: 12 }} />);
      expect(card().getAttribute('aria-live')).toBe('off');
      expect(said().getAttribute('aria-live')).toBe('polite');
      expect(said().textContent).toBe(OPEN);
      expect(said().contains(countdown())).toBe(false);
      expect(countdown().closest('[aria-live="polite"]')).toBeNull();
      expect(countdown().getAttribute('aria-live')).toBeNull();
    });

    it('has the same words in the live region on every second, so only the digits move', () => {
      const { rerender } = renderWithPorts(
        <PadStateCard card={{ kind: 'resultRecorded', undoLeft: 45 }} />,
      );
      const before = said().textContent;
      for (const left of [44, 15, 1]) {
        rerender(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: left }} />);
        expect(said().textContent).toBe(before);
        expect(countdown().textContent).toBe(counted(left));
      }
    });

    // The one announcement when Undo closes: the sentence of the same live region changes, and the digits go.
    it('changes the live region’s sentence when the window closes, in the same node, and drops the digits', () => {
      const { rerender } = renderWithPorts(
        <PadStateCard card={{ kind: 'resultRecorded', undoLeft: 1 }} />,
      );
      const region = said();
      rerender(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: null }} />);
      expect(said()).toBe(region);
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.textContent).toBe(CLOSED);
      expect(screen.queryByTestId('pad-card-countdown')).toBeNull();
    });

    it('is a live region of its own words for the other cards, as before', () => {
      renderWithPorts(<PadStateCard card={{ kind: 'viewOnly' }} />);
      expect(card().getAttribute('aria-live')).toBe('polite');
      expect(screen.queryByTestId('pad-card-said')).toBeNull();
    });
  });

  // AGENTS §5: numbers that change must not twitch.
  it('sets the countdown in tabular figures', () => {
    renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: 9 }} />);
    expect(getComputedStyle(countdown()).fontVariant).toContain('tabular-nums');
  });

  it('puts what it is given between the title and the sentence (owner, 2026-11-01)', () => {
    renderWithPorts(
      <PadStateCard card={{ kind: 'notStarted' }}>
        <Text variant="body">between</Text>
      </PadStateCard>,
    );
    expect([...card().children].map((child) => child.textContent)).toEqual([
      en['scoring.card.notStarted.title'],
      'between',
      en['scoring.card.notStarted.body'],
    ]);
  });

  it('says it in Dutch', () => {
    renderWithPorts(<PadStateCard card={{ kind: 'linkInvalid' }} />, { deviceLanguages: ['nl'] });
    expect(screen.getByText(nl['scoring.card.linkInvalid.title'])).toBeTruthy();
  });
});
