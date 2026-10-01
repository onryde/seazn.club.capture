import { render, screen } from '@testing-library/react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { describe, expect, it } from 'vitest';
import { PreflightChips } from '@/ui/components/PreflightChips';
import { colour } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

const GREEN = { code: true, camera: true, network: true, sound: true };

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
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, sound: false }} goLiveBy="14:10" />);
    expect(screen.getByLabelText('Camera: ready')).toBeTruthy();
    expect(screen.getByLabelText('Sound: not ready')).toBeTruthy();
    expect(screen.getByLabelText('Network: ready')).toBeTruthy();
    expect(screen.getByLabelText('Code: ready')).toBeTruthy();
    expect(screen.getByText('Go live by 14:10')).toBeTruthy();
  });

  it('shows them in the spec’s order: camera, sound, network, code', () => {
    const view = renderWithPorts(<PreflightChips preflight={GREEN} goLiveBy={null} />);
    const labels = [...view.container.querySelectorAll('[aria-label]')].map((chip) =>
      chip.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Camera: ready', 'Sound: ready', 'Network: ready', 'Code: ready']);
  });

  it('borders a ready chip lime and a chip that is not ready orange', () => {
    renderWithPorts(<PreflightChips preflight={{ ...GREEN, network: false }} goLiveBy={null} />);
    const border = (label: string) => getComputedStyle(screen.getByLabelText(label)).borderTopColor;
    expect(border('Camera: ready')).toBe(borderOf(TOKEN.ok));
    expect(border('Network: not ready')).toBe(borderOf(TOKEN.off));
  });

  it('says nothing about a deadline it does not have', () => {
    renderWithPorts(<PreflightChips preflight={GREEN} goLiveBy={null} />);
    expect(screen.queryByText(/Go live by/)).toBeNull();
  });

  it('speaks the operator’s language', () => {
    renderWithPorts(
      <PreflightChips preflight={{ ...GREEN, code: false }} goLiveBy="14:10 CEST" />,
      { deviceLanguages: ['fr'] },
    );
    expect(screen.getByLabelText('Code : pas prêt')).toBeTruthy();
    expect(screen.getByLabelText('Caméra : prêt')).toBeTruthy();
    expect(screen.getByText('Direct avant 14:10 CEST')).toBeTruthy();
  });
});
