import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { EndingPrompt } from '@/ui/components/EndingPrompt';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('EndingPrompt', () => {
  it('names the disqualified person and offers to record the ending or void the sanction', () => {
    const onRecord = vi.fn();
    const onVoid = vi.fn();
    renderWithPorts(<EndingPrompt person="L. Chen" onRecord={onRecord} onVoid={onVoid} />);
    expect(
      screen.getByText(en['scoring.ending.title'].replace('{person}', 'L. Chen')),
    ).toBeTruthy();
    expect(screen.getByText(en['scoring.ending.body'])).toBeTruthy();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.ending.record'] })));
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onVoid).not.toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.ending.void'] })));
    expect(onVoid).toHaveBeenCalledTimes(1);
  });

  it('offers only its two buttons, modal to a screen reader', () => {
    renderWithPorts(<EndingPrompt person="L. Chen" onRecord={vi.fn()} onVoid={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('ending-prompt').getAttribute('aria-modal')).toBe('true');
  });

  it('takes no tap on the dim: neither answer is given', () => {
    const onRecord = vi.fn();
    const onVoid = vi.fn();
    renderWithPorts(<EndingPrompt person="L. Chen" onRecord={onRecord} onVoid={onVoid} />);
    act(() => fireEvent.click(screen.getByTestId('ending-dim')));
    expect([onRecord.mock.calls.length, onVoid.mock.calls.length]).toEqual([0, 0]);
    expect(screen.getByTestId('ending-dim').getAttribute('aria-hidden')).toBe('true');
  });

  it('says it in Spanish', () => {
    renderWithPorts(<EndingPrompt person="L. Chen" onRecord={vi.fn()} onVoid={vi.fn()} />, {
      deviceLanguages: ['es'],
    });
    expect(screen.getByRole('button', { name: es['scoring.ending.record'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: es['scoring.ending.void'] })).toBeTruthy();
  });
});
