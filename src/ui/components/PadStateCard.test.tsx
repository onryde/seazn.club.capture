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
    [{ kind: 'notStarted' }, 'notStarted', colour.ink3],
    [{ kind: 'resultRecorded' }, 'resultRecorded', colour.lime],
    [{ kind: 'viewOnly' }, 'viewOnly', colour.ink3],
    [{ kind: 'linkInvalid' }, 'linkInvalid', colour.caution],
  ] as const)('says %j in the web pad’s words, with its edge', (state: TitledCard, name, tone) => {
    renderWithPorts(<PadStateCard card={state} />);
    const title = en[`scoring.card.${name}.title`];
    const body = en[`scoring.card.${name}.body`];
    expect(card().textContent).toBe(title + body);
    expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(tone));
    expect(card().getAttribute('aria-live')).toBe('polite');
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
