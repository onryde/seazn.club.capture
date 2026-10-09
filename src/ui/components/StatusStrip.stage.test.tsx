import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADVISORY_KEY, type Advisory } from '@/hooks/advisory';
import en from '@/i18n/en.json';
import { StatusStrip } from '@/ui/components/StatusStrip';
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
    <StatusStrip
      line="Ready"
      lineTier="routine"
      advisory={advisory}
      onLabelHeight={onLabelHeight}
    />,
  );
  act(() => {
    view.engine.setPairing({ label, stageLabel });
    view.engine.scene('paired-ready');
  });
  return view;
}
const label = (height: number) => act(() => standIn.report?.(height));
const line = () => screen.queryByTestId('stage-line');

// This is a WIRING test, not a fit proof: the room is the arithmetic of cameraBox.test.ts (the reserve holds the round
// line's 22 dp whether or not this match has a stage) and viewfinderFit.test.ts. Owner, 2026-10-08, option B: the round
// line is ALWAYS shown. It is not asked whether it fits: the strip neither measures itself nor the label for it, and a
// stage label, once the match label is there, is on screen at every window and for every label height.
describe('the status strip always shows the round line, whenever there is one (option B)', () => {
  it('hands the label the caller’s function to report its height with (the wiring is not vacuous)', () => {
    const onLabelHeight = vi.fn();
    stripWith('Open · QF', 'A v B', null, onLabelHeight);
    expect(standIn.report).toBe(onLabelHeight);
    label(44);
    expect(onLabelHeight).toHaveBeenCalledExactlyOnceWith(44);
  });

  it('shows it, above the label, before anything has been laid out or measured', () => {
    stripWith('Open · QF');
    expect(line()?.textContent).toBe('Open · QF');
    // Above the label, in the document.
    const above = screen.getByTestId('stage-line');
    const below = screen.getByTestId('match-label');
    expect(above.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  // The old rule hid it for three lines of label, an unmeasured label and a short strip. None of those hide it now.
  it.each([
    ['unmeasured (0)', 0],
    ['one regular line', 22],
    ['two regular lines', 44],
    ['between two and three lines', 57],
    ['three regular lines', 66],
    ['four lines, the worst case (C2, D2 §4.4)', 88],
    ['a large system text size', 120],
  ])('shows it for a label that is %s (%d dp)', (_name, height) => {
    stripWith('Open · QF');
    label(height);
    expect(line()?.textContent).toBe('Open · QF');
  });

  it('shows it through a label that grows and shrinks (57, 44, 76), never hiding', () => {
    stripWith('Open · QF');
    for (const height of [57, 44, 76, 22, 0]) {
      label(height);
      expect(line()?.textContent, `label ${height}`).toBe('Open · QF');
    }
  });

  // The caption takes the message line, not more room, and never the round line's: five captions and an urgent line,
  // a caption up or not, change nothing about it. Written from the engine's own declarations of the captions.
  it('shows it the same under every caption, under an urgent line, and with none', () => {
    const captions = Object.keys(ADVISORY_KEY) as Advisory[];
    expect(captions).toHaveLength(5);
    const view = stripWith('Open · QF', 'A v B', null);
    label(44);
    let checked = 0;
    for (const advisory of captions) {
      view.rerender(<StatusStrip line="Ready" lineTier="routine" advisory={advisory} />);
      // The caption is the one message, and the round line is still there.
      expect(screen.getByTestId('strip-message').textContent).toBe(en[ADVISORY_KEY[advisory]]);
      expect(line()?.textContent, advisory).toBe('Open · QF');
      view.rerender(
        <StatusStrip line="No streaming credit" lineTier="urgent" advisory={advisory} />,
      );
      expect(screen.getByTestId('strip-message').textContent).toBe('No streaming credit');
      expect(line()?.textContent, `${advisory}, urgent`).toBe('Open · QF');
      checked += 1;
    }
    view.rerender(<StatusStrip line="Ready" lineTier="routine" advisory={null} />);
    expect(line()?.textContent).toBe('Open · QF');
    expect(checked).toBe(5);
  });

  it('tells its caller the label’s height, each time it is laid out (the picture is sized from it), and nothing else', () => {
    const heights: number[] = [];
    const view = stripWith('Open · QF', 'A v B', null, (height) => heights.push(height));
    label(44);
    label(76);
    expect(heights).toEqual([44, 76]);
    // The round line and a re-render are not the label's height: nothing more is said.
    view.rerender(
      <StatusStrip
        line="Ready"
        lineTier="routine"
        advisory={null}
        onLabelHeight={(h) => heights.push(h)}
      />,
    );
    expect(heights).toEqual([44, 76]);
  });

  it('shows nothing with no stage label (positive pair: the same strip, given one, shows it, and takes it away again)', () => {
    const view = stripWith(null);
    label(44);
    expect(line()).toBeNull();
    act(() => view.engine.setPairing({ stageLabel: 'Open · QF' }));
    expect(line()?.textContent).toBe('Open · QF');
    act(() => view.engine.setPairing({ stageLabel: null }));
    expect(line()).toBeNull();
  });

  it('shows nothing for a stage label while the match label is still empty', () => {
    stripWith('Open · QF', '');
    label(44);
    expect(line()).toBeNull();
  });
});
