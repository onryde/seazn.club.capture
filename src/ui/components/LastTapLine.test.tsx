import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import nl from '@/i18n/nl.json';
import { LastTapLine } from '@/ui/components/LastTapLine';
import { layout } from '@/ui/theme/tokens';
import { renderWithPorts } from '../../../test/renderWithPorts';

const rally = { key: 'scoring.badminton.last.rally', vars: { side: 'L. Chen' } } as const;
const sentence = en['scoring.badminton.last.rally'].replace('{side}', 'L. Chen');
const undo = () => screen.getByRole('button', { name: en['scoring.pad.undo'] });

describe('LastTapLine', () => {
  it('says what the last tap did, and offers Undo on it', () => {
    const onUndo = vi.fn();
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={null} onUndo={onUndo} />,
    );
    expect(screen.getByText(sentence)).toBeTruthy();
    act(() => fireEvent.click(undo()));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('keeps Undo in its place, disabled, when it is not offered', () => {
    const onUndo = vi.fn();
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: false }} refusal={null} onUndo={onUndo} />,
    );
    act(() => fireEvent.click(undo()));
    expect(onUndo).not.toHaveBeenCalled();
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  // Owner, 2026-11-03: Undo closes 45 s after a match is decided; the line then has no Undo, and its sentence has the room.
  it('has no Undo at all when its window is closed, and still says what the last tap did', () => {
    renderWithPorts(
      <LastTapLine
        lastTap={{ text: rally, undo: false }}
        refusal={null}
        undoCell={false}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe(sentence);
  });

  it('keeps the cell when it is told nothing: Undo is in its place unless the window closed it', () => {
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={null} onUndo={vi.fn()} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('has no sentence before the first tap, and Undo in its place, disabled', () => {
    renderWithPorts(<LastTapLine lastTap={null} refusal={null} onUndo={vi.fn()} />);
    expect(screen.getByTestId('last-tap').textContent).toBe(en['scoring.pad.undo']);
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('says a refusal in the sentence’s place, as an alert', () => {
    const refusal = en['scoring.refusal.invalidScore'];
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={refusal} onUndo={vi.fn()} />,
    );
    expect(screen.getByRole('alert').textContent).toBe(refusal);
    expect(screen.queryByText(sentence)).toBeNull();
    expect(undo().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('says a note under the sentence, which stays, in one line', () => {
    const note = en['scoring.pad.countedOnce'];
    renderWithPorts(
      <LastTapLine
        lastTap={{ text: rally, undo: true }}
        refusal={null}
        note={note}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByTestId('last-tap-sentence').textContent).toBe(sentence);
    expect(screen.getByTestId('last-tap-note').textContent).toBe(note);
    expect(screen.queryByRole('alert')).toBeNull();
    // react-native-web sets one line as nowrap with an ellipsis, not a clamp (Text/index.js:113-115).
    expect(getComputedStyle(screen.getByTestId('last-tap-note')).whiteSpace).toBe('nowrap');
  });

  it('gives the sentence one line fewer with a note, so the two keep to the line’s room', () => {
    const { rerender } = renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={null} onUndo={vi.fn()} />,
    );
    const clamp = () => getComputedStyle(screen.getByTestId('last-tap-sentence')).webkitLineClamp;
    expect(clamp()).toBe(String(layout.padLineLines));
    rerender(
      <LastTapLine
        lastTap={{ text: rally, undo: true }}
        refusal={null}
        note={en['scoring.pad.countedOnce']}
        onUndo={vi.fn()}
      />,
    );
    expect(clamp()).toBe(String(layout.padLineLines - 1));
  });

  it('has no note line without a note', () => {
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={null} onUndo={vi.fn()} />,
    );
    expect(screen.queryByTestId('last-tap-note')).toBeNull();
  });

  it('says it in Dutch', () => {
    renderWithPorts(
      <LastTapLine lastTap={{ text: rally, undo: true }} refusal={null} onUndo={vi.fn()} />,
      {
        deviceLanguages: ['nl'],
      },
    );
    expect(
      screen.getByText(nl['scoring.badminton.last.rally'].replace('{side}', 'L. Chen')),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: nl['scoring.pad.undo'] })).toBeTruthy();
  });
});
