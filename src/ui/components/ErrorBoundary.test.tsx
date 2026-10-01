import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Text as RNText } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReopenGate } from '@/hooks/useReopenGate';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { createFakePorts } from '../../../test/fakePorts';
import { wrapperFor } from '../../../test/renderWithPorts';

function Boom(): ReactElement {
  throw new Error('render failed');
}

function Gate(): null {
  useReopenGate(true);
  return null;
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

  it('shows the given fallback instead of the full-screen message', () => {
    const onCatch = vi.fn();
    const view = render(
      <ErrorBoundary fallback={null} onCatch={onCatch}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Something broke')).toBeNull();
    expect(screen.queryByText('render failed')).toBeNull();
    expect(view.container.textContent).toBe('');
    expect(onCatch).toHaveBeenCalledTimes(1);
  });

  it('still shows its children when nothing threw, fallback or not', () => {
    render(
      <ErrorBoundary fallback={null}>
        <RNText>fine</RNText>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });

  // M4 (final review): the root's way back after a crash.
  describe('Try again', () => {
    const crash = { on: true };
    function Flaky(): ReactElement {
      if (crash.on) throw new Error('render failed');
      return <RNText>fine</RNText>;
    }

    it('shows its note and Try again, and remounts the children on a press', () => {
      crash.on = true;
      const onCatch = vi.fn();
      render(
        <ErrorBoundary
          note="The broadcast may still be live."
          retryLabel="Try again"
          onCatch={onCatch}
        >
          <Flaky />
        </ErrorBoundary>,
      );
      expect(screen.getByText('The broadcast may still be live.')).toBeTruthy();
      crash.on = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('fine')).toBeTruthy();
      expect(screen.queryByText('The broadcast may still be live.')).toBeNull();
      expect(onCatch).toHaveBeenCalledTimes(1);
    });

    // A second call: the children crash again after Try again.
    it('catches again, and offers Try again again, when the children crash again', () => {
      crash.on = true;
      const onCatch = vi.fn();
      render(
        <ErrorBoundary retryLabel="Try again" onCatch={onCatch}>
          <Flaky />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('render failed')).toBeTruthy();
      expect(onCatch).toHaveBeenCalledTimes(2);
      crash.on = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('fine')).toBeTruthy();
    });

    it('is not offered unless asked for', () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(screen.getByText('render failed')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  it('hides the splash when the reopen gate throws while deciding (R15)', async () => {
    const fakes = createFakePorts({
      navigation: {
        current: () => 'home',
        go: () => {
          throw new Error('navigator not mounted');
        },
        restart: () => undefined,
      },
    });
    render(
      <ErrorBoundary onCatch={fakes.splash.hide}>
        <Gate />
      </ErrorBoundary>,
      { wrapper: wrapperFor(fakes) },
    );
    await screen.findByText('navigator not mounted');
    expect(fakes.splash.hides).toBe(1);
  });
});
