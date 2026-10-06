import { render, screen } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { describe, expect, it } from 'vitest';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { colour } from '@/ui/theme/tokens';
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
    expect(screen.getByLabelText('Sound: not ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
  });

  // Amendment §2: the code chip went with the go-live deadline; native's
  // verdict names three checks.
  it('shows them in the spec’s order: camera, sound, network, and nothing else', () => {
    const view = renderWithPorts(<PreflightChips preflight={GREEN} {...QUIET} />);
    const labels = [...view.container.querySelectorAll('[aria-label]')].map((chip) =>
      chip.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Camera: ready', 'Sound: ready', 'Network: ready']);
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
    expect(labels).toEqual(['Camera: ready', 'Sound: ready', 'Network: ready']);
  });

  it('says when it starts under the chips, and nothing without a scheduled start', () => {
    const { rerender } = renderWithPorts(
      <PreflightChips preflight={GREEN} auto={false} startsAt="14:32" />,
    );
    expect(screen.getByText('Starts 14:32')).toBeTruthy();
    rerender(<PreflightChips preflight={GREEN} auto={false} startsAt={null} />);
    expect(screen.queryByText(/^Starts/)).toBeNull();
  });

  it('speaks the operator’s language', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, sound: false }} {...QUIET} />, {
      deviceLanguages: ['fr'],
    });
    expect(screen.getByLabelText('Son : en attente')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : OK')).toBeTruthy();
  });
});
