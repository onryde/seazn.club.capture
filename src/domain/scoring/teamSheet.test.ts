import { orderFromLineup } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';

/**
 * The one team-sheet builder, for cricket and football (S2-4 plan Task 2, preflight F1 and F2): each bootstrap row as
 * the web's server builds it (`server/engine-db/lineups.ts` `buildLineup`), in the bootstrap's own order. The server
 * walks `order_no nulls last, full_name, person_id` (web #1135) and the bootstrap sends the same order, so the phone
 * keeps it and never re-sorts, or its batting order differs from the server's and a ball is refused (Review Focus 4).
 */
const side = (lineup: readonly BootstrapSlot[]): BootstrapSide => ({
  entrantId: 'ent-home',
  name: 'Home',
  kind: 'team',
  members: [],
  lineup,
});

describe('teamSheetOf', () => {
  it('rows keep the bootstrap’s order', () => {
    const sheet = teamSheetOf(
      side([
        { personId: 'p-d', pairOrder: null, slot: 'starting', orderNo: 1 },
        { personId: 'p-a', pairOrder: null, slot: 'starting', orderNo: 2 },
        { personId: 'p-c', pairOrder: null, slot: 'starting' },
        { personId: 'p-b', pairOrder: null, slot: 'starting' },
      ]),
    );
    expect(sheet.lineup.slots.map((slot) => [slot.personId, slot.orderNo])).toStrictEqual([
      ['p-d', 1],
      ['p-a', 2],
      ['p-c', 3],
      ['p-b', 4],
    ]);
  });

  it('a bench row stays bench and a coach row carries role coach', () => {
    expect(
      teamSheetOf(
        side([
          { personId: 'p-1', pairOrder: null, slot: 'starting', orderNo: 1, role: 'player' },
          { personId: 'p-12', pairOrder: null, slot: 'bench', orderNo: 12 },
          { personId: 'p-coach', pairOrder: null, slot: 'starting', role: 'coach' },
        ]),
      ),
    ).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          // A player's role is no key: the engine reads no role as a player, as `buildLineup` writes it.
          { personId: 'p-1', slot: 'starting', orderNo: 1 },
          { personId: 'p-12', slot: 'bench', orderNo: 12 },
          { personId: 'p-coach', slot: 'starting', orderNo: 3, role: 'coach' },
        ],
      },
      sheet: true,
    });
  });

  it('a row’s position, roles and shirt number travel; its pair order does not', () => {
    expect(
      teamSheetOf(
        side([
          {
            personId: 'p-wk',
            pairOrder: 2,
            slot: 'starting',
            orderNo: 2,
            positionKey: 'WK',
            roles: ['wicketkeeper'],
            squadNumber: 0,
          },
        ]),
      ).lineup.slots,
    ).toStrictEqual([
      {
        personId: 'p-wk',
        slot: 'starting',
        orderNo: 2,
        positionKey: 'WK',
        roles: ['wicketkeeper'],
        squadNumber: 0,
      },
    ]);
  });

  it('a row with no slot on a sheet starts', () => {
    expect(
      teamSheetOf(
        side([
          { personId: 'p-12', pairOrder: null, slot: 'bench', orderNo: 12 },
          { personId: 'p-1', pairOrder: null, orderNo: 1 },
        ]),
      ),
    ).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          { personId: 'p-12', slot: 'bench', orderNo: 12 },
          { personId: 'p-1', slot: 'starting', orderNo: 1 },
        ],
      },
      sheet: true,
    });
  });

  // A web older than the team sheet (S2-5 design §10) sends no slot at all: every row starts, numbered in the order
  // listed, and the side has no sheet.
  it('rows with no slot fold as all starting', () => {
    expect(
      teamSheetOf(
        side([
          { personId: 'p-b', pairOrder: 2 },
          { personId: 'p-a', pairOrder: null },
        ]),
      ),
    ).toStrictEqual({
      lineup: {
        entrantId: 'ent-home',
        slots: [
          { personId: 'p-b', slot: 'starting', orderNo: 1 },
          { personId: 'p-a', slot: 'starting', orderNo: 2 },
        ],
      },
      sheet: false,
    });
  });

  it('a side with no rows has no slots and no sheet', () => {
    expect(teamSheetOf(side([]))).toStrictEqual({
      lineup: { entrantId: 'ent-home', slots: [] },
      sheet: false,
    });
  });

  it('orderFromLineup over teamSheetOf is the starting players in order_no order', () => {
    const { lineup } = teamSheetOf(
      side([
        { personId: 'p-1', pairOrder: null, slot: 'starting', orderNo: 1 },
        { personId: 'p-2', pairOrder: null, slot: 'starting', orderNo: 2 },
        { personId: 'p-12', pairOrder: null, slot: 'bench', orderNo: 3 },
        { personId: 'p-3', pairOrder: null, slot: 'starting', orderNo: 4 },
        { personId: 'p-coach', pairOrder: null, slot: 'starting', role: 'coach' },
        { personId: 'p-4', pairOrder: null, slot: 'starting' },
      ]),
    );
    expect(orderFromLineup(lineup)).toStrictEqual(['p-1', 'p-2', 'p-3', 'p-4']);
  });
});
