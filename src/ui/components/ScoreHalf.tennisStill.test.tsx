import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadHalf } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { MessageKey } from '@/i18n/messages';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { declaredStyle } from '../../../test/declaredStyle';
import { loadFont } from '../../../test/fontMetrics';
import { layOut } from '../../../test/layOut';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The score holds still when a call comes or goes (owner ruling "own line, always kept"). jsdom has no layout, so the row's height is
// MEASURED here from what the half actually renders: each item the scoreboard's items hold, as wide as the tokens and the shipped
// fonts say, packed into the first line's room (the half's inner width less the gap and the word Tap), plus the height of the
// call line as its own declared styles give it. That height is then delivered to the half as its row's layout and the big call's
// size is read back. A plate that makes the row taller, or a reserve that is not there, moves it.

const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
const T = 'scoring.tennis.board.';
const barlow600 = loadFont('barlow-condensed-600');
const barlow700 = loadFont('barlow-condensed-700');
const geist500 = loadFont('geist-500');
const dictionaryOf = (lang: string) => LANGUAGES.find(([name]) => name === lang)?.[1] ?? en;

const labelWidth = (text: string) =>
  barlow600.width(text.toUpperCase(), typeScale.boardLabel.fontSize) +
  typeScale.boardLabel.letterSpacing * [...text].length;
const boxWidth = Math.max(
  layout.padBoardBox,
  barlow700.width('00', typeScale.boardScore.fontSize) + 2 * space.xs,
);
const plateWidth = (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale.state.fontSize) +
  typeScale.state.letterSpacing * [...text].length +
  2 * space.sm;
/** At 320: the column less the half's side bar and padding. */
const halfInner = 320 - 2 * space.md - layout.padSideBar - 2 * space.md;

type Call = 'break' | 'set' | 'match' | null;
const KEYS = {
  break: 'scoring.pad.call.breakPoint',
  set: 'scoring.pad.call.setPoint',
  match: 'scoring.pad.call.matchPoint',
} as const;

const half = (call: Call, sets: number, dots: number): PadHalf<MessageKey> => ({
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
    sets: Array.from({ length: sets }, () => '6'),
    dots: Array.from({ length: dots }, (_, at) => at + 1),
    said: [],
  },
  call: call === null ? null : { text: { key: KEYS[call] }, said: { key: KEYS[call] } },
});

/** How many lines `widths` take in `room`, `space.xs` apart, an item that does not fit starting the next line. */
function linesOf(widths: readonly number[], room: number): number {
  let lines = 1;
  let used = 0;
  for (const width of widths) {
    if (used !== 0 && used + space.xs + width > room) {
      lines += 1;
      used = width;
    } else used = used === 0 ? width : used + space.xs + width;
  }
  return lines;
}

/** The scoreboard row's height, measured from the rendered tree: the items' lines, then the call line's own height. */
function rowHeightOf(lang: string): number {
  const dictionary = dictionaryOf(lang) as Record<string, string>;
  const row = screen.getByTestId('scoreboard');
  const items = row.firstElementChild?.firstElementChild;
  if (!(items instanceof HTMLElement)) throw new Error('the row has no items');
  const widths = [...items.children].map((child) => {
    const id = child.getAttribute('data-testid');
    if (id === 'board-set') return boxWidth;
    if (id === 'game-dot') return layout.padDot;
    if (id === 'call') return plateWidth(child.textContent ?? '');
    return labelWidth(child.textContent ?? '');
  });
  const tap = geist500.width(dictionary['scoring.pad.tap'] ?? '', typeScale.metricUnit.fontSize);
  const lines = linesOf(widths, halfInner - space.sm - tap);
  const first = typeScale.boardScore.lineHeight;
  const dotLine = layout.padDot + layout.padDotGap;
  const line = screen.queryByTestId('call-line');
  const kept =
    line === null
      ? 0
      : Math.max(
          parseFloat(declaredStyle(line, 'min-height')) || 0,
          line.children.length === 0 ? 0 : typeScale.state.lineHeight,
        ) + (parseFloat(declaredStyle(line, 'margin-top')) || 0);
  return first + (lines - 1) * dotLine + kept;
}

const ROWS = [0, 1, 2, 3, 4].flatMap((sets) => [0, 1, 2, 3, 4, 5, 6].map((dots) => [sets, dots]));
const HEIGHTS = [198, 217, 243] as const;

describe('ScoreHalf: the score holds still when a tennis call comes and goes (320 dp rows, measured from the rendered row)', () => {
  const measured = (lang: string, call: Call, sets: number, dots: number, height: number) => {
    const view = renderWithPorts(
      <ScoreHalf half={half(call, sets, dots)} flash={0} onTap={vi.fn()} />,
      {
        deviceLanguages: [lang as 'en'],
      },
    );
    const rowHeight = rowHeightOf(lang);
    layOut(screen.getByTestId('half-second'), { width: 288, height });
    layOut(screen.getByTestId('scoreboard'), { width: 288, height: rowHeight });
    const size = getComputedStyle(screen.getByTestId('score')).fontSize;
    view.unmount();
    return { rowHeight, size };
  };

  it.each(LANGUAGES)(
    '%s: the row is as tall, and the big call as large, with each call as with none, in every row of 0-4 sets over and 0-6 dots',
    (lang) => {
      for (const [sets, dots] of ROWS)
        for (const height of HEIGHTS) {
          const none = measured(lang, null, sets!, dots!, height);
          for (const call of ['break', 'set', 'match'] as const)
            expect(
              measured(lang, call, sets!, dots!, height),
              `${call} ${sets}/${dots}@${height}`,
            ).toEqual(none);
        }
    },
  );

  it('measures something real (anti-vacuity): the row is two lines taller with twelve dots, and keeps the 19 dp line', () => {
    const one = measured('en', null, 2, 2, 217);
    const many = measured('en', null, 2, 6, 217);
    expect(one.rowHeight).toBe(typeScale.boardScore.lineHeight + 19);
    expect(many.rowHeight).toBeGreaterThan(one.rowHeight);
  });
});
