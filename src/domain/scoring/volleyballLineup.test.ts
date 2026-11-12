import { describe, expect, it } from 'vitest';
import { volleyballLineupOf } from '@/domain/scoring/volleyballLineup';
import type { BootstrapSide } from '@/domain/scoring/wire';

const side = (lineup: BootstrapSide['lineup']): BootstrapSide => ({
  entrantId: 'ent-1',
  name: 'Side',
  kind: 'team',
  members: [],
  lineup,
});

describe('volleyballLineupOf', () => {
  it('an indoor side: six starters and a bench, each as the sheet gives it, with no pair order', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({
      personId: `p${n}`,
      pairOrder: null,
      slot: 'starting' as const,
      orderNo: n,
      positionKey: 'outside',
      squadNumber: n + 10,
    }));
    const bench = { personId: 'p7', pairOrder: null, slot: 'bench' as const, orderNo: 7 };
    expect(volleyballLineupOf(side([...rows, bench]))).toEqual({
      entrantId: 'ent-1',
      slots: [
        ...[1, 2, 3, 4, 5, 6].map((n) => ({
          personId: `p${n}`,
          slot: 'starting',
          orderNo: n,
          positionKey: 'outside',
          squadNumber: n + 10,
        })),
        { personId: 'p7', slot: 'bench', orderNo: 7 },
      ],
    });
    const slots = volleyballLineupOf(side([...rows, bench])).slots;
    expect(slots.every((s) => !('pairOrder' in s))).toBe(true);
  });

  it('a beach pair carries pairOrder 1 and 2', () => {
    const got = volleyballLineupOf(
      side([
        { personId: 'a', pairOrder: 1, slot: 'starting', orderNo: 1 },
        { personId: 'b', pairOrder: 2, slot: 'starting', orderNo: 2 },
      ]),
    );
    expect(got.slots).toEqual([
      { personId: 'a', slot: 'starting', orderNo: 1, pairOrder: 1 },
      { personId: 'b', slot: 'starting', orderNo: 2, pairOrder: 2 },
    ]);
  });

  it('a beach pair with no sheet (rows with no slot) still carries its pair order', () => {
    const got = volleyballLineupOf(
      side([
        { personId: 'a', pairOrder: 2 },
        { personId: 'b', pairOrder: 1 },
      ]),
    );
    expect(got.slots).toEqual([
      { personId: 'a', slot: 'starting', orderNo: 1, pairOrder: 2 },
      { personId: 'b', slot: 'starting', orderNo: 2, pairOrder: 1 },
    ]);
  });

  it('a coach row keeps role coach, and a player row names no role', () => {
    const got = volleyballLineupOf(
      side([
        { personId: 'p1', pairOrder: null, slot: 'starting', orderNo: 1, role: 'player' },
        { personId: 'c1', pairOrder: null, slot: 'bench', orderNo: 2, role: 'coach' },
      ]),
    );
    expect(got.slots).toEqual([
      { personId: 'p1', slot: 'starting', orderNo: 1 },
      { personId: 'c1', slot: 'bench', orderNo: 2, role: 'coach' },
    ]);
  });

  it('a row with no slot among rows that have one starts; a row with no order_no takes its place from 1', () => {
    const got = volleyballLineupOf(
      side([
        { personId: 'p1', pairOrder: null, slot: 'starting', orderNo: 5 },
        { personId: 'p2', pairOrder: null },
        { personId: 'p3', pairOrder: null, slot: 'bench' },
      ]),
    );
    expect(got.slots).toEqual([
      { personId: 'p1', slot: 'starting', orderNo: 5 },
      { personId: 'p2', slot: 'starting', orderNo: 2 },
      { personId: 'p3', slot: 'bench', orderNo: 3 },
    ]);
  });

  it('an empty side has no slots', () => {
    expect(volleyballLineupOf(side([]))).toEqual({ entrantId: 'ent-1', slots: [] });
  });
});
