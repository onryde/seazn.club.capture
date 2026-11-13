import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { colour, plateInk } from '@/ui/theme/tokens';
import { declaredStyle } from '../../../test/declaredStyle';
import { edgeOf, fillOf, paintOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A half's call on its next point (owner, 2026-11-13: "inside the box"): the lime plate in the bottom row after the boxes and
// before "Tap". The kit draws what it is given (the pad's domain decides who is called and when: `*PointCall.test.ts`).

const half: PadHalf<MessageKey> = {
  side: 'first',
  label: 'A. Sharma',
  value: '20',
  periods: {
    scores: [{ value: '21', won: true }],
    said: [{ key: 'scoring.badminton.gamesSaid.other', count: 1, vars: { scores: '21' } }],
  },
  sub: null,
  marks: { clock: false, cards: [], said: [] },
  serving: null,
  plate: null,
  action: null,
  bar: 'dim',
  hint: { key: 'scoring.badminton.hint' },
  tappable: true,
};

const called = (key: MessageKey): PadHalf<MessageKey> => ({
  ...half,
  call: { text: { key }, said: { key } },
});

// The words are written out per language (docs/i18n-glossary.md), not read from the dictionary under test.
const WORDS = [
  ['en', 'scoring.pad.call.gamePoint', 'Game point'],
  ['en', 'scoring.pad.call.matchPoint', 'Match point'],
  ['es', 'scoring.pad.call.gamePoint', 'Punto de juego'],
  ['es', 'scoring.pad.call.matchPoint', 'Punto de partido'],
  ['fr', 'scoring.pad.call.gamePoint', 'Balle de jeu'],
  ['fr', 'scoring.pad.call.matchPoint', 'Balle de match'],
  ['nl', 'scoring.pad.call.gamePoint', 'Gamepunt'],
  ['nl', 'scoring.pad.call.matchPoint', 'Matchpunt'],
] as const;

describe('ScoreHalf: a call on the next point', () => {
  it.each(WORDS)('draws %s %s as "%s", and says it in the half’s name', (lang, key, word) => {
    renderWithPorts(<ScoreHalf half={called(key)} flash={0} onTap={vi.fn()} />, {
      deviceLanguages: [lang],
    });
    expect(screen.getByTestId('call').textContent).toBe(word);
    const name = screen.getByTestId('half-first').getAttribute('aria-label') ?? '';
    expect(name.endsWith(`, ${word}`)).toBe(true);
    // Said once: the drawn plate is hidden from a screen reader.
    expect(name.split(word)).toHaveLength(2);
    expect(screen.getByTestId('call').getAttribute('aria-hidden')).toBe('true');
  });

  it('draws nothing for a half that has no call, and its name is unchanged', () => {
    renderWithPorts(<ScoreHalf half={half} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('call')).toBeNull();
    expect(screen.getByTestId('half-first').getAttribute('aria-label')).toBe(
      'A. Sharma, 20, Game: 21',
    );
  });

  it('draws nothing for a call of null', () => {
    renderWithPorts(<ScoreHalf half={{ ...half, call: null }} flash={0} onTap={vi.fn()} />);
    expect(screen.queryByTestId('call')).toBeNull();
  });

  it('puts the plate in the bottom row after the boxes and before "Tap"', () => {
    renderWithPorts(
      <ScoreHalf half={called('scoring.pad.call.gamePoint')} flash={0} onTap={vi.fn()} />,
    );
    const row = screen.getByTestId('call').parentElement;
    const order = [...(row?.children ?? [])].map((child) => child.textContent);
    expect(order).toEqual(['21', 'Game point', 'Tap']);
  });

  it('is a lime plate with night ink, as the serving plate is', () => {
    renderWithPorts(
      <ScoreHalf half={called('scoring.pad.call.gamePoint')} flash={0} onTap={vi.fn()} />,
    );
    const plate = screen.getByTestId('call');
    expect(paintOf(plate).fill).toBe(fillOf(colour.lime));
    expect(getComputedStyle(screen.getByText('Game point')).color).toBe(edgeOf(plateInk));
  });

  it('gives way after the hint and the doubles server: the plate’s own weight is a tenth of the line’s', () => {
    renderWithPorts(
      <ScoreHalf
        half={{
          ...called('scoring.pad.call.matchPoint'),
          sub: { key: 'scoring.tabletennis.serverPerson', vars: { person: 'M. Wong' } },
        }}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    const plate = screen.getByTestId('call');
    expect(declaredStyle(plate, 'flex-shrink')).toBe('0.1');
    expect(declaredStyle(screen.getByText('M. Wong serves'), 'flex-shrink')).toBe('1');
    expect(declaredStyle(screen.getByText('Tap'), 'flex-grow')).toBe('1');
  });

  it('leaves the server line kept as before when no call is shown', () => {
    renderWithPorts(
      <ScoreHalf
        half={{
          ...half,
          sub: { key: 'scoring.tabletennis.serverPerson', vars: { person: 'M. Wong' } },
        }}
        flash={0}
        onTap={vi.fn()}
      />,
    );
    expect(declaredStyle(screen.getByText('M. Wong serves'), 'flex-shrink')).toBe('0');
  });
});
