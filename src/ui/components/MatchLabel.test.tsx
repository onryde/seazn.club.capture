import { act, render, screen } from '@testing-library/react';
import { StyleSheet, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { Text } from '@/ui/components/Text';
import { colour } from '@/ui/theme/tokens';
import { CASES } from '../../../test/fixtures/matchLabelCases';
import { layOut } from '../../../test/layOut';
import { linesAllowed } from '../../../test/linesAllowed';
import { renderWithPorts } from '../../../test/renderWithPorts';

/** The fake pairs with this label, as a claim's answer would carry it. */
function pairedWith(label: string, onLayoutHeight?: (height: number) => void) {
  const view = renderWithPorts(<MatchLabel onLayoutHeight={onLayoutHeight} />);
  act(() => {
    view.engine.setPairing({ label });
    view.engine.scene('paired-ready');
  });
  return view;
}

const lineTexts = () =>
  screen.getAllByTestId('match-label-line').map((line) => line.textContent ?? '');

/**
 * What the spec's colour tokens paint, read the way the other tests read colours (GhostButton.test.tsx): a reference
 * drawn with the token, so the rendered cascade is compared with the cascade, not a literal.
 */
const PAINT = StyleSheet.create({
  lime: { backgroundColor: colour.lime },
  lilac: { backgroundColor: colour.ink3 },
  ink2: { color: colour.ink2 },
});
function background(style: object): string {
  const reference = render(<View testID="paint-reference" style={style} />);
  const read = getComputedStyle(reference.getByTestId('paint-reference')).backgroundColor;
  reference.unmount();
  return read;
}
function textColour(style: object): string {
  const reference = render(
    <Text variant="metricUnit" testID="paint-reference" style={style}>
      v
    </Text>,
  );
  const read = getComputedStyle(reference.getByTestId('paint-reference')).color;
  reference.unmount();
  return read;
}

let swept = 0;

describe('MatchLabel, C2 (D2 §4.4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('two sides: a row each with a bar, lime first and lilac second, and one decorative v', () => {
    pairedWith('Ana Ruiz v Bea Lima');
    expect(lineTexts()).toEqual(['Ana Ruiz', 'Bea Lima']);
    const bars = screen.getAllByTestId('match-label-bar');
    expect(bars.map((bar) => bar.dataset.side)).toEqual(['first', 'second']);
    expect(screen.getAllByTestId('match-label-v')).toHaveLength(1);
    expect(screen.getByTestId('match-label').dataset.kind).toBe('sides');
  });

  // Spec §4.4: a 3 dp bar at each row's left edge, lime then lilac (ink3), 5 dp from the names; the v in ink2 in a
  // fixed 14 dp margin outside both rows. Numbers from the spec's text, colours from the tokens it names.
  it('draws C2’s measures: 3 dp bars 5 dp from the names, the v in ink2 in a 14 dp margin', () => {
    pairedWith('Ana Ruiz v Bea Lima');
    const bars = screen.getAllByTestId('match-label-bar');
    expect(bars.map((bar) => getComputedStyle(bar).width)).toEqual(['3px', '3px']);
    expect(bars.map((bar) => getComputedStyle(bar).backgroundColor)).toEqual([
      background(PAINT.lime),
      background(PAINT.lilac),
    ]);
    expect(background(PAINT.lime)).not.toBe(background(PAINT.lilac));
    for (const bar of bars) {
      const row = bar.parentElement as HTMLElement;
      expect([getComputedStyle(row).flexDirection, getComputedStyle(row).gap]).toEqual([
        'row',
        '5px',
      ]);
    }
    const v = screen.getByTestId('match-label-v');
    expect(getComputedStyle(v).color).toBe(textColour(PAINT.ink2));
    const margin = v.parentElement as HTMLElement;
    expect(getComputedStyle(margin).width).toBe('14px');
    // Outside both rows: the margin holds no name.
    expect(margin.querySelector('[data-testid="match-label-line"]')).toBeNull();
  });

  it('caps each side at 2 lines, ending in an ellipsis (Review Focus 4)', () => {
    pairedWith(
      'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    );
    const rows = screen.getAllByTestId('match-label-line');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(linesAllowed(row)).toBe(2);
      expect(getComputedStyle(row).textOverflow).toBe('ellipsis');
    }
  });

  it('one side only: one row, no bar and no v', () => {
    pairedWith('Match 4');
    expect(lineTexts()).toEqual(['Match 4']);
    expect(screen.queryAllByTestId('match-label-bar')).toHaveLength(0);
    expect(screen.queryByTestId('match-label-v')).toBeNull();
    expect(screen.getByTestId('match-label').dataset.kind).toBe('block');
    expect(linesAllowed(screen.getByTestId('match-label-line'))).toBe(2);
  });

  it('doubles: each side in full, partners joined by " / "', () => {
    pairedWith('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy');
    expect(lineTexts()).toEqual(['Ana Ruiz / Bea Lima', 'Cai Wen / Dee Roy']);
  });

  it('an empty label draws nothing', () => {
    pairedWith('');
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  // The four questions, 2: a label of nothing but spaces is not a label; it draws nothing, not an empty row.
  it('a label of only spaces draws nothing', () => {
    pairedWith('   ');
    expect(screen.queryByTestId('match-label')).toBeNull();
  });

  it('reads the label once, whole, to a screen reader; the v is hidden from it', () => {
    pairedWith('Ana Ruiz v Bea Lima');
    expect(screen.getByTestId('match-label').getAttribute('aria-label')).toBe(
      'Ana Ruiz v Bea Lima',
    );
    expect(screen.getByLabelText('Ana Ruiz v Bea Lima')).toBe(screen.getByTestId('match-label'));
    expect(screen.getByTestId('match-label-v').getAttribute('aria-hidden')).toBe('true');
  });

  it.each(CASES)('%s: at most 4 lines in all, 2 a side, one size', (_name, label, shape) => {
    pairedWith(label);
    swept += 1;
    if (shape.kind === 'block' && shape.text === '') {
      expect(screen.queryByTestId('match-label')).toBeNull();
      return;
    }
    const root = screen.getByTestId('match-label');
    const lines = [...root.querySelectorAll('[data-testid="match-label-line"]')];
    expect(lines.map((line) => line.textContent)).toEqual(
      shape.kind === 'sides' ? [shape.a, shape.b] : [shape.text],
    );
    expect(lines.reduce((sum, line) => sum + linesAllowed(line), 0)).toBeLessThanOrEqual(4);
    expect(new Set(lines.map((line) => getComputedStyle(line).fontSize))).toEqual(
      new Set(['20px']),
    );
  });

  it('swept all thirteen labels (anti-vacuity)', () => {
    expect(CASES).toHaveLength(13);
    expect(swept).toBe(13);
  });

  it('follows the label as it changes, and goes when the pairing does', () => {
    const view = pairedWith('Ana Ruiz / Bea Lima v Cai Wen / Dee Roy');
    expect(lineTexts()).toEqual(['Ana Ruiz / Bea Lima', 'Cai Wen / Dee Roy']);

    act(() => view.engine.setPairing({ label: 'Match 4' }));
    expect(lineTexts()).toEqual(['Match 4']);
    expect(screen.queryByTestId('match-label-v')).toBeNull();
    expect(screen.getByLabelText('Match 4')).toBe(screen.getByTestId('match-label'));

    act(() => view.engine.scene('unpaired-replaced'));
    expect(screen.queryByTestId('match-label')).toBeNull();
  });
});

describe('MatchLabel reports its height (R-F5)', () => {
  it('renders nothing before there is a pairing', () => {
    renderWithPorts(<MatchLabel />);
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
    layOut(screen.getByTestId('match-label'), { width: 300, height: 88 });
    expect(heights.mock.calls).toEqual([[44], [0], [88]]);
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
