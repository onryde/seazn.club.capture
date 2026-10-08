import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

function stripWith(stageLabel: string | null, label = 'A v B') {
  standIn.report = undefined;
  const view = renderWithPorts(<StatusStrip line="Ready" advisory={null} />);
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
// device check. The heights are the strip's 180 and the table's labels: 44 (two regular lines) fits the 54 dp
// room, 57 (three long lines) does not.
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

  it('hides it when the label is three lines (57)', () => {
    stripWith('QF');
    strip(180);
    label(57);
    expect(line()).toBeNull();
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

  it('brings it back when a shorter label arrives (57, then 44)', () => {
    stripWith('QF');
    strip(180);
    label(57);
    expect(line()).toBeNull();
    label(44);
    expect(line()?.textContent).toBe('QF');
  });

  it('takes it away when a longer label arrives (44, then 57)', () => {
    stripWith('QF');
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
