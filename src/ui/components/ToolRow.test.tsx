import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PadTool } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import type { MessageKey } from '@/i18n/messages';
import { ToolRow } from '@/ui/components/ToolRow';
import { colour, layout } from '@/ui/theme/tokens';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const sanction = (side: string, detail: string): PadTool<MessageKey> => ({
  id: `sanction:${side}`,
  label: { key: 'scoring.badminton.tool.sanction' },
  detail,
  kind: 'destructive',
  enabled: true,
});
const setScore: PadTool<MessageKey> = {
  id: 'setScore',
  label: { key: 'scoring.badminton.tool.setScore' },
  detail: null,
  kind: 'standard',
  enabled: true,
};
const tools = [sanction('first', 'A. Sharma'), sanction('second', 'L. Chen'), setScore];
const word = en['scoring.badminton.tool.sanction'];

describe('ToolRow', () => {
  it('names each tool, with a per-side tool’s side as typed', () => {
    renderWithPorts(<ToolRow tools={tools} onTool={vi.fn()} />);
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      `${word}, A. Sharma`,
      `${word}, L. Chen`,
      en['scoring.badminton.tool.setScore'],
    ]);
    expect(screen.getByText('L. Chen')).toBeTruthy();
  });

  it('hands the tapped tool’s id back', () => {
    const onTool = vi.fn();
    renderWithPorts(<ToolRow tools={tools} onTool={onTool} />);
    act(() => fireEvent.click(screen.getByRole('button', { name: `${word}, L. Chen` })));
    expect(onTool).toHaveBeenCalledExactlyOnceWith('sanction:second');
  });

  it('keeps a disabled tool in its place and takes no tap on it', () => {
    const onTool = vi.fn();
    renderWithPorts(<ToolRow tools={[{ ...setScore, enabled: false }]} onTool={onTool} />);
    const button = screen.getByRole('button', { name: en['scoring.badminton.tool.setScore'] });
    act(() => fireEvent.click(button));
    expect(onTool).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('draws a destructive tool in caution, never red, and a standard one in lilac', () => {
    renderWithPorts(<ToolRow tools={tools} onTool={vi.fn()} />);
    const edge = (name: string) =>
      getComputedStyle(screen.getByRole('button', { name })).borderTopColor;
    expect(edge(`${word}, A. Sharma`)).toBe(edgeOf(colour.caution));
    expect(edge(`${word}, A. Sharma`)).not.toBe(edgeOf(colour.live));
    expect(edge(en['scoring.badminton.tool.setScore'])).toBe(edgeOf(colour.ink3));
  });

  it('lets a label take its reserved lines and the side one line', () => {
    renderWithPorts(<ToolRow tools={tools} onTool={vi.fn()} />);
    expect(linesAllowed(screen.getByText(en['scoring.badminton.tool.setScore']))).toBe(
      layout.padToolLines,
    );
    expect(linesAllowed(screen.getByText('A. Sharma'))).toBe(1);
  });

  it('draws nothing when there are no tools: a card is up', () => {
    renderWithPorts(<ToolRow tools={[]} onTool={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
