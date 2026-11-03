import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { RefusalBanner } from '@/ui/components/RefusalBanner';
import { colour } from '@/ui/theme/tokens';
import { fillOf } from '../../../test/pressState';

describe('RefusalBanner', () => {
  it('is an alert a screen reader says at once, in caution orange, never red', () => {
    render(<RefusalBanner text={en['scoring.refusal.notNow']} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toBe(en['scoring.refusal.notNow']);
    expect(banner.getAttribute('aria-live')).toBe('assertive');
    // The colour as jsdom resolves the token; caution is not live (red means ON AIR, AGENTS §5).
    const ink = getComputedStyle(screen.getByText(en['scoring.refusal.notNow'])).color;
    expect(fillOf(colour.caution)).toBe(ink);
    expect(fillOf(colour.live)).not.toBe(ink);
  });
});
