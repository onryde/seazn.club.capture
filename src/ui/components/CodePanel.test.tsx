import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import type { UnpairReason } from '@/domain/session/Pairing';
import type { PanelOutcome } from '@/hooks/useHome';
import { CodePanel } from '@/ui/components/CodePanel';
import { renderWithPorts } from '../../../test/renderWithPorts';

const streamCode = {
  mode: 'stream',
  raw: '{}',
  code: 'fx42hmnp7k2q',
  slot: 1,
  token: 'tok-9f3c2a7e5b1d4680ab',
  expiresAt: new Date(),
} as const satisfies ModeCode;
const handlers = () => ({
  onOpen: vi.fn(),
  onScanAgain: vi.fn(),
  onClose: vi.fn(),
  onTryAgain: vi.fn(),
});

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

  it('says Checking code… with no way out: no buttons, and the dim does not close (D27)', () => {
    const h = handlers();
    renderWithPorts(
      <CodePanel outcome={{ kind: 'checking', tapped: 'stream' }} time={null} {...h} />,
    );
    expect(screen.getByText('Checking code…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('offers Try again, and Scan again, only when there was no connection', () => {
    const h = handlers();
    const offline = {
      kind: 'codeError',
      tapped: 'stream',
      error: { kind: 'offline' },
      code: streamCode,
    } as const;
    renderWithPorts(<CodePanel outcome={offline} time={null} {...h} />);
    expect(screen.getByText('No connection')).toBeTruthy();
    expect(screen.getByText("Can't check this code — no connection. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.onTryAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(h.onScanAgain).toHaveBeenCalledTimes(1);
  });

  // Amendment §2: the code answer names no end reason ("the two 410 lines go"),
  // so a code the server no longer knows, or has ended, reads as not valid.
  // The outcome table: 401 and 410 are `invalid` and `ended`, 404 `not-found`, 429 `rate-limited`.
  it.each([
    [{ kind: 'invalid' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [{ kind: 'not-found' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [{ kind: 'ended' }, 'Not valid for streaming', "This code isn't valid for streaming."],
    [{ kind: 'rate-limited', retryAfterS: 12 }, 'Server busy', 'Busy — trying again in 12s'],
  ] as const)('has no Try again for %j, and closes on the dim', (error, title, body) => {
    const h = handlers();
    renderWithPorts(
      <CodePanel
        outcome={{ kind: 'codeError', tapped: 'stream', error, code: streamCode }}
        time={null}
        {...h}
      />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  /** Amendment §2, Unpaired without asking: why, in the operator's words, then Scan again or Close. */
  it.each<[UnpairReason, string, string]>([
    ['code-ended', 'Code ended', 'This code has ended. Scan the new one.'],
    [
      'replaced',
      'Paired on another phone',
      'This code is now paired on another phone. Scan it again to use this one.',
    ],
    ['taken', 'Already live', 'This camera is live on another phone.'],
    [
      'permissions',
      'Camera and microphone needed',
      'Allow the camera and microphone in Android Settings, then try again',
    ],
  ])('says why native unpaired (%s), with Scan again and Close', (reason, title, body) => {
    const h = handlers();
    renderWithPorts(
      <CodePanel outcome={{ kind: 'unpaired', tapped: 'stream', reason }} time={null} {...h} />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect([h.onScanAgain.mock.calls.length, h.onClose.mock.calls.length]).toEqual([1, 1]);
  });
});
