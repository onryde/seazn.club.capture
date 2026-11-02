import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import { parseRecordLine, type SessionRecord } from '@/services/sessionRecord';
import { PadPreviewRow } from '@/ui/components/PadPreviewRow';
import { renderWithPorts } from '../../../test/renderWithPorts';

const pick = () => undefined;
const PROBE = en['scoring.preview.dev.foldProbe'];
/** The readout once read: the events, then three times in ms to a hundredth (`foldProbeLine`). */
const READ = /^76 · \d+\.\d\d \/ \d+\.\d\d \/ \d+\.\d\d ms$/;

/** The engine's first load in jsdom transforms some sixty modules: a run waits for it longer than waitFor's 1 s. */
const loaded = { timeout: 10_000 };

const probeLines = (record: SessionRecord) =>
  record
    .lines()
    .map(parseRecordLine)
    .filter((line) => line.event.startsWith('scoring.foldProbe'));

/**
 * R4's Fold probe (plan S2-1 Task 1 Step 6), at the end of the dev twin's preview row: the only screen a dev-twin build
 * opens without a code, a local release build included (`previewScoring`), so the probe runs where R4 needs it, under
 * Hermes in a release build. It folds the real engine here, in jsdom.
 */
describe('the Fold probe on the preview row', { timeout: 30_000 }, () => {
  // Loaded once up front, cold, so each tap's own import finds it in the module cache.
  beforeAll(() => import('@/domain/scoring/engineProbe'), 60_000);

  it('offers the probe and shows nothing until it is tapped', () => {
    renderWithPorts(<PadPreviewRow chosen={[]} onPick={pick} />);
    expect(screen.getByRole('button', { name: PROBE })).toBeTruthy();
    expect(screen.queryByTestId('fold-probe-line')).toBeNull();
  });

  it('folds the match 50 times on a tap, shows the times and records them', async () => {
    const view = renderWithPorts(<PadPreviewRow chosen={[]} onPick={pick} />);
    fireEvent.click(screen.getByRole('button', { name: PROBE }));
    await waitFor(
      () => expect(screen.getByTestId('fold-probe-line').textContent).toMatch(READ),
      loaded,
    );
    expect(probeLines(view.record)).toMatchObject([
      { level: 'info', event: 'scoring.foldProbe', fields: { events: 76, runs: 50 } },
    ]);
  });

  // A second tap while the engine loads is ignored; once it has read, a tap runs it again.
  it('runs once for a double tap, and again for a later tap', async () => {
    const view = renderWithPorts(<PadPreviewRow chosen={[]} onPick={pick} />);
    const probe = screen.getByRole('button', { name: PROBE });
    act(() => {
      fireEvent.click(probe);
      fireEvent.click(probe);
    });
    expect(screen.getByTestId('fold-probe-line').textContent).toBe('…');
    await waitFor(
      () => expect(screen.getByTestId('fold-probe-line').textContent).toMatch(READ),
      loaded,
    );
    expect(probeLines(view.record)).toHaveLength(1);
    fireEvent.click(probe);
    await waitFor(() => expect(probeLines(view.record)).toHaveLength(2), loaded);
  });

  // The runner answers a throw with a warning; a record that refuses that too must not leave the chip on "…" or the
  // probe locked.
  it('shows a failure, not "…", when the record itself throws, and runs again on a later tap', async () => {
    const view = renderWithPorts(<PadPreviewRow chosen={[]} onPick={pick} />);
    const refuse = () => {
      throw new Error('record refused');
    };
    const info = vi.spyOn(view.ports.logger, 'info').mockImplementation(refuse);
    const warn = vi.spyOn(view.ports.logger, 'warn').mockImplementation(refuse);
    const probe = screen.getByRole('button', { name: PROBE });
    fireEvent.click(probe);
    await waitFor(
      () =>
        expect(screen.getByTestId('fold-probe-line').textContent).toBe(
          'failed: Error: record refused',
        ),
      loaded,
    );
    info.mockRestore();
    warn.mockRestore();
    fireEvent.click(probe);
    await waitFor(
      () => expect(screen.getByTestId('fold-probe-line').textContent).toMatch(READ),
      loaded,
    );
  });

  it('names the probe in the operator’s language', () => {
    renderWithPorts(<PadPreviewRow chosen={[]} onPick={pick} />, { deviceLanguages: ['fr'] });
    expect(screen.getByRole('button', { name: fr['scoring.preview.dev.foldProbe'] })).toBeTruthy();
  });
});
