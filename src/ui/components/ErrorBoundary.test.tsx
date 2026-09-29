import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { createFakePorts } from '../../../test/fakePorts';

function Boom(): ReactElement {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  // React reports every caught render error on console.error; keep the run quiet.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the splash when a render error is caught, so the message is visible (R15)', () => {
    const { splash } = createFakePorts();
    render(
      <ErrorBoundary onCatch={splash.hide}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('render failed')).toBeTruthy();
    expect(splash.hides).toBe(1);
  });
});
