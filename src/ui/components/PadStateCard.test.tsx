import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PadStateCard as PadCard } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import nl from '@/i18n/nl.json';
import { PadStateCard } from '@/ui/components/PadStateCard';
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
    [{ kind: 'updateNeeded', unsent: 0 }, 'updateNeeded', colour.caution],
  ] as const)('says %j in the web pad’s words, with its edge', (state: PadCard, name, tone) => {
    renderWithPorts(<PadStateCard card={state} />);
    const title = en[`scoring.card.${name}.title`];
    const body = en[`scoring.card.${name}.body`];
    expect(card().textContent).toBe(title + body);
    expect(getComputedStyle(card()).borderLeftColor).toBe(edgeOf(tone));
    expect(card().getAttribute('aria-live')).toBe('polite');
  });

  it.each([
    [1, en['scoring.card.updateNeeded.unsent.one'].replace('{count}', '1')],
    [4, en['scoring.card.updateNeeded.unsent.other'].replace('{count}', '4')],
  ])('counts %i tap(s) an update still holds', (unsent, line) => {
    renderWithPorts(<PadStateCard card={{ kind: 'updateNeeded', unsent }} />);
    expect(screen.getByText(line)).toBeTruthy();
  });

  it('says it in Dutch', () => {
    renderWithPorts(<PadStateCard card={{ kind: 'linkInvalid' }} />, { deviceLanguages: ['nl'] });
    expect(screen.getByText(nl['scoring.card.linkInvalid.title'])).toBeTruthy();
  });
});
