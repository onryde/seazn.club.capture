import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/ui/components/Button';
import { colour } from '@/ui/theme/tokens';
import { pressIn, pressOut } from '../../../test/press';
import { fillOf, layoutOf, paintOf, pressTwice, unmountWhileHeld } from '../../../test/pressState';

const plate = () => screen.getByRole('button', { name: 'Continue' });

describe('Button', () => {
  it('calls onPress when pressed', () => {
    const onPress = vi.fn();
    render(<Button label="Continue" onPress={onPress} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = vi.fn();
    render(<Button label="Continue" onPress={onPress} disabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onPress).not.toHaveBeenCalled();
  });

  // The controller's ruling (Batch 17; the owner has not ruled): a pressed plate would step to a darker lime, which the
  // palette does not have and a component may not invent. Until it does, the plate dims to 0.7 (it was 0.85, which the
  // owner could not see on an icon button) and stays lime; its box never moves. Colour on a phone is a device check.
  describe('pressed', () => {
    it('dims to 0.7 while held, its plate still lime, and comes back on release', () => {
      render(<Button label="Continue" onPress={vi.fn()} />);
      const resting = paintOf(plate());
      expect(resting.fill).toBe(fillOf(colour.lime));
      pressIn(plate());
      expect(paintOf(plate())).toEqual({ ...resting, opacity: '0.7' });
      expect(resting.opacity).not.toBe('0.7'); // anti-vacuity: the press changed something
      pressOut(plate());
      expect(paintOf(plate())).toEqual(resting);
    });

    it('a press never moves the box', () => {
      render(<Button label="Continue" onPress={vi.fn()} />);
      const resting = layoutOf(plate());
      expect([resting['min-height'], resting['min-width']]).toEqual(['56px', '200px']); // the box is read
      pressIn(plate());
      expect(layoutOf(plate())).toEqual(resting);
      expect(getComputedStyle(plate()).opacity).toBe('0.7'); // and the press did change something
      pressOut(plate());
    });

    it('disabled, it never shows pressed: no dim, and the plate stays the inert surface', () => {
      render(<Button label="Continue" onPress={vi.fn()} disabled />);
      const resting = paintOf(plate());
      expect(resting.fill).toBe(fillOf(colour.surface));
      pressIn(plate());
      expect(paintOf(plate())).toEqual(resting);
      pressOut(plate());
    });

    it('a second press, and a press while held, find nothing stuck', () => {
      render(<Button label="Continue" onPress={vi.fn()} />);
      const resting = getComputedStyle(plate()).opacity;
      expect(pressTwice(plate, () => getComputedStyle(plate()).opacity)).toEqual([
        resting,
        '0.7',
        resting,
        '0.7',
        resting,
      ]);
    });

    it('held and unmounted: no timer is left and nothing fires', () => {
      const onPress = vi.fn();
      const view = render(<Button label="Continue" onPress={onPress} />);
      expect(unmountWhileHeld(plate, view.unmount)).toEqual({ held: 1, left: 0 });
      expect(onPress).not.toHaveBeenCalled();
    });
  });
});
