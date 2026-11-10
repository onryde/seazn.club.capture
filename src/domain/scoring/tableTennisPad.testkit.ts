import type { TableTennisDisplay } from '@/domain/scoring/tableTennisPad';

// The table tennis pad (design §5; the tools table of rulings 54 and 55 is the acceptance table for §5.3). Displays are written out
// by hand: the fold (tableTennisFold.test.ts) decides every fact, and this only draws them.

/** Game 1 of a best of 5, singles, before the first point, the Start pick standing in as the server. */
export const pre: TableTennisDisplay = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round: 'Round 1',
    match: 'Match 4',
    sides: ['A. Sharma', 'L. Chen'],
  },
  points: { first: 0, second: 0 },
  finished: [],
  game: 1,
  rules: { bestOf: 5, setTo: 11, finalSetTo: 11, winBy: 2, scoreBound: 31 },
  phase: 'pre',
  server: 'first',
  serverPerson: null,
  serverPersonId: null,
  serveNumber: 1,
  serverPicked: true,
  anchorNeeded: false,
  expedite: 'offered',
  deuce: false,
  sanctions: [],
  records: { timeouts: true, sanctions: true, expedite: true },
  scoreEvents: 0,
  lastTap: null,
  undoable: false,
};

/** 6–9 in game 1, the second side serving its second serve of the pair. */
export const live: TableTennisDisplay = {
  ...pre,
  points: { first: 6, second: 9 },
  scoreEvents: 15,
  phase: 'live',
  server: 'second',
  serveNumber: 2,
  serverPicked: false,
  lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
  undoable: true,
};

/** Live, but the engine names no server and this phone's pick is not standing in: the pad asks (ruling 51). */
export const unanchored: TableTennisDisplay = {
  ...live,
  server: null,
  serveNumber: null,
  anchorNeeded: true,
};

export const expedited: TableTennisDisplay = { ...live, expedite: 'inForce' };

export const doubles: TableTennisDisplay = {
  ...live,
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
};
