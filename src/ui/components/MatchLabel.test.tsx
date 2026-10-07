import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** Spec §2: 20 sp, and 17 sp for a long label. Written from the spec, never read from the type scale. */
const SIZE_PX = { regular: '20px', long: '17px' } as const;

/**
 * How many lines react-native-web lets a Text show, read from what it rendered
 * (`getComputedStyle`), not from the prop. It renders `numberOfLines={2}` as
 * `-webkit-line-clamp: 2`, and `numberOfLines={1}` as no clamp at all but one
 * unwrapped line that ends in an ellipsis. Anything else is unbounded.
 */
function linesAllowed(element: Element): number {
  const style = getComputedStyle(element);
  const clamp = style.getPropertyValue('-webkit-line-clamp');
  if (clamp !== '') return Number(clamp);
  if (style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis') return 1;
  return Infinity;
}

const lineElements = (root: HTMLElement) => [
  ...root.querySelectorAll('[data-testid="match-label-line"]'),
];

/** The fake pairs with this label, as a claim's answer would carry it. */
function pairedWith(label: string) {
  const view = renderWithPorts(<MatchLabel />);
  act(() => {
    view.engine.setPairing({ label });
    view.engine.scene('paired-ready');
  });
  return view;
}

let seen = 0;

describe('MatchLabel (spec §2)', () => {
  it('renders nothing before there is a pairing', () => {
    renderWithPorts(<MatchLabel />);
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  it('renders nothing while the pairing’s label is still empty (not answered yet)', () => {
    pairedWith('');
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  it.each(CASES)(
    '%s: its lines, its v, its size and each line’s wrap',
    (_n, label, shape, size) => {
      pairedWith(label);
      const root = screen.getByTestId('match-label');
      const parts = shape.kind === 'block' ? [shape.block] : [shape.a, shape.b];
      const lines = lineElements(root);
      expect(lines.map((line) => line.textContent)).toEqual(parts.flatMap((part) => part.lines));
      expect(lines.map(linesAllowed)).toEqual(
        parts.flatMap((part) => part.lines.map(() => part.wrap)),
      );
      for (const line of lines) expect(getComputedStyle(line).fontSize).toBe(SIZE_PX[size]);
      expect(root.dataset.size).toBe(size);
      expect(root.dataset.kind).toBe(shape.kind);

      const v = screen.queryByTestId('match-label-v');
      if (shape.kind === 'block') {
        expect(v).toBeNull();
        // Nothing is shown but the block's lines.
        expect(root.textContent).toBe(shape.block.lines.join(''));
      } else {
        expect(v?.textContent).toBe('v');
        // The v shares a row with side B's first line, after side A's last.
        const row = v?.parentElement as HTMLElement;
        const firstOfB = lines[shape.a.lines.length];
        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(row.contains(firstOfB)).toBe(true);
        expect(row.contains(lines[0])).toBe(false);
        expect(root.textContent).toBe(`${shape.a.lines.join('')}v${shape.b.lines.join('')}`);
      }
      seen += 1;
    },
  );

  it('showed every case §2 owes', () => {
    expect(seen).toBe(7);
  });

  it('follows the label as it changes, and goes when the pairing does', () => {
    const view = pairedWith('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy');
    const root = () => screen.getByTestId('match-label');
    expect(root().dataset.size).toBe('long');

    act(() => view.engine.setPairing({ label: 'Ana Ruiz v Bea Lima' }));
    expect(lineElements(root()).map((line) => line.textContent)).toEqual(['Ana Ruiz', 'Bea Lima']);
    expect(root().dataset.size).toBe('regular');

    act(() => view.engine.scene('unpaired-replaced'));
    expect(screen.queryByTestId('match-label')).toBeNull();
  });
});
