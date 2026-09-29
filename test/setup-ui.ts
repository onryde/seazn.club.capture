import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { disposeFakePorts } from './fakePorts';

// Testing Library only auto-cleans when the runner exposes globals; vitest
// does not by default, so rendered trees would leak between tests.
afterEach(() => {
  cleanup();
});

afterEach(() => {
  disposeFakePorts();
});

// Drawing only: an icon and a looping rotation. Everything testable about the
// tiles and the turn card is their text and their presses.
vi.mock('@/ui/components/ModeIcon', () => ({ ModeIcon: () => null }));
vi.mock('@/ui/components/TurnGlyph', () => ({ TurnGlyph: () => null }));
