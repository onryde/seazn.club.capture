import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { font } from '@/ui/theme/tokens';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { describeBackFromSubScreen } from '../../../test/backFromSubScreen';
import { readRecord } from '../../../test/fakePorts';
import { captureWire } from '../../../test/fixtures/wire';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { renderWithPorts } from '../../../test/renderWithPorts';

const shareButton = () => screen.getByRole('button', { name: 'Share record' });
const faceOf = (text: string) => getComputedStyle(screen.getByText(text)).fontFamily;

describe('Diagnostics (spec §4)', () => {
  it('shows live values and follows the 1 Hz report (D32)', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    act(() => view.engine.scene('live'));
    expect(screen.getByText('2840 kbps')).toBeTruthy();
    expect(screen.getByText('3000 kbps')).toBeTruthy();
    act(() => view.engine.patch({ bitrateKbps: 2950 }));
    expect(screen.getByText('2950 kbps')).toBeTruthy();
    expect(screen.queryByText('2840 kbps')).toBeNull();
  });

  it('names its sections', () => {
    renderWithPorts(<DiagnosticsScreen />);
    for (const title of ['Link', 'Delivery', 'Phone', 'Heartbeat', 'Session record']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('carries the LIVE plate on air, and none off air', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    expect(screen.queryByTestId('tally-plate')).toBeNull();
    act(() => view.engine.scene('holding'));
    expect(screen.getByTestId('tally-plate').textContent).toBe('Trouble');
  });

  // AGENTS §5 and M25: Geist Mono carries the values, never the labels or the record's prose.
  it('sets the values in Geist Mono, and the labels and record lines in Geist', async () => {
    const view = await renderViewfinder();
    view.rerender(<DiagnosticsScreen />);
    act(() => view.engine.scene('live'));
    expect(faceOf('2840 kbps')).toBe(font.numeric);
    // M6: Geist Medium, the `metricUnit` face, named rather than "not mono".
    expect(faceOf('Bitrate')).toBe(font.bodyMedium);
    expect(getComputedStyle(screen.getByText(/intent\.arm/)).fontFamily).toBe(font.bodyMedium);
  });

  it('shows the latest session record lines and shares them, with no secret in them', async () => {
    const view = await renderViewfinder();
    view.rerender(<DiagnosticsScreen />);
    expect(screen.getByText(/intent\.arm/)).toBeTruthy();
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(1));
    const shared = view.share.shared[0] ?? '';
    expect(shared).toContain('intent.arm');
    // M16: the token is the wire's top-level `tok`; every secret is checked.
    const wire = captureWire() as {
      tok: string;
      cred: { srt: { passphrase: string; streamId: string }; rtmps: { streamKey: string } };
    };
    const secrets = [wire.tok, wire.cred.srt.passphrase, wire.cred.srt.streamId];
    for (const secret of [...secrets, wire.cred.rtmps.streamKey]) {
      expect(secret.length).toBeGreaterThan(0);
      expect({ secret, leaked: shared.includes(secret) }).toEqual({ secret, leaked: false });
    }
    // M15: the count is on the scrub's allow-list, so it survives into the record.
    const entry = readRecord(view.record).find((line) => line.event === 'record.shared');
    expect(entry?.fields).toEqual({ count: shared.split('\n').length });
    expect(screen.queryByText("Couldn't open sharing.")).toBeNull();
  });

  it('shows only the latest lines, follows new ones, and shares them all', async () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    act(() => {
      for (let n = 1; n <= 25; n += 1) view.ports.logger.info(`probe.line-${n}`);
    });
    expect(screen.queryByText(/probe\.line-5"/)).toBeNull();
    expect(screen.getByText(/probe\.line-6"/)).toBeTruthy();
    expect(screen.getByText(/probe\.line-25"/)).toBeTruthy();
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(1));
    expect(view.share.shared[0]?.split('\n')).toHaveLength(25);
    expect(view.share.shared[0]).toContain('probe.line-1"');
  });

  it('shares twice when asked twice', async () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    fireEvent.click(shareButton());
    fireEvent.click(shareButton());
    await waitFor(() => expect(view.share.shared).toHaveLength(2));
  });

  it('says when sharing could not open, and records it', async () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    view.share.refuse();
    expect(screen.queryByText("Couldn't open sharing.")).toBeNull();
    fireEvent.click(shareButton());
    expect(await screen.findByText("Couldn't open sharing.")).toBeTruthy();
    expect(readRecord(view.record).map((entry) => entry.event)).toContain('record.share-failed');
    expect(readRecord(view.record).map((entry) => entry.event)).not.toContain('record.shared');
  });

  it('clears the message once a later share opens', async () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    vi.spyOn(view.share, 'share').mockRejectedValueOnce(new Error('share sheet refused'));
    fireEvent.click(shareButton());
    expect(await screen.findByText("Couldn't open sharing.")).toBeTruthy();
    fireEvent.click(shareButton());
    await waitFor(() => expect(screen.queryByText("Couldn't open sharing.")).toBeNull());
    expect(view.share.shared).toHaveLength(1);
  });

  it('plays any fake scene in a development build', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    expect(screen.getByText('Fake engine (development only)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scene: holding' }));
    expect(view.engine.getSnapshot().state.kind).toBe('reconnecting');
    fireEvent.click(screen.getByRole('button', { name: 'Scene: fatal' }));
    expect(view.engine.getSnapshot().state).toMatchObject({ kind: 'ended', reason: 'fatal-error' });
  });

  it('shows no scenes in a release build', () => {
    renderWithPorts(<DiagnosticsScreen />, { devTools: false, devEngine: null });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
    expect(screen.queryByText('Fake engine (development only)')).toBeNull();
  });

  it('shows no scenes with development tools off, whatever engine is wired', () => {
    renderWithPorts(<DiagnosticsScreen />, { devTools: false });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
  });

  it('shows no scenes without the fake engine, even in a development build', () => {
    renderWithPorts(<DiagnosticsScreen />, { devEngine: null });
    expect(screen.queryByRole('button', { name: /^Scene:/ })).toBeNull();
  });

  it('goes back to the camera, by its button and by Back', () => {
    const view = renderWithPorts(<DiagnosticsScreen />);
    view.navigation.go('stream');
    view.navigation.go('streamDiagnostics');
    expect(view.back.press()).toBe(true);
    expect(view.navigation.current()).toBe('stream');
    view.navigation.go('streamDiagnostics');
    fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(view.navigation.current()).toBe('stream');
  });

  it('is reachable from the viewfinder on air', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(view.navigation.current()).toBe('streamDiagnostics');
  });

  it('reads in Dutch', () => {
    renderWithPorts(<DiagnosticsScreen />, { deviceLanguages: ['nl'] });
    expect(screen.getByText('Diagnose')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logboek delen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Terug naar de camera' })).toBeTruthy();
  });
});

describeBackFromSubScreen('Diagnostics', <DiagnosticsScreen />);
