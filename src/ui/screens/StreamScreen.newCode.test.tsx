import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleWaiting } from '@/services/fakeCodePort';
import { codeUrl } from '@/services/fetchCodePort';
import { StreamScreen } from '@/ui/screens/StreamScreen';
import type { FakePorts } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { captureRaw } from '../../../test/fixtures/wire';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { wrapperFor } from '../../../test/renderWithPorts';

const CODE_B = 'fy43hmnp7k2r';
const LABEL_A = 'Seazn XI v Fake CC';
const LABEL_B = 'Example Town v Sample CC';

/** A second, valid code for another match: its own code and label. Made-up values. */
const codeB = (): SavedCode =>
  savedStreamCode({
    raw: captureRaw({ code: CODE_B }),
    stream: {
      waiting: sampleWaiting({ code: CODE_B, label: LABEL_B }),
      codeUrl: codeUrl('https://stg.seazn.club', CODE_B),
      tapToPair: false,
    },
  });

const kinds = (fakes: FakePorts) => fakes.engine.intents.map((intent) => intent.kind);
const plate = () => screen.getByTestId('tally-plate').textContent;
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));
/** The status strip's match label (spec §2) is one accessible name: the label as the organiser typed it. */
const labelled = (label: string) => screen.queryByLabelText(label)?.getAttribute('data-testid');

/**
 * A newly scanned code's viewfinder reads native's pairing for it (amendment
 * §2): its label is the pairing's, never the last code's. Home pairs; the
 * second scan is Task 24's.
 */
describe('a newly paired code’s viewfinder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows its own match label, read from the pairing', async () => {
    const saved = codeB();
    await renderViewfinder(
      {},
      { saved, prepare: (fakes) => fakes.engine.setPairing({ label: LABEL_B }) },
    );
    expect(labelled(LABEL_B)).toBe('match-label');
    expect(labelled(LABEL_A)).toBeUndefined();
    expect(plate()).toBe('Ready');
  });

  // A second visit to the same code: the pairing is adopted as it is, and nothing is sent.
  it('adopts its own pairing when the same code is opened again', async () => {
    const view = await renderViewfinder();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    await settle();
    expect(view.navigation.current()).toBe('home');
    cleanup();
    render(<StreamScreen />, { wrapper: wrapperFor(view) });
    view.navigation.go('stream');
    await settle();
    expect(kinds(view)).toEqual(['pair']);
    expect(plate()).toBe('Ready');
    expect(labelled(LABEL_A)).toBe('match-label');
  });
});
