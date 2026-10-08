import { render, screen } from '@testing-library/react';
import type { PressableProps } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { GhostButton } from '@/ui/components/GhostButton';

// react-native-web ignores `hitSlop` (it draws nothing for it), so jsdom cannot see it in the DOM. The slop is a
// prop of the Pressable, so a stand-in that records the props it is given and renders the real one is what reads it.
const seen = vi.hoisted(() => ({ hitSlop: [] as unknown[] }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Pressable: (props: PressableProps) => {
      seen.hitSlop.push(props.hitSlop);
      return createElement(actual.Pressable, props);
    },
  };
});

const lastSlop = () => seen.hitSlop[seen.hitSlop.length - 1];
const heightOf = () =>
  getComputedStyle(screen.getByRole('button', { name: 'Share record' })).minHeight;

describe('GhostButton (the secondary action)', () => {
  it('is a 48 dp box with no hit slop, as it always was', () => {
    render(<GhostButton label="Share record" onPress={vi.fn()} />);
    expect(heightOf()).toBe('48px');
    expect(seen.hitSlop.length).toBeGreaterThan(0); // the stand-in saw the Pressable (anti-vacuity)
    expect(lastSlop()).toBeUndefined();
  });

  // The owner's Settings board draws Share record 36 dp tall (measured 36.9 with antialiasing). The touch target
  // stays 48: 36 + 6 above + 6 below, so the slop is what a thumb hits beyond the drawn outline.
  it('compact is the board’s 36 dp box with 6 dp of slop above and below: 48 to touch', () => {
    render(<GhostButton label="Share record" onPress={vi.fn()} compact />);
    expect(heightOf()).toBe('36px');
    expect(lastSlop()).toEqual({ top: 6, bottom: 6 });
    expect(36 + 6 + 6).toBe(48);
  });

  it('compact keeps the regular button’s padding and border', () => {
    render(<GhostButton label="Share record" onPress={vi.fn()} compact />);
    const style = getComputedStyle(screen.getByRole('button', { name: 'Share record' }));
    expect([style.paddingLeft, style.paddingRight, style.borderLeftWidth]).toEqual([
      '16px',
      '16px',
      '1px',
    ]);
  });
});
