import { fireEvent, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PadSync } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { SyncBadge } from '@/ui/components/SyncBadge';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { pressIn, pressOut } from '../../../test/press';
import { edgeOf, fillOf, paintOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The pad's send badge (owner, 2026-11-02: "remove sending word and have a symbol/icon like green uparrow for
// sending"): an up arrow and the count, no words; nothing at all while nothing waits. The same badge in caution orange
// when the taps cannot go (offline, a link the door shut, a server that keeps refusing). A tap opens History. A screen
// reader gets the words. Colour, press feedback and how it sits beside the other buttons are the device check's.

/**
 * The props the Pressable is handed: react-native-web 0.21.2 has no `accessibilityHint` in its forwarded props
 * (ViewerPeek.test.tsx), so the hint never reaches the DOM. What the badge hands the Pressable is what TalkBack is given.
 */
const handed = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Pressable: (props: ComponentProps<typeof actual.Pressable>) => {
      handed.push(props as Record<string, unknown>);
      return createElement(actual.Pressable, props);
    },
  };
});

type Dictionary = Readonly<Record<string, string>>;
const badge = () => screen.getByTestId('sync');
const glyph = () => screen.getByTestId('glyph');
const count = () => screen.getByTestId('sync-count');
const edges = (token: string) => Array<string>(4).fill(edgeOf(token));
const inkOf = () => getComputedStyle(count()).color;
/** How jsdom resolves a token as a colour: an edge is painted as one, so the reference is the same read. */
const asColour = (token: string) => edgeOf(token);
const filled = (text: string | undefined, taps: number) =>
  (text ?? '').replace('{count}', String(taps));

describe('SyncBadge: what each state draws', () => {
  it('draws nothing while every tap has reached the server', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'synced' }} onPress={vi.fn()} />);
    expect(screen.queryByTestId('sync')).toBeNull();
    expect(screen.queryByTestId('glyph')).toBeNull();
  });

  it('draws a lime up arrow and the count, and no word, while sending', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 8 }} onPress={vi.fn()} />);
    expect(glyph().dataset.name).toBe('up');
    expect(glyph().dataset.tone).toBe('lime');
    expect(count().textContent).toBe('8');
    expect(badge().textContent).toBe('8');
    expect(inkOf()).toBe(asColour(colour.ink));
  });

  it.each([
    ['offline', { kind: 'offline', count: 3 }],
    ['refused', { kind: 'refused', count: 3 }],
    ['stalled', { kind: 'stalled', count: 3 }],
    ['outdated', { kind: 'outdated', count: 3 }],
    ['asked', { kind: 'asked', count: 3 }],
  ] as const)(
    'draws the same badge in caution orange, the arrow stopped, when %s',
    (_kind, sync: PadSync) => {
      renderWithPorts(<SyncBadge sync={sync} onPress={vi.fn()} />);
      expect(glyph().dataset.name).toBe('upBlocked');
      expect(glyph().dataset.tone).toBe('caution');
      expect(count().textContent).toBe('3');
      expect(inkOf()).toBe(asColour(colour.caution));
      expect(paintOf(badge()).edges).toEqual(edges(colour.caution));
    },
  );

  it('keeps the outline quiet (lilac, a hairline) while sending and takes the heavier caution outline in trouble', () => {
    const view = renderWithPorts(
      <SyncBadge sync={{ kind: 'sending', count: 2 }} onPress={vi.fn()} />,
    );
    expect(paintOf(badge()).edges).toEqual(edges(colour.ink3));
    expect(getComputedStyle(badge()).borderTopWidth).toBe(`${layout.iconBorder}px`);
    view.rerender(<SyncBadge sync={{ kind: 'stalled', count: 2 }} onPress={vi.fn()} />);
    expect(getComputedStyle(badge()).borderTopWidth).toBe(`${layout.iconBorderOn}px`);
  });

  it.each([
    ['sending', { kind: 'sending', count: 8 }],
    ['stalled', { kind: 'stalled', count: 8 }],
  ] as const)(
    'draws the %s arrow at the badge’s own size, not the icon row’s 22',
    (_kind, sync: PadSync) => {
      renderWithPorts(<SyncBadge sync={sync} onPress={vi.fn()} />);
      expect(glyph().dataset.size).toBe(String(layout.padSyncGlyph));
      expect(layout.padSyncGlyph).not.toBe(22);
    },
  );

  it('is a 48 dp touch target at least, however short its count', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 1 }} onPress={vi.fn()} />);
    const style = getComputedStyle(badge());
    expect([style.minWidth, style.minHeight]).toEqual([
      `${layout.iconButton}px`,
      `${layout.iconButton}px`,
    ]);
  });

  it('sets the count in the badge’s own role: tabular, so 9 to 10 does not jump', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 9 }} onPress={vi.fn()} />);
    expect(getComputedStyle(count()).fontVariant).toContain('tabular-nums');
    expect(getComputedStyle(count()).fontSize).toBe(`${typeScale.syncCount.fontSize}px`);
  });

  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [2500, '99+'],
  ])('shows %i taps as "%s": two digits and a plus is the widest it grows', (taps, shown) => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: taps }} onPress={vi.fn()} />);
    expect(count().textContent).toBe(shown);
    // The words keep the true count: a screen reader is not told "99+".
    expect(badge().getAttribute('aria-label')).toContain(String(taps));
  });

  it('follows the state it is given: a stalled badge that clears and sends again is lime, then gone', () => {
    const view = renderWithPorts(
      <SyncBadge sync={{ kind: 'stalled', count: 4 }} onPress={vi.fn()} />,
    );
    expect(glyph().dataset.tone).toBe('caution');
    view.rerender(<SyncBadge sync={{ kind: 'sending', count: 4 }} onPress={vi.fn()} />);
    expect([glyph().dataset.name, glyph().dataset.tone]).toEqual(['up', 'lime']);
    view.rerender(<SyncBadge sync={{ kind: 'synced' }} onPress={vi.fn()} />);
    expect(screen.queryByTestId('sync')).toBeNull();
  });
});

describe('SyncBadge: what a screen reader and a finger get', () => {
  const LANGUAGES = [
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const;
  const KINDS = ['sending', 'offline', 'refused', 'stalled', 'outdated', 'asked'] as const;

  it.each(LANGUAGES)(
    '%s: names each state in its dictionary’s words, for one tap and for many',
    (lang, words: Dictionary) => {
      for (const kind of KINDS) {
        for (const [taps, form] of [
          [1, 'one'],
          [2, 'other'],
        ] as const) {
          const view = renderWithPorts(
            <SyncBadge sync={{ kind, count: taps }} onPress={vi.fn()} />,
            { deviceLanguages: [lang] },
          );
          const said = filled(words[`scoring.sync.${kind}.${form}`], taps);
          expect(said, `${lang} ${kind} ${form}`).toContain(String(taps));
          expect(badge().getAttribute('aria-label')).toBe(said);
          view.unmount();
        }
      }
    },
  );

  it('says "can’t be sent" in words of its own for a stall, not the offline or refused words', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'stalled', count: 8 }} onPress={vi.fn()} />);
    expect(badge().getAttribute('aria-label')).toBe(filled(en['scoring.sync.stalled.other'], 8));
    expect(en['scoring.sync.stalled.other']).not.toBe(en['scoring.sync.offline.other']);
    expect(en['scoring.sync.stalled.other']).not.toBe(en['scoring.sync.refused.other']);
  });

  it('is a button that reads its count once, as words, and draws are hidden from the reader', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 8 }} onPress={vi.fn()} />);
    expect(badge().getAttribute('role')).toBe('button');
    expect(badge().getAttribute('aria-label')).toBe(filled(en['scoring.sync.sending.other'], 8));
    expect(glyph().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(count().closest('[aria-hidden="true"]')).not.toBeNull();
  });

  // Review, 2026-11-02: the hint was the bare noun "History", which says what the screen is and not what the tap does.
  it.each(LANGUAGES)(
    '%s: tells a screen reader what a tap does, as a phrase: it opens History',
    (lang, words: Dictionary) => {
      handed.length = 0;
      renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 8 }} onPress={vi.fn()} />, {
        deviceLanguages: [lang],
      });
      const own = handed.filter(
        (props) => props.accessibilityLabel === filled(words['scoring.sync.sending.other'], 8),
      );
      expect(own.length).toBeGreaterThan(0);
      const hint = own.at(-1)?.accessibilityHint;
      expect(hint).toBe(words['scoring.sync.opensHistory']);
      expect(hint).not.toBe(words['scoring.history.title']);
    },
  );

  it('says "Opens History" in English, and the phrase is not the screen’s name', () => {
    expect(en['scoring.sync.opensHistory']).toBe('Opens History');
  });

  // Review, 2026-11-02: the badge turning orange was seen and never said. A live region is the app's own way of saying a
  // change (the last-tap line, the cards): politely, and only while the taps cannot go, so a count climbing while the
  // phone sends does not talk. Whether TalkBack reads it is the device check's.
  it.each([
    ['offline', { kind: 'offline', count: 2 }],
    ['refused', { kind: 'refused', count: 2 }],
    ['stalled', { kind: 'stalled', count: 2 }],
    ['outdated', { kind: 'outdated', count: 2 }],
    ['asked', { kind: 'asked', count: 2 }],
  ] as const)(
    'announces itself politely when %s, as a button and as a label',
    (_kind, sync: PadSync) => {
      const view = renderWithPorts(<SyncBadge sync={sync} onPress={vi.fn()} />);
      expect(badge().getAttribute('aria-live')).toBe('polite');
      view.unmount();
      renderWithPorts(<SyncBadge sync={sync} onPress={null} />);
      expect(badge().getAttribute('aria-live')).toBe('polite');
    },
  );

  it('does not announce while it is only sending: the count climbs with every tap', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'sending', count: 2 }} onPress={vi.fn()} />);
    expect(badge().getAttribute('aria-live')).not.toBe('polite');
  });

  it('is announced as the same node that turned orange: a sending badge that stops keeps its place', () => {
    const view = renderWithPorts(
      <SyncBadge sync={{ kind: 'sending', count: 2 }} onPress={vi.fn()} />,
    );
    const node = badge();
    view.rerender(<SyncBadge sync={{ kind: 'offline', count: 2 }} onPress={vi.fn()} />);
    expect(badge()).toBe(node);
    expect(badge().getAttribute('aria-live')).toBe('polite');
  });

  it('calls onPress once for a press, and once more for a second (a second tap is History again)', () => {
    const onPress = vi.fn();
    renderWithPorts(<SyncBadge sync={{ kind: 'stalled', count: 8 }} onPress={onPress} />);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(badge());
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.click(badge());
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  // Under a dead link's card History is not offered (`matchKnown`), so the badge has nowhere to go: it tells, and is no button.
  it('with nowhere to go (no onPress) is not a button, still names its taps, and a press does nothing', () => {
    renderWithPorts(<SyncBadge sync={{ kind: 'refused', count: 2 }} onPress={null} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(badge().getAttribute('aria-label')).toBe(filled(en['scoring.sync.refused.other'], 2));
    expect(count().textContent).toBe('2');
    expect(() => fireEvent.click(badge())).not.toThrow();
  });

  it.each([
    ['sending', { kind: 'sending', count: 8 }],
    ['stalled', { kind: 'stalled', count: 8 }],
  ] as const)(
    'takes the press fill while held when %s, then is as it was (how that reads outdoors is a device check)',
    (_kind, sync: PadSync) => {
      renderWithPorts(<SyncBadge sync={sync} onPress={vi.fn()} />);
      const resting = paintOf(badge());
      expect(resting.fill).not.toBe(fillOf(colour.pressFill));
      pressIn(badge());
      expect(paintOf(badge()).fill).toBe(fillOf(colour.pressFill));
      pressOut(badge());
      expect(paintOf(badge())).toEqual(resting);
    },
  );
});
