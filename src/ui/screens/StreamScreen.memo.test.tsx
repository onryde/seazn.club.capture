import { act, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderViewfinder } from '../../../test/renderViewfinder';

/** Renders of the memoised HUD parts, counted where each one draws its child. */
const renders = vi.hoisted(() => ({ stage: 0, peek: 0, action: 0, column: 0 }));

vi.mock('@/ui/components/StatusLine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/components/StatusLine')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    StatusLine: (props: ComponentProps<typeof actual.StatusLine>) => {
      renders.column += 1;
      return createElement(actual.StatusLine, props);
    },
  };
});

vi.mock('@/ui/components/OverlayPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/components/OverlayPreview')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    OverlayPreview: (props: ComponentProps<typeof actual.OverlayPreview>) => {
      renders.stage += 1;
      return createElement(actual.OverlayPreview, props);
    },
  };
});
vi.mock('@/ui/components/ViewerPeek', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/components/ViewerPeek')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    ViewerPeek: (props: ComponentProps<typeof actual.ViewerPeek>) => {
      renders.peek += 1;
      return createElement(actual.ViewerPeek, props);
    },
  };
});
vi.mock('@/ui/components/HoldAction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/components/HoldAction')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    HoldAction: (props: ComponentProps<typeof actual.HoldAction>) => {
      renders.action += 1;
      return createElement(actual.HoldAction, props);
    },
  };
});

const resetRenders = () => {
  renders.stage = 0;
  renders.peek = 0;
  renders.action = 0;
  renders.column = 0;
};

/**
 * M7 (AGENTS §8): React.memo on the HUD is load-bearing, so it has to skip.
 * A change the stage, the peek and the action do not show re-renders the
 * column's line and nothing of theirs.
 */
describe('the viewfinder re-renders only what changed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks the hold’s countdown without re-rendering the stage, the peek or Stop', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('holding'));
    const held = view.engine.getSnapshot().state;
    if (held.kind !== 'reconnecting') throw new Error('the holding scene is not a hold');
    const next = held.holdRemainingSeconds - 1;
    resetRenders();
    act(() => view.engine.forceState({ ...held, holdRemainingSeconds: next }));
    expect(
      screen.getByText(`Uplink lost — holding, ${next} s of ${held.holdWindowSeconds}`),
    ).toBeTruthy();
    expect(renders).toMatchObject({ stage: 0, peek: 0, action: 0 });
  });

  it('says Back’s line on air without re-rendering the stage, the peek or Stop', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('live'));
    resetRenders();
    act(() => void view.back.press());
    expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
    expect(renders).toMatchObject({ stage: 0, peek: 0, action: 0 });
  });

  // Nothing the viewfinder projects changed, so the column gets the same view
  // object and skips whole: the projection's memo, not only its parts'.
  it('moves the column to the other side without re-rendering it or the stage', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('holding'));
    resetRenders();
    await act(() => view.ports.streamSettings.set({ side: 'left' }));
    expect(renders).toEqual({ stage: 0, peek: 0, action: 0, column: 0 });
  });

  it('counts at all: a change they show re-renders them', async () => {
    const view = await renderViewfinder();
    resetRenders();
    act(() => view.engine.scene('live'));
    expect(renders.stage).toBeGreaterThan(0);
    expect(renders.peek).toBeGreaterThan(0);
    expect(renders.action).toBeGreaterThan(0);
    expect(renders.column).toBeGreaterThan(0);
  });
});
