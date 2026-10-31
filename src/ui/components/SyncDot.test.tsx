import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PadSync } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { SyncDot } from '@/ui/components/SyncDot';
import { colour } from '@/ui/theme/tokens';
import { linesAllowed } from '../../../test/linesAllowed';
import { fillOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const dot = () => getComputedStyle(screen.getByTestId('sync-dot')).backgroundColor;

describe('SyncDot', () => {
  it.each([
    [{ kind: 'synced' }, en['scoring.sync.synced'], colour.lime],
    [
      { kind: 'sending', count: 1 },
      en['scoring.sync.sending.one'].replace('{count}', '1'),
      colour.ink3,
    ],
    [
      { kind: 'sending', count: 2 },
      en['scoring.sync.sending.other'].replace('{count}', '2'),
      colour.ink3,
    ],
    [
      { kind: 'offline', count: 3 },
      en['scoring.sync.offline.other'].replace('{count}', '3'),
      colour.caution,
    ],
    [
      { kind: 'refused', count: 1 },
      en['scoring.sync.refused.one'].replace('{count}', '1'),
      colour.caution,
    ],
  ] as const)('says %j in words, with its dot', (sync: PadSync, words, tone) => {
    renderWithPorts(<SyncDot sync={sync} />);
    expect(screen.getByTestId('sync').textContent).toBe(words);
    expect(dot()).toBe(fillOf(tone));
  });

  it('keeps its words on one line, cut with an ellipsis if need be, and hides the dot from a screen reader', () => {
    renderWithPorts(<SyncDot sync={{ kind: 'offline', count: 12 }} />);
    expect(
      linesAllowed(screen.getByText(en['scoring.sync.offline.other'].replace('{count}', '12'))),
    ).toBe(1);
    expect(screen.getByTestId('sync-dot').getAttribute('aria-hidden')).toBe('true');
  });

  it('counts in Spanish', () => {
    renderWithPorts(<SyncDot sync={{ kind: 'offline', count: 2 }} />, { deviceLanguages: ['es'] });
    expect(screen.getByTestId('sync').textContent).toBe(
      es['scoring.sync.offline.other'].replace('{count}', '2'),
    );
  });
});
