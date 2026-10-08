import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Advisory } from '@/hooks/advisory';
import { StatusStrip } from '@/ui/components/StatusStrip';
import { layOut } from '../../../test/layOut';
import { renderWithPorts } from '../../../test/renderWithPorts';

// F19: the label's height cannot be measured in jsdom, and the production StatusStrip takes no test-only
// prop. So MatchLabel is replaced by a stand-in that captures the REAL `onLayoutHeight` StatusStrip passes
// it, and a hoisted holder lets the test call it, as the phone would after laying the label out.
const standIn = vi.hoisted(() => ({
  report: undefined as undefined | ((height: number) => void),
}));

vi.mock('@/ui/components/MatchLabel', async () => {
  const { createElement } = await import('react');
  const { View } = await import('react-native');
  return {
    MatchLabel: ({ onLayoutHeight }: { onLayoutHeight?: (height: number) => void }) => {
      standIn.report = onLayoutHeight;
      return createElement(View, { testID: 'match-label' });
    },
  };
});

function stripWith(
  stageLabel: string | null,
  label = 'A v B',
  advisory: Advisory | null = null,
  onLabelHeight?: (height: number) => void,
) {
  standIn.report = undefined;
  const view = renderWithPorts(
    <StatusStrip line="Ready" advisory={advisory} onLabelHeight={onLabelHeight} />,
  );
  act(() => {
    view.engine.setPairing({ label, stageLabel });
    view.engine.scene('paired-ready');
  });
  return view;
}
const label = (height: number) => act(() => standIn.report?.(height));
const strip = (height: number) =>
  layOut(screen.getByTestId('status-strip'), { width: 320, height });
const line = () => screen.queryByTestId('stage-line');

// This is a WIRING test, not a fit proof: the fit itself is stageFit.test.ts's arithmetic and Task 11's
// device check. The heights are the strip's 180 and the table's labels. With no caption up the round line needs 88 dp
// and the label (44: two regular lines, 57: three long ones), so both fit a 180 strip; with a caption up it needs 126
// and the label, so 44 fits (170) and 57 does not (183).
describe('the status strip shows the round line only when it fits (R-F5)', () => {
  it('hands the label a real function to report its height with (the wiring is not vacuous)', () => {
    stripWith('QF');
    expect(typeof standIn.report).toBe('function');
  });

  it('shows it, above the label, with the strip at 180 and the label at 44', () => {
    stripWith('QF');
    strip(180);
    label(44);
    expect(line()?.textContent).toBe('QF');
    // Above the label, in the document.
    const above = screen.getByTestId('stage-line');
    const below = screen.getByTestId('match-label');
    expect(above.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('hides it when the label is three lines (57) and a caption is up, and shows it with no caption', () => {
    const view = stripWith('QF', 'A v B', 'notCharging');
    strip(180);
    label(57);
    expect(line()).toBeNull();
    // The positive pair: the same strip and label, the caption gone, and the caption's room is room.
    view.rerender(<StatusStrip line="Ready" advisory={null} />);
    expect(line()?.textContent).toBe('QF');
  });

  it('a caption coming up takes it away and the caption going brings it back, at the same strip (148, the reserve of a 44 label)', () => {
    const view = stripWith('QF');
    strip(148);
    label(44);
    expect(line()?.textContent).toBe('QF');
    view.rerender(<StatusStrip line="Ready" advisory="shed" />);
    expect(line()).toBeNull();
    view.rerender(<StatusStrip line="Ready" advisory="keepOpen" />);
    expect(line()).toBeNull();
    view.rerender(<StatusStrip line="Ready" advisory={null} />);
    expect(line()?.textContent).toBe('QF');
  });

  it('tells its caller the label’s height, each time it is laid out (the picture is sized from it), and nothing else', () => {
    const heights: number[] = [];
    const view = stripWith('QF', 'A v B', null, (height) => heights.push(height));
    label(44);
    label(76);
    expect(heights).toEqual([44, 76]);
    // The strip's own layout and the round line are not the label's height: nothing more is said.
    strip(180);
    view.rerender(
      <StatusStrip line="Ready" advisory={null} onLabelHeight={(h) => heights.push(h)} />,
    );
    expect(heights).toEqual([44, 76]);
  });

  it('hides it until the strip has been laid out', () => {
    stripWith('QF');
    label(44);
    expect(line()).toBeNull();
    strip(180);
    expect(line()).not.toBeNull();
  });

  it('hides it again if the strip reports nothing (0), unmeasured', () => {
    stripWith('QF');
    strip(180);
    label(44);
    expect(line()).not.toBeNull();
    strip(0);
    expect(line()).toBeNull();
  });

  it('hides it until the label has been laid out', () => {
    stripWith('QF');
    strip(180);
    expect(line()).toBeNull();
    label(44);
    expect(line()).not.toBeNull();
  });

  it('brings it back when a shorter label arrives (57, then 44), a caption up', () => {
    stripWith('QF', 'A v B', 'notCharging');
    strip(180);
    label(57);
    expect(line()).toBeNull();
    label(44);
    expect(line()?.textContent).toBe('QF');
  });

  it('takes it away when a longer label arrives (44, then 57), a caption up', () => {
    stripWith('QF', 'A v B', 'notCharging');
    strip(180);
    label(44);
    expect(line()).not.toBeNull();
    label(57);
    expect(line()).toBeNull();
  });

  it('shows nothing with no stage label even when it would fit (positive pair: the same strip, given one, shows it)', () => {
    const view = stripWith(null);
    strip(180);
    label(44);
    expect(line()).toBeNull();
    act(() => view.engine.setPairing({ stageLabel: 'QF' }));
    expect(line()?.textContent).toBe('QF');
    act(() => view.engine.setPairing({ stageLabel: null }));
    expect(line()).toBeNull();
  });

  it('shows nothing for a stage label while the match label is still empty', () => {
    stripWith('QF', '');
    strip(180);
    label(44);
    expect(line()).toBeNull();
  });
});
