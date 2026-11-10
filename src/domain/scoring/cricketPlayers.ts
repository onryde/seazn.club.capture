import { bowlerRows, reasonText, type BowlerRow } from '@/domain/scoring/cricketBowling';
import { cardIn } from '@/domain/scoring/cricketFold';
import { creaseShown } from '@/domain/scoring/cricketPad';
import type { CricketPick } from '@/domain/scoring/cricketPicks';
import { turnOf } from '@/domain/scoring/cricketTurn';
import type {
  CricketDisplay,
  CricketPadKey,
  CricketWicketKind,
} from '@/domain/scoring/cricketTypes';
import type { PadVar } from '@/domain/scoring/padView';

/**
 * The Players sheet (S2-4 spec §4.8a; rulings 77 and 78; plan Task 14), opened by a tap on the board. Batting, in the
 * phone's batting order: those who have batted (out: how, runs (balls); in: runs (balls), the striker marked; retired not
 * out), then those yet to bat, who move ▲▼ among themselves at any time: the phone's own order pick, which only changes
 * the batter suggested at the next wicket. Bowling: every fielder with O-M-R-W and overs left; between overs, who can't bowl the
 * next over and why, and a tap on one who can is the over's pick (§4.4's); mid-over it is read-only (a change is More's).
 * Every figure is the engine scorecard's (`deriveCricketScorecard`, through the fold), never the phone's own sums.
 */

export type PlayersTab = 'batting' | 'bowling';

export type PlayersBatter = {
  readonly id: string;
  readonly name: string;
  readonly state: 'out' | 'in' | 'retired' | 'yet';
  readonly striker: boolean;
  readonly note: PadVar<CricketPadKey>;
  /** Yet to bat, with one yet to bat above (▲) or below (▼). */
  readonly up: boolean;
  readonly down: boolean;
};

export type PlayersBowler = {
  readonly id: string;
  readonly name: string;
  readonly note: PadVar<CricketPadKey>;
  /** Between overs, one who may bowl the next: a tap is the over's pick. */
  readonly tappable: boolean;
  /** The over's pick, held. */
  readonly chosen: boolean;
};

export type CricketPlayersView = {
  readonly batting: readonly PlayersBatter[];
  readonly bowling: readonly PlayersBowler[];
  /** Between overs the bowling tab is the next over's choice; otherwise it is read-only. */
  readonly betweenOvers: boolean;
};

export function playersView(display: CricketDisplay): CricketPlayersView {
  return {
    batting: battingOf(display),
    bowling: bowlingOf(display),
    betweenOvers: betweenOvers(display),
  };
}

/**
 * What the fold says of the innings under way: the crease (at a result, the batters left not out, as the board shows
 * them: T19 P1), who is out, who retired, and the scorecard's lines.
 */
function inningsFacts(display: CricketDisplay) {
  const turn = turnOf(display.state);
  const fine = turn?.innings?.fine ?? null;
  const card = turn === null ? undefined : cardIn(display.scorecard, display.state, turn);
  const crease = (creaseShown(display) ?? []).flatMap((line) => (line === null ? [] : [line]));
  return {
    fine,
    lines: new Map((card?.batting ?? []).map((line) => [line.person, line])),
    striker: crease.find((line) => line.striker)?.id ?? null,
    crease: crease.map((line) => line.id),
  };
}

type Batter = Omit<PlayersBatter, 'up' | 'down'>;

/** Those who have batted, then those yet to bat, each in the batting order; ▲▼ only between two yet to bat. */
function battingOf(display: CricketDisplay): readonly PlayersBatter[] {
  const side = display.innings?.batting;
  if (side === undefined) return [];
  const names = new Map(display.players[side].map((one) => [one.id, one.name]));
  const facts = inningsFacts(display);
  const rows = display.battingOrder.map((id) => batterOf(id, names.get(id) ?? id, facts));
  const batted = rows.filter((one) => one.state !== 'yet');
  const yet = rows.filter((one) => one.state === 'yet');
  return [
    ...batted.map((one) => ({ ...one, up: false, down: false })),
    ...yet.map((one, index) => ({ ...one, up: index > 0, down: index < yet.length - 1 })),
  ];
}

function batterOf(id: string, name: string, facts: ReturnType<typeof inningsFacts>): Batter {
  const line = facts.lines.get(id);
  const figures = { runs: line?.runs ?? 0, balls: line?.balls ?? 0 };
  const base = { id, name, striker: id === facts.striker };
  if (facts.crease.includes(id))
    return { ...base, state: 'in', note: { key: 'scoring.cricket.players.in', vars: figures } };
  if (facts.fine?.retiredNotOut?.includes(id) === true)
    return {
      ...base,
      state: 'retired',
      note: { key: 'scoring.cricket.players.retired', vars: figures },
    };
  if (facts.fine?.dismissed.includes(id) === true)
    return { ...base, state: 'out', note: outNote(line?.dismissal.kind, figures) };
  return { ...base, state: 'yet', note: { key: 'scoring.cricket.players.yet' } };
}

const HOW: ReadonlySet<string> = new Set<CricketWicketKind>([
  'bowled',
  'caught',
  'lbw',
  'runout',
  'stumped',
  'hitwicket',
  'retired',
  'obstructed',
  'timedout',
  'hitballtwice',
]);

type Figures = { readonly runs: number; readonly balls: number };

const isHow = (kind: string | undefined): kind is CricketWicketKind =>
  kind !== undefined && HOW.has(kind);

/** How out, from the scorecard; one it does not name (a line ledger's bare "out", `out_unknown`) says only Out. */
function outNote(kind: string | undefined, figures: Figures): PadVar<CricketPadKey> {
  if (!isHow(kind)) return { key: 'scoring.cricket.players.outPlain', vars: figures };
  const how = { key: `scoring.cricket.out.kind.${kind}` } as const;
  return { key: 'scoring.cricket.players.out', vars: { how, ...figures } };
}

/** No over under way in a main innings being scored: the next over's bowler may be picked (or picked again). */
function betweenOvers(display: CricketDisplay): boolean {
  const turn = turnOf(display.state);
  return (
    display.stage === 'live' &&
    turn?.superOver === false &&
    (turn.innings?.fine?.currentBowler ?? null) === null
  );
}

function bowlingOf(display: CricketDisplay): readonly PlayersBowler[] {
  const between = betweenOvers(display);
  return bowlerRows(display).map((row) => ({
    id: row.id,
    name: row.name,
    note: bowlerNote(row, between, display),
    tappable: between && row.can,
    chosen: between && display.bowler?.id === row.id,
  }));
}

/** Figures and overs left; between overs, why one may not bowl the next (mid-over, the next over's reasons would mislead). */
function bowlerNote(
  row: BowlerRow,
  between: boolean,
  display: CricketDisplay,
): PadVar<CricketPadKey> {
  if (between && !row.can) {
    const why = reasonText(row, display);
    return { key: 'scoring.cricket.players.cannot', vars: { figures: row.figures, why } };
  }
  if (row.oversLeft === null) return row.figures;
  return {
    key: 'scoring.cricket.players.figures.other',
    count: row.oversLeft,
    vars: { figures: row.figures },
  };
}

/** A tap on a bowler: between overs, the over's pick for one who may bowl it; nothing otherwise. */
export function playersBowler(display: CricketDisplay, id: string): CricketPick | null {
  const row = bowlingOf(display).find((one) => one.id === id);
  return row?.tappable === true ? { kind: 'bowler', bowler: id } : null;
}

/**
 * ▲▼ on the batting tab's row `from`: the order pick with that batter and the one at row `to` changing places, both yet
 * to bat; nothing for anyone who has batted.
 */
export function yetMoved(display: CricketDisplay, from: number, to: number): CricketPick | null {
  const side = display.innings?.batting;
  const rows = battingOf(display);
  const one = rows[from];
  const other = rows[to];
  if (side === undefined || one?.state !== 'yet' || other?.state !== 'yet') return null;
  const ids = display.battingOrder.map((id) =>
    id === one.id ? other.id : id === other.id ? one.id : id,
  );
  return { kind: 'order', side, ids };
}
