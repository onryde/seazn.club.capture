import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from '@/ui/components/Text';
import { maxFontScale, typeScale, type TypeRole } from '@/ui/theme/type';

// RNW drops `maxFontSizeMultiplier` (it is a native prop), so the props handed to React Native's Text are collected by a
// wrapper, as SyncBadge's tests do for Pressable. Whether a phone's font scale really stops at the cap is the device's.
const handed: Record<string, unknown>[] = [];
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Text: (props: ComponentProps<typeof actual.Text>) => {
      handed.push(props as Record<string, unknown>);
      return createElement(actual.Text, props);
    },
  };
});

beforeEach(() => {
  handed.length = 0;
});

describe('Text: the font scale a role stops at', () => {
  it('hands the tally and the badge’s count their cap, so a large font setting cannot push the header row out', () => {
    render(<Text variant="tally">1:0</Text>);
    render(<Text variant="syncCount">12</Text>);
    expect(handed.map((props) => props.maxFontSizeMultiplier)).toEqual([1.15, 1]);
  });

  it('hands every other role none: they follow the phone’s scale', () => {
    const others = (Object.keys(typeScale) as TypeRole[]).filter((role) => !(role in maxFontScale));
    expect(others.length).toBeGreaterThan(10);
    others.forEach((role) => render(<Text variant={role}>x</Text>));
    expect(handed).toHaveLength(others.length);
    handed.forEach((props) =>
      expect(props).not.toHaveProperty('maxFontSizeMultiplier', expect.anything()),
    );
  });

  it('lets a caller’s own cap win over the role’s', () => {
    render(
      <Text variant="tally" maxFontSizeMultiplier={1}>
        1:0
      </Text>,
    );
    expect(handed[0].maxFontSizeMultiplier).toBe(1);
  });
});
