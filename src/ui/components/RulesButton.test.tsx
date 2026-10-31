import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { RulesButton } from '@/ui/components/RulesButton';
import { colour, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { linesAllowed } from '../../../test/linesAllowed';
import { edgeOf, fillOf } from '../../../test/pressState';
import { pressIn } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Owner ruling 15 (2026-10-31): "a 'Rules' button in the top bar beside the sync status".
describe('RulesButton', () => {
  it('is a button named by its word, which a tap presses', () => {
    const onPress = vi.fn();
    renderWithPorts(<RulesButton label={en['scoring.rules.open']} onPress={onPress} />);
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.rules.open'] })));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is at least a touch target in both directions, outlined, its word one line in the tools’ condensed type', () => {
    renderWithPorts(<RulesButton label={en['scoring.rules.open']} onPress={vi.fn()} />);
    const button = screen.getByRole('button');
    const style = getComputedStyle(button);
    expect([style.minHeight, style.minWidth]).toEqual([`${layout.touch}px`, `${layout.touch}px`]);
    // `space.xs` a side: the room padFit.test.ts gives it beside the sync words at 320 dp.
    expect([style.paddingLeft, style.paddingRight]).toEqual([`${space.xs}px`, `${space.xs}px`]);
    expect(style.borderTopColor).toBe(edgeOf(colour.ink3));
    const word = screen.getByText(en['scoring.rules.open']);
    expect(getComputedStyle(word).fontFamily).toBe(typeScale.actionSecondary.fontFamily);
    expect(linesAllowed(word)).toBe(1);
  });

  it('takes the press fill and a cream edge while held, as the other outlined buttons', () => {
    renderWithPorts(<RulesButton label={en['scoring.rules.open']} onPress={vi.fn()} />);
    const button = screen.getByRole('button');
    pressIn(button);
    expect(getComputedStyle(button).backgroundColor).toBe(fillOf(colour.pressFill));
    expect(getComputedStyle(button).borderTopColor).toBe(edgeOf(colour.ink));
  });
});
