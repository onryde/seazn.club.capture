import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { colour, plateInk } from '@/ui/theme/tokens';
import { edgeOf, fillOf, paintOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A tennis half's call on its next point (owner, 2026-11-13): the lime plate in the scoreboard row after the set boxes and the
// won-game dots, before "Tap". The kit draws what it is given; the pad's domain decides who is called (`tennisPointCall.test.ts`,
// `tennisPad.call.test.ts`). The width it holds at 320 and 360 is `pointCallFit.test.ts`'s; how it looks is the device's.

const T = 'scoring.tennis.board.';
const CALLS = {
  break: 'scoring.pad.call.breakPoint',
  set: 'scoring.pad.call.setPoint',
  match: 'scoring.pad.call.matchPoint',
} as const;

const half = (call: keyof typeof CALLS | null): PadHalf<MessageKey> => ({
  side: 'second',
  label: 'Bea Lund',
  value: '40',
  periods: null,
  sub: null,
  marks: { clock: false, cards: [], said: [] },
  serving: null,
  plate: null,
  action: null,
  bar: 'dim',
  hint: { key: 'scoring.tennis.hint' },
  tappable: true,
  scoreboard: {
    setsLabel: { key: `${T}sets` as MessageKey },
    sets: ['6', '3'],
    dots: [1, 2],
    said: [{ key: `${T}gamesWon` as MessageKey, vars: { count: 2, games: '1, 2' } }],
  },
  call: call === null ? null : { text: { key: CALLS[call] }, said: { key: CALLS[call] } },
});

// The words are written out per language (docs/i18n-glossary.md), not read from the dictionary under test.
const WORDS = [
  ['en', 'break', 'Break point'],
  ['en', 'set', 'Set point'],
  ['en', 'match', 'Match point'],
  ['es', 'break', 'Punto de quiebre'],
  ['es', 'set', 'Punto de set'],
  ['es', 'match', 'Punto de partido'],
  ['fr', 'break', 'Balle de break'],
  ['fr', 'set', 'Balle de set'],
  ['fr', 'match', 'Balle de match'],
  ['nl', 'break', 'Breekpunt'],
  ['nl', 'set', 'Setpunt'],
  ['nl', 'match', 'Matchpunt'],
] as const;

describe('ScoreHalf: a tennis half’s call', () => {
  it.each(WORDS)('draws %s %s as "%s" and says it once in the half’s name', (lang, call, word) => {
    renderWithPorts(<ScoreHalf half={half(call)} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: [lang],
    });
    expect(screen.getByTestId('call').textContent).toBe(word);
    const name = screen.getByTestId('half-second').getAttribute('aria-label') ?? '';
    expect(name.endsWith(`, ${word}`)).toBe(true);
    expect(name.split(word)).toHaveLength(2);
    expect(screen.getByTestId('call').getAttribute('aria-hidden')).toBe('true');
  });

  it('draws nothing for a half with no call, and its name does not end in a call', () => {
    renderWithPorts(<ScoreHalf half={half(null)} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('call')).toBeNull();
    expect(screen.getByTestId('half-second').getAttribute('aria-label')).not.toMatch(/point/i);
  });

  it('puts the plate in the scoreboard row after the set boxes and the dots, and before "Tap"', () => {
    renderWithPorts(<ScoreHalf half={half('break')} flash={0} onTap={vi.fn()} />);
    const row = screen.getByTestId('scoreboard');
    expect(within(row).getByTestId('call')).toBeTruthy();
    const items = [...(screen.getByTestId('call').parentElement?.children ?? [])].map(
      (child) => child.textContent,
    );
    expect(items).toEqual(['Sets', '6', '3', '1', '2', 'Break point']);
    expect(row.textContent?.endsWith('Break pointTap')).toBe(true);
  });

  it('is a lime plate with night ink, as the serving plate is', () => {
    renderWithPorts(<ScoreHalf half={half('set')} flash={0} onTap={vi.fn()} />);
    expect(paintOf(screen.getByTestId('call')).fill).toBe(fillOf(colour.lime));
    expect(getComputedStyle(screen.getByText('Set point')).color).toBe(edgeOf(plateInk));
  });

  it('draws one plate beside none in the other half of the pair (a call is per half)', () => {
    renderWithPorts(
      <>
        <ScoreHalf half={half('match')} flash={0} onTap={vi.fn()} />
        <ScoreHalf half={{ ...half(null), side: 'first' }} flash={0} onTap={vi.fn()} />
      </>,
    );
    expect(screen.getAllByTestId('call')).toHaveLength(1);
    expect(within(screen.getByTestId('half-first')).queryByTestId('call')).toBeNull();
  });
});
