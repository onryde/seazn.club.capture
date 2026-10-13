import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EndedCard as EndedCardData } from '@/domain/session/endedCard';
import { EndedCard } from '@/ui/components/EndedCard';
import { colour } from '@/ui/theme/tokens';
import { textsIn } from '../../../test/endedFlow';
import { fillOf, heldOnGround } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

const CARD: EndedCardData = { reason: 'operator-stopped', durationMs: 754_000, codeEnded: false };
const LINES = [
  'Stream ended',
  'On air 0:12:34',
  'You stopped the broadcast.',
  'Scan the code again for the next broadcast',
  'OK',
];
const region = () => screen.getByRole('region', { name: 'Stream ended' });

describe('EndedCard', () => {
  // Task 7 lays Home out in landscape with the card as one row (spec §7): same lines, same order, one row.
  it.each([
    ['stacked', 'column'],
    ['row', 'row'],
  ] as const)(
    '%s lays its parts out as a %s, with the same lines in the same order',
    (shape, flow) => {
      renderWithPorts(<EndedCard card={CARD} layout={shape} onOk={vi.fn()} />);
      expect(getComputedStyle(region()).flexDirection).toBe(flow);
      expect(textsIn(region())).toEqual(LINES);
    },
  );

  // fr's widest time line is 230 dp (Geist Mono 16, "Temps d'antenne 99:59:59"), which fits a 320 dp phone's
  // 254 dp of card only on a line of its own: the header wraps it whole under the title, never mid-time.
  it('wraps the time under the title in the stacked header', () => {
    renderWithPorts(<EndedCard card={CARD} onOk={vi.fn()} />);
    const head = screen.getByText('Stream ended').parentElement as HTMLElement;
    expect(getComputedStyle(head).flexWrap).toBe('wrap');
    expect(screen.getByText('On air 0:12:34').parentElement).toBe(head);
  });

  it('is stacked unless it is told otherwise', () => {
    renderWithPorts(<EndedCard card={CARD} onOk={vi.fn()} />);
    expect(getComputedStyle(region()).flexDirection).toBe('column');
  });

  it('presses OK to its own handler, once', () => {
    const onOk = vi.fn();
    renderWithPorts(<EndedCard card={CARD} onOk={onOk} />);
    expect(onOk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  // Only the lines after the time change with the end; the title, the time and OK are always there.
  it.each([
    [
      'a fatal end keeps its code and has no hint',
      { ...CARD, reason: 'fatal-error' },
      ['Stream ended', 'On air 0:12:34', 'Something failed. Your code is kept.', 'OK'],
    ],
    [
      'a Stop over a dead code says so in place of the scan-again line',
      { ...CARD, codeEnded: true },
      [
        'Stream ended',
        'On air 0:12:34',
        'You stopped the broadcast.',
        'This code has ended. Scan the new one.',
        'OK',
      ],
    ],
    [
      'a session that never went live has no time on air',
      { ...CARD, durationMs: null },
      [
        'Stream ended',
        'Never went live',
        'You stopped the broadcast.',
        'Scan the code again for the next broadcast',
        'OK',
      ],
    ],
  ] as const)('%s', (_name, card, lines) => {
    renderWithPorts(<EndedCard card={card} onOk={vi.fn()} />);
    expect(textsIn(region())).toEqual(lines);
  });

  // The controller's press-fill ruling (2026-10-13): a held ghost's fill must not depend on the ground. The card is
  // surface, pinned here in both shapes, so a card repainted under OK fails too.
  it.each(['stacked', 'row'] as const)(
    '%s: a held OK takes the press fill on the card’s surface ground',
    (shape) => {
      renderWithPorts(<EndedCard card={CARD} layout={shape} onOk={vi.fn()} />);
      const { ground, held, released } = heldOnGround(
        () => screen.getByRole('button', { name: 'OK' }),
        region,
      );
      expect(ground).toBe(fillOf(colour.surface));
      expect(held).toBe(fillOf(colour.pressFill));
      expect(held).not.toBe(ground);
      expect(released).not.toBe(held);
    },
  );
});
