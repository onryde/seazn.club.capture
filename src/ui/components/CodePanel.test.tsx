import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import { CodePanel, type PanelOutcome } from '@/ui/components/CodePanel';
import { renderWithPorts } from '../../../test/renderWithPorts';

const streamCode: ModeCode = { mode: 'stream', raw: '{}', slot: 0, expiresAt: new Date() };
const handlers = () => ({ onOpen: vi.fn(), onScanAgain: vi.fn(), onClose: vi.fn() });

describe('CodePanel', () => {
  it.each<[PanelOutcome, string, string | null]>([
    [
      { kind: 'comingSoon', tapped: 'stream', mode: 'scoring' },
      'This is a Remote Scoring code',
      'Remote Scoring is coming soon.',
    ],
    [
      { kind: 'expired', tapped: 'stream', mode: 'stream', at: new Date() },
      'This code has expired',
      'This code expired at 18:40. Ask the desk for a new one.',
    ],
    [
      { kind: 'newerVersion', tapped: 'stream' },
      'Update the app',
      'This code needs a newer version of the app.',
    ],
    [
      { kind: 'seaznPage', tapped: 'stream' },
      "That's a page, not a code",
      'This is a Seazn page, not a code. Scan the code on the page.',
    ],
    [{ kind: 'foreign', tapped: 'stream' }, 'Not a Seazn code', "This isn't a Seazn code."],
  ])('explains %j in plain words, with Scan again and nowhere to open', (outcome, title, body) => {
    const h = handlers();
    renderWithPorts(<CodePanel outcome={outcome} time="18:40" {...h} />);
    expect(screen.getByText('You opened Live Stream')).toBeTruthy();
    expect(screen.getByText(title)).toBeTruthy();
    if (body !== null) expect(screen.getByText(body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(h.onScanAgain).toHaveBeenCalledTimes(1);
  });

  it('offers to open a built mode scanned from another tile', () => {
    const h = handlers();
    renderWithPorts(
      <CodePanel
        outcome={{ kind: 'otherMode', tapped: 'scoring', code: streamCode }}
        time={null}
        {...h}
      />,
    );
    expect(screen.getByText('This is a Live Stream code')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Live Stream' }));
    expect(h.onOpen).toHaveBeenCalledWith(streamCode);
  });

  it('has no open button when there is nowhere to go', () => {
    renderWithPorts(
      <CodePanel outcome={{ kind: 'foreign', tapped: 'stream' }} time={null} {...handlers()} />,
    );
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
  });

  it('holds screen-reader focus in the sheet while it is up', () => {
    const { container } = renderWithPorts(
      <CodePanel outcome={{ kind: 'foreign', tapped: 'stream' }} time={null} {...handlers()} />,
    );
    const sheet = container.querySelector('[aria-modal="true"]');
    expect(sheet).not.toBeNull();
    // Native VoiceOver reads accessibilityViewIsModal, not aria-modal.
    expect(sheet?.getAttribute('data-view-is-modal')).toBe('true');
    expect(sheet?.textContent).toContain('Not a Seazn code');
    expect(sheet?.contains(screen.getByRole('button', { name: 'Close' }))).toBe(false);
  });

  it('closes when the dimmed background is tapped', () => {
    const h = handlers();
    renderWithPorts(
      <CodePanel outcome={{ kind: 'foreign', tapped: 'stream' }} time={null} {...h} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});
