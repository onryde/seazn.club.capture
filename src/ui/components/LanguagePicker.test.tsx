import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguagePicker } from '@/ui/components/LanguagePicker';
import { renderWithPorts } from '../../../test/renderWithPorts';

describe('LanguagePicker', () => {
  it('shows the current language and switches everything on a pick', () => {
    renderWithPorts(<LanguagePicker />);
    const toggle = screen.getByRole('button', { name: /Language.*English/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(screen.getByRole('button', { name: /Idioma.*Español/ })).toBeTruthy();
  });
});
