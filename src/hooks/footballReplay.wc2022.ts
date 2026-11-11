import { foldEpochOf } from '@seazn/engine/sport';
import type { BootstrapSide, BootstrapSlot } from '@/domain/scoring/wire';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';

/**
 * The 2022 World Cup final, Argentina 3–3 France after extra time, Argentina 4–2 on penalties (ESPN match 633850 and
 * Wikipedia, cross-checked 2026-11-11), as plain data for the replay test (`useFootballMatch.replay.test.tsx`). Every
 * value here is the real match's, never the phone's: the test drives the phone with it and compares the phone to it.
 * Person ids are made up (`arg-10` is Argentina's number 10); names and shirt numbers are the real ones.
 */

export const ARG = 'ent-arg';
export const FRA = 'ent-fra';

type Player = { readonly number: number; readonly name: string };

const ARG_XI: readonly Player[] = [
  { number: 23, name: 'E. Martínez' },
  { number: 26, name: 'Molina' },
  { number: 13, name: 'Romero' },
  { number: 19, name: 'Otamendi' },
  { number: 3, name: 'Tagliafico' },
  { number: 24, name: 'E. Fernández' },
  { number: 20, name: 'Mac Allister' },
  { number: 7, name: 'De Paul' },
  { number: 11, name: 'Di María' },
  { number: 10, name: 'Messi' },
  { number: 9, name: 'Álvarez' },
];

const ARG_BENCH: readonly Player[] = [
  { number: 1, name: 'Armani' },
  { number: 12, name: 'Rulli' },
  { number: 2, name: 'Foyth' },
  { number: 25, name: 'Li. Martínez' },
  { number: 18, name: 'G. Rodríguez' },
  { number: 17, name: 'A. Gómez' },
  { number: 14, name: 'Palacios' },
  { number: 15, name: 'Correa' },
  { number: 16, name: 'Almada' },
  { number: 8, name: 'Acuña' },
  { number: 4, name: 'Montiel' },
  { number: 5, name: 'Paredes' },
  { number: 22, name: 'La. Martínez' },
  { number: 6, name: 'Pezzella' },
  { number: 21, name: 'Dybala' },
];

const FRA_XI: readonly Player[] = [
  { number: 1, name: 'Lloris' },
  { number: 5, name: 'Koundé' },
  { number: 4, name: 'Varane' },
  { number: 18, name: 'Upamecano' },
  { number: 22, name: 'T. Hernández' },
  { number: 8, name: 'Tchouaméni' },
  { number: 14, name: 'Rabiot' },
  { number: 11, name: 'Dembélé' },
  { number: 7, name: 'Griezmann' },
  { number: 10, name: 'Mbappé' },
  { number: 9, name: 'Giroud' },
];

const FRA_BENCH: readonly Player[] = [
  { number: 23, name: 'Areola' },
  { number: 16, name: 'Mandanda' },
  { number: 2, name: 'Pavard' },
  { number: 17, name: 'Saliba' },
  { number: 6, name: 'Guendouzi' },
  { number: 15, name: 'Veretout' },
  { number: 12, name: 'Kolo Muani' },
  { number: 26, name: 'Thuram' },
  { number: 20, name: 'Coman' },
  { number: 25, name: 'Camavinga' },
  { number: 13, name: 'Fofana' },
  { number: 24, name: 'Konaté' },
  { number: 3, name: 'Disasi' },
];

/** A player's made-up person id: the team's code and the shirt number (`arg-10`). */
export const arg = (number: number): string => `arg-${number}`;
export const fra = (number: number): string => `fra-${number}`;

/** The keepers who started, the one row each team sheet marks GK. */
const KEEPERS = new Set(['arg-23', 'fra-1']);

function side(
  entrantId: string,
  name: string,
  id: (n: number) => string,
  xi: readonly Player[],
  bench: readonly Player[],
): BootstrapSide {
  const rows = [...xi, ...bench];
  return {
    entrantId,
    name,
    kind: 'team',
    members: rows.map((player) => ({ personId: id(player.number), fullName: player.name })),
    lineup: rows.map((player, i): BootstrapSlot => ({
      personId: id(player.number),
      pairOrder: null,
      slot: i < xi.length ? 'starting' : 'bench',
      orderNo: i + 1,
      role: 'player',
      squadNumber: player.number,
      ...(KEEPERS.has(id(player.number)) ? { positionKey: 'GK' } : {}),
    })),
  };
}

/**
 * The competition's rules as the brief gives them (FIFA WC 2022): 2 × 45, extra time 2 × 15, a shootout of 5 kicks, five
 * substitutions in three windows, one concussion substitution outside the cap. The engine has no key for the extra-time
 * substitution or window, so none is invented here (that absence is finding F-R5).
 */
export const WC_CFG = {
  extraTime: { enabled: true, halfMinutes: 15 },
  shootout: true,
  shootoutAttempts: 5,
  maxSubs: 5,
  subWindows: 3,
  concussionSubs: 1,
  teamSize: 11,
} as const;

/** The final as the fake server holds it before anyone taps: nothing recorded, both team sheets in full. */
export function wc2022Seed(): FakeMatchSeed {
  return {
    sport: 'football',
    fixtureId: 'wc2022-final',
    linkId: 'fake-link-wc2022-final',
    cfg: WC_CFG,
    rulesVersion: 0,
    epochRequired: foldEpochOf('football'),
    screen: 'pad',
    context: {
      competition: 'FIFA World Cup 2022',
      division: 'Final',
      round: 'Final',
      match: 'Match 64',
    },
    sides: {
      home: side(ARG, 'Argentina', arg, ARG_XI, ARG_BENCH),
      away: side(FRA, 'France', fra, FRA_XI, FRA_BENCH),
    },
    events: [],
  };
}

/** A moment of the match as a scoresheet names it: the minute, and added minutes after the period's end. */
export type Minute = { readonly minute: number; readonly added?: number };

/** One goal: the minute, the team (`first` is Argentina), the scorer's shirt number, and a penalty. */
export const GOALS = [
  { at: { minute: 23 }, side: 'first', scorer: 10, penalty: true },
  { at: { minute: 36 }, side: 'first', scorer: 11, penalty: false },
  { at: { minute: 80 }, side: 'second', scorer: 10, penalty: true },
  { at: { minute: 81 }, side: 'second', scorer: 10, penalty: false },
  { at: { minute: 108 }, side: 'first', scorer: 10, penalty: false },
  { at: { minute: 118 }, side: 'second', scorer: 10, penalty: true },
] as const;

/** The yellow cards (no reds); Giroud's at 90+5 was shown on the bench, 54 minutes after he came off. */
export const YELLOWS = [
  { at: { minute: 45, added: 7 }, side: 'first', person: 24 },
  { at: { minute: 55 }, side: 'second', person: 14 },
  { at: { minute: 87 }, side: 'second', person: 26 },
  { at: { minute: 90, added: 5 }, side: 'second', person: 9 },
  { at: { minute: 90, added: 8 }, side: 'first', person: 8 },
  { at: { minute: 114 }, side: 'first', person: 5 },
  { at: { minute: 116 }, side: 'first', person: 4 },
] as const;

/**
 * The substitutions, in the order made; subs at one stoppage share a minute. Rabiot → Fofana was a concussion
 * substitution. Molina → Montiel (ESPN 90', Wikipedia 91') was made in the break before extra time, not in play (the
 * controller's correction, 2026-11-11): `inBreak`, tapped after the 90+8 whistle and before extra time's Start, so it is
 * unstamped and uses no window (Law 3). Its `at` names the whistle it followed.
 */
export const SUBS = [
  { at: { minute: 41 }, side: 'second', off: 11, on: 12 },
  { at: { minute: 41 }, side: 'second', off: 9, on: 26 },
  { at: { minute: 64 }, side: 'first', off: 11, on: 8 },
  { at: { minute: 71 }, side: 'second', off: 7, on: 20 },
  { at: { minute: 71 }, side: 'second', off: 22, on: 25 },
  { at: { minute: 90, added: 8 }, side: 'first', off: 26, on: 4, inBreak: true },
  { at: { minute: 96 }, side: 'second', off: 14, on: 13, concussion: true },
  { at: { minute: 102 }, side: 'first', off: 7, on: 5 },
  { at: { minute: 102 }, side: 'first', off: 9, on: 22 },
  { at: { minute: 113 }, side: 'second', off: 4, on: 24 },
  { at: { minute: 116 }, side: 'first', off: 20, on: 6 },
  { at: { minute: 120, added: 1 }, side: 'second', off: 5, on: 3 },
  { at: { minute: 120, added: 1 }, side: 'first', off: 3, on: 21 },
] as const;

/**
 * The shootout, FRANCE first: the taker's shirt number and whether it went in. Decided after kick 8 (Montiel), 4–2.
 * The replay brief listed Argentina first; in that order the kicks are decided after kick 7 (4 scored against France's
 * best of 3), so the brief's order cannot end 4–2 after 8. The real order (Mbappé took the first kick) is used here.
 */
export const KICKS = [
  { side: 'second', taker: 10, scored: true },
  { side: 'first', taker: 10, scored: true },
  { side: 'second', taker: 20, scored: false },
  { side: 'first', taker: 21, scored: true },
  { side: 'second', taker: 8, scored: false },
  { side: 'first', taker: 5, scored: true },
  { side: 'second', taker: 12, scored: true },
  { side: 'first', taker: 4, scored: true },
] as const;

/** When each period ended, as the referee blew: 45+7, 90+8, 105 (extra time's half-time) and 120+1. */
export const PERIOD_ENDS = {
  H1: { minute: 45, added: 7 },
  H2: { minute: 90, added: 8 },
  ET_H1: { minute: 105 },
  ET_H2: { minute: 120, added: 1 },
} as const;
