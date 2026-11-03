import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
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
    [{ kind: 'resultRecorded', undoLeft: null }, 'resultRecorded', 'bodyClosed', colour.lime],
    [{ kind: 'viewOnly' }, 'viewOnly', 'body', colour.ink3],
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

  // Owner, 2026-11-03: a decided match keeps Undo for 30 s, and the card counts the seconds down.
  it.each([30, 17, 1])('says how long Undo stays open on a recorded result: %i s', (left) => {
    renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: left }} />);
    expect(card().textContent).toBe(
      en['scoring.card.resultRecorded.title'] +
        en['scoring.card.resultRecorded.bodyOpen'].replace('{seconds}', String(left)),
    );
    expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(colour.lime));
  });

  it('says nothing of Undo once its window is closed', () => {
    renderWithPorts(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: null }} />);
    expect(card().textContent).not.toContain(en['scoring.pad.undo']);
    expect(card().textContent).toContain(en['scoring.card.resultRecorded.bodyClosed']);
  });

  // A card that changes its words every second under a polite live region would be read out thirty times: while it
  // counts it is not a live region, and it is one again when the window closes.
  it('is a live region again only when the countdown is not running', () => {
    const { rerender } = renderWithPorts(
      <PadStateCard card={{ kind: 'resultRecorded', undoLeft: 30 }} />,
    );
    expect(card().getAttribute('aria-live')).toBe('off');
    rerender(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: null }} />);
    expect(card().getAttribute('aria-live')).toBe('polite');
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('counts down and closes in %s', (lang, words) => {
    const { rerender } = renderWithPorts(
      <PadStateCard card={{ kind: 'resultRecorded', undoLeft: 12 }} />,
      { deviceLanguages: [lang] },
    );
    expect(card().textContent).toBe(
      words['scoring.card.resultRecorded.title'] +
        words['scoring.card.resultRecorded.bodyOpen'].replace('{seconds}', '12'),
    );
    rerender(<PadStateCard card={{ kind: 'resultRecorded', undoLeft: null }} />);
    expect(card().textContent).toBe(
      words['scoring.card.resultRecorded.title'] + words['scoring.card.resultRecorded.bodyClosed'],
    );
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
