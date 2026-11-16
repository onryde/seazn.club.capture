import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { renderViewfinder } from '../../../test/renderViewfinder';
import { savedCourtCode } from '../../../test/fixtures/savedStream';

// Court stream (spec 2026-11-14 §6.2): the waiting screen on a court code. Copy is read from the dictionaries, the time
// from the made-up fixture: the `court-waiting` scene's next match starts at 2026-11-14 14:00Z, and Europe/London, the
// venue's and the phone's zone, is GMT in November, so it reads 14:00 with no zone named.
const NEXT_AT = 'Next: Example Town v Sample CC · 14:00';
// French sets a no-break space before a colon (the dictionaries' own rule), and `textContent` does not normalise it.
const NBSP = String.fromCodePoint(0x00a0);
const message = () => screen.getByTestId('strip-message').textContent;
const roundLine = () => screen.getByTestId('stage-line').textContent;

/** A court phone with nothing to warn about, waiting on the `court-waiting` scene. */
async function waiting(quiet = true) {
  const view = await renderViewfinder({}, { saved: savedCourtCode(), quiet });
  act(() => view.engine.scene('court-waiting'));
  return view;
}

describe('the court code’s waiting screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names the court on the round line, and the next streamed match with its start on the message line', async () => {
    await waiting();
    expect(roundLine()).toBe('Court 2');
    expect(message()).toBe(NEXT_AT);
    expect(en['stream.status.courtNextAt']).toBe('Next: {label} · {time}');
  });

  it('draws no match label while the court waits, and draws it once the broadcast goes live', async () => {
    const view = await waiting();
    expect(screen.queryByTestId('match-label')).toBeNull();
    act(() => view.engine.scene('live'));
    expect(screen.getByTestId('match-label')).toBeTruthy();
    // The round line still names the court on air.
    expect(roundLine()).toBe('Court 2');
  });

  // Four questions (2): an empty input, each in turn.
  it('says no streamed match yet with no next match', async () => {
    const view = await waiting();
    act(() => view.engine.setPairing({ next: null }));
    expect(message()).toBe(en['stream.status.courtNone']);
  });

  it('says the match with no start time when it has none', async () => {
    const view = await waiting();
    act(() =>
      view.engine.setPairing({ next: { label: 'Example Town v Sample CC', scheduledStart: null } }),
    );
    expect(message()).toBe('Next: Example Town v Sample CC');
  });

  it('says Automatic off when the phone’s automatic mode is off, and the Next line again when it is on', async () => {
    const view = await waiting();
    act(() => view.engine.send({ kind: 'setAutomatic', on: false }));
    expect(message()).toBe(en['stream.status.courtAutomaticOff']);
    act(() => view.engine.send({ kind: 'setAutomatic', on: true }));
    expect(message()).toBe(NEXT_AT);
  });

  it('says there is no destination before the Next line', async () => {
    const view = await waiting();
    act(() => view.engine.setPairing({ destinationName: null }));
    expect(message()).toBe(en['stream.status.waitingDestination']);
  });

  it('cuts a long next label at 24 characters so the start time stays on the line', async () => {
    const view = await waiting();
    act(() =>
      view.engine.setPairing({
        next: {
          label: 'Example Town v Sample Cricket Club',
          scheduledStart: new Date('2026-11-14T14:00:00Z'),
        },
      }),
    );
    expect(message()).toBe('Next: Example Town v Sample C… · 14:00');
  });

  // Review Focus 5, after an interruption: a match that ended normally gives way to the Next line all afternoon.
  it('shows the Next line, not "Match finished", after the organiser stopped the match', async () => {
    const view = await renderViewfinder({}, { saved: savedCourtCode(), quiet: true });
    act(() => view.engine.scene('paired-after-organiser-stop'));
    act(() =>
      view.engine.setPairing({
        next: {
          label: 'Example Town v Sample CC',
          scheduledStart: new Date('2026-11-14T14:00:00Z'),
        },
      }),
    );
    expect(view.engine.getSnapshot().lastEnd).toBe('stopped-by-organiser');
    expect(message()).toBe(NEXT_AT);
    expect(screen.queryByText(en['stream.status.stoppedOrganiser'])).toBeNull();
  });

  // Four questions (3): the beat's next match changes while the phone waits, and the line follows.
  it('follows a changed next match', async () => {
    const view = await waiting();
    act(() =>
      view.engine.setPairing({
        next: { label: 'C v D', scheduledStart: new Date('2026-11-14T15:30:00Z') },
      }),
    );
    expect(message()).toBe('Next: C v D · 15:30');
  });

  it('shows no court on a fixture code: its label and its waiting line are unchanged', async () => {
    await renderViewfinder({}, { quiet: true });
    expect(screen.getByTestId('match-label')).toBeTruthy();
    expect(screen.queryByTestId('stage-line')).toBeNull();
    expect(message()).toBe('Waiting for Go live · YouTube · Fake CC');
  });

  // Four questions (4): another language.
  it('reads in Spanish, French and Dutch', async () => {
    for (const [language, line] of [
      ['es', 'Siguiente: Example Town v Sample CC · 14:00'],
      ['fr', `Suivant${NBSP}: Example Town v Sample CC · 14:00`],
      ['nl', 'Volgende: Example Town v Sample CC · 14:00'],
    ] as const) {
      const view = await renderViewfinder(
        { deviceLanguages: [language] },
        { saved: savedCourtCode(), quiet: true },
      );
      act(() => view.engine.scene('court-waiting'));
      expect(message()).toBe(line);
      view.unmount();
    }
  });
});

describe('a court phone on air', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names the next match on the live line, and says Live with none', async () => {
    const view = await renderViewfinder({}, { saved: savedCourtCode(), quiet: true });
    act(() => view.engine.scene('live'));
    expect(message()).toBe(en['stream.status.live']);
    act(() => view.engine.setPairing({ next: { label: 'C v D', scheduledStart: null } }));
    expect(message()).toBe('Next: C v D');
  });

  it('gives the line to a caption: Not charging beats the Next line, which is routine', async () => {
    const view = await renderViewfinder({}, { saved: savedCourtCode() });
    act(() => view.engine.scene('live'));
    act(() => view.engine.setPairing({ next: { label: 'C v D', scheduledStart: null } }));
    expect(message()).toBe(en['stream.advisory.notCharging']);
    expect(screen.queryByText('Next: C v D')).toBeNull();
  });

  it('keeps an urgent line over the Next line', async () => {
    const view = await renderViewfinder({}, { saved: savedCourtCode() });
    act(() => view.engine.setPairing({ next: { label: 'C v D', scheduledStart: null } }));
    act(() => view.engine.scene('fell-back'));
    expect(message()).toBe(en['stream.status.fellBack']);
  });
});
