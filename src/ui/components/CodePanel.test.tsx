import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModeCode } from '@/domain/mode/Mode';
import type { PanelOutcome, PanelUnpairReason } from '@/hooks/useHome';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { CodePanel } from '@/ui/components/CodePanel';
import { colour } from '@/ui/theme/tokens';
import { fillOf, heldOnGround } from '../../../test/pressState';
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
  onConfirmUnpair: vi.fn(),
  onCancelUnpair: vi.fn(),
  onDismiss: vi.fn(),
  onConfirmDismiss: vi.fn(),
  onCloseNotOpen: vi.fn(),
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
  it.each<[PanelUnpairReason, string, string]>([
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

  // A scoring link is not a stream code: the scan panel for one says "link" (the Batch D review), in every language, while
  // the stream's keep their own words.
  describe('a scoring link’s scan says link, not code', () => {
    const DICTIONARIES = { en, es, fr, nl } as const;
    const scoringCode = {
      mode: 'scoring',
      raw: 'https://stg.seazn.club/score/dl_madeUpTokenForPanelTests01',
      token: 'dl_madeUpTokenForPanelTests01',
    } as const satisfies ModeCode;

    it.each(['en', 'es', 'fr', 'nl'] as const)('says it is checking the link, in %s', (lang) => {
      const h = handlers();
      renderWithPorts(
        <CodePanel outcome={{ kind: 'checking', tapped: 'scoring' }} time={null} {...h} />,
        { deviceLanguages: [lang] },
      );
      expect(screen.getByText(DICTIONARIES[lang]['home.scoring.checking.title'])).toBeTruthy();
      expect(screen.queryByText(DICTIONARIES[lang]['panel.checking.title'])).toBeNull();
      expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
    });

    it.each(['en', 'es', 'fr', 'nl'] as const)(
      'says it cannot check the link with no connection, and offers Try again, in %s',
      (lang) => {
        const h = handlers();
        renderWithPorts(
          <CodePanel
            outcome={{
              kind: 'codeError',
              tapped: 'scoring',
              error: { kind: 'offline' },
              code: scoringCode,
            }}
            time={null}
            {...h}
          />,
          { deviceLanguages: [lang] },
        );
        const words = DICTIONARIES[lang];
        expect(screen.getByText(words['panel.descriptor.offline.title'])).toBeTruthy();
        // Testing Library collapses the no-break space French sets before a colon: so does the expectation.
        const said = (key: 'home.scoring.offline.body' | 'panel.descriptor.offline.body') =>
          words[key].replace(/\s+/g, ' ');
        expect(screen.getByText(said('home.scoring.offline.body'))).toBeTruthy();
        expect(screen.queryByText(said('panel.descriptor.offline.body'))).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: words['panel.tryAgain'] }));
        expect(h.onTryAgain).toHaveBeenCalledTimes(1);
      },
    );

    it('leaves the stream’s words as they were, and the words of an answer that names no code', () => {
      const h = handlers();
      renderWithPorts(
        <CodePanel
          outcome={{
            kind: 'codeError',
            tapped: 'scoring',
            error: { kind: 'rate-limited', retryAfterS: 12 },
            code: scoringCode,
          }}
          time={null}
          {...h}
        />,
      );
      expect(screen.getByText('Server busy')).toBeTruthy();
      expect(screen.getByText('Busy — trying again in 12s')).toBeTruthy();
    });
  });

  describe('the dismiss question (owner ruling B, 2026-11-02)', () => {
    const asking = (unsent: number | null, label = 'Match 7') =>
      ({ kind: 'dismissConfirm', tapped: 'scoring', fixtureId: 'fx-7', label, unsent }) as const;

    it('names the match and the taps, and answers Keep with Close and Dismiss with the match it names', () => {
      const h = handlers();
      renderWithPorts(<CodePanel outcome={asking(3)} time={null} {...h} />);
      expect(screen.getByText('Dismiss Match 7?')).toBeTruthy();
      expect(
        screen.getByText('3 taps that were not sent will be deleted. They will not reach Seazn.'),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect([h.onClose.mock.calls.length, h.onConfirmDismiss.mock.calls.length]).toEqual([1, 0]);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(h.onConfirmDismiss.mock.calls).toEqual([['fx-7']]);
      expect(h.onDismiss).not.toHaveBeenCalled();
    });

    it('has the two answers and no others: no Scan again, no Try again, and the dim means Keep', () => {
      const h = handlers();
      renderWithPorts(<CodePanel outcome={asking(1)} time={null} {...h} />);
      expect(screen.queryByRole('button', { name: 'Scan again' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
        '',
        'Keep',
        'Dismiss',
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(h.onClose).toHaveBeenCalledTimes(1);
    });

    it('says "another match" for a queue with no name, and cannot count one it cannot read', () => {
      renderWithPorts(<CodePanel outcome={asking(null, '')} time={null} {...handlers()} />);
      expect(screen.getByText('Dismiss another match?')).toBeTruthy();
      expect(
        screen.getByText(
          "Taps that were not sent can't be read, and will be deleted. They will not reach Seazn.",
        ),
      ).toBeTruthy();
    });
  });

  // The controller's press-fill ruling (2026-10-13): a held ghost's fill must not depend on the ground. The sheet is
  // surface2, pinned here: the old surface2 press fill was the sheet's own colour, so a held Scan again showed only its
  // hairline.
  it('a held Scan again takes the press fill, the cream at 20%, on the sheet’s surface2 ground', () => {
    renderWithPorts(
      <CodePanel outcome={{ kind: 'foreign', tapped: 'stream' }} time="18:40" {...handlers()} />,
    );
    const scanAgain = () => screen.getByRole('button', { name: 'Scan again' });
    const sheet = () => scanAgain().parentElement as HTMLElement;
    const { ground, held, released } = heldOnGround(scanAgain, sheet);
    expect(ground).toBe(fillOf(colour.surface2));
    expect(held).toBe(fillOf(colour.pressFill));
    expect(held).not.toBe(ground);
    expect(released).not.toBe(held);
  });
});
