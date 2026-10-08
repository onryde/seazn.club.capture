import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { typeScale } from '@/ui/theme/type';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { layOut } from '../../../test/layOut';
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
function pairedWith(label: string, onLayoutHeight?: (height: number) => void) {
  const view = renderWithPorts(<MatchLabel onLayoutHeight={onLayoutHeight} />);
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
      // Review M4: the whole label, as typed, is the root's accessible name: one stop, not three.
      expect(screen.getByLabelText(label)).toBe(root);
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
        // Review M3: the small v is the metricUnit role's size, read from the token's declaration.
        expect(getComputedStyle(v as HTMLElement).fontSize).toBe(
          `${typeScale.metricUnit.fontSize}px`,
        );
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

  it('showed every case §2 and the review owe', () => {
    expect(seen).toBe(12);
  });

  it('follows the label as it changes, and goes when the pairing does', () => {
    const view = pairedWith('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy');
    const root = () => screen.getByTestId('match-label');
    expect(root().dataset.size).toBe('long');

    act(() => view.engine.setPairing({ label: 'Ana Ruiz v Bea Lima' }));
    expect(lineElements(root()).map((line) => line.textContent)).toEqual(['Ana Ruiz', 'Bea Lima']);
    expect(root().dataset.size).toBe('regular');
    expect(screen.getByLabelText('Ana Ruiz v Bea Lima')).toBe(root());

    act(() => view.engine.scene('unpaired-replaced'));
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  // R-F5: the strip decides whether the round line fits from the label's height, so the label reports it.
  it('reports its height to onLayoutHeight, and again when the layout changes (R-F5)', () => {
    const heights = vi.fn();
    pairedWith('Ana Ruiz v Bea Lima', heights);
    const root = screen.getByTestId('match-label');
    layOut(root, { width: 300, height: 44 });
    expect(heights.mock.calls).toEqual([[44]]);
    layOut(root, { width: 300, height: 57 });
    expect(heights.mock.calls).toEqual([[44], [57]]);
  });

  // The picture is sized from the label's measured height (`stripReserve`), so a label that goes takes its height
  // with it: a new label must not be judged by the last one's, for the frame before it is laid out.
  it('reports 0 when the label goes, so its height is unmeasured again, not the last one’s (R-F5)', () => {
    const heights = vi.fn();
    const view = pairedWith('Ana Ruiz v Bea Lima', heights);
    layOut(screen.getByTestId('match-label'), { width: 300, height: 44 });
    expect(heights.mock.calls).toEqual([[44]]);
    act(() => view.engine.scene('unpaired-replaced'));
    expect(screen.queryByTestId('match-label')).toBeNull();
    expect(heights.mock.calls.at(-1)).toEqual([0]);
  });

  // The same instance would be judged by the old label's height until it lays out again: a label that changes in
  // place is a new label (keyed on its text), so the old height goes with the old one.
  it('reports 0 when the label changes in place, then the new label’s own height (R-F5)', () => {
    const heights = vi.fn();
    const view = pairedWith('Ana Ruiz v Bea Lima', heights);
    layOut(screen.getByTestId('match-label'), { width: 300, height: 44 });
    act(() => view.engine.setPairing({ label: 'Ana Ruiz / Bea Lima v Cai Wen / Dee Roy' }));
    expect(screen.getByLabelText('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy')).toBeTruthy();
    expect(heights.mock.calls).toEqual([[44], [0]]);
    layOut(screen.getByTestId('match-label'), { width: 300, height: 76 });
    expect(heights.mock.calls).toEqual([[44], [0], [76]]);
  });

  // The strip passes a state setter, which is stable, but nothing in the type says a caller must: a callback made
  // anew on every render must neither read as a label that went (a height stuck at 0, the line dead) nor be the
  // one the label is stuck with.
  it('takes a callback that is new on every render: no reset, and the newest one is called', () => {
    const calls: (readonly [number, number])[] = [];
    function Probe({ render }: { render: number }) {
      return <MatchLabel onLayoutHeight={(height) => calls.push([render, height])} />;
    }
    const view = renderWithPorts(<Probe render={1} />);
    act(() => {
      view.engine.setPairing({ label: 'Ana Ruiz v Bea Lima' });
      view.engine.scene('paired-ready');
    });
    layOut(screen.getByTestId('match-label'), { width: 300, height: 44 });
    expect(calls).toEqual([[1, 44]]);
    view.rerender(<Probe render={2} />);
    view.rerender(<Probe render={3} />);
    // Two new callbacks, and still nothing said: the label did not go.
    expect(calls).toEqual([[1, 44]]);
    layOut(screen.getByTestId('match-label'), { width: 300, height: 57 });
    expect(calls).toEqual([
      [1, 44],
      [3, 57],
    ]);
    // And when it does go, the newest callback hears it.
    act(() => view.engine.scene('unpaired-replaced'));
    expect(calls.at(-1)).toEqual([3, 0]);
  });

  it('lays out without an onLayoutHeight too: the handler tolerates its absence', () => {
    pairedWith('Ana Ruiz v Bea Lima');
    expect(() =>
      layOut(screen.getByTestId('match-label'), { width: 300, height: 44 }),
    ).not.toThrow();
  });
});
