import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/ui/components/Button';

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
});
