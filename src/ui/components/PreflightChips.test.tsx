import { act, render, screen, within } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { colour, layout } from '@/ui/theme/tokens';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';

const GREEN = { camera: true, network: true, sound: true };
/** No AUTO and no scheduled start: the chips alone. */
const QUIET = { auto: false, startsAt: null } as const;

/** Which token a chip's border took (jsdom's cascade); what a phone draws is a device check. */
const TOKEN = StyleSheet.create({
  ok: { borderWidth: 2, borderColor: colour.lime },
  off: { borderWidth: 2, borderColor: colour.caution },
});

function borderOf(style: ViewStyle): string {
  const reference = render(<View testID="border-reference" style={style} />);
  const border = getComputedStyle(reference.getByTestId('border-reference')).borderTopColor;
  reference.unmount();
  return border;
}

describe('PreflightChips (spec §1)', () => {
  it('names every chip and whether it is ready', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, sound: false }} {...QUIET} />);
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Mic: not ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
  });

  // Amendment §2: the code chip went with the go-live deadline; native's
  // verdict names three checks.
  it('shows them in the spec’s order: camera, sound, network, and nothing else', () => {
    const view = renderWithPorts(<PreflightChips preflight={GREEN} {...QUIET} />);
    const labels = [...view.container.querySelectorAll('[aria-label]')].map((chip) =>
      chip.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Camera: ready', 'Mic: ready', 'Network: ready']);
  });

  it('borders a ready chip lime and a chip that is not ready orange', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, network: false }} {...QUIET} />);
    const border = (label: string) => getComputedStyle(screen.getByLabelText(label)).borderTopColor;
    expect(border('Camera: ready')).toBe(borderOf(TOKEN.ok));
    expect(border('Network: not ready')).toBe(borderOf(TOKEN.off));
  });

  it('says nothing about a deadline: there is none to go live by', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} {...QUIET} />);
    expect(screen.queryByText(/Go live by/)).toBeNull();
  });

  // Amendment §2 (A4): AUTO only when automatic mode is on at both ends.
  it('shows AUTO beside the chips only when it is on', () => {
    const { rerender } = renderWithPorts(
      <PreflightChips preflight={GREEN} auto={true} startsAt={null} />,
    );
    expect(screen.getByText('Auto')).toBeTruthy();
    rerender(<PreflightChips preflight={GREEN} auto={false} startsAt={null} />);
    expect(screen.queryByText('Auto')).toBeNull();
  });

  // A word, not a check: a screen reader reads "Auto", never "Auto: ready".
  it('gives AUTO no ready or not-ready label, and keeps the three chips’ labels', () => {
    const view = renderWithPorts(<PreflightChips preflight={GREEN} auto={true} startsAt={null} />);
    const labels = [...view.container.querySelectorAll('[aria-label]')].map((chip) =>
      chip.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Camera: ready', 'Mic: ready', 'Network: ready']);
  });

  it('says when it starts under the chips, and nothing without a scheduled start', () => {
    const { rerender } = renderWithPorts(
      <PreflightChips preflight={GREEN} auto={false} startsAt="14:32" />,
    );
    expect(screen.getByText('Starts 14:32')).toBeTruthy();
    rerender(<PreflightChips preflight={GREEN} auto={false} startsAt={null} />);
    expect(screen.queryByText(/^Starts/)).toBeNull();
  });
});

/**
 * Spec §3: the chips are icons. Each row is a chip, whether it is ready, and what spec §3 says it
 * draws then: a camera that is not ready gains a slash, and the other two never do; the state is in
 * the glyph's colour (lime ready, caution-orange not). Written out from the spec, not read from the
 * component.
 */
const ICON_CASES = [
  ['camera', 'Camera', true, 'camera', false, 'lime'],
  ['camera', 'Camera', false, 'camera', true, 'caution'],
  ['sound', 'Mic', true, 'mic', false, 'lime'],
  ['sound', 'Mic', false, 'mic', false, 'caution'],
  ['network', 'Network', true, 'network', false, 'lime'],
  ['network', 'Network', false, 'network', false, 'caution'],
] as const;
let iconCasesRun = 0;

describe('PreflightChips are icons (spec §3)', () => {
  it.each(ICON_CASES)(
    '%s chip (%s), ready=%s: the %s glyph, slashed=%s, in %s',
    (chip, word, ok, glyph, slashed, tone) => {
      renderWithPorts(<PreflightChips preflight={{ ...GREEN, [chip]: ok }} {...QUIET} />);
      const box = screen.getByLabelText(`${word}: ${ok ? 'ready' : 'not ready'}`);
      const drawn = within(box).getByTestId('glyph');
      expect(drawn.dataset.name).toBe(glyph);
      expect(drawn.dataset.slashed).toBe(String(slashed));
      expect(drawn.dataset.tone).toBe(tone);
      const style = getComputedStyle(box);
      expect([style.width, style.height, style.borderTopWidth]).toEqual([
        `${layout.chip}px`,
        `${layout.chip}px`,
        `${layout.chipBorder}px`,
      ]);
      // The box carries the same state in its outline.
      expect(style.borderTopColor).toBe(borderOf(ok ? TOKEN.ok : TOKEN.off));
      iconCasesRun += 1;
    },
  );

  it('ran all six chip and state cases (anti-vacuity)', () => {
    expect(ICON_CASES).toHaveLength(6);
    expect(iconCasesRun).toBe(6);
  });

  it('is 44 dp square with a 2 dp outline, the numbers spec §3 and the board give', () => {
    expect(layout.chip).toBe(44);
    expect(layout.chipBorder).toBe(2);
  });

  it('draws no word on a readiness chip: the name is for a screen reader alone', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} {...QUIET} />);
    for (const word of ['Camera', 'Mic', 'Network']) expect(screen.queryByText(word)).toBeNull();
    expect(screen.getAllByTestId('glyph')).toHaveLength(3);
  });

  it('keeps AUTO a word chip, now 44 dp tall', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} auto={true} startsAt={null} />);
    const auto = screen.getByText('Auto').parentElement as HTMLElement;
    expect(getComputedStyle(auto).height).toBe(`${layout.chip}px`);
    // A word, not an icon: no glyph inside it, and three glyphs in the row beside it.
    expect(within(auto).queryByTestId('glyph')).toBeNull();
    expect(screen.getAllByTestId('glyph')).toHaveLength(3);
  });

  // D14 (F18): the start line is under the chip row, not a chip in it, and the fit counts the row as 44 dp.
  it('keeps the AUTO start line under the chip row, not inside it (D14)', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} auto={true} startsAt="14:32" />);
    const row = screen.getByTestId('chip-row');
    const start = screen.getByText('Starts 14:32');
    expect(row.contains(start)).toBe(false);
    expect((row.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
      true,
    );
    expect(within(row).getByText('Auto')).toBeTruthy();
  });
});

/** The chips follow native's verdict: a call takes the mic and gives it back, and the chip follows both ways. */
describe('PreflightChips follow the engine (spec §3, §4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The old pre-flight had a fourth, held; it has no chip (§3), and its blocker text sits by Go live.
  it('names exactly three chips with Go live blocked by a phone not held sideways: Held has none', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.setReady({ held: false }));
    expect(screen.getByTestId('tally-plate').textContent).toBe('Not ready');
    expect(screen.getByText(en['stream.blocker.held'])).toBeTruthy();
    expect(screen.getAllByLabelText(/: (ready|not ready)$/)).toHaveLength(3);
  });

  it('the mic chip goes ready, not ready while the call lasts, then ready again, in name and in outline', async () => {
    const view = await renderViewfinder();
    const mic = (label: string) => screen.getByLabelText(label);
    const outline = (label: string) => getComputedStyle(mic(label)).borderTopColor;
    expect(outline('Mic: ready')).toBe(borderOf(TOKEN.ok));

    act(() => view.engine.setReady({ sound: false }));
    expect(screen.queryByLabelText('Mic: ready')).toBeNull();
    expect(outline('Mic: not ready')).toBe(borderOf(TOKEN.off));
    expect(within(mic('Mic: not ready')).getByTestId('glyph').dataset.tone).toBe('caution');

    act(() => view.engine.setReady({ sound: true }));
    expect(screen.queryByLabelText('Mic: not ready')).toBeNull();
    expect(outline('Mic: ready')).toBe(borderOf(TOKEN.ok));
    expect(within(mic('Mic: ready')).getByTestId('glyph').dataset.tone).toBe('lime');
    // The other two never moved.
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
  });
});

describe('PreflightChips speak (spec §3)', () => {
  it('speaks the operator’s language', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, sound: false }} {...QUIET} />, {
      deviceLanguages: ['fr'],
    });
    expect(screen.getByLabelText('Micro : en attente')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : OK')).toBeTruthy();
  });
});
